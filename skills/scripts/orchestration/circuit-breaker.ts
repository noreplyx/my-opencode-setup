#!/usr/bin/env node
/**
 * Circuit Breaker Script
 *
 * Encodes the circuit breaker logic from circuit-breaker.md into an
 * executable tool. Manages pipeline state across 5 modes:
 *
 *   check             — Read state & determine current CB status
 *   record-failure    — Record a gate failure (count, signature, cycle detect)
 *   record-success    — Record a gate success (reset counter)
 *   status            — Print human-readable report
 *   notify-escalation — Notify user/agent and update CB state
 *
 * Storage: .opencode/circuit-breaker/<pipeline-id>.json
 *
 * Usage:
 *   [runtime] circuit-breaker.ts check --pipeline-id=<id> [--context=agent-context.md]
 *   [runtime] circuit-breaker.ts record-failure --pipeline-id=<id> --gate=<g> --agent=<a> --classification=<c> --primary-cause="<txt>" [--context=...]
 *   [runtime] circuit-breaker.ts record-success --pipeline-id=<id> --gate=<g> [--context=...]
 *   [runtime] circuit-breaker.ts status --pipeline-id=<id> [--context=...]
 *   [runtime] circuit-breaker.ts notify-escalation --pipeline-id=<id> --target=<t> --reason="<r>" [--context=...]
 *
 * Exit codes:
 *   0 = Success / all clear
 *   1 = Error (CLI usage, file I/O, etc)
 *   For `check`: 0 = all clear, 1 = escalation needed (pipe-friendly)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GATES = ['build', 'lint', 'securityScan', 'smokeTest', 'verifier'] as const;
type Gate = (typeof GATES)[number];

type CircuitState = 'closed' | 'open' | 'half-open';

type Classification =
  | 'plan-omission'
  | 'implementation-error'
  | 'edge-case-miss'
  | 'integration-mismatch'
  | 'environment-issue';

type Complexity = 'simple' | 'moderate' | 'complex';

type EscalationTarget = 'plandescriber' | 'fixer' | 'user';

type PipelineComplexity = 'simple' | 'moderate' | 'complex';

const VALID_CLASSIFICATIONS: Classification[] = [
  'plan-omission',
  'implementation-error',
  'edge-case-miss',
  'integration-mismatch',
  'environment-issue',
];

const VALID_AGENTS = [
  'orchestrator', 'finder', 'plandescriber', 'implementor',
  'fixer', 'qa', 'verifier', 'integrator', 'browser-tester',
  'documentor', 'security-scan',
] as const;

const VALID_ESCALATION_TARGETS: EscalationTarget[] = ['plandescriber', 'fixer', 'user'];

/** Contextual threshold map indexed by complexity then gate */
const THRESHOLD_MAP: Record<PipelineComplexity, Record<Gate, number>> = {
  simple:   { build: 1, lint: 1, securityScan: 1, smokeTest: 1, verifier: 1 },
  moderate: { build: 2, lint: 2, securityScan: 2, smokeTest: 2, verifier: 2 },
  complex:  { build: 3, lint: 3, securityScan: 3, smokeTest: 3, verifier: 3 },
};

/** Always the same, but exposed for readability */
const DEFAULT_COMPLEXITY: PipelineComplexity = 'moderate';

const DEFAULT_THRESHOLDS: Record<Gate, number> = THRESHOLD_MAP[DEFAULT_COMPLEXITY];

/** Decay window in milliseconds (24 hours) */
const DECAY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Max agent history entries to inspect for cycle detection */
const CYCLE_HISTORY_DEPTH = 5;

/** Max cycles before triggering */
const CYCLE_THRESHOLD = 3;

/** Signature collision: max distinct signatures before escalation rule fires */
const MAX_DISTINCT_SIGNATURES = 5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FailureSignature {
  signature: string;
  gate: Gate;
  agent: string;
  classification: Classification;
  primaryCause: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
}

interface CyclePatternEntry {
  pattern: string;
  occurrences: number;
  lastOccurrence: string;
  recommendedAction: string;
}

interface CircuitBreakerData {
  pipelineId: string;
  feature: string;
  pipelineComplexity: PipelineComplexity;
  state: CircuitState;
  thresholds: Record<Gate, number>;
  counters: Record<Gate, number>;
  failureSignatures: FailureSignature[];
  totalPipelineRetries: number;
  cyclePatternHistory: CyclePatternEntry[];
  agentDispatchHistory: string[];
  escalationHistory: string[];
  lastUpdated: string;
  lastFailureTimestamp: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoNow(): string {
  return new Date().toISOString();
}

function parseArgs(): Record<string, string> {
  const args = process.argv.slice(2);
  const result: Record<string, string> = {};

  // First non-flag argument is the mode
  const modeCandidate = args.find(a => !a.startsWith('--'));
  if (modeCandidate) {
    result._mode = modeCandidate;
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        // --key=value format
        const key = arg.slice(2, eqIdx);
        result[key] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        // Check if the next argument exists and is not a flag → --key value format
        if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
          result[key] = args[i + 1];
          i++; // skip the value
        } else {
          result[key] = 'true'; // boolean flag
        }
      }
    }
  }
  return result;
}

function computeSignature(gate: string, agent: string, classification: string, primaryCause: string): string {
  const input = `${gate}:${agent}:${classification}:${primaryCause}`;
  return crypto.createHash('sha256').update(input, 'utf-8').digest('hex');
}

function getStorageDir(contextPath?: string): string {
  // If a context path is provided, derive the workspace root from it
  if (contextPath) {
    const resolved = path.resolve(contextPath);
    const dir = path.dirname(resolved);
    return path.join(dir, '.opencode', 'circuit-breaker');
  }
  // Otherwise use the CWD
  return path.resolve('.opencode', 'circuit-breaker');
}

function getStateFilePath(pipelineId: string, contextPath?: string): string {
  const dir = getStorageDir(contextPath);
  return path.join(dir, `${pipelineId}.json`);
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Read / Write state
// ---------------------------------------------------------------------------

function readState(pipelineId: string, contextPath?: string): CircuitBreakerData | null {
  const filePath = getStateFilePath(pipelineId, contextPath);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as CircuitBreakerData;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error reading circuit breaker state: ${msg}`);
    return null;
  }
}

function writeState(data: CircuitBreakerData, contextPath?: string): boolean {
  const filePath = getStateFilePath(data.pipelineId, contextPath);
  try {
    ensureDir(filePath);
    data.lastUpdated = isoNow();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error writing circuit breaker state: ${msg}`);
    return false;
  }
}

function createDefaultState(pipelineId: string, options?: {
  feature?: string;
  pipelineComplexity?: PipelineComplexity;
}): CircuitBreakerData {
  const complexity = options?.pipelineComplexity ?? DEFAULT_COMPLEXITY;
  const thresholds = { ...THRESHOLD_MAP[complexity] };
  return {
    pipelineId,
    feature: options?.feature ?? 'unknown',
    pipelineComplexity: complexity,
    state: 'closed',
    thresholds,
    counters: { build: 0, lint: 0, securityScan: 0, smokeTest: 0, verifier: 0 },
    failureSignatures: [],
    totalPipelineRetries: 0,
    cyclePatternHistory: [],
    agentDispatchHistory: [],
    escalationHistory: [],
    lastUpdated: isoNow(),
    lastFailureTimestamp: null,
  };
}

// ---------------------------------------------------------------------------
// Agent dispatch history helper – reads from agent-context.md if provided
// ---------------------------------------------------------------------------

function readAgentDispatchHistory(contextPath?: string): string[] {
  if (!contextPath) return [];

  const resolvedPath = path.resolve(contextPath);
  if (!fs.existsSync(resolvedPath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    // Extract agentHistory from YAML frontmatter
    const agentHistory: string[] = [];

    // Simple YAML parser for agentHistory entries
    const historyMatch = content.match(/^agentHistory:\s*\n((?:\s+- .*\n?)*)/m);
    if (!historyMatch) return [];

    const historyBlock = historyMatch[1];
    const stepRegex = /step:\s*"([^"]+)"/g;
    let stepMatch: RegExpExecArray | null;
    while ((stepMatch = stepRegex.exec(historyBlock)) !== null) {
      agentHistory.push(stepMatch[1]);
    }

    return agentHistory;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Compute counter decay
// ---------------------------------------------------------------------------

function applyDecay(counters: Record<Gate, number>, lastFailureTimestamp: string | null): Record<Gate, number> {
  if (!lastFailureTimestamp) return { ...counters };

  try {
    const lastFailure = new Date(lastFailureTimestamp).getTime();
    const now = Date.now();
    const elapsed = now - lastFailure;

    if (elapsed >= DECAY_WINDOW_MS) {
      const decayed: Record<string, number> = {};
      for (const [gate, count] of Object.entries(counters)) {
        decayed[gate] = Math.max(0, count - 1);
      }
      return decayed as Record<Gate, number>;
    }
  } catch {
    // If timestamp is invalid, no decay
  }
  return { ...counters };
}

// ---------------------------------------------------------------------------
// Cycle pattern detection
// ---------------------------------------------------------------------------

interface CycleDetectionResult {
  cyclePatternDetected: boolean;
  cyclePatternType: string | null;
  updatedHistory: CyclePatternEntry[];
}

function detectCyclePatterns(
  agentDispatchHistory: string[],
  existingHistory: CyclePatternEntry[],
): CycleDetectionResult {
  if (agentDispatchHistory.length < 3) {
    return { cyclePatternDetected: false, cyclePatternType: null, updatedHistory: existingHistory };
  }

  // Look at the last N entries (up to CYCLE_HISTORY_DEPTH)
  const recent = agentDispatchHistory.slice(-CYCLE_HISTORY_DEPTH);

  // Pattern detection: check for repeating patterns in the last entries
  const detectedPatterns: string[] = [];

  // Pattern: fixer→verifier→fixer (triple pattern)
  if (recent.length >= 3) {
    const last3 = recent.slice(-3);
    if (last3[0] === 'fixer' && last3[1] === 'verifier' && last3[2] === 'fixer') {
      detectedPatterns.push('fixer-verifier-loop');
    }
  }

  // Pattern: fixer→verifier→fixer→verifier (quadruple pattern)
  if (recent.length >= 4) {
    const last4 = recent.slice(-4);
    if (
      last4[0] === 'fixer' && last4[1] === 'verifier' &&
      last4[2] === 'fixer' && last4[3] === 'verifier'
    ) {
      if (!detectedPatterns.includes('fixer-verifier-loop')) {
        detectedPatterns.push('fixer-verifier-loop');
      }
    }
  }

  // Pattern: implementor→build→fixer→build
  if (recent.length >= 4) {
    const last4 = recent.slice(-4);
    if (
      last4[0] === 'implementor' && last4[1] === 'build' &&
      last4[2] === 'fixer' && last4[3] === 'build'
    ) {
      detectedPatterns.push('implementor-build-loop');
    }
  }

  // Pattern: any agent repeating twice in a row (e.g., fixer→fixer)
  if (recent.length >= 2) {
    const last2 = recent.slice(-2);
    if (last2[0] === last2[1]) {
      detectedPatterns.push(`${last2[0]}-repeat-loop`);
    }
  }

  // Update history with detected patterns
  const updatedHistory = [...existingHistory];
  const now = isoNow();

  for (const pattern of detectedPatterns) {
    const existing = updatedHistory.find(e => e.pattern === pattern);
    if (existing) {
      existing.occurrences += 1;
      existing.lastOccurrence = now;
    } else {
      updatedHistory.push({
        pattern,
        occurrences: 1,
        lastOccurrence: now,
        recommendedAction: pattern === 'fixer-verifier-loop'
          ? 'escalate-to-plandescriber'
          : 'manual-review',
      });
    }
  }

  const cyclePatternDetected = detectedPatterns.length > 0;
  const cyclePatternType = cyclePatternDetected ? detectedPatterns[0] : null;

  return { cyclePatternDetected, cyclePatternType, updatedHistory };
}

// ---------------------------------------------------------------------------
// Evaluate escalation rules
// ---------------------------------------------------------------------------

interface EscalationEval {
  escalationNeeded: boolean;
  escalationTarget: EscalationTarget | null;
  escalationReason: string | null;
  newState: CircuitState;
  blockedGates: Gate[];
  imminentEscalationWarnings: string[];
}

function evaluateEscalation(data: CircuitBreakerData): EscalationEval {
  const blockedGates: Gate[] = [];
  const imminentWarnings: string[] = [];
  let escalationNeeded = false;
  let escalationTarget: EscalationTarget | null = null;
  let escalationReason: string | null = null;
  let newState: CircuitState = data.state;

  // ---- Check gate counters against thresholds ----
  for (const gate of GATES) {
    const threshold = data.thresholds[gate];
    const count = data.counters[gate];
    if (count >= threshold) {
      blockedGates.push(gate);
    }
    if (count === threshold - 1 && count >= 0 && threshold > 1) {
      imminentWarnings.push(`Gate "${gate}" at ${count}/${threshold} — one more failure triggers escalation`);
    }
  }

  // ---- Rule 1: Same signature count >= 3 → OPEN → escalate to user ----
  for (const sig of data.failureSignatures) {
    if (sig.count >= 3) {
      newState = 'open';
      escalationNeeded = true;
      escalationTarget = 'user';
      escalationReason = `Same failure signature repeated ${sig.count}x: gate="${sig.gate}", agent="${sig.agent}", classification="${sig.classification}", cause="${sig.primaryCause}"`;
      return {
        escalationNeeded, escalationTarget, escalationReason, newState,
        blockedGates, imminentEscalationWarnings: imminentWarnings,
      };
    }
  }

  // ---- Rule 2: Same classification appears in >= 3 distinct signatures → HALF-OPEN → PlanDescriber ----
  const classificationCounts: Record<string, number> = {};
  for (const sig of data.failureSignatures) {
    classificationCounts[sig.classification] = (classificationCounts[sig.classification] || 0) + 1;
  }
  for (const [classification, count] of Object.entries(classificationCounts)) {
    if (count >= 3) {
      // Only escalate if there are at least 3 distinct signatures (not same signature counted multiple times)
      const distinctSigsWithClassification = data.failureSignatures.filter(
        s => s.classification === classification,
      ).length;
      if (distinctSigsWithClassification >= 3) {
        newState = 'half-open';
        escalationNeeded = true;
        escalationTarget = 'plandescriber';
        escalationReason = `Same classification "${classification}" appears in ${distinctSigsWithClassification} distinct failure signatures — root cause category keeps recurring`;
        return {
          escalationNeeded, escalationTarget, escalationReason, newState,
          blockedGates, imminentEscalationWarnings: imminentWarnings,
        };
      }
    }
  }

  // ---- Rule 3: Fixer→Verifier cycle repeats >= 3 times → HALF-OPEN → PlanDescriber ----
  const fixerVerifierCycle = data.cyclePatternHistory.find(
    e => e.pattern === 'fixer-verifier-loop',
  );
  if (fixerVerifierCycle && fixerVerifierCycle.occurrences >= CYCLE_THRESHOLD) {
    newState = 'half-open';
    escalationNeeded = true;
    escalationTarget = 'plandescriber';
    escalationReason = `Fixer→Verifier cycle detected ${fixerVerifierCycle.occurrences}x — loop detected, skip Fixer and go directly to PlanDescriber`;
    return {
      escalationNeeded, escalationTarget, escalationReason, newState,
      blockedGates, imminentEscalationWarnings: imminentWarnings,
    };
  }

  // ---- Rule 4: >= 5 distinct signatures with mixed classifications → OPEN → user ----
  const distinctSignatures = data.failureSignatures.length;
  const uniqueClassifications = new Set(data.failureSignatures.map(s => s.classification));
  if (distinctSignatures >= MAX_DISTINCT_SIGNATURES && uniqueClassifications.size >= 2) {
    newState = 'open';
    escalationNeeded = true;
    escalationTarget = 'user';
    escalationReason = `${distinctSignatures} distinct failure signatures with ${uniqueClassifications.size} different classifications — multiple different failures, needs user review`;
    return {
      escalationNeeded, escalationTarget, escalationReason, newState,
      blockedGates, imminentEscalationWarnings: imminentWarnings,
    };
  }

  // ---- If blocked gates but no signature-based escalation, still flag ----
  if (blockedGates.length > 0 && !escalationNeeded) {
    escalationNeeded = true;
    escalationTarget = 'user';
    escalationReason = `Gate(s) at threshold: ${blockedGates.join(', ')} — max retry count reached`;
  }

  return {
    escalationNeeded,
    escalationTarget,
    escalationReason,
    newState,
    blockedGates,
    imminentEscalationWarnings: imminentWarnings,
  };
}

// ---------------------------------------------------------------------------
// MODE: check
// ---------------------------------------------------------------------------

function modeCheck(pipelineId: string, contextPath?: string): void {
  let data = readState(pipelineId, contextPath);

  // If no state exists, return default "closed" with no warnings
  if (!data) {
    const result = {
      state: 'closed' as const,
      allGatesPassed: true,
      blockedGates: [] as string[],
      escalationNeeded: false,
      escalationTarget: null as string | null,
      escalationReason: null as string | null,
      imminentEscalationWarnings: [] as string[],
      cyclePatternDetected: false,
      cyclePatternType: null as string | null,
      failureSignatures: [] as FailureSignature[],
    };
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
    return;
  }

  // Apply decay before checking
  data.counters = applyDecay(data.counters, data.lastFailureTimestamp);

  // Read agent dispatch history from context for cycle detection
  const agentHistory = readAgentDispatchHistory(contextPath);
  const combinedHistory = agentHistory.length > 0
    ? agentHistory
    : data.agentDispatchHistory;

  const cycleResult = detectCyclePatterns(combinedHistory, data.cyclePatternHistory);

  const escalation = evaluateEscalation(data);

  const allGatesPassed = GATES.every(g => data.counters[g] < data.thresholds[g]);

  const result = {
    state: escalation.newState,
    allGatesPassed,
    blockedGates: escalation.blockedGates,
    escalationNeeded: escalation.escalationNeeded,
    escalationTarget: escalation.escalationTarget,
    escalationReason: escalation.escalationReason,
    imminentEscalationWarnings: escalation.imminentEscalationWarnings,
    cyclePatternDetected: cycleResult.cyclePatternDetected,
    cyclePatternType: cycleResult.cyclePatternType,
    failureSignatures: data.failureSignatures,
    counters: data.counters,
    thresholds: data.thresholds,
    totalPipelineRetries: data.totalPipelineRetries,
    cyclePatternHistory: cycleResult.updatedHistory,
    agentDispatchHistory: combinedHistory,
  };

  console.log(JSON.stringify(result, null, 2));

  // Exit code: 0 = all clear, 1 = escalation needed
  if (escalation.escalationNeeded) {
    process.exit(1);
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// MODE: record-failure
// ---------------------------------------------------------------------------

function modeRecordFailure(
  pipelineId: string,
  gate: string,
  agent: string,
  classification: string,
  primaryCause: string,
  contextPath?: string,
): void {
  // Validate inputs
  if (!GATES.includes(gate as Gate)) {
    console.error(`Invalid gate "${gate}". Valid gates: ${GATES.join(', ')}`);
    process.exit(1);
  }
  if (!VALID_AGENTS.includes(agent as typeof VALID_AGENTS[number])) {
    console.error(`Invalid agent "${agent}". Valid agents: ${VALID_AGENTS.join(', ')}`);
    process.exit(1);
  }
  if (!VALID_CLASSIFICATIONS.includes(classification as Classification)) {
    console.error(`Invalid classification "${classification}". Valid: ${VALID_CLASSIFICATIONS.join(', ')}`);
    process.exit(1);
  }
  if (!primaryCause || primaryCause.trim().length === 0) {
    console.error('primary-cause must be a non-empty string');
    process.exit(1);
  }

  let data = readState(pipelineId, contextPath);
  const dispatchHistory = readAgentDispatchHistory(contextPath);

  if (!data) {
    data = createDefaultState(pipelineId);
  }

  // Apply decay before recording
  data.counters = applyDecay(data.counters, data.lastFailureTimestamp);

  // Increment gate counter
  const gateKey = gate as Gate;
  data.counters[gateKey] = (data.counters[gateKey] || 0) + 1;
  data.totalPipelineRetries += 1;
  data.lastFailureTimestamp = isoNow();

  // Compute failure signature
  const signature = computeSignature(gate, agent, classification, primaryCause);

  // Find or create signature entry
  const existingSig = data.failureSignatures.find(s => s.signature === signature);
  const now = isoNow();
  if (existingSig) {
    existingSig.count += 1;
    existingSig.lastSeen = now;
  } else {
    data.failureSignatures.push({
      signature,
      gate: gate as Gate,
      agent,
      classification: classification as Classification,
      primaryCause,
      count: 1,
      firstSeen: now,
      lastSeen: now,
    });
  }

  // Update agent dispatch history
  if (dispatchHistory.length > 0) {
    data.agentDispatchHistory = dispatchHistory;
  }
  data.agentDispatchHistory.push(agent);

  // Detect cycle patterns
  const cycleResult = detectCyclePatterns(data.agentDispatchHistory, data.cyclePatternHistory);
  data.cyclePatternHistory = cycleResult.updatedHistory;

  // Evaluate escalation
  const escalation = evaluateEscalation(data);
  data.state = escalation.newState;

  // If escalation needed, record it
  if (escalation.escalationNeeded) {
    data.escalationHistory.push(
      `[${now}] escalation to ${escalation.escalationTarget}: ${escalation.escalationReason}`,
    );
  }

  // Persist
  if (!writeState(data, contextPath)) {
    console.error('Failed to write circuit breaker state');
    process.exit(1);
  }

  const result = {
    recorded: true,
    pipelineId,
    gate,
    agent,
    classification,
    signature,
    signatureCount: existingSig ? existingSig.count : 1,
    state: data.state,
    counters: data.counters,
    totalPipelineRetries: data.totalPipelineRetries,
    escalationNeeded: escalation.escalationNeeded,
    escalationTarget: escalation.escalationTarget,
    escalationReason: escalation.escalationReason,
    cyclePatternDetected: cycleResult.cyclePatternDetected,
    cyclePatternType: cycleResult.cyclePatternType,
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// MODE: record-success
// ---------------------------------------------------------------------------

function modeRecordSuccess(
  pipelineId: string,
  gate: string,
  contextPath?: string,
): void {
  // Validate
  if (!GATES.includes(gate as Gate)) {
    console.error(`Invalid gate "${gate}". Valid gates: ${GATES.join(', ')}`);
    process.exit(1);
  }

  let data = readState(pipelineId, contextPath);

  if (!data) {
    // If no state exists, nothing to reset — still succeed
    const result = {
      recorded: true,
      pipelineId,
      gate,
      state: 'closed' as const,
      counters: { build: 0, lint: 0, securityScan: 0, smokeTest: 0, verifier: 0 },
      allGatesZero: true,
      info: 'No prior state existed — created fresh',
    };
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
    return;
  }

  // Reset counter for this gate
  data.counters[gate as Gate] = 0;

  // If all gates are at 0, set state to closed
  const allGatesZero = GATES.every(g => data.counters[g] === 0);
  if (allGatesZero) {
    data.state = 'closed';
  }

  if (!writeState(data, contextPath)) {
    console.error('Failed to write circuit breaker state');
    process.exit(1);
  }

  const result = {
    recorded: true,
    pipelineId,
    gate,
    state: data.state,
    counters: data.counters,
    allGatesZero,
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// MODE: status (human-readable report)
// ---------------------------------------------------------------------------

function modeStatus(pipelineId: string, contextPath?: string): void {
  const data = readState(pipelineId, contextPath);

  if (!data) {
    console.log('========================================');
    console.log('  CIRCUIT BREAKER STATUS');
    console.log('========================================');
    console.log('');
    console.log(`  Pipeline:     ${pipelineId}`);
    console.log(`  State:        CLOSED (no state file found)`);
    console.log(`  Feature:      unknown`);
    console.log(`  Complexity:   ${DEFAULT_COMPLEXITY}`);
    console.log('');
    console.log('  No failures recorded yet. All clear.');
    console.log('========================================');
    process.exit(0);
    return;
  }

  // Apply decay
  data.counters = applyDecay(data.counters, data.lastFailureTimestamp);

  const escalation = evaluateEscalation(data);

  console.log('========================================');
  console.log('  CIRCUIT BREAKER STATUS');
  console.log('========================================');
  console.log('');
  console.log(`  Pipeline:     ${data.pipelineId}`);
  console.log(`  Feature:      ${data.feature}`);
  console.log(`  State:        ${data.state.toUpperCase()}`);
  console.log(`  Complexity:   ${data.pipelineComplexity}`);
  console.log(`  Last Updated: ${data.lastUpdated}`);
  console.log(`  Last Failure: ${data.lastFailureTimestamp ?? 'none'}`);
  console.log(`  Total Retries: ${data.totalPipelineRetries}`);
  console.log('');

  // Gate table
  console.log('  ── GATE COUNTERS ──');
  console.log(`  ${'Gate'.padEnd(16)} ${'Count'.padEnd(8)} ${'Threshold'.padEnd(12)} ${'Status'}`);
  console.log(`  ${'─'.repeat(16)} ${'─'.repeat(8)} ${'─'.repeat(12)} ${'─'.repeat(10)}`);
  for (const gate of GATES) {
    const count = data.counters[gate];
    const threshold = data.thresholds[gate];
    const status = count >= threshold
      ? '❌ BLOCKED'
      : count === 0
        ? '✅ OK'
        : `⚠️  ${count}/${threshold}`;
    console.log(`  ${gate.padEnd(16)} ${String(count).padEnd(8)} ${String(threshold).padEnd(12)} ${status}`);
  }

  if (data.failureSignatures.length > 0) {
    console.log('');
    console.log('  ── FAILURE SIGNATURES ──');
    for (const sig of data.failureSignatures) {
      console.log(`  [${sig.signature.substring(0, 12)}…] gate=${sig.gate} agent=${sig.agent} class=${sig.classification} count=${sig.count}`);
      console.log(`         cause: ${sig.primaryCause}`);
    }
  }

  if (data.cyclePatternHistory.length > 0) {
    console.log('');
    console.log('  ── CYCLE PATTERNS ──');
    for (const entry of data.cyclePatternHistory) {
      console.log(`  ${entry.pattern}: ${entry.occurrences}x (last: ${entry.lastOccurrence}) → ${entry.recommendedAction}`);
    }
  }

  if (escalation.escalationNeeded) {
    console.log('');
    console.log(`  ── ESCALATION REQUIRED ──`);
    console.log(`  Target: ${escalation.escalationTarget}`);
    console.log(`  Reason: ${escalation.escalationReason}`);
  }

  if (escalation.blockedGates.length > 0) {
    console.log('');
    console.log(`  ── BLOCKED GATES ──`);
    for (const g of escalation.blockedGates) {
      console.log(`  ❌ ${g}`);
    }
  }

  if (escalation.imminentEscalationWarnings.length > 0) {
    console.log('');
    console.log('  ── WARNINGS (near threshold) ──');
    for (const w of escalation.imminentEscalationWarnings) {
      console.log(`  ⚠️  ${w}`);
    }
  }

  console.log('');
  console.log('========================================');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// MODE: notify-escalation
// ---------------------------------------------------------------------------

function modeNotifyEscalation(
  pipelineId: string,
  target: string,
  reason: string,
  contextPath?: string,
): void {
  // Validate
  if (!VALID_ESCALATION_TARGETS.includes(target as EscalationTarget)) {
    console.error(`Invalid escalation target "${target}". Valid targets: ${VALID_ESCALATION_TARGETS.join(', ')}`);
    process.exit(1);
  }
  if (!reason || reason.trim().length === 0) {
    console.error('--reason must be a non-empty string');
    process.exit(1);
  }

  let data = readState(pipelineId, contextPath);
  if (!data) {
    data = createDefaultState(pipelineId);
  }

  const now = isoNow();

  // Determine new state based on target
  if (target === 'user') {
    data.state = 'open';
  } else if (target === 'plandescriber') {
    data.state = data.state === 'open' ? 'open' : 'half-open';
  } else if (target === 'fixer') {
    data.state = 'half-open';
  }

  // Record escalation
  data.escalationHistory.push(`[${now}] Escalated to ${target}: ${reason}`);

  if (!writeState(data, contextPath)) {
    console.error('Failed to write circuit breaker state');
    process.exit(1);
  }

  const result = {
    notified: true,
    pipelineId,
    escalationTarget: target,
    escalationReason: reason,
    newState: data.state,
    escalationHistory: data.escalationHistory,
    timestamp: now,
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}


// ---------------------------------------------------------------------------
// MODE: reset (full reset � used after PlanDescriber revises plan)
// ---------------------------------------------------------------------------

function modeReset(
  pipelineId: string,
  contextPath?: string,
): void {
  let data = readState(pipelineId, contextPath);
  if (!data) {
    const result = {
      reset: true,
      pipelineId,
      state: 'closed',
      note: 'No prior state existed',
    };
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
    return;
  }

  // Full reset: zero counters, clear signatures, close circuit
  for (const gate of GATES) {
    data.counters[gate] = 0;
  }
  data.failureSignatures = [];
  data.totalPipelineRetries = 0;
  data.state = 'closed';
  data.lastFailureTimestamp = null;

  if (!writeState(data, contextPath)) {
    console.error('Failed to write circuit breaker state after reset');
    process.exit(1);
  }

  const result = {
    reset: true,
    pipelineId,
    state: 'closed' as const,
    counters: data.counters,
    failureSignaturesCleared: true,
    totalPipelineRetries: 0,
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}
// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs();
  const mode = args._mode;

  if (!mode) {
    console.error('Usage: circuit-breaker.ts <mode> [options]');
    console.error('');
    console.error('Modes:');
    console.error('  check              Read state & determine CB status');
    console.error('  record-failure     Record a gate failure');
    console.error('  record-success     Record a gate success');
    console.error('  status             Print human-readable report');
    console.error('  notify-escalation  Trigger escalation & update state');
    console.error('  reset              Full reset after PlanDescriber revises plan');
    process.exit(1);
  }

  const pipelineId = args['pipeline-id'];
  const contextPath = args['context'];

  switch (mode) {
    case 'check': {
      if (!pipelineId) {
        console.error('--pipeline-id=<id> is required for check mode');
        process.exit(1);
      }
      modeCheck(pipelineId, contextPath);
      break;
    }

    case 'record-failure': {
      const gate = args['gate'];
      const agent = args['agent'];
      const classification = args['classification'];
      const primaryCause = args['primary-cause'];

      if (!pipelineId) { console.error('--pipeline-id=<id> is required'); process.exit(1); }
      if (!gate) { console.error('--gate=<gate> is required'); process.exit(1); }
      if (!agent) { console.error('--agent=<agent> is required'); process.exit(1); }
      if (!classification) { console.error('--classification=<classification> is required'); process.exit(1); }
      if (!primaryCause) { console.error('--primary-cause="<cause>" is required'); process.exit(1); }

      modeRecordFailure(pipelineId, gate, agent, classification, primaryCause, contextPath);
      break;
    }

    case 'record-success': {
      const gate = args['gate'];
      if (!pipelineId) { console.error('--pipeline-id=<id> is required'); process.exit(1); }
      if (!gate) { console.error('--gate=<gate> is required'); process.exit(1); }

      modeRecordSuccess(pipelineId, gate, contextPath);
      break;
    }

    case 'status': {
      if (!pipelineId) {
        console.error('--pipeline-id=<id> is required for status mode');
        process.exit(1);
      }
      modeStatus(pipelineId, contextPath);
      break;
    }

    case 'notify-escalation': {
      const target = args['target'];
      const reason = args['reason'];
      if (!pipelineId) { console.error('--pipeline-id=<id> is required'); process.exit(1); }
      if (!target) { console.error('--target=<target> is required'); process.exit(1); }
      if (!reason) { console.error('--reason="<reason>" is required'); process.exit(1); }

      modeNotifyEscalation(pipelineId, target, reason, contextPath);
      break;
    }

    case 'reset': {
      if (!pipelineId) {
        console.error('--pipeline-id=<id> is required for reset mode');
        process.exit(1);
      }
      modeReset(pipelineId, contextPath);
      break;
    }

    default: {
      console.error(`Unknown mode "${mode}". Valid modes: check, record-failure, record-success, status, notify-escalation, reset`);
      process.exit(1);
    }
  }
}

main();

