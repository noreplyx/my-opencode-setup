#!/usr/bin/env ts-node
/**
 * Pipeline Teardown & Finalization
 *
 * Handles the complete teardown and finalization of a pipeline run:
 *   - Writes journal entry to .opencode/journal/journal.yaml
 *   - Updates calibration database via update-calibration.ts
 *   - Archives agent-context.md raw outputs to .opencode/pipeline-logs/
 *   - Records retrospective (auto-generated from data)
 *   - Appends lessons to .opencode/lessons/learned.yaml
 *
 * Usage:
 *   ts-node pipeline-teardown.ts --feature=<name> --pipeline-type=<type> --result=pass|fail|partial
 *     [--duration-minutes=<N>] [--files-changed=<file1,file2,...>]
 *     [--failed-gates=<gate1,gate2,...>] [--circuit-breaker-events=<json>]
 *     [--keep-context]
 *
 * Exit codes:
 *   0 = Teardown complete
 *   1 = Error
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CliArgs {
  feature: string;
  pipelineType: string;
  result: 'pass' | 'fail' | 'partial';
  durationMinutes: number;
  filesChanged: string[];
  failedGates: string[];
  circuitBreakerEvents: CircuitBreakerEvent[];
  keepContext: boolean;
  evidenceScan: boolean;
}

interface CircuitBreakerEvent {
  gate: string;
  attempts: number;
  resolution: string;
}

interface AgentContextData {
  pipelineId: string;
  feature: string;
  pipelineType: string;
  createdAt: string;
  circuitBreaker: {
    counters: Record<string, number>;
    state: string;
    patternDetection: string[];
  };
  agentHistory: AgentHistoryEntry[];
  failureSummary: string | null;
  agentOutputs: Record<string, any>;
}

interface AgentHistoryEntry {
  step: number;
  agent: string;
  result: string;
  duration?: number;
  decisions: string[];
  warnings: string[];
  output?: string;
}

interface Retrospective {
  pipelineQuality: 'smooth' | 'rough' | 'failed';
  handoffQuality: {
    rating: number;
    issues: string[];
  };
  agentPerformance: AgentPerformanceEntry[];
  wastedSteps: string[];
  improvementsForNextPipeline: string[];
  lessonsLearned: string[];
}

interface AgentPerformanceEntry {
  role: string;
  effectiveness: 'good' | 'ok' | 'poor';
  notes: string;
}

interface JournalEntry {
  date: string;
  feature: string;
  pipelineType: string;
  result: string;
  durationMinutes: number;
  filesChanged: string[];
  keyDecisions: string[];
  circuitBreakerEvents: CircuitBreakerEvent[];
  failedGates: string[];
  retrospective?: Retrospective;
}

interface LessonsEntry {
  date: string;
  lesson: string;
  sourceFeature: string;
  category: string;  // 'plan' | 'implementation' | 'qa' | 'process' | 'tooling' | 'communication'
  severity: string;  // 'high' | 'medium' | 'low'
  injected: boolean;  // Whether this has been injected into a subsequent pipeline
}

// ---------------------------------------------------------------------------
// Evidence types
// ---------------------------------------------------------------------------

interface EvidenceStalenessEntry {
  agent: string;
  claim: string;
  source: string;
  method: string;
  status: 'valid' | 'stale' | 'file_deleted' | 'unverifiable';
  originalHash: string | null;
  currentHash: string | null;
}

interface EvidenceStalenessReport {
  total: number;
  valid: number;
  stale: number;
  fileDeleted: number;
  unverifiable: number;
  entries: EvidenceStalenessEntry[];
}

interface EvidenceQualityMetrics {
  totalEvidence: number;
  withContentHash: number;
  withExactLines: number;
  withVerifiableMethod: number;
  avgCompleteness: number;      // % of all fields present
  avgPrecision: number;         // % with exact line numbers
  avgVerifiability: number;     // % with verifiable method
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function getRootDir(): string {
  // skills/scripts/orchestration/ -> root
  return path.resolve(__dirname, '..', '..', '..', '..');
}

function getAgentContextPath(rootDir: string): string {
  return path.join(rootDir, 'agent-context.md');
}

function getJournalPath(rootDir: string): string {
  return path.join(rootDir, '.opencode', 'journal', 'journal.yaml');
}

function getLessonsPath(rootDir: string): string {
  return path.join(rootDir, '.opencode', 'lessons', 'learned.yaml');
}

function getCalibrationScriptPath(): string {
  return path.join(__dirname, 'update-calibration.ts');
}

function getPipelineLogsDir(rootDir: string): string {
  return path.join(rootDir, '.opencode', 'pipeline-logs');
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  const result: CliArgs = {
    feature: '',
    pipelineType: '',
    result: 'pass',
    durationMinutes: 0,
    filesChanged: [],
    failedGates: [],
    circuitBreakerEvents: [],
    keepContext: false,
    evidenceScan: true,
  };

  for (const arg of args) {
    if (arg === '--keep-context') {
      result.keepContext = true;
      continue;
    }

    if (arg === '--no-evidence-scan') {
      result.evidenceScan = false;
      continue;
    }

    const eqIndex = arg.indexOf('=');
    if (eqIndex === -1) {
      console.error(`❌ Invalid argument: ${arg}`);
      process.exit(1);
    }

    const key = arg.substring(0, eqIndex);
    const value = arg.substring(eqIndex + 1);

    switch (key) {
      case '--feature':
        result.feature = value;
        break;
      case '--pipeline-type':
        result.pipelineType = value;
        break;
      case '--result':
        if (!['pass', 'fail', 'partial'].includes(value)) {
          console.error(`❌ --result must be "pass", "fail", or "partial", got "${value}"`);
          process.exit(1);
        }
        result.result = value as 'pass' | 'fail' | 'partial';
        break;
      case '--duration-minutes':
        result.durationMinutes = parseInt(value, 10);
        if (isNaN(result.durationMinutes) || result.durationMinutes < 0) {
          console.error(`❌ --duration-minutes must be a non-negative integer, got "${value}"`);
          process.exit(1);
        }
        break;
      case '--files-changed':
        result.filesChanged = value ? value.split(',').map(f => f.trim()).filter(Boolean) : [];
        break;
      case '--failed-gates':
        result.failedGates = value ? value.split(',').map(g => g.trim()).filter(Boolean) : [];
        break;
      case '--circuit-breaker-events':
        try {
          result.circuitBreakerEvents = value ? JSON.parse(value) : [];
        } catch {
          console.error(`❌ --circuit-breaker-events must be valid JSON, got "${value}"`);
          process.exit(1);
        }
        break;
      case '--evidence-scan':
        if (value === 'false' || value === '0' || value === 'no') {
          result.evidenceScan = false;
        } else {
          result.evidenceScan = true;
        }
        break;
      default:
        console.error(`❌ Unknown argument: ${key}`);
        process.exit(1);
    }
  }

  if (!result.feature) {
    console.error('❌ --feature is required');
    console.error('');
    console.error('Usage:');
    console.error('  ts-node pipeline-teardown.ts --feature=<name> --pipeline-type=<type> --result=pass|fail|partial [options]');
    process.exit(1);
  }

  if (!result.pipelineType) {
    console.error('❌ --pipeline-type is required');
    process.exit(1);
  }

  return result;
}

// ---------------------------------------------------------------------------
// agent-context.md parser (YAML frontmatter + body, no external deps)
// ---------------------------------------------------------------------------

function parseAgentContext(filePath: string): AgentContextData | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = fs.readFileSync(filePath, 'utf-8');

  // Extract YAML frontmatter between --- markers
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!frontmatterMatch) {
    return null;
  }

  const yamlContent = frontmatterMatch[1];
  const parsed: Record<string, any> = {};

  // Parse top-level key-value pairs
  let currentKey: string | null = null;
  let currentIndent = 0;
  const stack: Array<{ key: string; obj: any; indent: number }> = [];

  const lines = yamlContent.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    const indent = line.search(/\S/);
    const trimmed = line.trim();

    // Detect list items
    const listItemMatch = trimmed.match(/^-\s+(.*)$/);
    if (listItemMatch) {
      // Determine which key this list belongs to by looking at parent context
      if (stack.length > 0) {
        const parent = stack[stack.length - 1];
        if (!Array.isArray(parent.obj[parent.key])) {
          parent.obj[parent.key] = [];
        }
        parent.obj[parent.key].push(parseRawValue(listItemMatch[1]));
      }
      continue;
    }

    // Key: value pair
    const kvMatch = trimmed.match(/^([\w-]+):\s*(.*)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const rawValue = kvMatch[2].trim();

    // Navigate to the right depth level
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    let targetObj: any;

    if (stack.length === 0) {
      // Top-level
      targetObj = parsed;
    } else {
      targetObj = stack[stack.length - 1].obj;
      const parentKey = stack[stack.length - 1].key;
      if (typeof targetObj[parentKey] === 'object' && !Array.isArray(targetObj[parentKey])) {
        // Already an object, use it
      } else if (targetObj[parentKey] === undefined || targetObj[parentKey] === null) {
        targetObj[parentKey] = {};
      }
      targetObj = targetObj[parentKey];
    }

    if (rawValue === '' || rawValue === '|') {
      // This key's value is a nested object or block — set up empty object
      targetObj[key] = targetObj[key] || {};
      stack.push({ key, obj: targetObj, indent });
    } else {
      targetObj[key] = parseRawValue(rawValue);
      // Still push to stack so subsequent indented children can find us
      stack.push({ key, obj: targetObj, indent });
    }
  }

  return transformParsedContext(parsed, raw);
}

function parseRawValue(raw: string): any {
  if (raw === 'null' || raw === '~') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  // Quoted string
  const quotedMatch = raw.match(/^"(.*)"$/);
  if (quotedMatch) return quotedMatch[1];

  // Number
  const num = Number(raw);
  if (!isNaN(num) && raw !== '') return num;

  return raw;
}

function transformParsedContext(raw: Record<string, any>, fullContent: string): AgentContextData {
  const pipelineId: string = raw.pipelineId || raw.pipeline_id || `pipeline-${Date.now()}`;
  const feature: string = raw.feature || 'unknown';
  const pipelineType: string = raw.pipelineType || raw.pipeline_type || 'standard';
  const createdAt: string = raw.createdAt || raw.created_at || new Date().toISOString();

  const cb = raw.circuitBreaker || raw.circuit_breaker || {};
  const circuitBreaker = {
    counters: (typeof cb.counters === 'object' ? cb.counters : {}) as Record<string, number>,
    state: typeof cb.state === 'string' ? cb.state : 'closed',
    patternDetection: Array.isArray(cb.patternDetection || cb.pattern_detection) ? (cb.patternDetection || cb.pattern_detection) : [],
  };

  const history = Array.isArray(raw.agentHistory || raw.agent_history)
    ? (raw.agentHistory || raw.agent_history).map((entry: any, idx: number) => ({
        step: typeof entry.step === 'number' ? entry.step : idx + 1,
        agent: entry.agent || entry.role || 'unknown',
        result: entry.result || 'unknown',
        duration: typeof entry.duration === 'number' ? entry.duration : undefined,
        decisions: Array.isArray(entry.decisions) ? entry.decisions.map(String) : [],
        warnings: Array.isArray(entry.warnings) ? entry.warnings.map(String) : [],
        output: typeof entry.output === 'string' ? entry.output : undefined,
      }))
    : [];

  const failureSummary: string | null = raw.failureSummary || raw.failure_summary || null;

  const agentOutputs: Record<string, any> =
    typeof raw.agentOutputs === 'object' && !Array.isArray(raw.agentOutputs)
      ? raw.agentOutputs
      : {};

  return {
    pipelineId,
    feature,
    pipelineType,
    createdAt,
    circuitBreaker,
    agentHistory: history,
    failureSummary,
    agentOutputs,
  };
}

// ---------------------------------------------------------------------------
// Retrospective calculation
// ---------------------------------------------------------------------------

function generateRetrospective(
  ctx: AgentContextData,
  result: 'pass' | 'fail' | 'partial',
): Retrospective {
  const allWarnings: string[] = [];
  let completedCount = 0;
  let failedCount = 0;

  for (const entry of ctx.agentHistory) {
    if (entry.result === 'pass' || entry.result === 'completed') {
      completedCount++;
    } else if (entry.result === 'fail' || entry.result === 'failed') {
      failedCount++;
    }
    allWarnings.push(...entry.warnings);
  }

  // Pipeline quality
  const totalRetries = Object.values(ctx.circuitBreaker.counters).reduce((sum, v) => sum + v, 0);
  let pipelineQuality: 'smooth' | 'rough' | 'failed';
  if (result === 'fail') {
    pipelineQuality = 'failed';
  } else if (totalRetries === 0) {
    pipelineQuality = 'smooth';
  } else {
    pipelineQuality = 'rough';
  }

  // Handoff quality rating
  let handoffRating = 10;
  const handoffIssues: string[] = [];

  for (const warning of allWarnings) {
    const lower = warning.toLowerCase();
    if (lower.includes('missing context') || lower.includes('unclear') || lower.includes('ambigu')) {
      handoffRating -= 2;
      handoffIssues.push(warning.length > 80 ? warning.substring(0, 77) + '...' : warning);
    }
  }

  // Deduct for each retry
  if (totalRetries > 0) {
    handoffRating -= Math.min(totalRetries, 3);
  }

  // Deduct for failures
  if (failedCount > 0) {
    handoffRating -= failedCount * 2;
  }

  handoffRating = Math.max(1, Math.min(10, handoffRating));

  // Agent performance
  const agentPerformance: AgentPerformanceEntry[] = [];
  const agentEffectivenessMap = new Map<string, { completed: number; failed: number; warnings: string[] }>();

  for (const entry of ctx.agentHistory) {
    if (!agentEffectivenessMap.has(entry.agent)) {
      agentEffectivenessMap.set(entry.agent, { completed: 0, failed: 0, warnings: [] });
    }
    const stats = agentEffectivenessMap.get(entry.agent)!;
    if (entry.result === 'pass' || entry.result === 'completed') {
      stats.completed++;
    } else {
      stats.failed++;
    }
    stats.warnings.push(...entry.warnings);
  }

  for (const [agent, stats] of agentEffectivenessMap) {
    let effectiveness: 'good' | 'ok' | 'poor';
    let notes: string;

    if (stats.failed === 0 && stats.warnings.length === 0) {
      effectiveness = 'good';
      notes = `Completed ${stats.completed} step(s) successfully with no issues`;
    } else if (stats.failed === 0 && stats.warnings.length <= 2) {
      effectiveness = 'ok';
      notes = `Completed ${stats.completed} step(s) with ${stats.warnings.length} warning(s)`;
    } else {
      effectiveness = 'poor';
      notes = `${stats.failed} failure(s), ${stats.warnings.length} warning(s)`;
    }

    agentPerformance.push({ role: agent, effectiveness, notes });
  }

  // Auto-generate improvements
  const improvements: string[] = [];
  const hasVerifier = ctx.agentHistory.some(e => e.agent === 'verifier');
  const verifierFailed = ctx.agentHistory.some(e => e.agent === 'verifier' && e.result !== 'pass');
  const hasImplementor = ctx.agentHistory.some(e => e.agent === 'implementor');
  const implementorFailed = ctx.agentHistory.some(e => e.agent === 'implementor' && e.result !== 'pass');

  if (verifierFailed && hasVerifier) {
    improvements.push('Add error handling checkpoints for all service methods');
  }
  if (implementorFailed && hasImplementor) {
    improvements.push('Add pre-implementation validation step for implementor input');
  }
  if (totalRetries > 0) {
    improvements.push(`Investigate and reduce circuit breaker retries (${totalRetries} total retries)`);
  }
  if (result === 'fail') {
    improvements.push('Add early-failure detection gates before expensive pipeline steps');
  }
  if (handoffRating < 7) {
    improvements.push('Improve agent context handoff: provide more explicit context and reduce ambiguity');
  }

  return {
    pipelineQuality,
    handoffQuality: {
      rating: handoffRating,
      issues: handoffIssues,
    },
    agentPerformance,
    wastedSteps: [],
    improvementsForNextPipeline: improvements,
    lessonsLearned: [],
  };
}

// ---------------------------------------------------------------------------
// Key decisions extraction
// ---------------------------------------------------------------------------

function extractKeyDecisions(ctx: AgentContextData): string[] {
  const decisions = new Set<string>();
  for (const entry of ctx.agentHistory) {
    for (const d of entry.decisions) {
      if (d.trim()) decisions.add(d.trim());
    }
  }
  return Array.from(decisions);
}

// ---------------------------------------------------------------------------
// YAML serialization (manual, no external deps)
// ---------------------------------------------------------------------------

function serializeYamlValue(value: any, indent: number): string {
  const pad = ' '.repeat(indent);
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    // Quote if contains special characters
    if (/[:\-#\[\]{}|>'"\n]/.test(value) || value === '' || value === 'null' || value === 'true' || value === 'false') {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map(v => `${pad}- ${serializeYamlValue(v, indent + 2)}`).join('\n');
    return '\n' + items;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    const pairs = keys.map(k => {
      const v = value[k];
      return `${pad}${k}: ${serializeYamlValue(v, indent + 2).trimStart()}`;
    });
    return '\n' + pairs.join('\n');
  }
  return String(value);
}

function buildJournalEntries(journals: JournalEntry[]): string {
  const lines: string[] = [];

  for (const entry of journals) {
    lines.push(`- date: "${entry.date}"`);
    lines.push(`  feature: "${entry.feature}"`);
    lines.push(`  pipelineType: "${entry.pipelineType}"`);
    lines.push(`  result: "${entry.result}"`);
    lines.push(`  durationMinutes: ${entry.durationMinutes}`);

    // filesChanged
    if (entry.filesChanged.length > 0) {
      lines.push('  filesChanged:');
      for (const f of entry.filesChanged) {
        lines.push(`    - "${f}"`);
      }
    } else {
      lines.push('  filesChanged: []');
    }

    // keyDecisions
    if (entry.keyDecisions.length > 0) {
      lines.push('  keyDecisions:');
      for (const d of entry.keyDecisions) {
        lines.push(`    - "${d}"`);
      }
    } else {
      lines.push('  keyDecisions: []');
    }

    // circuitBreakerEvents
    if (entry.circuitBreakerEvents.length > 0) {
      lines.push('  circuitBreakerEvents:');
      for (const evt of entry.circuitBreakerEvents) {
        lines.push(`    - gate: "${evt.gate}"`);
        lines.push(`      attempts: ${evt.attempts}`);
        lines.push(`      resolution: "${evt.resolution}"`);
      }
    } else {
      lines.push('  circuitBreakerEvents: []');
    }

    // failedGates
    if (entry.failedGates.length > 0) {
      lines.push('  failedGates:');
      for (const g of entry.failedGates) {
        lines.push(`    - "${g}"`);
      }
    } else {
      lines.push('  failedGates: []');
    }

    // retrospective (if present)
    if (entry.retrospective) {
      const retro = entry.retrospective;
      lines.push('  retrospective:');
      lines.push(`    pipelineQuality: "${retro.pipelineQuality}"`);
      lines.push('    handoffQuality:');
      lines.push(`      rating: ${retro.handoffQuality.rating}`);

      if (retro.handoffQuality.issues.length > 0) {
        lines.push('      issues:');
        for (const issue of retro.handoffQuality.issues) {
          lines.push(`        - "${issue}"`);
        }
      } else {
        lines.push('      issues: []');
      }

      lines.push('    agentPerformance:');
      for (const perf of retro.agentPerformance) {
        lines.push(`      - role: "${perf.role}"`);
        lines.push(`        effectiveness: "${perf.effectiveness}"`);
        lines.push(`        notes: "${perf.notes}"`);
      }

      if (retro.wastedSteps.length > 0) {
        lines.push('    wastedSteps:');
        for (const ws of retro.wastedSteps) {
          lines.push(`      - "${ws}"`);
        }
      } else {
        lines.push('    wastedSteps: []');
      }

      if (retro.improvementsForNextPipeline.length > 0) {
        lines.push('    improvementsForNextPipeline:');
        for (const imp of retro.improvementsForNextPipeline) {
          lines.push(`      - "${imp}"`);
        }
      } else {
        lines.push('    improvementsForNextPipeline: []');
      }

      if (retro.lessonsLearned.length > 0) {
        lines.push('    lessonsLearned:');
        for (const ll of retro.lessonsLearned) {
          lines.push(`      - "${ll}"`);
        }
      } else {
        lines.push('    lessonsLearned: []');
      }
    }
  }

  return lines.join('\n');
}

function buildLessonsContent(lessons: LessonsEntry[]): string {
  const lines: string[] = [
    '# Pipeline Lessons Learned — append-only',
    '# Each entry captures a reproducible insight from a pipeline run.',
    '#',
    '# Schema:',
    '#   - date: ISO-8601 timestamp',
    '#     lesson: actionable insight (one sentence)',
    '#     sourceFeature: the feature that produced this lesson',
    '#     category: plan | implementation | qa | process | tooling | communication',
    '#     severity: high | medium | low',
    '#     injected: boolean (whether this has been injected into a subsequent pipeline)',
    '',
  ];

  for (const entry of lessons) {
    lines.push(`- date: "${entry.date}"`);
    lines.push(`  lesson: "${entry.lesson}"`);
    lines.push(`  sourceFeature: "${entry.sourceFeature}"`);
    lines.push(`  category: "${entry.category}"`);
    lines.push(`  severity: "${entry.severity}"`);
    lines.push(`  injected: ${entry.injected}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Journal append
// ---------------------------------------------------------------------------

function appendJournal(rootDir: string, entry: JournalEntry): void {
  const journalPath = getJournalPath(rootDir);
  const journalDir = path.dirname(journalPath);

  if (!fs.existsSync(journalDir)) {
    fs.mkdirSync(journalDir, { recursive: true });
  }

  const yaml = buildJournalEntries([entry]);

  // Append to the file
  fs.appendFileSync(journalPath, '\n' + yaml + '\n', 'utf-8');
  console.log(`📓 Journal Entry: ✅ Written to .opencode/journal/journal.yaml`);
}

// ---------------------------------------------------------------------------
// Lessons append
// ---------------------------------------------------------------------------

function categorizeLesson(lesson: string, fallback: string): string {
  const lower = lesson.toLowerCase();
  if (/plan|manifest|checkpoint/.test(lower)) return 'plan';
  if (/test|qa|coverage/.test(lower)) return 'qa';
  if (/implement|code|error/.test(lower)) return 'implementation';
  if (/pipeline|process|handoff/.test(lower)) return 'process';
  if (/tooling|tool|circuit|breaker/.test(lower)) return 'tooling';
  if (/communicat|handoff|context/.test(lower)) return 'communication';
  return fallback;
}

function determineSeverity(result: 'pass' | 'fail' | 'partial'): string {
  if (result === 'fail') return 'high';
  if (result === 'partial') return 'medium';
  return 'low';
}

function appendLessons(rootDir: string, ctx: AgentContextData, args: CliArgs): void {
  const lessonsPath = getLessonsPath(rootDir);
  const lessonsDir = path.dirname(lessonsPath);

  if (!fs.existsSync(lessonsDir)) {
    fs.mkdirSync(lessonsDir, { recursive: true });
  }

  const lessons: LessonsEntry[] = [];
  const now = new Date().toISOString();
  const severity = determineSeverity(args.result);
  const injected = false;

  // Extract key decisions as lessons with intelligent categorization
  const decisions = extractKeyDecisions(ctx);
  for (const decision of decisions) {
    lessons.push({
      date: now,
      lesson: decision,
      sourceFeature: args.feature,
      category: categorizeLesson(decision, 'process'),
      severity,
      injected,
    });
  }

  // If pipeline failed, extract failure summary as lessons
  if (args.result === 'fail' && ctx.failureSummary) {
    // failureSummary may be a JSON string — try to parse it
    const summaryText = ctx.failureSummary;
    let parsedSummary: any = null;
    try {
      parsedSummary = JSON.parse(summaryText);
    } catch {
      // Not JSON, treat as plain text
    }

    if (parsedSummary && typeof parsedSummary === 'object') {
      // Extract rootCause as a separate lesson
      if (parsedSummary.rootCause) {
        const rootCauseStr = typeof parsedSummary.rootCause === 'string'
          ? parsedSummary.rootCause
          : JSON.stringify(parsedSummary.rootCause);
        lessons.push({
          date: now,
          lesson: `Root cause: ${rootCauseStr}`,
          sourceFeature: args.feature,
          category: categorizeLesson(rootCauseStr, 'implementation'),
          severity: 'high',
          injected,
        });
      }

      // Extract each attempt from attemptsLog as a separate lesson
      if (Array.isArray(parsedSummary.attemptsLog)) {
        for (const attempt of parsedSummary.attemptsLog) {
          const attemptStr = typeof attempt === 'string' ? attempt : JSON.stringify(attempt);
          lessons.push({
            date: now,
            lesson: `Failed attempt: ${attemptStr}`,
            sourceFeature: args.feature,
            category: categorizeLesson(attemptStr, 'implementation'),
            severity: 'high',
            injected,
          });
        }
      }

      // Also add the full failure summary as a lesson
      lessons.push({
        date: now,
        lesson: `Pipeline failure summary: ${summaryText.substring(0, 500)}`,
        sourceFeature: args.feature,
        category: 'process',
        severity: 'high',
        injected,
      });
    } else {
      // Plain text failure summary
      lessons.push({
        date: now,
        lesson: `Pipeline failure: ${summaryText.substring(0, 500)}`,
        sourceFeature: args.feature,
        category: 'process',
        severity: 'high',
        injected,
      });
    }
  }

  // If circuit breaker detected patterns, add those as lessons
  for (const pattern of ctx.circuitBreaker.patternDetection) {
    lessons.push({
      date: now,
      lesson: `Circuit breaker pattern detected: ${pattern}`,
      sourceFeature: args.feature,
      category: 'tooling',
      severity,
      injected,
    });
  }

  if (lessons.length === 0) {
    console.log('📓 Lessons: ⏭️  No lessons to record');
    return;
  }

  // Create file if not exists with header
  if (!fs.existsSync(lessonsPath)) {
    const header = buildLessonsContent([]);
    fs.writeFileSync(lessonsPath, header, 'utf-8');
  }

  // Append lessons
  const yaml = buildLessonsContent(lessons);
  fs.appendFileSync(lessonsPath, yaml, 'utf-8');
  console.log(`📓 Lessons: ✅ Appended ${lessons.length} lesson(s) to .opencode/lessons/learned.yaml`);
}

// ---------------------------------------------------------------------------
// Archive raw agent outputs
// ---------------------------------------------------------------------------

function archiveAgentContext(rootDir: string, ctx: AgentContextData, args: CliArgs, rawContent: string): void {
  const logsDir = getPipelineLogsDir(rootDir);
  const pipelineDir = path.join(logsDir, ctx.pipelineId);

  if (!fs.existsSync(pipelineDir)) {
    fs.mkdirSync(pipelineDir, { recursive: true });
  }

  // Write full raw content of agent-context.md (before teardown)
  const contextLogPath = path.join(pipelineDir, 'agent-context.md');
  fs.writeFileSync(contextLogPath, rawContent, 'utf-8');
  console.log(`📦 Archive: ✅ agent-context.md -> ${path.relative(rootDir, contextLogPath)}`);

  // Write timeline.txt with agent step order and durations
  const timelineLines: string[] = [
    `Pipeline Teardown Timeline`,
    `========================`,
    `Pipeline ID: ${ctx.pipelineId}`,
    `Feature: ${args.feature}`,
    `Type: ${args.pipelineType}`,
    `Result: ${args.result}`,
    `Duration: ${formatDuration(args.durationMinutes)}`,
    `Created: ${ctx.createdAt}`,
    `Archived: ${new Date().toISOString()}`,
    ``,
    `Agent Steps:`,
    `-----------`,
  ];

  if (ctx.agentHistory.length === 0) {
    timelineLines.push('  (No agent history recorded)');
  } else {
    for (const entry of ctx.agentHistory) {
      const durationStr = entry.duration !== undefined ? `${entry.duration}s` : '?';
      const statusIcon = entry.result === 'pass' || entry.result === 'completed' ? '✓' : '✗';
      timelineLines.push(`  Step ${entry.step}: [${statusIcon}] ${entry.agent} (${durationStr}) — ${entry.result}`);
    }
  }

  timelineLines.push('');
  timelineLines.push('Circuit Breaker:');
  timelineLines.push(`  State: ${ctx.circuitBreaker.state}`);
  timelineLines.push(`  Counters:`);
  const cbCounters = ctx.circuitBreaker.counters;
  const counterKeys = Object.keys(cbCounters);
  if (counterKeys.length === 0) {
    timelineLines.push('    (none)');
  } else {
    for (const key of counterKeys) {
      timelineLines.push(`    ${key}: ${cbCounters[key]}`);
    }
  }

  const timelinePath = path.join(pipelineDir, 'timeline.txt');
  fs.writeFileSync(timelinePath, timelineLines.join('\n') + '\n', 'utf-8');
  console.log(`📦 Archive: ✅ timeline.txt written to ${path.relative(rootDir, timelinePath)}`);

  // Write raw agent outputs as separate log files
  if (Object.keys(ctx.agentOutputs).length > 0) {
    const outputsDir = path.join(pipelineDir, 'outputs');
    if (!fs.existsSync(outputsDir)) {
      fs.mkdirSync(outputsDir, { recursive: true });
    }
    for (const [agentName, output] of Object.entries(ctx.agentOutputs)) {
      const outputPath = path.join(outputsDir, `${agentName}.log`);
      const content = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
      fs.writeFileSync(outputPath, content, 'utf-8');
    }
    console.log(`📦 Archive: ✅ Agent outputs archived to ${path.relative(rootDir, outputsDir)}/`);
  }
}

// ---------------------------------------------------------------------------
// Calibration update
// ---------------------------------------------------------------------------

function updateCalibration(rootDir: string, ctx: AgentContextData, args: CliArgs): void {
  const scriptPath = getCalibrationScriptPath();

  if (!fs.existsSync(scriptPath)) {
    console.warn(`⚠️  Calibration script not found at ${scriptPath} — skipping calibration updates`);
    return;
  }

  // Track which agents we've already calibrated to avoid duplicates
  const calibratedAgents = new Set<string>();

  for (const entry of ctx.agentHistory) {
    const agentName = entry.agent;

    if (calibratedAgents.has(agentName)) continue;
    calibratedAgents.add(agentName);

    const success = entry.result === 'pass' || entry.result === 'completed';

    // Determine effectiveness based on result and warnings
    let effectiveness: string;
    if (entry.result === 'pass' || entry.result === 'completed') {
      effectiveness = entry.warnings.length === 0 ? 'good' : 'ok';
    } else {
      effectiveness = 'poor';
    }

    // Build failure pattern from warnings if failed
    const failurePattern = !success && entry.warnings.length > 0
      ? entry.warnings[0]
      : '';

    // Build the command
    const parts: string[] = [
      'ts-node',
      `"${scriptPath}"`,
      `--agent=${agentName}`,
      `--success=${success}`,
      `--effectiveness=${effectiveness}`,
    ];

    if (failurePattern) {
      parts.push(`--failure-pattern="${failurePattern}"`);
    }

    // Agent-specific fields
    if (agentName === 'implementor') {
      const buildRetries = ctx.circuitBreaker.counters['build'] || 0;
      const lintRetries = ctx.circuitBreaker.counters['lint'] || 0;
      parts.push(`--build-retries=${buildRetries}`);
      parts.push(`--lint-retries=${lintRetries}`);
    }

    const command = parts.join(' ');

    try {
      execSync(command, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 15000,
      });
    } catch (err: any) {
      const stderr = err.stderr || err.message || 'unknown error';
      console.warn(`⚠️  Calibration update failed for ${agentName}: ${stderr.trim()}`);
    }
  }

  // Update orchestrator calibration
  try {
    const orchestratorCmd = [
      'ts-node',
      `"${scriptPath}"`,
      `--agent=orchestrator`,
      `--success=${args.result === 'pass'}`,
      `--effectiveness=${args.result === 'pass' ? 'good' : 'ok'}`,
    ].join(' ');

    execSync(orchestratorCmd, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    });
  } catch (err: any) {
    const stderr = err.stderr || err.message || 'unknown error';
    console.warn(`⚠️  Orchestrator calibration update failed: ${stderr.trim()}`);
  }

  console.log(`📊 Calibration: ✅ Updated ${calibratedAgents.size} agent(s) + orchestrator`);
}

// ---------------------------------------------------------------------------
// Delete agent-context.md
// ---------------------------------------------------------------------------

function deleteAgentContext(rootDir: string, keepContext: boolean): void {
  if (keepContext) {
    console.log('📄 agent-context.md: ⏭️  Preserved (--keep-context flag set)');
    return;
  }

  const contextPath = getAgentContextPath(rootDir);
  if (fs.existsSync(contextPath)) {
    fs.unlinkSync(contextPath);
    console.log('📄 agent-context.md: ✅ Deleted');
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatDuration(minutes: number): string {
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  const mins = Math.floor(minutes);
  const secs = Math.round((minutes - mins) * 60);
  if (secs === 0) return `${mins}m`;
  return `${mins}m ${secs}s`;
}

function getResultEmoji(result: string): string {
  switch (result) {
    case 'pass': return '✅ Pass';
    case 'fail': return '❌ Fail';
    case 'partial': return '⚠️  Partial';
    default: return result;
  }
}

// ---------------------------------------------------------------------------
// Evidence staleness scan
// ---------------------------------------------------------------------------

function computeFileHash(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Extracts all evidence from agentHistory and agentOutputs and checks
 * whether the source files still exist and their content hashes match.
 */
function runEvidenceStalenessScan(rootDir: string, ctx: AgentContextData): EvidenceStalenessReport {
  const entries: EvidenceStalenessEntry[] = [];

  // 1. Extract evidence from agentHistory
  for (const historyEntry of ctx.agentHistory) {
    // Check if the output field looks like evidence with structured data
    if (historyEntry.output) {
      // Try to parse output as JSON with evidence
      let parsedOutput: any;
      try {
        parsedOutput = JSON.parse(historyEntry.output);
      } catch {
        parsedOutput = null;
      }

      if (parsedOutput && typeof parsedOutput === 'object') {
        // Look for evidence arrays in the output
        const evidenceList = findEvidenceInObject(parsedOutput);
        for (const evidence of evidenceList) {
          entries.push(buildStalenessEntry(historyEntry.agent, evidence, rootDir));
        }
      } else {
        // Treat the entire output as an unverifiable evidence claim
        entries.push({
          agent: historyEntry.agent,
          claim: historyEntry.output.substring(0, 200),
          source: 'agent-output',
          method: 'analysis',
          status: 'unverifiable',
          originalHash: null,
          currentHash: null,
        });
      }
    }

    // Check decisions for file references (e.g., "created src/foo.ts")
    for (const decision of historyEntry.decisions) {
      // Look for file path references in decisions
      const fileRefs = extractFileReferences(decision);
      for (const fileRef of fileRefs) {
        const fullPath = path.resolve(rootDir, fileRef);
        const currentHash = computeFileHash(fullPath);
        const fileExists = fs.existsSync(fullPath);

        entries.push({
          agent: historyEntry.agent,
          claim: decision,
          source: fileRef,
          method: 'decision',
          status: fileExists ? 'valid' : 'file_deleted',
          originalHash: null,
          currentHash,
        });
      }
    }
  }

  // 2. Extract evidence from agentOutputs
  for (const [agentName, output] of Object.entries(ctx.agentOutputs)) {
    let parsedOutput: any;
    try {
      parsedOutput = typeof output === 'string' ? JSON.parse(output) : output;
    } catch {
      parsedOutput = null;
    }

    if (parsedOutput && typeof parsedOutput === 'object') {
      const evidenceList = findEvidenceInObject(parsedOutput);
      for (const evidence of evidenceList) {
        entries.push(buildStalenessEntry(agentName, evidence, rootDir));
      }
    }
  }

  // 3. Aggregate report
  let validCount = 0;
  let staleCount = 0;
  let deletedCount = 0;
  let unverifiableCount = 0;

  for (const entry of entries) {
    switch (entry.status) {
      case 'valid': validCount++; break;
      case 'stale': staleCount++; break;
      case 'file_deleted': deletedCount++; break;
      case 'unverifiable': unverifiableCount++; break;
    }
  }

  return {
    total: entries.length,
    valid: validCount,
    stale: staleCount,
    fileDeleted: deletedCount,
    unverifiable: unverifiableCount,
    entries,
  };
}

/**
 * Recursively searches an object for evidence-like structures.
 * Looks for objects with properties like `source`, `file`, `path`, `contentHash`.
 */
function findEvidenceInObject(obj: any, depth: number = 0): any[] {
  if (depth > 5) return [];
  if (typeof obj !== 'object' || obj === null) return [];

  const results: any[] = [];

  // Is this object itself an evidence entry?
  if (obj.source || obj.file || obj.path || obj.contentHash || obj.evidence) {
    results.push(obj);
  }

  // Recurse into arrays
  if (Array.isArray(obj)) {
    for (const item of obj) {
      results.push(...findEvidenceInObject(item, depth + 1));
    }
  } else {
    // Recurse into object keys
    for (const val of Object.values(obj)) {
      results.push(...findEvidenceInObject(val, depth + 1));
    }
  }

  return results;
}

/**
 * Extracts file path references from a decision string.
 * Matches patterns like "created src/foo.ts", "modified src/bar.ts", "src/baz.ts"
 */
function extractFileReferences(text: string): string[] {
  const refs: string[] = [];

  // Match patterns like: created/modified/added/deleted <path>
  const actionFilePattern = /\b(?:created|modified|added|deleted|updated|changed|removed)\s+([\w./-]+\.(?:ts|tsx|js|jsx|json|yaml|yml|md|css|scss|html|py|go|rs|java))\b/gi;
  let match: RegExpExecArray | null;
  while ((match = actionFilePattern.exec(text)) !== null) {
    refs.push(match[1]);
  }

  // Match standalone file paths
  const pathPattern = /\b([\w./-]+\/(?:[\w.-]+\.(?:ts|tsx|js|jsx|json|yaml|yml|md|css|scss|html|py|go|rs|java)))\b/g;
  while ((match = pathPattern.exec(text)) !== null) {
    refs.push(match[1]);
  }

  return [...new Set(refs)];
}

/**
 * Builds an EvidenceStalenessEntry from an evidence object.
 */
function buildStalenessEntry(agent: string, evidence: any, rootDir: string): EvidenceStalenessEntry {
  // Determine the source file path
  const sourcePath = evidence.source || evidence.file || evidence.path || 'unknown';
  const method = evidence.method || evidence.type || 'analysis';
  const claim = evidence.claim || evidence.evidence || evidence.description || JSON.stringify(evidence).substring(0, 200);

  // If method is reason/analysis, mark as unverifiable
  const unverifiableMethods = ['reason', 'analysis', 'inference', 'deduction', 'synthesis'];
  if (unverifiableMethods.includes(method.toLowerCase())) {
    return {
      agent,
      claim: claim.substring(0, 200),
      source: sourcePath,
      method,
      status: 'unverifiable',
      originalHash: evidence.contentHash || null,
      currentHash: null,
    };
  }

  // Resolve file path
  const fullPath = path.resolve(rootDir, sourcePath);

  if (!fs.existsSync(fullPath)) {
    return {
      agent,
      claim: claim.substring(0, 200),
      source: sourcePath,
      method,
      status: 'file_deleted',
      originalHash: evidence.contentHash || null,
      currentHash: null,
    };
  }

  // Compute current hash
  const currentHash = computeFileHash(fullPath);
  const originalHash = evidence.contentHash || null;

  // Compare hashes
  if (originalHash && currentHash === originalHash) {
    return {
      agent,
      claim: claim.substring(0, 200),
      source: sourcePath,
      method,
      status: 'valid',
      originalHash,
      currentHash,
    };
  } else if (originalHash && currentHash !== originalHash) {
    return {
      agent,
      claim: claim.substring(0, 200),
      source: sourcePath,
      method,
      status: 'stale',
      originalHash,
      currentHash,
    };
  } else {
    // No original hash — can't verify
    return {
      agent,
      claim: claim.substring(0, 200),
      source: sourcePath,
      method,
      status: 'unverifiable',
      originalHash: null,
      currentHash,
    };
  }
}

// ---------------------------------------------------------------------------
// Evidence quality report
// ---------------------------------------------------------------------------

function generateEvidenceQualityReport(ctx: AgentContextData): EvidenceQualityMetrics {
  const allEvidence: any[] = [];

  // Collect all evidence from agentHistory outputs
  for (const entry of ctx.agentHistory) {
    if (entry.output) {
      let parsed: any;
      try {
        parsed = JSON.parse(entry.output);
      } catch {
        parsed = null;
      }
      if (parsed && typeof parsed === 'object') {
        allEvidence.push(...findEvidenceInObject(parsed));
      }
    }
  }

  // Collect all evidence from agentOutputs
  for (const output of Object.values(ctx.agentOutputs)) {
    let parsed: any;
    try {
      parsed = typeof output === 'string' ? JSON.parse(output) : output;
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed === 'object') {
      allEvidence.push(...findEvidenceInObject(parsed));
    }
  }

  const total = allEvidence.length;

  if (total === 0) {
    return {
      totalEvidence: 0,
      withContentHash: 0,
      withExactLines: 0,
      withVerifiableMethod: 0,
      avgCompleteness: 0,
      avgPrecision: 0,
      avgVerifiability: 0,
    };
  }

  // Count evidence with specific fields
  const withContentHash = allEvidence.filter(e => e.contentHash).length;
  const withExactLines = allEvidence.filter(e => e.line || e.lineStart || e.lines || e.lineEnd).length;
  const verifiableMethods = ['file', 'code', 'test', 'log', 'output', 'trace', 'diff', 'commit'];
  const withVerifiableMethod = allEvidence.filter(e => {
    const method = (e.method || e.type || '').toLowerCase();
    return verifiableMethods.includes(method);
  }).length;

  // Compute completeness per entry (what % of known fields are present)
  const knownFields = ['source', 'claim', 'method', 'contentHash', 'line', 'lineStart', 'lineEnd', 'file', 'path', 'type', 'evidence', 'description'];
  let totalCompleteness = 0;
  for (const ev of allEvidence) {
    const presentFields = knownFields.filter(f => ev[f] !== undefined && ev[f] !== null);
    totalCompleteness += (presentFields.length / knownFields.length) * 100;
  }

  const avgCompleteness = Math.round((totalCompleteness / total) * 10) / 10;
  const avgPrecision = Math.round((withExactLines / total) * 1000) / 10;
  const avgVerifiability = Math.round((withVerifiableMethod / total) * 1000) / 10;

  return {
    totalEvidence: total,
    withContentHash,
    withExactLines,
    withVerifiableMethod,
    avgCompleteness,
    avgPrecision,
    avgVerifiability,
  };
}

// ---------------------------------------------------------------------------
// Print summary
// ---------------------------------------------------------------------------

function printSummary(
  ctx: AgentContextData | null,
  args: CliArgs,
  retrospective: Retrospective,
  calibratedAgentsCount: number,
  lessonsCount: number,
  stalenessReport?: EvidenceStalenessReport,
  qualityReport?: EvidenceQualityMetrics,
): void {
  const completedCount = ctx
    ? ctx.agentHistory.filter(e => e.result === 'pass' || e.result === 'completed').length
    : 0;
  const failedCount = ctx
    ? ctx.agentHistory.filter(e => e.result !== 'pass' && e.result !== 'completed').length
    : 0;

  const separator = '━'.repeat(31 + args.feature.length);

  console.log('');
  console.log(`🧹 Pipeline Teardown: ${args.feature}`);
  console.log(separator);
  console.log('');
  console.log(`Result: ${getResultEmoji(args.result)} (${formatDuration(args.durationMinutes)})`);
  console.log(`Agents: ${completedCount} completed, ${failedCount} failed`);

  if (args.filesChanged.length > 0) {
    const gatesPassed = args.failedGates.length > 0
      ? '(inferred)'  // We know failed; passed inferred as the rest
      : '(all)';
    console.log(`Gates Passed: ${gatesPassed}`);
    if (args.failedGates.length > 0) {
      console.log(`Gates Failed: ${args.failedGates.join(', ')}`);
    } else {
      console.log(`Gates Failed: (none)`);
    }
  }

  console.log('');
  const archiveRelPath = ctx
    ? `pipeline-logs/${ctx.pipelineId}/`
    : 'pipeline-logs/(no context)/';
  console.log(`Journal Entry: ✅ Written`);
  console.log(`Calibration: ✅ Updated (${calibratedAgentsCount} agent(s) + orchestrator)`);
  console.log(`Lessons: ✅ Appended (${lessonsCount} lesson(s))`);
  console.log(`Archive: ✅ ${archiveRelPath}`);

  console.log('');
  console.log(`Retrospective: ${retrospective.pipelineQuality}`);
  console.log(`  Handoff Quality: ${retrospective.handoffQuality.rating}/10`);

  if (retrospective.handoffQuality.issues.length > 0) {
    for (const issue of retrospective.handoffQuality.issues) {
      console.log(`    ⚠️  ${issue}`);
    }
  }

  if (retrospective.improvementsForNextPipeline.length > 0) {
    console.log(`  Improvements:`);
    for (const imp of retrospective.improvementsForNextPipeline) {
      console.log(`    - ${imp}`);
    }
  }

  if (retrospective.agentPerformance.length > 0) {
    console.log(`  Agent Performance:`);
    for (const perf of retrospective.agentPerformance) {
      const icon = perf.effectiveness === 'good' ? '✓' : perf.effectiveness === 'ok' ? '~' : '✗';
      console.log(`    ${icon} ${perf.role}: ${perf.effectiveness} — ${perf.notes}`);
    }
  }

  // Evidence staleness summary
  if (stalenessReport && stalenessReport.total > 0) {
    console.log(`  Evidence Scan:`);
    console.log(`    Total: ${stalenessReport.total} | ✅ ${stalenessReport.valid} valid | ⚠️  ${stalenessReport.stale} stale | 🗑️  ${stalenessReport.fileDeleted} deleted | ⏭️  ${stalenessReport.unverifiable} unverifiable`);
  }

  // Evidence quality summary
  if (qualityReport && qualityReport.totalEvidence > 0) {
    console.log(`  Evidence Quality:`);
    console.log(`    ${qualityReport.totalEvidence} entries | ${Math.round(qualityReport.withContentHash/qualityReport.totalEvidence*100)}% with hash | ${Math.round(qualityReport.withExactLines/qualityReport.totalEvidence*100)}% with lines`);
  }

  console.log('');
  console.log('Cleanup complete.');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs();
  const rootDir = getRootDir();
  const contextPath = getAgentContextPath(rootDir);

  // Read agent-context.md
  let rawContent = '';
  let ctx: AgentContextData | null = null;

  if (fs.existsSync(contextPath)) {
    rawContent = fs.readFileSync(contextPath, 'utf-8');
    ctx = parseAgentContext(contextPath);
    if (ctx) {
      console.log(`📄 agent-context.md: ✅ Read (pipelineId=${ctx.pipelineId}, ${ctx.agentHistory.length} agent step(s))`);
    } else {
      console.warn('⚠️  agent-context.md found but could not parse frontmatter — proceeding with minimal data');
    }
  } else {
    console.warn('⚠️  agent-context.md not found — proceeding with CLI args only');
  }

  // Build context from args if no file
  if (!ctx) {
    ctx = {
      pipelineId: `pipeline-${Date.now()}`,
      feature: args.feature,
      pipelineType: args.pipelineType,
      createdAt: new Date().toISOString(),
      circuitBreaker: {
        counters: {},
        state: 'closed',
        patternDetection: [],
      },
      agentHistory: [],
      failureSummary: null,
      agentOutputs: {},
    };
  }

  // Calculate retrospective
  const retrospective = generateRetrospective(ctx, args.result);

  // Extract key decisions
  const keyDecisions = extractKeyDecisions(ctx);

  // Build journal entry
  const journalEntry: JournalEntry = {
    date: new Date().toISOString(),
    feature: args.feature,
    pipelineType: args.pipelineType,
    result: args.result,
    durationMinutes: args.durationMinutes,
    filesChanged: args.filesChanged,
    keyDecisions,
    circuitBreakerEvents: args.circuitBreakerEvents,
    failedGates: args.failedGates,
    retrospective,
  };

  // 1. Append journal entry
  appendJournal(rootDir, journalEntry);

  // 2. Append lessons
  let lessonsCount = 0;
  {
    const decisions = extractKeyDecisions(ctx);
    const patterns = ctx.circuitBreaker.patternDetection;
    lessonsCount = decisions.length + (args.result === 'fail' && ctx.failureSummary ? 1 : 0) + patterns.length;
  }
  appendLessons(rootDir, ctx, args);

  // 3. Archive raw agent outputs
  if (rawContent) {
    archiveAgentContext(rootDir, ctx, args, rawContent);
  } else {
    console.log('📦 Archive: ⏭️  No agent-context.md to archive');
  }

  // 4. Update calibration
  const historyAgents = new Set(ctx.agentHistory.map(e => e.agent));
  updateCalibration(rootDir, ctx, args);

  // 5. Delete agent-context.md
  deleteAgentContext(rootDir, args.keepContext);

  // 6. Evidence staleness and quality reports
  let stalenessReport: EvidenceStalenessReport | undefined;
  let qualityReport: EvidenceQualityMetrics | undefined;

  if (args.evidenceScan) {
    // 6a. Run evidence staleness scan
    stalenessReport = runEvidenceStalenessScan(rootDir, ctx);
    if (stalenessReport.total > 0) {
      console.log(`\n🔍 Evidence Staleness Scan:`);
      console.log(`   Total: ${stalenessReport.total}`);
      console.log(`   ✅ Valid: ${stalenessReport.valid}`);
      console.log(`   ⚠️  Stale (file modified): ${stalenessReport.stale}`);
      console.log(`   🗑️  File deleted: ${stalenessReport.fileDeleted}`);
      console.log(`   ⏭️  Unverifiable: ${stalenessReport.unverifiable}`);

      if (stalenessReport.stale > 0 || stalenessReport.fileDeleted > 0) {
        console.log(`   ⚠️ ${stalenessReport.stale + stalenessReport.fileDeleted} evidence entries need attention`);
        // Print first 3 stale/deleted entries
        for (const entry of stalenessReport.entries.filter(e => e.status === 'stale' || e.status === 'file_deleted').slice(0, 3)) {
          console.log(`     [${entry.status}] ${entry.agent}: "${entry.claim.substring(0, 60)}..." → ${entry.source}`);
        }
      }
    }

    // 6b. Generate evidence quality report
    qualityReport = generateEvidenceQualityReport(ctx);
    if (qualityReport.totalEvidence > 0) {
      console.log(`\n📊 Evidence Quality Metrics:`);
      console.log(`   Total evidence entries: ${qualityReport.totalEvidence}`);
      console.log(`   With content hash: ${qualityReport.withContentHash} (${Math.round(qualityReport.withContentHash/qualityReport.totalEvidence*100)}%)`);
      console.log(`   With exact lines: ${qualityReport.withExactLines} (${Math.round(qualityReport.withExactLines/qualityReport.totalEvidence*100)}%)`);
      console.log(`   Avg completeness: ${qualityReport.avgCompleteness}%`);
      console.log(`   Avg precision: ${qualityReport.avgPrecision}%`);
      console.log(`   Avg verifiability: ${qualityReport.avgVerifiability}%`);
    }

    // 6c. Write evidence quality data to calibration
    // Call update-calibration.ts with evidence quality metrics
    try {
      const scriptPath = getCalibrationScriptPath();
      if (fs.existsSync(scriptPath) && qualityReport && qualityReport.totalEvidence > 0) {
        const cmd = [
          'ts-node',
          `"${scriptPath}"`,
          `--agent=evidence-tracker`,
          `--success=true`,
          `--effectiveness=good`,
          `--evidence-total=${qualityReport.totalEvidence}`,
          `--evidence-with-hash=${qualityReport.withContentHash}`,
          `--evidence-with-lines=${qualityReport.withExactLines}`,
          `--evidence-completeness=${qualityReport.avgCompleteness}`,
          `--evidence-precision=${qualityReport.avgPrecision}`,
          `--evidence-verifiability=${qualityReport.avgVerifiability}`,
        ].join(' ');

        execSync(cmd, {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 15000,
        });
      }
    } catch (err: any) {
      const stderr = err.stderr || err.message || 'unknown error';
      console.warn(`⚠️  Evidence quality calibration update failed: ${stderr.trim()}`);
    }
  }

  // 7. Print summary
  printSummary(ctx, args, retrospective, historyAgents.size, lessonsCount, stalenessReport, qualityReport);

  process.exit(0);
}

main();
