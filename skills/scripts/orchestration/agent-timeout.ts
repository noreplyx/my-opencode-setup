#!/usr/bin/env node
/**
 * Agent Timeout Script
 *
 * Implements heartbeat-based stale agent detection with automatic timeout enforcement
 * for the OpenCode AI Agent orchestration system.
 *
 * Usage:
 *   [runtime] agent-timeout.ts watch --pipeline-id=<id> --agent=<name> --timeout=<ms> [--heartbeat-interval=<ms>]
 *   [runtime] agent-timeout.ts heartbeat --pipeline-id=<id> --agent=<name> [--status=<status>]
 *   [runtime] agent-timeout.ts check --pipeline-id=<id> --agent=<name>
 *   [runtime] agent-timeout.ts cancel --pipeline-id=<id> --agent=<name>
 *   [runtime] agent-timeout.ts list
 *
 * Exit codes:
 *   0 = Success (watch started, heartbeat updated, check: running, list OK, cancel OK)
 *   1 = Timeout detected (watch detects timeout, heartbeat on timed_out agent, check: timed_out)
 *   2 = Usage error / missing arguments
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AgentStatus = 'running' | 'completed' | 'failed' | 'timed_out';

interface HeartbeatData {
  pipelineId: string;
  agent: string;
  lastHeartbeat: string;
  status: AgentStatus;
  pid: number | null;
  timeoutMs: number;
  watchStartedAt: string;
}

interface WatchPidData {
  pid: number;
  pipelineId: string;
  agent: string;
  startedAt: string;
}

interface CliArgs {
  _command?: string;
  [key: string]: string | undefined;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEARTBEATS_DIR = path.resolve(process.cwd(), '.opencode', 'heartbeats');

const DEFAULT_HEARTBEAT_INTERVAL_MS = 15000;

const VALID_STATUSES: AgentStatus[] = ['running', 'completed', 'failed', 'timed_out'];

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse CLI arguments from process.argv. Arguments in the form --key=value are
 * parsed into key-value pairs. The first non-flag argument is treated as the
 * command via the "_command" pseudo-key.
 */
function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {};

  const command = args.find(a => !a.startsWith('--'));
  if (command) {
    result._command = command;
  }

  for (const arg of args) {
    if (arg.startsWith('--') && arg.includes('=')) {
      const eqIdx = arg.indexOf('=');
      const key = arg.substring(2, eqIdx);
      const value = arg.substring(eqIdx + 1);
      result[key] = value;
    }
  }

  return result;
}

/**
 * Print usage information and exit with the given code.
 */
function showUsageAndExit(exitCode = 0): void {
  const usage = {
    command: 'agent-timeout',
    description: 'Heartbeat-based stale agent detection with automatic timeout enforcement',
    usage: [
      '[runtime] agent-timeout.ts watch --pipeline-id=<id> --agent=<name> --timeout=<ms> [--heartbeat-interval=<ms>]',
      '[runtime] agent-timeout.ts heartbeat --pipeline-id=<id> --agent=<name> [--status=<status>]',
      '[runtime] agent-timeout.ts check --pipeline-id=<id> --agent=<name>',
      '[runtime] agent-timeout.ts cancel --pipeline-id=<id> --agent=<name>',
      '[runtime] agent-timeout.ts list',
    ],
    commands: {
      watch: 'Start monitoring an agent with heartbeat timeout detection. Runs as a background process.',
      heartbeat: 'Send a heartbeat signal. Creates the heartbeat file if it does not exist.',
      check: 'Check the status of an agent without modifying state.',
      cancel: 'Remove heartbeat and watch PID files for an agent.',
      list: 'List all active heartbeat files.',
    },
    options: {
      '--pipeline-id': '(required) Pipeline identifier',
      '--agent': '(required) Agent name',
      '--timeout': '(required for watch) Timeout in milliseconds',
      '--heartbeat-interval': '(optional) Monitoring interval in ms (default: min(timeout/10, 10000))',
      '--status': '(optional for heartbeat) Status to set: running, completed, failed',
    },
    exitCodes: {
      0: 'Success',
      1: 'Timeout detected or error',
      2: 'Usage error / missing arguments',
    },
  };

  console.log(JSON.stringify(usage, null, 2));
  process.exit(exitCode);
}

// ---------------------------------------------------------------------------
// File path helpers
// ---------------------------------------------------------------------------

/**
 * Get the heartbeat file path for a given pipeline and agent.
 */
function getHeartbeatFilePath(pipelineId: string, agent: string): string {
  return path.join(HEARTBEATS_DIR, `${pipelineId}-${agent}.heartbeat.json`);
}

/**
 * Get the watch PID file path for a given pipeline and agent.
 */
function getWatchPidFilePath(pipelineId: string, agent: string): string {
  return path.join(HEARTBEATS_DIR, `${pipelineId}-${agent}.watch.pid.json`);
}

/**
 * Ensure the heartbeats directory exists, creating it if necessary.
 */
function ensureHeartbeatsDir(): void {
  if (!fs.existsSync(HEARTBEATS_DIR)) {
    fs.mkdirSync(HEARTBEATS_DIR, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Heartbeat file I/O
// ---------------------------------------------------------------------------

/**
 * Read a heartbeat file and parse its contents.
 * Returns null if the file does not exist or cannot be parsed.
 */
function readHeartbeatFile(pipelineId: string, agent: string): HeartbeatData | null {
  const filePath = getHeartbeatFilePath(pipelineId, agent);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as HeartbeatData;
  } catch {
    return null;
  }
}

/**
 * Write a heartbeat data object to disk as JSON.
 */
function writeHeartbeatFile(data: HeartbeatData): void {
  ensureHeartbeatsDir();
  const filePath = getHeartbeatFilePath(data.pipelineId, data.agent);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Watch PID file I/O
// ---------------------------------------------------------------------------

/**
 * Read the watch PID file for a given pipeline and agent.
 * Returns null if the file does not exist or cannot be parsed.
 */
function readWatchPidFile(pipelineId: string, agent: string): WatchPidData | null {
  const filePath = getWatchPidFilePath(pipelineId, agent);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as WatchPidData;
  } catch {
    return null;
  }
}

/**
 * Write watch PID data to disk.
 */
function writeWatchPidFile(data: WatchPidData): void {
  ensureHeartbeatsDir();
  const filePath = getWatchPidFilePath(data.pipelineId, data.agent);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Remove the watch PID file for a given pipeline and agent.
 */
function removeWatchPidFile(pipelineId: string, agent: string): void {
  const filePath = getWatchPidFilePath(pipelineId, agent);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Validate that required arguments are present. Exits with code 2 if not.
 */
function requireArgs(args: CliArgs, keys: string[]): void {
  const missing = keys.filter(k => !args[k]);
  if (missing.length > 0) {
    console.log(JSON.stringify({
      error: 'Missing required arguments',
      missing,
      exitCode: 2,
    }));
    process.exit(2);
  }
}

/**
 * Validate that a status value is valid. Exits with code 2 if not.
 */
function validateStatus(status: string): AgentStatus {
  if (!VALID_STATUSES.includes(status as AgentStatus)) {
    console.log(JSON.stringify({
      error: `Invalid status "${status}". Valid values: ${VALID_STATUSES.join(', ')}`,
      exitCode: 2,
    }));
    process.exit(2);
  }
  return status as AgentStatus;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * watch command: Start monitoring an agent with heartbeat timeout detection.
 *
 * Creates the heartbeat file and starts a monitoring interval that checks
 * whether the agent's lastHeartbeat has exceeded the timeout threshold.
 * If so, marks the agent as timed_out. Exits cleanly if the agent completes
 * or fails.
 */
function cmdWatch(args: CliArgs): void {
  requireArgs(args, ['pipeline-id', 'agent', 'timeout']);

  const pipelineId = args['pipeline-id']!;
  const agent = args['agent']!;
  const timeoutMs = parseInt(args['timeout']!, 10);

  if (isNaN(timeoutMs) || timeoutMs <= 0) {
    console.log(JSON.stringify({
      error: '--timeout must be a positive integer (milliseconds)',
      exitCode: 2,
    }));
    process.exit(2);
  }

  // Determine monitoring interval: min(timeoutMs / 10, 10000)
  const heartbeatInterval = args['heartbeat-interval']
    ? parseInt(args['heartbeat-interval'], 10)
    : Math.min(Math.floor(timeoutMs / 10), 10000);

  const now = new Date();
  const nowIso = now.toISOString();

  // Create heartbeat file
  const heartbeatData: HeartbeatData = {
    pipelineId,
    agent,
    lastHeartbeat: nowIso,
    status: 'running',
    pid: process.pid,
    timeoutMs,
    watchStartedAt: nowIso,
  };
  writeHeartbeatFile(heartbeatData);

  // Write watch PID file
  const watchPidData: WatchPidData = {
    pid: process.pid,
    pipelineId,
    agent,
    startedAt: nowIso,
  };
  writeWatchPidFile(watchPidData);

  // Print confirmation (JSON for machine readability)
  console.log(JSON.stringify({
    status: 'watch_started',
    pipelineId,
    agent,
    timeoutMs,
    heartbeatInterval,
    pid: process.pid,
    watchStartedAt: nowIso,
  }));

  // Start monitoring interval
  const intervalId = setInterval(() => {
    const currentData = readHeartbeatFile(pipelineId, agent);

    if (!currentData) {
      // Heartbeat file removed — agent was cancelled
      console.log(JSON.stringify({
        status: 'watch_stopped',
        reason: 'heartbeat_file_removed',
        pipelineId,
        agent,
      }));
      clearInterval(intervalId);
      process.exit(0);
    }

    // Check if agent completed or failed (exit cleanly)
    if (currentData.status === 'completed' || currentData.status === 'failed') {
      console.log(JSON.stringify({
        status: 'watch_stopped',
        reason: `agent_${currentData.status}`,
        pipelineId,
        agent,
        finalStatus: currentData.status,
        lastHeartbeat: currentData.lastHeartbeat,
      }));
      clearInterval(intervalId);
      process.exit(0);
    }

    // Check if already timed_out (possibly by another watch process)
    if (currentData.status === 'timed_out') {
      console.log(JSON.stringify({
        status: 'timeout_detected',
        pipelineId,
        agent,
        reason: 'already_timed_out',
        lastHeartbeat: currentData.lastHeartbeat,
        timeoutMs: currentData.timeoutMs,
      }));
      clearInterval(intervalId);
      process.exit(1);
    }

    // Check timeout
    const lastHeartbeatTime = new Date(currentData.lastHeartbeat).getTime();
    const nowTime = Date.now();
    const elapsed = nowTime - lastHeartbeatTime;

    if (elapsed > currentData.timeoutMs) {
      // Mark as timed_out
      currentData.status = 'timed_out';
      currentData.lastHeartbeat = new Date().toISOString();
      writeHeartbeatFile(currentData);

      console.log(JSON.stringify({
        status: 'timeout_detected',
        pipelineId,
        agent,
        elapsed,
        timeoutMs: currentData.timeoutMs,
        lastHeartbeat: currentData.lastHeartbeat,
      }));
      clearInterval(intervalId);
      process.exit(1);
    }
  }, heartbeatInterval);
}

/**
 * heartbeat command: Send a heartbeat signal for an agent.
 *
 * Reads the heartbeat file and updates lastHeartbeat to now. If the file
 * does not exist, creates it with default parameters. If the agent is
 * timed_out, prints a warning and exits 1. If completed/failed, updates
 * timestamp but keeps status.
 */
function cmdHeartbeat(args: CliArgs): void {
  requireArgs(args, ['pipeline-id', 'agent']);

  const pipelineId = args['pipeline-id']!;
  const agent = args['agent']!;
  const statusArg = args['status'] || 'running';

  const now = new Date().toISOString();

  // Check if heartbeat file exists
  let data = readHeartbeatFile(pipelineId, agent);

  if (!data) {
    // Create heartbeat file with defaults
    data = {
      pipelineId,
      agent,
      lastHeartbeat: now,
      status: validateStatus(statusArg === 'running' ? 'running' : statusArg),
      pid: process.pid,
      timeoutMs: 300000, // default 5 minutes
      watchStartedAt: now,
    };
    writeHeartbeatFile(data);

    console.log(JSON.stringify({
      status: 'heartbeat_created',
      pipelineId,
      agent,
      lastHeartbeat: now,
      heartbeatStatus: data.status,
    }));
    process.exit(0);
  }

  // If timed_out, warn and exit 1
  if (data.status === 'timed_out') {
    const elapsed = Date.now() - new Date(data.lastHeartbeat).getTime();
    console.log(JSON.stringify({
      status: 'agent_timed_out',
      pipelineId,
      agent,
      elapsed,
      timeoutMs: data.timeoutMs,
      lastHeartbeat: data.lastHeartbeat,
      warning: 'Agent has timed out. Heartbeat rejected.',
    }));
    process.exit(1);
  }

  // If completed or failed, update timestamp but keep status
  let newStatus: AgentStatus = data.status;
  if (statusArg && statusArg !== 'running') {
    newStatus = validateStatus(statusArg);
  } else if (data.status === 'running') {
    newStatus = 'running';
  }
  // For completed/failed: keep existing status (only --status flag can override, but we respect
  // that completed/failed are terminal states and won't revert to running)

  data.lastHeartbeat = now;
  data.status = newStatus;
  data.pid = process.pid;
  writeHeartbeatFile(data);

  console.log(JSON.stringify({
    status: 'heartbeat_updated',
    pipelineId,
    agent,
    lastHeartbeat: now,
    heartbeatStatus: data.status,
  }));
}

/**
 * check command: Check the status of an agent without modifying state.
 *
 * Reports whether the agent is running, likely timed out, or definitively
 * timed out based on the heartbeat file.
 */
function cmdCheck(args: CliArgs): void {
  requireArgs(args, ['pipeline-id', 'agent']);

  const pipelineId = args['pipeline-id']!;
  const agent = args['agent']!;

  const data = readHeartbeatFile(pipelineId, agent);

  if (!data) {
    console.log(JSON.stringify({
      status: 'not_found',
      pipelineId,
      agent,
      message: 'No heartbeat file found — agent has not started or watch not created',
      exitCode: 0,
    }));
    return;
  }

  const now = Date.now();
  const lastHeartbeatTime = new Date(data.lastHeartbeat).getTime();
  const elapsed = now - lastHeartbeatTime;

  if (data.status === 'timed_out') {
    console.log(JSON.stringify({
      status: 'timed_out',
      pipelineId,
      agent,
      elapsed,
      timeoutMs: data.timeoutMs,
      lastHeartbeat: data.lastHeartbeat,
      agentStatus: data.status,
      exitCode: 1,
    }));
    process.exit(1);
  }

  if (elapsed > data.timeoutMs) {
    console.log(JSON.stringify({
      status: 'likely_timed_out',
      pipelineId,
      agent,
      elapsed,
      timeoutMs: data.timeoutMs,
      lastHeartbeat: data.lastHeartbeat,
      agentStatus: data.status,
      message: 'Heartbeat has expired but status has not been marked as timed_out yet',
      exitCode: 0,
    }));
    return;
  }

  console.log(JSON.stringify({
    status: 'running',
    pipelineId,
    agent,
    elapsed,
    timeoutMs: data.timeoutMs,
    lastHeartbeat: data.lastHeartbeat,
    agentStatus: data.status,
    exitCode: 0,
  }));
}

/**
 * cancel command: Remove heartbeat and watch PID files for an agent.
 */
function cmdCancel(args: CliArgs): void {
  requireArgs(args, ['pipeline-id', 'agent']);

  const pipelineId = args['pipeline-id']!;
  const agent = args['agent']!;

  const heartbeatPath = getHeartbeatFilePath(pipelineId, agent);
  const watchPidPath = getWatchPidFilePath(pipelineId, agent);

  let removedHeartbeat = false;
  let removedWatchPid = false;

  if (fs.existsSync(heartbeatPath)) {
    fs.unlinkSync(heartbeatPath);
    removedHeartbeat = true;
  }

  if (fs.existsSync(watchPidPath)) {
    fs.unlinkSync(watchPidPath);
    removedWatchPid = true;
  }

  console.log(JSON.stringify({
    status: 'cancelled',
    pipelineId,
    agent,
    heartbeatRemoved: removedHeartbeat,
    watchPidRemoved: removedWatchPid,
    exitCode: 0,
  }));
}

/**
 * list command: List all active heartbeat files.
 */
function cmdList(): void {
  ensureHeartbeatsDir();

  const files = fs.readdirSync(HEARTBEATS_DIR);
  const heartbeatFiles = files.filter(f => f.endsWith('.heartbeat.json'));

  const agents: Array<{
    pipelineId: string;
    agent: string;
    status: AgentStatus | null;
    lastHeartbeat: string | null;
    elapsed: number | null;
    timeoutMs: number | null;
    heartbeatFile: string;
  }> = [];

  for (const file of heartbeatFiles) {
    const filePath = path.join(HEARTBEATS_DIR, file);
    const match = file.match(/^(.+)-(.+)\.heartbeat\.json$/);
    const pipelineId = match ? match[1] : 'unknown';
    const agent = match ? match[2] : 'unknown';

    let status: AgentStatus | null = null;
    let lastHeartbeat: string | null = null;
    let elapsed: number | null = null;
    let timeoutMs: number | null = null;

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content) as HeartbeatData;
      status = data.status;
      lastHeartbeat = data.lastHeartbeat;
      timeoutMs = data.timeoutMs;
      elapsed = Date.now() - new Date(data.lastHeartbeat).getTime();
    } catch {
      // If we can't parse, report as unknown
      status = null;
    }

    agents.push({
      pipelineId,
      agent,
      status,
      lastHeartbeat,
      elapsed,
      timeoutMs,
      heartbeatFile: file,
    });
  }

  console.log(JSON.stringify({
    status: 'ok',
    agentCount: agents.length,
    agents,
    exitCode: 0,
  }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Entry point. Parses CLI arguments and dispatches to the appropriate command.
 */
function main(): void {
  const args = parseArgs();
  const command = args._command;

  // --help or no command
  if (!command || command === '--help' || command === '-h') {
    showUsageAndExit(0);
  }

  switch (command) {
    case 'watch':
      cmdWatch(args);
      break;

    case 'heartbeat':
      cmdHeartbeat(args);
      break;

    case 'check':
      cmdCheck(args);
      break;

    case 'cancel':
      cmdCancel(args);
      break;

    case 'list':
      cmdList();
      break;

    default:
      console.log(JSON.stringify({
        error: `Unknown command: "${command}"`,
        validCommands: ['watch', 'heartbeat', 'check', 'cancel', 'list'],
        exitCode: 2,
      }));
      process.exit(2);
  }
}

// Allow running as a CLI script or importing as a module
if (require.main === module) {
  main();
}