#!/usr/bin/env node
/**
 * Auto-Rollback
 *
 * Automated rollback on consecutive pipeline failures.
 * Reads pipeline monitoring data, checks for consecutive failures,
 * and performs git-based rollback to the pre-pipeline state.
 *
 * Usage:
 *   [noderuntime] auto-rollback.ts --pipeline-id=<id> --feature=<name> --consecutive-failures=<N> [--dry-run]
 *   [noderuntime] auto-rollback.ts --check --pipeline-id=<id> [--threshold=<N>]
 *   [noderuntime] auto-rollback.ts --restore --checkpoint-ref=<git-ref>
 *   [noderuntime] auto-rollback.ts --status
 *
 * Exit codes:
 *   0 = success
 *   1 = error
 *   2 = condition met (rollback needed / status found)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import * as crypto from 'crypto';

// ── Constants ──────────────────────────────────────────────────────

const MONITORING_DIR = '.opencode/monitoring';
const ROLLBACKS_DIR = '.opencode/rollbacks';
const AGENT_CONTEXT_FILE = 'agent-context.md';
const DEFAULT_THRESHOLD = 3;
const WORKSPACE_ROOT = process.cwd();

// ── Types ──────────────────────────────────────────────────────────

interface Args {
  pipelineId?: string;
  feature?: string;
  consecutiveFailures?: number;
  dryRun?: boolean;
  check?: boolean;
  threshold?: number;
  restore?: boolean;
  checkpointRef?: string;
  status?: boolean;
}

interface RollbackRecord {
  pipelineId: string;
  timestamp: string;
  fromSha: string;
  toSha: string;
  feature: string;
  dryRun: boolean;
  hash: string;
}

interface MonitoringData {
  pipelineId: string;
  status: string;
  history: Array<{
    step: string;
    result: string;
    timestamp: string;
  }>;
}

// ── Helpers ────────────────────────────────────────────────────────

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  const args: Args = {};
  for (const a of raw) {
    if (a === '--check') { args.check = true; continue; }
    if (a === '--restore') { args.restore = true; continue; }
    if (a === '--status') { args.status = true; continue; }
    if (a === '--dry-run') { args.dryRun = true; continue; }
    if (a.startsWith('--pipeline-id=')) { args.pipelineId = a.split('=')[1]; continue; }
    if (a.startsWith('--feature=')) { args.feature = a.split('=')[1]; continue; }
    if (a.startsWith('--consecutive-failures=')) { args.consecutiveFailures = parseInt(a.split('=')[1], 10); continue; }
    if (a.startsWith('--threshold=')) { args.threshold = parseInt(a.split('=')[1], 10); continue; }
    if (a.startsWith('--checkpoint-ref=')) { args.checkpointRef = a.split('=')[1]; continue; }
  }
  return args;
}

function exec(cmd: string, cwd?: string): { stdout: string; stderr: string; code: number } {
  try {
    const result = child_process.spawnSync(cmd, {
      shell: true,
      cwd: cwd || WORKSPACE_ROOT,
      encoding: 'utf-8',
      timeout: 15000,
    });
    return {
      stdout: result.stdout?.trim() || '',
      stderr: result.stderr?.trim() || '',
      code: result.status ?? 1,
    };
  } catch (e) {
    return { stdout: '', stderr: (e as Error).message, code: 1 };
  }
}

function computeHash(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf-8').digest('hex');
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getLastCommitSha(): string {
  const r = exec('git rev-parse --short HEAD');
  return r.code === 0 ? r.stdout : 'no-commits-yet';
}

function isGitRepo(): boolean {
  const r = exec('git rev-parse --git-dir 2>/dev/null');
  return r.code === 0;
}

function parseYamlSimpleField(content: string, fieldPath: string): string | null {
  // Naive YAML field extraction for specific dot-separated paths like prePipelineGitState.lastCommitSha
  const parts = fieldPath.split('.');
  let remaining = content;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const regex = new RegExp(`^${part}\\s*:\\s*(.*)$`, 'm');
    const match = remaining.match(regex);
    if (!match) return null;
    if (i === parts.length - 1) {
      let val = match[1].trim();
      // Remove quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      return val || null;
    }
    // Find the sub-section for the next part (after this key, find the first line that is a parent key)
    const afterMatch = remaining.slice(match.index! + match[0].length);
    // Find the indentation of the current line
    const lines = remaining.split('\n');
    const matchedLine = lines.find(l => new RegExp(`^${part}\\s*:`).test(l.trim()));
    if (!matchedLine) return null;
    const indent = matchedLine.search(/\S/);
    // Extract sub-section: lines with indent > current indent
    const subLines: string[] = [];
    const allLines = remaining.split('\n');
    let inSub = false;
    for (const line of allLines) {
      if (line.trim().startsWith(part + ':')) {
        inSub = true;
        continue;
      }
      if (inSub) {
        const lineIndent = line.search(/\S/);
        if (lineIndent <= indent && line.trim().length > 0 && !line.trim().startsWith('-')) {
          break;
        }
        subLines.push(line);
      }
    }
    remaining = subLines.join('\n');
    if (!remaining.trim()) return null;
  }
  return null;
}

// ── Monitoring ─────────────────────────────────────────────────────

function readMonitoringData(pipelineId: string): MonitoringData | null {
  const filePath = path.join(WORKSPACE_ROOT, MONITORING_DIR, `${pipelineId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as MonitoringData;
  } catch {
    return null;
  }
}

function countConsecutiveFailures(monData: MonitoringData): number {
  const history = monData.history || [];
  let count = 0;
  // Walk backwards through history
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].result === 'failed') {
      count++;
    } else {
      break;
    }
  }
  return count;
}

// ── Rollback ───────────────────────────────────────────────────────

function readAgentContextPrePipelineSha(): string | null {
  if (!fs.existsSync(AGENT_CONTEXT_FILE)) return null;
  const content = fs.readFileSync(AGENT_CONTEXT_FILE, 'utf-8');
  // Try extracting from YAML frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return null;
  const yaml = frontmatterMatch[1];

  // Try prePipelineGitState.lastCommitSha first
  const preSha = parseYamlSimpleField(yaml, 'prePipelineGitState.lastCommitSha');
  if (preSha) return preSha;

  // Fallback: gitState.lastCommitSha
  const gitSha = parseYamlSimpleField(yaml, 'gitState.lastCommitSha');
  return gitSha;
}

function performRollback(args: Args): void {
  if (!args.pipelineId || !args.feature) {
    console.error('Error: --pipeline-id and --feature are required for rollback');
    process.exit(1);
  }

  if (!isGitRepo()) {
    console.error('Error: Not a git repository');
    process.exit(1);
  }

  const preSha = readAgentContextPrePipelineSha();
  if (!preSha) {
    console.error('Error: Could not determine pre-pipeline git state SHA from agent-context.md');
    process.exit(1);
  }

  const currentSha = getLastCommitSha();

  if (args.dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      pipelineId: args.pipelineId,
      feature: args.feature,
      currentSha,
      targetSha: preSha,
      actions: [
        `git stash (save uncommitted changes)`,
        `git checkout ${preSha} (restore to pre-pipeline state)`,
        `Create rollback record at ${ROLLBACKS_DIR}/${args.pipelineId}.json`,
      ],
    }, null, 2));
    process.exit(0);
  }

  // Step 1: Stash uncommitted changes
  console.log(`[rollback] Stashing uncommitted changes...`);
  const stashResult = exec('git stash push -m "auto-rollback: pre-rollback stash"');
  if (stashResult.code !== 0 && stashResult.stderr && !stashResult.stderr.includes('No local changes')) {
    console.error(`[rollback] Warning: git stash had issues: ${stashResult.stderr}`);
  }

  // Step 2: Checkout to pre-pipeline SHA
  console.log(`[rollback] Checking out ${preSha}...`);
  const checkoutResult = exec(`git checkout ${preSha}`);
  if (checkoutResult.code !== 0) {
    console.error(`[rollback] Error: git checkout failed: ${checkoutResult.stderr}`);
    process.exit(1);
  }

  // Step 3: Create rollback record
  ensureDir(path.join(WORKSPACE_ROOT, ROLLBACKS_DIR));
  const record: RollbackRecord = {
    pipelineId: args.pipelineId,
    timestamp: new Date().toISOString(),
    fromSha: currentSha,
    toSha: preSha,
    feature: args.feature,
    dryRun: false,
    hash: '',
  };
  const recordStr = JSON.stringify(record, null, 2);
  record.hash = computeHash(recordStr);

  const recordPath = path.join(WORKSPACE_ROOT, ROLLBACKS_DIR, `${args.pipelineId}.json`);
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n', 'utf-8');

  // Step 4: Print summary
  console.log(JSON.stringify({
    rollbackCompleted: true,
    pipelineId: args.pipelineId,
    feature: args.feature,
    fromSha: currentSha,
    toSha: preSha,
    recordPath,
    recordHash: record.hash,
  }, null, 2));
}

// ── Check ──────────────────────────────────────────────────────────

function checkPipeline(args: Args): void {
  if (!args.pipelineId) {
    console.error('Error: --pipeline-id is required with --check');
    process.exit(1);
  }

  const threshold = args.threshold ?? DEFAULT_THRESHOLD;
  const monData = readMonitoringData(args.pipelineId);

  if (!monData) {
    console.log(JSON.stringify({
      check: true,
      pipelineId: args.pipelineId,
      monitoringFound: false,
      consecutiveFailures: 0,
      threshold,
      rollbackNeeded: false,
    }));
    process.exit(0);
  }

  const consecutiveFailures = countConsecutiveFailures(monData);
  const rollbackNeeded = consecutiveFailures >= threshold;

  console.log(JSON.stringify({
    check: true,
    pipelineId: args.pipelineId,
    monitoringFound: true,
    consecutiveFailures,
    threshold,
    rollbackNeeded,
    historyEntries: monData.history?.length || 0,
  }, null, 2));

  if (rollbackNeeded) {
    process.exit(2);
  }
  process.exit(0);
}

// ── Restore ────────────────────────────────────────────────────────

function restoreFromCheckpoint(args: Args): void {
  if (!args.checkpointRef) {
    console.error('Error: --checkpoint-ref is required with --restore');
    process.exit(1);
  }

  if (!isGitRepo()) {
    console.error('Error: Not a git repository');
    process.exit(1);
  }

  const currentSha = getLastCommitSha();
  console.log(`[restore] Current HEAD: ${currentSha}`);
  console.log(`[restore] Restoring to checkpoint: ${args.checkpointRef}...`);

  // Stash any uncommitted changes first
  const stashResult = exec('git stash push -m "auto-rollback: pre-restore stash"');
  if (stashResult.code !== 0 && stashResult.stderr && !stashResult.stderr.includes('No local changes')) {
    console.error(`[restore] Warning: git stash had issues: ${stashResult.stderr}`);
  }

  const checkoutResult = exec(`git checkout ${args.checkpointRef}`);
  if (checkoutResult.code !== 0) {
    console.error(`[restore] Error: git checkout failed: ${checkoutResult.stderr}`);
    process.exit(1);
  }

  const newSha = getLastCommitSha();
  console.log(JSON.stringify({
    restoreCompleted: true,
    fromSha: currentSha,
    toSha: newSha,
    checkpointRef: args.checkpointRef,
  }, null, 2));
}

// ── Status ─────────────────────────────────────────────────────────

function listRollbacks(): void {
  const rollbacksDir = path.join(WORKSPACE_ROOT, ROLLBACKS_DIR);
  if (!fs.existsSync(rollbacksDir)) {
    console.log(JSON.stringify({ rollbacks: [], count: 0 }));
    process.exit(0);
  }

  const files = fs.readdirSync(rollbacksDir).filter(f => f.endsWith('.json'));
  const records: RollbackRecord[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(rollbacksDir, file), 'utf-8');
      records.push(JSON.parse(content) as RollbackRecord);
    } catch {
      // Skip unparseable records
    }
  }

  // Sort by timestamp descending
  records.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  console.log(JSON.stringify({ rollbacks: records, count: records.length }, null, 2));

  if (records.length > 0) {
    process.exit(2); // condition met: records exist
  }
  process.exit(0);
}

// ── Usage ──────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`
Auto-Rollback — Automated rollback on consecutive pipeline failures

Usage:
  [noderuntime] auto-rollback.ts --pipeline-id=<id> --feature=<name> --consecutive-failures=<N> [--dry-run]
  [noderuntime] auto-rollback.ts --check --pipeline-id=<id> [--threshold=<N>]
  [noderuntime] auto-rollback.ts --restore --checkpoint-ref=<git-ref>
  [noderuntime] auto-rollback.ts --status

Modes:
  --check              Check if rollback is needed (exits 2 if threshold met)
  --pipeline-id +      Perform rollback to pre-pipeline state
    --feature +
    --consecutive-failures
  --dry-run            Preview rollback without executing
  --restore            Restore from a specific checkpoint git ref
  --status             List all recorded rollbacks

Exit codes:
  0 = success
  1 = error
  2 = condition met (rollback needed / rollbacks exist)
`);
}

// ── Main ───────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs();

  if (process.argv.length <= 2) {
    printUsage();
    process.exit(0);
  }

  if (args.status) {
    listRollbacks();
    return;
  }

  if (args.restore) {
    restoreFromCheckpoint(args);
    return;
  }

  if (args.check) {
    checkPipeline(args);
    return;
  }

  if (args.pipelineId && args.feature) {
    performRollback(args);
    return;
  }

  // If none of the above matched
  if (args.pipelineId || args.feature || args.consecutiveFailures !== undefined || args.dryRun !== undefined) {
    // Partial args — likely intended for rollback but missing required params
    if (!args.pipelineId) { console.error('Error: --pipeline-id is required'); process.exit(1); }
    if (!args.feature) { console.error('Error: --feature is required'); process.exit(1); }
    process.exit(1);
  }

  printUsage();
}

if (require.main === module) {
  main();
}
