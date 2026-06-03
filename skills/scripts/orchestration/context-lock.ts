#!/usr/bin/env node
/**
 * Advisory File-Based Lock for agent-context.md
 *
 * Uses fs.mkdir atomicity to implement a cross-process lock for
 * agent-context.md, preventing race conditions during parallel agent dispatch.
 * fs.mkdir is atomic on all platforms (including Windows) — if two processes
 * try to mkdir the same path, only one succeeds.
 *
 * Lock Location: .opencode/locks/<pipelineId>.lock/ (a directory)
 * Lock Content: lock.json inside the lock directory with metadata.
 *
 * Usage:
 *   Acquire: [runtime] context-lock.ts acquire --pipeline-id=<id> --agent=<name> [--timeout=30000]
 *   Release: [runtime] context-lock.ts release --pipeline-id=<id>
 *   Status:  [runtime] context-lock.ts status --pipeline-id=<id>
 *
 * Exit codes:
 *   0 = Success (lock acquired, released, or status OK)
 *   1 = Lock acquisition failed (timeout, or lock held by another agent)
 *   2 = Usage error / missing arguments
 *
 * Output: All commands output JSON to stdout for machine readability.
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Constants ─────────────────────────────────────────────────────────────

const LOCKS_DIR = path.resolve(process.cwd(), '.opencode', 'locks');
const STALE_THRESHOLD_MS = 60_000; // 60 seconds
const HEARTBEAT_INTERVAL_MS = 15_000; // 15 seconds
const DEFAULT_TIMEOUT_MS = 30_000; // 30 seconds
const RETRY_DELAY_MS = 500; // 500ms between retries

// ── Types ─────────────────────────────────────────────────────────────────

interface LockInfo {
  pipelineId: string;
  agent: string;
  acquiredAt: string; // ISO-8601
  heartbeat: string;  // ISO-8601
  pid: number;
}

interface AcquireResult {
  command: 'acquire';
  pipelineId: string;
  agent: string;
  acquired: boolean;
  error?: string;
  lockInfo?: LockInfo;
}

interface ReleaseResult {
  command: 'release';
  pipelineId: string;
  released: boolean;
  error?: string;
}

interface StatusResult {
  command: 'status';
  pipelineId: string;
  lockHeld: boolean;
  lockInfo?: LockInfo & { isStale: boolean };
  error?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Compute the lock directory path for the given pipeline ID.
 */
function lockDirPath(pipelineId: string): string {
  return path.join(LOCKS_DIR, `${pipelineId}.lock`);
}

/**
 * Compute the lock.json file path inside the lock directory.
 */
function lockJsonPath(pipelineId: string): string {
  return path.join(lockDirPath(pipelineId), 'lock.json');
}

/**
 * Read and parse the lock.json file. Returns null if the file doesn't exist
 * or is unparseable.
 */
function readLockInfo(pipelineId: string): LockInfo | null {
  const jsonPath = lockJsonPath(pipelineId);
  try {
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    const parsed = JSON.parse(raw) as LockInfo;
    if (parsed && parsed.pipelineId && parsed.agent && parsed.heartbeat) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a lock is stale by comparing the heartbeat timestamp to now.
 */
function isLockStale(lockInfo: LockInfo): boolean {
  const heartbeatTime = new Date(lockInfo.heartbeat).getTime();
  if (isNaN(heartbeatTime)) return true; // unparseable timestamp → stale
  return Date.now() - heartbeatTime > STALE_THRESHOLD_MS;
}

/**
 * Write the lock.json file with current metadata.
 */
function writeLockInfo(pipelineId: string, agent: string): void {
  const now = new Date().toISOString();
  const lockInfo: LockInfo = {
    pipelineId,
    agent,
    acquiredAt: now,
    heartbeat: now,
    pid: process.pid,
  };
  const dir = lockDirPath(pipelineId);
  if (!fs.existsSync(dir)) {
    // If directory vanished (released by another process), recreate
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(lockJsonPath(pipelineId), JSON.stringify(lockInfo, null, 2), 'utf-8');
}

/**
 * Remove the lock directory recursively.
 */
function removeLockDir(pipelineId: string): void {
  const dir = lockDirPath(pipelineId);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore — directory may already be gone
  }
}

/**
 * Start a heartbeat interval. Returns the NodeJS.Timeout handle.
 * Updates the heartbeat field in lock.json every HEARTBEAT_INTERVAL_MS.
 */
function startHeartbeat(pipelineId: string): NodeJS.Timeout {
  return setInterval(() => {
    try {
      const existing = readLockInfo(pipelineId);
      if (existing) {
        existing.heartbeat = new Date().toISOString();
        fs.writeFileSync(lockJsonPath(pipelineId), JSON.stringify(existing, null, 2), 'utf-8');
      }
    } catch {
      // Lock may have been released — heartbeat failure is non-fatal
    }
  }, HEARTBEAT_INTERVAL_MS);
}

// ── Command Implementations ───────────────────────────────────────────────

/**
 * Acquire a lock for the given pipeline and agent.
 *
 * Uses fs.mkdirSync atomicity. Loops until the lock is acquired or the
 * timeout expires. If a stale lock is detected, it is removed and retried.
 *
 * @param pipelineId - Unique pipeline identifier
 * @param agent      - Name of the agent acquiring the lock
 * @param timeoutMs  - Maximum time to wait in milliseconds (default 30000)
 * @returns AcquireResult with status information
 */
function acquireLock(pipelineId: string, agent: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): AcquireResult {
  const startTime = Date.now();
  const dir = lockDirPath(pipelineId);

  // Ensure the locks parent directory exists
  if (!fs.existsSync(LOCKS_DIR)) {
    fs.mkdirSync(LOCKS_DIR, { recursive: true });
  }

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Attempt atomic directory creation to acquire the lock
      fs.mkdirSync(dir);
      // We own the lock — write metadata and start heartbeat
      writeLockInfo(pipelineId, agent);
      return {
        command: 'acquire',
        pipelineId,
        agent,
        acquired: true,
      };
    } catch (err: unknown) {
      // EEXIST means the directory already exists — lock is held by another process
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'EEXIST') {
        // Check if lock is stale
        const lockInfo = readLockInfo(pipelineId);
        if (lockInfo && isLockStale(lockInfo)) {
          // Stale lock — remove and retry
          removeLockDir(pipelineId);
          continue; // immediately retry (don't wait)
        }
        // Lock is valid — wait and retry
        const elapsed = Date.now() - startTime;
        if (elapsed + RETRY_DELAY_MS >= timeoutMs) {
          break; // would exceed timeout on next loop
        }
        sleep(RETRY_DELAY_MS);
        continue;
      }
      // Unexpected error
      return {
        command: 'acquire',
        pipelineId,
        agent,
        acquired: false,
        error: `Unexpected error creating lock directory: ${nodeErr.message}`,
      };
    }
  }

  // Timeout reached — lock not acquired
  const heldBy = readLockInfo(pipelineId);
  return {
    command: 'acquire',
    pipelineId,
    agent,
    acquired: false,
    error: heldBy
      ? `Lock held by agent "${heldBy.agent}" (pid ${heldBy.pid}) — timeout after ${Date.now() - startTime}ms`
      : `Timeout after ${Date.now() - startTime}ms`,
  };
}

/**
 * Release a lock for the given pipeline.
 * Clears heartbeat interval and removes the lock directory.
 *
 * @param pipelineId - Unique pipeline identifier
 * @param heartbeatHandle - The heartbeat interval handle to clear (optional)
 * @returns ReleaseResult with status information
 */
function releaseLock(pipelineId: string, heartbeatHandle?: NodeJS.Timeout): ReleaseResult {
  if (heartbeatHandle) {
    clearInterval(heartbeatHandle);
  }

  const dir = lockDirPath(pipelineId);
  if (!fs.existsSync(dir)) {
    return {
      command: 'release',
      pipelineId,
      released: true,
      error: 'No lock held — nothing to release',
    };
  }

  removeLockDir(pipelineId);
  return {
    command: 'release',
    pipelineId,
    released: true,
  };
}

/**
 * Check the status of a lock for the given pipeline.
 * Reports whether a lock is held, and if so, the lock metadata and staleness.
 *
 * @param pipelineId - Unique pipeline identifier
 * @returns StatusResult with status information
 */
function statusLock(pipelineId: string): StatusResult {
  const dir = lockDirPath(pipelineId);

  if (!fs.existsSync(dir)) {
    return {
      command: 'status',
      pipelineId,
      lockHeld: false,
    };
  }

  const lockInfo = readLockInfo(pipelineId);
  if (!lockInfo) {
    // Directory exists but no valid lock.json — stale/incomplete lock
    return {
      command: 'status',
      pipelineId,
      lockHeld: false,
      error: 'Lock directory exists but lock.json is missing or invalid',
    };
  }

  const stale = isLockStale(lockInfo);
  return {
    command: 'status',
    pipelineId,
    lockHeld: true,
    lockInfo: {
      ...lockInfo,
      isStale: stale,
    },
  };
}

/**
 * Synchronous sleep utility.
 */
function sleep(ms: number): void {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // Busy wait is the cross-platform synchronous sleep in Node.js
  }
}

// ── CLI Argument Parsing ──────────────────────────────────────────────────

interface ParsedArgs {
  command: 'acquire' | 'release' | 'status';
  pipelineId: string;
  agent?: string;
  timeout?: number;
}

/**
 * Parse CLI arguments into a structured object.
 * Exits with code 2 on missing/invalid arguments.
 */
function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0] as ParsedArgs['command'] | undefined;

  if (!command || !['acquire', 'release', 'status'].includes(command)) {
    console.log(JSON.stringify({ error: 'Missing or invalid command. Use: acquire, release, or status', usage: true }, null, 2));
    process.exit(2);
  }

  const pipelineId = extractArg(argv, '--pipeline-id');
  if (!pipelineId) {
    console.log(JSON.stringify({ error: 'Missing required argument: --pipeline-id=<id>', usage: true }, null, 2));
    process.exit(2);
  }

  if (command === 'acquire') {
    const agent = extractArg(argv, '--agent');
    if (!agent) {
      console.log(JSON.stringify({ error: 'Missing required argument for acquire: --agent=<name>', usage: true }, null, 2));
      process.exit(2);
    }
    const timeoutStr = extractArg(argv, '--timeout');
    const timeout = timeoutStr ? parseInt(timeoutStr, 10) : DEFAULT_TIMEOUT_MS;
    if (isNaN(timeout) || timeout < 0) {
      console.log(JSON.stringify({ error: 'Invalid --timeout value. Must be a non-negative integer (milliseconds).', usage: true }, null, 2));
      process.exit(2);
    }
    return { command, pipelineId, agent, timeout };
  }

  return { command, pipelineId };
}

function extractArg(argv: string[], prefix: string): string | undefined {
  const arg = argv.find(a => a.startsWith(`${prefix}=`));
  return arg?.split('=').slice(1).join('=');
}

// ── Main Entry Point ──────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case 'acquire': {
      const result = acquireLock(args.pipelineId, args.agent!, args.timeout);
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.acquired ? 0 : 1);
    }

    case 'release': {
      const result = releaseLock(args.pipelineId);
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    }

    case 'status': {
      const result = statusLock(args.pipelineId);
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    }
  }
}

if (require.main === module) {
  main();
}