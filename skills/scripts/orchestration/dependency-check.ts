#!/usr/bin/env node
/**
 * Dependency Check
 *
 * Pre-flight dependency verification for orchestration tools.
 * Checks if required and optional tools are available in PATH or
 * node_modules/.bin, and verifies that all orchestration scripts
 * referenced in the orchestration SKILL.md actually exist on disk.
 *
 * Usage:
 *   [noderuntime] dependency-check.ts --verify
 *   [noderuntime] dependency-check.ts --verify-tool=<tool-name>
 *   [noderuntime] dependency-check.ts --list
 *   [noderuntime] dependency-check.ts --check-scripts
 *
 * Exit codes:
 *   0 = all required checks passed
 *   1 = error or missing required tool/script
 *   2 = (reserved for specific conditions — e.g., warnings found during verify)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';

// ── Constants ──────────────────────────────────────────────────────

const ORCHESTRATION_SKILL_PATH = 'skills/orchestration/SKILL.md';
const SCRIPTS_DIR = 'skills/scripts/orchestration';
const WORKSPACE_ROOT = process.cwd();

// ── Tool Definitions ───────────────────────────────────────────────

interface ToolDef {
  name: string;
  required: boolean;
  binaryName: string;
}

const TOOLS: ToolDef[] = [
  // Required
  { name: 'ts-node',       required: true,  binaryName: 'ts-node' },
  { name: 'typescript',    required: true,  binaryName: 'tsc' },
  { name: 'node',          required: true,  binaryName: 'node' },
  // Optional
  { name: 'npx',           required: false, binaryName: 'npx' },
  { name: 'npm',           required: false, binaryName: 'npm' },
  { name: 'eslint',        required: false, binaryName: 'eslint' },
  { name: 'prettier',      required: false, binaryName: 'prettier' },
  { name: 'playwright',    required: false, binaryName: 'playwright' },
  { name: "semgrep",       required: false, binaryName: "semgrep" },
  { name: "podman",        required: false, binaryName: "podman" },
];

interface ToolCheckResult {
  name: string;
  required: boolean;
  status: 'found' | 'not-found';
  path: string | null;
  version: string | null;
}

// ── Types ──────────────────────────────────────────────────────────

interface Args {
  verify?: boolean;
  verifyTool?: string;
  list?: boolean;
  checkScripts?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  const args: Args = {};
  for (const a of raw) {
    if (a === '--verify') { args.verify = true; continue; }
    if (a === '--list') { args.list = true; continue; }
    if (a === '--check-scripts') { args.checkScripts = true; continue; }
    if (a.startsWith('--verify-tool=')) { args.verifyTool = a.split('=')[1]; continue; }
  }
  return args;
}

function exec(cmd: string): { stdout: string; stderr: string; code: number } {
  try {
    const result = child_process.spawnSync(cmd, {
      shell: true,
      cwd: WORKSPACE_ROOT,
      encoding: 'utf-8',
      timeout: 10000,
    });
    return {
      stdout: result.stdout?.trim() || '',
      stderr: result.stderr?.trim() || '',
      code: result.status ?? 1,
    };
  } catch (e) {
    return { stdout: '', stderr: (e as Error).message, code: 1 };
  }
}

function checkTool(binaryName: string): ToolCheckResult['status'] {
  // Check PATH first via which/where
  const whichResult = exec(`which "${binaryName}" 2>/dev/null || command -v "${binaryName}" 2>/dev/null`);
  if (whichResult.code === 0 && whichResult.stdout.length > 0) {
    return 'found';
  }

  // Check node_modules/.bin
  const localBin = path.join(WORKSPACE_ROOT, 'node_modules', '.bin', binaryName);
  if (fs.existsSync(localBin)) {
    return 'found';
  }

  // Special case: tsc can be found as "tsc" or "typescript" — check both
  if (binaryName === 'tsc') {
    const tscAlt = path.join(WORKSPACE_ROOT, 'node_modules', '.bin', 'tsc');
    if (fs.existsSync(tscAlt)) return 'found';
  }

  return 'not-found';
}

function getToolPath(binaryName: string): string | null {
  const whichResult = exec(`which "${binaryName}" 2>/dev/null || command -v "${binaryName}" 2>/dev/null`);
  if (whichResult.code === 0 && whichResult.stdout.length > 0) {
    return whichResult.stdout;
  }

  const localBin = path.join(WORKSPACE_ROOT, 'node_modules', '.bin', binaryName);
  if (fs.existsSync(localBin)) {
    return localBin;
  }

  if (binaryName === 'tsc') {
    const tscAlt = path.join(WORKSPACE_ROOT, 'node_modules', '.bin', 'tsc');
    if (fs.existsSync(tscAlt)) return tscAlt;
  }

  return null;
}

function getToolVersion(binaryName: string, toolPath: string): string | null {
  // Try --version for most tools
  const versionResult = exec(`"${toolPath}" --version 2>/dev/null`);
  if (versionResult.code === 0 && versionResult.stdout.length > 0) {
    return versionResult.stdout.split('\n')[0].trim();
  }

  // node has --version
  if (binaryName === 'node') {
    const r = exec('node --version 2>/dev/null');
    if (r.code === 0) return r.stdout.trim();
  }

  return null;
}

function checkAllTools(): ToolCheckResult[] {
  return TOOLS.map(tool => {
    const status = checkTool(tool.binaryName);
    const toolPath = status === 'found' ? getToolPath(tool.binaryName) : null;
    const version = toolPath ? getToolVersion(tool.binaryName, toolPath) : null;
    return {
      name: tool.name,
      required: tool.required,
      status,
      path: toolPath,
      version,
    };
  });
}

function checkSpecificTool(toolName: string): ToolCheckResult | null {
  const tool = TOOLS.find(t => t.name === toolName || t.binaryName === toolName);
  if (!tool) return null;

  const status = checkTool(tool.binaryName);
  const toolPath = status === 'found' ? getToolPath(tool.binaryName) : null;
  const version = toolPath ? getToolVersion(tool.binaryName, toolPath) : null;

  return {
    name: tool.name,
    required: tool.required,
    status,
    path: toolPath,
    version,
  };
}

// ── Script Check ───────────────────────────────────────────────────

function checkOrchestrationScripts(): Array<{
  scriptPath: string;
  scriptName: string;
  exists: boolean;
}> {
  const skillPath = path.join(WORKSPACE_ROOT, ORCHESTRATION_SKILL_PATH);
  if (!fs.existsSync(skillPath)) {
    console.error(`Error: ${ORCHESTRATION_SKILL_PATH} not found`);
    process.exit(1);
  }

  const content = fs.readFileSync(skillPath, 'utf-8');
  // Extract all ts-node skills/scripts/orchestration/<name>.ts references
  const regex = /ts-node\s+skills\/scripts\/orchestration\/([\w-]+\.ts)/g;
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    matches.push(match[1]);
  }

  // Deduplicate
  const uniqueScripts = [...new Set(matches)];

  const results = uniqueScripts.map(scriptName => {
    const scriptPath = path.join(WORKSPACE_ROOT, SCRIPTS_DIR, scriptName);
    return {
      scriptPath,
      scriptName,
      exists: fs.existsSync(scriptPath),
    };
  });

  return results.sort((a, b) => a.scriptName.localeCompare(b.scriptName));
}

// ── Commands ───────────────────────────────────────────────────────

function cmdList(): void {
  const results = checkAllTools();

  const tableData = results.map(r => ({
    name: r.name,
    required: r.required,
    status: r.status === 'found' ? '✅ found' : '❌ not-found',
    path: r.path,
    version: r.version,
  }));

  const foundCount = results.filter(r => r.status === 'found').length;
  const missingCount = results.filter(r => r.status === 'not-found').length;

  const output = {
    list: true,
    totalTools: results.length,
    found: foundCount,
    missing: missingCount,
    requiredFound: results.filter(r => r.required && r.status === 'found').length,
    requiredMissing: results.filter(r => r.required && r.status === 'not-found').length,
    tools: tableData,
  };

  console.log(JSON.stringify(output, null, 2));
  process.exit(0);
}

function cmdVerify(args: Args): void {
  let results: ToolCheckResult[];

  if (args.verifyTool) {
    const single = checkSpecificTool(args.verifyTool);
    if (!single) {
      console.error(`Error: Unknown tool "${args.verifyTool}". Valid tools: ${TOOLS.map(t => t.name).join(', ')}`);
      process.exit(1);
    }
    results = [single];
  } else {
    results = checkAllTools();
  }

  const missingRequired = results.filter(r => r.required && r.status === 'not-found');
  const missingOptional = results.filter(r => !r.required && r.status === 'not-found');

  const output = {
    verify: true,
    verifiedTool: args.verifyTool || null,
    totalChecked: results.length,
    missingRequired: missingRequired.length,
    missingOptional: missingOptional.length,
    allRequiredFound: missingRequired.length === 0,
    results: results.map(r => ({
      name: r.name,
      required: r.required,
      status: r.status,
      path: r.path,
      version: r.version,
    })),
  };

  console.log(JSON.stringify(output, null, 2));

  if (missingRequired.length > 0) {
    process.exit(1);
  }

  // Exit 2 if all required tools are found but optional tools are missing (actionable warning)
  if (missingOptional.length > 0) {
    process.exit(2);
  }

  process.exit(0);
}

function cmdCheckScripts(): void {
  const results = checkOrchestrationScripts();
  const missing = results.filter(r => !r.exists);

  const output = {
    checkScripts: true,
    totalReferenced: results.length,
    existing: results.filter(r => r.exists).length,
    missing: missing.length,
    scripts: results.map(r => ({
      name: r.scriptName,
      exists: r.exists,
      path: r.scriptPath,
    })),
  };

  console.log(JSON.stringify(output, null, 2));

  if (missing.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

// ── Usage ──────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`
Dependency Check — Pre-flight dependency verification

Usage:
  [noderuntime] dependency-check.ts --verify
  [noderuntime] dependency-check.ts --verify-tool=<tool-name>
  [noderuntime] dependency-check.ts --list
  [noderuntime] dependency-check.ts --check-scripts

Modes:
  --list                List all required and optional tools with status
  --verify              Check all required tools; exit non-zero if any missing
  --verify-tool=<name>  Check a specific tool by name
  --check-scripts       Verify orchestration scripts referenced in SKILL.md exist

Tools checked:
  Required: ts-node, typescript (tsc), node
  Optional: npx, npm, eslint, prettier, playwright, semgrep, podman

Exit codes:
   0 = all required checks passed
   1 = error or missing required tool/script
   2 = optional tools missing (actionable warning)
`);
}

// ── Main ───────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs();

  if (process.argv.length <= 2) {
    printUsage();
    process.exit(0);
  }

  const actionCount = [args.verify, args.list, args.checkScripts].filter(Boolean).length;
  if (actionCount > 1) {
    console.error('Error: Only one action flag allowed (--verify, --list, or --check-scripts)');
    process.exit(1);
  }

  if (args.list) {
    cmdList();
    return;
  }

  if (args.checkScripts) {
    cmdCheckScripts();
    return;
  }

  // --verify-tool without --verify: run verify mode for that one tool
  if (args.verifyTool && !args.verify) {
    args.verify = true;
  }

  if (args.verify) {
    cmdVerify(args);
    return;
  }

  printUsage();
}

if (require.main === module) {
  main();
}
