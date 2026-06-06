#!/usr/bin/env ts-node
/**
 * Cross-platform Node.js test runner for orchestration system tests.
 *
 * Replaces tests/run-tests.sh (bash-only) with a Node.js implementation
 * that works on Windows, Linux, and macOS.
 *
 * Usage:
 *   npx ts-node --project skills/scripts/tsconfig.json tests/run-tests.ts
 *   npx ts-node --project skills/scripts/tsconfig.json tests/run-tests.ts --verbose
 *   npx ts-node --project skills/scripts/tsconfig.json tests/run-tests.ts -v
 */

import { spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

// ESM-compatible __dirname polyfill (works with ts-node under "type": "module")
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── ANSI color helpers ──
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

/**
 * Returns the directory where this script lives (tests/).
 */
function getTestsDir(): string {
  return path.resolve(__dirname);
}

/**
 * Returns the project root (parent of tests/).
 */
function getProjectRoot(): string {
  return path.resolve(getTestsDir(), '..');
}

/**
 * Discovers all *.test.ts files in the tests/ directory, sorted alphabetically.
 */
function discoverTestFiles(testsDir: string): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(testsDir);
  } catch (err) {
    throw new Error(`Cannot read tests directory: ${testsDir} — ${(err as Error).message}`);
  }

  const testFiles = entries
    .filter((entry) => entry.endsWith('.test.ts'))
    .sort()
    .map((entry) => path.join(testsDir, entry));

  return testFiles;
}

/**
 * Resolves the path to the ts-node binary. Tries node_modules first,
 * then falls back to 'npx' (requires shell: true on Windows).
 */
function resolveTsNode(
  projectRoot: string,
): { binary: string; args: string[]; shell: boolean } {
  // Try direct path to ts-node in node_modules
  const directPath = path.join(projectRoot, 'node_modules', 'ts-node', 'dist', 'bin.js');
  if (fs.existsSync(directPath)) {
    return {
      binary: process.execPath, // node binary
      args: [directPath],
      shell: false,
    };
  }

  // Try a broader search for ts-node bin.js
  const altPaths = [
    path.join(projectRoot, 'node_modules', '.bin', 'ts-node'),
    path.join(projectRoot, 'node_modules', 'ts-node', 'bin.js'),
  ];
  for (const altPath of altPaths) {
    if (fs.existsSync(altPath)) {
      return {
        binary: process.execPath,
        args: [altPath],
        shell: false,
      };
    }
  }

  // Fallback to npx (cross-platform but needs shell on Windows for .cmd scripts)
  return {
    binary: 'npx',
    args: ['ts-node'],
    shell: true,
  };
}

/**
 * Formats a duration in milliseconds to a human-readable string.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

// ── Main ──

function main(): void {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose') || args.includes('-v');

  const testsDir = getTestsDir();
  const overallStartTime = Date.now();
  const projectRoot = getProjectRoot();

  console.log(`${BOLD}🧪 Orchestration System Tests${RESET}`);
  console.log(`${BOLD}================================${RESET}\n`);

  // Discover test files
  let testFiles: string[];
  try {
    testFiles = discoverTestFiles(testsDir);
  } catch (err) {
    console.error(`${RED}❌ ${(err as Error).message}${RESET}`);
    process.exit(1);
  }

  if (testFiles.length === 0) {
    console.log(`${YELLOW}⚠ No test files found in ${testsDir}${RESET}`);
    console.log('');
    process.exit(0);
  }

  // Resolve ts-node binary path
  let tsNode: { binary: string; args: string[]; shell: boolean };
  try {
    tsNode = resolveTsNode(projectRoot);
  } catch (err) {
    console.error(`${RED}❌ Cannot resolve ts-node binary: ${(err as Error).message}${RESET}`);
    process.exit(1);
  }

  const tsconfigPath = path.join(projectRoot, 'skills', 'scripts', 'tsconfig.json');

  console.log(`Node: ${process.version} at ${process.execPath}`);
  console.log(`Tests directory: ${testsDir}`);
  console.log(`Test files: ${testFiles.length} found`);
  console.log('');

  if (!fs.existsSync(tsconfigPath)) {
    console.error(`${RED}❌ tsconfig not found at: ${tsconfigPath}${RESET}`);
    process.exit(1);
  }

  console.log('Test files:');
  for (const file of testFiles) {
    console.log(`  ${path.basename(file)}`);
  }
  console.log('');
  console.log(`${BOLD}================================${RESET}\n`);

  let passed = 0;
  let failed = 0;

  for (const testFile of testFiles) {
    const testName = path.basename(testFile, '.test.ts');
    const testLabel = `  ${testName}`;

    process.stdout.write(`${CYAN}▶${RESET} Running: ${testName}\n`);

    const startTime = Date.now();
    const result = spawnSync(
      tsNode.binary,
      [
        ...tsNode.args,
        '--transpileOnly',
        '--project',
        tsconfigPath,
        testFile,
      ],
      {
        cwd: projectRoot,
        encoding: 'utf-8',
        shell: tsNode.shell,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
      },
    );
    const duration = Date.now() - startTime;

    // Handle spawn failures (binary not found, etc.)
    if (result.error) {
      console.log(`\n${RED}  ❌ ${testName} FAILED (spawn error)${RESET}`);
      console.log(`${RED}     ${result.error.message}${RESET}\n`);
      failed++;
      continue;
    }

    const exitCode = result.status ?? -1;
    const output = (result.stdout || '') + (result.stderr || '');

    if (exitCode === 0) {
      if (verbose && output.trim()) {
        console.log(output.trimEnd());
      }
      console.log(`  ${GREEN}✅ ${testName} PASSED${RESET} (${formatDuration(duration)})`);
      console.log('');
      passed++;
    } else {
      // Always show output on failure
      if (output.trim()) {
        console.log(output.trimEnd());
      }
      console.log(`  ${RED}❌ ${testName} FAILED (exit code: ${exitCode})${RESET}`);
      console.log('');
      failed++;
    }
  }

  // ── Summary ──
  const total = passed + failed;
  console.log(`${BOLD}================================${RESET}`);
  if (failed === 0) {
    console.log(`${GREEN}🎉 All ${passed} tests passed!${RESET} (${formatDuration(total > 0 ? Date.now() - overallStartTime : 0)})`);
  } else {
    console.log(`Results: ${GREEN}${passed} passed${RESET}, ${RED}${failed} failed${RESET}, ${total} total (${formatDuration(Date.now() - overallStartTime)})`);
  }

  if (failed > 0) {
    process.exit(1);
  }
}

main();



