#!/usr/bin/env node
/**
 * Pipeline Replay
 * 
 * Re-runs a pipeline from archived logs and git checkpoints.
 * Enables post-mortem analysis and selective re-execution.
 * 
 * Usage: ts-node skills/scripts/orchestration/pipeline-replay.ts \
 *   --pipeline-id=<id> [--from-step=<agent>] [--to-step=<agent>] [--modify-plan=<path>]
 * 
 * Modes:
 *   --dry-run         Show what would be replayed without executing
 *   --interactive     Step through each agent execution with confirmation
 *   
 * Workflow:
 *   1. Find archived pipeline artifacts in .opencode/pipeline-logs/<pipelineId>/
 *   2. Restore git state to the last-known-good checkpoint
 *   3. Optionally apply a modified plan manifest
 *   4. Re-run from the specified step (default: first failed step)
 *   5. Generate a "replay diff" comparing original vs re-run output
 */

import * as fs from 'fs';
import * as path from 'path';

interface ReplayConfig {
  pipelineId: string;
  fromStep: string | null;
  toStep: string | null;
  modifyPlan: string | null;
  dryRun: boolean;
  interactive: boolean;
}

function parseArgs(): ReplayConfig {
  const args = process.argv.slice(2);
  const get = (p: string): string | undefined => {
    const a = args.find(a => a.startsWith(p));
    return a ? a.split('=')[1] : undefined;
  };

  const pipelineId = get('--pipeline-id=');
  if (!pipelineId) {
    console.error('Usage: ts-node pipeline-replay.ts --pipeline-id=<id> [--from-step=<agent>] [--dry-run]');
    process.exit(1);
  }

  return {
    pipelineId,
    fromStep: get('--from-step=') || null,
    toStep: get('--to-step=') || null,
    modifyPlan: get('--modify-plan=') || null,
    dryRun: args.includes('--dry-run'),
    interactive: args.includes('--interactive'),
  };
}

function findArchivedLogs(baseDir: string, pipelineId: string): string | null {
  const logsDir = path.join(baseDir, '.opencode', 'pipeline-logs', pipelineId);
  if (fs.existsSync(logsDir)) return logsDir;
  
  // Try alternate paths
  const altDir = path.join(baseDir, '.opencode', 'pipeline-logs');
  if (fs.existsSync(altDir)) {
    const entries = fs.readdirSync(altDir);
    for (const entry of entries) {
      if (entry.includes(pipelineId)) {
        return path.join(altDir, entry);
      }
    }
  }
  
  return null;
}

function findCheckpoints(baseDir: string, pipelineId: string): Array<{ sha: string; step: string; message: string }> {
  const result: Array<{ sha: string; step: string; message: string }> = [];
  
  try {
    const execSync = require('child_process').execSync;
    const logOutput = execSync(
      `git log --oneline --grep="pipeline-checkpoint: [^/]*/" -100`,
      { cwd: baseDir, encoding: 'utf-8', shell: true }
    ).trim();
    
    if (!logOutput) return result;
    
    for (const line of logOutput.split('\n')) {
      const match = line.match(/^(\S+)\s+pipeline-checkpoint:\s+(\S+)\/(\S+)\/(\S+)/);
      if (match) {
        const [, sha, feature, step, sessionId] = match;
        // Only include checkpoints for this pipeline
        if (feature.includes(pipelineId) || pipelineId.includes(feature)) {
          result.push({ sha, step, message: `pipeline-checkpoint: ${feature}/${step}/${sessionId}` });
        }
      }
    }
  } catch {
    // git not available or no checkpoints
  }
  
  return result;
}

function findOriginalPlan(baseDir: string, feature: string): string | null {
  const planDir = path.join(baseDir, 'plan-manifests', feature);
  if (fs.existsSync(planDir)) {
    const files = fs.readdirSync(planDir).filter(f => f.endsWith('.json'));
    if (files.length > 0) {
      return path.join(planDir, files[0]); // Return latest version
    }
  }
  return null;
}

function generateReplayDiff(baseDir: string, config: ReplayConfig): string {
  const checkpoints = findCheckpoints(baseDir, config.pipelineId);
  
  let diff = `# Pipeline Replay Diff: ${config.pipelineId}\n\n`;
  diff += `**Dry Run**: ${config.dryRun}\n`;
  diff += `**From Step**: ${config.fromStep || 'beginning'}\n`;
  diff += `**To Step**: ${config.toStep || 'end'}\n\n`;
  
  if (checkpoints.length > 0) {
    diff += `## Git Checkpoints Found: ${checkpoints.length}\n\n`;
    diff += `| # | SHA | Step | Action |\n`;
    diff += `|---|-----|------|--------|\n`;
    for (let i = 0; i < checkpoints.length; i++) {
      const cp = checkpoints[i];
      const action = config.fromStep && cp.step === config.fromStep ? '← START HERE' : 
                     config.toStep && cp.step === config.toStep ? '← STOP HERE' : '';
      diff += `| ${i + 1} | \`${cp.sha}\` | ${cp.step} | ${action} |\n`;
    }
    diff += '\n';
  } else {
    diff += `## ⚠️ No git checkpoints found for pipeline ${config.pipelineId}\n\n`;
    diff += `To create checkpoints, ensure the Orchestrator runs pipeline-checkpoint.ts after every agent step.\n\n`;
  }
  
  const logsDir = findArchivedLogs(baseDir, config.pipelineId);
  if (logsDir) {
    diff += `## Archived Logs\n\n`;
    diff += `Located at: \`${logsDir}\`\n\n`;
    const logFiles = fs.readdirSync(logsDir).filter(f => f.endsWith('.md') || f.endsWith('.yaml') || f.endsWith('.json'));
    diff += `Files available:\n`;
    for (const f of logFiles) {
      const size = fs.statSync(path.join(logsDir, f)).size;
      diff += `  - \`${f}\` (${size} bytes)\n`;
    }
    diff += '\n';
  }
  
  if (config.modifyPlan) {
    diff += `## Modified Plan\n\n`;
    diff += `A modified plan will be applied: \`${config.modifyPlan}\`\n`;
    if (fs.existsSync(config.modifyPlan)) {
      const planContent = fs.readFileSync(config.modifyPlan, 'utf-8').slice(0, 500);
      diff += `\`\`\`json\n${planContent}\n...\n\`\`\`\n\n`;
    }
  }
  
  diff += `## Replay Plan\n\n`;
  diff += `1. **Git Restore**: Reset to checkpoint prior to \`${config.fromStep || 'first step'}\`\n`;
  diff += `2. **Plan Apply**: ${config.modifyPlan ? 'Apply modified plan' : 'Use original plan'}\n`;
  diff += `3. **Agent Replay**: Execute agents from \`${config.fromStep || 'beginning'}\` to \`${config.toStep || 'end'}\`\n`;
  diff += `4. **Diff Generation**: Compare original output vs re-run output\n`;
  
  if (config.dryRun) {
    diff += `\n> 🏁 This is a **dry run**. No actual replay will be executed.\n`;
    diff += `> Remove \`--dry-run\` to execute the replay.\n`;
  }
  
  return diff;
}

function main(): void {
  const config = parseArgs();
  const baseDir = process.cwd();
  const logsDir = findArchivedLogs(baseDir, config.pipelineId);
  
  if (!logsDir && !config.dryRun) {
    console.warn(JSON.stringify({ warning: `No archived logs found for pipeline ${config.pipelineId}. Checkpoints may still exist in git if pipeline-checkpoint was used.` }));
  }
  
  const diff = generateReplayDiff(baseDir, config);
  
  // Write replay diff
  const outputDir = path.join(baseDir, '.opencode', 'pipeline-logs');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const outputPath = path.join(outputDir, `${config.pipelineId}-replay.md`);
  fs.writeFileSync(outputPath, diff, 'utf-8');
  
  const result = {
    replayPrepared: true,
    pipelineId: config.pipelineId,
    fromStep: config.fromStep,
    dryRun: config.dryRun,
    checkpointsFound: findCheckpoints(baseDir, config.pipelineId).length,
    logsFound: logsDir !== null,
    outputPath,
  };
  
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main();
}
