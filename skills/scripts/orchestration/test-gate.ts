#!/usr/bin/env node
/**
 * Test Gate
 *
 * Detects the project's test framework and runs the test suite.
 * Called by the Orchestrator AFTER the Lint Gate passes and BEFORE
 * the Security Scan Gate. Also run by the Implementor as step 7.5.
 *
 * Detection order:
 *   1. package.json scripts.test field
 *   2. package.json scripts.test:* wildcards (vitest, jest, mocha)
 *   3. Existing config files: jest.config.*, vitest.config.*, .mocharc.*
 *   4. node_modules/.bin/jest, node_modules/.bin/vitest, node_modules/.bin/mocha
 *
 * Error code: TST-001 (Test Gate Failure) from the unified error schema.
 *
 * Usage:
 *   [runtime] skills/scripts/orchestration/test-gate.ts
 *   [runtime] skills/scripts/orchestration/test-gate.ts --command="vitest run"
 *   [runtime] skills/scripts/orchestration/test-gate.ts --verbose
 *   [runtime] skills/scripts/orchestration/test-gate.ts --dir=/path/to/project
 *
 * Exit codes:
 *   0 — Test gate passed (all tests pass OR no test framework found)
 *   1 — Test gate FAILED (test failures detected)
 *   2 — Error/exception during execution
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync, ExecSyncOptions } from 'child_process';

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_TIMEOUT_MS = 120_000; // 2 minutes default

const KNOWN_FRAMEWORKS: Array<{
  name: string;
  configGlobs: string[];
  binNames: string[];
  scriptWildcards: string[];
}> = [
  {
    name: 'jest',
    configGlobs: ['jest.config.js', 'jest.config.ts', 'jest.config.mjs', 'jest.config.cjs', 'jest.config.json'],
    binNames: ['jest'],
    scriptWildcards: ['test:jest', 'jest'],
  },
  {
    name: 'vitest',
    configGlobs: ['vitest.config.js', 'vitest.config.ts', 'vitest.config.mjs', 'vitest.config.cjs'],
    binNames: ['vitest'],
    scriptWildcards: ['test:vitest', 'vitest'],
  },
  {
    name: 'mocha',
    configGlobs: ['.mocharc.js', '.mocharc.yml', '.mocharc.yaml', '.mocharc.json', '.mocharc.cjs'],
    binNames: ['mocha'],
    scriptWildcards: ['test:mocha', 'mocha'],
  },
];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TestGateResult {
  testGatePassed: boolean;
  testFramework: string | null;
  testCommand: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  testDuration: string;
  exitCode: number;
  failedTestNames: string[];
  output: string;
  skipped: boolean;
  skipReason: string;
}

export interface CliArgs {
  command: string | null;
  verbose: boolean;
  dir: string;
}

// ── Argument Parsing ──────────────────────────────────────────────────────────

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    command: null,
    verbose: false,
    dir: process.cwd(),
  };

  for (const arg of argv) {
    if (arg === '--verbose') {
      args.verbose = true;
    } else if (arg.startsWith('--command=')) {
      args.command = arg.slice('--command='.length);
    } else if (arg.startsWith('--dir=')) {
      args.dir = arg.slice('--dir='.length);
    }
  }

  return args;
}

// ── Detection Logic ───────────────────────────────────────────────────────────

/**
 * Read and parse package.json from the given directory.
 * Returns null if not found or unreadable.
 */
export function readPackageJson(projectDir: string): Record<string, any> | null {
  const pkgPath = path.join(projectDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Check if a binary exists in node_modules/.bin for the given framework.
 */
export function hasBinaryInNodeModules(binName: string, projectDir: string): boolean {
  const binPath = path.join(projectDir, 'node_modules', '.bin', binName);
  return fs.existsSync(binPath);
}

/**
 * Check if any config file exists for the given framework.
 */
export function hasConfigFile(configGlobs: string[], projectDir: string): boolean {
  return configGlobs.some((glob) => fs.existsSync(path.join(projectDir, glob)));
}

/**
 * Detect which test framework(s) are available for the project.
 * Returns the detected framework name or null.
 */
export function detectTestFramework(pkg: Record<string, any> | null, projectDir: string): string | null {
  // 1. Check package.json scripts.test
  if (pkg?.scripts?.test && typeof pkg.scripts.test === 'string' && pkg.scripts.test.trim() !== '') {
    const testScript = pkg.scripts.test.trim();

    // Try to infer framework from the script content
    for (const fw of KNOWN_FRAMEWORKS) {
      if (testScript.includes(fw.name) || testScript.includes(fw.scriptWildcards[0]) || testScript.includes(fw.scriptWildcards[1])) {
        return fw.name;
      }
    }

    // Generic test script exists — return 'generic' so we can still run it
    return 'generic';
  }

  // 2. Check package.json scripts.test:* wildcards
  if (pkg?.scripts && typeof pkg.scripts === 'object') {
    const scriptKeys = Object.keys(pkg.scripts);
    for (const fw of KNOWN_FRAMEWORKS) {
      const hasWildcard = fw.scriptWildcards.some((wildcard) =>
        scriptKeys.includes(wildcard) || scriptKeys.some((k) => k.startsWith(`test:${fw.name}`))
      );
      if (hasWildcard) return fw.name;
    }
  }

  // 3. Check config files
  for (const fw of KNOWN_FRAMEWORKS) {
    if (hasConfigFile(fw.configGlobs, projectDir)) return fw.name;
  }

  // 4. Check node_modules/.bin binaries
  for (const fw of KNOWN_FRAMEWORKS) {
    if (fw.binNames.some((bin) => hasBinaryInNodeModules(bin, projectDir))) return fw.name;
  }

  return null;
}

/**
 * Check if a specific test runner binary is actually installed.
 */
export function isTestRunnerInstalled(framework: string, projectDir: string): boolean {
  // For generic, we can't easily check — assume yes if script exists
  if (framework === 'generic') return true;

  const fwConfig = KNOWN_FRAMEWORKS.find((f) => f.name === framework);
  if (!fwConfig) return false;

  return fwConfig.binNames.some((bin) => hasBinaryInNodeModules(bin, projectDir));
}

/**
 * Build the test command to execute.
 */
export function buildTestCommand(
  framework: string | null,
  pkg: Record<string, any> | null,
  cliOverride: string | null,
): string | null {
  // CLI override takes precedence
  if (cliOverride) return cliOverride;

  if (!framework) return null;

  if (framework === 'generic' && pkg?.scripts?.test) {
    return `npm test`;
  }

  // Use package.json script if available
  for (const fw of KNOWN_FRAMEWORKS) {
    if (fw.name === framework && pkg?.scripts?.test && pkg.scripts.test.includes(fw.name)) {
      return `npm test`;
    }

    if (fw.name === framework && pkg?.scripts) {
      // Check for framework-specific script
      for (const wildcard of fw.scriptWildcards) {
        if (pkg.scripts[wildcard]) {
          return `npm run ${wildcard}`;
        }
      }
    }
  }

  // Fallback: direct binary
  if (framework === 'jest') return `npx jest`;
  if (framework === 'vitest') return `npx vitest run`;
  if (framework === 'mocha') return `npx mocha`;

  return null;
}

// ── Output Parsing ────────────────────────────────────────────────────────────

/**
 * Parse test output to extract test counts and failure information.
 * Returns a partial TestGateResult with parsed fields filled in.
 */
export function parseTestOutput(
  stdout: string,
  framework: string | null,
  exitCode: number,
): Pick<TestGateResult, 'totalTests' | 'passedTests' | 'failedTests' | 'failedTestNames'> {
  const result: Pick<TestGateResult, 'totalTests' | 'passedTests' | 'failedTests' | 'failedTestNames'> = {
    totalTests: 0,
    passedTests: 0,
    failedTests: 0,
    failedTestNames: [],
  };

  if (!framework || framework === 'generic') {
    // Generic / unknown framework — try to infer from common patterns
    return parseGenericTestOutput(stdout, exitCode, result);
  }

  switch (framework) {
    case 'vitest': {
      // Vitest output patterns:
      //   ✓ basic test (1 test) 2ms
      //   ✗ failing test (1 test) 5ms
      //   Tests  1 failed | 1 passed (2 tests)
      //   Tests  1 failed (1 test)
      //   Tests  2 passed (2 tests)
      const vitestSummary = stdout.match(/Tests\s+(?:\|\s*)?(\d+\s+failed)?\s*(?:\|\s*)?(\d+\s+passed)?\s*(?:\(\s*(\d+)\s+tests?\s*\))?/);
      if (vitestSummary) {
        result.failedTests = parseInt(vitestSummary[1]?.split(' ')[0] || '0', 10);
        result.passedTests = parseInt(vitestSummary[2]?.split(' ')[0] || '0', 10);
        result.totalTests = parseInt(vitestSummary[3] || '0', 10);

        // If total not captured, compute from pass + fail
        if (result.totalTests === 0 && result.passedTests + result.failedTests > 0) {
          result.totalTests = result.passedTests + result.failedTests;
        }
      }

      // Extract failed test names: lines with ✗
      const vitestFailLines = stdout.match(/✗\s+(.+?)\s*\(/g);
      if (vitestFailLines) {
        result.failedTestNames = vitestFailLines.map((l) => {
          const match = l.match(/✗\s+(.+?)\s*\(/);
          return match ? match[1].trim() : l.trim();
        });
      }
      break;
    }

    case 'jest': {
      // Jest output patterns:
      //   Tests:       1 failed, 1 passed, 2 total
      //   Tests:       1 failed, 2 total
      const jestSummary = stdout.match(/Tests:\s*(?:(\d+)\s+failed,\s*)?(?:(\d+)\s+passed,\s*)?(\d+)\s+total/);
      if (jestSummary) {
        result.failedTests = parseInt(jestSummary[1] || '0', 10);
        result.passedTests = parseInt(jestSummary[2] || '0', 10);
        result.totalTests = parseInt(jestSummary[3] || '0', 10);
      }

      // Jest snapshots don't count as test assertions, so also check for PASS/FAIL
      if (result.totalTests === 0) {
        // Fallback: try to count from individual test results
        const passMatches = stdout.match(/✓|PASS/g);
        const failMatches = stdout.match(/✗|FAIL/g);
        result.passedTests = passMatches ? passMatches.length : 0;
        result.failedTests = failMatches ? failMatches.length : 0;
      }

      // Extract failed test names: lines like "● failing test name"
      const jestFailLines = stdout.match(/●\s+(.+)/g);
      if (jestFailLines) {
        result.failedTestNames = jestFailLines.map((l) => l.replace(/^●\s+/, '').trim());
      }
      break;
    }

    case 'mocha': {
      // Mocha output patterns:
      //   passing (N ms)
      //   failing
      //   1 passing (10ms)
      //   1 failing
      //   2 passing, 1 failing
      const mochaPassing = stdout.match(/(\d+)\s+passing/);
      const mochaFailing = stdout.match(/(\d+)\s+failing/);
      result.passedTests = mochaPassing ? parseInt(mochaPassing[1], 10) : 0;
      result.failedTests = mochaFailing ? parseInt(mochaFailing[1], 10) : 0;
      result.totalTests = result.passedTests + result.failedTests;

      // Extract failed test names: lines with "  N) failing test name"
      const mochaFailLines = stdout.match(/\d+\)\s+(.+)/g);
      if (mochaFailLines) {
        result.failedTestNames = mochaFailLines.map((l) => {
          const match = l.match(/\d+\)\s+(.+)/);
          return match ? match[1].trim() : l.trim();
        });
      }
      break;
    }

    default:
      return parseGenericTestOutput(stdout, exitCode, result);
  }

  return result;
}

/**
 * Fallback parser for unknown or generic test frameworks.
 */
function parseGenericTestOutput(
  stdout: string,
  exitCode: number,
  fallback: Pick<TestGateResult, 'totalTests' | 'passedTests' | 'failedTests' | 'failedTestNames'>,
): Pick<TestGateResult, 'totalTests' | 'passedTests' | 'failedTests' | 'failedTestNames'> {
  const result = { ...fallback };

  // Try to match common summary patterns
  // Pattern: "X passed, Y failed"
  const commonSummary = stdout.match(/(\d+)\s+passed\s*,\s*(\d+)\s+failed/);
  if (commonSummary) {
    result.passedTests = parseInt(commonSummary[1], 10);
    result.failedTests = parseInt(commonSummary[2], 10);
    result.totalTests = result.passedTests + result.failedTests;
    return result;
  }

  // Pattern: "X of Y tests passed" or "X/Y tests passed"
  const partialPass = stdout.match(/(\d+)\s+of\s+(\d+)\s+tests?\s+passed/);
  if (partialPass) {
    result.passedTests = parseInt(partialPass[1], 10);
    result.totalTests = parseInt(partialPass[2], 10);
    result.failedTests = result.totalTests - result.passedTests;
    return result;
  }

  // Pattern: "X/Y" (common in some test frameworks)
  const slashMatch = stdout.match(/(\d+)\/(\d+)\s+tests?\s+(?:passed|complete)/);
  if (slashMatch) {
    result.passedTests = parseInt(slashMatch[1], 10);
    result.totalTests = parseInt(slashMatch[2], 10);
    result.failedTests = result.totalTests - result.passedTests;
    return result;
  }

  // Last resort: use exit code
  if (exitCode === 0) {
    result.passedTests = 1;
    result.totalTests = 1;
    result.failedTests = 0;
  } else {
    result.failedTests = 1;
    result.totalTests = 1;
    result.passedTests = 0;
  }

  // Extract "FAIL" / "Error" prefixed lines for failed test names
  const failLines = stdout.match(/FAIL\s+(.+)/g);
  if (failLines) {
    result.failedTestNames = failLines.map((l) => l.replace(/^FAIL\s+/, '').trim());
  }

  return result;
}

/**
 * Extract test duration from output.
 */
export function parseTestDuration(stdout: string, framework: string | null): string {
  if (!framework) return '';

  // Try framework-specific patterns first
  switch (framework) {
    case 'vitest': {
      const match = stdout.match(/Duration\s+([\d.]+m?s)/);
      if (match) return match[1];
      break;
    }
    case 'jest': {
      const match = stdout.match(/Time:\s+([\d.]+(\s+s|ms))/);
      if (match) return match[1].trim();
      break;
    }
    case 'mocha': {
      const match = stdout.match(/(\d+)\s+passing\s+\((.*?)\)/);
      if (match) return match[2];
      break;
    }
  }

  // Generic: look for time-related patterns
  const timeMatch = stdout.match(/(?:Time|Duration|Finished)\s*:?\s*([\d.]+(\s+(?:s|ms|m|seconds|milliseconds))?)/i);
  if (timeMatch) return timeMatch[1].trim();

  return '';
}

// ── Test Runner ───────────────────────────────────────────────────────────────

/**
 * Execute the test command and return structured results.
 * This is the main exported function for external use (testability).
 */
export function runTests(
  projectDir: string,
  cliCommand: string | null,
  timeoutMs: number = TEST_TIMEOUT_MS,
  verbose: boolean = false,
): TestGateResult {
  function log(level: string, msg: string): void {
    if (verbose) console.error(`[${level}] ${msg}`);
  }

  const emptyResult: TestGateResult = {
    testGatePassed: true,
    testFramework: null,
    testCommand: '',
    totalTests: 0,
    passedTests: 0,
    failedTests: 0,
    testDuration: '',
    exitCode: 0,
    failedTestNames: [],
    output: '',
    skipped: true,
    skipReason: '',
  };

  // ── Step 1: Detect test framework ──
  const pkg = readPackageJson(projectDir);
  const framework = detectTestFramework(pkg, projectDir);

  // If no framework detected but CLI override given, use it directly
  if (!framework && cliCommand) {
    log('info', `Using CLI command override: ${cliCommand}`);
    // Fall through to test execution with the override
  } else if (!framework) {
    log('info', 'No test framework detected — skipping test gate');
    return {
      ...emptyResult,
      skipReason: 'No test framework detected',
    };
  }

  if (framework) {
    log('info', `Detected test framework: ${framework}`);
  }

  // ── Step 2: Build command ──
  const command = buildTestCommand(framework, pkg, cliCommand);
  if (!command) {
    return {
      ...emptyResult,
      testFramework: framework,
      skipReason: 'Test script exists but test runner not installed',
    };
  }

  log('info', `Test command: ${command}`);

  // ── Step 3: Verify runner is installed (skip if CLI override or generic) ──
  if (framework && framework !== 'generic' && !cliCommand && !isTestRunnerInstalled(framework, projectDir)) {
    return {
      ...emptyResult,
      testFramework: framework,
      testCommand: command,
      skipReason: 'Test script exists but test runner not installed',
    };
  }

  // ── Step 4: Run tests ──
  const startTime = Date.now();
  let stdout = '';
  let exitCode = 0;

  try {
    const opts: ExecSyncOptions = {
      cwd: projectDir,
      encoding: 'utf-8' as BufferEncoding,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
      shell: true as any,
    };

    const result = execSync(command, opts);
    stdout = (result ?? '').toString();
    exitCode = 0;
  } catch (err: any) {
    stdout = err.stdout ? err.stdout.toString() : '';
    const stderr = err.stderr ? err.stderr.toString() : '';
    exitCode = err.status ?? 1;

    if (err.killed || err.signal === 'SIGTERM') {
      log('warn', `Test command timed out after ${timeoutMs}ms`);
      // Append timeout warning to output
      stdout += `\n[WARN] Test command timed out after ${timeoutMs}ms`;
    }

    // Append stderr to stdout for unified output
    if (stderr) {
      stdout += `\n${stderr}`;
    }
  }

  const durationMs = Date.now() - startTime;
  const testDuration = formatDuration(durationMs);

  // ── Step 5: Parse output ──
  const parsed = parseTestOutput(stdout, framework, exitCode);
  const parsedDuration = parseTestDuration(stdout, framework);
  const failedTestNames = parsed.failedTestNames;

  // ── Step 6: Determine result ──
  const testGatePassed = exitCode === 0 && parsed.failedTests === 0;

  // Truncate output to last 10000 chars
  const truncatedOutput = stdout.length > 10000 ? stdout.slice(-10000) : stdout;

  const result: TestGateResult = {
    testGatePassed,
    testFramework: framework,
    testCommand: command,
    totalTests: parsed.totalTests,
    passedTests: parsed.passedTests,
    failedTests: parsed.failedTests,
    testDuration: parsedDuration || testDuration,
    exitCode,
    failedTestNames,
    output: truncatedOutput,
    skipped: false,
    skipReason: '',
  };

  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = (ms / 1000).toFixed(2);
  if (ms < 60_000) return `${seconds}s`;
  const minutes = Math.floor(ms / 60_000);
  const remainingSeconds = ((ms % 60_000) / 1000).toFixed(0);
  return `${minutes}m ${remainingSeconds}s`;
}

// ── CLI Entry Point ──────────────────────────────────────────────────────────

function logStderr(level: string, msg: string): void {
  console.error(`[${level}] ${msg}`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  try {
    // Resolve project directory (handle both absolute and relative paths)
    const projectDir = path.resolve(args.dir);

    if (!fs.existsSync(projectDir)) {
      logStderr('error', `Directory not found: ${projectDir}`);
      const errorResult: TestGateResult = {
        testGatePassed: false,
        testFramework: null,
        testCommand: '',
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        testDuration: '',
        exitCode: 2,
        failedTestNames: [],
        output: '',
        skipped: true,
        skipReason: `Directory not found: ${projectDir}`,
      };
      console.log(JSON.stringify(errorResult, null, 2));
      process.exit(2);
    }

    logStderr('info', `Running test gate in: ${projectDir}`);
    const result = runTests(projectDir, args.command, TEST_TIMEOUT_MS, args.verbose);

    // Log summary to stderr
    if (result.skipped) {
      logStderr('info', `Tests skipped: ${result.skipReason}`);
    } else if (result.testGatePassed) {
      const summary = `${result.passedTests}/${result.totalTests} tests passed in ${result.testDuration} (${result.testFramework})`;
      logStderr('success', `Test gate PASSED: ${summary}`);
    } else {
      const summary = `${result.failedTests} test(s) failed in ${result.testDuration} (${result.testFramework})`;
      logStderr('error', `Test gate FAILED: ${summary}`);

      if (result.failedTestNames.length > 0) {
        logStderr('info', 'Failed tests:');
        for (const name of result.failedTestNames) {
          logStderr('info', `  - ${name}`);
        }
      }

      if (args.verbose) {
        logStderr('debug', 'Full output:');
        console.error(result.output);
      }
    }

    // Output JSON result to stdout (machine-readable)
    console.log(JSON.stringify(result, null, 2));

    process.exit(result.testGatePassed ? 0 : 1);
  } catch (err: any) {
    logStderr('error', `Unexpected error: ${err.message}`);

    const errorResult: TestGateResult = {
      testGatePassed: false,
      testFramework: null,
      testCommand: '',
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      testDuration: '',
      exitCode: 2,
      failedTestNames: [],
      output: err.stack || err.message,
      skipped: true,
      skipReason: `Unexpected error: ${err.message}`,
    };
    console.log(JSON.stringify(errorResult, null, 2));
    process.exit(2);
  }
}

if (require.main === module) {
  main();
}
