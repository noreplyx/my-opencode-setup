#!/usr/bin/env node
/**
 * Provenance Tracker
 *
 * Tracks the lifecycle of each checkpoint in a plan manifest through the pipeline.
 * Each checkpoint accumulates provenance data as it passes through agent steps.
 *
 * Usage modes:
 *   [runtime] provenance-tracker.ts --init --manifest=<path> --agent=plandescriber --session=ses_abc
 *   [runtime] provenance-tracker.ts --implement --manifest=<path> --agent=implementor --session=ses_def \
 *     --file=src/services/user.ts --lines=42-55 --claim="Created validateEmail"
 *   [runtime] provenance-tracker.ts --verify --manifest=<path> --checkpoint=CP-003 \
 *     --verdict=fail --evidence="grep ..." --result=not_found
 *   [runtime] provenance-tracker.ts --fix --manifest=<path> --checkpoint=CP-003 \
 *     --agent=fixer --session=ses_ghi --file=src/services/user.ts --lines=42-58
 *   [runtime] provenance-tracker.ts --view --manifest=<path> --checkpoint=CP-003
 *   [runtime] provenance-tracker.ts --report --manifest=<path>
 *   [runtime] provenance-tracker.ts --blame --manifest=<path>
 *
 * Output modes:
 *   Default: pretty-printed text (tree for --report, JSON for --view)
 *   --format=json → all output as JSON
 *   --output=<path> → write output to file instead of stdout
 *
 * Exit codes:
 *   0 = Success
 *   1 = Error (invalid args, manifest not found, parse error)
 *   2 = Checkpoint not found (for --view, --fix, --verify)
 *
 * Environment:
 *   - DEBUG=1 → enable verbose debug logging
 */

import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProvenanceEntry {
  createdBy?: string;
  createdAt?: string;
  implementedBy?: string;
  implementedAt?: string;
  implementationEvidence?: ImplementationEvidence[];
  verificationResults?: VerificationResult[];
  fixedBy?: string;
  fixedAt?: string;
  fixEvidence?: FixEvidence[];
  currentStatus: 'pass' | 'fail' | 'not_verified';
}

interface ImplementationEvidence {
  file: string;
  lines: string;
  claim: string;
  hash: string;
  timestamp: string;
}

interface VerificationResult {
  by: string;
  verdict: 'pass' | 'fail';
  evidence: string;
  result: string;
  timestamp: string;
}

interface FixEvidence {
  file: string;
  lines: string;
  agent: string;
  session: string;
  hash: string;
  timestamp: string;
}

interface Checkpoint {
  id: string;
  description?: string;
  provenance: ProvenanceEntry;
  [key: string]: unknown;
}

interface PlanManifest {
  manifestVersion?: string;
  feature?: string;
  checkpoints?: Checkpoint[];
  [key: string]: unknown;
}

type RunMode = 'init' | 'implement' | 'verify' | 'fix' | 'view' | 'report' | 'blame';

interface CliArgs {
  mode: RunMode;
  manifest: string;
  agent?: string;
  session?: string;
  checkpoint?: string;
  file?: string;
  lines?: string;
  claim?: string;
  verdict?: 'pass' | 'fail';
  evidence?: string;
  result?: string;
  format: 'text' | 'json';
  output?: string;
  debug: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MODE_HELP: Record<RunMode, string> = {
  init:       '--init        --manifest=<path> --agent=<name> --session=<id>',
  implement:  '--implement   --manifest=<path> --agent=<name> --session=<id> --file=<path> --lines=<range> --claim="<desc>"',
  verify:     '--verify      --manifest=<path> --checkpoint=<id> --verdict=<pass|fail> --evidence="<str>" --result=<str>',
  fix:        '--fix         --manifest=<path> --checkpoint=<id> --agent=<name> --session=<id> --file=<path> --lines=<range>',
  view:       '--view        --manifest=<path> --checkpoint=<id>',
  report:     '--report      --manifest=<path>',
  blame:      '--blame       --manifest=<path>',
};

function usage(exitCode: number): never {
  console.error('Usage: [runtime] provenance-tracker.ts <mode> [options]');
  console.error('');
  console.error('Modes:');
  for (const [, help] of Object.entries(MODE_HELP)) {
    console.error(`  [runtime] provenance-tracker.ts ${help}`);
  }
  console.error('');
  console.error('Global options:');
  console.error('  --format=json    Output as JSON');
  console.error('  --output=<path>  Write output to file');
  process.exit(exitCode);
}

function isoNow(): string {
  return new Date().toISOString();
}

function debugLog(debug: boolean, msg: string): void {
  if (debug) {
    console.error(`[DEBUG] ${msg}`);
  }
}

function hashContent(filePath: string, lines: string): string {
  const raw = `${filePath}:${lines}`;
  return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 12);
}

function getShortHash(filePath: string, lines: string): string {
  return hashContent(filePath, lines);
}

/**
 * Run `git blame` on a range of lines and return the commit SHAs involved.
 */
function gitBlameRange(filePath: string, lines: string): string[] {
  const rangeMatch = lines.match(/^(\d+)-(\d+)$/);
  if (!rangeMatch) return [];

  const start = parseInt(rangeMatch[1], 10);
  const end = parseInt(rangeMatch[2], 10);
  const commits: string[] = [];

  for (let line = start; line <= end; line++) {
    try {
      const result = child_process.execSync(
        `git blame -L ${line},${line} --porcelain "${filePath}" 2>/dev/null | head -1`,
        { encoding: 'utf-8', shell: true, timeout: 5000 },
      );
      const sha = result.trim().split(' ')[0];
      if (sha && sha.length >= 7) {
        const shortSha = sha.substring(0, 7);
        if (!commits.includes(shortSha)) {
          commits.push(shortSha);
        }
      }
    } catch {
      // git blame can fail for uncommitted files — skip
    }
  }

  return commits;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): CliArgs {
  const raw = process.argv.slice(2);

  if (raw.length === 0 || raw.some(a => a === '--help' || a === '-h')) {
    usage(0);
  }

  const getStr = (prefix: string): string | undefined => {
    const a = raw.find(a => a.startsWith(prefix));
    return a ? a.split('=')[1] : undefined;
  };

  // Determine mode
  let mode: RunMode | undefined;
  if (raw.includes('--init')) mode = 'init';
  else if (raw.includes('--implement')) mode = 'implement';
  else if (raw.includes('--verify')) mode = 'verify';
  else if (raw.includes('--fix')) mode = 'fix';
  else if (raw.includes('--view')) mode = 'view';
  else if (raw.includes('--report')) mode = 'report';
  else if (raw.includes('--blame')) mode = 'blame';

  if (!mode) {
    console.error('Error: Missing mode flag. Use one of: --init, --implement, --verify, --fix, --view, --report, --blame');
    usage(1);
  }

  const manifest = getStr('--manifest=');
  if (!manifest) {
    console.error('Error: --manifest=<path> is required');
    usage(1);
  }

  const agent = getStr('--agent=');
  const session = getStr('--session=');
  const checkpoint = getStr('--checkpoint=');
  const file = getStr('--file=');
  const lines = getStr('--lines=');
  const claim = getStr('--claim=');
  const verdict = getStr('--verdict=') as 'pass' | 'fail' | undefined;
  const evidence = getStr('--evidence=');
  const result = getStr('--result=');
  const format = getStr('--format=') === 'json' ? 'json' : 'text';
  const output = getStr('--output=');
  const debug = raw.includes('--debug') || process.env.DEBUG === '1';

  // Validate mode-specific required args
  switch (mode) {
    case 'init':
      if (!agent || !session) {
        console.error('Error: --init requires --agent=<name> and --session=<id>');
        usage(1);
      }
      break;
    case 'implement':
      if (!agent || !session || !file || !lines) {
        console.error('Error: --implement requires --agent=<name> --session=<id> --file=<path> --lines=<range>');
        usage(1);
      }
      break;
    case 'verify':
      if (!checkpoint || !verdict || !evidence || !result) {
        console.error('Error: --verify requires --checkpoint=<id> --verdict=<pass|fail> --evidence=<str> --result=<str>');
        usage(1);
      }
      if (verdict !== 'pass' && verdict !== 'fail') {
        console.error('Error: --verdict must be "pass" or "fail"');
        usage(1);
      }
      break;
    case 'fix':
      if (!checkpoint || !agent || !session || !file || !lines) {
        console.error('Error: --fix requires --checkpoint=<id> --agent=<name> --session=<id> --file=<path> --lines=<range>');
        usage(1);
      }
      break;
    case 'view':
      if (!checkpoint) {
        console.error('Error: --view requires --checkpoint=<id>');
        usage(1);
      }
      break;
    case 'report':
    case 'blame':
      // No extra required args
      break;
  }

  return {
    mode,
    manifest,
    agent,
    session,
    checkpoint,
    file,
    lines,
    claim: claim || '',
    verdict,
    evidence,
    result,
    format,
    output,
    debug,
  };
}

// ---------------------------------------------------------------------------
// Manifest I/O
// ---------------------------------------------------------------------------

function readManifest(manifestPath: string): PlanManifest {
  const resolved = path.resolve(manifestPath);
  if (!fs.existsSync(resolved)) {
    console.error(`Error: Manifest not found: ${resolved}`);
    process.exit(1);
  }

  let raw: string;
  try {
    raw = fs.readFileSync(resolved, 'utf-8');
  } catch (err) {
    console.error(`Error: Could not read manifest: ${resolved} — ${(err as Error).message}`);
    process.exit(1);
  }

  let manifest: PlanManifest;
  try {
    manifest = JSON.parse(raw) as PlanManifest;
  } catch (err) {
    console.error(`Error: Invalid JSON in manifest: ${resolved} — ${(err as Error).message}`);
    process.exit(1);
  }

  if (!manifest.checkpoints || !Array.isArray(manifest.checkpoints)) {
    console.error(`Error: Manifest has no "checkpoints" array`);
    process.exit(1);
  }

  return manifest;
}

function writeManifest(manifestPath: string, manifest: PlanManifest): void {
  const resolved = path.resolve(manifestPath);
  fs.writeFileSync(resolved, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}

/**
 * Ensure every checkpoint has a provenance object.
 */
function ensureProvenance(checkpoints: Checkpoint[]): void {
  for (const cp of checkpoints) {
    if (!cp.provenance) {
      cp.provenance = {
        createdBy: undefined,
        createdAt: undefined,
        implementedBy: undefined,
        implementedAt: undefined,
        implementationEvidence: [],
        verificationResults: [],
        fixedBy: undefined,
        fixedAt: undefined,
        fixEvidence: [],
        currentStatus: 'not_verified',
      };
    }
    if (!cp.provenance.implementationEvidence) cp.provenance.implementationEvidence = [];
    if (!cp.provenance.verificationResults) cp.provenance.verificationResults = [];
    if (!cp.provenance.fixEvidence) cp.provenance.fixEvidence = [];
    if (!cp.provenance.currentStatus) cp.provenance.currentStatus = 'not_verified';
  }
}

function findCheckpoint(manifest: PlanManifest, id: string): Checkpoint | undefined {
  return manifest.checkpoints?.find(cp => cp.id === id);
}

// ---------------------------------------------------------------------------
// Mode handlers
// ---------------------------------------------------------------------------

function handleInit(args: CliArgs): PlanManifest {
  const manifest = readManifest(args.manifest);
  ensureProvenance(manifest.checkpoints!);
  const now = isoNow();

  // Mark all checkpoints as created by this agent
  for (const cp of manifest.checkpoints!) {
    cp.provenance.createdBy = `${args.agent} (${args.session})`;
    cp.provenance.createdAt = now;
    cp.provenance.currentStatus = 'not_verified';
  }

  debugLog(args.debug, `Initialized provenance for ${manifest.checkpoints!.length} checkpoints`);

  writeManifest(args.manifest, manifest);
  return manifest;
}

function handleImplement(args: CliArgs): PlanManifest {
  const manifest = readManifest(args.manifest);
  ensureProvenance(manifest.checkpoints!);
  const now = isoNow();

  const fileSha = getShortHash(args.file!, args.lines!);
  const commits = gitBlameRange(args.file!, args.lines!);
  const commitStr = commits.length > 0 ? ` [${commits.join(', ')}]` : '';

  const evidence: ImplementationEvidence = {
    file: args.file!,
    lines: args.lines!,
    claim: args.claim || '(no claim)',
    hash: fileSha,
    timestamp: now,
  };

  for (const cp of manifest.checkpoints!) {
    cp.provenance.implementedBy = `${args.agent} (${args.session})${commitStr}`;
    cp.provenance.implementedAt = now;
    cp.provenance.implementationEvidence!.push(evidence);
    // After implementation, status stays what it was (could still be fail if not verified)
    if (cp.provenance.currentStatus === 'not_verified') {
      cp.provenance.currentStatus = 'not_verified';
    }
  }

  debugLog(args.debug, `Added implementation evidence: ${args.file}:${args.lines} (${fileSha})`);

  writeManifest(args.manifest, manifest);
  return manifest;
}

function handleVerify(args: CliArgs): PlanManifest {
  const manifest = readManifest(args.manifest);
  ensureProvenance(manifest.checkpoints!);

  const cp = findCheckpoint(manifest, args.checkpoint!);
  if (!cp) {
    console.error(`Error: Checkpoint "${args.checkpoint}" not found in manifest`);
    process.exit(2);
  }

  const now = isoNow();
  const verifierName = args.agent || 'Verifier';
  const verifierSession = args.session ? ` (${args.session})` : '';

  const result: VerificationResult = {
    by: `${verifierName}${verifierSession}`,
    verdict: args.verdict!,
    evidence: args.evidence!,
    result: args.result!,
    timestamp: now,
  };

  cp.provenance.verificationResults!.push(result);

  // Update status based on verdict
  if (args.verdict === 'pass') {
    cp.provenance.currentStatus = 'pass';
  } else {
    cp.provenance.currentStatus = 'fail';
  }

  debugLog(args.debug, `Checkpoint ${args.checkpoint} verified: ${args.verdict} (status: ${cp.provenance.currentStatus})`);

  writeManifest(args.manifest, manifest);
  return manifest;
}

function handleFix(args: CliArgs): PlanManifest {
  const manifest = readManifest(args.manifest);
  ensureProvenance(manifest.checkpoints!);

  const cp = findCheckpoint(manifest, args.checkpoint!);
  if (!cp) {
    console.error(`Error: Checkpoint "${args.checkpoint}" not found in manifest`);
    process.exit(2);
  }

  const now = isoNow();
  const fileSha = getShortHash(args.file!, args.lines!);
  const commits = gitBlameRange(args.file!, args.lines!);
  const commitStr = commits.length > 0 ? ` [${commits.join(', ')}]` : '';

  const fix: FixEvidence = {
    file: args.file!,
    lines: args.lines!,
    agent: args.agent!,
    session: args.session!,
    hash: fileSha,
    timestamp: now,
  };

  cp.provenance.fixedBy = `${args.agent} (${args.session})${commitStr}`;
  cp.provenance.fixedAt = now;
  cp.provenance.fixEvidence!.push(fix);
  cp.provenance.currentStatus = 'pass'; // Fix implies it now passes

  debugLog(args.debug, `Checkpoint ${args.checkpoint} fixed: ${args.file}:${args.lines} (${fileSha})`);

  writeManifest(args.manifest, manifest);
  return manifest;
}

function handleView(args: CliArgs): PlanManifest {
  const manifest = readManifest(args.manifest);
  ensureProvenance(manifest.checkpoints!);

  const cp = findCheckpoint(manifest, args.checkpoint!);
  if (!cp) {
    console.error(`Error: Checkpoint "${args.checkpoint}" not found in manifest`);
    process.exit(2);
  }

  const output: { checkpoint: Checkpoint; manifestMeta: { feature?: string; manifestVersion?: string } } = {
    checkpoint: cp,
    manifestMeta: {
      feature: manifest.feature,
      manifestVersion: manifest.manifestVersion,
    },
  };

  const formatted = args.format === 'json'
    ? JSON.stringify(output, null, 2)
    : formatCheckpointDetail(cp, manifest);

  emitOutput(formatted, args.output);
  return manifest;
}

function handleReport(args: CliArgs): PlanManifest {
  const manifest = readManifest(args.manifest);
  ensureProvenance(manifest.checkpoints!);

  const formatted = args.format === 'json'
    ? JSON.stringify(buildReportData(manifest), null, 2)
    : formatProvenanceTree(manifest);

  emitOutput(formatted, args.output);
  return manifest;
}

function handleBlame(args: CliArgs): PlanManifest {
  const manifest = readManifest(args.manifest);
  ensureProvenance(manifest.checkpoints!);

  const blameData = buildBlameData(manifest);

  const formatted = args.format === 'json'
    ? JSON.stringify(blameData, null, 2)
    : formatBlameReport(blameData);

  emitOutput(formatted, args.output);
  return manifest;
}

// ---------------------------------------------------------------------------
// Formatting — Detail view
// ---------------------------------------------------------------------------

function formatCheckpointDetail(cp: Checkpoint, _manifest: PlanManifest): string {
  const lines: string[] = [];
  const p = cp.provenance;
  const statusIcon = p.currentStatus === 'pass' ? '✅' : p.currentStatus === 'fail' ? '❌' : '⏳';

  lines.push(`${statusIcon} ${cp.id}: ${cp.description || '(no description)'}`);
  lines.push(`  Status: ${p.currentStatus.toUpperCase()}`);
  lines.push('');

  if (p.createdBy) {
    lines.push(`  Created by: ${p.createdBy}`);
    lines.push(`  Created at: ${p.createdAt}`);
  }
  lines.push('');

  if (p.implementedBy) {
    lines.push(`  Implemented by: ${p.implementedBy}`);
    lines.push(`  Implemented at: ${p.implementedAt}`);
  }
  if (p.implementationEvidence && p.implementationEvidence.length > 0) {
    lines.push(`  Implementation evidence (${p.implementationEvidence.length}):`);
    for (const ev of p.implementationEvidence) {
      lines.push(`    - ${ev.file}:${ev.lines}`);
      lines.push(`      Claim: ${ev.claim}`);
      lines.push(`      Hash: ${ev.hash}`);
      lines.push(`      At: ${ev.timestamp}`);
    }
  }
  lines.push('');

  if (p.verificationResults && p.verificationResults.length > 0) {
    lines.push(`  Verification results (${p.verificationResults.length}):`);
    for (const vr of p.verificationResults) {
      const vIcon = vr.verdict === 'pass' ? '✅' : '❌';
      lines.push(`    ${vIcon} By: ${vr.by}`);
      lines.push(`      Verdict: ${vr.verdict}`);
      lines.push(`      Evidence: ${vr.evidence}`);
      lines.push(`      Result: ${vr.result}`);
      lines.push(`      At: ${vr.timestamp}`);
    }
  }
  lines.push('');

  if (p.fixedBy) {
    lines.push(`  Fixed by: ${p.fixedBy}`);
    lines.push(`  Fixed at: ${p.fixedAt}`);
  }
  if (p.fixEvidence && p.fixEvidence.length > 0) {
    lines.push(`  Fix evidence (${p.fixEvidence.length}):`);
    for (const fe of p.fixEvidence) {
      lines.push(`    - ${fe.file}:${fe.lines}`);
      lines.push(`      Agent: ${fe.agent} (${fe.session})`);
      lines.push(`      Hash: ${fe.hash}`);
      lines.push(`      At: ${fe.timestamp}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Formatting — Provenance tree (--report)
// ---------------------------------------------------------------------------

function buildReportData(manifest: PlanManifest): object {
  return {
    feature: manifest.feature,
    manifestVersion: manifest.manifestVersion,
    checkpointCount: manifest.checkpoints!.length,
    checkpoints: manifest.checkpoints!.map(cp => {
      const p = cp.provenance;
      return {
        id: cp.id,
        description: cp.description || '',
        currentStatus: p.currentStatus,
        createdBy: p.createdBy || null,
        createdAt: p.createdAt || null,
        implementedBy: p.implementedBy || null,
        implementedAt: p.implementedAt || null,
        implementationEvidenceCount: p.implementationEvidence?.length || 0,
        verificationResults: (p.verificationResults || []).map(vr => ({
          by: vr.by,
          verdict: vr.verdict,
          evidence: vr.evidence,
          result: vr.result,
        })),
        fixedBy: p.fixedBy || null,
        fixedAt: p.fixedAt || null,
        fixEvidenceCount: p.fixEvidence?.length || 0,
      };
    }),
    summary: {
      total: manifest.checkpoints!.length,
      passed: manifest.checkpoints!.filter(c => c.provenance.currentStatus === 'pass').length,
      failed: manifest.checkpoints!.filter(c => c.provenance.currentStatus === 'fail').length,
      notVerified: manifest.checkpoints!.filter(c => c.provenance.currentStatus === 'not_verified').length,
    },
  };
}

function formatProvenanceTree(manifest: PlanManifest): string {
  const lines: string[] = [];
  const featureName = manifest.feature || 'unnamed feature';

  lines.push(`Provenance Report: ${featureName}`);
  if (manifest.manifestVersion) {
    lines.push(`Manifest Version: ${manifest.manifestVersion}`);
  }
  lines.push('');

  for (const cp of manifest.checkpoints!) {
    const p = cp.provenance;
    const statusIcon = p.currentStatus === 'pass' ? '✅ PASS' : p.currentStatus === 'fail' ? '❌ FAIL' : '⏳ NOT VERIFIED';
    const desc = cp.description || '(no description)';

    lines.push(`${cp.id}: ${desc}`);
    lines.push(`  Status: ${statusIcon}`);

    if (p.createdBy) {
      lines.push(`  ├── Created by: ${p.createdBy}`);
    }

    if (p.implementedBy) {
      const commitInfo = p.implementationEvidence && p.implementationEvidence.length > 0
        ? ` [${p.implementationEvidence.map(e => e.hash).join(', ')}]`
        : '';
      lines.push(`  ├── Implemented by: ${p.implementedBy}${commitInfo}`);
    }

    if (p.verificationResults && p.verificationResults.length > 0) {
      for (let i = 0; i < p.verificationResults.length; i++) {
        const vr = p.verificationResults[i];
        const prefix = (i === p.verificationResults.length - 1 && !p.fixedBy) ? '  └──' : '  ├──';
        const vIcon = vr.verdict === 'pass' ? '✅' : '❌';
        lines.push(`  ${prefix} Verifier: ${vIcon} ${vr.verdict.toUpperCase()}`);
        lines.push(`  │     └── ${vr.evidence} → ${vr.result}`);
      }
    }

    if (p.fixedBy) {
      const fixHashes = p.fixEvidence && p.fixEvidence.length > 0
        ? ` [${p.fixEvidence.map(e => e.hash).join(', ')}]`
        : '';
      lines.push(`  └── Fixed by: ${p.fixedBy}${fixHashes}`);
    }

    lines.push('');
  }

  // Summary
  const total = manifest.checkpoints!.length;
  const passed = manifest.checkpoints!.filter(c => c.provenance.currentStatus === 'pass').length;
  const failed = manifest.checkpoints!.filter(c => c.provenance.currentStatus === 'fail').length;
  const notVerified = manifest.checkpoints!.filter(c => c.provenance.currentStatus === 'not_verified').length;

  lines.push('─── Summary ───');
  lines.push(`  Total checkpoints: ${total}`);
  lines.push(`  ✅ Pass: ${passed}`);
  lines.push(`  ❌ Fail: ${failed}`);
  lines.push(`  ⏳ Not verified: ${notVerified}`);
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Formatting — Blame report
// ---------------------------------------------------------------------------

interface BlameEntry {
  checkpointId: string;
  description: string;
  status: string;
  agents: Array<{ role: string; name: string; at?: string }>;
  files: Array<{ path: string; evidence: string }>;
  failureReasons?: string[];
}

interface BlameData {
  feature?: string;
  manifestVersion?: string;
  entries: BlameEntry[];
  summary: {
    total: number;
    failed: number;
    agentsInvolved: string[];
  };
}

function buildBlameData(manifest: PlanManifest): BlameData {
  const agentsSet = new Set<string>();
  const entries: BlameEntry[] = [];

  for (const cp of manifest.checkpoints!) {
    const p = cp.provenance;
    const agents: Array<{ role: string; name: string; at?: string }> = [];

    if (p.createdBy) {
      agents.push({ role: 'created', name: p.createdBy, at: p.createdAt });
      agentsSet.add(p.createdBy.split(' ')[0]);
    }
    if (p.implementedBy) {
      agents.push({ role: 'implemented', name: p.implementedBy, at: p.implementedAt });
      agentsSet.add(p.implementedBy.split(' ')[0]);
    }
    if (p.fixedBy) {
      agents.push({ role: 'fixed', name: p.fixedBy, at: p.fixedAt });
      agentsSet.add(p.fixedBy.split(' ')[0]);
    }

    const files: Array<{ path: string; evidence: string }> = [];
    for (const ev of p.implementationEvidence || []) {
      files.push({ path: ev.file, evidence: `${ev.lines}: ${ev.claim}` });
    }
    for (const fe of p.fixEvidence || []) {
      files.push({ path: fe.file, evidence: `${fe.lines} (fix)` });
    }

    const failureReasons: string[] = [];
    for (const vr of p.verificationResults || []) {
      if (vr.verdict === 'fail') {
        failureReasons.push(`${vr.evidence} → ${vr.result}`);
      }
    }

    entries.push({
      checkpointId: cp.id,
      description: cp.description || '',
      status: p.currentStatus,
      agents,
      files,
      failureReasons: failureReasons.length > 0 ? failureReasons : undefined,
    });
  }

  const failed = entries.filter(e => e.status === 'fail').length;

  return {
    feature: manifest.feature,
    manifestVersion: manifest.manifestVersion,
    entries,
    summary: {
      total: entries.length,
      failed,
      agentsInvolved: [...agentsSet].sort(),
    },
  };
}

function formatBlameReport(data: BlameData): string {
  const lines: string[] = [];
  const feature = data.feature || 'unnamed feature';

  lines.push(`Blame Report: ${feature}`);
  if (data.manifestVersion) lines.push(`Manifest Version: ${data.manifestVersion}`);
  lines.push('');

  // Group failed checkpoints first
  const failed = data.entries.filter(e => e.status === 'fail');
  const passed = data.entries.filter(e => e.status !== 'fail');

  if (failed.length > 0) {
    lines.push(`❌ FAILED CHECKPOINTS (${failed.length}):`);
    lines.push('');
    for (const entry of failed) {
      lines.push(`  ${entry.checkpointId}: ${entry.description}`);
      lines.push(`  Status: FAIL`);
      if (entry.failureReasons && entry.failureReasons.length > 0) {
        for (const reason of entry.failureReasons) {
          lines.push(`    └── ${reason}`);
        }
      }
      for (const agent of entry.agents) {
        lines.push(`    ${agent.role} by: ${agent.name}`);
      }
      for (const file of entry.files) {
        lines.push(`    file: ${file.path} (${file.evidence})`);
      }
      lines.push('');
    }
  }

  if (passed.length > 0) {
    lines.push(`✅ PASSED CHECKPOINTS (${passed.length}):`);
    for (const entry of passed) {
      lines.push(`  ${entry.checkpointId}: ${entry.description} (${entry.status})`);
      for (const agent of entry.agents) {
        lines.push(`    ${agent.role} by: ${agent.name}`);
      }
      lines.push('');
    }
  }

  lines.push(`─── Summary ───`);
  lines.push(`  Total: ${data.summary.total}`);
  lines.push(`  Failed: ${data.summary.failed}`);
  lines.push(`  Agents involved: ${data.summary.agentsInvolved.join(', ')}`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function emitOutput(content: string, outputPath?: string): void {
  if (outputPath) {
    const resolved = path.resolve(outputPath);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(resolved, content, 'utf-8');
    console.error(`Output written to: ${resolved}`);
  } else {
    console.log(content);
  }
}

// ---------------------------------------------------------------------------
// Result JSON for structured integration
// ---------------------------------------------------------------------------

function printResultJson(manifest: PlanManifest, args: CliArgs, extra?: Record<string, unknown>): void {
  // Only print this when --format=json is not already handling output
  if (args.format === 'json' && args.output) return;

  const result: Record<string, unknown> = {
    mode: args.mode,
    status: 'completed',
    feature: manifest.feature,
    manifestPath: path.resolve(args.manifest),
    checkpointCount: manifest.checkpoints?.length || 0,
    ...extra,
  };

  // For --report we already emitted JSON; for others, emit summary
  if (args.mode === 'report' && args.format !== 'json') {
    // Already printed tree output
    return;
  }

  if (args.format === 'json' && !args.output && args.mode !== 'report' && args.mode !== 'view') {
    console.log(JSON.stringify(result, null, 2));
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs();
  debugLog(args.debug, `Mode: ${args.mode}, Manifest: ${args.manifest}`);

  let manifest: PlanManifest;

  switch (args.mode) {
    case 'init':
      manifest = handleInit(args);
      printResultJson(manifest, args, { agent: args.agent, session: args.session });
      break;
    case 'implement':
      manifest = handleImplement(args);
      printResultJson(manifest, args, { agent: args.agent, session: args.session, file: args.file, lines: args.lines });
      break;
    case 'verify':
      manifest = handleVerify(args);
      printResultJson(manifest, args, { checkpoint: args.checkpoint, verdict: args.verdict });
      break;
    case 'fix':
      manifest = handleFix(args);
      printResultJson(manifest, args, { checkpoint: args.checkpoint, agent: args.agent, session: args.session, file: args.file, lines: args.lines });
      break;
    case 'view':
      manifest = handleView(args);
      // Output already emitted
      break;
    case 'report':
      manifest = handleReport(args);
      // Output already emitted
      break;
    case 'blame':
      manifest = handleBlame(args);
      // Output already emitted
      break;
  }
}

if (require.main === module) {
  main();
}
