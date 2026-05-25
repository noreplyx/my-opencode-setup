#!/usr/bin/env node
/**
 * Security Self-Review Gate
 *
 * Enforces the security self-review gate for the Implementor agent.
 * Checks that the implementor completed its security self-review with all
 * items passed before allowing the pipeline to proceed.
 *
 * Usage:
 *   [runtime] security-self-review-gate.ts --check-context=<path-to-agent-context.md>
 *   [runtime] security-self-review-gate.ts --enforce --pipeline-id=<id>
 *   [runtime] security-self-review-gate.ts --report --pipeline-id=<id>
 *
 * Exit codes:
 *   0 = Gate passed / not applicable (implementor not yet run)
 *   1 = Gate failed / error
 *   2 = Not applicable
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Types ───────────────────────────────────────────────────────────────────

interface SecuritySelfReview {
  passed?: boolean;
  itemsPassed?: number;
  itemsTotal?: number;
  failures?: Array<{
    file?: string;
    line?: number;
    check?: string;
    detail?: string;
    fixed?: boolean;
  }>;
}

interface SelfReview {
  confidence?: number;
  securityItemsPassed?: number;
  securityItemsTotal?: number;
  securitySelfReviewPassed?: boolean;
  wiringManifest?: unknown;
}

interface ImplementorOutput {
  status?: string;
  resultSummary?: string;
  selfReview?: SelfReview;
  securitySelfReview?: SecuritySelfReview;
  [key: string]: unknown;
}

interface AgentOutputs {
  implementor?: ImplementorOutput;
  [key: string]: unknown;
}

interface PipelineContext {
  pipelineId?: string;
  agentOutputs?: AgentOutputs;
  [key: string]: unknown;
}

interface GateFailureRecord {
  timestamp: string;
  pipelineId: string;
  gate: string;
  failures: string[];
  blockPipeline: boolean;
  checkDetails: Array<{
    check: string;
    field: string;
    expected: unknown;
    actual: unknown;
    passed: boolean;
  }>;
}

// ── Constants ───────────────────────────────────────────────────────────────

const GATE_NAME = 'security-self-review';
const GATE_DIR = path.resolve('.opencode', 'gates', GATE_NAME);
const BLOCK_DIR = path.resolve('.opencode', 'gates');

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
    }
  }

  // Detect command (first non-flag argument)
  const command = args.find(a => !a.startsWith('--'));
  if (command === '--check-context' || command === '--enforce' || command === '--report') {
    // already handled as flag values
  }

  return result;
}

function showUsageAndExit(exitCode: number): void {
  console.log(`
Security Self-Review Gate — Enforce implementor security review completion

Usage:
  [runtime] security-self-review-gate.ts --check-context=<path-to-agent-context.md>
  [runtime] security-self-review-gate.ts --enforce --pipeline-id=<id>
  [runtime] security-self-review-gate.ts --report --pipeline-id=<id>

Options:
  --check-context   Path to agent-context.md with YAML frontmatter
  --enforce         Enforce gate: check AND write failure record if failed
  --pipeline-id     Pipeline ID (required with --enforce and --report)
  --report          Read the gate record and print status

Exit codes:
  0 = Gate passed / not applicable
  1 = Gate failed / error
  2 = Not applicable (implementor not yet run)
  `.trim());
  process.exit(exitCode);
}

// ── YAML Parsing (same pattern as validate-context.ts) ──────────────────────

function parseFrontmatter(content: string): { frontmatter: string | null; body: string } {
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
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

// ── Gate Check Logic ────────────────────────────────────────────────────────

interface CheckResult {
  passed: boolean;
  failures: string[];
  checkDetails: Array<{
    check: string;
    field: string;
    expected: unknown;
    actual: unknown;
    passed: boolean;
  }>;
}

function performGateCheck(context: PipelineContext): CheckResult {
  const failures: string[] = [];
  const checkDetails: CheckResult['checkDetails'] = [];

  const agentOutputs = context.agentOutputs;

  // Check if implementor has run yet
  if (!agentOutputs || !agentOutputs.implementor) {
    return {
      passed: true,
      failures: [],
      checkDetails: [],
    };
  }

  const impl = agentOutputs.implementor;

  // Check 1: agentOutputs.implementor.status should be 'completed'
  checkDetails.push({
    check: 'Implementor status is completed',
    field: 'agentOutputs.implementor.status',
    expected: 'completed',
    actual: impl.status,
    passed: impl.status === 'completed',
  });
  if (impl.status !== 'completed') {
    failures.push(`Implementor status is "${impl.status}", expected "completed"`);
  }

  // Check 2: agentOutputs.implementor.selfReview.securityItemsPassed > 0
  const selfReview = impl.selfReview;
  const securityItemsPassed = selfReview?.securityItemsPassed;
  checkDetails.push({
    check: 'securityItemsPassed > 0',
    field: 'agentOutputs.implementor.selfReview.securityItemsPassed',
    expected: '> 0',
    actual: securityItemsPassed,
    passed: typeof securityItemsPassed === 'number' && securityItemsPassed > 0,
  });
  if (typeof securityItemsPassed !== 'number' || securityItemsPassed <= 0) {
    failures.push(`selfReview.securityItemsPassed is ${securityItemsPassed ?? 'undefined'}, expected > 0`);
  }

  // Check 3: agentOutputs.implementor.selfReview.securityItemsTotal > 0
  const securityItemsTotal = selfReview?.securityItemsTotal;
  checkDetails.push({
    check: 'securityItemsTotal > 0',
    field: 'agentOutputs.implementor.selfReview.securityItemsTotal',
    expected: '> 0',
    actual: securityItemsTotal,
    passed: typeof securityItemsTotal === 'number' && securityItemsTotal > 0,
  });
  if (typeof securityItemsTotal !== 'number' || securityItemsTotal <= 0) {
    failures.push(`selfReview.securityItemsTotal is ${securityItemsTotal ?? 'undefined'}, expected > 0`);
  }

  // Check 4: agentOutputs.implementor.selfReview.securitySelfReviewPassed === true
  const securitySelfReviewPassed = selfReview?.securitySelfReviewPassed;
  checkDetails.push({
    check: 'securitySelfReviewPassed is true',
    field: 'agentOutputs.implementor.selfReview.securitySelfReviewPassed',
    expected: true,
    actual: securitySelfReviewPassed,
    passed: securitySelfReviewPassed === true,
  });
  if (securitySelfReviewPassed !== true) {
    failures.push(`selfReview.securitySelfReviewPassed is ${securitySelfReviewPassed ?? 'undefined'}, expected true`);
  }

  // Check 5: agentOutputs.implementor.securitySelfReview.passed === true
  const securitySelfReview = impl.securitySelfReview;
  const passedField = securitySelfReview?.passed;
  checkDetails.push({
    check: 'securitySelfReview.passed is true',
    field: 'agentOutputs.implementor.securitySelfReview.passed',
    expected: true,
    actual: passedField,
    passed: passedField === true,
  });
  if (passedField !== true) {
    failures.push(`securitySelfReview.passed is ${passedField ?? 'undefined'}, expected true`);
  }

  return {
    passed: failures.length === 0,
    failures,
    checkDetails,
  };
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

// ── Command: --check-context ────────────────────────────────────────────────

function cmdCheckContext(contextPath: string): void {
  if (!fs.existsSync(contextPath)) {
    console.error(`❌ File not found: ${contextPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(contextPath, 'utf-8');
  const { frontmatter } = parseFrontmatter(content);

  if (!frontmatter) {
    console.error(`❌ No YAML frontmatter found in: ${contextPath}`);
    process.exit(1);
  }

  const parsed = parseYamlBlock(frontmatter) as PipelineContext;

  // If implementor hasn't run yet, we skip the gate
  const agentOutputs = parsed.agentOutputs;
  if (!agentOutputs || !agentOutputs.implementor) {
    console.log('⏭️  Implementor not yet run, skipping gate');
    process.exit(0);
  }

  const result = performGateCheck(parsed);

  if (result.passed) {
    console.log('✅ Security self-review passed');
    // Print details summary
    for (const detail of result.checkDetails) {
      const icon = detail.passed ? '✅' : '❌';
      console.log(`  ${icon} ${detail.check} (${detail.actual})`);
    }
    process.exit(0);
  } else {
    console.log('❌ Security self-review FAILED:');
    for (const failure of result.failures) {
      console.log(`  ❌ ${failure}`);
    }
    console.log('');
    console.log('Details:');
    for (const detail of result.checkDetails) {
      const icon = detail.passed ? '✅' : '❌';
      console.log(`  ${icon} ${detail.field}: expected ${JSON.stringify(detail.expected)}, got ${JSON.stringify(detail.actual)}`);
    }
    process.exit(1);
  }
}

// ── Command: --enforce ──────────────────────────────────────────────────────

function cmdEnforce(pipelineId: string, context?: PipelineContext): void {
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

  const agentOutputs = context.agentOutputs;
  if (!agentOutputs || !agentOutputs.implementor) {
    console.log('⏭️  Implementor not yet run, skipping gate');
    process.exit(0);
  }

  const result = performGateCheck(context);

  // Ensure directories exist
  ensureDir(GATE_DIR);
  ensureDir(BLOCK_DIR);

  if (result.passed) {
    console.log('✅ Security self-review passed');

    // Write a success record (overwrites any previous failure)
    const record: GateFailureRecord = {
      timestamp: new Date().toISOString(),
      pipelineId,
      gate: GATE_NAME,
      failures: [],
      blockPipeline: false,
      checkDetails: result.checkDetails,
    };

    fs.writeFileSync(getGateRecordPath(pipelineId), JSON.stringify(record, null, 2), 'utf-8');

    // Remove any existing BLOCK file for this pipeline
    const blockFile = getBlockFilePath(pipelineId);
    if (fs.existsSync(blockFile)) {
      fs.unlinkSync(blockFile);
    }

    process.exit(0);
  } else {
    console.log('❌ Security self-review FAILED — enforcement triggered:');
    for (const failure of result.failures) {
      console.log(`  ❌ ${failure}`);
    }
    console.log('');

    // Write failure record
    const record: GateFailureRecord = {
      timestamp: new Date().toISOString(),
      pipelineId,
      gate: GATE_NAME,
      failures: result.failures,
      blockPipeline: true,
      checkDetails: result.checkDetails,
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
      `REASON=Security self-review failed: ${result.failures.join('; ')}`,
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

  console.log(`Security Self-Review Gate Report`);
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
      const icon = detail.passed ? '✅' : '❌';
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
      console.log(`    ${icon} ${detail.field}`);
      console.log(`       Expected: ${JSON.stringify(detail.expected)}`);
      console.log(`       Actual:   ${JSON.stringify(detail.actual)}`);
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
  const checkContext = args['check-context'];
  const enforceMode = args['_command'] === 'enforce' || process.argv.slice(2).includes('--enforce');
  const reportMode = args['_command'] === 'report' || process.argv.slice(2).includes('--report');
  const pipelineId = args['pipeline-id'];

  // Detect mode from which flag is present
  const isCheckContext = !!checkContext;
  const isEnforce = enforceMode || (args['enforce'] !== undefined);
  const isReport = reportMode || (args['report'] !== undefined);

  const modeCount = [isCheckContext, isEnforce, isReport].filter(Boolean).length;

  if (modeCount === 0) {
    console.error('❌ Must specify one of: --check-context, --enforce, --report');
    showUsageAndExit(1);
  }

  if (modeCount > 1) {
    console.error('❌ Specify only one mode: --check-context, --enforce, or --report');
    process.exit(1);
  }

  if (isCheckContext) {
    cmdCheckContext(checkContext!);
  } else if (isEnforce) {
    cmdEnforce(pipelineId || 'unknown');
  } else if (isReport) {
    cmdReport(pipelineId || 'unknown');
  }
}

main();
