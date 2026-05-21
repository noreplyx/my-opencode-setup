#!/usr/bin/env node
/**
 * Citation Index — Cross-Session Citation Index Builder & Query Engine
 *
 * Builds and queries a citation index that maps checkpoint IDs to past pipeline
 * results. Enables cross-session learning: given a checkpoint ID (e.g. "CP-003"),
 * the index shows what went wrong in all previous pipelines that hit that checkpoint.
 *
 * Usage:
 *   ts-node citation-index.ts --build
 *   ts-node citation-index.ts --checkpoint=CP-003
 *   ts-node citation-index.ts --manifest=plan-manifests/user-profile/v1-manifest.json
 *   ts-node citation-index.ts --feature=user-profile
 *   ts-node citation-index.ts --stats
 *   ts-node citation-index.ts --rebuild
 *
 * Exit codes:
 *   0 = Success (index built / query matched)
 *   1 = Query found no results
 *   2 = Index not built yet (run --build first)
 *   3 = Required paths/files not found
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CheckpointCitation {
  pipelineId: string;
  feature: string;
  date: string;
  result: string;
  reason: string;
  fix: string;
  lesson: string;
}

interface CitationEntry {
  pipelineId: string;
  feature: string;
  date: string;
  result: string;
  checkpoints: Array<{
    id: string;
    outcome: string;
    reason: string;
    fix: string;
    lesson: string;
  }>;
}

interface CitationIndex {
  indexBuildAt: string;
  totalPipelinesIndexed: number;
  totalCheckpointsIndexed: number;
  checkpoints: Record<string, CheckpointCitation[]>;
  statistics: {
    totalCheckpointIds: number;
    mostFailedCheckpoint: string;
    checkpointsByFailureRate: Array<{
      id: string;
      total: number;
      failures: number;
      failureRate: number;
    }>;
    pipelinesByResult: Record<string, number>;
  };
}

interface JournalEntry {
  date: string;
  feature: string;
  pipelineType: string;
  result: string;
  durationMinutes?: number;
  filesChanged?: string[];
  keyDecisions?: string[];
  circuitBreakerEvents?: Array<{ gate: string; attempts?: number; resolution?: string }>;
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

interface ManifestCheckpoint {
  id: string;
  step: string;
  description?: string;
  status?: string;
}

interface PlanManifest {
  pipelineId?: string;
  feature?: string;
  checkpoints?: ManifestCheckpoint[];
  phases?: Array<{ name?: string; checkpoints?: ManifestCheckpoint[] }>;
  [key: string]: unknown;
}

interface AgentContextManifest {
  pipelineId?: string;
  feature?: string;
  pipelineType?: string;
  result?: string;
  circuitBreaker?: {
    state?: string;
    counters?: Record<string, number>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface ParsedCheckpoint {
  id: string;
  outcome: string;
  reason: string;
  fix: string;
  lesson: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_DIR = path.resolve(process.cwd(), '.opencode', 'cache');
const INDEX_PATH = path.resolve(CACHE_DIR, 'citation-index.json');
const JOURNAL_PATH = path.resolve(process.cwd(), '.opencode', 'journal', 'journal.yaml');
const PIPELINE_LOGS_DIR = path.resolve(process.cwd(), '.opencode', 'pipeline-logs');
const CHECKPOINT_RE = /(CP-\d{3,})(?:-[a-zA-Z_-]+)?/g;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): { mode: string; value?: string } {
  const args = process.argv.slice(2);

  if (args.includes('--build')) return { mode: 'build' };
  if (args.includes('--rebuild')) return { mode: 'rebuild' };
  if (args.includes('--stats')) return { mode: 'stats' };

  const checkpointArg = args.find(a => a.startsWith('--checkpoint='));
  if (checkpointArg) {
    return { mode: 'checkpoint', value: checkpointArg.split('=').slice(1).join('=') };
  }

  const manifestArg = args.find(a => a.startsWith('--manifest='));
  if (manifestArg) {
    return { mode: 'manifest', value: manifestArg.split('=').slice(1).join('=') };
  }

  const featureArg = args.find(a => a.startsWith('--feature='));
  if (featureArg) {
    return { mode: 'feature', value: featureArg.split('=').slice(1).join('=') };
  }

  console.error('Usage:');
  console.error('  ts-node citation-index.ts --build');
  console.error('  ts-node citation-index.ts --checkpoint=CP-003');
  console.error('  ts-node citation-index.ts --manifest=<path-to-manifest.json>');
  console.error('  ts-node citation-index.ts --feature=user-profile');
  console.error('  ts-node citation-index.ts --stats');
  console.error('  ts-node citation-index.ts --rebuild');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// YAML parsing (lightweight, no external dependencies)
// Reuses the same YAML list parser pattern from journal-lookup.ts
// ---------------------------------------------------------------------------

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

    if (trimmedLine === '' || trimmedLine.startsWith('#')) {
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

    if (trimmedLine.startsWith('- ') && (currentRecord === null || indent <= 2)) {
      if (currentRecord && inMultiLineValue && currentKey) {
        inMultiLineValue = false;
        currentRecord[currentKey] = multiLineParts.join('\n');
        multiLineParts = [];
      }

      const rest = trimmedLine.substring(2).trim();
      const colonIdx = rest.indexOf(':');
      if (colonIdx === -1) continue;

      currentRecord = {};
      currentIndent = indent;
      currentKey = null;
      records.push(currentRecord);

      const firstKey = rest.substring(0, colonIdx).trim();
      const firstValue = rest.substring(colonIdx + 1).trim();
      currentKey = firstKey;

      if (firstValue === '' || firstValue === '|' || firstValue === '>') {
        inMultiLineValue = true;
        multiLineParts = [];
      } else {
        currentRecord[firstKey] = parseYamlValue(firstValue);
        currentKey = null;
      }
      continue;
    }

    if (inMultiLineValue) {
      if (indent > currentIndent) {
        multiLineParts.push(trimmedLine);
        continue;
      } else {
        inMultiLineValue = false;
        if (currentRecord && currentKey) {
          currentRecord[currentKey] = multiLineParts.join('\n');
        }
        multiLineParts = [];
      }
    }

    if (currentRecord && indent > currentIndent) {
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
      currentKey = unquotedKey;

      if (value === '') {
        // Check if next lines are a block list or nested object
        const isBlockList = isYamlBlockListStart(trimmedLine, colonIdx, lines, i);
        if (isBlockList) {
          const blockList = parseYamlBlockList(trimmedLine, lines, i, indent);
          currentRecord[unquotedKey] = blockList.value;
          i = blockList.lastIndex;
          currentKey = null;
        } else if (isNestedObjectStart(trimmedLine, lines, i)) {
          const nestedObj = parseNestedObject(lines, i, indent);
          currentRecord[unquotedKey] = nestedObj.value;
          i = nestedObj.lastIndex;
          currentKey = null;
        } else {
          inMultiLineValue = true;
          multiLineParts = [];
        }
      } else if (value.startsWith('- ')) {
        currentRecord[unquotedKey] = parseYamlArrayItems(lines, i, indent);
      } else {
        currentRecord[unquotedKey] = parseYamlValue(value);
        currentKey = null;
      }
    }
  }

  if (currentRecord && inMultiLineValue && currentKey) {
    currentRecord[currentKey] = multiLineParts.join('\n');
  }

  return records;
}

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
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function isYamlBlockListStart(line: string, _colonIdx: number, allLines: string[], startIndex: number): boolean {
  for (let i = startIndex + 1; i < allLines.length; i++) {
    const nextLine = allLines[i];
    const trimmed = nextLine.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    return trimmed.startsWith('- ');
  }
  return false;
}

function isNestedObjectStart(line: string, allLines: string[], startIndex: number): boolean {
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) return false;
  const afterColon = line.substring(colonIdx + 1).trim();
  if (afterColon !== '') return false;

  for (let i = startIndex + 1; i < allLines.length; i++) {
    const nextLine = allLines[i];
    const trimmed = nextLine.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    return !trimmed.startsWith('- ');
  }
  return false;
}

function parseYamlBlockList(
  _firstLine: string,
  allLines: string[],
  startIndex: number,
  parentIndent: number,
): { value: unknown[]; lastIndex: number } {
  const items: unknown[] = [];
  let i = startIndex + 1;

  for (; i < allLines.length; i++) {
    const rawLine = allLines[i];
    if (rawLine.trim() === '' || rawLine.trim().startsWith('#')) continue;

    const indent = rawLine.search(/\S/);
    if (indent <= parentIndent) {
      i--;
      break;
    }

    const trimmed = rawLine.trim();
    if (!trimmed.startsWith('- ')) {
      i--;
      break;
    }

    const rest = trimmed.substring(2).trim();
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
      items.push(parseYamlValue(rest));
    } else {
      const obj: Record<string, unknown> = {};
      const firstKey = rest.substring(0, colonIdx).trim();
      const firstVal = rest.substring(colonIdx + 1).trim();
      if (firstVal === '' || firstVal === '|') {
        obj[firstKey] = '';
      } else {
        obj[firstKey] = parseYamlValue(firstVal);
      }
      items.push(obj);
    }
  }

  return { value: items, lastIndex: i };
}

function parseYamlArrayItems(allLines: string[], startIndex: number, _parentIndent: number): unknown[] {
  const items: unknown[] = [];
  for (let i = startIndex; i < allLines.length; i++) {
    const rawLine = allLines[i];
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('- ')) {
      items.push(parseYamlValue(trimmed.substring(2).trim()));
    } else if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    } else {
      break;
    }
  }
  return items;
}

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
    } else if (value.startsWith('- ')) {
      obj[unquotedKey] = parseYamlArrayItems(allLines, i, indent);
    } else {
      obj[unquotedKey] = parseYamlValue(value);
    }
  }

  return { value: obj, lastIndex: i - 1 };
}

// ---------------------------------------------------------------------------
// Parsers: Journal & Pipeline Logs
// ---------------------------------------------------------------------------

function readJournal(): JournalEntry[] {
  if (!fs.existsSync(JOURNAL_PATH)) {
    console.error(`[citation-index] Journal not found at ${JOURNAL_PATH}`);
    return [];
  }

  const raw = fs.readFileSync(JOURNAL_PATH, 'utf-8');
  const parsed = parseYamlList(raw);

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
    if (Array.isArray(item.circuitBreakerEvents)) entry.circuitBreakerEvents = item.circuitBreakerEvents as Array<{ gate: string; attempts?: number; resolution?: string }>;
    if (Array.isArray(item.failedGates)) entry.failedGates = item.failedGates as string[];
    if (typeof item.notes === 'string') entry.notes = item.notes;
    if (typeof item.retrospective === 'object' && item.retrospective !== null) {
      entry.retrospective = item.retrospective as JournalEntry['retrospective'];
    }
    return entry;
  });
}

/**
 * Parse an agent-context.md YAML frontmatter block.
 */
function parseAgentContext(text: string): AgentContextManifest | null {
  const frontmatterMatch = text.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return null;

  const yamlBlock = frontmatterMatch[1];
  const result: AgentContextManifest = {};

  // Parse simple key: value pairs
  for (const line of yamlBlock.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    // Simple key: value (skip complex nested structures)
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.substring(0, colonIdx).trim();
    const value = trimmed.substring(colonIdx + 1).trim();

    if (!value || value.startsWith('#') || value.startsWith('{')) continue;

    // Handle nested key paths like "circuitBreaker.state" 
    if (key.includes('.')) continue;

    result[key] = value;
  }

  return result;
}

/**
 * Parse a plan manifest JSON file.
 */
function readPlanManifest(manifestPath: string): PlanManifest | null {
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    return JSON.parse(raw) as PlanManifest;
  } catch (e) {
    console.error(`[citation-index] Failed to parse manifest: ${manifestPath} — ${(e as Error).message}`);
    return null;
  }
}

/**
 * Find all pipeline log directories.
 */
function findPipelineLogDirs(): string[] {
  if (!fs.existsSync(PIPELINE_LOGS_DIR)) return [];
  const results: string[] = [];

  try {
    const entries = fs.readdirSync(PIPELINE_LOGS_DIR);
    for (const entry of entries) {
      const fullPath = path.join(PIPELINE_LOGS_DIR, entry);
      if (fs.statSync(fullPath).isDirectory()) {
        results.push(fullPath);
      }
    }
  } catch {
    // Ignore read errors
  }

  return results;
}

/**
 * Find all manifest JSON files in a pipeline log directory.
 */
function findManifestsInLogDir(logDir: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(logDir);
    for (const entry of entries) {
      if (entry.endsWith('.json') && entry.includes('manifest')) {
        results.push(path.join(logDir, entry));
      }
    }
  } catch {
    // Ignore
  }
  return results;
}

/**
 * Find all agent-context.md files in a pipeline log directory.
 */
function findAgentContextsInLogDir(logDir: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(logDir);
    for (const entry of entries) {
      if (entry === 'agent-context.md' || entry.endsWith('-context.md')) {
        results.push(path.join(logDir, entry));
      }
    }
  } catch {
    // Ignore
  }
  return results;
}

// ---------------------------------------------------------------------------
// Checkpoint Extraction
// ---------------------------------------------------------------------------

/**
 * Extract all checkpoint IDs from a text string (like notes, keyDecisions, etc.).
 */
function extractCheckpointsFromText(text: string): string[] {
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(CHECKPOINT_RE.source, 'g');
  while ((m = re.exec(text)) !== null) {
    matches.push(m[1]); // Capture the CP-NNN part (without agent suffix)
  }
  return [...new Set(matches)];
}

/**
 * Infer checkpoint outcome from a journal entry's context and result.
 * Tries to determine what happened at each checkpoint referenced.
 */
function inferCheckpointsFromJournal(entry: JournalEntry): ParsedCheckpoint[] {
  const allText = [
    entry.notes || '',
    ...(entry.keyDecisions || []),
    ...(entry.failedGates || []),
    entry.retrospective?.lessonsLearned?.join('\n') || '',
  ].join('\n');

  const checkpointIds = extractCheckpointsFromText(allText);
  if (checkpointIds.length === 0) return [];

  const lessons = entry.retrospective?.lessonsLearned || [];
  const decisions = entry.keyDecisions || [];
  const failedGates = entry.failedGates || [];

  return checkpointIds.map(id => {
    // Try to find a related decision or lesson for this checkpoint
    const relatedDecision = decisions.find(d => d.includes(id)) || '';
    const relatedLesson = lessons.find(l => l.includes(id)) || '';
    const matchedGate = failedGates.find(g => g.includes(id)) || '';

    const isFail = entry.result === 'fail' || matchedGate !== '';
    const outcome = isFail ? 'fail' : entry.result === 'partial' ? 'partial' : 'pass';

    const reason = isFail
      ? (matchedGate || (entry.notes ? `${entry.notes.substring(0, 120)}` : 'Pipeline failure')) 
      : 'Checkpoint passed';

    // Infer a "fix" from decisions/lessons
    const fix = relatedDecision
      ? `Decision: ${relatedDecision}`
      : isFail && relatedLesson
        ? `Lesson: ${relatedLesson}`
        : isFail
          ? 'Review pipeline logs for root cause'
          : 'No action needed';

    const lesson = relatedLesson || (isFail ? `Checkpoint ${id} failed in ${entry.feature}` : '');

    return { id, outcome, reason, fix, lesson };
  });
}

/**
 * Extract checkpoint citations from a plan manifest.
 */
function extractCheckpointsFromManifest(
  manifest: PlanManifest,
  pipelineId: string,
  feature: string,
  date: string,
  journalEntries: JournalEntry[],
  journalResult?: string,
): ParsedCheckpoint[] {
  const allCps: ManifestCheckpoint[] = [
    ...(manifest.checkpoints || []),
  ];

  if (manifest.phases) {
    for (const phase of manifest.phases) {
      if (phase.checkpoints) {
        allCps.push(...phase.checkpoints);
      }
    }
  }

  // Find matching journal entry to infer outcomes
  const journalEntry = journalEntries.find(
    je => je.feature.toLowerCase() === (manifest.feature || feature).toLowerCase()
  );

  const result = journalResult || journalEntry?.result || 'unknown';
  const entry = journalEntry;

  return allCps.map(cp => {
    const allText = [
      entry?.notes || '',
      ...(entry?.keyDecisions || []),
      ...(entry?.failedGates || []),
      cp.description || '',
    ].join('\n');

    const isCheckpointMentioned = allText.includes(cp.id);
    const lessons = entry?.retrospective?.lessonsLearned || [];

    const isFail = result === 'fail' || 
      (entry?.failedGates && entry.failedGates.some(g => g.includes(cp.id))) ||
      (cp.status === 'failed');

    const outcome = isFail ? 'fail' : result === 'partial' ? 'partial' : 'pass';
    const reason = isFail
      ? (cp.description 
        ? `Failed during: ${cp.description}`
        : entry?.notes 
          ? entry.notes.substring(0, 200) 
          : 'Pipeline failure at this checkpoint')
      : 'Checkpoint completed successfully';

    const relatedDec = (entry?.keyDecisions || []).find(d => d.includes(cp.id)) || '';
    const relatedLesson = lessons.find(l => l.includes(cp.id)) || '';
    const fix = relatedDec
      ? `Decision: ${relatedDec}`
      : relatedLesson
        ? `Lesson: ${relatedLesson}`
        : '';

    const lesson = relatedLesson || (isCheckpointMentioned && isFail 
      ? `Checkpoint ${cp.id}: ${cp.description || 'failed'}` 
      : '');

    return { id: cp.id, outcome, reason, fix, lesson };
  });
}

/**
 * Parse an agent-context.md file for pipeline identity info and checkpoint references.
 */
function parsePipelineContext(filePath: string): { pipelineId: string; feature: string; result: string } | null {
  if (!fs.existsSync(filePath)) return null;

  const text = fs.readFileSync(filePath, 'utf-8');
  const ctx = parseAgentContext(text);
  if (!ctx) return null;

  return {
    pipelineId: String(ctx.pipelineId || 'unknown'),
    feature: String(ctx.feature || 'unknown'),
    result: String(ctx.result || 'unknown'),
  };
}

// ---------------------------------------------------------------------------
// Index Building
// ---------------------------------------------------------------------------

function buildIndex(): CitationIndex {
  console.error('[citation-index] Building citation index...');
  const startTime = Date.now();

  const index: CitationIndex = {
    indexBuildAt: new Date().toISOString(),
    totalPipelinesIndexed: 0,
    totalCheckpointsIndexed: 0,
    checkpoints: {},
    statistics: {
      totalCheckpointIds: 0,
      mostFailedCheckpoint: '',
      checkpointsByFailureRate: [],
      pipelinesByResult: {},
    },
  };

  const allEntries: CitationEntry[] = [];

  // 1. Read journal
  const journalEntries = readJournal();
  console.error(`[citation-index] Loaded ${journalEntries.length} journal entries`);

  // 2. Journal-based checkpoint extraction
  for (const entry of journalEntries) {
    const pipelineId = `journal-${entry.date}-${entry.feature}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    const parsed = inferCheckpointsFromJournal(entry);

    if (parsed.length > 0) {
      allEntries.push({
        pipelineId,
        feature: entry.feature,
        date: entry.date,
        result: entry.result,
        checkpoints: parsed,
      });
    }
  }

  // 3. Scan pipeline logs
  const logDirs = findPipelineLogDirs();
  console.error(`[citation-index] Found ${logDirs.length} pipeline log directories`);

  for (const logDir of logDirs) {
    const dirName = path.basename(logDir);
    let pipelineId = dirName;
    let feature = dirName;
    let date = '';
    let result = 'unknown';

    // Try to read agent-context.md for identity info
    const ctxFiles = findAgentContextsInLogDir(logDir);
    for (const ctxFile of ctxFiles) {
      const ctx = parsePipelineContext(ctxFile);
      if (ctx) {
        pipelineId = ctx.pipelineId;
        feature = ctx.feature;
        result = ctx.result;
        break;
      }
    }

    // Find manifest files
    const manifestFiles = findManifestsInLogDir(logDir);
    for (const mf of manifestFiles) {
      const manifest = readPlanManifest(mf);
      if (!manifest) continue;

      // Try to get manifest date from file mtime
      const stat = fs.statSync(mf);
      date = new Date(stat.mtime).toISOString();

      const parsed = extractCheckpointsFromManifest(
        manifest, pipelineId, feature, date, journalEntries, result,
      );

      if (parsed.length > 0) {
        allEntries.push({
          pipelineId,
          feature,
          date,
          result,
          checkpoints: parsed,
        });
      }
    }
  }

  // 4. Build the inverted index
  const pipelinesByResult: Record<string, number> = {};
  const checkpointFailureCounts: Record<string, { total: number; failures: number }> = {};

  for (const entry of allEntries) {
    index.totalPipelinesIndexed++;

    // Track pipeline result counts
    const r = entry.result || 'unknown';
    pipelinesByResult[r] = (pipelinesByResult[r] || 0) + 1;

    for (const cp of entry.checkpoints) {
      index.totalCheckpointsIndexed++;

      // Track per-checkpoint failure stats
      if (!checkpointFailureCounts[cp.id]) {
        checkpointFailureCounts[cp.id] = { total: 0, failures: 0 };
      }
      checkpointFailureCounts[cp.id].total++;
      if (cp.outcome === 'fail') {
        checkpointFailureCounts[cp.id].failures++;
      }

      // Build citation list
      if (!index.checkpoints[cp.id]) {
        index.checkpoints[cp.id] = [];
      }

      index.checkpoints[cp.id].push({
        pipelineId: entry.pipelineId,
        feature: entry.feature,
        date: entry.date,
        result: entry.result,
        reason: cp.reason,
        fix: cp.fix,
        lesson: cp.lesson,
      });
    }
  }

  // 5. Compute statistics
  index.statistics.pipelinesByResult = pipelinesByResult;
  index.statistics.totalCheckpointIds = Object.keys(index.checkpoints).length;

  const byFailureRate = Object.entries(checkpointFailureCounts)
    .map(([id, counts]) => ({
      id,
      total: counts.total,
      failures: counts.failures,
      failureRate: counts.total > 0 ? counts.failures / counts.total : 0,
    }))
    .sort((a, b) => b.failureRate - a.failureRate || b.total - a.total);

  index.statistics.checkpointsByFailureRate = byFailureRate;
  index.statistics.mostFailedCheckpoint = byFailureRate.length > 0
    ? byFailureRate[0].id
    : '';

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.error(`[citation-index] Index build complete in ${elapsed}s`);
  console.error(`[citation-index]   Pipelines indexed: ${index.totalPipelinesIndexed}`);
  console.error(`[citation-index]   Checkpoints indexed: ${index.totalCheckpointsIndexed}`);
  console.error(`[citation-index]   Unique checkpoint IDs: ${index.statistics.totalCheckpointIds}`);

  return index;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function writeIndex(index: CitationIndex): void {
  ensureCacheDir();
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf-8');
  console.error(`[citation-index] Index written to ${INDEX_PATH}`);
}

function readIndex(): CitationIndex | null {
  if (!fs.existsSync(INDEX_PATH)) return null;
  try {
    const raw = fs.readFileSync(INDEX_PATH, 'utf-8');
    return JSON.parse(raw) as CitationIndex;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Query Handlers
// ---------------------------------------------------------------------------

function handleBuild(): void {
  const index = buildIndex();
  writeIndex(index);
  // Also print compact JSON to stdout for programmatic use
  console.log(JSON.stringify({
    status: 'built',
    indexBuildAt: index.indexBuildAt,
    totalPipelinesIndexed: index.totalPipelinesIndexed,
    totalCheckpointsIndexed: index.totalCheckpointsIndexed,
    totalCheckpointIds: index.statistics.totalCheckpointIds,
  }, null, 2));
}

function handleRebuild(): void {
  // Remove existing index and rebuild
  if (fs.existsSync(INDEX_PATH)) {
    fs.unlinkSync(INDEX_PATH);
    console.error('[citation-index] Removed existing index for rebuild');
  }
  handleBuild();
}

function handleStats(): void {
  const index = readIndex();
  if (!index) {
    console.error('[citation-index] Index not found. Run --build first.');
    process.exit(2);
  }

  const lines: string[] = [];
  lines.push('Citation Index Statistics');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');
  lines.push(`  Index built at:      ${index.indexBuildAt}`);
  lines.push(`  Pipelines indexed:   ${index.totalPipelinesIndexed}`);
  lines.push(`  Checkpoints indexed: ${index.totalCheckpointsIndexed}`);
  lines.push(`  Unique checkpoint IDs: ${index.statistics.totalCheckpointIds}`);
  lines.push(`  Most failed checkpoint: ${index.statistics.mostFailedCheckpoint || '(none)'}`);
  lines.push('');

  lines.push('  Pipelines by result:');
  for (const [result, count] of Object.entries(index.statistics.pipelinesByResult).sort()) {
    lines.push(`    ${result}: ${count}`);
  }
  lines.push('');

  lines.push('  Checkpoints by failure rate (top 15):');
  lines.push('  ─────────────────────────────────────');
  lines.push('  Rank │ ID              │ Total │ Failures │ Rate   ');
  lines.push('  ─────┼─────────────────┼───────┼──────────┼────────');
  const topCps = index.statistics.checkpointsByFailureRate.slice(0, 15);
  for (let i = 0; i < topCps.length; i++) {
    const cp = topCps[i];
    const rateStr = (cp.failureRate * 100).toFixed(1) + '%';
    lines.push(
      `  ${String(i + 1).padStart(4)} │ ${cp.id.padEnd(15)} │ ${String(cp.total).padStart(5)} │ ${String(cp.failures).padStart(8)} │ ${rateStr.padStart(6)}`,
    );
  }
  lines.push('');

  console.log(lines.join('\n'));
}

function handleCheckpoint(checkpointId: string): void {
  const index = readIndex();
  if (!index) {
    console.error('[citation-index] Index not found. Run --build first.');
    process.exit(2);
  }

  // Normalize checkpoint ID — strip agent suffix if present
  const normalizedId = checkpointId.replace(/-(implementor|fixer|qa|verifier|finder|plandescriber|documentor|integrator|merge-coordinator|browser-tester)$/, '');

  const citations = index.checkpoints[normalizedId];
  if (!citations || citations.length === 0) {
    // Also try with the exact string as passed
    const exactCitations = index.checkpoints[checkpointId];
    if (!exactCitations || exactCitations.length === 0) {
      console.log(`No citations found for checkpoint "${checkpointId}"`);
      process.exit(1);
    }
    printCheckpointReport(checkpointId, exactCitations, index);
    process.exit(0);
  }

  printCheckpointReport(normalizedId, citations, index);
  process.exit(0);
}

function printCheckpointReport(id: string, citations: CheckpointCitation[], index: CitationIndex): void {
  const failures = citations.filter(c => c.result === 'fail').length;
  const passes = citations.filter(c => c.result === 'pass').length;
  const partials = citations.filter(c => c.result === 'partial').length;
  const total = citations.length;

  const lines: string[] = [];
  lines.push(`Checkpoint Citation Report: ${id}`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push('');
  lines.push(`  Total citations: ${total}`);
  lines.push(`  Pass:  ${passes}`);
  lines.push(`  Fail:  ${failures}`);
  lines.push(`  Partial: ${partials}`);
  lines.push(`  Failure rate: ${((failures / total) * 100).toFixed(1)}%`);
  lines.push('');

  // Sort: failures first, then by date descending
  const sorted = [...citations].sort((a, b) => {
    if (a.result === 'fail' && b.result !== 'fail') return -1;
    if (a.result !== 'fail' && b.result === 'fail') return 1;
    return b.date.localeCompare(a.date);
  });

  lines.push('  Citations (failures first):');
  lines.push('  ──────────────────────────');
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    const icon = c.result === 'fail' ? '❌' : c.result === 'partial' ? '⚠️' : '✅';
    lines.push('');
    lines.push(`  [${i + 1}] ${icon} ${c.pipelineId}`);
    lines.push(`       Feature: ${c.feature}`);
    lines.push(`       Date:    ${c.date}`);
    lines.push(`       Result:  ${c.result}`);
    if (c.reason) lines.push(`       Reason:  ${c.reason}`);
    if (c.fix) lines.push(`       Fix:     ${c.fix}`);
    if (c.lesson) lines.push(`       Lesson:  ${c.lesson}`);
  }
  lines.push('');

  // Summary section
  if (failures > 0) {
    lines.push('  Common Failure Patterns:');
    const reasons = citations
      .filter(c => c.result === 'fail')
      .map(c => c.reason)
      .filter(Boolean);
    const uniqueReasons = [...new Set(reasons)];
    for (const reason of uniqueReasons.slice(0, 5)) {
      lines.push(`    • ${reason}`);
    }
    lines.push('');
  }

  console.log(lines.join('\n'));
}

function handleManifest(manifestPath: string): void {
  const index = readIndex();
  if (!index) {
    console.error('[citation-index] Index not found. Run --build first.');
    process.exit(2);
  }

  const resolvedPath = path.resolve(manifestPath);
  const manifest = readPlanManifest(resolvedPath);
  if (!manifest) {
    console.error(`[citation-index] Manifest not found or not parseable: ${resolvedPath}`);
    process.exit(3);
  }

  const allCps: ManifestCheckpoint[] = [
    ...(manifest.checkpoints || []),
  ];
  if (manifest.phases) {
    for (const phase of manifest.phases) {
      if (phase.checkpoints) {
        allCps.push(...phase.checkpoints);
      }
    }
  }

  if (allCps.length === 0) {
    console.log('No checkpoints found in the manifest.');
    process.exit(1);
  }

  const lines: string[] = [];
  lines.push(`Manifest Citation Report`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push('');
  lines.push(`  Manifest: ${resolvedPath}`);
  lines.push(`  Feature:  ${manifest.feature || '(not specified)'}`);
  lines.push(`  Checkpoints in manifest: ${allCps.length}`);
  lines.push('');

  let hasAnyCitation = false;

  for (const cp of allCps) {
    const citations = index.checkpoints[cp.id];
    const count = citations ? citations.length : 0;
    const failures = citations ? citations.filter(c => c.result === 'fail').length : 0;
    const icon = count === 0 ? '○' : failures > 0 ? '❌' : '✅';

    lines.push(`  ${icon} ${cp.id}: ${cp.description || '(no description)'} — ${cp.step}`);

    if (count > 0) {
      hasAnyCitation = true;
      lines.push(`       Citations: ${count} | Failures: ${failures} (${((failures / count) * 100).toFixed(1)}%)`);

      // Show the most recent failure if any
      const recentFailures = citations!
        .filter(c => c.result === 'fail')
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 2);

      for (const rf of recentFailures) {
        lines.push(`       ❌ ${rf.date} — ${rf.feature}: ${rf.reason.substring(0, 100)}`);
        if (rf.fix) lines.push(`          Fix: ${rf.fix.substring(0, 80)}`);
      }
    } else {
      lines.push('       No past citations found.');
    }
    lines.push('');
  }

  if (!hasAnyCitation) {
    lines.push('  ⚠️  None of the checkpoints in this manifest have past citations.');
    lines.push('     This is normal for new checkpoints created for this feature.');
    lines.push('');
  }

  console.log(lines.join('\n'));

  if (!hasAnyCitation) {
    process.exit(1);
  }
}

function handleFeature(feature: string): void {
  const index = readIndex();
  if (!index) {
    console.error('[citation-index] Index not found. Run --build first.');
    process.exit(2);
  }

  const normalizedQuery = feature.toLowerCase().replace(/[-_\s]+/g, '');

  // Find all citations whose feature matches
  const matchingCitations: Array<{ cpId: string; citation: CheckpointCitation }> = [];

  for (const [cpId, citations] of Object.entries(index.checkpoints)) {
    for (const citation of citations) {
      const citationFeature = citation.feature.toLowerCase().replace(/[-_\s]+/g, '');
      if (citationFeature === normalizedQuery || citationFeature.includes(normalizedQuery) || normalizedQuery.includes(citationFeature)) {
        matchingCitations.push({ cpId, citation });
      }
    }
  }

  if (matchingCitations.length === 0) {
    console.log(`No citations found for feature "${feature}"`);
    process.exit(1);
  }

  const lines: string[] = [];
  lines.push(`Feature Citation Report: ${feature}`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push('');
  lines.push(`  Total citations: ${matchingCitations.length}`);
  lines.push(`  Affected checkpoints: ${new Set(matchingCitations.map(m => m.cpId)).size}`);
  lines.push('');

  // Group by checkpoint
  const byCheckpoint: Record<string, typeof matchingCitations> = {};
  for (const mc of matchingCitations) {
    if (!byCheckpoint[mc.cpId]) byCheckpoint[mc.cpId] = [];
    byCheckpoint[mc.cpId].push(mc);
  }

  for (const [cpId, citations] of Object.entries(byCheckpoint).sort()) {
    const failures = citations.filter(c => c.citation.result === 'fail').length;
    const total = citations.length;
    const icon = failures > 0 ? '❌' : '✅';

    lines.push(`  ${icon} ${cpId} — ${failures}/${total} failures`);
    lines.push(`     Recent: ${citations.slice(-3).map(c => `${c.citation.date} (${c.citation.result})`).join(', ')}`);
    lines.push('');
  }

  // Extract key lessons for this feature
  const allLessons = matchingCitations
    .map(mc => mc.citation.lesson)
    .filter(Boolean);

  if (allLessons.length > 0) {
    lines.push('  Lessons from past pipelines:');
    const uniqueLessons = [...new Set(allLessons)];
    for (const lesson of uniqueLessons.slice(0, 5)) {
      lines.push(`    • ${lesson}`);
    }
    lines.push('');
  }

  console.log(lines.join('\n'));
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
  const { mode, value } = parseArgs();

  switch (mode) {
    case 'build':
      handleBuild();
      break;
    case 'rebuild':
      handleRebuild();
      break;
    case 'stats':
      handleStats();
      break;
    case 'checkpoint':
      handleCheckpoint(value!);
      break;
    case 'manifest':
      handleManifest(value!);
      break;
    case 'feature':
      handleFeature(value!);
      break;
    default:
      console.error(`[citation-index] Unknown mode: ${mode}`);
      process.exit(1);
  }
}

if (require.main === module) {
  main();
}
