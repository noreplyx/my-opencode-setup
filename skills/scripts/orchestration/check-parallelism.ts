#!/usr/bin/env ts-node
/**
 * Parallelism Checker (for Orchestration)
 *
 * Usage: ts-node check-parallelism.ts --manifest=<path-to-manifest> --dir=<project-dir>
 *
 * Reads a plan manifest, scans target files for cross-references,
 * builds a dependency graph, and outputs a parallelism recommendation
 * for the Orchestrator's parallel dispatch decision.
 *
 * Exit codes:
 *   0 = Analysis complete
 *   1 = Manifest not found or parse error
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ManifestCheckpoint {
  id: string;
  type: string;
  target: string;
  verify: string;
  value?: string;
}

interface ManifestDependency {
  from: string;
  to: string;
}

interface PlanManifest {
  manifestVersion: string;
  feature: string;
  checkpoints: ManifestCheckpoint[];
  dependencies?: ManifestDependency[];
}

interface ImportRef {
  source: string;   // the file that contains the import
  target: string;   // the file being imported (resolved absolute path)
  raw: string;      // the raw import path as written in source
  line: number;     // line number in source
}

interface DependencyEdge {
  from: string;    // absolute path
  to: string;      // absolute path
}

interface ParallelismResult {
  recommendation: 'SINGLE_FILE' | 'PARALLEL' | 'SEQUENTIAL' | 'HYBRID';
  phases: Phase[];
  details: string[];
  warnings: string[];
}

interface Phase {
  label: string;
  files: string[];
  mode: 'PARALLEL' | 'SEQUENTIAL';
  reason: string;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): { manifest: string; dir: string } {
  const manifestArg = process.argv.find(a => a.startsWith('--manifest='));
  const dirArg = process.argv.find(a => a.startsWith('--dir='));

  if (!manifestArg) {
    console.error('❌ Missing required argument: --manifest=<path-to-manifest>');
    console.error('Usage: ts-node check-parallelism.ts --manifest=<path-to-manifest> --dir=<project-dir>');
    process.exit(1);
  }

  const manifest = manifestArg.split('=')[1];
  const dir = dirArg ? dirArg.split('=')[1] : process.cwd();

  return { manifest, dir };
}

// ---------------------------------------------------------------------------
// Manifest parsing
// ---------------------------------------------------------------------------

function readManifest(manifestPath: string): PlanManifest {
  if (!fs.existsSync(manifestPath)) {
    console.error(`❌ Manifest not found: ${manifestPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(manifestPath, 'utf-8');
  try {
    const parsed = JSON.parse(raw) as PlanManifest;

    if (!parsed.manifestVersion || !parsed.feature || !Array.isArray(parsed.checkpoints)) {
      console.error('❌ Invalid manifest structure: missing required fields (manifestVersion, feature, checkpoints)');
      process.exit(1);
    }

    return parsed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Failed to parse manifest JSON: ${msg}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Target file extraction
// ---------------------------------------------------------------------------

function extractTargetFiles(manifest: PlanManifest): string[] {
  const targets = new Set<string>();
  for (const cp of manifest.checkpoints) {
    if (cp.target) {
      targets.add(cp.target);
    }
  }
  return Array.from(targets).sort();
}

// ---------------------------------------------------------------------------
// Cross-reference scanning via grep/rg
// ---------------------------------------------------------------------------

function resolveAbsolutePath(baseDir: string, targetFile: string): string {
  return path.isAbsolute(targetFile) ? targetFile : path.resolve(baseDir, targetFile);
}

function getRelativePath(baseDir: string, absPath: string): string {
  return path.relative(baseDir, absPath);
}

/**
 * Attempt to run a shell command. Returns stdout on success, null on failure.
 */
function tryExec(command: string): string | null {
  try {
    return execSync(command, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
    });
  } catch {
    return null;
  }
}

/**
 * Scan a single file for import statements and return the resolved import references.
 */
function scanFileForImports(
  filePath: string,
  baseDir: string,
  validTargets: Set<string>,
): ImportRef[] {
  const imports: ImportRef[] = [];

  if (!fs.existsSync(filePath)) {
    return imports; // file doesn't exist yet — skip
  }

  // Use grep first, fall back to ripgrep
  let grepOut = tryExec(`grep -n -E "(from\\s+['\"]|require\\s*\\(\\s*['\"]|import\\s*\\()" "${filePath}"`);

  if (grepOut === null) {
    // fallback to ripgrep
    grepOut = tryExec(`rg -n --no-heading -E "(from\\s+['\"]|require\\s*\\(\\s*['\"]|import\\s*\\()" "${filePath}"`);
  }

  if (grepOut === null || grepOut.trim() === '') {
    return imports;
  }

  const lines = grepOut.trim().split('\n');

  for (const line of lines) {
    const match = line.match(/^(\d+):.*?from\s+['"]([^'"]+)['"]/);
    const requireMatch = !match ? line.match(/^(\d+):.*?require\s*\(\s*['"]([^'"]+)['"]/) : null;
    const dynamicImportMatch = !match && !requireMatch
      ? line.match(/^(\d+):.*?import\s*\(\s*['"]([^'"]+)['"]/)
      : null;

    let rawImport: string | undefined;
    let lineNum: number | undefined;

    if (match) {
      lineNum = parseInt(match[1], 10);
      rawImport = match[2];
    } else if (requireMatch) {
      lineNum = parseInt(requireMatch[1], 10);
      rawImport = requireMatch[2];
    } else if (dynamicImportMatch) {
      lineNum = parseInt(dynamicImportMatch[1], 10);
      rawImport = dynamicImportMatch[2];
    }

    if (!rawImport || lineNum === undefined) continue;

    // Resolve the import path relative to the file's directory
    const fileDir = path.dirname(filePath);
    let resolvedImport = '';

    if (rawImport.startsWith('.')) {
      // Relative import
      resolvedImport = path.resolve(fileDir, rawImport);
    } else if (rawImport.startsWith('/')) {
      // Absolute import within project
      resolvedImport = path.resolve(baseDir, rawImport.slice(1));
    } else {
      // Could be a package import or a src-aliased import — try checking with src/ prefix
      const aliasedImport = path.resolve(baseDir, rawImport);
      if (validTargets.has(aliasedImport) || validTargets.has(aliasedImport + '.ts') || validTargets.has(aliasedImport + '.tsx')) {
        resolvedImport = aliasedImport;
      } else {
        // Not a target file — skip (it's a third-party or non-target import)
        continue;
      }
    }

    // Normalize: add extension if missing and check if resolves to a known target
    const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];
    let resolvedTarget = '';

    for (const ext of extensions) {
      const candidate = resolvedImport + ext;
      if (validTargets.has(candidate)) {
        resolvedTarget = candidate;
        break;
      }
    }

    // Also check if resolvedImport (without extension) matches any target minus extension
    if (!resolvedTarget) {
      const resolvedNoExt = resolvedImport.replace(/\.(ts|tsx|js|jsx)$/, '');
      for (const target of validTargets) {
        const targetNoExt = target.replace(/\.(ts|tsx|js|jsx)$/, '');
        if (resolvedNoExt === targetNoExt) {
          resolvedTarget = target;
          break;
        }
      }
    }

    if (resolvedTarget) {
      imports.push({
        source: filePath,
        target: resolvedTarget,
        raw: rawImport,
        line: lineNum,
      });
    }
  }

  return imports;
}

// ---------------------------------------------------------------------------
// Shared state detection
// ---------------------------------------------------------------------------

/**
 * Shared state patterns to look for:
 *  - Module-level variables / singletons
 *  - Shared config/constants imports that are in the target set
 *  - Database or global state references
 */
interface SharedStateRef {
  file: string;
  pattern: string;
  line: number;
  description: string;
}

function detectSharedState(targetFiles: string[], baseDir: string): SharedStateRef[] {
  const refs: SharedStateRef[] = [];

  const patterns: Array<{ regex: RegExp; description: string }> = [
    { regex: /^(export\s+)?const\s+\w+\s*=\s*new\s/, description: 'Singleton instance creation' },
    { regex: /^(let|var)\s+\w+\s*/, description: 'Mutable module-level variable' },
    { regex: /global\.\w+/, description: 'Global state reference' },
    { regex: /process\.env/, description: 'Environment variable access' },
    { regex: /new\s+(Map|Set|WeakMap|WeakSet)<|new\s+(Map|Set|WeakMap|WeakSet)\s*\(/, description: 'Module-level collection' },
  ];

  for (const file of targetFiles) {
    const absPath = resolveAbsolutePath(baseDir, file);
    if (!fs.existsSync(absPath)) continue;

    const content = fs.readFileSync(absPath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      for (const { regex, description } of patterns) {
        if (regex.test(lineText.trim())) {
          refs.push({
            file,
            pattern: lineText.trim(),
            line: i + 1,
            description,
          });
        }
      }
    }
  }

  return refs;
}

// ---------------------------------------------------------------------------
// Dependency graph building
// ---------------------------------------------------------------------------

function buildDependencyGraph(
  targetFiles: string[],
  manifest: PlanManifest,
  baseDir: string,
): { edges: DependencyEdge[]; warnings: string[]; hasExistingFiles: boolean } {
  const edges: DependencyEdge[] = [];
  const warnings: string[] = [];
  const validTargets = new Set(targetFiles.map(f => resolveAbsolutePath(baseDir, f)));

  // Extend valid targets to include extensionless versions
  const extensionlessTargets = new Set<string>();
  for (const t of validTargets) {
    extensionlessTargets.add(t);
    extensionlessTargets.add(t.replace(/\.(ts|tsx|js|jsx)$/, ''));
  }
  for (const t of extensionlessTargets) {
    validTargets.add(t);
  }

  // Check if files exist
  const existingFiles = targetFiles.filter(f => fs.existsSync(resolveAbsolutePath(baseDir, f)));
  const hasExistingFiles = existingFiles.length > 0;

  if (existingFiles.length < targetFiles.length) {
    warnings.push(
      `Files not yet created — ${targetFiles.length - existingFiles.length} of ${targetFiles.length} target files do not exist. ` +
      'Using manifest dependency metadata plus any existing file cross-references.',
    );
  }

  // 1. Use manifest dependencies if specified
  if (manifest.dependencies && manifest.dependencies.length > 0) {
    for (const dep of manifest.dependencies) {
      const fromAbs = resolveAbsolutePath(baseDir, dep.from);
      const toAbs = resolveAbsolutePath(baseDir, dep.to);
      edges.push({ from: fromAbs, to: toAbs });
    }
  }

  // 2. Scan existing files for cross-references
  for (const file of targetFiles) {
    const absPath = resolveAbsolutePath(baseDir, file);
    const imports = scanFileForImports(absPath, baseDir, validTargets);

    for (const imp of imports) {
      // Avoid duplicating manifest edges
      const alreadyExists = edges.some(
        e => e.from === imp.source && e.to === imp.target,
      );
      if (!alreadyExists) {
        edges.push({ from: imp.source, to: imp.target });
      }
    }
  }

  return { edges, warnings, hasExistingFiles };
}

// ---------------------------------------------------------------------------
// Topological sorting / phase building
// ---------------------------------------------------------------------------

function getFileLabel(baseDir: string, absPath: string): string {
  return getRelativePath(baseDir, absPath);
}

function buildPhases(
  targetFiles: string[],
  edges: DependencyEdge[],
  baseDir: string,
): { phases: Phase[]; details: string[] } {
  const details: string[] = [];
  const phases: Phase[] = [];

  // Map file → label
  const absToLabel = new Map<string, string>();
  for (const f of targetFiles) {
    const abs = resolveAbsolutePath(baseDir, f);
    const label = getFileLabel(baseDir, abs);
    absToLabel.set(abs, label);
  }

  const absTargets = new Set(targetFiles.map(f => resolveAbsolutePath(baseDir, f)));

  // Build adjacency: for each node, list of nodes that depend on it
  const dependsOn = new Map<string, Set<string>>(); // node → nodes it depends on
  const dependedBy = new Map<string, Set<string>>(); // node → nodes that depend on it

  for (const abs of absTargets) {
    dependsOn.set(abs, new Set());
    dependedBy.set(abs, new Set());
  }

  for (const edge of edges) {
    if (absTargets.has(edge.from) && absTargets.has(edge.to)) {
      dependsOn.get(edge.from)!.add(edge.to);
      dependedBy.get(edge.to)!.add(edge.from);
    }
  }

  // Kahn's algorithm for topological ordering
  const inDegree = new Map<string, number>();
  for (const abs of absTargets) {
    inDegree.set(abs, dependsOn.get(abs)!.size);
  }

  const queue: string[] = [];
  for (const [abs, degree] of inDegree) {
    if (degree === 0) {
      queue.push(abs);
    }
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    // Sort queue for deterministic output
    queue.sort((a, b) => absToLabel.get(a)!.localeCompare(absToLabel.get(b)!));
    const node = queue.shift()!;
    sorted.push(node);

    for (const dependent of dependedBy.get(node)!) {
      const newDegree = inDegree.get(dependent)! - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) {
        queue.push(dependent);
      }
    }
  }

  // If not all nodes were visited, there's a cycle
  if (sorted.length < absTargets.size) {
    const visited = new Set(sorted);
    const unvisited = [...absTargets].filter(a => !visited.has(a));
    details.push(`⚠️  Cycle detected involving: ${unvisited.map(a => absToLabel.get(a)).join(', ')}`);
    // Still process what we can
  }

  // Group into phases by dependency depth
  const depth = new Map<string, number>();
  for (const abs of sorted) {
    const deps = dependsOn.get(abs)!;
    if (deps.size === 0) {
      depth.set(abs, 0);
    } else {
      let maxDepth = 0;
      for (const dep of deps) {
        const depDepth = depth.get(dep) ?? 0;
        maxDepth = Math.max(maxDepth, depDepth + 1);
      }
      depth.set(abs, maxDepth);
    }
  }

  // Build phases from depth map
  const maxDepth = Math.max(0, ...depth.values());
  for (let d = 0; d <= maxDepth; d++) {
    const filesAtDepth = [...absTargets]
      .filter(a => depth.get(a) === d)
      .sort((a, b) => absToLabel.get(a)!.localeCompare(absToLabel.get(b)!));

    if (filesAtDepth.length === 0) continue;

    // Determine if all files at this depth are independent of each other
    const hasInternalDependency = filesAtDepth.some(a =>
      filesAtDepth.some(b => a !== b && (dependsOn.get(a)?.has(b) || dependsOn.get(b)?.has(a))),
    );

    const mode: 'PARALLEL' | 'SEQUENTIAL' = hasInternalDependency ? 'SEQUENTIAL' : 'PARALLEL';

    let reason: string;
    if (d === 0) {
      reason = `no dependencies on other target files`;
    } else if (mode === 'PARALLEL') {
      const depLabels = [...new Set(filesAtDepth.flatMap(a => [...dependsOn.get(a)!].map(d => absToLabel.get(d)!)))];
      reason = `depends on: ${depLabels.join(', ')}`;
    } else {
      reason = `internal dependencies within phase`;
    }

    const phaseLabel = `Phase ${d + 1}`;
    phases.push({
      label: phaseLabel,
      files: filesAtDepth.map(a => absToLabel.get(a)!),
      mode,
      reason,
    });
  }

  return { phases, details };
}

// ---------------------------------------------------------------------------
// Recommendation text generation
// ---------------------------------------------------------------------------

function generateRecommendation(
  result: ParallelismResult,
  baseDir: string,
): string {
  const lines: string[] = [];

  lines.push('⚡ Parallelism Analysis');
  lines.push('──────────────────────');

  const allFiles = result.phases.flatMap(p => p.files);
  if (allFiles.length > 0) {
    const fileList = allFiles.join(', ');
    lines.push(`Files: ${fileList}`);
  }

  if (result.warnings.length > 0) {
    lines.push('');
    for (const w of result.warnings) {
      lines.push(`⚠️  ${w}`);
    }
  }

  lines.push('');
  lines.push(`Recommendation: ${result.recommendation}`);

  switch (result.recommendation) {
    case 'SINGLE_FILE':
      lines.push(`  ℹ️  Single file — no parallelism decision needed`);
      break;

    case 'PARALLEL':
      for (const file of allFiles) {
        lines.push(`  ✓ ${file} has no dependencies on other target files`);
      }
      lines.push('');
      lines.push(`Safe to dispatch all ${allFiles.length} Implementors simultaneously.`);
      break;

    case 'SEQUENTIAL':
      if (result.phases.length > 0) {
        // Show the chain
        const chain = result.phases
          .flatMap(p => p.files)
          .join(' ← ');
        lines.push(`  ⛓️  Chain dependency detected: ${chain}`);
        lines.push('');
        for (const phase of result.phases) {
          for (const file of phase.files) {
            lines.push(`  ├── ${phase.label}: ${file} (${phase.reason})`);
          }
        }
      }
      break;

    case 'HYBRID':
      for (const phase of result.phases) {
        const filesStr = phase.files.join(', ');
        lines.push(`  ├── ${phase.label} (${phase.mode}): ${filesStr}`);
        lines.push(`  │     ${phase.reason}`);
      }
      break;
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const { manifest: manifestPath, dir: baseDir } = parseArgs();
  const resolvedBaseDir = path.resolve(baseDir);

  console.error(`[check-parallelism] Reading manifest: ${manifestPath}`);
  console.error(`[check-parallelism] Project directory: ${resolvedBaseDir}`);

  const manifest = readManifest(manifestPath);
  const targetFiles = extractTargetFiles(manifest);

  if (targetFiles.length === 0) {
    console.log('No target files found in manifest.');
    process.exit(0);
  }

  const details: string[] = [];
  const warnings: string[] = [];

  // Build dependency graph
  const { edges, warnings: depWarnings } = buildDependencyGraph(
    targetFiles,
    manifest,
    resolvedBaseDir,
  );
  warnings.push(...depWarnings);

  // Detect shared state
  const sharedStateRefs = detectSharedState(targetFiles, resolvedBaseDir);
  if (sharedStateRefs.length > 0) {
    warnings.push(
      `Shared state detected — ${sharedStateRefs.length} pattern(s) found across target files. ` +
      'This may prevent full parallelism even if no import dependencies exist.',
    );
  }

  // Build phases
  const { phases } = buildPhases(targetFiles, edges, resolvedBaseDir);

  // Determine recommendation
  let recommendation: ParallelismResult['recommendation'];

  if (targetFiles.length === 1) {
    recommendation = 'SINGLE_FILE';
  } else if (phases.length <= 1) {
    // All files in one phase — check for cross-dependencies
    if (edges.length === 0) {
      recommendation = 'PARALLEL';
    } else {
      // Files have dependencies within the same phase (unusual)
      recommendation = 'SEQUENTIAL';
    }
  } else {
    // Multiple phases
    const allParallel = phases.every(p => p.mode === 'PARALLEL');
    recommendation = allParallel ? 'HYBRID' : 'SEQUENTIAL';
  }

  // Populate details for display
  if (targetFiles.length > 0) {
    const fileList = targetFiles.join(', ');
    details.push(fileList);
  }

  if (edges.length > 0) {
    details.push('Dependencies found:');
    for (const edge of edges) {
      const fromLabel = getRelativePath(resolvedBaseDir, edge.from);
      const toLabel = getRelativePath(resolvedBaseDir, edge.to);
      details.push(`  ${fromLabel} → ${toLabel}`);
    }
  }

  const result: ParallelismResult = {
    recommendation,
    phases,
    details,
    warnings,
  };

  const output = generateRecommendation(result, resolvedBaseDir);
  console.log(output);

  process.exit(0);
}

main();
