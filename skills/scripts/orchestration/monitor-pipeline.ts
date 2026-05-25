#!/usr/bin/env node
/**
 * Pipeline Monitoring Script
 *
 * Tracks pipeline health with init, track, report, dashboard, and alert modes.
 * Stores monitoring data in .opencode/monitoring/<pipelineId>.json
 *
 * Usage:
 *   [runtime] monitor-pipeline.ts --init --pipeline-id=<id> --feature=<name>
 *   [runtime] monitor-pipeline.ts --track --pipeline-id=<id> --gate=<name> --duration-sec=<N> --result=pass|fail
 *   [runtime] monitor-pipeline.ts --report --pipeline-id=<id>
 *   [runtime] monitor-pipeline.ts --dashboard
 *   [runtime] monitor-pipeline.ts --alert --pipeline-id=<id> --check-stuck --timeout-min=<N>
 *
 * Exit codes:
 *   0 = success
 *   1 = error
 *   For --alert: 0 = stuck, 1 = OK (not stuck)
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const MONITORING_DIR = path.join(PROJECT_ROOT, '.opencode', 'monitoring');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GateResult {
  name: string;
  durationSec: number;
  result: 'pass' | 'fail';
  timestamp: string;
}

interface PipelineMonitor {
  pipelineId: string;
  feature: string;
  startTimestamp: string;
  endTimestamp: string | null;
  status: 'running' | 'completed' | 'failed';
  gates: GateResult[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getMonitorPath(pipelineId: string): string {
  return path.join(MONITORING_DIR, `${pipelineId}.json`);
}

function loadMonitor(pipelineId: string): PipelineMonitor {
  const filePath = getMonitorPath(pipelineId);
  if (!fs.existsSync(filePath)) {
    console.error(`Error: No monitoring data found for pipeline '${pipelineId}'`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PipelineMonitor;
  } catch (e) {
    console.error(`Error: Failed to parse monitoring file for pipeline '${pipelineId}': ${(e as Error).message}`);
    process.exit(1);
  }
}

function saveMonitor(monitor: PipelineMonitor): void {
  ensureDir(MONITORING_DIR);
  fs.writeFileSync(getMonitorPath(monitor.pipelineId), JSON.stringify(monitor, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

function cmdInit(pipelineId: string, feature: string): void {
  const filePath = getMonitorPath(pipelineId);
  if (fs.existsSync(filePath)) {
    console.error(`Error: Monitoring data already exists for pipeline '${pipelineId}'`);
    process.exit(1);
  }

  const monitor: PipelineMonitor = {
    pipelineId,
    feature,
    startTimestamp: new Date().toISOString(),
    endTimestamp: null,
    status: 'running',
    gates: [],
  };

  saveMonitor(monitor);
  console.log(JSON.stringify({ ok: true, action: 'init', pipelineId, feature }));
}

function cmdTrack(pipelineId: string, gate: string, durationSec: number, result: string): void {
  if (result !== 'pass' && result !== 'fail') {
    console.error("Error: --result must be 'pass' or 'fail'");
    process.exit(1);
  }

  const monitor = loadMonitor(pipelineId);

  const gateResult: GateResult = {
    name: gate,
    durationSec,
    result: result as 'pass' | 'fail',
    timestamp: new Date().toISOString(),
  };

  monitor.gates.push(gateResult);

  if (result === 'fail') {
    monitor.status = 'failed';
    if (!monitor.endTimestamp) {
      monitor.endTimestamp = new Date().toISOString();
    }
  }

  saveMonitor(monitor);

  const passedCount = monitor.gates.filter(g => g.result === 'pass').length;
  const totalCount = monitor.gates.length;
  console.log(JSON.stringify({
    ok: true,
    action: 'track',
    pipelineId,
    gate,
    result,
    passedSoFar: `${passedCount}/${totalCount}`,
  }));
}

function cmdReport(pipelineId: string): void {
  const monitor = loadMonitor(pipelineId);

  const totalDurationSec = monitor.gates.reduce((sum, g) => sum + g.durationSec, 0);
  const passedGates = monitor.gates.filter(g => g.result === 'pass');
  const failedGates = monitor.gates.filter(g => g.result === 'fail');
  const isRunning = monitor.status === 'running';
  const allPassed = failedGates.length === 0;

  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('  Pipeline Monitoring Report');
  console.log('═══════════════════════════════════════════');
  console.log(`  Pipeline ID : ${monitor.pipelineId}`);
  console.log(`  Feature     : ${monitor.feature}`);
  console.log(`  Status      : ${monitor.status}`);
  console.log(`  Start       : ${monitor.startTimestamp}`);
  if (monitor.endTimestamp) {
    console.log(`  End         : ${monitor.endTimestamp}`);
  }
  console.log(`  Total Gates : ${monitor.gates.length}`);
  console.log(`  Passed      : ${passedGates.length}`);
  console.log(`  Failed      : ${failedGates.length}`);
  console.log(`  Total Time  : ${formatDuration(totalDurationSec)}`);
  console.log('───────────────────────────────────────────');

  if (monitor.gates.length === 0) {
    console.log('  No gates recorded yet.');
  } else {
    console.log('  Gate Breakdown:');
    console.log('');
    for (const gate of monitor.gates) {
      const icon = gate.result === 'pass' ? '✓' : '✗';
      console.log(`    ${icon} ${gate.name}`);
      console.log(`       Duration : ${formatDuration(gate.durationSec)}`);
      console.log(`       Time     : ${gate.timestamp}`);
      console.log('');
    }
  }

  if (isRunning) {
    console.log('  ⚠ Pipeline is still running.');
  } else if (allPassed) {
    console.log('  ✅ All gates passed.');
  } else {
    console.log('  ❌ Some gates failed.');
  }
  console.log('═══════════════════════════════════════════');
  console.log('');
}

function cmdDashboard(): void {
  ensureDir(MONITORING_DIR);
  const files = fs.readdirSync(MONITORING_DIR).filter(f => f.endsWith('.json'));

  if (files.length === 0) {
    console.log('No monitoring data found.');
    return;
  }

  const pipelines: PipelineMonitor[] = [];
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(MONITORING_DIR, file), 'utf-8');
      pipelines.push(JSON.parse(content) as PipelineMonitor);
    } catch {
      // skip malformed files
    }
  }

  const totalPipelines = pipelines.length;
  const completedOrFailed = pipelines.filter(p => p.status === 'completed' || p.status === 'failed');
  const passed = pipelines.filter(p => p.status === 'completed' || (p.status === 'failed' && p.gates.every(g => g.result === 'pass')));
  const passRate = completedOrFailed.length > 0 ? ((passed.length / completedOrFailed.length) * 100).toFixed(1) : 'N/A';

  const allGates = pipelines.flatMap(p => p.gates);
  const totalDuration = allGates.reduce((sum, g) => sum + g.durationSec, 0);
  const avgDuration = allGates.length > 0 ? totalDuration / allGates.length : 0;

  // Find most expensive gate (by total duration across all pipelines)
  const gateDurations: Record<string, number> = {};
  for (const gate of allGates) {
    gateDurations[gate.name] = (gateDurations[gate.name] || 0) + gate.durationSec;
  }
  let mostExpensiveGate = 'N/A';
  let maxDuration = 0;
  for (const [name, dur] of Object.entries(gateDurations)) {
    if (dur > maxDuration) {
      maxDuration = dur;
      mostExpensiveGate = name;
    }
  }

  const runningCount = pipelines.filter(p => p.status === 'running').length;

  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('  Pipeline Dashboard');
  console.log('═══════════════════════════════════════════');
  console.log(`  Total Pipelines       : ${totalPipelines}`);
  console.log(`  Running               : ${runningCount}`);
  console.log(`  Completed/Failed      : ${completedOrFailed.length}`);
  console.log(`  Pass Rate             : ${passRate}${typeof passRate === 'string' && passRate !== 'N/A' ? '%' : ''}`);
  console.log(`  Avg Gate Duration     : ${formatDuration(avgDuration)}`);
  console.log(`  Most Expensive Gate   : ${mostExpensiveGate} (${formatDuration(maxDuration)} total)`);
  console.log('───────────────────────────────────────────');
  console.log('  Pipelines:');
  console.log('');

  for (const p of pipelines) {
    const failedGates = p.gates.filter(g => g.result === 'fail').length;
    const statusIcon = p.status === 'running' ? '🔄' : (failedGates === 0 && p.gates.length > 0 ? '✅' : '❌');
    console.log(`    ${statusIcon} ${p.pipelineId} (${p.feature}) - ${p.status}`);
    console.log(`       Gates: ${p.gates.filter(g => g.result === 'pass').length}/${p.gates.length} passed`);
  }
  console.log('═══════════════════════════════════════════');
  console.log('');
}

function cmdAlert(pipelineId: string, timeoutMin: number): void {
  const monitor = loadMonitor(pipelineId);

  // If pipeline already completed or failed, it's not stuck
  if (monitor.status === 'completed' || monitor.status === 'failed') {
    process.exit(1); // Not stuck
  }

  const startTime = new Date(monitor.startTimestamp).getTime();
  const now = Date.now();
  const elapsedMs = now - startTime;
  const elapsedMin = elapsedMs / 60000;

  if (elapsedMin > timeoutMin) {
    console.log(JSON.stringify({
      ok: true,
      action: 'alert',
      pipelineId,
      stuck: true,
      elapsedMinutes: Math.round(elapsedMin * 100) / 100,
      timeoutMinutes: timeoutMin,
    }));
    process.exit(0); // Stuck
  } else {
    console.log(JSON.stringify({
      ok: true,
      action: 'alert',
      pipelineId,
      stuck: false,
      elapsedMinutes: Math.round(elapsedMin * 100) / 100,
      timeoutMinutes: timeoutMin,
    }));
    process.exit(1); // Not stuck
  }
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
    console.log('Pipeline Monitoring Script');
    console.log('');
    console.log('Usage:');
    console.log('  [runtime] monitor-pipeline.ts --init --pipeline-id=<id> --feature=<name>');
    console.log('  [runtime] monitor-pipeline.ts --track --pipeline-id=<id> --gate=<name> --duration-sec=<N> --result=pass|fail');
    console.log('  [runtime] monitor-pipeline.ts --report --pipeline-id=<id>');
    console.log('  [runtime] monitor-pipeline.ts --dashboard');
    console.log('  [runtime] monitor-pipeline.ts --alert --pipeline-id=<id> --check-stuck --timeout-min=<N>');
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
    const gate = get('--gate=');
    const durationSecStr = get('--duration-sec=');
    const result = get('--result=');
    if (!pipelineId || !gate || !durationSecStr || !result) {
      console.error('Error: --track requires --pipeline-id=<id> --gate=<name> --duration-sec=<N> --result=pass|fail');
      process.exit(1);
    }
    const durationSec = parseFloat(durationSecStr);
    if (isNaN(durationSec) || durationSec < 0) {
      console.error('Error: --duration-sec must be a non-negative number');
      process.exit(1);
    }
    cmdTrack(pipelineId, gate, durationSec, result);
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

  // --dashboard
  if (hasFlag('--dashboard')) {
    cmdDashboard();
    return;
  }

  // --alert
  if (hasFlag('--alert')) {
    const checkStuck = hasFlag('--check-stuck');
    const timeoutMinStr = get('--timeout-min=');
    if (!pipelineId || !checkStuck || !timeoutMinStr) {
      console.error('Error: --alert requires --pipeline-id=<id> --check-stuck --timeout-min=<N>');
      process.exit(1);
    }
    const timeoutMin = parseFloat(timeoutMinStr);
    if (isNaN(timeoutMin) || timeoutMin <= 0) {
      console.error('Error: --timeout-min must be a positive number');
      process.exit(1);
    }
    cmdAlert(pipelineId, timeoutMin);
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
