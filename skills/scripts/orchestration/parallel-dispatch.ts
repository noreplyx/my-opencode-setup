#!/usr/bin/env node
/**
 * Parallel Dispatch (P1 Orchestration Improvement)
 *
 * A native parallel dispatch wrapper for the OpenCode Orchestrator system.
 * Reads a plan manifest and produces dispatch manifests
 * produces dispatch manifests at .opencode/dispatch/<pipelineId>/phase-<N>.json,
 * and supports --plan and --verify modes for analysis and consistency checking.
 *
 * Usage:
 *   ts-node parallel-dispatch.ts --manifest=plan-manifests/feature/v1-manifest.json --pipeline-id=pip_001
 *   ts-node parallel-dispatch.ts --report=parallelism-report.json --pipeline-id=pip_001
 *   ts-node parallel-dispatch.ts --manifest=... --pipeline-id=... --dry-run
 *   ts-node parallel-dispatch.ts --manifest=... --pipeline-id=... --agent=implementor
 *   ts-node parallel-dispatch.ts --manifest=... --plan
 *   ts-node parallel-dispatch.ts --manifest=... --verify
 *
 * Exit codes:
 *   0 = Success (dispatch manifests written / plan printed / verify passed)
 *   1 = Input error (missing args, parse failure)
 *   2 = Inconsistency found (verify mode)
 *   3 = (unused)
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// =========================================================================
// Types
// =========================================================================

/** Phase grouping from parallelism analysis */
interface ParallelismPhase {
  label: string;
  files: string[];
  mode: 'PARALLEL' | 'SEQUENTIAL';
  reason: string;
}

/** Full output of parallelism analysis (deprecated) */
interface ParallelismReport {
  recommendation: 'SINGLE_FILE' | 'PARALLEL' | 'SEQUENTIAL' | 'HYBRID';
  phases: ParallelismPhase[];
  details: string[];
  warnings: string[];
}

/** A single checkpoint from the plan manifest */
interface ManifestCheckpoint {
  id: string;
  type?: string;
  target?: string;
  verify?: string | { kind: string; exportName?: string; [key: string]: unknown };
  description?: string;
  phase?: string;
  dependsOn?: string[];
  acceptanceCriteria?: string;
  filesModified?: string[];
  verificationCommand?: string;
  weight?: string;
  [key: string]: unknown;
}

/** Phase grouping in the manifest */
interface ManifestPhase {
  id?: string;
  phase?: number;
  name: string;
  description?: string;
  steps?: string[];
  checkpoints?: ManifestCheckpoint[];
}

/** Manifest dependency edge */
interface ManifestDependency {
  from: string;
  to: string;
  description?: string;
}

/** Full plan manifest structure */
interface PlanManifest {
  manifestVersion: string | number;
  feature?: string;
  planSummary?: string;
  createdAt?: string;
  phases?: ManifestPhase[];
  checkpoints?: ManifestCheckpoint[];
  dependencies?: ManifestDependency[];
  totalPhases?: number;
  totalCheckpoints?: number;
  dependencyOrdering?: string[];
  architectureDecisions?: string[];
  wiringSummary?: Record<string, unknown>;
}

/** A single file entry within a dispatch manifest phase */
interface DispatchFileEntry {
  file: string;
  checkpoints: Array<{ id: string; description: string }>;
  agent: string;
  instructions: string;
}

/** The dispatch manifest written to disk */
interface DispatchManifest {
  pipelineId: string;
  phase: number;
  totalPhases: number;
  mode: 'PARALLEL' | 'SEQUENTIAL';
  dispatchMode: 'PARALLEL' | 'SEQUENTIAL';
  reason: string;
  files: DispatchFileEntry[];
  dependsOnPhases: number[];
  mergeAfter: boolean;
  integrateAfter: boolean;
  estimatedFilesPerTask: number;
}

/** Parsed CLI arguments */
interface CliArgs {
  manifest?: string;
  report?: string;
  pipelineId: string;
  dryRun: boolean;
  agent: string;
  planMode: boolean;
  verifyMode: boolean;
}

// =========================================================================
// Argument parsing
// =========================================================================

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);

  const manifestArg = argv.find(a => a.startsWith('--manifest='));
  const reportArg = argv.find(a => a.startsWith('--report='));
  const pipelineIdArg = argv.find(a => a.startsWith('--pipeline-id='));
  const agentArg = argv.find(a => a.startsWith('--agent='));
  const dryRun = argv.includes('--dry-run');
  const planMode = argv.includes('--plan');
  const verifyMode = argv.includes('--verify');

  if (!pipelineIdArg && !planMode && !verifyMode) {
    console.error('❌ Missing required argument: --pipeline-id=<id>');
    console.error('Usage: ts-node parallel-dispatch.ts --manifest=<path> --pipeline-id=<id> [--dry-run] [--agent=<type>]');
    console.error('       ts-node parallel-dispatch.ts --report=<path> --pipeline-id=<id>');
    console.error('       ts-node parallel-dispatch.ts --manifest=<path> --plan');
    console.error('       ts-node parallel-dispatch.ts --manifest=<path> --verify');
    process.exit(1);
  }

  if (!manifestArg && !reportArg) {
    console.error('❌ Missing required argument: --manifest=<path> or --report=<path>');
    process.exit(1);
  }

  if (manifestArg && reportArg) {
    console.error('❌ Provide either --manifest or --report, not both');
    process.exit(1);
  }

  if (planMode && reportArg) {
    console.error('❌ --plan mode requires --manifest, not --report');
    process.exit(1);
  }

  if (verifyMode && reportArg) {
    console.error('❌ --verify mode requires --manifest, not --report');
    process.exit(1);
  }

  return {
    manifest: manifestArg?.split('=')[1],
    report: reportArg?.split('=')[1],
    pipelineId: pipelineIdArg?.split('=')[1] ?? 'dry-run',
    dryRun,
    agent: agentArg?.split('=')[1] ?? 'implementor',
    planMode,
    verifyMode,
  };
}

// =========================================================================
// Manifest reading
// =========================================================================

function readManifest(manifestPath: string): PlanManifest {
  if (!fs.existsSync(manifestPath)) {
    console.error(`❌ Manifest not found: ${manifestPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(manifestPath, 'utf-8');
  try {
    return JSON.parse(raw) as PlanManifest;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Failed to parse manifest JSON: ${msg}`);
    process.exit(1);
  }
}

function readReport(reportPath: string): ParallelismReport {
  if (!fs.existsSync(reportPath)) {
    console.error(`❌ Report not found: ${reportPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(reportPath, 'utf-8');
  try {
    return JSON.parse(raw) as ParallelismReport;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Failed to parse report JSON: ${msg}`);
    process.exit(1);
  }
}

// =========================================================================
// Parallelism analysis (uses manifest synthesis)
// =========================================================================

function runCheckParallelism(manifestPath: string): ParallelismReport {
  // check-parallelism.ts was removed (language-specific).
  // Use manifest-based synthesis instead.
  const projectDir = path.resolve(__dirname, '../../..');
  return synthesizeReportFromManifest(manifestPath, projectDir);
}

/**
 * Synthesize a parallelism report directly from the manifest structure.
 */
function synthesizeReportFromManifest(manifestPath: string, _baseDir: string): ParallelismReport {
  const manifest = readManifest(manifestPath);
  const allFiles = extractAllTargetFiles(manifest);
  const details: string[] = [];
  const warnings: string[] = [];

  if (allFiles.length === 0) {
    return {
      recommendation: 'SINGLE_FILE',
      phases: [],
      details: ['No target files found in manifest.'],
      warnings: [],
    };
  }

  // Group files by the manifest's phase groupings
  const phases: ParallelismPhase[] = [];

  if (manifest.phases && manifest.phases.length > 0) {
    for (let i = 0; i < manifest.phases.length; i++) {
      const mp = manifest.phases[i];
      const files = extractFilesForManifestPhase(mp);
      if (files.length === 0 && (!mp.checkpoints || mp.checkpoints.length === 0)) {
        continue;
      }

      // If no specific file targets, create placeholder entries
      const phaseFiles = files.length > 0 ? files : [`[phase: ${mp.name}]`];

      phases.push({
        label: mp.name || `Phase ${i + 1}`,
        files: phaseFiles,
        mode: i === 0 ? 'PARALLEL' : 'SEQUENTIAL',
        reason: i === 0
          ? 'no dependencies on other target files'
          : `depends on phase ${i}`,
      });
    }
  } else if (manifest.checkpoints && manifest.checkpoints.length > 0) {
    // No explicit phases — put all in one phase
    phases.push({
      label: 'Phase 1',
      files: allFiles,
      mode: 'PARALLEL',
      reason: 'no dependencies on other target files',
    });
  }

  // Determine recommendation
  const recommendation: ParallelismReport['recommendation'] =
    phases.length <= 1
      ? allFiles.length === 1
        ? 'SINGLE_FILE'
        : 'PARALLEL'
      : 'HYBRID';

  return { recommendation, phases, details, warnings };
}

/**
 * Extract all unique target files from a manifest, considering both
 * the newer checkpoints array format and the older per-phase checkpoints.
 */
function extractAllTargetFiles(manifest: PlanManifest): string[] {
  const targets = new Set<string>();

  // Top-level checkpoints
  if (manifest.checkpoints) {
    for (const cp of manifest.checkpoints) {
      if (cp.target) {
        targets.add(cp.target);
      }
      if (cp.filesModified) {
        for (const f of cp.filesModified) {
          targets.add(f);
        }
      }
    }
  }

  // Per-phase checkpoints
  if (manifest.phases) {
    for (const phase of manifest.phases) {
      if (phase.checkpoints) {
        for (const cp of phase.checkpoints) {
          if (cp.target) {
            targets.add(cp.target);
          }
          if (cp.filesModified) {
            for (const f of cp.filesModified) {
              targets.add(f);
            }
          }
        }
      }
    }
  }

  return Array.from(targets).sort();
}

/** Extract file targets from a single manifest phase */
function extractFilesForManifestPhase(phase: ManifestPhase): string[] {
  const files = new Set<string>();

  if (phase.checkpoints) {
    for (const cp of phase.checkpoints) {
      if (cp.target) {
        files.add(cp.target);
      }
      if (cp.filesModified) {
        for (const f of cp.filesModified) {
          files.add(f);
        }
      }
    }
  }

  return Array.from(files).sort();
}

// =========================================================================
// Dispatch manifest generation
// =========================================================================

function buildDispatchManifests(
  report: ParallelismReport,
  pipelineId: string,
  defaultAgent: string,
  manifest: PlanManifest,
  checkpointsLookup: Map<string, ManifestCheckpoint>,
): DispatchManifest[] {
  const totalPhases = report.phases.length;
  const manifests: DispatchManifest[] = [];

  for (let i = 0; i < report.phases.length; i++) {
    const rp = report.phases[i];
    const phaseNumber = i + 1;

    // Build per-file entries
    const files: DispatchFileEntry[] = rp.files.map(file => {
      const matchingCps = findCheckpointsForFile(file, manifest, checkpointsLookup);
      const instructions = generateInstructions(file, matchingCps);

      return {
        file,
        checkpoints: matchingCps.map(cp => ({
          id: cp.id,
          description: cp.description || cp.type || `Create/modify ${file}`,
        })),
        agent: defaultAgent,
        instructions,
      };
    });

    // Determine dependency chain
    const dependsOnPhases: number[] = [];
    if (i > 0) {
      // If this phase is SEQUENTIAL or the previous was SEQUENTIAL,
      // we depend on previous phases' output
      dependsOnPhases.push(i); // phase i depends on phase i (the previous one)
    }

    // Determine post-phase actions
    const mergeAfter = rp.mode === 'PARALLEL';
    const integrateAfter = phaseNumber === totalPhases;

    manifests.push({
      pipelineId,
      phase: phaseNumber,
      totalPhases,
      mode: rp.mode,
      dispatchMode: rp.mode,
      reason: rp.reason,
      files,
      dependsOnPhases,
      mergeAfter,
      integrateAfter,
      estimatedFilesPerTask: 1,
    });
  }

  return manifests;
}

/**
 * Find all checkpoints in the manifest that reference a given file.
 */
function findCheckpointsForFile(
  file: string,
  manifest: PlanManifest,
  checkpointsLookup: Map<string, ManifestCheckpoint>,
): ManifestCheckpoint[] {
  // First check the lookup map for checkpoints targeting this file
  const result: ManifestCheckpoint[] = [];

  if (manifest.checkpoints) {
    for (const cp of manifest.checkpoints) {
      if (cp.target === file) {
        result.push(cp);
      } else if (cp.filesModified && cp.filesModified.includes(file)) {
        result.push(cp);
      }
    }
  }

  // Also check per-phase checkpoints
  if (manifest.phases) {
    for (const phase of manifest.phases) {
      if (phase.checkpoints) {
        for (const cp of phase.checkpoints) {
          if (cp.target === file) {
            // Avoid adding duplicates already found in top-level checkpoints
            if (!result.some(r => r.id === cp.id)) {
              result.push(cp);
            }
          } else if (cp.filesModified && cp.filesModified.includes(file)) {
            if (!result.some(r => r.id === cp.id)) {
              result.push(cp);
            }
          }
        }
      }
    }
  }

  return result;
}

/**
 * Generate a human-readable instruction string for a file's checkpoints.
 */
function generateInstructions(file: string, checkpoints: ManifestCheckpoint[]): string {
  const base = checkpoints.length > 0
    ? `Implement ${file} with ${checkpoints.length} checkpoint(s)`
    : `Implement ${file}`;

  if (checkpoints.length > 0) {
    const detailList = checkpoints
      .map(cp => `[${cp.id}] ${cp.description || cp.type || 'No description'}`)
      .join('; ');
    return `${base}: ${detailList}`;
  }

  return base;
}

// =========================================================================
// File I/O for dispatch manifests
// =========================================================================

function writeDispatchManifests(
  manifests: DispatchManifest[],
  pipelineId: string,
  dryRun: boolean,
): string[] {
  // __dirname is skills/scripts/orchestration/
  // We need .opencode/disatch/<pipelineId>/ in the workspace root
  const dispatchDir = path.resolve(
    __dirname, '..', '..', '..', '.opencode', 'dispatch', pipelineId,
  );
  const writtenFiles: string[] = [];

  if (!dryRun) {
    fs.mkdirSync(dispatchDir, { recursive: true });
  }

  for (const manifest of manifests) {
    const fileName = `phase-${manifest.phase}.json`;
    const filePath = path.join(dispatchDir, fileName);
    const jsonContent = JSON.stringify(manifest, null, 2);

    if (dryRun) {
      console.log(`[dry-run] Would write: ${filePath}`);
      console.log(jsonContent);
      console.log('');
    } else {
      fs.writeFileSync(filePath, jsonContent, 'utf-8');
      console.error(`[parallel-dispatch] Written: ${filePath}`);
    }

    writtenFiles.push(filePath);
  }

  return writtenFiles;
}

// =========================================================================
// Plan display mode
// =========================================================================

function displayPlan(manifest: PlanManifest, report: ParallelismReport): void {
  const featureName = manifest.feature || manifest.planSummary || 'unknown';
  const totalPhases = report.phases.length;
  const allFiles = report.phases.flatMap(p => p.files);

  console.log(`Parallelization Plan for ${featureName} (${allFiles.length} files, ${totalPhases} phase(s)):`);
  console.log('');

  for (let i = 0; i < report.phases.length; i++) {
    const phase = report.phases[i];
    const isLast = i === report.phases.length - 1;
    const prefix = isLast ? '└──' : '├──';
    const phaseNum = i + 1;

    // Phase header
    const lineChar = isLast ? '─' : '─';
    console.log(`${prefix}${lineChar.repeat(50)}`);
    console.log(`${prefix} Phase ${phaseNum}/${totalPhases}:`);
    console.log(`${prefix}   Files: ${phase.files.join(', ')}`);
    console.log(`${prefix}   Mode: ${phase.mode} ${phase.mode === 'PARALLEL' ? '✓' : '⛓️'}`);

    if (phase.mode === 'SEQUENTIAL') {
      const depPhases: number[] = [];
      for (let j = 0; j < i; j++) {
        depPhases.push(j + 1);
      }
      if (depPhases.length > 0) {
        console.log(`${prefix}   Reason: ${phase.reason}`);
        console.log(`${prefix}   Blocked by: phase${depPhases.length > 1 ? 's' : ''} ${depPhases.join(', ')}`);
      }
    } else {
      console.log(`${prefix}   Reason: ${phase.reason}`);
    }

    // Post-phase actions
    const actions: string[] = [];
    if (phase.mode === 'PARALLEL') {
      actions.push('merge after phase');
    }
    if (isLast) {
      actions.push('integrate after phase');
    }
    if (actions.length > 0) {
      console.log(`${prefix}   Post-phase: ${actions.join(', ')}`);
    }

    // Show checkpoint count
    if (manifest.checkpoints || (manifest.phases && manifest.phases[0]?.checkpoints)) {
      console.log(`${prefix}   Checkpoints: ${countCheckpointsForPhase(manifest, i)}`);
    }

    console.log('');
  }

  // Summary
  const parallelPhases = report.phases.filter(p => p.mode === 'PARALLEL').length;
  const sequentialPhases = report.phases.filter(p => p.mode === 'SEQUENTIAL').length;
  console.log(`Summary: ${parallelPhases} parallel phase(s), ${sequentialPhases} sequential phase(s)`);
  console.log(`Recommendation: ${report.recommendation}`);

  if (report.warnings.length > 0) {
    console.log('');
    console.log('Warnings:');
    for (const w of report.warnings) {
      console.log(`  ⚠️  ${w}`);
    }
  }
}

function countCheckpointsForPhase(manifest: PlanManifest, phaseIndex: number): number {
  if (!manifest.phases || !manifest.phases[phaseIndex]) {
    return manifest.checkpoints?.length ?? 0;
  }
  return manifest.phases[phaseIndex]?.checkpoints?.length ?? 0;
}

// =========================================================================
// Verify mode
// =========================================================================

interface VerifyResult {
  passed: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    details: string;
  }>;
}

function verifyManifest(manifest: PlanManifest, report: ParallelismReport): VerifyResult {
  const checks: VerifyResult['checks'] = [];
  const allFilesFromReport = new Set(report.phases.flatMap(p => p.files));
  const allFilesFromManifest = new Set(extractAllTargetFiles(manifest));

  // Check 1: No file appears in multiple phases
  const filePhaseMap = new Map<string, number[]>();
  for (let i = 0; i < report.phases.length; i++) {
    for (const file of report.phases[i].files) {
      const existing = filePhaseMap.get(file) ?? [];
      existing.push(i + 1);
      filePhaseMap.set(file, existing);
    }
  }
  const duplicateFiles = [...filePhaseMap.entries()].filter(([, phases]) => phases.length > 1);
  checks.push({
    name: 'No duplicate files across phases',
    passed: duplicateFiles.length === 0,
    details: duplicateFiles.length > 0
      ? `Files appearing in multiple phases: ${duplicateFiles.map(([f, p]) => `${f} (phases ${p.join(', ')})`).join('; ')}`
      : 'All files appear in exactly one phase',
  });

  // Check 2: All manifest files are covered
  const missingFromReport = [...allFilesFromManifest].filter(f => !allFilesFromReport.has(f));
  checks.push({
    name: 'All manifest files covered by dispatch',
    passed: missingFromReport.length === 0,
    details: missingFromReport.length > 0
      ? `Files from manifest not in any dispatch phase: ${missingFromReport.join(', ')}`
      : `All ${allFilesFromManifest.size} manifest files are covered across ${report.phases.length} phase(s)`,
  });

  // Check 3: No extra files in report that aren't in manifest
  const extraInReport = [...allFilesFromReport].filter(f => !allFilesFromManifest.has(f));
  checks.push({
    name: 'No extra files beyond manifest',
    passed: extraInReport.length === 0,
    details: extraInReport.length > 0
      ? `Files in dispatch phases not in manifest: ${extraInReport.join(', ')}`
      : 'All dispatch files are from the manifest',
  });

  // Check 4: Dependency ordering is correct (SEQUENTIAL phases depend on earlier phases)
  const sequentialPhases = report.phases
    .map((p, i) => ({ phase: i + 1, mode: p.mode, files: p.files }))
    .filter(p => p.mode === 'SEQUENTIAL');

  const dependencyIssues: string[] = [];
  for (const seqPhase of sequentialPhases) {
    // For SEQUENTIAL phases, check that dependencies are satisfied by earlier phases
    for (let earlier = 1; earlier < seqPhase.phase; earlier++) {
      const earlierFiles = report.phases[earlier - 1].files;
      // Verify that dependent files reference earlier phase files (basic check)
      // A full cross-reference check would require import scanning, but we can check
      // if the manifest declares dependencies
    }

    // Check manifest dependencies
    if (manifest.dependencies) {
      const phaseFileSet = new Set(seqPhase.files);
      for (const dep of manifest.dependencies) {
        if (phaseFileSet.has(dep.to)) {
          // dep.to is in this SEQUENTIAL phase; check that dep.from is in an earlier phase
          const fromPhase = report.phases.findIndex(p => p.files.includes(dep.from));
          if (fromPhase === -1 || fromPhase >= seqPhase.phase - 1) {
            dependencyIssues.push(
              `Dependency ${dep.from} → ${dep.to}: source not found in an earlier phase`,
            );
          }
        }
      }
    }
  }

  checks.push({
    name: 'Dependency ordering is correct',
    passed: dependencyIssues.length === 0,
    details: dependencyIssues.length > 0
      ? `Issues: ${dependencyIssues.join('; ')}`
      : 'All dependencies respect phase ordering',
  });

  // Check 5: Phase count consistency
  checks.push({
    name: 'Phase count consistency',
    passed: report.phases.length > 0,
    details: report.phases.length > 0
      ? `${report.phases.length} phase(s) defined`
      : 'No phases defined in the report',
  });

  const allPassed = checks.every(c => c.passed);
  return { passed: allPassed, checks };
}

// =========================================================================
// Main
// =========================================================================

function main(): void {
  const args = parseArgs();
  const manifestPath = args.manifest;

  if (args.planMode) {
    // ── Plan display mode ──
    if (!manifestPath) {
      console.error('❌ --plan mode requires --manifest');
      process.exit(1);
    }
    const manifest = readManifest(manifestPath);
    const baseDir = path.resolve(__dirname, '..', '..', '..');
    const report = synthesizeReportFromManifest(manifestPath, baseDir);
    displayPlan(manifest, report);
    process.exit(0);
  }

  if (args.verifyMode) {
    // ── Verify mode ──
    if (!manifestPath) {
      console.error('❌ --verify mode requires --manifest');
      process.exit(1);
    }
    const manifest = readManifest(manifestPath);
    const baseDir = path.resolve(__dirname, '..', '..', '..');
    const report = synthesizeReportFromManifest(manifestPath, baseDir);
    const result = verifyManifest(manifest, report);

    console.log('Parallel Dispatch Verification Report');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    for (const check of result.checks) {
      const icon = check.passed ? '✓' : '✗';
      console.log(`${icon} ${check.name}`);
      console.log(`   ${check.details}`);
      console.log('');
    }

    if (result.passed) {
      console.log('✅ All checks passed — dispatch manifests are internally consistent.');
    } else {
      console.log('❌ Some checks failed — see details above.');
    }

    process.exit(result.passed ? 0 : 2);
  }

  // ── Normal dispatch mode ──
  const pipelineId = args.pipelineId;

  let report: ParallelismReport;
  let manifest: PlanManifest;

  if (args.report) {
    // Load from pre-computed report
    report = readReport(args.report);
    // Try to load the corresponding manifest if it can be inferred
    const baseDir = path.resolve(__dirname, '..', '..', '..');
    manifest = { manifestVersion: 1 };
    // Build a checkpoints lookup from what we can infer
    const allFiles = report.phases.flatMap(p => p.files);
    const checkpointsLookup = new Map<string, ManifestCheckpoint>();
    for (const file of allFiles) {
      checkpointsLookup.set(file, {
        id: `CP-${allFiles.indexOf(file) + 1}`,
        target: file,
        description: `Implement ${file}`,
      });
    }

    const dispatchManifests = buildDispatchManifests(report, pipelineId, args.agent, manifest, checkpointsLookup);

    // Set integrateAfter on the last phase
    if (dispatchManifests.length > 0) {
      dispatchManifests[dispatchManifests.length - 1].integrateAfter = true;
    }

    const writtenFiles = writeDispatchManifests(dispatchManifests, pipelineId, args.dryRun);

    console.error(`[parallel-dispatch] ${args.dryRun ? 'Dry-run' : 'Dispatch'} complete for pipeline ${pipelineId}`);
    console.error(`[parallel-dispatch] ${dispatchManifests.length} phase(s), ${allFiles.length} total file(s)`);

    // Output summary to stdout (machine-readable)
    const summary = {
      pipelineId,
      status: 'dispatched',
      phases: dispatchManifests.map(m => ({
        phase: m.phase,
        mode: m.mode,
        fileCount: m.files.length,
        mergeAfter: m.mergeAfter,
        integrateAfter: m.integrateAfter,
      })),
      totalPhases: dispatchManifests.length,
      totalFiles: allFiles.length,
      files: writtenFiles,
    };
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  }

  // ── From manifest ──
  if (!manifestPath) {
    console.error('❌ No manifest path provided');
    process.exit(1);
  }

  manifest = readManifest(manifestPath);
  const checkpointsLookup = new Map<string, ManifestCheckpoint>();
  if (manifest.checkpoints) {
    for (const cp of manifest.checkpoints) {
      checkpointsLookup.set(cp.id, cp);
    }
  }
  if (manifest.phases) {
    for (const phase of manifest.phases) {
      if (phase.checkpoints) {
        for (const cp of phase.checkpoints) {
          if (!checkpointsLookup.has(cp.id)) {
            checkpointsLookup.set(cp.id, cp);
          }
        }
      }
    }
  }

  // Get parallelism report from manifest synthesis
  report = runCheckParallelism(manifestPath);

  // Build dispatch manifests
  const dispatchManifests = buildDispatchManifests(
    report, pipelineId, args.agent, manifest, checkpointsLookup,
  );

  if (args.dryRun) {
    // Reuse displayPlan-like output for dry-run
    console.error('[parallel-dispatch] DRY RUN — no files written');
    console.error('');
    displayPlan(manifest, report);
    console.log('── Dispatch Manifests (would write) ──');
    for (const dm of dispatchManifests) {
      console.log(JSON.stringify(dm, null, 2));
      console.log('');
    }
    process.exit(0);
  }

  // Write dispatch manifest files
  const writtenFiles = writeDispatchManifests(dispatchManifests, pipelineId, false);

  console.error(`[parallel-dispatch] Dispatch complete for pipeline ${pipelineId}`);
  console.error(`[parallel-dispatch] ${dispatchManifests.length} phase(s), ` +
    `${report.phases.reduce((sum, p) => sum + p.files.length, 0)} total file(s)`);

  // Output summary to stdout (machine-readable JSON)
  const summary = {
    pipelineId,
    status: 'dispatched',
    phases: dispatchManifests.map(m => ({
      phase: m.phase,
      mode: m.mode,
      fileCount: m.files.length,
      mergeAfter: m.mergeAfter,
      integrateAfter: m.integrateAfter,
    })),
    totalPhases: dispatchManifests.length,
    totalFiles: report.phases.reduce((sum, p) => sum + p.files.length, 0),
    files: writtenFiles,
    report: {
      recommendation: report.recommendation,
      phases: report.phases.map(p => ({ label: p.label, mode: p.mode, fileCount: p.files.length })),
      warnings: report.warnings,
    },
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

main();
