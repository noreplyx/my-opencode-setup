#!/usr/bin/env ts-node
/**
 * Journal Lookup — Cross-Session Learning for the Orchestration System
 *
 * Usage: ts-node journal-lookup.ts --feature=<feature-name>
 *        ts-node journal-lookup.ts --feature=<feature-name> --journal-path=<path>
 *
 * Reads the project journal (.opencode/journal/journal.yaml), finds entries
 * semantically related to the given feature name, and produces a human-readable
 * cross-session learning report. Also writes/updates `.opencode/journal/index.json`
 * for faster future lookups.
 *
 * Exit codes:
 *   0 = Matches found (report printed, index written)
 *   1 = No matches found (index still written)
 *   2 = Journal file not found
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CircuitBreakerEvent {
  gate: string;
  attempts?: number;
  resolution?: string;
}

interface JournalEntry {
  date: string;
  feature: string;
  pipelineType: string;
  result: string;
  durationMinutes?: number;
  filesChanged?: string[];
  keyDecisions?: string[];
  circuitBreakerEvents?: CircuitBreakerEvent[];
  failedGates?: string[];
  notes?: string;
  retrospective?: {
    pipelineQuality?: string;
    handoffQuality?: { rating?: number; issues?: string[] };
    agentPerformance?: Array<{ role: string; effectiveness: string; notes?: string }>;
    wastedSteps?: string[];
    improvementsForNextPipeline?: string[];
    lessonsLearned?: string[];
  };
}

interface MatchResult {
  entry: JournalEntry;
  score: number;
}

interface IndexData {
  index: Record<string, string[]>;
  entries: Record<string, {
    result: string;
    failedGates?: string[];
    keyDecisions?: string[];
    lessonsLearned?: string[];
  }>;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): { feature: string; journalPath: string } {
  const featureArg = process.argv.find(a => a.startsWith('--feature='));
  const journalArg = process.argv.find(a => a.startsWith('--journal-path='));

  if (!featureArg) {
    console.error('❌ Missing required argument: --feature=<feature-name>');
    console.error('Usage: ts-node journal-lookup.ts --feature=<feature-name>');
    console.error('       ts-node journal-lookup.ts --feature=<feature-name> --journal-path=<path>');
    process.exit(2);
  }

  const feature = featureArg.split('=').slice(1).join('=');
  const journalPath = journalArg
    ? journalArg.split('=').slice(1).join('=')
    : path.resolve(process.cwd(), '.opencode/journal/journal.yaml');

  return { feature, journalPath };
}

// ---------------------------------------------------------------------------
// YAML parsing (line-by-line, no external dependencies)
// ---------------------------------------------------------------------------

/**
 * Parse a simple YAML list into an array of flat/structured records.
 * Supports:
 *   - Top-level list items starting with `- `
 *   - Nested keys with 2-space indentation
 *   - Strings, numbers, booleans, arrays (`[a, b]`), and nested objects
 *   - Multi-line string values (indented continuation)
 *
 * This is intentionally NOT a full YAML parser — it handles only the subset
 * used in journal.yaml.
 */
function parseYamlList(yaml: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const lines = yaml.split('\n');

  let currentRecord: Record<string, unknown> | null = null;
  let currentKey: string | null = null;
  let currentIndent = 0;
  let inMultiLineValue = false;
  let multiLineParts: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmedLine = rawLine.trim();

    // Skip empty lines and comments
    if (trimmedLine === '' || trimmedLine.startsWith('#')) {
      // If we were in a multi-line value, a blank line ends it
      if (inMultiLineValue && trimmedLine === '') {
        inMultiLineValue = false;
        if (currentRecord && currentKey) {
          currentRecord[currentKey] = multiLineParts.join('\n');
        }
        multiLineParts = [];
      }
      continue;
    }

    const indent = rawLine.search(/\S/);

    // Detect new top-level list item (`- key: value`)
    // Only start a new record if the `-` is at the root list level (indent <= 2)
    // or if there's no current record. Nested list items (indent > 2) like
    // filesChanged or agentPerformance belong to the current record.
    if (trimmedLine.startsWith('- ') && (currentRecord === null || indent <= 2)) {
      // Finalize previous record
      if (currentRecord && inMultiLineValue && currentKey) {
        inMultiLineValue = false;
        currentRecord[currentKey] = multiLineParts.join('\n');
        multiLineParts = [];
      }

      const rest = trimmedLine.substring(2).trim();

      // Check if this is a simple string list item (no colon)
      // or a record start (has key: after the dash)
      const colonIdx = rest.indexOf(':');
      if (colonIdx === -1) {
        // Simple string list item — skip, we only parse records
        continue;
      }

      currentRecord = {};
      currentIndent = indent;
      currentKey = null;
      records.push(currentRecord);

      // Parse the first key-value pair on this line
      const firstKey = rest.substring(0, colonIdx).trim();
      const firstValue = rest.substring(colonIdx + 1).trim();
      currentKey = firstKey;

      if (firstValue === '' || firstValue === '|' || firstValue === '>') {
        // Multi-line scalar indicator
        inMultiLineValue = true;
        multiLineParts = [];
      } else {
        currentRecord[firstKey] = parseYamlValue(firstValue);
        currentKey = null;
      }
      continue;
    }

    // Continuation of a multi-line value
    if (inMultiLineValue) {
      if (indent > currentIndent) {
        multiLineParts.push(trimmedLine);
        continue;
      } else {
        // End of multi-line value
        inMultiLineValue = false;
        if (currentRecord && currentKey) {
          currentRecord[currentKey] = multiLineParts.join('\n');
        }
        multiLineParts = [];
        // Fall through to process this line as a new key
      }
    }

    // Nested key-value pairs (indented under a record)
    if (currentRecord && indent > currentIndent) {
      // Handle quoted values that might contain colons (e.g. list items like
      // `- "some text: with colon"` — find the first colon that's outside quotes)
      let colonIdx = -1;
      let inQuote: string | null = null;
      for (let ci = 0; ci < trimmedLine.length; ci++) {
        const ch = trimmedLine[ci];
        if (inQuote) {
          if (ch === inQuote) inQuote = null;
        } else if (ch === '"' || ch === "'") {
          inQuote = ch;
        } else if (ch === ':') {
          colonIdx = ci;
          break;
        }
      }
      if (colonIdx === -1) continue;

      const key = trimmedLine.substring(0, colonIdx).trim();
      let value = trimmedLine.substring(colonIdx + 1).trim();

      // If the key is quoted, unquote it
      const unquotedKey = (key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))
        ? key.slice(1, -1)
        : key;
      currentKey = unquotedKey;

      // Check for block list start FIRST: key: with no inline value,
      // followed by indented `- ` items on subsequent lines
      if (value === '' && isYamlBlockListStart(trimmedLine, colonIdx, lines, i)) {
        const blockList = parseYamlBlockList(trimmedLine, lines, i, indent);
        currentRecord[unquotedKey] = blockList.value;
        i = blockList.lastIndex;
        currentKey = null;
      } else if (value === '' && isNestedObjectStart(trimmedLine, lines, i)) {
        // Nested object (e.g. retrospective: followed by indented key-value pairs)
        const nestedObj = parseNestedObject(lines, i, indent);
        currentRecord[unquotedKey] = nestedObj.value;
        i = nestedObj.lastIndex;
        currentKey = null;
      } else if (value === '' || value === '|' || value === '>') {
        // Multi-line scalar indicator
        inMultiLineValue = true;
        multiLineParts = [];
      } else if (value.startsWith('- ')) {
        // Inline array (e.g., key: [val1, val2])
        currentRecord[unquotedKey] = parseYamlArray(trimmedLine.substring(colonIdx + 1).trim(), lines, i);
      } else if (value.startsWith('{')) {
        // Inline object — parse as JSON-like
        currentRecord[unquotedKey] = parseYamlInlineObject(value);
      } else {
        currentRecord[unquotedKey] = parseYamlValue(value);
        currentKey = null;
      }
    }
  }

  // Finalize trailing multi-line value
  if (currentRecord && inMultiLineValue && currentKey) {
    currentRecord[currentKey] = multiLineParts.join('\n');
  }

  return records;
}

/**
 * Check if the line starts a YAML block list (next line has `  - ` with same indent).
 * Looks ahead at the next non-empty, non-comment line.
 */
function isYamlBlockListStart(line: string, colonIdx: number, allLines: string[], startIndex: number): boolean {
  const afterColon = line.substring(colonIdx + 1).trim();
  if (afterColon !== '') return false;

  // Peek at the next non-empty, non-comment line
  for (let i = startIndex + 1; i < allLines.length; i++) {
    const nextLine = allLines[i];
    const trimmed = nextLine.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    // If the next significant line starts with `- `, it's a block list
    // Otherwise it's a nested object with key-value pairs
    return trimmed.startsWith('- ');
  }

  return false;
}

/**
 * Check if the line starts a nested object (followed by indented key-value pairs,
 * not list items).
 */
function isNestedObjectStart(line: string, allLines: string[], startIndex: number): boolean {
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) return false;
  const afterColon = line.substring(colonIdx + 1).trim();
  if (afterColon !== '') return false;

  // Peek at the next non-empty, non-comment line
  for (let i = startIndex + 1; i < allLines.length; i++) {
    const nextLine = allLines[i];
    const trimmed = nextLine.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    // If the next significant line starts with `- `, it's a block list
    // Otherwise it's a nested object with key-value pairs
    return !trimmed.startsWith('- ');
  }

  return false;
}

/**
 * Parse a nested object (indented key-value pairs under a parent key).
 */
function parseNestedObject(
  allLines: string[],
  startIndex: number,
  parentIndent: number,
): { value: Record<string, unknown>; lastIndex: number } {
  const obj: Record<string, unknown> = {};
  let i = startIndex + 1;

  for (; i < allLines.length; i++) {
    const rawLine = allLines[i];
    const trimmedLine = rawLine.trim();
    if (trimmedLine === '' || trimmedLine.startsWith('#')) continue;

    const indent = rawLine.search(/\S/);
    if (indent <= parentIndent) break;

    // Handle quoted keys with colons
    let colonIdx = -1;
    let inQuote: string | null = null;
    for (let ci = 0; ci < trimmedLine.length; ci++) {
      const ch = trimmedLine[ci];
      if (inQuote) {
        if (ch === inQuote) inQuote = null;
      } else if (ch === '"' || ch === "'") {
        inQuote = ch;
      } else if (ch === ':') {
        colonIdx = ci;
        break;
      }
    }
    if (colonIdx === -1) continue;

    const key = trimmedLine.substring(0, colonIdx).trim();
    let value = trimmedLine.substring(colonIdx + 1).trim();
    const unquotedKey = (key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))
      ? key.slice(1, -1)
      : key;

    if (value === '' && isYamlBlockListStart(trimmedLine, colonIdx, allLines, i)) {
      const blockList = parseYamlBlockList(trimmedLine, allLines, i, indent);
      obj[unquotedKey] = blockList.value;
      i = blockList.lastIndex;
    } else if (value === '' && isNestedObjectStart(trimmedLine, allLines, i)) {
      const nestedObj = parseNestedObject(allLines, i, indent);
      obj[unquotedKey] = nestedObj.value;
      i = nestedObj.lastIndex;
    } else if (value.startsWith('{')) {
      obj[unquotedKey] = parseYamlInlineObject(value);
    } else if (value.startsWith('- ')) {
      obj[unquotedKey] = parseYamlArray(value, allLines, i);
    } else {
      obj[unquotedKey] = parseYamlValue(value);
    }
  }

  return { value: obj, lastIndex: i - 1 };
}

/**
 * Parse a YAML block list starting after a key with no inline value.
 * Returns the parsed array and the last line index consumed.
 */
function parseYamlBlockList(
  firstLine: string,
  allLines: string[],
  startIndex: number,
  parentIndent: number,
): { value: unknown[]; lastIndex: number } {
  const items: unknown[] = [];
  let i = startIndex + 1;

  // Determine indent of the list items by looking at the first item
  for (; i < allLines.length; i++) {
    const rawLine = allLines[i];
    if (rawLine.trim() === '' || rawLine.trim().startsWith('#')) continue;

    const indent = rawLine.search(/\S/);
    if (indent <= parentIndent) {
      // We've gone past the block list
      i--;
      break;
    }

    const trimmed = rawLine.trim();
    if (!trimmed.startsWith('- ')) {
      // Not a list item — end of block list
      i--;
      break;
    }

    const rest = trimmed.substring(2).trim();

    // Find first colon outside quotes
    let colonIdx = -1;
    let inQ: string | null = null;
    for (let ci = 0; ci < rest.length; ci++) {
      const ch = rest[ci];
      if (inQ) {
        if (ch === inQ) inQ = null;
      } else if (ch === '"' || ch === "'") {
        inQ = ch;
      } else if (ch === ':') {
        colonIdx = ci;
        break;
      }
    }

    if (colonIdx === -1) {
      // Simple scalar list item
      items.push(parseYamlValue(rest));
    } else {
      // Object list item — parse its fields
      const obj: Record<string, unknown> = {};
      const firstKey = rest.substring(0, colonIdx).trim();
      const firstVal = rest.substring(colonIdx + 1).trim();

      if (firstVal === '' || firstVal === '|') {
        obj[firstKey] = ''; // Could be multi-line but skip for simplicity
      } else {
        obj[firstKey] = parseYamlValue(firstVal);
      }

      // Parse remaining fields of this list object (indented further)
      const itemIndent = indent;
      let j = i + 1;
      for (; j < allLines.length; j++) {
        const nextLine = allLines[j];
        if (nextLine.trim() === '' || nextLine.trim().startsWith('#')) continue;
        const nextIndent = nextLine.search(/\S/);
        if (nextIndent <= itemIndent) {
          j--;
          break;
        }
        if (nextLine.trim().startsWith('- ')) {
          // Nested list inside the object
          const nestedKey = findCurrentKey(allLines, j, itemIndent);
          if (nestedKey) {
            const nestedList = parseYamlBlockList(nextLine, allLines, j, itemIndent);
            (obj as Record<string, unknown>)[nestedKey] = nestedList.value;
            j = nestedList.lastIndex;
          }
          continue;
        }
        const subColon = nextLine.indexOf(':');
        if (subColon === -1) continue;
        const subKey = nextLine.substring(subColon - (nextLine.length - nextLine.trimStart().length) + (nextLine.search(/\S/)), subColon).trim();
        const subValue = nextLine.substring(subColon + 1).trim();
        if (subValue !== '') {
          (obj as Record<string, unknown>)[subKey] = parseYamlValue(subValue);
        }
      }
      i = j;
      items.push(obj);
    }
  }

  return { value: items, lastIndex: i };
}

/**
 * Try to find the current key name by looking at the parent line.
 */
function findCurrentKey(lines: string[], index: number, parentIndent: number): string | null {
  for (let k = index; k >= 0; k--) {
    const line = lines[k];
    const indent = line.search(/\S/);
    if (indent < parentIndent && line.includes(':')) {
      return line.substring(line.indexOf(':') - (line.length - line.trimStart().length) + indent, line.indexOf(':')).trim();
    }
  }
  return null;
}

/**
 * Parse a simple inline YAML value.
 */
function parseYamlValue(value: string): unknown {
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(s => s !== '');
  }
  // Remove surrounding quotes
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Parse an inline YAML array (already identified).
 */
function parseYamlArray(firstLineValue: string, allLines: string[], startIndex: number): unknown[] {
  // Simple inline array: [a, b, c]
  if (firstLineValue.startsWith('[')) {
    const parsed = parseYamlValue(firstLineValue);
    if (Array.isArray(parsed)) return parsed;
    return [firstLineValue];
  }

  // Multi-line block list starting on this line
  // e.g., key:\n  - val1\n  - val2
  const items: unknown[] = [];
  const indent = allLines[startIndex].search(/\S/);

  for (let i = startIndex + 1; i < allLines.length; i++) {
    const rawLine = allLines[i];
    if (rawLine.trim() === '' || rawLine.trim().startsWith('#')) continue;

    const lineIndent = rawLine.search(/\S/);
    if (lineIndent <= indent) break;

    const trimmed = rawLine.trim();
    if (trimmed.startsWith('- ')) {
      items.push(parseYamlValue(trimmed.substring(2).trim()));
    } else {
      break;
    }
  }

  return items;
}

/**
 * Parse a simple inline object `{key: value, ...}`.
 */
function parseYamlInlineObject(value: string): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  const inner = value.slice(1, -1).trim();
  if (inner === '') return obj;

  const pairs = splitTopLevel(inner, ',');
  for (const pair of pairs) {
    const colonIdx = pair.indexOf(':');
    if (colonIdx === -1) continue;
    const key = pair.substring(0, colonIdx).trim();
    const val = pair.substring(colonIdx + 1).trim();
    obj[key] = parseYamlValue(val);
  }

  return obj;
}

/**
 * Split a string by a delimiter, respecting nested brackets/braces.
 */
function splitTopLevel(s: string, delimiter: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (const ch of s) {
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
    else if (ch === delimiter && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

// ---------------------------------------------------------------------------
// Journal reading
// ---------------------------------------------------------------------------

function readJournal(journalPath: string): JournalEntry[] {
  if (!fs.existsSync(journalPath)) {
    return [];
  }

  const raw = fs.readFileSync(journalPath, 'utf-8');
  const parsed = parseYamlList(raw);

  // Type-narrow to JournalEntry
  return parsed.map(item => {
    const entry: JournalEntry = {
      date: String(item.date ?? ''),
      feature: String(item.feature ?? ''),
      pipelineType: String(item.pipelineType ?? ''),
      result: String(item.result ?? ''),
    };

    if (typeof item.durationMinutes === 'number') entry.durationMinutes = item.durationMinutes;
    if (Array.isArray(item.filesChanged)) entry.filesChanged = item.filesChanged as string[];
    if (Array.isArray(item.keyDecisions)) entry.keyDecisions = item.keyDecisions as string[];
    if (Array.isArray(item.circuitBreakerEvents)) entry.circuitBreakerEvents = item.circuitBreakerEvents as CircuitBreakerEvent[];
    if (Array.isArray(item.failedGates)) entry.failedGates = item.failedGates as string[];
    if (typeof item.notes === 'string') entry.notes = item.notes;
    if (typeof item.retrospective === 'object' && item.retrospective !== null) {
      entry.retrospective = item.retrospective as JournalEntry['retrospective'];
    }

    return entry;
  });
}

// ---------------------------------------------------------------------------
// Feature matching
// ---------------------------------------------------------------------------

/**
 * Split a feature name into normalized keywords.
 * Handles kebab-case, snake_case, and space-separated names.
 */
function splitFeatureName(feature: string): string[] {
  return feature
    .toLowerCase()
    .split(/[-_\s]+/)
    .map(w => w.trim())
    .filter(w => w.length > 0);
}

/**
 * Calculate match score between query words and entry words.
 * score = matchingWords / max(queryWords, entryWords)
 */
function calculateMatchScore(queryWords: string[], entryWords: string[]): number {
  if (queryWords.length === 0 || entryWords.length === 0) return 0;

  const querySet = new Set(queryWords);
  let matches = 0;

  for (const word of entryWords) {
    if (querySet.has(word)) {
      matches++;
    }
  }

  const denominator = Math.max(queryWords.length, entryWords.length);
  return matches / denominator;
}

/**
 * Find journal entries matching the given feature name.
 */
function findMatchingEntries(entries: JournalEntry[], feature: string): MatchResult[] {
  const queryWords = splitFeatureName(feature);
  const matches: MatchResult[] = [];

  for (const entry of entries) {
    const entryWords = splitFeatureName(entry.feature);
    let score: number;

    // Exact feature name match = score 1.0
    if (entry.feature.toLowerCase() === feature.toLowerCase()) {
      score = 1.0;
    } else {
      score = calculateMatchScore(queryWords, entryWords);
    }

    if (score >= 0.3) {
      matches.push({ entry, score });
    }
  }

  // Sort by score descending, then by date descending
  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.entry.date.localeCompare(a.entry.date);
  });

  return matches;
}

// ---------------------------------------------------------------------------
// Index building
// ---------------------------------------------------------------------------

function buildIndex(entries: JournalEntry[]): IndexData {
  const index: Record<string, string[]> = {};
  const indexedEntries: IndexData['entries'] = {};

  for (const entry of entries) {
    const words = splitFeatureName(entry.feature);
    const uniqueWords = [...new Set(words)];

    for (const word of uniqueWords) {
      if (!index[word]) {
        index[word] = [];
      }
      if (!index[word].includes(entry.feature)) {
        index[word].push(entry.feature);
      }
    }

    // Store condensed entry data
    indexedEntries[entry.feature] = {
      result: entry.result,
      failedGates: entry.failedGates,
      keyDecisions: entry.keyDecisions,
      lessonsLearned: entry.retrospective?.lessonsLearned,
    };
  }

  // Sort keyword lists for deterministic output
  for (const key of Object.keys(index)) {
    index[key].sort();
  }

  return { index, entries: indexedEntries };
}

function writeIndex(indexData: IndexData, journalDir: string): void {
  const indexPath = path.resolve(journalDir, 'index.json');
  const json = JSON.stringify(indexData, null, 2);
  fs.writeFileSync(indexPath, json, 'utf-8');
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function generateReport(feature: string, matches: MatchResult[]): string {
  const lines: string[] = [];

  lines.push('📖 Cross-Session Learning Lookup');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');
  lines.push(`Feature: "${feature}"`);
  lines.push(`Matches found: ${matches.length}`);
  lines.push('');

  if (matches.length === 0) {
    lines.push('  No past journal entries matched this feature.');
    lines.push('  (Index file has been written for future lookups.)');
    lines.push('');
    return lines.join('\n');
  }

  for (let i = 0; i < matches.length; i++) {
    const { entry, score } = matches[i];
    const matchNum = i + 1;
    const resultIcon = entry.result === 'pass' ? '✅' : entry.result === 'fail' ? '❌' : '⚠️';

    lines.push(`Match ${matchNum}: "${entry.feature}" (score: ${score.toFixed(2)})`);
    lines.push(`  ${resultIcon} Result: ${capitalize(entry.result)}`);
    lines.push(`  📅 Date: ${entry.date}`);
    lines.push(`  🏷️  Type: ${entry.pipelineType}`);

    if (entry.durationMinutes !== undefined) {
      lines.push(`  ⏱️  Duration: ${entry.durationMinutes} min`);
    }

    if (entry.failedGates && entry.failedGates.length > 0) {
      const gateDetails = entry.failedGates.map(gate => {
        const cbEvent = (entry.circuitBreakerEvents ?? []).find(e => e.gate === gate);
        return cbEvent
          ? `${gate} (${cbEvent.attempts ?? '?'} attempts)`
          : gate;
      });
      lines.push(`  ❌ Failed Gates: ${gateDetails.join(', ')}`);
    }

    if (entry.keyDecisions && entry.keyDecisions.length > 0) {
      lines.push(`  💡 Key Decision: "${entry.keyDecisions[0]}"`);
      if (entry.keyDecisions.length > 1) {
        for (let k = 1; k < entry.keyDecisions.length; k++) {
          lines.push(`     "${entry.keyDecisions[k]}"`);
        }
      }
    }

    const lessons = entry.retrospective?.lessonsLearned;
    if (lessons && lessons.length > 0) {
      lines.push(`  📝 Lesson: "${lessons[0]}"`);
      if (lessons.length > 1) {
        for (let l = 1; l < lessons.length; l++) {
          lines.push(`     "${lessons[l]}"`);
        }
      }
    } else {
      lines.push(`  📝 Lesson: (none recorded)`);
    }

    // Root cause inference from notes
    if (entry.result === 'fail' && entry.notes) {
      lines.push(`  🔍 Root Cause: ${entry.notes}`);
    }

    lines.push('');
  }

  // Recommended Actions section
  lines.push('Recommended Actions:');
  lines.push('');

  const allLessons = new Set<string>();
  const allDecisions = new Set<string>();

  for (const { entry } of matches) {
    const lessons = entry.retrospective?.lessonsLearned ?? [];
    for (const l of lessons) {
      allLessons.add(l);
    }
    const decisions = entry.keyDecisions ?? [];
    for (const d of decisions) {
      allDecisions.add(d);
    }
  }

  if (allLessons.size > 0) {
    for (const lesson of allLessons) {
      lines.push(`  ⚠️  ${lesson}`);
    }
  }

  if (allDecisions.size > 0) {
    for (const decision of allDecisions) {
      lines.push(`  💡  Consider: ${decision}`);
    }
  }

  if (allLessons.size === 0 && allDecisions.size === 0) {
    lines.push('  No actionable items extracted from past entries.');
  }

  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const { feature, journalPath } = parseArgs();
  const resolvedJournalPath = path.resolve(journalPath);
  const journalDir = path.dirname(resolvedJournalPath);

  console.error(`[journal-lookup] Reading journal: ${resolvedJournalPath}`);
  console.error(`[journal-lookup] Feature query: "${feature}"`);

  // Read journal
  const entries = readJournal(resolvedJournalPath);

  if (entries.length === 0 && !fs.existsSync(resolvedJournalPath)) {
    console.error(`❌ Journal not found: ${resolvedJournalPath}`);
    process.exit(2);
  }

  if (entries.length === 0) {
    console.error(`[journal-lookup] Journal is empty: ${resolvedJournalPath}`);
  } else {
    console.error(`[journal-lookup] Loaded ${entries.length} journal entries`);
  }

  // Build and write index
  const indexData = buildIndex(entries);
  writeIndex(indexData, journalDir);
  console.error(`[journal-lookup] Index written to: ${path.resolve(journalDir, 'index.json')}`);

  // Find matches
  const matches = findMatchingEntries(entries, feature);

  // Generate and print report
  const report = generateReport(feature, matches);
  console.log(report);

  // Print index stats to stderr
  const keywordCount = Object.keys(indexData.index).length;
  const entryCount = Object.keys(indexData.entries).length;
  console.error(`[journal-lookup] Index: ${keywordCount} keywords, ${entryCount} entries indexed`);

  // Exit code: 0 = matches found, 1 = no matches
  process.exit(matches.length > 0 ? 0 : 1);
}

main();
