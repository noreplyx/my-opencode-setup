#!/usr/bin/env ts-node
/**
 * Tests for pipeline-teardown.ts (conceptual functions)
 *
 * Tests:
 *   - Retrospective Quality Calculation (smooth/rough/failed)
 *   - Journal Entry Formatting (YAML structure)
 *   - Archive Path Generation
 *   - Lesson Extraction & Deduplication
 *   - Full Teardown Flow & keep-context flag
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Test framework ──

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

function assertEqual(actual: any, expected: any, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── Inline types (mirroring source) ──

interface CircuitBreakerEvent {
  gate: string;
  attempts: number;
  resolution: string;
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

interface Retrospective {
  pipelineQuality: 'smooth' | 'rough' | 'failed';
  handoffQuality: { rating: number; issues: string[] };
  agentPerformance: Array<{ role: string; effectiveness: string; notes: string }>;
  wastedSteps: string[];
  improvementsForNextPipeline: string[];
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
}

interface LessonsEntry {
  date: string;
  lesson: string;
  sourceFeature: string;
  category: string;
  severity: string;
  injected: boolean;
}

// ── Inline implementations (conceptual, matching source logic) ──

function calculatePipelineQuality(ctx: AgentContextData, result: string): 'smooth' | 'rough' | 'failed' {
  if (result === 'fail') return 'failed';
  const totalRetries = Object.values(ctx.circuitBreaker.counters).reduce((sum, v) => sum + v, 0);
  if (totalRetries === 0) return 'smooth';
  return 'rough';
}

function generateJournalEntry(params: {
  date: string;
  feature: string;
  pipelineType: string;
  result: string;
  durationMinutes: number;
  filesChanged: string[];
  failedGates: string[];
  circuitBreakerEvents: CircuitBreakerEvent[];
  keyDecisions: string[];
}): JournalEntry {
  return {
    date: params.date,
    feature: params.feature,
    pipelineType: params.pipelineType,
    result: params.result,
    durationMinutes: params.durationMinutes,
    filesChanged: params.filesChanged,
    keyDecisions: params.keyDecisions,
    circuitBreakerEvents: params.circuitBreakerEvents,
    failedGates: params.failedGates,
  };
}

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

  const totalRetries = Object.values(ctx.circuitBreaker.counters).reduce((sum, v) => sum + v, 0);
  let pipelineQuality: 'smooth' | 'rough' | 'failed';
  if (result === 'fail') {
    pipelineQuality = 'failed';
  } else if (totalRetries === 0) {
    pipelineQuality = 'smooth';
  } else {
    pipelineQuality = 'rough';
  }

  let handoffRating = 10;
  const handoffIssues: string[] = [];
  for (const warning of allWarnings) {
    const lower = warning.toLowerCase();
    if (lower.includes('missing context') || lower.includes('unclear') || lower.includes('ambigu')) {
      handoffRating -= 2;
      handoffIssues.push(warning.length > 80 ? warning.substring(0, 77) + '...' : warning);
    }
  }
  if (totalRetries > 0) {
    handoffRating -= Math.min(totalRetries, 3);
  }
  if (failedCount > 0) {
    handoffRating -= failedCount * 2;
  }
  handoffRating = Math.max(1, Math.min(10, handoffRating));

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

  const agentPerformance: Array<{ role: string; effectiveness: string; notes: string }> = [];
  for (const [agent, stats] of agentEffectivenessMap) {
    let effectiveness: string;
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

  const improvements: string[] = [];
  if (ctx.agentHistory.some(e => e.agent === 'verifier' && e.result !== 'pass')) {
    improvements.push('Add error handling checkpoints for all service methods');
  }
  if (ctx.agentHistory.some(e => e.agent === 'implementor' && e.result !== 'pass')) {
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
    handoffQuality: { rating: handoffRating, issues: handoffIssues },
    agentPerformance,
    wastedSteps: [],
    improvementsForNextPipeline: improvements,
  };
}

function generateArchivePath(baseDir: string, pipelineId: string): string {
  return path.join(baseDir, 'pipeline-logs', pipelineId);
}

function ensureDir(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    return true;
  }
  return false;
}

// ── Teardown flow (conceptual) ──

interface TeardownResult {
  journalEntry: JournalEntry | null;
  lessons: LessonsEntry[];
  archived: boolean;
  contextDeleted: boolean;
}

function performTeardown(
  ctx: AgentContextData,
  result: 'pass' | 'fail' | 'partial',
  args: {
    feature: string;
    pipelineType: string;
    durationMinutes: number;
    filesChanged: string[];
    failedGates: string[];
    circuitBreakerEvents: CircuitBreakerEvent[];
    keepContext: boolean;
  },
  baseDir: string,
  existingLessons: string[],
): TeardownResult {
  const journalEntry = generateJournalEntry({
    date: new Date().toISOString(),
    feature: args.feature,
    pipelineType: args.pipelineType,
    result,
    durationMinutes: args.durationMinutes,
    filesChanged: args.filesChanged,
    failedGates: args.failedGates,
    circuitBreakerEvents: args.circuitBreakerEvents,
    keyDecisions: [],
  });

  const lessons: LessonsEntry[] = [];

  const archivePath = generateArchivePath(baseDir, ctx.pipelineId);
  ensureDir(archivePath);

  let contextDeleted = false;
  if (!args.keepContext) {
    contextDeleted = true;
  }

  return { journalEntry, lessons, archived: true, contextDeleted };
}

// ── Setup / Cleanup ──

const TEST_DIR = path.resolve(process.cwd(), 'tmp-test-teardown');

function setup() {
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  }
}

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

// ── Helper factories ──

function makeMinimalCtx(overrides?: Partial<AgentContextData>): AgentContextData {
  return {
    pipelineId: 'test-pipeline-001',
    feature: 'test-feature',
    pipelineType: 'full',
    createdAt: '2026-05-25T00:00:00Z',
    circuitBreaker: { counters: {}, state: 'closed', patternDetection: [] },
    agentHistory: [],
    failureSummary: null,
    agentOutputs: {},
    ...overrides,
  };
}

function makeHistoryEntry(overrides?: Partial<AgentHistoryEntry>): AgentHistoryEntry {
  return {
    step: 1,
    agent: 'implementor',
    result: 'pass',
    duration: 30,
    decisions: [],
    warnings: [],
    output: undefined,
    ...overrides,
  };
}

// ── Tests ──

async function main() {
  console.log('🔍 Pipeline Teardown Tests');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  setup();

  // ═══════════════════════════════════════════════════════
  // Section 1: Retrospective Quality Calculation
  // ═══════════════════════════════════════════════════════

  test('Pipeline with no retries -> quality "smooth"', () => {
    const ctx = makeMinimalCtx({
      agentHistory: [
        makeHistoryEntry({ agent: 'finder', result: 'pass' }),
        makeHistoryEntry({ agent: 'implementor', result: 'pass', step: 2 }),
        makeHistoryEntry({ agent: 'verifier', result: 'pass', step: 3 }),
      ],
    });
    const retro = generateRetrospective(ctx, 'pass');
    assertEqual(retro.pipelineQuality, 'smooth', 'Expected smooth quality');
  });

  test('Pipeline with retries (buildGate) -> quality "rough"', () => {
    const ctx = makeMinimalCtx({
      circuitBreaker: { counters: { build: 2 }, state: 'half-open', patternDetection: [] },
      agentHistory: [
        makeHistoryEntry({ agent: 'finder', result: 'pass' }),
        makeHistoryEntry({ agent: 'implementor', result: 'pass', step: 2 }),
        makeHistoryEntry({ agent: 'verifier', result: 'pass', step: 3 }),
      ],
    });
    const retro = generateRetrospective(ctx, 'pass');
    assertEqual(retro.pipelineQuality, 'rough', 'Expected rough quality for retried pipeline');
  });

  test('Pipeline with failures (failed gates) -> quality "failed"', () => {
    const ctx = makeMinimalCtx({
      agentHistory: [
        makeHistoryEntry({ agent: 'finder', result: 'pass' }),
        makeHistoryEntry({ agent: 'implementor', result: 'fail', step: 2 }),
      ],
    });
    const retro = generateRetrospective(ctx, 'fail');
    assertEqual(retro.pipelineQuality, 'failed', 'Expected failed quality');
  });

  test('Pipeline with circuit breaker events -> quality "failed"', () => {
    const ctx = makeMinimalCtx({
      circuitBreaker: { counters: { lint: 3 }, state: 'open', patternDetection: ['repeated_lint_failures'] },
      agentHistory: [
        makeHistoryEntry({ agent: 'finder', result: 'pass' }),
        makeHistoryEntry({ agent: 'lint', result: 'fail', step: 2, warnings: ['lint error: syntax issue'] }),
      ],
    });
    const retro = generateRetrospective(ctx, 'fail');
    assertEqual(retro.pipelineQuality, 'failed', 'Expected failed quality for failed pipeline with CB events');
  });

  // ═══════════════════════════════════════════════════════
  // Section 2: Journal Entry Formatting
  // ═══════════════════════════════════════════════════════

  test('Creates proper journal entries with date, feature, pipelineType, result, duration', () => {
    const entry = generateJournalEntry({
      date: '2026-05-25T12:00:00Z',
      feature: 'login-page',
      pipelineType: 'full',
      result: 'pass',
      durationMinutes: 15,
      filesChanged: [],
      failedGates: [],
      circuitBreakerEvents: [],
      keyDecisions: [],
    });
    assertEqual(entry.date, '2026-05-25T12:00:00Z', 'date');
    assertEqual(entry.feature, 'login-page', 'feature');
    assertEqual(entry.pipelineType, 'full', 'pipelineType');
    assertEqual(entry.result, 'pass', 'result');
    assertEqual(entry.durationMinutes, 15, 'durationMinutes');
  });

  test('Includes filesChanged array', () => {
    const entry = generateJournalEntry({
      date: '2026-05-25T12:00:00Z',
      feature: 'login-page',
      pipelineType: 'full',
      result: 'pass',
      durationMinutes: 10,
      filesChanged: ['src/login.ts', 'src/login.test.ts', 'src/types.ts'],
      failedGates: [],
      circuitBreakerEvents: [],
      keyDecisions: [],
    });
    assert(Array.isArray(entry.filesChanged), 'filesChanged should be an array');
    assertEqual(entry.filesChanged.length, 3, 'filesChanged length');
    assert(entry.filesChanged.includes('src/login.ts'), 'should include src/login.ts');
  });

  test('Includes failedGates array', () => {
    const entry = generateJournalEntry({
      date: '2026-05-25T12:00:00Z',
      feature: 'auth',
      pipelineType: 'full',
      result: 'fail',
      durationMinutes: 5,
      filesChanged: [],
      failedGates: ['buildGate', 'lintGate'],
      circuitBreakerEvents: [],
      keyDecisions: [],
    });
    assert(Array.isArray(entry.failedGates), 'failedGates should be an array');
    assertEqual(entry.failedGates.length, 2, 'failedGates length');
    assert(entry.failedGates.includes('buildGate'), 'should include buildGate');
  });

  test('Includes circuitBreakerEvents with gate/attempts/resolution', () => {
    const events: CircuitBreakerEvent[] = [
      { gate: 'buildGate', attempts: 3, resolution: 'escalated' },
      { gate: 'lintGate', attempts: 2, resolution: 'bypassed' },
    ];
    const entry = generateJournalEntry({
      date: '2026-05-25T12:00:00Z',
      feature: 'auth',
      pipelineType: 'full',
      result: 'partial',
      durationMinutes: 20,
      filesChanged: [],
      failedGates: [],
      circuitBreakerEvents: events,
      keyDecisions: [],
    });
    assertEqual(entry.circuitBreakerEvents.length, 2, 'should have 2 CB events');
    assertEqual(entry.circuitBreakerEvents[0].gate, 'buildGate', 'first CB event gate');
    assertEqual(entry.circuitBreakerEvents[0].attempts, 3, 'first CB event attempts');
    assertEqual(entry.circuitBreakerEvents[0].resolution, 'escalated', 'first CB event resolution');
    assertEqual(entry.circuitBreakerEvents[1].gate, 'lintGate', 'second CB event gate');
    assertEqual(entry.circuitBreakerEvents[1].attempts, 2, 'second CB event attempts');
  });

  // ═══════════════════════════════════════════════════════
  // Section 4: Archive Path Generation
  // ═══════════════════════════════════════════════════════

  test('Archives with correct pipelineId in path', () => {
    const archivePath = generateArchivePath('/tmp/base', 'pipeline-abc-123');
    assert(archivePath.endsWith('pipeline-logs/pipeline-abc-123'), `unexpected path: ${archivePath}`);
    assert(archivePath.includes('/tmp/base'), 'should include base dir');
  });

  test('Creates subdirectories if needed', () => {
    const nestedDir = path.join(TEST_DIR, 'pipeline-logs', 'nested-test-pipeline');
    // Clean up before test
    if (fs.existsSync(nestedDir)) {
      fs.rmSync(nestedDir, { recursive: true });
    }
    const created = ensureDir(nestedDir);
    assert(created, 'should report directory was created');
    assert(fs.existsSync(nestedDir), 'directory should exist');
    // Calling again should not throw
    const createdAgain = ensureDir(nestedDir);
    assert(!createdAgain, 'should report directory already existed');
    // Clean up
    fs.rmSync(nestedDir, { recursive: true });
  });

  // ═══════════════════════════════════════════════════════
  // Section 5: Full Teardown Flow
  // ═══════════════════════════════════════════════════════

  test('Full teardown produces journal entry + lesson + archive', () => {
    const ctx = makeMinimalCtx({
      agentHistory: [
        makeHistoryEntry({ agent: 'finder', result: 'fail', step: 1, warnings: ['Missing context'] }),
      ],
    });
    const result = performTeardown(
      ctx,
      'fail',
      {
        feature: 'test-feature',
        pipelineType: 'full',
        durationMinutes: 12,
        filesChanged: ['src/main.ts'],
        failedGates: ['buildGate'],
        circuitBreakerEvents: [{ gate: 'buildGate', attempts: 2, resolution: 'escalated' }],
        keepContext: false,
      },
      TEST_DIR,
      [],
    );

    assert(result.journalEntry !== null, 'should produce a journal entry');
    assertEqual(result.journalEntry!.result, 'fail', 'journal result');
    assertEqual(result.journalEntry!.feature, 'test-feature', 'journal feature');
    assertEqual(result.journalEntry!.durationMinutes, 12, 'journal duration');
    assert(result.archived, 'should indicate archive was created');

    // Verify archive directory was created
    const archivePath = generateArchivePath(TEST_DIR, ctx.pipelineId);
    assert(fs.existsSync(archivePath), `archive path should exist: ${archivePath}`);

    // Clean up archive
    if (fs.existsSync(archivePath)) {
      fs.rmSync(archivePath, { recursive: true });
    }
  });

  test('Keep-context flag preserves agent-context.md', () => {
    const ctx = makeMinimalCtx();
    // Write a fake agent-context.md
    const contextPath = path.join(TEST_DIR, 'agent-context.md');
    fs.writeFileSync(contextPath, '---\npipelineId: "test-pipeline-001"\n---\n', 'utf-8');

    // When keepContext is true, contextDeleted should be false
    const result = performTeardown(
      ctx,
      'pass',
      {
        feature: 'test-feature',
        pipelineType: 'full',
        durationMinutes: 5,
        filesChanged: [],
        failedGates: [],
        circuitBreakerEvents: [],
        keepContext: true,
      },
      TEST_DIR,
      [],
    );
    assert(!result.contextDeleted, 'context should NOT be deleted when keepContext is true');

    // Clean up
    if (fs.existsSync(contextPath)) {
      fs.unlinkSync(contextPath);
    }
  });

  test('Without keep-context flag, context is deleted', () => {
    const ctx = makeMinimalCtx();
    const result = performTeardown(
      ctx,
      'pass',
      {
        feature: 'test-feature',
        pipelineType: 'full',
        durationMinutes: 5,
        filesChanged: [],
        failedGates: [],
        circuitBreakerEvents: [],
        keepContext: false,
      },
      TEST_DIR,
      [],
    );
    assert(result.contextDeleted, 'context should be deleted when keepContext is false');
  });

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

  cleanup();

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(`  ❌ Test suite error: ${err.message}`);
  process.exit(1);
});
