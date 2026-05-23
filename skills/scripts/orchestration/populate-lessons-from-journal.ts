#!/usr/bin/env node
/**
 * Populate Lessons From Journal
 *
 * Reads the project journal at .opencode/journal/journal.yaml, extracts
 * lessonsLearned from each journal entry's retrospective field, and writes
 * them to .opencode/lessons/learned.yaml.
 *
 * Usage:
 *   [runtime] populate-lessons-from-journal.ts
 *
 * Exit codes:
 *   0 = Success (lessons populated/appended)
 *   1 = Error
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JournalEntry {
  date: string;
  feature: string;
  pipelineType?: string;
  result?: string;
  durationMinutes?: number;
  filesChanged?: string[];
  keyDecisions?: string[];
  circuitBreakerEvents?: Array<{ gate: string; attempts: number; resolution: string }>;
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

interface LessonsEntry {
  date: string;
  lesson: string;
  sourceFeature: string;
  category: string;  // 'plan' | 'implementation' | 'qa' | 'process' | 'tooling' | 'communication'
  severity: string;  // 'high' | 'medium' | 'low'
  injected: boolean;
}

interface ExistingLesson {
  date: string;
  lesson: string;
  sourceFeature: string;
  category?: string;
  severity?: string;
  injected?: boolean;
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function getRootDir(): string {
  // Try multiple strategies to find the project root
  const possibleRoots = [
    '/home/oat/.config/opencode',                       // WSL absolute path (most reliable)
    process.cwd(),                                      // Current working directory
    path.resolve(__dirname, '..', '..', '..'),          // skills/scripts/orchestration/ -> root
  ];

  for (const root of possibleRoots) {
    const testPath = path.join(root, '.opencode');
    if (fs.existsSync(testPath) && fs.existsSync(path.join(testPath, 'journal'))) {
      return root;
    }
  }

  // Last resort
  return '/home/oat/.config/opencode';
}

function getJournalPath(rootDir: string): string {
  return path.join(rootDir, '.opencode', 'journal', 'journal.yaml');
}

function getLessonsPath(rootDir: string): string {
  return path.join(rootDir, '.opencode', 'lessons', 'learned.yaml');
}

// ---------------------------------------------------------------------------
// YAML parser for journal.yaml format
// Handles: top-level list entries "- key: value", scalar arrays, object
// arrays, and nested objects (e.g., retrospective.handoffQuality.rating).
// Uses indent-based nesting (2 spaces per level).
// ---------------------------------------------------------------------------

function parseJournalYaml(filePath: string): JournalEntry[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const entries: JournalEntry[] = [];

  // Helper to parse a raw value from YAML
  function parseValue(raw: string): any {
    const t = raw.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    if (/^\d+\.\d+$/.test(t)) return parseFloat(t);
    return t;
  }

  // Set a value at a nested path within an object
  function setAtPath(obj: any, pathArr: string[], key: string, value: any): void {
    let cur = obj;
    for (const seg of pathArr) {
      if (!cur[seg] || typeof cur[seg] !== 'object') cur[seg] = {};
      cur = cur[seg];
    }
    cur[key] = value;
  }

  // Add a value to an array at a nested path within an object
  function addToArrayAtPath(obj: any, pathArr: string[], arrKey: string, value: any): void {
    let cur = obj;
    for (const seg of pathArr) {
      if (!cur[seg] || typeof cur[seg] !== 'object') cur[seg] = {};
      cur = cur[seg];
    }
    if (!cur[arrKey]) cur[arrKey] = [];
    cur[arrKey].push(value);
  }

  let currentEntry: any = null;
  let currentPath: string[] = [];  // Stack of keys for nesting

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = line.search(/\S/);

    // New entry: "- key: value" at indent 0 (e.g. "- date: \"2026-...\"")
    const entryMatch = trimmed.match(/^-\s+(\w[\w-]*):\s*(.*)/);
    if (entryMatch && indent === 0) {
      if (currentEntry) entries.push(currentEntry);
      currentEntry = { [entryMatch[1]]: parseValue(entryMatch[2]) };
      currentPath = [];
      continue;
    }

    if (!currentEntry) continue;

    // Calculate depth within this entry
    // indent 2 → level 0, indent 4 → level 1, indent 6 → level 2, etc.
    const entryRelativeDepth = indent >= 2 ? Math.floor((indent - 2) / 2) : 0;

    // Adjust path stack: pop until we match the current depth
    while (currentPath.length > entryRelativeDepth && currentPath.length > 0) {
      currentPath.pop();
    }

    // Object list item: "- key: value" INSIDE a parent context (deeper indent)
    // e.g. inside agentPerformance: "- role: \"implementor\""
    const objListItemMatch = trimmed.match(/^-\s+(\w[\w-]*):\s*(.*)/);
    if (objListItemMatch && indent > 2) {
      const key = objListItemMatch[1];
      const val = parseValue(objListItemMatch[2]);
      // The parent key is the last segment of currentPath
      const parentArrKey = currentPath.length > 0 ? currentPath[currentPath.length - 1] : null;

      if (parentArrKey) {
        // Navigate to parent container
        let cur = currentEntry;
        for (let i = 0; i < currentPath.length - 1; i++) {
          if (!cur[currentPath[i]] || typeof cur[currentPath[i]] !== 'object') cur[currentPath[i]] = {};
          cur = cur[currentPath[i]];
        }
        if (!cur[parentArrKey]) cur[parentArrKey] = [];

        // Find or create object item
        const lastItem = cur[parentArrKey].length > 0 ? cur[parentArrKey][cur[parentArrKey].length - 1] : null;
        if (lastItem && typeof lastItem === 'object' && lastItem[key] === undefined && Object.keys(lastItem).length > 0) {
          // Extend existing item with sub-properties (e.g. "effectiveness" after "role")
          lastItem[key] = val;
        } else {
          // Create new object
          const newItem: any = {};
          newItem[key] = val;
          cur[parentArrKey].push(newItem);
        }
      }
      continue;
    }

    // Scalar list item: "- value" (e.g., filesChanged entries, lessonsLearned items)
    const scalarListItemMatch = trimmed.match(/^-\s+(.+)/);
    if (scalarListItemMatch) {
      const val = parseValue(scalarListItemMatch[1]);
      if (currentPath.length > 0) {
        const arrKey = currentPath[currentPath.length - 1];
        addToArrayAtPath(currentEntry, currentPath.slice(0, -1), arrKey, val);
      }
      continue;
    }

    // Simple key:value OR scope starter
    const kvMatch = trimmed.match(/^(\w[\w-]*):\s*(.*)/);
    if (kvMatch) {
      const key = kvMatch[1];
      const rawValue = kvMatch[2].trim();

      if (rawValue === '' || rawValue === '|') {
        // This key starts a new nested section (object or array)
        currentPath.push(key);
      } else if (rawValue === '[]') {
        // Empty array
        setAtPath(currentEntry, currentPath, key, []);
      } else if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
        // Inline array like "issues: [\"text1\", \"text2\"]"
        const inner = rawValue.substring(1, rawValue.length - 1);
        const items = inner.split(',').map((s: string) => parseValue(s));
        setAtPath(currentEntry, currentPath, key, items);
      } else {
        // Simple value assignment
        setAtPath(currentEntry, currentPath, key, parseValue(rawValue));
      }
    }
  }

  if (currentEntry) entries.push(currentEntry);
  return entries;
}

// ---------------------------------------------------------------------------
// Read existing lessons from learned.yaml
// ---------------------------------------------------------------------------

function readExistingLessons(filePath: string): ExistingLesson[] {
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const lessons: ExistingLesson[] = [];
  let currentLesson: any = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed === '' || trimmed === 'lessons: []') continue;

    // Detect start of a lesson entry: "- date: ..."
    const entryStart = trimmed.match(/^-\s+date:\s*"?([^"]+)"?/);
    if (entryStart) {
      if (currentLesson && currentLesson.lesson) {
        lessons.push(currentLesson);
      }
      currentLesson = { date: entryStart[1] };
      continue;
    }

    if (currentLesson) {
      const kvMatch = trimmed.match(/^(\w+):\s*"?([^"]*)"?$/);
      if (kvMatch) {
        currentLesson[kvMatch[1]] = kvMatch[2];
      }
    }
  }
  if (currentLesson && currentLesson.lesson) {
    lessons.push(currentLesson);
  }

  return lessons;
}

// ---------------------------------------------------------------------------
// Lesson categorization
// ---------------------------------------------------------------------------

function categorizeLesson(lesson: string): string {
  const lower = lesson.toLowerCase();
  if (/plan|manifest|checkpoint/.test(lower)) return 'plan';
  if (/test|qa|coverage|unreferenced|verified/.test(lower)) return 'qa';
  if (/implement|code|error|rewrite|edit|surgical/.test(lower)) return 'implementation';
  if (/pipeline|process|handoff/.test(lower)) return 'process';
  if (/tooling|tool|circuit|breaker/.test(lower)) return 'tooling';
  if (/communicat|handoff|context/.test(lower)) return 'communication';
  return 'process';
}

// ---------------------------------------------------------------------------
// Duplicate check
// ---------------------------------------------------------------------------

function isDuplicate(existing: ExistingLesson[], lesson: string, sourceFeature: string): boolean {
  return existing.some(e => e.lesson === lesson && e.sourceFeature === sourceFeature);
}

// ---------------------------------------------------------------------------
// Build lessons YAML
// ---------------------------------------------------------------------------

function buildLessonsHeader(): string {
  const lines: string[] = [
    '# Lessons Learned Database',
    '# Auto-populated by populate-lessons-from-journal.ts and pipeline-teardown.ts',
    '# Injected into PlanDescriber and Implementor hand-offs by the Orchestrator',
    '# for cross-pipeline learning.',
    '#',
    '# Schema:',
    '#   - date: ISO-8601 timestamp',
    '#     lesson: The lesson learned (actionable)',
    '#     sourceFeature: The feature that produced this lesson',
    '#     category: plan | implementation | qa | process | tooling | communication',
    '#     severity: high | medium | low',
    '#     injected: true | false',
    '',
  ];
  return lines.join('\n');
}

function buildLessonYaml(entry: LessonsEntry): string {
  const lines: string[] = [];
  lines.push(`- date: "${entry.date}"`);
  lines.push(`  lesson: "${entry.lesson.replace(/"/g, '\\"')}"`);
  lines.push(`  sourceFeature: "${entry.sourceFeature}"`);
  lines.push(`  category: "${entry.category}"`);
  lines.push(`  severity: "${entry.severity}"`);
  lines.push(`  injected: ${entry.injected}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const rootDir = getRootDir();
  const journalPath = getJournalPath(rootDir);
  const lessonsPath = getLessonsPath(rootDir);

  // 1. Parse journal entries
  const entries = parseJournalYaml(journalPath);
  if (entries.length === 0) {
    console.log(`⚠️  No journal entries found at ${path.relative(rootDir, journalPath)} (cwd: ${process.cwd()})`);
    process.exit(0);
  }

  // 2. Read existing lessons
  const existingLessons = readExistingLessons(lessonsPath);

  // 3. Extract new lessons from journal entries
  const newLessons: LessonsEntry[] = [];

  for (const entry of entries) {
    const retro = entry.retrospective;
    if (!retro || !Array.isArray(retro.lessonsLearned) || retro.lessonsLearned.length === 0) {
      continue;
    }

    const entryDate = entry.date;
    const sourceFeature = entry.feature || 'unknown';

    for (const lessonText of retro.lessonsLearned) {
      if (!lessonText || typeof lessonText !== 'string') continue;

      // Skip duplicates
      if (isDuplicate(existingLessons, lessonText, sourceFeature)) {
        continue;
      }

      const category = categorizeLesson(lessonText);

      newLessons.push({
        date: entryDate,
        lesson: lessonText,
        sourceFeature,
        category,
        severity: 'medium',
        injected: false,
      });
    }
  }

  // 4. If no new lessons, report and exit
  if (newLessons.length === 0) {
    const entryCount = entries.filter(e => e.retrospective && Array.isArray(e.retrospective.lessonsLearned) && e.retrospective.lessonsLearned.length > 0).length;
    console.log(`Added 0 new lessons from ${entryCount} journal entries (all duplicates or none found)`);
    process.exit(0);
  }

  // 5. Append to lessons file
  const lessonsDir = path.dirname(lessonsPath);
  if (!fs.existsSync(lessonsDir)) {
    fs.mkdirSync(lessonsDir, { recursive: true });
  }

  // Create file with header if it doesn't exist
  if (!fs.existsSync(lessonsPath)) {
    fs.writeFileSync(lessonsPath, buildLessonsHeader(), 'utf-8');
  }

  // Append new lessons (with a blank line separator if file has content)
  const fileContent = fs.readFileSync(lessonsPath, 'utf-8');
  const separator = fileContent.trimEnd().length > 0 ? '\n' : '';
  const yamlContent = newLessons.map(l => buildLessonYaml(l)).join('\n');
  fs.appendFileSync(lessonsPath, separator + yamlContent + '\n', 'utf-8');

  // 6. Print summary
  const entryCount = entries.filter(e => e.retrospective && Array.isArray(e.retrospective.lessonsLearned) && e.retrospective.lessonsLearned.length > 0).length;
  console.log(`Added ${newLessons.length} new lessons from ${entryCount} journal entries`);

  process.exit(0);
}

main();
