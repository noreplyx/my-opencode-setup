#!/usr/bin/env node
/**
 * Delegation Gate — Orchestrator Delegation Validator
 *
 * Validates that the Orchestrator delegated ALL substantive work (research,
 * planning, implementation, verification) to subagents via the `task()` tool.
 * The Orchestrator should ONLY use read/glob/grep for verification, NEVER for
 * research or discovery. Any orchestrator step that performs implementation
 * work (changedFiles, "I created", "I implemented" language) is flagged.
 *
 * Usage:
 *   [runtime] skills/scripts/orchestration/delegation-gate.ts --context=agent-context.md
 *   [runtime] skills/scripts/orchestration/delegation-gate.ts --context=agent-context.md --strict
 *   [runtime] skills/scripts/orchestration/delegation-gate.ts --enforce --pipeline-id=<id>
 *   [runtime] skills/scripts/orchestration/delegation-gate.ts --report --pipeline-id=<id>
 *
 * Exit codes:
 *   0 = Gate passed (all substantive work delegated to subagents)
 *   1 = Gate failed (orchestrator did non-delegated work)
 *   2 = Not applicable (no substantive steps have occurred yet)
 *
 * Output: JSON to stdout (see GateResult interface for schema)
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Types ───────────────────────────────────────────────────────────────────

export interface GateEvidenceEntry {
  claim: string;
  source: string;
  method: string;
  command: string;
  excerpt: string;
  result: string;
}

export interface GateCheckDetail {
  check: string;
  field: string;
  passed: boolean;
}

export interface GateResult {
  valid: boolean;
  gate: string;
  pipelineId: string;
  errors: string[];
  warnings: string[];
  checks: GateCheckDetail[];
  evidence: GateEvidenceEntry[];
}

interface AgentHistoryEntry {
  step?: string;
  agent?: string;
  result?: string;
  summary?: string;
  decisions?: unknown[];
  warnings?: string[];
  changedFiles?: string[];
  artifacts?: string[];
  [key: string]: unknown;
}

interface AgentOutputEntry {
  status?: string;
  resultSummary?: string;
  changedFiles?: string[];
  evidence?: Array<{
    method?: string;
    command?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

interface PipelineContext {
  pipelineId?: string;
  agentHistory?: AgentHistoryEntry[];
  agentOutputs?: Record<string, AgentOutputEntry>;
  status?: string;
  currentStep?: string;
  [key: string]: unknown;
}

interface CheckResult {
  passed: boolean;
  failures: string[];
  warnings: string[];
  checks: GateCheckDetail[];
  evidence: GateEvidenceEntry[];
}

interface GateFailureRecord {
  timestamp: string;
  pipelineId: string;
  gate: string;
  failures: string[];
  warnings: string[];
  blockPipeline: boolean;
  checkDetails: GateCheckDetail[];
}

// ── Constants ───────────────────────────────────────────────────────────────

const GATE_NAME = 'delegation';
const GATE_DIR = path.resolve('.opencode', 'gates', GATE_NAME);
const BLOCK_DIR = path.resolve('.opencode', 'gates');

const VALID_SUBAGENT_NAMES: readonly string[] = [
  'finder',
  'plandescriber',
  'implementor',
  'fixer',
  'qa',
  'verifier',
  'integrator',
  'browser-tester',
  'documentor',
  'security-scan',
  'architect',
];

/** Phrases in orchestrator resultSummary that indicate it did work itself. */
const SUBSTANTIVE_PHRASES: readonly string[] = [
  'I created',
  'I wrote',
  'I implemented',
  'I fixed',
  'I built',
  'I refactored',
  'I added',
  'I developed',
  'I made',
];

/** Methods that indicate direct work (not read-only verification). */
const DIRECT_WORK_METHODS: readonly string[] = [
  'analysis',
  'build',
  'lint',
  'test',
  'write',
  'edit',
  'implement',
];

// ── Argument Parsing ────────────────────────────────────────────────────────

function parseArgs(): Record<string, string> {
  const args = process.argv.slice(2);
  const result: Record<string, string> = {};

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showUsageAndExit(0);
  }

  for (const arg of args) {
    if (arg.startsWith('--') && arg.includes('=')) {
      const eqIdx = arg.indexOf('=');
      const key = arg.substring(2, eqIdx);
      const value = arg.substring(eqIdx + 1);
      result[key] = value;
    } else if (arg === '--strict') {
      result['strict'] = 'true';
    } else if (arg === '--enforce') {
      result['enforce'] = 'true';
    } else if (arg === '--report') {
      result['report'] = 'true';
    }
  }

  return result;
}

function showUsageAndExit(exitCode: number): void {
  console.log(`
Delegation Gate — Validate Orchestrator delegation to subagents

Validates that the Orchestrator delegated ALL substantive work to subagents
and did NOT perform implementation/research/discovery itself.

Usage:
  [runtime] delegation-gate.ts --context=agent-context.md
  [runtime] delegation-gate.ts --context=agent-context.md --strict
  [runtime] delegation-gate.ts --enforce --pipeline-id=<id>
  [runtime] delegation-gate.ts --report --pipeline-id=<id>

Options:
  --context=<path>   Path to agent-context.md with YAML frontmatter
  --strict           Enable strict mode (warnings for orchestrator reads >2 files/100 lines without preceding finder)
  --enforce          Enforce gate: check AND write failure record if failed
  --pipeline-id      Pipeline ID (required with --enforce and --report)
  --report           Read the gate record and print status

Exit codes:
  0 = Gate passed (all substantive work delegated to subagents)
  1 = Gate failed (orchestrator did non-delegated work)
  2 = Not applicable (no substantive steps have occurred yet)
  `.trim());
  process.exit(exitCode);
}

// ── YAML Parsing (same pattern as validate-context.ts / security-self-review-gate.ts) ──

function parseFrontmatter(content: string): { frontmatter: string | null; body: string } {
  content = content.replace(/\r\n/g, '\n');
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { frontmatter: null, body: content };
  }
  return { frontmatter: match[1], body: content.slice(match[0].length) };
}

function parseYamlBlock(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');
  const stack: Array<{ key: string; obj: Record<string, unknown> }> = [];
  const indentStack: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.search(/\S|$/);

    // Pop stack until we find the right parent
    while (indentStack.length > 0 && indentStack[indentStack.length - 1] >= indent) {
      stack.pop();
      indentStack.pop();
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();

    if (value === '' || value === '|' || value === '>') {
      const newObj: Record<string, unknown> = {};
      const parent = stack.length > 0 ? stack[stack.length - 1].obj : result;
      parent[key] = newObj;
      stack.push({ key, obj: newObj });
      indentStack.push(indent);

      // Handle inline arrays
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const nextTrimmed = nextLine.trim();
        if (nextTrimmed.startsWith('- ')) {
          const arr: unknown[] = [];
          parent[key] = arr;
          stack[stack.length - 1].obj = arr as unknown as Record<string, unknown>;
        }
      }
    } else {
      const parent = stack.length > 0 ? stack[stack.length - 1].obj : result;
      parent[key] = parseScalar(value);
    }
  }

  return result;
}

function parseScalar(value: string): unknown {
  if (value === '{}') return {};
  if (value === '[]') return [];
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  if (/^\d+\.\d+$/.test(value)) return parseFloat(value);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

// ── Evidence Helpers ────────────────────────────────────────────────────────

function makeEvidence(
  claim: string,
  source: string,
  method: string,
  command: string,
  excerpt: string,
  result: string,
): GateEvidenceEntry {
  return { claim, source, method, command, excerpt, result };
}

function makeCheck(check: string, field: string, passed: boolean): GateCheckDetail {
  return { check, field, passed };
}

// ── Core Delegation Check ───────────────────────────────────────────────────

/**
 * Performs the full delegation validation against a parsed pipeline context.
 *
 * Checks:
 * 1. Agent history review — every step should be a valid subagent; orchestrator with changedFiles fails.
 * 2. Agent outputs review — orchestrator outputs with changedFiles or substantive language fail.
 * 3. Read-only verification — orchestrator using direct-work methods is warned.
 * 4. Evidence check — if pipeline reached implementor/fixer/qa, each hand-off should have verification evidence.
 * 5. Subagent coverage — zero subagent steps past init phase triggers warning.
 *
 * @param context    The parsed pipeline context object.
 * @param strictMode When true, warn on orchestrator reading >2 files or 100 lines without prior finder.
 * @returns          A CheckResult with pass/fail, failures, warnings, checks, and evidence.
 */
export function performDelegationCheck(
  context: PipelineContext,
  strictMode: boolean = false,
): CheckResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  const checks: GateCheckDetail[] = [];
  const evidence: GateEvidenceEntry[] = [];

  const pipelineId = context.pipelineId ?? 'unknown';
  const agentHistory: AgentHistoryEntry[] = context.agentHistory ?? [];
  const agentOutputs: Record<string, AgentOutputEntry> = context.agentOutputs ?? {};
  const pipelineStatus = context.status;

  // ── Check 1: Agent History Review ────────────────────────────────────
  // For each agentHistory entry, verify the step name is a valid subagent.
  // If the step is 'orchestrator' with changedFiles, FAIL the gate.

  for (let i = 0; i < agentHistory.length; i++) {
    const entry = agentHistory[i];
    const stepName = entry.step ?? '';
    const resultStatus = entry.result ?? '';
    const changedFiles = entry.changedFiles ?? [];

    const isSubagent = VALID_SUBAGENT_NAMES.includes(stepName);
    const isOrchestrator = stepName === 'orchestrator';

    // If step is NOT a valid subagent name and the result is 'completed', flag error.
    if (!isSubagent && !isOrchestrator && resultStatus === 'completed') {
      failures.push(
        `agentHistory[${i}]: Unknown step "${stepName}" completed without being a recognized subagent`,
      );
      checks.push(
        makeCheck(
          'Step name is a valid subagent',
          `agentHistory[${i}].step`,
          false,
        ),
      );
      evidence.push(
        makeEvidence(
          `Unknown step "${stepName}" found in agent history`,
          'agent-context.md',
          'analysis',
          `check agentHistory[${i}].step === "${stepName}"`,
          `Step "${stepName}" completed but is not a valid subagent`,
          'failed',
        ),
      );
      continue;
    }

    // If step is 'orchestrator' and has changedFiles, FAIL the gate.
    if (isOrchestrator && changedFiles.length > 0) {
      failures.push(
        `agentHistory[${i}]: Orchestrator step has ${changedFiles.length} changed file(s). ` +
          `Orchestrator should not directly modify files — delegate to subagents.`,
      );
      checks.push(
        makeCheck(
          'Orchestrator has no changedFiles',
          `agentHistory[${i}].changedFiles`,
          false,
        ),
      );
      evidence.push(
        makeEvidence(
          'Orchestrator directly modified files instead of delegating',
          'agent-context.md',
          'analysis',
          `check agentHistory[${i}].changedFiles.length === ${changedFiles.length}`,
          `Changed files: ${changedFiles.join(', ')}`,
          'failed',
        ),
      );
      continue;
    }

    // If step is 'orchestrator', flag as a warning (orchestrator steps should ideally not appear).
    if (isOrchestrator) {
      warnings.push(
        `agentHistory[${i}]: Orchestrator step with status "${resultStatus}" found. ` +
          `Orchestrator should delegate all substantive work to subagents.`,
      );
      checks.push(
        makeCheck(
          'Orchestrator step flagged (advisory)',
          `agentHistory[${i}].step`,
          true, // advisory — does not fail the gate
        ),
      );
    }

    // Check for subagent step count for later use.
    if (isSubagent && resultStatus === 'completed') {
      checks.push(
        makeCheck(
          'Subagent step completed successfully',
          `agentHistory[${i}].step`,
          true,
        ),
      );
    }
  }

  // ── Check 2: Agent Outputs — Orchestrator doing implementation work ───
  // Check agentOutputs for any entry keyed under 'orchestrator' that
  // contains changedFiles, substantive language, or completed with no subagent.

  const orchOutput = agentOutputs['orchestrator'];

  if (orchOutput) {
    const orchChangedFiles: unknown[] = orchOutput.changedFiles ?? [];
    const orchResultSummary: string = orchOutput.resultSummary ?? '';
    const orchStatus: string = orchOutput.status ?? '';

    // Check changedFiles
    if (orchChangedFiles.length > 0) {
      failures.push(
        `Orchestrator agentOutput has ${orchChangedFiles.length} changed file(s). ` +
          `Orchestrator should not directly implement — delegate to subagents.`,
      );
      checks.push(
        makeCheck(
          'Orchestrator agentOutput has no changedFiles',
          'agentOutputs.orchestrator.changedFiles',
          false,
        ),
      );
      evidence.push(
        makeEvidence(
          'Orchestrator agentOutput contains changedFiles (implementation work)',
          'agent-context.md',
          'analysis',
          'check agentOutputs.orchestrator.changedFiles',
          `${orchChangedFiles.length} file(s) listed`,
          'failed',
        ),
      );
    } else {
      checks.push(
        makeCheck(
          'Orchestrator agentOutput has no changedFiles',
          'agentOutputs.orchestrator.changedFiles',
          true,
        ),
      );
    }

    // Check resultSummary for substantive phrases
    const foundPhrases = SUBSTANTIVE_PHRASES.filter((phrase) =>
      orchResultSummary.toLowerCase().includes(phrase.toLowerCase()),
    );
    if (foundPhrases.length > 0) {
      failures.push(
        `Orchestrator resultSummary contains substantive language: "${foundPhrases.join(', ')}". ` +
          `Orchestrator should not perform implementation — delegate to subagents.`,
      );
      checks.push(
        makeCheck(
          'Orchestrator resultSummary has no substantive language',
          'agentOutputs.orchestrator.resultSummary',
          false,
        ),
      );
      evidence.push(
        makeEvidence(
          'Orchestrator resultSummary uses implementation language',
          'agent-context.md',
          'analysis',
          `grep for substantive phrases in resultSummary`,
          `Found: ${foundPhrases.join(', ')}`,
          'failed',
        ),
      );
    } else {
      checks.push(
        makeCheck(
          'Orchestrator resultSummary has no substantive language',
          'agentOutputs.orchestrator.resultSummary',
          true,
        ),
      );
    }

    // Check status='completed' with no subagent listed for implementation
    if (orchStatus === 'completed') {
      const hasSubagentImplementation = agentHistory.some(
        (h) =>
          VALID_SUBAGENT_NAMES.includes(h.step ?? '') && h.result === 'completed' && h.changedFiles && h.changedFiles.length > 0,
      );
      if (!hasSubagentImplementation) {
        failures.push(
          'Orchestrator status is "completed" but no subagent performed implementation work. ' +
            'The orchestrator must delegate implementation to subagents.',
        );
        checks.push(
          makeCheck(
            'Subagent performed implementation before orchestrator completion',
            'agentHistory[].completed subagents with changedFiles',
            false,
          ),
        );
        evidence.push(
          makeEvidence(
            'Orchestrator completed without any subagent implementation',
            'agent-context.md',
            'analysis',
            'check agentHistory for completed subagents with changedFiles',
            'No subagent with completed implementation found',
            'failed',
          ),
        );
      } else {
        checks.push(
          makeCheck(
            'Subagent performed implementation before orchestrator completion',
            'agentHistory[].completed subagents with changedFiles',
            true,
          ),
        );
      }
    }

    // Check 3: Read-Only Verification — orchestrator using direct-work methods
    const orchEvidence: Array<{ method?: string; command?: string; [key: string]: unknown }> =
      orchOutput.evidence ?? [];
    for (let ei = 0; ei < orchEvidence.length; ei++) {
      const ev = orchEvidence[ei];
      const method = (ev.method ?? '').toLowerCase();
      if (DIRECT_WORK_METHODS.includes(method)) {
        warnings.push(
          `agentOutputs.orchestrator.evidence[${ei}]: method="${ev.method}" used by orchestrator. ` +
            `Orchestrator should only use read/glob/grep/summary methods for verification.`,
        );
        checks.push(
          makeCheck(
            'Orchestrator evidence uses read-only methods',
            `agentOutputs.orchestrator.evidence[${ei}].method`,
            false,
          ),
        );
        evidence.push(
          makeEvidence(
            `Orchestrator used method "${ev.method}" which is not read-only`,
            'agent-context.md',
            'analysis',
            `check agentOutputs.orchestrator.evidence[${ei}].method`,
            `Method: ${ev.method}`,
            'failed',
          ),
        );
      }
    }

    // Strict mode: check if orchestrator read substantive content without prior finder.
    if (strictMode) {
      const hasPriorFinder = agentHistory.some((h) => h.step === 'finder' && h.result === 'completed');
      if (!hasPriorFinder) {
        // Check if orchestrator has read evidence with many files or lines
        let totalReadFiles = 0;
        let totalReadLines = 0;
        for (const ev of orchEvidence) {
          if (ev.method === 'read') {
            totalReadFiles++;
            // Try to extract line count from command or excerpt
            const cmd: string = (ev.command ?? '') as string;
            const linesMatch = cmd.match(/--lines\s*=\s*(\d+)/i) || cmd.match(/head\s+-(\d+)/i);
            if (linesMatch) {
              totalReadLines += parseInt(linesMatch[1], 10);
            }
          }
        }
        if (totalReadFiles > 2 || totalReadLines > 100) {
          warnings.push(
            `Strict mode: Orchestrator read ${totalReadFiles} file(s) / ${totalReadLines} line(s) ` +
              `without a preceding finder step. Substantive reading should be delegated.`,
          );
          checks.push(
            makeCheck(
              'Strict: orchestrator read volume within limits without prior finder',
              'agentOutputs.orchestrator.evidence (read methods)',
              false,
            ),
          );
          evidence.push(
            makeEvidence(
              `Orchestrator performed ${totalReadFiles} reads / ${totalReadLines} lines without finder`,
              'agent-context.md',
              'analysis',
              'count evidence entries with method=read',
              `${totalReadFiles} files, ${totalReadLines} lines`,
              'failed',
            ),
          );
        }
      }
    }
  }

  // ── Check 4: Evidence Check for Hand-offs ───────────────────────────
  // If the pipeline has reached implementor/fixer/qa stage, check that
  // the orchestrator's output has at least one evidence entry per hand-off
  // showing verification of the prior agent's work.

  const stagesToCheck = ['implementor', 'fixer', 'qa'];
  const relevantHistory = agentHistory.filter((h) =>
    stagesToCheck.includes(h.step ?? ''),
  );

  for (const entry of relevantHistory) {
    const stepName = entry.step!;
    // Each time a subagent completes, the orchestrator should have verification evidence.
    const priorStep = getPriorStep(agentHistory, stepName);
    if (priorStep && orchOutput) {
      const orchEvidences = orchOutput.evidence ?? [];
      const verificationEvidence = orchEvidences.filter((ev: Record<string, unknown>) => {
        const claim = (ev.claim ?? '') as string;
        const method = (ev.method ?? '') as string;
        return (
          claim.toLowerCase().includes('verify') ||
          claim.toLowerCase().includes(`check ${priorStep}`) ||
          method === 'read' ||
          method === 'grep' ||
          method === 'glob'
        );
      });
      if (verificationEvidence.length === 0) {
        warnings.push(
          `No verification evidence found in orchestrator output for hand-off from "${priorStep}" to "${stepName}". ` +
            `Orchestrator should verify prior agent work before handing off.`,
        );
        checks.push(
          makeCheck(
            `Verification evidence exists for ${priorStep} → ${stepName} hand-off`,
            `agentOutputs.orchestrator.evidence (verification of ${priorStep})`,
            false,
          ),
        );
        evidence.push(
          makeEvidence(
            `Missing verification evidence for ${priorStep} → ${stepName} hand-off`,
            'agent-context.md',
            'analysis',
            `check agentOutputs.orchestrator.evidence for verification of ${priorStep}`,
            'No verification evidence found',
            'failed',
          ),
        );
      } else {
        checks.push(
          makeCheck(
            `Verification evidence exists for ${priorStep} → ${stepName} hand-off`,
            `agentOutputs.orchestrator.evidence (verification of ${priorStep})`,
            true,
          ),
        );
        evidence.push(
          makeEvidence(
            `Verification evidence found for ${priorStep} → ${stepName} hand-off`,
            'agent-context.md',
            'analysis',
            `check agentOutputs.orchestrator.evidence for verification of ${priorStep}`,
            `${verificationEvidence.length} evidence entries found`,
            'passed',
          ),
        );
      }
    }
  }

  // ── Check 5: Subagent Coverage ──────────────────────────────────────
  // ZERO subagent steps but pipeline is past init phase → WARN
  const completedSubagentSteps = agentHistory.filter(
    (h) => VALID_SUBAGENT_NAMES.includes(h.step ?? '') && h.result === 'completed',
  );
  if (completedSubagentSteps.length === 0 && pipelineStatus !== 'running' && pipelineStatus !== undefined) {
    const firstNonInitSteps = agentHistory.filter(
      (h) => h.step !== 'orchestrator' && h.result === 'completed',
    );
    if (firstNonInitSteps.length > 0) {
      warnings.push(
        'Pipeline has completed steps but ZERO subagent steps found. ' +
          'All substantive work should be delegated to subagents.',
      );
      checks.push(
        makeCheck(
          'At least one subagent step exists',
          'agentHistory[].step in VALID_SUBAGENT_NAMES',
          false,
        ),
      );
      evidence.push(
        makeEvidence(
          'No subagent steps found despite completed pipeline steps',
          'agent-context.md',
          'analysis',
          'count agentHistory entries where step is a valid subagent name and result is completed',
          '0 subagent steps found',
          'failed',
        ),
      );
    }
  }

  // ── Determine overall result ────────────────────────────────────────
  const passed = failures.length === 0;

  return {
    passed,
    failures,
    warnings,
    checks,
    evidence,
  };
}

/**
 * Returns the step name immediately preceding the last (most recent) occurrence
 * of the given step in the agent history. Uses reverse search to find the LAST
 * occurrence, ensuring correct prior step detection when agents repeat
 * (e.g., fixer -> qa -> fixer -> qa loops).
 */
function getPriorStep(history: AgentHistoryEntry[], currentStep: string): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].step === currentStep && i > 0) {
      return history[i - 1].step ?? null;
    }
  }
  return null;
}

// ── File I/O Helpers ────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getGateRecordPath(pipelineId: string): string {
  return path.join(GATE_DIR, `${pipelineId}.json`);
}

function getBlockFilePath(pipelineId: string): string {
  return path.join(BLOCK_DIR, `BLOCK-${pipelineId}.gate`);
}

// ── Command: --context (check context) ──────────────────────────────────────

function cmdCheckContext(contextPath: string, strictMode: boolean): void {
  if (!fs.existsSync(contextPath)) {
    const result: GateResult = {
      valid: false,
      gate: GATE_NAME,
      pipelineId: 'unknown',
      errors: [`File not found: ${contextPath}`],
      warnings: [],
      checks: [],
      evidence: [],
    };
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  let content: string;
  try {
    content = fs.readFileSync(contextPath, 'utf-8');
  } catch (err) {
    const result: GateResult = {
      valid: false,
      gate: GATE_NAME,
      pipelineId: 'unknown',
      errors: [`Failed to read file: ${(err as Error).message}`],
      warnings: [],
      checks: [],
      evidence: [],
    };
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  const { frontmatter } = parseFrontmatter(content);

  if (!frontmatter) {
    const result: GateResult = {
      valid: false,
      gate: GATE_NAME,
      pipelineId: 'unknown',
      errors: ['No YAML frontmatter found (must start with ---)'],
      warnings: [],
      checks: [],
      evidence: [],
    };
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseYamlBlock(frontmatter);
  } catch (err) {
    const result: GateResult = {
      valid: false,
      gate: GATE_NAME,
      pipelineId: 'unknown',
      errors: [`Failed to parse YAML frontmatter: ${(err as Error).message}`],
      warnings: [],
      checks: [],
      evidence: [],
    };
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  const context = parsed as PipelineContext;
  const pipelineId = context.pipelineId ?? 'unknown';

  // If there's no agent history and no agent outputs, the gate is not applicable
  const hasNoHistory = !context.agentHistory || context.agentHistory.length === 0;
  const hasNoOutputs = !context.agentOutputs || Object.keys(context.agentOutputs).length === 0;

  if (hasNoHistory && hasNoOutputs) {
    const result: GateResult = {
      valid: true,
      gate: GATE_NAME,
      pipelineId,
      errors: [],
      warnings: ['No agent history or outputs found — no substantive work to check. Gate not applicable.'],
      checks: [
        makeCheck('Agent history exists', 'agentHistory', false),
        makeCheck('Agent outputs exist', 'agentOutputs', false),
      ],
      evidence: [],
    };
    console.log(JSON.stringify(result, null, 2));
    process.exit(2);
  }

  const checkResult = performDelegationCheck(context, strictMode);

  const result: GateResult = {
    valid: checkResult.passed,
    gate: GATE_NAME,
    pipelineId,
    errors: checkResult.failures,
    warnings: checkResult.warnings,
    checks: checkResult.checks,
    evidence: checkResult.evidence,
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(checkResult.passed ? 0 : 1);
}

// ── Command: --enforce ──────────────────────────────────────────────────────

function cmdEnforce(pipelineId: string, strictMode: boolean, context?: PipelineContext): void {
  if (!pipelineId) {
    console.error('❌ Missing required argument: --pipeline-id=<id>');
    process.exit(1);
  }

  // If no context provided, try finding it
  if (!context) {
    const possibleContextPaths = [
      'agent-context.md',
      path.resolve('.opencode', 'agent-context.md'),
      path.resolve('.opencode', 'pipeline-logs', pipelineId, 'agent-context.md'),
    ];

    for (const cp of possibleContextPaths) {
      if (fs.existsSync(cp)) {
        try {
          const content = fs.readFileSync(cp, 'utf-8');
          const { frontmatter } = parseFrontmatter(content);
          if (frontmatter) {
            context = parseYamlBlock(frontmatter) as PipelineContext;
            break;
          }
        } catch {
          continue;
        }
      }
    }
  }

  if (!context) {
    console.error(`❌ Could not find or parse agent-context.md for pipeline: ${pipelineId}`);
    process.exit(1);
  }

  const hasNoHistory = !context.agentHistory || context.agentHistory.length === 0;
  const hasNoOutputs = !context.agentOutputs || Object.keys(context.agentOutputs).length === 0;

  if (hasNoHistory && hasNoOutputs) {
    console.log('⏭️  No agent history or outputs — no substantive work to check. Skipping gate.');
    process.exit(2);
  }

  const checkResult = performDelegationCheck(context, strictMode);

  // Ensure directories exist
  ensureDir(GATE_DIR);
  ensureDir(BLOCK_DIR);

  if (checkResult.passed) {
    console.log('✅ Delegation gate passed — all substantive work delegated to subagents.');

    // Write a success record (overwrites any previous failure)
    const record: GateFailureRecord = {
      timestamp: new Date().toISOString(),
      pipelineId,
      gate: GATE_NAME,
      failures: [],
      warnings: checkResult.warnings,
      blockPipeline: false,
      checkDetails: checkResult.checks,
    };

    fs.writeFileSync(getGateRecordPath(pipelineId), JSON.stringify(record, null, 2), 'utf-8');

    // Remove any existing BLOCK file for this pipeline
    const blockFile = getBlockFilePath(pipelineId);
    if (fs.existsSync(blockFile)) {
      fs.unlinkSync(blockFile);
    }

    // Print any warnings
    if (checkResult.warnings.length > 0) {
      console.log('');
      console.log('⚠️  Warnings:');
      for (const w of checkResult.warnings) {
        console.log(`  ⚠️  ${w}`);
      }
    }

    // Print check summary
    console.log('');
    console.log(`  Checks: ${checkResult.checks.length} total`);
    const passedChecks = checkResult.checks.filter((c) => c.passed).length;
    console.log(`  Passed: ${passedChecks}`);
    console.log(`  Failed: ${checkResult.checks.length - passedChecks}`);

    process.exit(0);
  } else {
    console.log('❌ Delegation gate FAILED — Orchestrator performed non-delegated work:');
    for (const failure of checkResult.failures) {
      console.log(`  ❌ ${failure}`);
    }

    if (checkResult.warnings.length > 0) {
      console.log('');
      console.log('⚠️  Warnings:');
      for (const w of checkResult.warnings) {
        console.log(`  ⚠️  ${w}`);
      }
    }

    // Write failure record
    const record: GateFailureRecord = {
      timestamp: new Date().toISOString(),
      pipelineId,
      gate: GATE_NAME,
      failures: checkResult.failures,
      warnings: checkResult.warnings,
      blockPipeline: true,
      checkDetails: checkResult.checks,
    };

    fs.writeFileSync(getGateRecordPath(pipelineId), JSON.stringify(record, null, 2), 'utf-8');

    // Write BLOCK file
    const blockFile = getBlockFilePath(pipelineId);
    const blockContent = [
      `# Pipeline BLOCKED — Gate: ${GATE_NAME}`,
      `# Timestamp: ${record.timestamp}`,
      `# Pipeline ID: ${pipelineId}`,
      '',
      `BLOCKED=true`,
      `GATE=${GATE_NAME}`,
      `PIPELINE_ID=${pipelineId}`,
      `REASON=Delegation gate failed: ${checkResult.failures.join('; ')}`,
      '',
    ].join('\n');
    fs.writeFileSync(blockFile, blockContent, 'utf-8');

    console.log(`  Gate record written to: ${getGateRecordPath(pipelineId)}`);
    console.log(`  BLOCK file written to: ${blockFile}`);

    process.exit(1);
  }
}

// ── Command: --report ───────────────────────────────────────────────────────

function cmdReport(pipelineId: string): void {
  if (!pipelineId) {
    console.error('❌ Missing required argument: --pipeline-id=<id>');
    process.exit(1);
  }

  const recordPath = getGateRecordPath(pipelineId);
  if (!fs.existsSync(recordPath)) {
    console.log(`⏭️  No gate record found for pipeline: ${pipelineId}`);
    console.log(`   (expected at: ${recordPath})`);
    process.exit(2);
  }

  let record: GateFailureRecord;
  try {
    const raw = fs.readFileSync(recordPath, 'utf-8');
    record = JSON.parse(raw) as GateFailureRecord;
  } catch {
    console.error(`❌ Could not read or parse gate record: ${recordPath}`);
    process.exit(1);
  }

  const separator = '─'.repeat(56);

  console.log(`Delegation Gate Report`);
  console.log(separator);
  console.log(`  Pipeline ID: ${record.pipelineId}`);
  console.log(`  Gate:        ${record.gate}`);
  console.log(`  Timestamp:   ${record.timestamp}`);
  console.log(`  Blocked:     ${record.blockPipeline ? '❌ YES' : '✅ No'}`);
  console.log(separator);

  if (record.failures.length === 0) {
    console.log(`  Status: ✅ PASSED`);
    console.log('');
    console.log('  All checks passed:');
    for (const detail of record.checkDetails) {
      const icon = detail.passed ? '✅' : '✅';
      console.log(`    ${icon} ${detail.check}`);
    }
  } else {
    console.log(`  Status: ❌ FAILED (${record.failures.length} failure(s))`);
    console.log('');
    console.log('  Failures:');
    for (const failure of record.failures) {
      console.log(`    ❌ ${failure}`);
    }
    console.log('');
    console.log('  Check Details:');
    for (const detail of record.checkDetails) {
      const icon = detail.passed ? '✅' : '❌';
      console.log(`    ${icon} ${detail.check}`);
      console.log(`       Field: ${detail.field}`);
    }
  }

  if (record.warnings.length > 0) {
    console.log('');
    console.log('  Warnings:');
    for (const w of record.warnings) {
      console.log(`    ⚠️  ${w}`);
    }
  }

  console.log(separator);

  if (record.blockPipeline) {
    const blockFile = getBlockFilePath(pipelineId);
    const blockExists = fs.existsSync(blockFile);
    console.log(`  BLOCK file present: ${blockExists ? '✅' : '❌ (missing!)'}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs();
  const contextPath = args['context'];
  const strictMode = args['strict'] === 'true' || process.argv.slice(2).includes('--strict');
  const enforceMode = args['enforce'] === 'true' || process.argv.slice(2).includes('--enforce');
  const reportMode = args['report'] === 'true' || process.argv.slice(2).includes('--report');
  const pipelineId = args['pipeline-id'];

  const isCheckContext = !!contextPath;
  const isEnforce = enforceMode;
  const isReport = reportMode;

  const modeCount = [isCheckContext, isEnforce, isReport].filter(Boolean).length;

  if (modeCount === 0) {
    console.error('❌ Must specify one of: --context, --enforce, --report');
    showUsageAndExit(1);
  }

  if (modeCount > 1) {
    console.error('❌ Specify only one mode: --context, --enforce, or --report');
    process.exit(1);
  }

  if (isCheckContext) {
    cmdCheckContext(contextPath!, strictMode);
  } else if (isEnforce) {
    cmdEnforce(pipelineId || 'unknown', strictMode);
  } else if (isReport) {
    cmdReport(pipelineId || 'unknown');
  }
}

if (require.main === module) {
  main();
}