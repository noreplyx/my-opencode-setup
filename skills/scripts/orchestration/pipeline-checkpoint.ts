#!/usr/bin/env node
/**
 * Pipeline Checkpoint
 * 
 * Creates a git checkpoint commit after every agent step.
 * Enables git-driven debugging: git log, git diff, git bisect through pipeline steps.
 * 
 * Usage: [runtime] skills/scripts/orchestration/pipeline-checkpoint.ts \
 *   --pipeline-id=<id> --step=<agent-name> --session-id=<ses_xxx> --feature=<feature>
 * 
 * Environment:
 *   - SKIP_CHECKPOINT=1  → disable checkpoint commits (for CI/testing)
 *   - GIT_USER_NAME / GIT_USER_EMAIL → override commit author
 * 
 * Exit codes:
 *   0 = checkpoint created (or no changes to commit)
 *   1 = error
 */

import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import * as crypto from 'crypto';

interface CheckpointArgs {
  pipelineId: string;
  step: string;
  sessionId: string;
  feature: string;
  message?: string;
}

function parseArgs(): CheckpointArgs {
  const args = process.argv.slice(2);
  const get = (prefix: string): string | undefined => {
    const a = args.find(a => a.startsWith(prefix));
    return a ? a.split('=')[1] : undefined;
  };

  const pipelineId = get('--pipeline-id=');
  const step = get('--step=');
  const sessionId = get('--session-id=');
  const feature = get('--feature=');
  const message = get('--message=');

  if (!pipelineId || !step || !sessionId || !feature) {
    console.error('Usage: [runtime] pipeline-checkpoint.ts --pipeline-id=<id> --step=<name> --session-id=<ses> --feature=<name> [--message=<text>]');
    process.exit(1);
  }

  return { pipelineId, step, sessionId, feature, message };
}

function exec(cmd: string, cwd?: string): { stdout: string; stderr: string; code: number } {
  try {
    const result = child_process.spawnSync(cmd, {
      shell: true,
      cwd: cwd || process.cwd(),
      encoding: 'utf-8',
      timeout: 10000,
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

function isGitRepo(): boolean {
  const r = exec('git rev-parse --git-dir 2>/dev/null');
  return r.code === 0;
}

function hasChanges(): boolean {
  const r = exec('git status --porcelain');
  return r.stdout.length > 0;
}

function getChangedFiles(): string[] {
  const r = exec('git diff --name-only');
  const staged = exec('git diff --cached --name-only');
  const unstaged = r.stdout ? r.stdout.split('\n') : [];
  const stagedFiles = staged.stdout ? staged.stdout.split('\n') : [];
  return [...new Set([...stagedFiles, ...unstaged])].filter(f => f.length > 0);
}

function getLastCommitSha(): string {
  const r = exec('git rev-parse --short HEAD');
  return r.code === 0 ? r.stdout : 'no-commits-yet';
}

function getDecisions(contextPath?: string): string[] {
  if (!contextPath || !fs.existsSync(contextPath)) return [];
  const content = fs.readFileSync(contextPath, 'utf-8');
  const decisions: string[] = [];
  const lines = content.split('\n');
  let inDecisions = false;
  let indent = 0;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('decisions:')) {
      inDecisions = true;
      indent = line.search(/\S/);
      continue;
    }
    if (inDecisions) {
      const currentIndent = line.search(/\S/);
      if (currentIndent <= indent && !trimmed.startsWith('-')) {
        inDecisions = false;
        continue;
      }
      if (trimmed.startsWith('- what:')) {
        const what = trimmed.replace('- what:', '').trim().replace(/^"|"$/g, '');
        decisions.push(what);
      }
    }
  }
  return decisions;
}

function buildCommitMessage(args: CheckpointArgs): string {
  const changedFiles = getChangedFiles();
  const sha = getLastCommitSha();
  const timestamp = new Date().toISOString();
  const decisions = getDecisions('agent-context.md');

  let msg = `pipeline-checkpoint: ${args.feature}/${args.step}/${args.sessionId}\n`;
  msg += `\nPipeline: ${args.pipelineId}`;
  msg += `\nTimestamp: ${timestamp}`;
  msg += `\nParent SHA: ${sha}`;
  if (args.message) msg += `\nNote: ${args.message}`;
  
  if (changedFiles.length > 0) {
    msg += `\n\nChanged files (${changedFiles.length}):\n`;
    for (const f of changedFiles) {
      msg += `  - ${f}\n`;
    }
  }
  
  if (decisions.length > 0) {
    msg += `\nDecisions:\n`;
    for (const d of decisions) {
      msg += `  - ${d}\n`;
    }
  }

  return msg;
}

function setGitConfig(): void {
  if (!process.env.GIT_USER_NAME && !process.env.GIT_USER_EMAIL) return;
  
  // Set temporarily for this checkpoint — only if env vars provided
  if (process.env.GIT_USER_NAME) {
    exec(`git config user.name "${process.env.GIT_USER_NAME}"`);
  }
  if (process.env.GIT_USER_EMAIL) {
    exec(`git config user.email "${process.env.GIT_USER_EMAIL}"`);
  }
}

function main(): void {
  // Skip if disabled
  if (process.env.SKIP_CHECKPOINT === '1') {
    console.log(JSON.stringify({ skipped: true, reason: 'SKIP_CHECKPOINT=1' }));
    process.exit(0);
  }

  const args = parseArgs();

  if (!isGitRepo()) {
    console.log(JSON.stringify({ skipped: true, reason: 'Not a git repository' }));
    process.exit(0);
  }

  if (!hasChanges()) {
    console.log(JSON.stringify({ skipped: true, reason: 'No changes to commit', step: args.step }));
    process.exit(0);
  }

  // Set git user if overridden
  setGitConfig();

  // Stage all changes
  const addResult = exec('git add -A');
  if (addResult.code !== 0) {
    console.error(JSON.stringify({ error: 'git add failed', stderr: addResult.stderr }));
    process.exit(1);
  }

  // Build and create commit
  const commitMsg = buildCommitMessage(args);
  const msgFile = path.join('/tmp', `checkpoint-msg-${args.pipelineId}-${args.step}.txt`);
  fs.writeFileSync(msgFile, commitMsg, 'utf-8');

  const commitResult = exec(`git commit -F "${msgFile}" --no-verify --no-gpg-sign`);
  fs.unlinkSync(msgFile);

  if (commitResult.code !== 0) {
    // Check if "nothing to commit" — that's OK
    if (commitResult.stderr.includes('nothing to commit') || commitResult.stdout.includes('nothing to commit')) {
      console.log(JSON.stringify({ skipped: true, reason: 'Nothing to commit' }));
      process.exit(0);
    }
    console.error(JSON.stringify({ error: 'git commit failed', stderr: commitResult.stderr, stdout: commitResult.stdout }));
    process.exit(1);
  }

  const sha = getLastCommitSha();
  const result = {
    checkpointCreated: true,
    pipelineId: args.pipelineId,
    step: args.step,
    sessionId: args.sessionId,
    commitSha: sha,
    changedFiles: getChangedFiles(),
  };

  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main();
}
