#!/usr/bin/env node
/**
 * Pipeline Initialization Script
 *
 * Creates agent-context.md with initial YAML frontmatter, performs pre-flight
 * checks (git status, build compilation, stale context detection), and reads
 * the project journal for cross-session learning.
 *
 * Usage:
 *   pipeline-init.ts --feature=<name> --pipeline-type=<type> \
 *     [--pipeline-complexity=simple|moderate|complex] [--confidence=<0-100>]
 *
 * Exit codes:
 *   0 = Success
 *   1 = Error
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PipelineArgs {
  feature: string;
  pipelineType: string;
  pipelineComplexity: 'simple' | 'moderate' | 'complex';
  confidence: number;
  skipReadiness: boolean;
  forceClean: boolean;
}

interface JournalEntry {
  date: string;
  feature: string;
  pipelineType: string;
  result: string;
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

interface PreFlightReport {
  branch: string;
  lastCommitSha: string;
  lastCommitMessage: string;
  dirtyFiles: string[];
  projectCompiles: boolean;
  buildOutput: string;
  journalStructureOk: boolean;
  securityToolsOk: boolean;
  staleContextFound: boolean;
  staleContextStatus?: string;
  staleContextAge?: string;
}

interface MatchResult {
  entry: JournalEntry;
  similarity: number;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function generateUuid(): string {
  return `pipeline-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

function isoNow(): string {
  return new Date().toISOString();
}

function getScriptRunner(): string {
  // Language-agnostic: use process.argv[0] (the runtime that started this script).
  // Works with node, python3, deno, bun, and any runtime.
  if (process.argv[0]) {
    return process.argv[0];
  }
  return 'node'; // ultimate fallback
}

function execSafe(command: string, timeout = 30000): { stdout: string; stderr: string; exitCode: number } {
  try {
    const result = execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
      shell: true,});
    return { stdout: result.trim(), stderr: '', exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout ? err.stdout.toString().trim() : '',
      stderr: err.stderr ? err.stderr.toString().trim() : err.message || String(err),
      exitCode: err.status ?? 1,
    };
  }
}

function parseArgs(): PipelineArgs {
  const args = process.argv.slice(2);

  const feature = args.find(a => a.startsWith('--feature='))?.split('=')[1];
  const pipelineType = args.find(a => a.startsWith('--pipeline-type='))?.split('=')[1];
  const complexityArg = args.find(a => a.startsWith('--pipeline-complexity='))?.split('=')[1];
  const confidenceArg = args.find(a => a.startsWith('--confidence='))?.split('=')[1];

  if (!feature) {
    console.error('âŒ Missing required argument: --feature=<name>');
    console.error('Usage: ' + process.argv[0] + ' pipeline-init.ts --feature=<name> --pipeline-type=<type> [--pipeline-complexity=simple|moderate|complex] [--confidence=<0-100>]');
    process.exit(1);
  }

  if (!pipelineType) {
    console.error('âŒ Missing required argument: --pipeline-type=<type>');
    console.error('Usage: ' + process.argv[0] + ' pipeline-init.ts --feature=<name> --pipeline-type=<type> [--pipeline-complexity=simple|moderate|complex] [--confidence=<0-100>]');
    process.exit(1);
  }

  const validComplexities = ['simple', 'moderate', 'complex'];
  const pipelineComplexity = (complexityArg && validComplexities.includes(complexityArg)
    ? complexityArg
    : 'moderate') as 'simple' | 'moderate' | 'complex';

  const confidenceRaw = confidenceArg ? parseInt(confidenceArg, 10) : 80;
  const confidence = isNaN(confidenceRaw) ? 80 : Math.max(0, Math.min(100, confidenceRaw));

  const skipReadiness = args.some(a => a === '--skip-readiness');
  const forceClean = args.some(a => a === '--force-clean');

  const validTypes = ['full', 'quick', 'fixer-only', 'parallel-feature', 'tdd', 'security-fix', 'ui-bug', 'documentation', 'micro-pipeline', 'refactor', 'research'];
  if (pipelineType && !validTypes.includes(pipelineType)) {
    console.warn(`âš ï¸  Unknown pipeline type "${pipelineType}". Valid types: ${validTypes.join(', ')}`);
    // Don't exit â€” let it proceed with the unknown type
  }

  return { feature, pipelineType, pipelineComplexity, confidence, skipReadiness, forceClean };
}

// ---------------------------------------------------------------------------
// Project Journal Parsing (line-by-line YAML)
// ---------------------------------------------------------------------------

function parseJournalLine(line: string): { indent: number; key: string; value: string | null } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const indent = line.search(/\S/);
  const colonIdx = trimmed.indexOf(':');

  if (colonIdx === -1) return null;

  const key = trimmed.substring(0, colonIdx).trim();
  const valueRaw = trimmed.substring(colonIdx + 1).trim();

  if (valueRaw === '' || valueRaw === '|' || valueRaw.startsWith('#')) {
    return { indent, key, value: null };
  }

  const value = valueRaw.replace(/\s*#.*$/, '').trim();
  // Remove surrounding quotes if present
  const cleaned = value.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  return { indent, key, value: cleaned };
}

function parseJournalYaml(filePath: string): JournalEntry[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const entries: JournalEntry[] = [];
  let currentEntry: any = null;
  let currentArrayKey: string | null = null;
  let currentArrayIndent: number = 0;
  let currentObjectKey: string | null = null;
  let currentObjectIndent: number = 0;
  let currentObjectArray: any[] = [];

  for (const line of lines) {
    const parsed = parseJournalLine(line);
    if (!parsed) continue;

    const { indent, key, value } = parsed;

    // Detect start of a new entry (top-level list item starting with "- date:")
    if (key === 'date' && value !== null && indent === 0) {
      if (currentEntry) {
        // Finalize nested object arrays
        if (currentObjectKey && currentObjectArray.length > 0) {
          currentEntry[currentObjectKey] = [...currentObjectArray];
          currentObjectArray = [];
          currentObjectKey = null;
        }
        if (currentArrayKey) {
          currentEntry[currentArrayKey] = currentEntry[currentArrayKey] || [];
          currentObjectArray = [];
          currentArrayKey = null;
        }
        entries.push(currentEntry);
      }
      currentEntry = { date: value };
      currentArrayKey = null;
      currentArrayIndent = 0;
      currentObjectKey = null;
      currentObjectIndent = 0;
      currentObjectArray = [];
      continue;
    }

    if (!currentEntry) continue;

    // Detect list items inside arrays
    const listMatch = line.trim().match(/^-\s+(.+):\s*(.*)/);
    if (listMatch && indent > 4) {
      // Object within array â€” check if we're inside a specific array
      const objKey = listMatch[1].trim();
      const objValue = listMatch[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');

      if (currentObjectKey) {
        // We're building an array of objects
        const obj: any = { [objKey]: objValue || null };
        currentObjectArray.push(obj);
      } else if (currentArrayKey) {
        // We're building a list of simple objects with different keys
        // Find the last object and add property
        if (currentObjectArray.length > 0) {
          const lastObj = currentObjectArray[currentObjectArray.length - 1];
          lastObj[objKey] = objValue || null;
        } else {
          const obj: any = { [objKey]: objValue || null };
          currentObjectArray.push(obj);
        }
      }

      // If at same indent level as parent list, continue the list
      continue;
    }

    // Scalar list item: "- value"
    const scalarListMatch = line.trim().match(/^-\s+(.+)/);
    if (scalarListMatch && currentArrayKey) {
      if (!currentEntry[currentArrayKey]) {
        currentEntry[currentArrayKey] = [];
      }
      (currentEntry[currentArrayKey] as string[]).push(
        scalarListMatch[1].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'),
      );
      continue;
    }

    // Regular key-value at entry level
    if (currentObjectKey && indent <= currentObjectIndent) {
      // Exiting nested object context
      if (currentObjectArray.length > 0) {
        currentEntry[currentObjectKey] = [...currentObjectArray];
        currentObjectArray = [];
      }
      currentObjectKey = null;
    }

    if (currentArrayKey && indent <= currentArrayIndent) {
      // Exiting array context
      currentArrayKey = null;
      currentObjectArray = [];
    }

    if (value === null) {
      // Might be an array or nested object starting
      // Check next non-empty line to determine
      // For now, track it
      const nextLineContent = getNextNonEmptyLine(lines, lines.indexOf(line) + 1);
      if (nextLineContent && nextLineContent.trimStart().startsWith('- ')) {
        currentArrayKey = key;
        currentArrayIndent = indent;
        currentEntry[key] = [];
        currentObjectArray = [];
      } else {
        // Nested object â€” store as is, parse sub-keys later
        currentEntry[key] = {};
        currentObjectKey = key;
        currentObjectIndent = indent;
      }
      continue;
    }

    // Handle nested key-value under currentObjectKey
    if (currentObjectKey && indent > currentObjectIndent) {
      const parent = currentEntry[currentObjectKey];
      if (typeof parent === 'object' && !Array.isArray(parent)) {
        const scalarListInObj = line.trim().match(/^-\s+(.+)/);
        if (scalarListInObj) {
          if (!parent[key]) {
            parent[key] = [];
          }
          (parent[key] as string[]).push(
            scalarListInObj[1].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'),
          );
        } else {
          parent[key] = convertValue(value);
        }
      }
      continue;
    }

    // Simple key-value
    currentEntry[key] = convertValue(value);
  }

  // Finalize last entry
  if (currentEntry) {
    if (currentObjectKey && currentObjectArray.length > 0) {
      currentEntry[currentObjectKey] = [...currentObjectArray];
    }
    entries.push(currentEntry);
  }

  return entries;
}

function getNextNonEmptyLine(lines: string[], startIdx: number): string | null {
  for (let i = startIdx; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed && !trimmed.startsWith('#')) {
      return lines[i];
    }
  }
  return null;
}

function convertValue(value: string): any {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  if (/^\d+\.\d+$/.test(value)) return parseFloat(value);
  return value;
}

// ---------------------------------------------------------------------------
// Fuzzy matching on feature names
// ---------------------------------------------------------------------------

function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[-_/\s]+/)
    .filter(t => t.length > 1);
}

function computeSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);

  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);

  const intersection = new Set([...setA].filter(t => setB.has(t)));
  const union = new Set([...setA, ...setB]);

  // Weight: Jaccard similarity, but give partial credit for substring matches
  let jaccard = intersection.size / union.size;

  // Bonus for exact string match
  if (a.toLowerCase() === b.toLowerCase()) {
    jaccard = Math.max(jaccard, 0.9);
  }

  // Bonus for one being substring of the other
  if (a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase())) {
    jaccard = Math.max(jaccard, 0.6);
  }

  return Math.round(jaccard * 100);
}

function findMatchingEntries(entries: JournalEntry[], feature: string, threshold = 30): MatchResult[] {
  const matches: MatchResult[] = [];

  for (const entry of entries) {
    const similarity = computeSimilarity(entry.feature, feature);
    if (similarity >= threshold) {
      matches.push({ entry, similarity });
    }
  }

  // Sort by similarity descending
  matches.sort((a, b) => b.similarity - a.similarity);
  return matches;
}

interface LessonEntry {
  date: string;
  lesson: string;
  sourceFeature: string;
  category: string;
}

interface CrossSessionLesson {
  lesson: string;
  sourceFeature: string;
  similarity: number;
}

/**
 * Read lessons from .opencode/lessons/learned.yaml and find those relevant
 * to the current feature using computeSimilarity().
 */
function readLessons(lessonsPath: string, currentFeature: string): CrossSessionLesson[] {
  if (!fs.existsSync(lessonsPath)) return [];

  const content = fs.readFileSync(lessonsPath, 'utf-8');
  const lines = content.split('\n');
  const lessons: LessonEntry[] = [];
  let currentLesson: any = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;

    const listMatch = trimmed.match(/^-\s+date:\s*"?([^"]+)"?/);
    if (listMatch) {
      if (currentLesson) lessons.push(currentLesson);
      currentLesson = { date: listMatch[1] };
      continue;
    }

    if (currentLesson) {
      const kvMatch = trimmed.match(/^(\w+):\s*"?([^"]*)"?$/);
      if (kvMatch) {
        currentLesson[kvMatch[1]] = kvMatch[2];
      }
    }
  }
  if (currentLesson) lessons.push(currentLesson);

  const results: CrossSessionLesson[] = [];
  for (const lesson of lessons) {
    if (!lesson.lesson || !lesson.sourceFeature) continue;
    const similarity = computeSimilarity(lesson.sourceFeature, currentFeature);
    if (similarity >= 30) {
      results.push({ lesson: lesson.lesson, sourceFeature: lesson.sourceFeature, similarity });
    }
  }

  return results.sort((a, b) => b.similarity - a.similarity);
}

// ---------------------------------------------------------------------------
// Pre-flight checks
// ---------------------------------------------------------------------------

function runPreFlight(): PreFlightReport {
  // Check git status
  const gitStatusResult = execSafe('git status --porcelain');
  const dirtyFiles = gitStatusResult.stdout
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => {
      // Format: "M  src/file.ext" or "?? newfile.ext"
      const parts = line.trim().split(/\s+/);
      return parts.length >= 2 ? parts.slice(1).join(' ') : line.trim();
    });

  // Check current branch
  const branchResult = execSafe('git rev-parse --abbrev-ref HEAD');
  const branch = branchResult.stdout || 'unknown';

  // Check last commit SHA
  const shaResult = execSafe('git rev-parse HEAD');
  const lastCommitSha = shaResult.stdout || 'unknown';

  // Check last commit message
  const msgResult = execSafe('git log -1 --format=%s');
  const lastCommitMessage = msgResult.stdout || 'unknown';

  // Check if project compiles
  // Build command is configurable via BUILD_COMMAND env var
  const buildCmd = process.env.BUILD_COMMAND || 'npm run build'; // Configurable via env var, defaults to npm
  const buildResult = execSafe(buildCmd + ' 2>/dev/null || true', 15000);
  const projectCompiles = buildResult.exitCode === 0;
  const buildOutput = buildResult.stderr || buildResult.stdout || '(no build output captured)';

  // Check journal structure
  const journalReadmePath = path.resolve('.opencode/journal/README.md');
  const journalStructureOk = fs.existsSync(journalReadmePath);

  const securityToolsOk = false; // security self-test removed (its tools are language-specific)

  // Check for stale agent-context.md
  const contextPath = path.resolve('agent-context.md');
  let staleContextFound = false;
  let staleContextStatus: string | undefined;
  let staleContextAge: string | undefined;

  if (fs.existsSync(contextPath)) {
    const contextContent = fs.readFileSync(contextPath, 'utf-8');
    const statusMatch = contextContent.match(/^status:\s*"?(running|active)"?/m);
    const createdAtMatch = contextContent.match(/^createdAt:\s*"?([^"\n]+)"?/m);

    if (statusMatch) {
      staleContextStatus = statusMatch[1];
      if (createdAtMatch) {
        const createdAt = new Date(createdAtMatch[1]);
        const now = new Date();
        const ageMs = now.getTime() - createdAt.getTime();
        const ageHours = ageMs / (1000 * 60 * 60);

        if (ageHours > 1) {
          staleContextFound = true;
          staleContextAge = `${ageHours.toFixed(1)} hours`;
        }
      }
    }
  }

  return {
    branch,
    lastCommitSha,
    lastCommitMessage,
    dirtyFiles,
    projectCompiles,
    buildOutput,
    journalStructureOk,
    securityToolsOk,
    staleContextFound,
    staleContextStatus,
    staleContextAge,
  };
}

// ---------------------------------------------------------------------------
// Pipeline log directory creation
// ---------------------------------------------------------------------------

function ensurePipelineLogsDir(): void {
  const logsDir = path.resolve('.opencode/pipeline-logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Agent-context.md generation
// ---------------------------------------------------------------------------

function generateAgentContext(args: PipelineArgs, preFlight: PreFlightReport): { content: string; pipelineId: string } {
  const pipelineId = generateUuid();
  const now = isoNow();

  const thresholds = {
    simple: 1,
    moderate: 2,
    complex: 3,
  };

  const complexityKey = args.pipelineComplexity;
  const currentThreshold = thresholds[complexityKey];

  // Read cross-session lessons
  const lessonsPath = path.resolve('.opencode/lessons/learned.yaml');
  const crossSessionLessons = readLessons(lessonsPath, args.feature);

  const lines: string[] = [];
  lines.push('---');
  lines.push(`pipelineId: "${pipelineId}"`);
  lines.push(`feature: "${args.feature}"`);
  lines.push(`pipelineType: "${args.pipelineType}"`);
  lines.push(`pipelineComplexity: "${args.pipelineComplexity}"`);
  lines.push(`pipelineConfidence: ${args.confidence}`);
  lines.push(`currentStep: "pre-flight"`);
  lines.push(`createdAt: "${now}"`);
  lines.push(`pipelineHeartbeat: "${now}"`);
  lines.push(`status: "running"`);
  lines.push('agentHistory: []');
  lines.push('agentOutputs: {}');
  lines.push('summaries: {}');
  lines.push('circuitBreaker:');
  lines.push('  state: "closed"');
  lines.push(`  complexity: "${args.pipelineComplexity}"`);
  lines.push('  thresholds:');
  lines.push(`    build: ${thresholds.simple}`);
  lines.push(`    lint: ${thresholds.simple}`);
  lines.push(`    securityScan: ${thresholds.simple}`);
  lines.push(`    smokeTest: ${thresholds.simple}`);
  lines.push(`    verifier: ${thresholds.simple}`);
  lines.push('  currentThresholds:');
  lines.push(`    build: ${currentThreshold}`);
  lines.push(`    lint: ${currentThreshold}`);
  lines.push(`    securityScan: ${currentThreshold}`);
  lines.push(`    smokeTest: ${currentThreshold}`);
  lines.push(`    verifier: ${currentThreshold}`);
  lines.push('  counters:');
  lines.push('    build: 0');
  lines.push('    lint: 0');
  lines.push('    securityScan: 0');
  lines.push('    smokeTest: 0');
  lines.push('    verifier: 0');
  lines.push('  patternDetection:');
  lines.push('    persistentDeviations: []');
  lines.push('    sameClassificationCounts: {}');
  lines.push('    autoEscalationTriggered: false');
  lines.push('gitState:');
  lines.push(`  branch: "${preFlight.branch}"`);
  lines.push('  dirtyFiles: []');
  lines.push(`  lastCommitSha: "${preFlight.lastCommitSha}"`);
  lines.push(`  lastCommitMessage: "${preFlight.lastCommitMessage.replace(/"/g, '\\"')}"`);
  lines.push('prePipelineGitState:');
  lines.push(`  branch: "${preFlight.branch}"`);
  lines.push(`  lastCommitSha: "${preFlight.lastCommitSha}"`);
  lines.push(`  lastCommitMessage: "${preFlight.lastCommitMessage.replace(/"/g, '\\"')}"`);
  if (preFlight.dirtyFiles.length > 0) {
    lines.push('  dirtyFiles:');
    for (const f of preFlight.dirtyFiles) {
      lines.push(`    - "${f.replace(/"/g, '\\"')}"`);
    }
  } else {
    lines.push('  dirtyFiles: []');
  }
  lines.push('  stashedChanges: false');
  lines.push('  stashedChangesList: []');
  if (crossSessionLessons.length > 0) {
    lines.push('crossSessionLessons:');
    for (const lesson of crossSessionLessons) {
      lines.push(`  - lesson: "${lesson.lesson.replace(/"/g, '\\"')}"`);
      lines.push(`    sourceFeature: "${lesson.sourceFeature}"`);
      lines.push(`    similarity: ${lesson.similarity}`);
    }
  }
  lines.push(`nextObjective: "Run pre-flight checks and begin pipeline"`);
  lines.push('---');
  lines.push('');
  lines.push('<!-- agent-context.md -->');
  lines.push('');
  lines.push('This file is managed by the Orchestrator. Do not edit manually.');
  lines.push('');

  return { content: lines.join('\n'), pipelineId };
}

// ---------------------------------------------------------------------------
// Summary report
// ---------------------------------------------------------------------------

function printSummary(
  args: PipelineArgs,
  preFlight: PreFlightReport,
  matches: MatchResult[],
): void {
  const separator = 'â”'.repeat(29 + args.feature.length + args.pipelineType.length);

  console.log(`ðŸ” Pipeline Init: ${args.feature} (${args.pipelineType})`);
  console.log(separator);
  console.log('');

  // Pre-flight section
  console.log('Pre-Flight:');

  if (preFlight.projectCompiles) {
    console.log('  âœ… Project compiles successfully');
  } else {
    console.log('  âŒ Project does not compile');
    console.log(`  â””â”€ Build output: ${preFlight.buildOutput.slice(0, 200)}`);
  }

  if (preFlight.dirtyFiles.length > 0) {
    console.log(`  âš ï¸  ${preFlight.dirtyFiles.length} dirty file(s) (${preFlight.dirtyFiles.join(', ')})`);
  } else {
    console.log('  âœ… No dirty files');
  }

  if (preFlight.staleContextFound) {
    console.log(`  âš ï¸  Stale context found (status: ${preFlight.staleContextStatus}, age: ${preFlight.staleContextAge})`);
  } else {
    console.log('  âœ… No stale context found');
  }

  if (preFlight.journalStructureOk) {
    console.log('  âœ… Journal structure OK');
  } else {
    console.log('  âš ï¸  Journal README.md not found â€” journal may not be initialized');
  }

  if (preFlight.securityToolsOk) {
    console.log('  âœ… Security self-test passed');
  } else {
    console.log('  âš ï¸  Security self-test failed');
  }

  console.log('');

  // Agent readiness section (if check ran)
  console.log('Agent Readiness:');
  // The readiness check runs in main() before printSummary, so the output is already shown
  console.log('  See above for agent readiness details');
  console.log('');

  // Cross-session learning section
  console.log('Cross-Session Learning:');

  if (matches.length === 0) {
    console.log('  ðŸ“– No past entries found matching this feature');
  } else {
    for (const match of matches) {
      const entry = match.entry;
      const failedGates = entry.failedGates && entry.failedGates.length > 0
        ? ` â€” failed gates: ${entry.failedGates.join(', ')}`
        : '';
      const cbEvents = entry.circuitBreakerEvents && entry.circuitBreakerEvents.length > 0
        ? ` â€” circuit breaker: ${entry.circuitBreakerEvents.map(e => `${e.gate} (${e.attempts} attempts, ${e.resolution})`).join(', ')}`
        : '';

      console.log(`  ðŸ“– Found past entry matching "${entry.feature}" (${match.similarity}% similar):`);
      console.log(`     - Result: ${entry.result}${failedGates}${cbEvents}`);

      if (entry.notes) {
        console.log(`     - Notes: ${entry.notes}`);
      }

      if (entry.retrospective) {
        const retro = entry.retrospective;
        if (retro.lessonsLearned && retro.lessonsLearned.length > 0) {
          for (const lesson of retro.lessonsLearned) {
            console.log(`     - Lesson: ${lesson}`);
          }
        }
        if (retro.improvementsForNextPipeline && retro.improvementsForNextPipeline.length > 0) {
          for (const impr of retro.improvementsForNextPipeline) {
            console.log(`     - Improvement: ${impr}`);
          }
        }
      }
    }
  }

  console.log('');

  // Module familiarity scores
  console.log('Module Familiarity:');
  const coreModules = ['src/', 'src/services/', 'src/controllers/', 'src/models/', 'src/utils/'];
  for (const mod of coreModules) {
    if (fs.existsSync(path.resolve(mod))) {
      const score = computeFamiliarityScore(mod);
      console.log(`  ${mod}: ${score}/10`);
    }
  }

  console.log('');

  // Created section
  console.log('Created:');
  console.log('  âœ… agent-context.md');
  console.log('  âœ… .opencode/pipeline-logs/');

  console.log('');
  console.log(`Ready to proceed. Next: Run pre-flight checks and begin pipeline`);
}

/**
 * Compute a familiarity score (1-10) for a module based on git activity and test coverage.
 * 1-4: Unknown/new module (< 5 commits, no tests)
 * 5-7: Moderate activity (5-20 commits, some tests)
 * 8-10: Well-known (20+ commits, test file exists)
 */
function computeFamiliarityScore(modulePath: string): number {
  let score = 1;

  // Check git commit frequency
  const gitResult = execSafe(`git log --oneline --follow "${modulePath}" 2>/dev/null | wc -l`);
  const commitCount = parseInt(gitResult.stdout, 10) || 0;

  if (commitCount >= 20) score += 6;
  else if (commitCount >= 5) score += 3;
  else if (commitCount >= 1) score += 1;

  // Check if test file exists
  const ext = path.extname(modulePath);
  const base = ext ? modulePath.slice(0, -ext.length) : modulePath;
  const testFiles = [
    base + '.test' + ext,
    base + '.spec' + ext,
    `tests/${base}.test${ext}`,
    `__tests__/${path.basename(base)}.test${ext}`,
  ];

  for (const testFile of testFiles) {
    if (fs.existsSync(path.resolve(testFile))) {
      score += 3;
      break;
    }
  }

  return Math.min(10, Math.max(1, score));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs();

  // 1. Read journal for cross-session learning
  const journalPath = path.resolve('.opencode/journal/journal.yaml');
  const entries = parseJournalYaml(journalPath);
  const matches = findMatchingEntries(entries, args.feature);

  // 2. Run pre-flight checks
  const preFlight = runPreFlight();

  // 2a. Stale pipeline detection â€” exit code 2 if stale context found (unless --force-clean)
  if (preFlight.staleContextFound) {
    if (args.forceClean) {
      // Archive stale context automatically
      const stalePipelineId = generateUuid();
      const staleDir = path.resolve(`.opencode/pipeline-logs/stale-${stalePipelineId}/`);
      if (!fs.existsSync(staleDir)) {
        fs.mkdirSync(staleDir, { recursive: true });
      }
      const contextPathStale = path.resolve('agent-context.md');
      if (fs.existsSync(contextPathStale)) {
        fs.renameSync(contextPathStale, path.join(staleDir, 'agent-context.md'));
      }
      console.log(`  âœ… Archived stale agent-context.md to .opencode/pipeline-logs/stale-${stalePipelineId}/`);
    } else {
      console.log('');
      console.log('âš ï¸  STALE PIPELINE DETECTED');
      console.log('â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”');
      console.log(`An agent-context.md exists with status: ${preFlight.staleContextStatus}, age: ${preFlight.staleContextAge}`);
      console.log('This may be an abandoned pipeline from a previous session.');
      console.log('');
      console.log('To proceed, you need to either:');
      console.log('  1. Run with --force-clean to auto-archive');
      console.log('  2. Archive it: mv agent-context.md .opencode/pipeline-logs/stale-<pipelineId>/');
      console.log('  3. Delete it: rm agent-context.md');
      console.log('');
      console.log('After cleanup, re-run pipeline-init.ts.');
      process.exit(2);
    }
  }

  // 2b. Agent readiness check â€” verify required agents have correct permissions
  if (args.pipelineType !== 'documentation' && !args.skipReadiness) {
    const readinessResult = execSafe(
      `${getScriptRunner()} skills/scripts/orchestration/check-agent-readiness.ts --pipeline-type=${args.pipelineType} 2>&1`,
      15000,
    );
    
    if (readinessResult.exitCode !== 0) {
      console.log('');
      console.log('âš ï¸  AGENT READINESS CHECK FAILED');
      console.log('â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”');
      console.log(readinessResult.stderr || readinessResult.stdout);
      console.log('');
      console.log('Some agents required for this pipeline are not properly configured.');
      console.log('Run the check manually for details:');
      console.log(`  ${getScriptRunner()} skills/scripts/orchestration/check-agent-readiness.ts --pipeline-type=${args.pipelineType}`);
      console.log('');
      console.log('To fix: Ensure all required agent config files exist with correct permissions.');
      process.exit(3);
    }
    
    // Parse the readiness output and log agent statuses
    const readinessOutput = readinessResult.stdout || readinessResult.stderr || '';
    if (readinessOutput.length > 0) {
      console.log(readinessOutput);
    }
  }

  // 3. Ensure pipeline logs directory
  ensurePipelineLogsDir();

  // 4. Create agent-context.md
  const { content: contextContent, pipelineId } = generateAgentContext(args, preFlight);
  const contextPath = path.resolve('agent-context.md');
  fs.writeFileSync(contextPath, contextContent, 'utf-8');

  // 4a. Initialize audit log (non-fatal â€” warning only on failure)
  const tsNodeBin = getScriptRunner();
  const auditLogScript = path.resolve(__dirname, 'audit-log.ts');
  const auditLogResult = execSafe(
    `"${tsNodeBin}" "${auditLogScript}" init --pipeline-id="${pipelineId}" --feature="${args.feature}"`,
    15000,
  );
  if (auditLogResult.exitCode !== 0) {
    console.log(`  âš ï¸ Audit log init skipped: ${(auditLogResult.stderr || auditLogResult.stdout).substring(0, 100)}`);
  } else {
    console.log('  âœ… Audit log initialized');
  }

  // 5. Print summary report
  printSummary(args, preFlight, matches);

  process.exit(0);
}

main();
