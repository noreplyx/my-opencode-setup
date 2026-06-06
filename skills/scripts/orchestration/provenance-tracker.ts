#!/usr/bin/env node
/**
 * Provenance Tracker Script
 *
 * Tracks checkpoint-level lifecycle through the pipeline.
 * Each checkpoint in the plan manifest is tracked through:
 *   CREATION (PlanDescriber) -> IMPLEMENTATION (Implementor) -> VERIFICATION (Verifier) -> FIX (Fixer)
 *
 * Data is stored at .opencode/provenance/<pipelineId>.json
 *
 * Usage:
 *   [runtime] provenance-tracker.ts --init --manifest=<path>
 *   [runtime] provenance-tracker.ts --implement --manifest=<path> --agent=<name> --session=<id> --checkpoint=<id> --file=<path> --lines=<range> --claim="..."
 *   [runtime] provenance-tracker.ts --verify --manifest=<path> --checkpoint=<id> --verdict=<pass|fail> --evidence="<command>" --result=<found|not_found>
 *   [runtime] provenance-tracker.ts --fix --manifest=<path> --checkpoint=<id> --agent=<name> --session=<id> --file=<path> --lines=<range> --claim="..."
 *   [runtime] provenance-tracker.ts --view --manifest=<path> --checkpoint=<id>
 *   [runtime] provenance-tracker.ts --summary --manifest=<path>
 *
 * Exit codes:
 *   0 = Success
 *   1 = Error
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVENANCE_DIR = path.resolve('.opencode/provenance');
const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Lifecycle event types */
type LifecycleEvent = 'created' | 'implemented' | 'verified' | 'fixed' | 're-verified';

/** Verdict for a verification event */
type Verdict = 'pass' | 'fail' | 'skipped';

/** Provenance data file on disk */
interface ProvenanceFile {
  pipelineId: string;
  manifestPath: string;
  createdAt: string;
  updatedAt: string;
  checkpoints: Record<string, CheckpointProvenance>;
}

/** Provenance for a single checkpoint */
interface CheckpointProvenance {
  id: string;
  description: string;
  type: string;
  target: string;
  lifecycle: ProvenanceEvent[];
  currentState: LifecycleEvent;
  currentVerdict: Verdict | null;
}

/** A single lifecycle event */
interface ProvenanceEvent {
  event: LifecycleEvent;
  agent: string;
  session: string | null;
  timestamp: string;
  evidence: ProvenanceEvidence | null;
}

/** Evidence attached to a lifecycle event */
interface ProvenanceEvidence {
  file: string;
  lines: number[];
  claim: string;
  command: string;
  result: string;
  contentHash: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoNow(): string {
  return new Date().toISOString();
}

function computeFileHash(filePath: string): string | null {
  try {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) return null;
    const content = fs.readFileSync(resolved, 'utf-8');
    return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
  } catch {
    return null;
  }
}

function generateUuid(): string {
  return `provenance-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/** Parse a range string like "10,20" into [10, 20] */
function parseLines(range: string | undefined): number[] {
  if (!range) return [];
  const parts = range.split(',').map((s) => parseInt(s.trim(), 10));
  return parts.filter((n) => !isNaN(n));
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

function ensureProvenanceDir(): void {
  if (!fs.existsSync(PROVENANCE_DIR)) {
    fs.mkdirSync(PROVENANCE_DIR, { recursive: true });
  }
}

function getProvenancePath(pipelineId: string): string {
  return path.join(PROVENANCE_DIR, `${pipelineId}.json`);
}

function getPipelineIdFromManifest(manifestPath: string): string | null {
  try {
    const resolved = path.resolve(manifestPath);
    const content = readFileSafe(resolved);
    if (!content) return null;
    const manifest = JSON.parse(content);
    return `manifest-${crypto.createHash('sha256').update(resolved + content).digest('hex').substring(0, 12)}`;
  } catch {
    return null;
  }
}

function readFileSafe(filePath: string): string | null {
  try {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) return null;
    let content = fs.readFileSync(resolved, 'utf-8');
    // Strip UTF-8 BOM (EF BB BF) if present
    if (content.length > 0 && content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1);
    }
    return content;
  } catch {
    return null;
  }
}

function loadManifest(manifestPath: string): Record<string, any> | null {
  try {
    const resolved = path.resolve(manifestPath);
    const content = readFileSafe(resolved);
    if (!content) return null;
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function loadProvenance(pipelineId: string): ProvenanceFile {
  const provPath = getProvenancePath(pipelineId);
  if (fs.existsSync(provPath)) {
    try {
      const content = readFileSafe(provPath);
      if (content) return JSON.parse(content);
    } catch {
      // Corrupted file — return default
    }
  }
  return {
    pipelineId,
    manifestPath: '',
    createdAt: isoNow(),
    updatedAt: isoNow(),
    checkpoints: {},
  };
}

function saveProvenance(data: ProvenanceFile): void {
  ensureProvenanceDir();
  data.updatedAt = isoNow();
  const provPath = getProvenancePath(data.pipelineId);
  fs.writeFileSync(provPath, JSON.stringify(data, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Command Handlers
// ---------------------------------------------------------------------------

/**
 * --init: Initialize provenance from a plan manifest.
 * Reads all checkpoints from the manifest and creates initial "created" events.
 */
function handleInit(manifestPath: string): void {
  const manifest = loadManifest(manifestPath);
  if (!manifest) {
    console.error(`Error: Could not load manifest at "${manifestPath}"`);
    process.exit(1);
  }

  const pipelineId = getPipelineIdFromManifest(manifestPath);
  if (!pipelineId) {
    console.error('Error: Could not derive pipeline ID from manifest');
    process.exit(1);
  }

  const checkpoints = manifest.checkpoints;
  if (!Array.isArray(checkpoints) || checkpoints.length === 0) {
    console.error('Error: Manifest has no checkpoints');
    process.exit(1);
  }

  const prov = loadProvenance(pipelineId);
  prov.manifestPath = path.resolve(manifestPath);

  for (const cp of checkpoints) {
    if (!cp.id) continue;

    // Skip if already initialized (append-only — never overwrite)
    if (prov.checkpoints[cp.id]) continue;

    prov.checkpoints[cp.id] = {
      id: cp.id,
      description: cp.description || '(no description)',
      type: cp.type || 'unknown',
      target: cp.target || '',
      lifecycle: [
        {
          event: 'created',
          agent: 'plandescriber',
          session: null,
          timestamp: manifest.createdAt || isoNow(),
          evidence: {
            file: manifestPath,
            lines: [],
            claim: `Checkpoint ${cp.id}: ${cp.description}`,
            command: `read manifest at ${manifestPath}`,
            result: 'manifest_entry',
            contentHash: computeFileHash(manifestPath),
          },
        },
      ],
      currentState: 'created',
      currentVerdict: null,
    };
  }

  saveProvenance(prov);

  const checkpointCount = Object.keys(prov.checkpoints).length;
  console.log(JSON.stringify({
    status: 'completed',
    resultSummary: `Initialized provenance for ${checkpointCount} checkpoints`,
    pipelineId,
    checkpointCount,
    manifestPath: path.resolve(manifestPath),
  }, null, 2));
}

/**
 * --implement: Record an implementation event for a checkpoint.
 */
function handleImplement(
  manifestPath: string,
  agent: string,
  session: string,
  checkpointId: string,
  file: string,
  lines: string,
  claim: string,
): void {
  const pipelineId = getPipelineIdFromManifest(manifestPath);
  if (!pipelineId) {
    console.error('Error: Could not derive pipeline ID from manifest');
    process.exit(1);
  }

  const prov = loadProvenance(pipelineId);
  const cp = prov.checkpoints[checkpointId];
  if (!cp) {
    console.error(`Error: Checkpoint "${checkpointId}" not found in provenance. Run --init first.`);
    process.exit(1);
  }

  const contentHash = computeFileHash(file);
  const lineNumbers = parseLines(lines);

  cp.lifecycle.push({
    event: 'implemented',
    agent,
    session: session || null,
    timestamp: isoNow(),
    evidence: {
      file,
      lines: lineNumbers,
      claim,
      command: `grep/read ${file} lines ${lines}`,
      result: 'implemented',
      contentHash,
    },
  });
  cp.currentState = 'implemented';

  saveProvenance(prov);

  console.log(JSON.stringify({
    status: 'completed',
    resultSummary: `Recorded implementation for ${checkpointId}`,
    checkpointId,
    event: 'implemented',
    agent,
    file,
    contentHash,
  }, null, 2));
}

/**
 * --verify: Record a verification verdict for a checkpoint.
 */
function handleVerify(
  manifestPath: string,
  checkpointId: string,
  verdict: string,
  evidence: string,
  result: string,
): void {
  const pipelineId = getPipelineIdFromManifest(manifestPath);
  if (!pipelineId) {
    console.error('Error: Could not derive pipeline ID from manifest');
    process.exit(1);
  }

  const prov = loadProvenance(pipelineId);
  const cp = prov.checkpoints[checkpointId];
  if (!cp) {
    console.error(`Error: Checkpoint "${checkpointId}" not found in provenance. Run --init first.`);
    process.exit(1);
  }

  const normalizedVerdict = (verdict === 'pass' || verdict === 'fail' || verdict === 'skipped')
    ? (verdict as Verdict)
    : 'fail';

  const eventType: LifecycleEvent = cp.currentState === 'fixed' ? 're-verified' : 'verified';

  cp.lifecycle.push({
    event: eventType,
    agent: 'verifier',
    session: null,
    timestamp: isoNow(),
    evidence: {
      file: cp.target,
      lines: [],
      claim: evidence || `Verify ${checkpointId}`,
      command: evidence || '(no command)',
      result: result || normalizedVerdict,
      contentHash: cp.target ? computeFileHash(cp.target) : null,
    },
  });
  cp.currentState = eventType;
  cp.currentVerdict = normalizedVerdict;

  saveProvenance(prov);

  console.log(JSON.stringify({
    status: 'completed',
    resultSummary: `Recorded ${eventType} for ${checkpointId}: ${normalizedVerdict}`,
    checkpointId,
    event: eventType,
    verdict: normalizedVerdict,
  }, null, 2));
}

/**
 * --fix: Record a fix event for a checkpoint.
 */
function handleFix(
  manifestPath: string,
  checkpointId: string,
  agent: string,
  session: string,
  file: string,
  lines: string,
  claim: string,
): void {
  const pipelineId = getPipelineIdFromManifest(manifestPath);
  if (!pipelineId) {
    console.error('Error: Could not derive pipeline ID from manifest');
    process.exit(1);
  }

  const prov = loadProvenance(pipelineId);
  const cp = prov.checkpoints[checkpointId];
  if (!cp) {
    console.error(`Error: Checkpoint "${checkpointId}" not found in provenance. Run --init first.`);
    process.exit(1);
  }

  const contentHash = computeFileHash(file);
  const lineNumbers = parseLines(lines);

  cp.lifecycle.push({
    event: 'fixed',
    agent,
    session: session || null,
    timestamp: isoNow(),
    evidence: {
      file,
      lines: lineNumbers,
      claim,
      command: `grep/read ${file} lines ${lines}`,
      result: 'fixed',
      contentHash,
    },
  });
  cp.currentState = 'fixed';
  cp.currentVerdict = null; // Reset verdict — needs re-verification

  saveProvenance(prov);

  console.log(JSON.stringify({
    status: 'completed',
    resultSummary: `Recorded fix for ${checkpointId}`,
    checkpointId,
    event: 'fixed',
    agent,
    file,
    contentHash,
  }, null, 2));
}

/**
 * --view: View the full provenance chain for a checkpoint.
 */
function handleView(manifestPath: string, checkpointId: string): void {
  const pipelineId = getPipelineIdFromManifest(manifestPath);
  if (!pipelineId) {
    console.error('Error: Could not derive pipeline ID from manifest');
    process.exit(1);
  }

  const prov = loadProvenance(pipelineId);
  const cp = prov.checkpoints[checkpointId];
  if (!cp) {
    console.error(`Error: Checkpoint "${checkpointId}" not found in provenance.`);
    console.error('Available checkpoints:');
    for (const key of Object.keys(prov.checkpoints).sort()) {
      const c = prov.checkpoints[key];
      console.error(`  ${key}: ${c.description} (${c.currentState})`);
    }
    process.exit(1);
  }

  // Print as structured JSON
  const output = {
    pipelineId: prov.pipelineId,
    checkpoint: cp,
    lifecycleSummary: cp.lifecycle.map((e) => ({
      event: e.event,
      agent: e.agent,
      timestamp: e.timestamp,
      result: e.evidence?.result || null,
    })),
  };

  console.log(JSON.stringify(output, null, 2));
}

/**
 * --summary: Print a full provenance summary across all checkpoints.
 */
function handleSummary(manifestPath: string): void {
  const pipelineId = getPipelineIdFromManifest(manifestPath);
  if (!pipelineId) {
    console.error('Error: Could not derive pipeline ID from manifest');
    process.exit(1);
  }

  const prov = loadProvenance(pipelineId);
  const checkpointIds = Object.keys(prov.checkpoints).sort();

  if (checkpointIds.length === 0) {
    console.log(JSON.stringify({
      pipelineId: prov.pipelineId,
      manifestPath: prov.manifestPath,
      checkpointCount: 0,
      summary: 'No checkpoints initialized. Run --init first.',
    }, null, 2));
    return;
  }

  const states: Record<string, number> = {};
  const verdicts: Record<string, number> = {};
  let totalEvents = 0;

  for (const cp of Object.values(prov.checkpoints)) {
    states[cp.currentState] = (states[cp.currentState] || 0) + 1;
    if (cp.currentVerdict) {
      verdicts[cp.currentVerdict] = (verdicts[cp.currentVerdict] || 0) + 1;
    }
    totalEvents += cp.lifecycle.length;
  }

  const passedCheckpoints = verdicts['pass'] || 0;
  const failedCheckpoints = verdicts['fail'] || 0;

  const output = {
    pipelineId: prov.pipelineId,
    manifestPath: prov.manifestPath,
    checkpointCount: checkpointIds.length,
    totalLifecycleEvents: totalEvents,
    stateBreakdown: states,
    verdictBreakdown: verdicts,
    complianceScore: checkpointIds.length > 0
      ? Math.round((passedCheckpoints / checkpointIds.length) * 100)
      : 0,
    checkpoints: checkpointIds.map((id) => ({
      id,
      description: prov.checkpoints[id].description,
      type: prov.checkpoints[id].type,
      target: prov.checkpoints[id].target,
      currentState: prov.checkpoints[id].currentState,
      currentVerdict: prov.checkpoints[id].currentVerdict,
      events: prov.checkpoints[id].lifecycle.map((e) => ({
        event: e.event,
        agent: e.agent,
        timestamp: e.timestamp,
      })),
    })),
  };

  console.log(JSON.stringify(output, null, 2));
}

// ---------------------------------------------------------------------------
// CLI Entry Point
// ---------------------------------------------------------------------------

function parseArgs(): Record<string, string> {
  const args = process.argv.slice(2);
  const result: Record<string, string> = {};

  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.substring(2, eqIdx);
        const value = arg.substring(eqIdx + 1);
        result[key] = value;
      } else {
        result[arg.substring(2)] = 'true';
      }
    }
  }

  return result;
}

function printUsage(): void {
  console.log(`
Provenance Tracker — Checkpoint Lifecycle Tracking

Usage:
  [runtime] provenance-tracker.ts --init --manifest=<path>
      Initialize provenance from a plan manifest (reads all checkpoints)

  [runtime] provenance-tracker.ts --implement --manifest=<path> --agent=<name> --session=<id>
      --checkpoint=<id> --file=<path> --lines=<start,end> --claim="..."
      Record implementation evidence for a checkpoint

  [runtime] provenance-tracker.ts --verify --manifest=<path> --checkpoint=<id>
      --verdict=<pass|fail|skipped> --evidence="<command>" --result=<found|not_found>
      Record verification verdict for a checkpoint

  [runtime] provenance-tracker.ts --fix --manifest=<path> --checkpoint=<id>
      --agent=<name> --session=<id> --file=<path> --lines=<start,end> --claim="..."
      Record a fix event for a checkpoint

  [runtime] provenance-tracker.ts --view --manifest=<path> --checkpoint=<id>
      View full provenance chain for a checkpoint

  [runtime] provenance-tracker.ts --summary --manifest=<path>
      Print provenance summary across all checkpoints

Exit codes:
  0 = Success
  1 = Error
`);
}

function main(): void {
  const args = parseArgs();

  // --help
  if (args['help'] === 'true' || Object.keys(args).length === 0) {
    printUsage();
    process.exit(0);
  }

  // --init
  if (args['init'] === 'true') {
    if (!args['manifest']) {
      console.error('Error: --manifest=<path> is required for --init');
      process.exit(1);
    }
    handleInit(args['manifest']);
    process.exit(0);
  }

  // --implement
  if (args['implement'] === 'true') {
    if (!args['manifest'] || !args['checkpoint'] || !args['file'] || !args['claim']) {
      console.error('Error: --manifest, --checkpoint, --file, and --claim are required for --implement');
      console.error('Optional: --agent, --session, --lines');
      process.exit(1);
    }
    handleImplement(
      args['manifest'],
      args['agent'] || 'implementor',
      args['session'] || '',
      args['checkpoint'],
      args['file'],
      args['lines'] || '',
      args['claim'],
    );
    process.exit(0);
  }

  // --verify
  if (args['verify'] === 'true') {
    if (!args['manifest'] || !args['checkpoint'] || !args['verdict']) {
      console.error('Error: --manifest, --checkpoint, and --verdict are required for --verify');
      process.exit(1);
    }
    handleVerify(
      args['manifest'],
      args['checkpoint'],
      args['verdict'],
      args['evidence'] || '',
      args['result'] || args['verdict'],
    );
    process.exit(0);
  }

  // --fix
  if (args['fix'] === 'true') {
    if (!args['manifest'] || !args['checkpoint'] || !args['file'] || !args['claim']) {
      console.error('Error: --manifest, --checkpoint, --file, and --claim are required for --fix');
      process.exit(1);
    }
    handleFix(
      args['manifest'],
      args['checkpoint'],
      args['agent'] || 'fixer',
      args['session'] || '',
      args['file'],
      args['lines'] || '',
      args['claim'],
    );
    process.exit(0);
  }

  // --view
  if (args['view'] === 'true') {
    if (!args['manifest'] || !args['checkpoint']) {
      console.error('Error: --manifest and --checkpoint are required for --view');
      process.exit(1);
    }
    handleView(args['manifest'], args['checkpoint']);
    process.exit(0);
  }

  // --summary
  if (args['summary'] === 'true') {
    if (!args['manifest']) {
      console.error('Error: --manifest=<path> is required for --summary');
      process.exit(1);
    }
    handleSummary(args['manifest']);
    process.exit(0);
  }

  // Unknown command
  console.error('Error: Unknown command. Use --help for usage.');
  process.exit(1);
}

main();