#!/usr/bin/env node
/**
 * Pipeline State Machine Validator
 *
 * Enforces valid pipeline step transitions by reading agent-context.md and
 * validating that the `currentStep` transition from one agent to the next
 * is legal according to a formal state transition matrix.
 *
 * Usage:
 *   ts-node validate-transition.ts --from=<step> --to=<step>
 *   ts-node validate-transition.ts --pipeline
 *   ts-node validate-transition.ts --manifest=<path>
 *   ts-node validate-transition.ts --list
 *   ts-node validate-transition.ts --export=json|yaml
 *
 * Exit codes:
 *   0 = valid transition
 *   1 = invalid transition (prints error to stderr)
 *   2 = unknown step (from-step not found in matrix)
 *
 * Dependencies: Node.js built-in modules only (fs, path, process)
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Types ──────────────────────────────────────────────────────────

type AgentName =
  | 'orchestrator'
  | 'finder'
  | 'plandescriber'
  | 'implementor'
  | 'fixer'
  | 'qa'
  | 'verifier'
  | 'merge-coordinator'
  | 'integrator'
  | 'browser-tester'
  | 'documentor'
  | 'security-scan'
  | 'pre-flight';

interface TransitionMatrix {
  [from: string]: string[];
}

interface ValidationResult {
  valid: boolean;
  from: string;
  to: string;
  message: string;
  exitCode: number;
}

interface ManifestCheckpoint {
  id: string;
  step: string;
  description?: string;
  status?: string;
}

interface PlanManifest {
  checkpoints?: ManifestCheckpoint[];
  phases?: Array<{ name?: string; checkpoints?: ManifestCheckpoint[] }>;
  [key: string]: unknown;
}

// ── State Transition Matrix ───────────────────────────────────────

const VALID_TRANSITIONS: TransitionMatrix = {
  finder: ['plandescriber', 'orchestrator'],
  plandescriber: ['implementor', 'orchestrator'],
  implementor: ['merge-coordinator', 'integrator', 'orchestrator', 'fixer'],
  'merge-coordinator': ['integrator', 'implementor', 'orchestrator'],
  integrator: ['orchestrator'],
  fixer: ['qa', 'verifier', 'orchestrator'],
  qa: ['fixer', 'verifier', 'orchestrator'],
  verifier: ['fixer', 'documentor', 'orchestrator'],
  documentor: ['orchestrator'],
  'security-scan': ['qa', 'orchestrator'],
  'browser-tester': ['fixer', 'qa', 'orchestrator'],
  orchestrator: [
    'finder', 'plandescriber', 'implementor', 'fixer', 'qa',
    'verifier', 'documentor', 'merge-coordinator', 'integrator',
    'security-scan', 'browser-tester',
  ],
  'pre-flight': ['finder', 'plandescriber', 'implementor'],
};

const ALL_AGENTS: AgentName[] = [
  'orchestrator',
  'finder',
  'plandescriber',
  'implementor',
  'fixer',
  'qa',
  'verifier',
  'merge-coordinator',
  'integrator',
  'browser-tester',
  'documentor',
  'security-scan',
  'pre-flight',
];

// ── Validation Logic ──────────────────────────────────────────────

/**
 * Validate a single transition from one step to another.
 */
function validateTransition(from: string, to: string): ValidationResult {
  const normalizedFrom = from.trim().toLowerCase();
  const normalizedTo = to.trim().toLowerCase();

  // Check if from-step exists in the matrix
  if (!(normalizedFrom in VALID_TRANSITIONS)) {
    return {
      valid: false,
      from: normalizedFrom,
      to: normalizedTo,
      message: `Unknown step "${normalizedFrom}". Valid from-steps: ${ALL_AGENTS.join(', ')}`,
      exitCode: 2,
    };
  }

  // Check if to-step is a valid transition
  const allowed = VALID_TRANSITIONS[normalizedFrom];
  if (allowed.includes(normalizedTo)) {
    return {
      valid: true,
      from: normalizedFrom,
      to: normalizedTo,
      message: `Transition "${normalizedFrom}" → "${normalizedTo}" is valid`,
      exitCode: 0,
    };
  }

  return {
    valid: false,
    from: normalizedFrom,
    to: normalizedTo,
    message: `Invalid transition: "${normalizedFrom}" → "${normalizedTo}". Allowed targets from "${normalizedFrom}": ${allowed.join(', ')}`,
    exitCode: 1,
  };
}

/**
 * Validate all transitions in a pipeline's agent history from agent-context.md.
 */
function validatePipelineTransitions(
  contextPath: string,
): ValidationResult[] {
  if (!fs.existsSync(contextPath)) {
    console.error(`File not found: ${contextPath}`);
    process.exit(2);
  }

  const content = fs.readFileSync(contextPath, 'utf-8');
  const parsed = parseYamlFrontmatter(content);
  if (!parsed) {
    console.error(`Could not parse YAML frontmatter from ${contextPath}`);
    process.exit(2);
  }

  const agentHistory = parsed.agentHistory as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(agentHistory) || agentHistory.length === 0) {
    console.error('No agentHistory found in agent-context.md');
    process.exit(1);
  }

  const results: ValidationResult[] = [];

  // Validate sequential transitions through agent history
  for (let i = 1; i < agentHistory.length; i++) {
    const prev = String(agentHistory[i - 1].step ?? '');
    const curr = String(agentHistory[i].step ?? '');
    if (!prev || !curr) continue;

    const result = validateTransition(prev, curr);
    results.push(result);

    if (!result.valid) {
      console.error(
        `[agentHistory index ${i - 1} → ${i}] ${result.message}`,
      );
    }
  }

  // Also validate transition from the last completed step to currentStep
  if (agentHistory.length > 0) {
    const lastStep = String(agentHistory[agentHistory.length - 1].step ?? '');
    const currentStep = String(parsed.currentStep ?? '');
    if (lastStep && currentStep && lastStep !== currentStep) {
      const result = validateTransition(lastStep, currentStep);
      results.push(result);

      if (!result.valid) {
        console.error(
          `[last completed → currentStep] ${result.message}`,
        );
      }
    }
  }

  return results;
}

/**
 * Validate a plan-manifest.json workflow order against the transition matrix.
 */
function validateManifestOrder(manifestPath: string): ValidationResult[] {
  if (!fs.existsSync(manifestPath)) {
    console.error(`Manifest file not found: ${manifestPath}`);
    process.exit(2);
  }

  const content = fs.readFileSync(manifestPath, 'utf-8');
  let manifest: PlanManifest;
  try {
    manifest = JSON.parse(content) as PlanManifest;
  } catch (e) {
    console.error(`Invalid JSON in manifest: ${(e as Error).message}`);
    process.exit(2);
  }

  // Collect all checkpoints in workflow order
  const checkpoints: ManifestCheckpoint[] = [];

  if (Array.isArray(manifest.checkpoints)) {
    checkpoints.push(...manifest.checkpoints);
  }

  if (Array.isArray(manifest.phases)) {
    for (const phase of manifest.phases) {
      if (Array.isArray(phase.checkpoints)) {
        checkpoints.push(...phase.checkpoints);
      }
    }
  }

  if (checkpoints.length === 0) {
    console.error('No checkpoints found in plan manifest');
    process.exit(1);
  }

  const results: ValidationResult[] = [];

  for (let i = 1; i < checkpoints.length; i++) {
    const prev = String(checkpoints[i - 1].step ?? checkpoints[i - 1].id ?? '');
    const curr = String(checkpoints[i].step ?? checkpoints[i].id ?? '');

    // Try to extract agent step portion from checkpoint ID (e.g. "CP-003-implementor")
    const prevAgent = extractAgentStep(prev);
    const currAgent = extractAgentStep(curr);

    if (prevAgent && currAgent) {
      const result = validateTransition(prevAgent, currAgent);
      results.push(result);

      if (!result.valid) {
        console.error(
          `[Checkpoint ${checkpoints[i - 1].id ?? i - 1} → ${checkpoints[i].id ?? i}] ${result.message}`,
        );
      }
    }
  }

  return results;
}

/**
 * Extract the agent step name from a string.
 * Handles:
 *   - "CP-003" (no agent embedded → use as-is for step matching)
 *   - "CP-003-implementor" (agent suffix)
 *   - "implementor" (already an agent name)
 */
function extractAgentStep(value: string): string | null {
  const lower = value.toLowerCase().trim();

  // Direct match
  if (ALL_AGENTS.includes(lower as AgentName)) {
    return lower;
  }

  // Check suffix pattern like CP-003-implementor
  for (const agent of ALL_AGENTS) {
    if (lower.endsWith(`-${agent}`) || lower.endsWith(`_${agent}`)) {
      return agent;
    }
  }

  // Try to find any agent name embedded in the string
  for (const agent of ALL_AGENTS) {
    if (lower.includes(agent)) {
      return agent;
    }
  }

  return null;
}

// ── Reporting ──────────────────────────────────────────────────────

/**
 * Generate a human-readable report for all transitions.
 */
function generateReport(from?: string): string {
  const lines: string[] = [];
  const totalFrom = Object.keys(VALID_TRANSITIONS).length;
  const totalTo = new Set(Object.values(VALID_TRANSITIONS).flat()).size;

  lines.push('Pipeline State Transition Matrix');
  lines.push('═══════════════════════════════════');
  lines.push(`Agents: ${totalFrom} from-states → ${totalTo} to-states`);
  lines.push('');

  const fromSteps = from
    ? [from]
    : Object.keys(VALID_TRANSITIONS).sort();

  for (const fromStep of fromSteps) {
    if (!(fromStep in VALID_TRANSITIONS)) {
      lines.push(`❌ Unknown from-step: "${fromStep}"`);
      lines.push('');
      continue;
    }

    const targets = VALID_TRANSITIONS[fromStep];

    // Print the header line with from-step
    const headerEmoji = fromStep === 'orchestrator' ? '🔄' : '📌';
    lines.push(`${headerEmoji} ${fromStep}`);
    lines.push(`  ├── Targets: ${targets.join(', ')}`);
    lines.push(`  └── Count: ${targets.length} valid transition${targets.length !== 1 ? 's' : ''}`);

    if (fromStep === 'orchestrator') {
      lines.push('      [Orchestrator can start any agent step]');
    } else if (targets.includes('orchestrator')) {
      lines.push('      [Returns to orchestrator on completion]');
    }
    lines.push('');
  }

  if (!from) {
    // Print summary statistics
    lines.push('Summary');
    lines.push('───────');
    const totalTransitions = Object.values(VALID_TRANSITIONS).reduce(
      (sum, arr) => sum + arr.length,
      0,
    );
    lines.push(`Total from-states: ${totalFrom}`);
    lines.push(`Total transitions: ${totalTransitions}`);
    lines.push(`Avg targets/state: ${(totalTransitions / totalFrom).toFixed(1)}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generate a provenance chain for a specific checkpoint.
 */
function generateProvenanceView(
  checkpointId: string,
  manifest: PlanManifest,
  context?: Record<string, unknown>,
): string {
  const lines: string[] = [];
  const checkpoint = findCheckpointInManifest(checkpointId, manifest);

  if (!checkpoint) {
    lines.push(`Checkpoint "${checkpointId}" not found in manifest.`);
    lines.push('');
    return lines.join('\n');
  }

  const step = String(checkpoint.step ?? checkpoint.id ?? 'unknown');
  const desc = String(checkpoint.description ?? '');

  lines.push(`${checkpointId}: ${desc}`);
  lines.push(`  Agent step: ${step}`);

  // If we have agent context, show provenance
  if (context?.agentHistory) {
    const history = context.agentHistory as Array<Record<string, unknown>>;
    const relevant = history.filter(
      (h) => String(h.step ?? '') === step,
    );

    if (relevant.length === 0) {
      // Show all history leading up to this step
      for (const entry of history) {
        const entryStep = String(entry.step ?? '');
        const entryResult = String(entry.result ?? '');
        const entrySummary = String(entry.summary ?? '').slice(0, 100);
        const icon =
          entryResult === 'completed'
            ? '✅'
            : entryResult === 'failed'
              ? '❌'
              : '⚠️';

        lines.push(`  ${icon} ${entryStep}: ${entrySummary || entryResult}`);
      }
    } else {
      for (const entry of relevant) {
        const entryResult = String(entry.result ?? '');
        const entrySummary = String(entry.summary ?? '').slice(0, 120);
        const entryAgent = String(entry.agent ?? '');
        const decisions = (entry.decisions as Array<Record<string, unknown>>) ?? [];
        const files = (entry.changedFiles as string[]) ?? [];

        const icon =
          entryResult === 'completed'
            ? '✅'
            : entryResult === 'failed'
              ? '❌'
              : '⚠️';

        lines.push(`  ${icon} Agent: ${entryAgent}`);
        lines.push(`     Result: ${entryResult}`);
        lines.push(`     Summary: ${entrySummary}`);

        if (decisions.length > 0) {
          lines.push('     Decisions:');
          for (const d of decisions) {
            lines.push(`       • ${String(d.what ?? '')}`);
          }
        }

        if (files.length > 0) {
          lines.push(`     Files: ${files.join(', ').slice(0, 120)}`);
        }
      }
    }
  }

  // Show valid next steps
  const nextSteps = VALID_TRANSITIONS[step];
  if (nextSteps) {
    lines.push('');
    lines.push(`  Valid next steps: ${nextSteps.join(', ')}`);

    // Check status
    const status = String(checkpoint.status ?? 'not_verified');
    const statusIcon =
      status === 'pass' || status === 'completed'
        ? '✅ PASS'
        : status === 'fail' || status === 'failed'
          ? '❌ FAIL'
          : '⏳ PENDING';
    lines.push(`  Status: ${statusIcon}`);
  }

  return lines.join('\n');
}

/**
 * Find a checkpoint in a manifest by ID.
 */
function findCheckpointInManifest(
  id: string,
  manifest: PlanManifest,
): ManifestCheckpoint | undefined {
  if (Array.isArray(manifest.checkpoints)) {
    const found = manifest.checkpoints.find((c) => c.id === id);
    if (found) return found;
  }

  if (Array.isArray(manifest.phases)) {
    for (const phase of manifest.phases) {
      if (Array.isArray(phase.checkpoints)) {
        const found = phase.checkpoints.find((c) => c.id === id);
        if (found) return found;
      }
    }
  }

  return undefined;
}

// ── Export Modes ──────────────────────────────────────────────────

/**
 * Export the transition matrix in JSON or YAML format.
 */
function exportMatrix(format: 'json' | 'yaml'): string {
  if (format === 'json') {
    return JSON.stringify(VALID_TRANSITIONS, null, 2);
  }

  // YAML output
  const lines: string[] = ['# Pipeline State Transition Matrix', ''];
  const sortedKeys = Object.keys(VALID_TRANSITIONS).sort();

  for (const fromStep of sortedKeys) {
    const targets = VALID_TRANSITIONS[fromStep];
    lines.push(`${fromStep}:`);
    for (const target of targets) {
      lines.push(`  - ${target}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Print the transition matrix as a formatted table to stdout.
 */
function printMatrixTable(): void {
  const allSteps = Object.keys(VALID_TRANSITIONS).sort();
  const maxFromLen = Math.max(...allSteps.map((s) => s.length), 6);

  // Table header
  console.log(`${'From'.padEnd(maxFromLen)} │ Valid Transitions`);
  console.log(`${'─'.repeat(maxFromLen)}─┼─${'─'.repeat(70)}`);

  for (const fromStep of allSteps) {
    const targets = VALID_TRANSITIONS[fromStep];
    const display = targets.join(', ');
    console.log(`${fromStep.padEnd(maxFromLen)} │ ${display}`);
  }

  console.log('');
  console.log('Legend: Each row shows valid target agents from a given step.');
  console.log(
    'Exit 0 = valid, 1 = invalid, 2 = unknown from-step.',
  );
}

// ── YAML Parser (simplified, inlined) ─────────────────────────────

/**
 * Parse YAML frontmatter from a file content (between --- delimiters).
 * Returns a simplified Record<string, unknown> for the fields we need.
 */
function parseYamlFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  return parseYamlBlock(match[1]);
}

/**
 * Simple YAML block parser for the fields we need (agentHistory, currentStep).
 */
function parseYamlBlock(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');
  const stack: Array<{
    indent: number;
    key: string;
    obj: Record<string, unknown> | unknown[];
  }> = [{ indent: -1, key: '', obj: result }];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty/commented lines
    if (!trimmed || trimmed.startsWith('#')) {
      i++;
      continue;
    }

    const indent = line.search(/\S/);

    // Pop stack back to correct nesting level
    while (
      stack.length > 1 &&
      indent <= stack[stack.length - 1].indent
    ) {
      stack.pop();
    }

    // Array item: "- value" or "- key: value"
    const listMatch = trimmed.match(/^-\s+(.*)/);
    if (listMatch) {
      const parent = stack[stack.length - 1];
      let arr = parent.obj as unknown[];
      const itemContent = listMatch[1];

      // Check if it's a nested object: "- key: value"
      const colonIdx = itemContent.indexOf(':');
      if (colonIdx > 0) {
        const afterColon = itemContent.slice(colonIdx + 1).trim();
        if (afterColon === '') {
          // Nested object — parse children
          const obj: Record<string, unknown> = {};
          const childKey = itemContent.slice(0, colonIdx).trim();
          obj[childKey] = {};
          arr.push(obj);
          const childObj = obj[childKey] as Record<string, unknown>;
          stack.push({ indent: indent + 2, key: childKey, obj: childObj });

          // Read nested properties
          let ci = i + 1;
          while (ci < lines.length) {
            const cl = lines[ci];
            const ct = cl.trim();
            if (!ct || ct.startsWith('#')) {
              ci++;
              continue;
            }
            const ciIndent = cl.search(/\S/);
            if (ciIndent <= indent + 2) break;

            const ciColon = ct.indexOf(':');
            if (ciColon > 0) {
              const ciKey = ct.slice(0, ciColon).trim();
              const ciValue = ct.slice(ciColon + 1).trim();
              if (ciValue === '') {
                // Nested key (object)
                childObj[ciKey] = {};
                // We don't handle deeper nesting
              } else {
                childObj[ciKey] = parseYamlScalar(ciValue);
              }
            }
            ci++;
          }
          i = ci;
          stack.pop();
          continue;
        } else {
          // Object with value on same line: "- key: value"
          const objKey = itemContent.slice(0, colonIdx).trim();
          const objValue = itemContent.slice(colonIdx + 1).trim();
          arr.push({ [objKey]: parseYamlScalar(objValue) });
          i++;
          continue;
        }
      }

      // Scalar array item: "- value"
      if (itemContent.startsWith('[') || itemContent.startsWith('{')) {
        // Inline JSON — skip complex parsing
        arr.push(itemContent);
      } else {
        arr.push(parseYamlScalar(itemContent));
      }
      i++;
      continue;
    }

    // Non-array key-value line
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      i++;
      continue;
    }

    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();

    // Determine the current object context
    let currentObj: Record<string, unknown> = result;
    if (stack.length > 1) {
      currentObj = stack[stack.length - 1].obj as Record<string, unknown>;
    }

    if (value === '' || value === '|') {
      // Object or Array starts

      // Peek ahead to see if it's an array (next line is "- ")
      const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';
      const isArray =
        nextLine.startsWith('- ') &&
        (i + 1 >= lines.length ||
          lines[i + 1].search(/\S/) > indent);

      if (isArray) {
        const arr: unknown[] = [];
        currentObj[key] = arr;
        stack.push({ indent, key, obj: arr });

        // Read array items
        let ai = i + 1;
        while (ai < lines.length) {
          const al = lines[ai];
          const at = al.trim();
          if (!at || at.startsWith('#')) {
            ai++;
            continue;
          }
          const aiIndent = al.search(/\S/);
          if (aiIndent <= indent) break;

          const arrMatch = at.match(/^-\s+(.*)/);
          if (!arrMatch) break;

          const arrValue = arrMatch[1];
          const arrColon = arrValue.indexOf(':');

          if (arrColon > 0 && arrValue.slice(arrColon + 1).trim() === '') {
            // Object in array
            const entryKey = arrValue.slice(0, arrColon).trim();
            const entryObj: Record<string, unknown> = {};

            // Read nested properties
            let ei = ai + 1;
            while (ei < lines.length) {
              const el = lines[ei];
              const et = el.trim();
              if (!et || et.startsWith('#')) {
                ei++;
                continue;
              }
              const eiIndent = el.search(/\S/);
              if (eiIndent <= aiIndent + 2) break;

              const eColon = et.indexOf(':');
              if (eColon > 0) {
                const ek = et.slice(0, eColon).trim();
                const ev = et.slice(eColon + 1).trim();
                entryObj[ek] = parseYamlScalar(ev);
              }
              ei++;
            }

            arr.push(entryObj);
            ai = ei + 1;
          } else {
            // Scalar or key=value in array
            if (arrColon > 0) {
              const ek = arrValue.slice(0, arrColon).trim();
              const ev = arrValue.slice(arrColon + 1).trim();
              arr.push({ [ek]: parseYamlScalar(ev) });
            } else {
              arr.push(parseYamlScalar(arrValue));
            }
            ai++;
          }
        }

        i = ai;
        stack.pop();
        continue;
      } else {
        // Nested object
        const nested: Record<string, unknown> = {};
        currentObj[key] = nested;
        stack.push({ indent, key, obj: nested });
      }
    } else {
      // Scalar value: assign
      currentObj[key] = parseYamlScalar(value);
    }

    i++;
  }

  return result;
}

function parseYamlScalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === 'null' || trimmed === '~') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  // Unquote
  const unquoted = trimmed
    .replace(/^"(.*)"$/, '$1')
    .replace(/^'(.*)'$/, '$1');

  // Try number
  if (/^-?\d+(\.\d+)?$/.test(unquoted)) {
    const num = Number(unquoted);
    if (!isNaN(num)) return num;
  }

  return unquoted;
}

// ── CLI Entry Point ───────────────────────────────────────────────

function printUsage(): void {
  const usage = `
Usage:
  ts-node validate-transition.ts --from=<step> --to=<step>     Validate a single transition
  ts-node validate-transition.ts --pipeline                     Validate agent-context.md transitions
  ts-node validate-transition.ts --manifest=<path>              Validate plan-manifest.json checkpoints
  ts-node validate-transition.ts --list                         Print state transition matrix as table
  ts-node validate-transition.ts --export=json|yaml             Export matrix in JSON or YAML format

Exit codes:
  0 = valid transition (or successful export/list)
  1 = invalid transition found
  2 = unknown step or file not found

State Transition Matrix:
  orchestrator     → all agents
  finder           → plandescriber, orchestrator
  plandescriber    → implementor, orchestrator
  implementor      → merge-coordinator, integrator, orchestrator, fixer
  merge-coordinator→ integrator, implementor, orchestrator
  integrator       → orchestrator
  fixer            → qa, verifier, orchestrator
  qa               → fixer, verifier, orchestrator
  verifier         → fixer, documentor, orchestrator
  documentor       → orchestrator
  security-scan    → qa, orchestrator
  browser-tester   → fixer, qa, orchestrator
  pre-flight       → finder, plandescriber, implementor
`;
  console.error(usage.trim());
}

function main(): void {
  const args = process.argv.slice(2);

  // --help
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  // --list
  if (args.includes('--list')) {
    printMatrixTable();
    process.exit(0);
  }

  // --export=<format>
  const exportArg = args.find((a) => a.startsWith('--export='));
  if (exportArg) {
    const format = exportArg.split('=')[1] as 'json' | 'yaml';
    if (format !== 'json' && format !== 'yaml') {
      console.error(`Unsupported export format: "${format}". Use "json" or "yaml".`);
      process.exit(2);
    }
    const output = exportMatrix(format);
    console.log(output);
    process.exit(0);
  }

  // --pipeline
  if (args.includes('--pipeline')) {
    const contextPath = path.resolve('agent-context.md');
    const results = validatePipelineTransitions(contextPath);

    const invalid = results.filter((r) => !r.valid);
    const unknown = results.filter((r) => r.exitCode === 2);

    if (results.length === 0) {
      console.log('No transitions to validate in pipeline history.');
      process.exit(0);
    }

    // Print summary
    const valid = results.filter((r) => r.valid);
    console.log(`\nPipeline Transition Validation`);
    console.log(`═══════════════════════════════`);
    console.log(`Total transitions: ${results.length}`);
    console.log(`Valid: ${valid.length}`);
    console.log(`Invalid: ${invalid.length}`);
    if (unknown.length > 0) {
      console.log(`Unknown steps: ${unknown.length}`);
    }

    if (invalid.length > 0) {
      for (const r of invalid) {
        console.log(`  ❌ ${r.message}`);
      }
      process.exit(1);
    }

    if (unknown.length > 0) {
      // Only invalid if ALL transitions are unknown, else just warn
      process.exit(unknown.length === results.length ? 2 : 1);
    }

    process.exit(0);
  }

  // --manifest=<path>
  const manifestArg = args.find((a) => a.startsWith('--manifest='));
  if (manifestArg) {
    const manifestPath = manifestArg.split('=')[1];
    const results = validateManifestOrder(path.resolve(manifestPath));

    const valid = results.filter((r) => r.valid);
    const invalid = results.filter((r) => !r.valid);

    console.log(`\nManifest Workflow Order Validation`);
    console.log(`══════════════════════════════════`);
    console.log(`Total checkpoint transitions: ${results.length}`);
    console.log(`Valid: ${valid.length}`);
    console.log(`Invalid: ${invalid.length}`);

    if (invalid.length > 0) {
      for (const r of invalid) {
        console.log(`  ❌ ${r.message}`);
      }
      process.exit(1);
    }

    process.exit(0);
  }

  // --from=<step> --to=<step>
  const fromArg = args.find((a) => a.startsWith('--from='));
  const toArg = args.find((a) => a.startsWith('--to='));

  // Also support positional: --from=<step> <to> or similar shorthand
  const posFrom = fromArg ? fromArg.split('=')[1] : undefined;
  const posTo = toArg ? toArg.split('=')[1] : undefined;

  // If only --from is given and no --to, try the next positional arg
  const resolvedFrom = posFrom;
  const resolvedTo = posTo;

  if (!resolvedFrom || !resolvedTo) {
    console.error('Both --from=<step> and --to=<step> are required for transition validation.');
    printUsage();
    process.exit(2);
  }

  const result = validateTransition(resolvedFrom, resolvedTo);

  // stdout: one-line result for scripting
  if (result.valid) {
    console.log(result.message);
  } else {
    console.error(result.message);
  }

  process.exit(result.exitCode);
}

main();
