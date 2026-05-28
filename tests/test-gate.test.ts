/**
 * Tests for test-gate.ts
 *
 * Tests: framework detection, test output parsing, error handling, CLI argument parsing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';

// ── Mocks (hoist-safe: use vi.hoisted) ───────────────────────────────────────

const mockExecSync = vi.hoisted(() => vi.fn());

const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

vi.mock('fs', () => mockFs);

// ── Imports after mocks ──────────────────────────────────────────────────────

import {
  parseArgs,
  readPackageJson,
  hasBinaryInNodeModules,
  hasConfigFile,
  detectTestFramework,
  isTestRunnerInstalled,
  buildTestCommand,
  parseTestOutput,
  parseTestDuration,
  runTests,
  type TestGateResult,
  type CliArgs,
} from '../skills/scripts/orchestration/test-gate';

// ── Helpers ──────────────────────────────────────────────────────────────────

const PROJECT_DIR = path.resolve(process.cwd(), 'tmp-test-gate');
const NODE_MODULES_BIN = path.join(PROJECT_DIR, 'node_modules', '.bin');
const PKG_JSON = path.join(PROJECT_DIR, 'package.json');

function resetMocks(): void {
  vi.clearAllMocks();
  mockExecSync.mockReset();
  mockFs.existsSync.mockReset();
  mockFs.readFileSync.mockReset();
  mockFs.readdirSync.mockReset();
}

function mockExists(existingPaths: string[]): void {
  mockFs.existsSync.mockImplementation((p: string) => existingPaths.includes(p));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Test Gate', () => {
  // ── CLI Argument Parsing ──────────────────────────────────────────────────

  describe('parseArgs', () => {
    it('returns defaults when no arguments provided', () => {
      const args = parseArgs([]);
      expect(args.command).toBeNull();
      expect(args.verbose).toBe(false);
      expect(args.dir).toBe(process.cwd());
    });

    it('parses --command override', () => {
      const args = parseArgs(['--command=npx jest']);
      expect(args.command).toBe('npx jest');
    });

    it('parses --dir working directory override', () => {
      const args = parseArgs(['--dir=/tmp/project']);
      expect(args.dir).toBe('/tmp/project');
    });

    it('parses --verbose flag', () => {
      const args = parseArgs(['--verbose']);
      expect(args.verbose).toBe(true);
    });

    it('parses multiple arguments together', () => {
      const args = parseArgs(['--command=npx mocha', '--dir=/tmp/foo', '--verbose']);
      expect(args.command).toBe('npx mocha');
      expect(args.dir).toBe('/tmp/foo');
      expect(args.verbose).toBe(true);
    });
  });

  // ── readPackageJson ───────────────────────────────────────────────────────

  describe('readPackageJson', () => {
    beforeEach(() => resetMocks());

    it('returns null when package.json does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);
      expect(readPackageJson(PROJECT_DIR)).toBeNull();
    });

    it('returns parsed JSON when package.json exists', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ name: 'test', scripts: { test: 'jest' } }));
      const result = readPackageJson(PROJECT_DIR);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('test');
      expect(result!.scripts.test).toBe('jest');
    });

    it('returns null on invalid JSON', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('not valid json{{{');
      expect(readPackageJson(PROJECT_DIR)).toBeNull();
    });
  });

  // ── Framework Detection ───────────────────────────────────────────────────

  describe('detectTestFramework', () => {
    beforeEach(() => resetMocks());

    it('detects jest from package.json scripts.test', () => {
      const pkg = { scripts: { test: 'jest --coverage' } };
      mockFs.existsSync.mockReturnValue(false); // no config files, no bins
      const result = detectTestFramework(pkg, PROJECT_DIR);
      expect(result).toBe('jest');
    });

    it('detects vitest from package.json scripts.test', () => {
      const pkg = { scripts: { test: 'vitest run' } };
      mockFs.existsSync.mockReturnValue(false);
      const result = detectTestFramework(pkg, PROJECT_DIR);
      expect(result).toBe('vitest');
    });

    it('detects mocha from package.json scripts.test', () => {
      const pkg = { scripts: { test: 'mocha --reporter spec' } };
      mockFs.existsSync.mockReturnValue(false);
      const result = detectTestFramework(pkg, PROJECT_DIR);
      expect(result).toBe('mocha');
    });

    it('returns "generic" when a test script exists but no known framework name', () => {
      const pkg = { scripts: { test: 'node test.js' } };
      mockFs.existsSync.mockReturnValue(false);
      const result = detectTestFramework(pkg, PROJECT_DIR);
      expect(result).toBe('generic');
    });

    it('checks test:* wildcards in scripts when no scripts.test', () => {
      const pkg = { scripts: { 'test:jest': 'jest' } };
      mockFs.existsSync.mockReturnValue(false);
      const result = detectTestFramework(pkg, PROJECT_DIR);
      expect(result).toBe('jest');
    });

    it('detects framework from config files', () => {
      const pkg = null; // No package.json
      const testDir = '/tmp';
      // hasConfigFile checks path.join(testDir, glob) — e.g., /tmp/vitest.config.ts
      mockFs.existsSync.mockImplementation((p: string) => {
        if (p === path.join(testDir, 'vitest.config.ts')) return true;
        if (p === path.join(testDir, 'vitest.config.js')) return false;
        if (p === path.join(testDir, 'vitest.config.mjs')) return false;
        if (p === path.join(testDir, 'vitest.config.cjs')) return false;
        return false;
      });
      const result = detectTestFramework(pkg, testDir);
      expect(result).toBe('vitest');
    });

    it('detects framework from node_modules/.bin binaries', () => {
      mockFs.existsSync.mockImplementation((p: string) => {
        if (p === path.join(PROJECT_DIR, 'node_modules', '.bin', 'jest')) return true;
        if (p === path.join(PROJECT_DIR, 'node_modules', '.bin')) return false;
        // Also existsSync for config file check returns false
        return false;
      });
      const result = detectTestFramework(null, PROJECT_DIR);
      expect(result).toBe('jest');
    });

    it('returns null when no framework found', () => {
      mockFs.existsSync.mockReturnValue(false);
      const result = detectTestFramework(null, PROJECT_DIR);
      expect(result).toBeNull();
    });

    it('returns null when package.json has no scripts', () => {
      mockFs.existsSync.mockReturnValue(false);
      const result = detectTestFramework({ name: 'test' }, PROJECT_DIR);
      expect(result).toBeNull();
    });

    it('prefers framework from scripts.test over config files', () => {
      const pkg = { scripts: { test: 'vitest run' } };
      // Even if jest config exists, vitest in script takes priority
      mockExists([path.join(PROJECT_DIR, 'jest.config.js')]);
      const result = detectTestFramework(pkg, PROJECT_DIR);
      expect(result).toBe('vitest');
    });
  });

  // ── buildTestCommand ──────────────────────────────────────────────────────

  describe('buildTestCommand', () => {
    it('returns CLI override when provided', () => {
      const cmd = buildTestCommand('jest', null, 'npx vitest run');
      expect(cmd).toBe('npx vitest run');
    });

    it('returns null when no framework and no override', () => {
      expect(buildTestCommand(null, null, null)).toBeNull();
    });

    it('returns npm test for generic framework with test script', () => {
      const pkg = { scripts: { test: 'mocha' } };
      expect(buildTestCommand('generic', pkg, null)).toBe('npm test');
    });

    it('returns npm test for known framework with matching test script', () => {
      const pkg = { scripts: { test: 'jest' } };
      expect(buildTestCommand('jest', pkg, null)).toBe('npm test');
    });

    it('returns npm run <wildcard> for framework-specific script', () => {
      const pkg = { scripts: { 'test:vitest': 'vitest --reporter verbose' } };
      expect(buildTestCommand('vitest', pkg, null)).toBe('npm run test:vitest');
    });

    it('returns npx jest as fallback for jest', () => {
      expect(buildTestCommand('jest', null, null)).toBe('npx jest');
    });

    it('returns npx vitest run as fallback for vitest', () => {
      expect(buildTestCommand('vitest', null, null)).toBe('npx vitest run');
    });

    it('returns npx mocha as fallback for mocha', () => {
      expect(buildTestCommand('mocha', null, null)).toBe('npx mocha');
    });
  });

  // ── Test Output Parsing: Jest ─────────────────────────────────────────────

  describe('parseTestOutput (jest)', () => {
    it('extracts total/passed/failed from standard jest output (all pass)', () => {
      const output = [
        'PASS src/utils.test.ts',
        '  ✓ should work (5 ms)',
        '',
        'Test Suites: 1 passed, 1 total',
        'Tests:       6 passed, 6 total',
        'Snapshots:   0 total',
        'Time:        1.234 s',
      ].join('\n');
      const result = parseTestOutput(output, 'jest', 0);
      expect(result.totalTests).toBe(6);
      expect(result.passedTests).toBe(6);
      expect(result.failedTests).toBe(0);
    });

    it('extracts counts when some tests fail', () => {
      const output = [
        'FAIL src/utils.test.ts',
        '  ✓ should work (5 ms)',
        '  ✕ should handle error (12 ms)',
        '',
        'Test Suites: 1 failed, 1 passed, 2 total',
        'Tests:       1 failed, 5 passed, 6 total',
        'Snapshots:   0 total',
        'Time:        2.345 s',
      ].join('\n');
      const result = parseTestOutput(output, 'jest', 1);
      expect(result.totalTests).toBe(6);
      expect(result.passedTests).toBe(5);
      expect(result.failedTests).toBe(1);
    });

    it('handles jest output with only failed count', () => {
      const output = [
        'FAIL src/utils.test.ts',
        '  ✕ should work (5 ms)',
        '',
        'Tests:       1 failed, 1 total',
      ].join('\n');
      const result = parseTestOutput(output, 'jest', 1);
      expect(result.totalTests).toBe(1);
      expect(result.failedTests).toBe(1);
    });

    it('falls back to counting PASS/FAIL when no structured summary', () => {
      const output = [
        'PASS src/a.test.ts',
        'PASS src/b.test.ts',
        'FAIL src/c.test.ts',
      ].join('\n');
      const result = parseTestOutput(output, 'jest', 1);
      expect(result.passedTests).toBeGreaterThan(0);
      expect(result.failedTests).toBeGreaterThan(0);
    });

    it('extracts failed test names from jest output', () => {
      const output = [
        'FAIL src/bad.test.ts',
        '  ● should validate input',
        '',
        '  ● should handle edge case',
        '',
        'Tests:       2 failed, 3 passed, 5 total',
      ].join('\n');
      const result = parseTestOutput(output, 'jest', 1);
      expect(result.failedTestNames).toContain('should validate input');
      expect(result.failedTestNames).toContain('should handle edge case');
    });

    it('returns zeros for empty output', () => {
      const result = parseTestOutput('', 'jest', 0);
      expect(result.totalTests).toBe(0);
      expect(result.passedTests).toBe(0);
      expect(result.failedTests).toBe(0);
    });
  });

  // ── Test Output Parsing: Vitest ──────────────────────────────────────────

  describe('parseTestOutput (vitest)', () => {
    it('extracts total/passed/failed from vitest output (all pass)', () => {
      const output = [
        ' ✓ src/utils.test.ts (1 test) 3ms',
        '',
        ' Test Files  1 passed (1)',
        '      Tests  5 passed (5)',
      ].join('\n');
      const result = parseTestOutput(output, 'vitest', 0);
      expect(result.passedTests).toBe(5);
      expect(result.totalTests).toBe(5);
      expect(result.failedTests).toBe(0);
    });

    it('extracts counts when some tests fail', () => {
      const output = [
        ' ✓ src/utils.test.ts (3 tests) 3ms',
        ' ✗ src/errors.test.ts (2 tests) 5ms',
        '',
        ' Test Files  1 passed, 1 failed (2)',
        '      Tests  1 failed | 3 passed (4)',
      ].join('\n');
      const result = parseTestOutput(output, 'vitest', 1);
      expect(result.totalTests).toBe(4);
      expect(result.passedTests).toBe(3);
      expect(result.failedTests).toBe(1);
    });

    it('extracts failed test names from vitest output', () => {
      const output = [
        ' ✗ should handle timeout (1 test) 5ms',
        ' ✗ should reject invalid input (1 test) 3ms',
        '',
        ' Tests  2 failed (2)',
      ].join('\n');
      const result = parseTestOutput(output, 'vitest', 1);
      expect(result.failedTestNames).toContain('should handle timeout');
      expect(result.failedTestNames).toContain('should reject invalid input');
    });
  });

  // ── Test Output Parsing: Mocha ───────────────────────────────────────────

  describe('parseTestOutput (mocha)', () => {
    it('extracts counts from mocha output', () => {
      const output = [
        '  ✓ should work',
        '  ✓ should handle edge case',
        '  1) should fail',
        '',
        '  2 passing (10ms)',
        '  1 failing',
      ].join('\n');
      const result = parseTestOutput(output, 'mocha', 1);
      expect(result.totalTests).toBe(3);
      expect(result.passedTests).toBe(2);
      expect(result.failedTests).toBe(1);
    });

    it('extracts failed test names from mocha output', () => {
      const output = [
        '  1) should validate input',
        '',
        '  1 passing (5ms)',
        '  1 failing',
      ].join('\n');
      const result = parseTestOutput(output, 'mocha', 1);
      expect(result.failedTestNames).toContain('should validate input');
    });
  });

  // ── Test Output Parsing: Generic ─────────────────────────────────────────

  describe('parseTestOutput (generic)', () => {
    it('parses "X passed, Y failed" generic pattern', () => {
      const output = '5 passed, 2 failed';
      const result = parseTestOutput(output, null, 1);
      expect(result.passedTests).toBe(5);
      expect(result.failedTests).toBe(2);
      expect(result.totalTests).toBe(7);
    });

    it('uses exit code when no pattern matches (exit 0 → all pass)', () => {
      const result = parseTestOutput('All good!', null, 0);
      expect(result.passedTests).toBe(1);
      expect(result.failedTests).toBe(0);
      expect(result.totalTests).toBe(1);
    });

    it('uses exit code when no pattern matches (exit 1 → failed)', () => {
      const result = parseTestOutput('Something went wrong', null, 1);
      expect(result.failedTests).toBe(1);
      expect(result.totalTests).toBe(1);
    });
  });

  // ── parseTestDuration ─────────────────────────────────────────────────────

  describe('parseTestDuration', () => {
    it('extracts duration from vitest output', () => {
      const output = 'Duration 1.23s';
      expect(parseTestDuration(output, 'vitest')).toBe('1.23s');
    });

    it('extracts duration from jest output', () => {
      const output = 'Time:        1.234 s';
      expect(parseTestDuration(output, 'jest')).toBe('1.234 s');
    });

    it('extracts duration from mocha output', () => {
      const output = '2 passing (12ms)';
      expect(parseTestDuration(output, 'mocha')).toBe('12ms');
    });

    it('returns empty string for unmatched output', () => {
      expect(parseTestDuration('no duration here', 'jest')).toBe('');
    });

    it('returns empty string for null framework', () => {
      expect(parseTestDuration('Time: 1s', null)).toBe('');
    });
  });

  // ── Test Execution ───────────────────────────────────────────────────────

  describe('runTests', () => {
    beforeEach(() => resetMocks());

    it('skips when no framework detected', () => {
      mockFs.existsSync.mockReturnValue(false); // no package.json, no config, no bins

      const result = runTests(PROJECT_DIR, null);
      expect(result.skipped).toBe(true);
      expect(result.testGatePassed).toBe(true);
      expect(result.testFramework).toBeNull();
      expect(result.skipReason).toBe('No test framework detected');
    });

    it('executes tests and returns parsed results on success', () => {
      // Make framework detection find jest via node_modules/.bin
      mockFs.existsSync.mockImplementation((p: string) => {
        // For hasBinaryInNodeModules check: node_modules/.bin/jest
        if (p.endsWith(path.join('node_modules', '.bin', 'jest'))) return true;
        return false;
      });

      mockExecSync.mockReturnValue([
        'PASS src/utils.test.ts',
        'Tests:       5 passed, 5 total',
        'Time:        1.0 s',
      ].join('\n'));

      const result = runTests(PROJECT_DIR, null);
      expect(result.skipped).toBe(false);
      expect(result.testFramework).toBe('jest');
      expect(result.totalTests).toBe(5);
      expect(result.passedTests).toBe(5);
      expect(result.failedTests).toBe(0);
      expect(result.testGatePassed).toBe(true);
      expect(mockExecSync).toHaveBeenCalledTimes(1);
    });

    it('uses CLI command override', () => {
      mockExecSync.mockReturnValue('All tests passed!');

      const result = runTests(PROJECT_DIR, 'npx jest');
      expect(result.skipped).toBe(false);
      expect(result.testCommand).toBe('npx jest');
      expect(mockExecSync).toHaveBeenCalledWith(
        'npx jest',
        expect.objectContaining({ cwd: PROJECT_DIR }),
      );
    });

    it('handles test failures (exit code 1) by parsing output', () => {
      mockFs.existsSync.mockImplementation((p: string) => {
        if (p.endsWith(path.join('node_modules', '.bin', 'jest'))) return true;
        return false;
      });

      const error: any = new Error('Command failed');
      error.status = 1;
      error.stdout = [
        'FAIL src/bad.test.ts',
        '  ● should validate',
        '',
        'Tests:       1 failed, 4 passed, 5 total',
      ].join('\n');
      error.stderr = '';
      mockExecSync.mockImplementation(() => { throw error; });

      const result = runTests(PROJECT_DIR, null);
      expect(result.testGatePassed).toBe(false);
      expect(result.failedTests).toBe(1);
      expect(result.passedTests).toBe(4);
      expect(result.totalTests).toBe(5);
      expect(result.exitCode).toBe(1);
    });

    it('handles timeout gracefully', () => {
      const error: any = new Error('Command timed out');
      error.killed = true;
      error.signal = 'SIGTERM';
      error.stdout = '';
      error.stderr = '';
      mockExecSync.mockImplementation(() => { throw error; });
      mockFs.existsSync.mockImplementation((p: string) => {
        if (p.endsWith(path.join('node_modules', '.bin', 'jest'))) return true;
        return false;
      });

      const result = runTests(PROJECT_DIR, null, 100);
      expect(result.exitCode).toBe(1);
      expect(result.testFramework).toBe('jest');
      expect(result.output).toContain('timed out');
    });

    it('handles command not found error', () => {
      const error: any = new Error('spawn npx ENOENT');
      error.code = 'ENOENT';
      error.status = null;
      error.stdout = '';
      error.stderr = 'spawn npx ENOENT';
      mockExecSync.mockImplementation(() => { throw error; });
      mockFs.existsSync.mockImplementation((p: string) => {
        if (p.endsWith(path.join('node_modules', '.bin', 'jest'))) return true;
        return false;
      });

      const result = runTests(PROJECT_DIR, null);
      expect(result.exitCode).toBe(1);
      expect(result.testGatePassed).toBe(false);
      // Output should contain stderr
      expect(result.output).toContain('ENOENT');
    });

    it('skips when test runner binary not installed', () => {
      mockFs.existsSync.mockImplementation((p: string) => {
        // detectTestFramework finds jest via scripts.test...
        // But isTestRunnerInstalled checks for binary and returns false
        return false;
      });
      const pkg = { scripts: { test: 'jest' } };
      // Override detectTestFramework behavior via mocking existsSync
      // The detectTestFramework will find "jest" in scripts.test
      mockFs.readFileSync.mockReturnValue(JSON.stringify(pkg));

      // make package.json exist to trigger framework detection
      mockFs.existsSync.mockImplementation((p: string) => {
        if (p.endsWith('package.json')) return true;
        return false;
      });

      const result = runTests(PROJECT_DIR, null);
      // framework detected but binary not installed
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain('not installed');
    });
  });

  // ── End-to-End Flow (mocked) ─────────────────────────────────────────────

  describe('end-to-end flow', () => {
    beforeEach(() => resetMocks());

    it('detects vitest and runs tests with all passing', () => {
      // Framework detection: vitest from scripts.test
      mockFs.existsSync.mockImplementation((p: string) => {
        if (p.endsWith('package.json')) return true;
        if (p.endsWith(path.join('node_modules', '.bin', 'vitest'))) return true;
        return false;
      });
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        scripts: { test: 'vitest run' },
      }));

      mockExecSync.mockReturnValue([
        ' ✓ src/utils.test.ts (1 test) 3ms',
        '',
        ' Test Files  1 passed (1)',
        '      Tests  5 passed (5)',
      ].join('\n'));

      const result = runTests(PROJECT_DIR, null);
      expect(result.testGatePassed).toBe(true);
      expect(result.testFramework).toBe('vitest');
      expect(result.totalTests).toBe(5);
      expect(result.passedTests).toBe(5);
      expect(result.failedTests).toBe(0);
      expect(result.exitCode).toBe(0);
    });

    it('detects jest and handles some tests failing', () => {
      mockFs.existsSync.mockImplementation((p: string) => {
        if (p.endsWith('package.json')) return true;
        if (p.endsWith(path.join('node_modules', '.bin', 'jest'))) return true;
        return false;
      });
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        scripts: { test: 'jest --coverage' },
      }));

      const error: any = new Error('Tests failed');
      error.status = 1;
      error.stdout = [
        'FAIL src/bad.test.ts',
        'Tests:       2 failed, 3 passed, 5 total',
      ].join('\n');
      error.stderr = '';
      mockExecSync.mockImplementation(() => { throw error; });

      const result = runTests(PROJECT_DIR, null);
      expect(result.testGatePassed).toBe(false);
      expect(result.failedTests).toBe(2);
      expect(result.passedTests).toBe(3);
      expect(result.totalTests).toBe(5);
      expect(result.exitCode).toBe(1);
    });

    it('returns skipped when no framework found', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = runTests(PROJECT_DIR, null);
      expect(result.skipped).toBe(true);
      expect(result.testFramework).toBeNull();
    });
  });
});
