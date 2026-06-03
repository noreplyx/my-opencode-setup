#!/usr/bin/env node
/**
 * Pipeline Cost Tracker Script
 *
 * Estimates pipeline costs based on agent output character counts
 * and duration. Stores cost data in .opencode/costs/<pipelineId>.json
 *
 * Cost estimation formula:
 *   estimatedTokens = outputChars / 4
 *   estimatedCost = estimatedTokens * 0.000015
 *
 * Usage:
 *   [runtime] cost-tracker.ts --init --pipeline-id=<id> --feature=<name>
 *   [runtime] cost-tracker.ts --track --pipeline-id=<id> --agent=<name> --output-chars=<N> --duration-sec=<N>
 *   [runtime] cost-tracker.ts --report --pipeline-id=<id>
 *   [runtime] cost-tracker.ts --cleanup --older-than-days=<N>
 *
 * Exit codes:
 *   0 = success
 *   1 = error
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const COSTS_DIR = path.join(PROJECT_ROOT, '.opencode', 'costs');

const TOKEN_COST_PER_TOKEN = 0.000015;
const CHARS_PER_TOKEN = 4;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentCostEntry {
  agent: string;
  outputChars: number;
  durationSec: number;
  estimatedTokens: number;
  estimatedCost: number;
  timestamp: string;
}

interface PipelineCost {
  pipelineId: string;
  feature: string;
  createdAt: string;
  entries: AgentCostEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getCostPath(pipelineId: string): string {
  return path.join(COSTS_DIR, `${pipelineId}.json`);
}

function loadCost(pipelineId: string): PipelineCost {
  const filePath = getCostPath(pipelineId);
  if (!fs.existsSync(filePath)) {
    console.error(`Error: No cost data found for pipeline '${pipelineId}'`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PipelineCost;
  } catch (e) {
    console.error(`Error: Failed to parse cost file for pipeline '${pipelineId}': ${(e as Error).message}`);
    process.exit(1);
  }
}

function saveCost(cost: PipelineCost): void {
  ensureDir(COSTS_DIR);
  fs.writeFileSync(getCostPath(cost.pipelineId), JSON.stringify(cost, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

function cmdInit(pipelineId: string, feature: string): void {
  const filePath = getCostPath(pipelineId);
  if (fs.existsSync(filePath)) {
    console.error(`Error: Cost data already exists for pipeline '${pipelineId}'`);
    process.exit(1);
  }

  const cost: PipelineCost = {
    pipelineId,
    feature,
    createdAt: new Date().toISOString(),
    entries: [],
  };

  saveCost(cost);
  console.log(JSON.stringify({ ok: true, action: 'init', pipelineId, feature }));
}

function cmdTrack(pipelineId: string, agent: string, outputChars: number, durationSec: number): void {
  if (outputChars < 0) {
    console.error('Error: --output-chars must be a non-negative number');
    process.exit(1);
  }
  if (durationSec < 0) {
    console.error('Error: --duration-sec must be a non-negative number');
    process.exit(1);
  }

  const cost = loadCost(pipelineId);

  const estimatedTokens = Math.round(outputChars / CHARS_PER_TOKEN);
  const estimatedCost = estimatedTokens * TOKEN_COST_PER_TOKEN;

  const entry: AgentCostEntry = {
    agent,
    outputChars,
    durationSec,
    estimatedTokens,
    estimatedCost: Math.round(estimatedCost * 1000000) / 1000000, // round to 6 decimals
    timestamp: new Date().toISOString(),
  };

  cost.entries.push(entry);
  saveCost(cost);

  console.log(JSON.stringify({
    ok: true,
    action: 'track',
    pipelineId,
    agent,
    estimatedTokens,
    estimatedCost: entry.estimatedCost,
  }));
}

function cmdReport(pipelineId: string): void {
  const cost = loadCost(pipelineId);

  const totalTokens = cost.entries.reduce((sum, e) => sum + e.estimatedTokens, 0);
  const totalCost = cost.entries.reduce((sum, e) => sum + e.estimatedCost, 0);
  const totalDuration = cost.entries.reduce((sum, e) => sum + e.durationSec, 0);
  const totalChars = cost.entries.reduce((sum, e) => sum + e.outputChars, 0);

  // Per-agent aggregation
  const agentTotals: Record<string, { tokens: number; cost: number; duration: number; chars: number; count: number }> = {};
  for (const entry of cost.entries) {
    if (!agentTotals[entry.agent]) {
      agentTotals[entry.agent] = { tokens: 0, cost: 0, duration: 0, chars: 0, count: 0 };
    }
    agentTotals[entry.agent].tokens += entry.estimatedTokens;
    agentTotals[entry.agent].cost += entry.estimatedCost;
    agentTotals[entry.agent].duration += entry.durationSec;
    agentTotals[entry.agent].chars += entry.outputChars;
    agentTotals[entry.agent].count += 1;
  }

  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('  Pipeline Cost Report');
  console.log('═══════════════════════════════════════════');
  console.log(`  Pipeline ID : ${cost.pipelineId}`);
  console.log(`  Feature     : ${cost.feature}`);
  console.log(`  Created     : ${cost.createdAt}`);
  console.log(`  Total Agents: ${cost.entries.length}`);
  console.log('───────────────────────────────────────────');
  console.log('  Summary:');
  console.log(`    Total Output Chars   : ${totalChars.toLocaleString()}`);
  console.log(`    Total Est. Tokens    : ${totalTokens.toLocaleString()}`);
  console.log(`    Total Est. Cost      : $${totalCost.toFixed(6)}`);
  console.log(`    Total Duration       : ${formatDuration(totalDuration)}`);
  console.log('───────────────────────────────────────────');
  console.log('  Per-Agent Breakdown:');
  console.log('');

  const sortedAgents = Object.entries(agentTotals).sort((a, b) => b[1].cost - a[1].cost);
  for (const [agent, totals] of sortedAgents) {
    console.log(`    ${agent} (${totals.count} call${totals.count !== 1 ? 's' : ''})`);
    console.log(`       Chars     : ${totals.chars.toLocaleString()}`);
    console.log(`       Tokens    : ${totals.tokens.toLocaleString()}`);
    console.log(`       Cost      : $${Math.round(totals.cost * 1000000) / 1000000}`);
    console.log(`       Duration  : ${formatDuration(totals.duration)}`);
    console.log('');
  }
  console.log(`  Total Estimated Cost: $${totalCost.toFixed(6)}`);
  console.log('═══════════════════════════════════════════');
  console.log('');
}

function cmdCleanup(olderThanDays: number): void {
  ensureDir(COSTS_DIR);

  const now = Date.now();
  const cutoffMs = olderThanDays * 24 * 60 * 60 * 1000;
  let removedCount = 0;

  const files = fs.readdirSync(COSTS_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    const filePath = path.join(COSTS_DIR, file);
    try {
      const stat = fs.statSync(filePath);
      const ageMs = now - stat.mtimeMs;
      if (ageMs > cutoffMs) {
        fs.unlinkSync(filePath);
        removedCount++;
      }
    } catch {
      // skip files we can't stat
    }
  }

  console.log(JSON.stringify({ ok: true, action: 'cleanup', removedCount, olderThanDays }));
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds * 100) / 100}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(): void {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Pipeline Cost Tracker');
    console.log('');
    console.log('Usage:');
    console.log('  [runtime] cost-tracker.ts --init --pipeline-id=<id> --feature=<name>');
    console.log('  [runtime] cost-tracker.ts --track --pipeline-id=<id> --agent=<name> --output-chars=<N> --duration-sec=<N>');
    console.log('  [runtime] cost-tracker.ts --report --pipeline-id=<id>');
    console.log('  [runtime] cost-tracker.ts --cleanup --older-than-days=<N>');
    process.exit(0);
  }

  const get = (prefix: string): string | undefined => {
    const a = args.find(a => a.startsWith(prefix));
    return a ? a.split('=')[1] : undefined;
  };

  const hasFlag = (flag: string): boolean => args.includes(flag);

  const pipelineId = get('--pipeline-id=');
  const feature = get('--feature=');

  // --init
  if (hasFlag('--init')) {
    if (!pipelineId || !feature) {
      console.error('Error: --init requires --pipeline-id=<id> and --feature=<name>');
      process.exit(1);
    }
    cmdInit(pipelineId, feature);
    return;
  }

  // --track
  if (hasFlag('--track')) {
    const agent = get('--agent=');
    const outputCharsStr = get('--output-chars=');
    const durationSecStr = get('--duration-sec=');
    if (!pipelineId || !agent || !outputCharsStr || !durationSecStr) {
      console.error('Error: --track requires --pipeline-id=<id> --agent=<name> --output-chars=<N> --duration-sec=<N>');
      process.exit(1);
    }
    const outputChars = parseInt(outputCharsStr, 10);
    const durationSec = parseFloat(durationSecStr);
    if (isNaN(outputChars) || isNaN(durationSec)) {
      console.error('Error: --output-chars and --duration-sec must be numbers');
      process.exit(1);
    }
    cmdTrack(pipelineId, agent, outputChars, durationSec);
    return;
  }

  // --report
  if (hasFlag('--report')) {
    if (!pipelineId) {
      console.error('Error: --report requires --pipeline-id=<id>');
      process.exit(1);
    }
    cmdReport(pipelineId);
    return;
  }

  // --cleanup
  if (hasFlag('--cleanup')) {
    const olderThanDaysStr = get('--older-than-days=');
    if (!olderThanDaysStr) {
      console.error('Error: --cleanup requires --older-than-days=<N>');
      process.exit(1);
    }
    const olderThanDays = parseFloat(olderThanDaysStr);
    if (isNaN(olderThanDays) || olderThanDays < 0) {
      console.error('Error: --older-than-days must be a non-negative number');
      process.exit(1);
    }
    cmdCleanup(olderThanDays);
    return;
  }

  console.error('Error: Unknown command. See usage above.');
  console.error(`Received args: ${args.join(' ')}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (require.main === module) {
  parseArgs();
}
