#!/usr/bin/env node
/**
 * Plan Diff Report Generator
 *
 * Generates a human-readable markdown diff report showing how the implementation
 * compares against the plan manifest. Run after the Implementor completes, before
 * the Build Gate.
 *
 * Usage:
 *   ts-node skills/scripts/orchestration/plan-diff-report.ts \
 *     --manifest=plan-manifests/<feature>/v1-manifest.json \
 *     [--dir=./] \
 *     [--checkpoint-progress=<json-file>] \
 *     [--output=.opencode/plan-diffs/<pipelineId>.md]
 *
 * Exit codes:
 *   0 = Report generated successfully
 *   1 = Error
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types (mirrored from check-plan-adherence.ts)
// ---------------------------------------------------------------------------

type VerificationKind =
  | 'fileExists'
  | 'fileNotExists'
  | 'exportExists'
  | 'classExists'
  | 'functionExists'
  | 'methodExists'
  | 'typeExists'
  | 'routeExists'
  | 'handlesError'
  | 'validatesInput'
  | 'logsAtLevel'
  | 'hasMiddleware'
  | 'selfReviewCheckpoint'
  | 'acceptanceCriteria';

type CheckpointType = 'structural' | 'behavioral' | 'meta' | 'acceptance';
type ResultStatus = 'passed' | 'failed' | 'skipped';

interface Checkpoint {
  id: string;
  type: CheckpointType;
  description: string;
  target: string;
  verify: {
    kind: VerificationKind;
    [key: string]: string;
  };
  dependsOn?: string[];
}

interface PlanManifest {
  manifestVersion: number;
  planSummary?: string;
  checkpoints: Checkpoint[];
  [key: string]: unknown;
}

interface CheckpointResult {
  id: string;
  kind: VerificationKind;
  target: string;
  status: ResultStatus;
  message: string;
}

interface CheckpointProgress {
  checkpoints: { id: string; status: ResultStatus; message: string }[];
}

interface CLIOptions {
  manifest: string;
  dir: string;
  output: string | null;
  checkpointProgress: string | null;
}

// ---------------------------------------------------------------------------
// CLI Argument Parsing
// ---------------------------------------------------------------------------

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    manifest: '',
    dir: process.cwd(),
    output: null,
    checkpointProgress: null,
  };

  for (const arg of args) {
    if (arg.startsWith('--manifest=')) {
      options.manifest = arg.slice('--manifest='.length);
    } else if (arg.startsWith('--dir=')) {
      options.dir = arg.slice('--dir='.length);
    } else if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length);
    } else if (arg.startsWith('--checkpoint-progress=')) {
      options.checkpointProgress = arg.slice('--checkpoint-progress='.length);
    } else {
      console.error(`Unknown argument: "${arg}"`);
      process.exit(1);
    }
  }

  if (!options.manifest) {
    console.error('Missing required argument: --manifest=<path>');
    process.exit(1);
  }

  return options;
}

// ---------------------------------------------------------------------------
// Manifest Loading
// ---------------------------------------------------------------------------

function loadManifest(manifestPath: string): PlanManifest {
  const content = fs.readFileSync(manifestPath, 'utf-8');
  const parsed = JSON.parse(content) as PlanManifest;
  if (!Array.isArray(parsed.checkpoints)) {
    parsed.checkpoints = [];
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Checkpoint progress loading (optional)
// ---------------------------------------------------------------------------

function loadCheckpointProgress(progressPath: string): CheckpointProgress {
  const content = fs.readFileSync(progressPath, 'utf-8');
  const parsed = JSON.parse(content) as CheckpointProgress;
  if (!Array.isArray(parsed.checkpoints)) {
    throw new Error('checkpointProgress JSON must contain a "checkpoints" array');
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Verification Helpers (reused from check-plan-adherence.ts)
// ---------------------------------------------------------------------------

function readFileSafe(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function verifyFileExists(target: string, rootDir: string): boolean {
  return fs.existsSync(path.resolve(rootDir, target));
}

function verifyFileNotExists(target: string, rootDir: string): boolean {
  return !fs.existsSync(path.resolve(rootDir, target));
}

function verifyExportExists(target: string, rootDir: string, verify: Record<string, string>): boolean {
  const exportName = verify.exportName || '';
  if (!exportName) return false;
  const content = readFileSafe(path.resolve(rootDir, target));
  if (content === null) return false;
  return new RegExp(`export\\s+(?:class|function|const|interface|type|enum|default\\s+class|default\\s+function|default\\s+const)\\s+${exportName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(content);
}

function verifyClassExists(target: string, rootDir: string, verify: Record<string, string>): boolean {
  const className = verify.className || '';
  if (!className) return false;
  const content = readFileSafe(path.resolve(rootDir, target));
  if (content === null) return false;
  return new RegExp(`export\\s+class\\s+${className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(content);
}

function verifyFunctionExists(target: string, rootDir: string, verify: Record<string, string>): boolean {
  const functionName = verify.functionName || '';
  if (!functionName) return false;
  const content = readFileSafe(path.resolve(rootDir, target));
  if (content === null) return false;
  return new RegExp(`export\\s+function\\s+${functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(content);
}

function verifyMethodExists(target: string, rootDir: string, verify: Record<string, string>): boolean {
  const className = verify.className || '';
  const methodName = verify.methodName || '';
  if (!className || !methodName) return false;
  const content = readFileSafe(path.resolve(rootDir, target));
  if (content === null) return false;

  const classMatch = content.match(new RegExp(`class\\s+${className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  if (!classMatch) return false;

  const classBody = content.substring(classMatch.index!);
  return new RegExp(`${methodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`).test(classBody);
}

function verifyTypeExists(target: string, rootDir: string, verify: Record<string, string>): boolean {
  const typeName = verify.typeName || '';
  if (!typeName) return false;
  const content = readFileSafe(path.resolve(rootDir, target));
  if (content === null) return false;
  return new RegExp(`export\\s+(?:type|interface)\\s+${typeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(content);
}

function verifyRouteExists(target: string, rootDir: string, verify: Record<string, string>): boolean {
  const routePath = verify.routePath || '';
  if (!routePath) return false;
  const content = readFileSafe(path.resolve(rootDir, target));
  if (content === null) return false;

  const escapedRoute = routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`router\\.(?:get|post|put|delete|patch|options|head)\\s*\\(\\s*['"\`]${escapedRoute}['"\`]`).test(content) ||
         new RegExp(`@(?:Get|Post|Put|Delete|Patch|Options|Head)\\s*\\(\\s*['"\`]${escapedRoute}['"\`]`).test(content);
}

function verifyHandlesError(target: string, rootDir: string): boolean {
  const content = readFileSafe(path.resolve(rootDir, target));
  if (content === null) return false;
  return /try\s*\{/.test(content) || /\.catch\s*\(/.test(content);
}

function verifyValidatesInput(target: string, rootDir: string): boolean {
  const content = readFileSafe(path.resolve(rootDir, target));
  if (content === null) return false;
  return /z\./.test(content) || /schema\./.test(content) || /\bvalidate\b/.test(content) || /\.parse\s*\(/.test(content);
}

function verifyLogsAtLevel(target: string, rootDir: string): boolean {
  const content = readFileSafe(path.resolve(rootDir, target));
  if (content === null) return false;
  return /logger\./.test(content) || /console\.log/.test(content) || /console\.error/.test(content);
}

function verifyHasMiddleware(target: string, rootDir: string, verify: Record<string, string>): boolean {
  const middlewareName = verify.middlewareName || '';
  if (!middlewareName) return false;
  const content = readFileSafe(path.resolve(rootDir, target));
  if (content === null) return false;
  return content.includes(middlewareName);
}

// ---------------------------------------------------------------------------
// Checkpoint Verification (same logic as check-plan-adherence.ts)
// ---------------------------------------------------------------------------

function verifyCheckpoint(cp: Checkpoint, rootDir: string, results: Map<string, CheckpointResult>): CheckpointResult {
  const kind = cp.verify.kind;
  const target = cp.target;
  const fullTargetPath = path.resolve(rootDir, target);

  // Skip meta/acceptance checkpoints
  if (kind === 'selfReviewCheckpoint') {
    return {
      id: cp.id,
      kind,
      target,
      status: 'skipped',
      message: 'Self-review checkpoint — skipped by adherence checker',
    };
  }

  if (kind === 'acceptanceCriteria') {
    return {
      id: cp.id,
      kind,
      target,
      status: 'skipped',
      message: 'Acceptance criteria — handled by Verifier agent',
    };
  }

  // Check dependency status
  const dependsOn = cp.dependsOn || [];
  for (const depId of dependsOn) {
    const depResult = results.get(depId);
    if (depResult && depResult.status !== 'passed') {
      return {
        id: cp.id,
        kind,
        target,
        status: 'skipped',
        message: `Depends on ${depId} which ${depResult.status === 'failed' ? 'failed' : 'was skipped'}`,
      };
    }
  }

  // Behavioral kinds: if file doesn't exist, skip (can't check behavior on missing file)
  const behavioralKinds: VerificationKind[] = ['handlesError', 'validatesInput', 'logsAtLevel', 'hasMiddleware'];

  if (behavioralKinds.includes(kind)) {
    if (!fs.existsSync(fullTargetPath)) {
      return {
        id: cp.id,
        kind,
        target,
        status: 'skipped',
        message: `Cannot check "${kind}" — target file does not exist: ${target}`,
      };
    }
  }

  switch (kind) {
    case 'fileExists': {
      const exists = verifyFileExists(target, rootDir);
      return {
        id: cp.id,
        kind,
        target,
        status: exists ? 'passed' : 'failed',
        message: exists ? 'File exists' : `File not found: ${target}`,
      };
    }

    case 'fileNotExists': {
      const notExists = verifyFileNotExists(target, rootDir);
      return {
        id: cp.id,
        kind,
        target,
        status: notExists ? 'passed' : 'failed',
        message: notExists ? 'File does not exist as expected' : `File exists when it should not: ${target}`,
      };
    }

    case 'exportExists': {
      const found = verifyExportExists(target, rootDir, cp.verify);
      return {
        id: cp.id,
        kind,
        target,
        status: found ? 'passed' : 'failed',
        message: found ? `Export "${cp.verify.exportName || ''}" found` : `Export "${cp.verify.exportName || ''}" not found in ${target}`,
      };
    }

    case 'classExists': {
      const found = verifyClassExists(target, rootDir, cp.verify);
      return {
        id: cp.id,
        kind,
        target,
        status: found ? 'passed' : 'failed',
        message: found ? `Class "${cp.verify.className || ''}" found` : `Class "${cp.verify.className || ''}" not found in ${target}`,
      };
    }

    case 'functionExists': {
      const found = verifyFunctionExists(target, rootDir, cp.verify);
      return {
        id: cp.id,
        kind,
        target,
        status: found ? 'passed' : 'failed',
        message: found ? `Function "${cp.verify.functionName || ''}" found` : `Function "${cp.verify.functionName || ''}" not found in ${target}`,
      };
    }

    case 'methodExists': {
      const found = verifyMethodExists(target, rootDir, cp.verify);
      return {
        id: cp.id,
        kind,
        target,
        status: found ? 'passed' : 'failed',
        message: found ? `Method "${cp.verify.methodName || ''}" found in class "${cp.verify.className || ''}"` : `Method "${cp.verify.methodName || ''}" not found in class "${cp.verify.className || ''}" in ${target}`,
      };
    }

    case 'typeExists': {
      const found = verifyTypeExists(target, rootDir, cp.verify);
      return {
        id: cp.id,
        kind,
        target,
        status: found ? 'passed' : 'failed',
        message: found ? `Type/interface "${cp.verify.typeName || ''}" found` : `Type/interface "${cp.verify.typeName || ''}" not found in ${target}`,
      };
    }

    case 'routeExists': {
      const found = verifyRouteExists(target, rootDir, cp.verify);
      return {
        id: cp.id,
        kind,
        target,
        status: found ? 'passed' : 'failed',
        message: found ? `Route "${cp.verify.routePath || ''}" found` : `Route "${cp.verify.routePath || ''}" not found in ${target}`,
      };
    }

    case 'handlesError': {
      const found = verifyHandlesError(target, rootDir);
      return {
        id: cp.id,
        kind,
        target,
        status: found ? 'passed' : 'failed',
        message: found ? 'Error handling (try/catch or .catch()) found' : 'No try/catch or .catch() found in file',
      };
    }

    case 'validatesInput': {
      const found = verifyValidatesInput(target, rootDir);
      return {
        id: cp.id,
        kind,
        target,
        status: found ? 'passed' : 'failed',
        message: found ? 'Input validation (zod, schema, validate, .parse()) found' : 'No input validation pattern found in file',
      };
    }

    case 'logsAtLevel': {
      const found = verifyLogsAtLevel(target, rootDir);
      return {
        id: cp.id,
        kind,
        target,
        status: found ? 'passed' : 'failed',
        message: found ? 'Logging (logger., console.log, console.error) found' : 'No logging pattern found in file',
      };
    }

    case 'hasMiddleware': {
      const found = verifyHasMiddleware(target, rootDir, cp.verify);
      return {
        id: cp.id,
        kind,
        target,
        status: found ? 'passed' : 'failed',
        message: found ? `Middleware "${cp.verify.middlewareName || ''}" found` : `Middleware "${cp.verify.middlewareName || ''}" not found in ${target}`,
      };
    }

    default: {
      return {
        id: cp.id,
        kind,
        target,
        status: 'skipped',
        message: `Unknown verification kind: "${kind}" — skipping`,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Verify all checkpoints (runs verification in dependency order)
// ---------------------------------------------------------------------------

function topologicalSort(checkpoints: Checkpoint[]): string[] {
  const visited = new Set<string>();
  const order: string[] = [];

  function visit(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    const cp = checkpoints.find(c => c.id === id);
    if (cp && cp.dependsOn) {
      for (const depId of cp.dependsOn) {
        visit(depId);
      }
    }
    order.push(id);
  }

  for (const cp of checkpoints) {
    visit(cp.id);
  }

  return order;
}

function verifyAllCheckpoints(manifest: PlanManifest, rootDir: string): CheckpointResult[] {
  const results: CheckpointResult[] = [];
  const resultsMap = new Map<string, CheckpointResult>();

  const order = topologicalSort(manifest.checkpoints);

  for (const cpId of order) {
    const cp = manifest.checkpoints.find(c => c.id === cpId);
    if (!cp) continue;
    const result = verifyCheckpoint(cp, rootDir, resultsMap);
    resultsMap.set(cp.id, result);
    results.push(result);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Feature name extraction from manifest path
// ---------------------------------------------------------------------------

function extractFeatureName(manifestPath: string): string {
  // Expect path like: plan-manifests/<feature>/v1-manifest.json
  const normalized = manifestPath.replace(/\\/g, '/');
  const match = normalized.match(/plan-manifests\/([^/]+)\//);
  if (match) return match[1];

  // Fallback: use parent directory name or filename stem
  const basename = path.basename(path.dirname(manifestPath));
  if (basename && basename !== '.' && basename !== 'plan-manifests') return basename;

  return path.basename(manifestPath, '.json').replace(/-manifest$/, '');
}

// ---------------------------------------------------------------------------
// Report Generation
// ---------------------------------------------------------------------------

function buildFixDescription(cp: Checkpoint, result: CheckpointResult): string {
  const kind = cp.verify.kind;
  const target = cp.target;

  switch (kind) {
    case 'fileExists':
      return `Create missing file: ${target}`;
    case 'fileNotExists':
      return `Remove file that should not exist: ${target}`;
    case 'exportExists':
      return `Add export "${cp.verify.exportName || ''}" in ${target}`;
    case 'classExists':
      return `Add export class "${cp.verify.className || ''}" in ${target}`;
    case 'functionExists':
      return `Add export function "${cp.verify.functionName || ''}" in ${target}`;
    case 'methodExists':
      return `Add method "${cp.verify.methodName || ''}" to class "${cp.verify.className || ''}" in ${target}`;
    case 'typeExists':
      return `Add export type/interface "${cp.verify.typeName || ''}" in ${target}`;
    case 'routeExists':
      return `Add route "${cp.verify.routePath || ''}" in ${target}`;
    case 'handlesError':
      return `Add try/catch or .catch() error handling in ${target}`;
    case 'validatesInput':
      return `Add zod/schema/validation pattern for input validation in ${target}`;
    case 'logsAtLevel':
      return `Add logging (logger. or console.* statements) in ${target}`;
    case 'hasMiddleware':
      return `Add middleware "${cp.verify.middlewareName || ''}" in ${target}`;
    case 'selfReviewCheckpoint':
      return `Complete self-review for checkpoint "${cp.description}"`;
    case 'acceptanceCriteria':
      return `Verify acceptance criteria: ${cp.description}`;
    default:
      return `Address checkpoint ${cp.id}: ${cp.description}`;
  }
}

function generateReport(
  manifest: PlanManifest,
  manifestPath: string,
  results: CheckpointResult[],
): string {
  const featureName = extractFeatureName(manifestPath);
  const now = new Date().toISOString();

  const passed = results.filter(r => r.status === 'passed');
  const failed = results.filter(r => r.status === 'failed');
  const skipped = results.filter(r => r.status === 'skipped');
  const total = results.length;

  const evaluable = total - skipped.length;
  const adherenceScore = evaluable > 0
    ? Math.round((passed.length / evaluable) * 1000) / 10
    : 100;

  const lines: string[] = [];

  // Header
  lines.push(`# Plan Diff Report: ${featureName}`);
  lines.push('');
  lines.push(`**Generated**: ${now}`);
  lines.push(`**Manifest**: ${manifestPath}`);
  lines.push(`**Plan Summary**: ${manifest.planSummary || '(no summary)'}`);
  lines.push('');

  // Passed checkpoints
  lines.push(`## ✅ Passed Checkpoints (${passed.length}/${total})`);
  lines.push('| ID | Kind | Target | Status |');
  lines.push('|----|------|--------|--------|');
  for (const r of passed) {
    lines.push(`| ${r.id} | ${r.kind} | ${r.target} | ✅ ${r.message} |`);
  }
  lines.push('');

  // Failed checkpoints
  if (failed.length > 0) {
    lines.push(`## ❌ Failed Checkpoints (${failed.length}/${total})`);
    lines.push('| ID | Kind | Description | Evidence |');
    lines.push('|----|------|-------------|----------|');
    for (const r of failed) {
      const cp = manifest.checkpoints.find(c => c.id === r.id);
      const desc = cp ? cp.description : r.id;
      lines.push(`| ${r.id} | ${r.kind} | ${desc} | ❌ ${r.message} |`);
    }
    lines.push('');
  }

  // Skipped checkpoints
  if (skipped.length > 0) {
    lines.push(`## ⏭️ Skipped Checkpoints (${skipped.length}/${total})`);
    lines.push('| ID | Kind | Reason |');
    lines.push('|----|------|--------|');
    for (const r of skipped) {
      lines.push(`| ${r.id} | ${r.kind} | ${r.message} |`);
    }
    lines.push('');
  }

  // Scores
  lines.push('## 📊 Scores');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| **Adherence Score** | ${adherenceScore}% |`);
  lines.push(`| Threshold | 90% |`);
  const verdict = adherenceScore >= 90 ? '✅ PASSED' : '⚠️ BELOW THRESHOLD';
  lines.push(`| **Verdict** | ${verdict} |`);
  lines.push('');

  // Recommended fixes
  if (failed.length > 0) {
    lines.push('## 🔧 Recommended Fixes');
    let fixIdx = 1;
    for (const r of failed) {
      const cp = manifest.checkpoints.find(c => c.id === r.id);
      if (cp) {
        const fixDesc = buildFixDescription(cp, r);
        lines.push(`${fixIdx}. **${r.id}** (${r.kind}): ${fixDesc}`);
        fixIdx++;
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const options = parseArgs();

  // Validate --dir
  const workingDir = path.resolve(options.dir);
  if (!fs.existsSync(workingDir)) {
    console.error(`Working directory does not exist: ${workingDir}`);
    process.exit(1);
  }

  // Validate --manifest
  const manifestPath = path.resolve(options.manifest);
  if (!fs.existsSync(manifestPath)) {
    console.error(`Manifest file not found: ${manifestPath}`);
    process.exit(1);
  }

  // Parse manifest
  let manifest: PlanManifest;
  try {
    manifest = loadManifest(manifestPath);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`Failed to parse manifest: ${errorMessage}`);
    process.exit(1);
  }

  // Get results — either from checkpoint progress or by re-verifying
  let results: CheckpointResult[];

  if (options.checkpointProgress) {
    const progressPath = path.resolve(options.checkpointProgress);
    if (!fs.existsSync(progressPath)) {
      console.error(`Checkpoint progress file not found: ${progressPath}`);
      process.exit(1);
    }

    let progress: CheckpointProgress;
    try {
      progress = loadCheckpointProgress(progressPath);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`Failed to parse checkpoint progress file: ${errorMessage}`);
      process.exit(1);
    }

    // Map progress results back to manifest checkpoints
    const progressMap = new Map<string, { status: ResultStatus; message: string }>();
    for (const cp of progress.checkpoints) {
      progressMap.set(cp.id, { status: cp.status, message: cp.message });
    }

    results = manifest.checkpoints.map(cp => {
      const existing = progressMap.get(cp.id);
      if (existing) {
        return {
          id: cp.id,
          kind: cp.verify.kind,
          target: cp.target,
          status: existing.status,
          message: existing.message,
        };
      }
      // Fall back to re-verify if not in progress
      return verifyCheckpoint(cp, workingDir, new Map());
    });
  } else {
    // Re-verify all checkpoints
    results = verifyAllCheckpoints(manifest, workingDir);
  }

  // Generate report
  const report = generateReport(manifest, manifestPath, results);

  // Output
  if (options.output) {
    const outputPath = path.resolve(options.output);
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, report, 'utf-8');
    console.log(`Plan diff report written to: ${outputPath}`);
  } else {
    console.log(report);
  }

  process.exit(0);
}

// ---------------------------------------------------------------------------
// CLI Entry
// ---------------------------------------------------------------------------

if (require.main === module) {
  main();
}