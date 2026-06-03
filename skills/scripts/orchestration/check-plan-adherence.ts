#!/usr/bin/env node
/**
 * Plan Adherence Checker
 *
 * Checks plan adherence AFTER the Implementor writes code but BEFORE the build gate.
 * Verifies every checkpoint in the plan manifest against the filesystem and produces
 * an adherence score. Runs in dependency order and skips downstream checkpoints
 * when a dependency fails.
 *
 * Usage:
 *   ts-node skills/scripts/orchestration/check-plan-adherence.ts --manifest=plan-manifests/<feature>/v1-manifest.json [--dir=./] [--threshold=90]
 *
 * Exit codes:
 *   0 = adherenceScore >= threshold AND no errors
 *   1 = adherenceScore < threshold
 *   2 = config/parsing error
 *
 * Output: JSON to stdout
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
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

interface AdherenceOutput {
  valid: boolean;
  threshold: number;
  totalCheckpoints: number;
  passedCheckpoints: number;
  failedCheckpoints: number;
  skippedCheckpoints: number;
  adherenceScore: number;
  thresholdMet: boolean;
  results: CheckpointResult[];
  errors: string[];
}

interface CLIOptions {
  manifest: string;
  dir: string;
  threshold: number;
}

// ---------------------------------------------------------------------------
// CLI Argument Parsing
// ---------------------------------------------------------------------------

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    manifest: '',
    dir: process.cwd(),
    threshold: 90,
  };

  for (const arg of args) {
    if (arg.startsWith('--manifest=')) {
      options.manifest = arg.slice('--manifest='.length);
    } else if (arg.startsWith('--dir=')) {
      options.dir = arg.slice('--dir='.length);
    } else if (arg.startsWith('--threshold=')) {
      const raw = arg.slice('--threshold='.length);
      const parsed = parseInt(raw, 10);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
        options.threshold = parsed;
      }
      // If invalid, keep default of 90
    } else {
      const output: AdherenceOutput = {
        valid: false,
        threshold: options.threshold,
        totalCheckpoints: 0,
        passedCheckpoints: 0,
        failedCheckpoints: 0,
        skippedCheckpoints: 0,
        adherenceScore: 0,
        thresholdMet: false,
        results: [],
        errors: [`Unknown argument: "${arg}"`],
      };
      console.log(JSON.stringify(output, null, 2));
      process.exit(2);
    }
  }

  if (!options.manifest) {
    const output: AdherenceOutput = {
      valid: false,
      threshold: options.threshold,
      totalCheckpoints: 0,
      passedCheckpoints: 0,
      failedCheckpoints: 0,
      skippedCheckpoints: 0,
      adherenceScore: 0,
      thresholdMet: false,
      results: [],
      errors: ['Missing required argument: --manifest=<path>'],
    };
    console.log(JSON.stringify(output, null, 2));
    process.exit(2);
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
// Dependency Sorting
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

// ---------------------------------------------------------------------------
// Verification Helpers
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

  // Find the class definition
  const classMatch = content.match(new RegExp(`class\\s+${className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  if (!classMatch) return false;

  // Check for methodName( within the class body
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

  // Check for router.get/post/put/delete/... or @Get/@Post/@Put/@Delete/...
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
// Checkpoint Verification
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

  // Structural kinds: if file doesn't exist, fail immediately
  const structuralKinds: VerificationKind[] = ['fileExists', 'fileNotExists', 'exportExists', 'classExists', 'functionExists', 'methodExists', 'typeExists', 'routeExists'];

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
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const options = parseArgs();

  // Validate --dir exists
  const workingDir = path.resolve(options.dir);
  if (!fs.existsSync(workingDir)) {
    const output: AdherenceOutput = {
      valid: false,
      threshold: options.threshold,
      totalCheckpoints: 0,
      passedCheckpoints: 0,
      failedCheckpoints: 0,
      skippedCheckpoints: 0,
      adherenceScore: 0,
      thresholdMet: false,
      results: [],
      errors: [`Working directory does not exist: ${workingDir}`],
    };
    console.log(JSON.stringify(output, null, 2));
    process.exit(2);
  }

  // Validate --manifest exists
  const manifestPath = path.resolve(options.manifest);
  if (!fs.existsSync(manifestPath)) {
    const output: AdherenceOutput = {
      valid: false,
      threshold: options.threshold,
      totalCheckpoints: 0,
      passedCheckpoints: 0,
      failedCheckpoints: 0,
      skippedCheckpoints: 0,
      adherenceScore: 0,
      thresholdMet: false,
      results: [],
      errors: [`Manifest file not found: ${manifestPath}`],
    };
    console.log(JSON.stringify(output, null, 2));
    process.exit(2);
  }

  // Parse manifest
  let manifest: PlanManifest;
  try {
    manifest = loadManifest(manifestPath);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const output: AdherenceOutput = {
      valid: false,
      threshold: options.threshold,
      totalCheckpoints: 0,
      passedCheckpoints: 0,
      failedCheckpoints: 0,
      skippedCheckpoints: 0,
      adherenceScore: 0,
      thresholdMet: false,
      results: [],
      errors: [`Failed to parse manifest: ${errorMessage}`],
    };
    console.log(JSON.stringify(output, null, 2));
    process.exit(2);
  }

  const errors: string[] = [];
  const results: CheckpointResult[] = [];

  // Empty checkpoints → pass with score 100
  if (!manifest.checkpoints || manifest.checkpoints.length === 0) {
    const output: AdherenceOutput = {
      valid: true,
      threshold: options.threshold,
      totalCheckpoints: 0,
      passedCheckpoints: 0,
      failedCheckpoints: 0,
      skippedCheckpoints: 0,
      adherenceScore: 100,
      thresholdMet: true,
      results: [],
      errors: [],
    };
    console.log(JSON.stringify(output, null, 2));
    process.exit(0);
  }

  // Process checkpoints in dependency order
  const order = topologicalSort(manifest.checkpoints);
  const resultsMap = new Map<string, CheckpointResult>();

  for (const cpId of order) {
    const cp = manifest.checkpoints.find(c => c.id === cpId);
    if (!cp) {
      errors.push(`Checkpoint ${cpId} referenced in dependency order but not found in manifest`);
      continue;
    }
    const result = verifyCheckpoint(cp, workingDir, resultsMap);
    resultsMap.set(cp.id, result);
    results.push(result);
  }

  // Calculate score
  const totalCheckpoints = results.length;
  const passedCheckpoints = results.filter(r => r.status === 'passed').length;
  const failedCheckpoints = results.filter(r => r.status === 'failed').length;
  const skippedCheckpoints = results.filter(r => r.status === 'skipped').length;

  const evaluable = totalCheckpoints - skippedCheckpoints;
  const adherenceScore = evaluable > 0
    ? Math.round((passedCheckpoints / evaluable) * 1000) / 10  // Round to 1 decimal
    : 100;

  const thresholdMet = adherenceScore >= options.threshold;

  // Build output
  const output: AdherenceOutput = {
    valid: thresholdMet && errors.length === 0,
    threshold: options.threshold,
    totalCheckpoints,
    passedCheckpoints,
    failedCheckpoints,
    skippedCheckpoints,
    adherenceScore,
    thresholdMet,
    results,
    errors,
  };

  console.log(JSON.stringify(output, null, 2));

  // Exit code
  if (errors.length > 0) {
    // Config/parsing error scenario — but we already handled manifest/file errors above.
    // If errors accumulated during processing (e.g. missing CP references), exit 2.
    process.exit(2);
  }

  if (!thresholdMet) {
    process.exit(1);
  }

  process.exit(0);
}

// ---------------------------------------------------------------------------
// CLI Entry
// ---------------------------------------------------------------------------

if (require.main === module) {
  main();
}