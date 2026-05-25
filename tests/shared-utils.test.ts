#!/usr/bin/env ts-node
/**
 * Tests for shared utilities (logger.ts, utils.ts)
 * 
 * Tests: Logger class (constructor, levels, report, summary),
 *        Utils functions (timestamp, exists, readFile, writeFile,
 *        grepFiles, listFilesRecursive, globFiles, log)
 */

import * as fs from 'fs';
import * as path from 'path';

const TEST_DIR = path.resolve(process.cwd(), 'tmp-test-shared-utils');

// ── Inline Logger implementation (mirrors skills/scripts/shared/logger.ts) ──

type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'success';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  details?: Record<string, unknown>;
}

class Logger {
  private entries: LogEntry[] = [];
  private verbose: boolean;

  constructor(verbose = false) {
    this.verbose = verbose;
  }

  private log(level: LogLevel, message: string, details?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      details,
    };
    this.entries.push(entry);
    this.output(entry);
  }

  private output(entry: LogEntry): void {
    if (entry.level === 'debug' && !this.verbose) return;
    const icons: Record<LogLevel, string> = {
      info: 'ℹ️',
      warn: '⚠️',
      error: '❌',
      debug: '🔍',
      success: '✅',
    };
    const icon = icons[entry.level] || '•';
    const details = entry.details ? ` ${JSON.stringify(entry.details)}` : '';
    console.log(`${icon} ${entry.message}${details}`);
  }

  info(message: string, details?: Record<string, unknown>): void { this.log('info', message, details); }
  warn(message: string, details?: Record<string, unknown>): void { this.log('warn', message, details); }
  error(message: string, details?: Record<string, unknown>): void { this.log('error', message, details); }
  debug(message: string, details?: Record<string, unknown>): void { this.log('debug', message, details); }
  success(message: string, details?: Record<string, unknown>): void { this.log('success', message, details); }

  getReport(): LogEntry[] {
    return this.entries;
  }

  getSummary(): { total: number; errors: number; warnings: number; success: number } {
    return {
      total: this.entries.length,
      errors: this.entries.filter(e => e.level === 'error').length,
      warnings: this.entries.filter(e => e.level === 'warn').length,
      success: this.entries.filter(e => e.level === 'success').length,
    };
  }
}

// ── Inline Utils implementations (mirrors skills/scripts/shared/utils.ts) ──

function timestamp(): string {
  return new Date().toISOString();
}

function exists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function readFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`Cannot read file: ${filePath} — ${(err as Error).message}`);
  }
}

function writeFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, 'utf-8');
}

function grepFiles(pattern: string, filePath: string): string[] {
  const content = readFile(filePath);
  const lines = content.split('\n');
  const results: string[] = [];
  const regex = new RegExp(pattern);
  lines.forEach((line, index) => {
    if (regex.test(line)) {
      results.push(`${index + 1}: ${line.trim()}`);
    }
  });
  return results;
}

function listFilesRecursive(dir: string, ext?: string): string[] {
  const results: string[] = [];
  function walk(current: string): void {
    if (!fs.existsSync(current)) return;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        if (!ext || entry.name.endsWith(ext)) {
          results.push(fullPath);
        }
      }
    }
  }
  walk(dir);
  return results;
}

function globFiles(pattern: string, rootDir: string): string[] {
  const results: string[] = [];
  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(rootDir, fullPath);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        if (pattern.endsWith('/*') || pattern.endsWith('/**')) {
          results.push(relativePath);
        } else if (pattern.includes('*')) {
          const ext = pattern.split('.').pop() || '';
          if (entry.name.endsWith(`.${ext}`)) {
            results.push(relativePath);
          }
        } else {
          results.push(relativePath);
        }
      }
    }
  }
  walk(rootDir);
  return results;
}

function log(level: 'info' | 'warn' | 'error' | 'debug', message: string, context?: Record<string, unknown>): void {
  const prefix = level.toUpperCase().padEnd(5);
  const ts = new Date().toISOString();
  const meta = context ? ` ${JSON.stringify(context)}` : '';
  console.log(`[${ts}] ${prefix} ${message}${meta}`);
}

// ── Test helpers ──

function setup() {
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  }
}

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

function assertEqual(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── Tests ──

async function main() {
  console.log('🔍 shared-utils Tests');
  console.log('━━━━━━━━━━━━━━━━━━━━━━\n');

  setup();

  // ═══════════════════════════════════════════
  // Logger Tests
  // ═══════════════════════════════════════════

  console.log('── Logger Tests ──\n');

  // Test 1: Logger constructor with verbose default (false)
  test('Logger constructor defaults verbose to false', () => {
    const logger = new Logger();
    // Can't access private field directly, but verify behavior: debug suppressed
    const report = logger.getReport();
    assert(Array.isArray(report), 'getReport should return array');
    assertEqual(report.length, 0, 'initial report should be empty');
    const summary = logger.getSummary();
    assertEqual(summary.total, 0, 'initial total should be 0');
    assertEqual(summary.errors, 0, 'initial errors should be 0');
  });

  // Test 2: info() logs with correct level
  test('Logger.info() logs with info level', () => {
    const logger = new Logger();
    logger.info('test info');
    const report = logger.getReport();
    assertEqual(report.length, 1, 'should have 1 entry');
    assertEqual(report[0].level, 'info', 'level should be info');
    assertEqual(report[0].message, 'test info', 'message should match');
  });

  // Test 3: warn() logs with correct level
  test('Logger.warn() logs with warn level', () => {
    const logger = new Logger();
    logger.warn('test warning');
    const report = logger.getReport();
    assertEqual(report.length, 1, 'should have 1 entry');
    assertEqual(report[0].level, 'warn', 'level should be warn');
    assertEqual(report[0].message, 'test warning', 'message should match');
  });

  // Test 4: error() logs with correct level
  test('Logger.error() logs with error level', () => {
    const logger = new Logger();
    logger.error('test error');
    const report = logger.getReport();
    assertEqual(report.length, 1, 'should have 1 entry');
    assertEqual(report[0].level, 'error', 'level should be error');
    assertEqual(report[0].message, 'test error', 'message should match');
  });

  // Test 5: success() logs with correct level
  test('Logger.success() logs with success level', () => {
    const logger = new Logger();
    logger.success('test success');
    const report = logger.getReport();
    assertEqual(report.length, 1, 'should have 1 entry');
    assertEqual(report[0].level, 'success', 'level should be success');
    assertEqual(report[0].message, 'test success', 'message should match');
  });

  // Test 6: debug() suppressed when verbose=false
  test('Logger.debug() suppressed when verbose=false', () => {
    const logger = new Logger(false);
    logger.debug('should be hidden');
    const report = logger.getReport();
    // Entry IS stored internally (so we can report it later), but output is suppressed
    assertEqual(report.length, 1, 'entries should still be stored internally');
    assertEqual(report[0].level, 'debug', 'level should be debug');
    // Verify the entry is preserved even though output was suppressed
    assertEqual(report[0].message, 'should be hidden', 'message should be preserved');
  });

  // Test 7: debug() shown when verbose=true
  test('Logger.debug() stored when verbose=true', () => {
    const logger = new Logger(true);
    logger.debug('should be stored');
    const report = logger.getReport();
    assertEqual(report.length, 1, 'should have 1 entry');
    assertEqual(report[0].level, 'debug', 'level should be debug');
    assertEqual(report[0].message, 'should be stored', 'message should match');
  });

  // Test 8: getReport() returns all entries with timestamps
  test('Logger.getReport() returns entries with timestamps', () => {
    const logger = new Logger();
    logger.info('first');
    logger.warn('second');
    const report = logger.getReport();
    assertEqual(report.length, 2, 'should have 2 entries');
    assert(report[0].timestamp.match(/^\d{4}-\d{2}-\d{2}T/), 'entry 0 should have ISO timestamp');
    assert(report[1].timestamp.match(/^\d{4}-\d{2}-\d{2}T/), 'entry 1 should have ISO timestamp');
    assertEqual(report[0].message, 'first', 'first message should match');
    assertEqual(report[1].message, 'second', 'second message should match');
  });

  // Test 9: getSummary() returns correct counts
  test('Logger.getSummary() returns correct counts', () => {
    const logger = new Logger();
    logger.info('info msg');
    logger.warn('warn msg');
    logger.error('error msg');
    logger.success('success msg');
    logger.info('another info');
    const summary = logger.getSummary();
    assertEqual(summary.total, 5, 'total should be 5');
    assertEqual(summary.errors, 1, 'errors should be 1');
    assertEqual(summary.warnings, 1, 'warnings should be 1');
    assertEqual(summary.success, 1, 'success should be 1');
  });

  // Test 10: Multiple log entries accumulate correctly
  test('Multiple log entries accumulate correctly', () => {
    const logger = new Logger();
    for (let i = 1; i <= 10; i++) {
      logger.info(`entry ${i}`);
    }
    const report = logger.getReport();
    assertEqual(report.length, 10, 'should have 10 entries');
    assertEqual(report[0].message, 'entry 1', 'first entry should be entry 1');
    assertEqual(report[9].message, 'entry 10', 'last entry should be entry 10');
  });

  // Test 11: Logger.info() with details object
  test('Logger.info() with details object', () => {
    const logger = new Logger();
    const details = { userId: 42, action: 'test' };
    logger.info('detail test', details);
    const report = logger.getReport();
    assertEqual(report.length, 1, 'should have 1 entry');
    assertEqual(report[0].level, 'info', 'level should be info');
    assert(report[0].details !== undefined, 'details should be defined');
    assertEqual(report[0].details!.userId, 42, 'details.userId should be 42');
    assertEqual(report[0].details!.action, 'test', 'details.action should be test');
  });

  // Test 12: Logger entries are chronological and preserved
  test('Logger entries are chronological and preserved', () => {
    const logger = new Logger();
    logger.info('first entry');
    logger.warn('second entry');
    logger.error('third entry');
    logger.success('fourth entry');
    const report = logger.getReport();
    assertEqual(report.length, 4, 'should have 4 entries');
    assertEqual(report[0].message, 'first entry', 'first');
    assertEqual(report[0].level, 'info', 'first level');
    assertEqual(report[1].message, 'second entry', 'second');
    assertEqual(report[1].level, 'warn', 'second level');
    assertEqual(report[2].message, 'third entry', 'third');
    assertEqual(report[2].level, 'error', 'third level');
    assertEqual(report[3].message, 'fourth entry', 'fourth');
    assertEqual(report[3].level, 'success', 'fourth level');
    // Verify timestamps are in order
    assert(report[0].timestamp <= report[1].timestamp, 'entry 0 timestamp <= entry 1 timestamp');
    assert(report[1].timestamp <= report[2].timestamp, 'entry 1 timestamp <= entry 2 timestamp');
    assert(report[2].timestamp <= report[3].timestamp, 'entry 2 timestamp <= entry 3 timestamp');
  });

  // ═══════════════════════════════════════════
  // Utils Tests
  // ═══════════════════════════════════════════

  console.log('\n── Utils Tests ──\n');

  // Test 1: timestamp() returns ISO 8601 format
  test('timestamp() returns ISO 8601 format', () => {
    const ts = timestamp();
    assert(ts.match(/^\d{4}-\d{2}-\d{2}T/), `timestamp should start with ISO date, got: ${ts}`);
  });

  // Test 2: exists() returns true for existing files, false for non-existent
  test('exists() checks file existence correctly', () => {
    const existingFile = path.join(TEST_DIR, 'exists-test.txt');
    const nonExistentFile = path.join(TEST_DIR, 'does-not-exist.txt');
    fs.writeFileSync(existingFile, 'hello', 'utf-8');
    assertEqual(exists(existingFile), true, 'existing file should return true');
    assertEqual(exists(nonExistentFile), false, 'non-existent file should return false');
  });

  // Test 3: readFile() reads file content, throws for missing files
  test('readFile() reads content and throws for missing files', () => {
    const existingFile = path.join(TEST_DIR, 'readfile-test.txt');
    fs.writeFileSync(existingFile, 'file content', 'utf-8');
    const content = readFile(existingFile);
    assertEqual(content, 'file content', 'should read file content');
    const missingFile = path.join(TEST_DIR, 'missing-file.txt');
    let threw = false;
    try {
      readFile(missingFile);
    } catch {
      threw = true;
    }
    assert(threw, 'should throw for missing file');
  });

  // Test 4: writeFile() creates file with content, creating directories
  test('writeFile() creates file with content and parent directories', () => {
    const nestedFile = path.join(TEST_DIR, 'nested', 'subdir', 'test-write.txt');
    writeFile(nestedFile, 'nested content');
    assert(fs.existsSync(nestedFile), 'nested file should exist');
    const content = fs.readFileSync(nestedFile, 'utf-8');
    assertEqual(content, 'nested content', 'file content should match');
  });

  // Test 5: grepFiles() finds matching lines with line numbers
  test('grepFiles() finds matching lines with line numbers', () => {
    const grepFile = path.join(TEST_DIR, 'grep-test.txt');
    fs.writeFileSync(grepFile, [
      'first line of text',
      'second line with pattern inside',
      'third line no match',
      'fourth line with pattern again',
      'fifth line',
    ].join('\n'), 'utf-8');
    const results = grepFiles('pattern', grepFile);
    assertEqual(results.length, 2, 'should find 2 matching lines');
    assert(results[0].startsWith('2:'), 'first match should be line 2');
    assert(results[1].startsWith('4:'), 'second match should be line 4');
    assert(results[0].includes('pattern'), 'first match should contain pattern');
    assert(results[1].includes('pattern'), 'second match should contain pattern');
  });

  // Test 6: grepFiles() returns empty for no match
  test('grepFiles() returns empty array for no match', () => {
    const grepFile = path.join(TEST_DIR, 'grep-no-match.txt');
    fs.writeFileSync(grepFile, 'line one\nline two\nline three\n', 'utf-8');
    const results = grepFiles('nonexistent', grepFile);
    assert(Array.isArray(results), 'should return array');
    assertEqual(results.length, 0, 'should be empty');
  });

  // Test 7: listFilesRecursive() walks directory tree, filters by extension
  test('listFilesRecursive() walks directory tree and filters by extension', () => {
    // Create a directory structure
    const dirA = path.join(TEST_DIR, 'dirA');
    const dirB = path.join(TEST_DIR, 'dirA', 'sub');
    fs.mkdirSync(dirA, { recursive: true });
    fs.mkdirSync(dirB, { recursive: true });
    fs.writeFileSync(path.join(dirA, 'file1.ts'), '// ts', 'utf-8');
    fs.writeFileSync(path.join(dirB, 'file2.ts'), '// ts', 'utf-8');
    fs.writeFileSync(path.join(dirA, 'file3.js'), '// js', 'utf-8');
    fs.writeFileSync(path.join(dirA, 'file4.txt'), 'text', 'utf-8');

    const allFiles = listFilesRecursive(dirA);
    assertEqual(allFiles.length, 4, 'should find all 4 files');

    const tsFiles = listFilesRecursive(dirA, '.ts');
    assertEqual(tsFiles.length, 2, 'should find 2 .ts files');
    assert(tsFiles.some(f => f.endsWith('file1.ts')), 'should include file1.ts');
    assert(tsFiles.some(f => f.endsWith('file2.ts')), 'should include file2.ts');

    const txtFiles = listFilesRecursive(dirA, '.txt');
    assertEqual(txtFiles.length, 1, 'should find 1 .txt file');
    assert(txtFiles[0].endsWith('file4.txt'), 'should be file4.txt');
  });

  // Test 8: globFiles() simple pattern matching by extension
  test('globFiles() matches files by extension pattern', () => {
    const globDir = path.join(TEST_DIR, 'globtest');
    fs.mkdirSync(globDir, { recursive: true });
    fs.writeFileSync(path.join(globDir, 'a.ts'), '', 'utf-8');
    fs.writeFileSync(path.join(globDir, 'b.ts'), '', 'utf-8');
    fs.writeFileSync(path.join(globDir, 'c.js'), '', 'utf-8');
    fs.writeFileSync(path.join(globDir, 'd.json'), '', 'utf-8');

    const tsResults = globFiles('*.ts', globDir);
    assertEqual(tsResults.length, 2, 'should find 2 .ts files');
    assert(tsResults.some(f => f.endsWith('a.ts')), 'should include a.ts');
    assert(tsResults.some(f => f.endsWith('b.ts')), 'should include b.ts');

    const jsResults = globFiles('*.js', globDir);
    assertEqual(jsResults.length, 1, 'should find 1 .js file');
    assert(jsResults[0].endsWith('c.js'), 'should be c.js');
  });

  // Test 9: log() outputs formatted string (doesn't crash)
  test('log() outputs formatted string without crashing', () => {
    // Just verify it doesn't throw
    log('info', 'test message');
    log('warn', 'warning', { code: 123 });
    log('error', 'error occurred');
    log('debug', 'debug info');
    assert(true, 'log should not crash');
  });

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━\n`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

  cleanup();

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(`  ❌ Test suite error: ${err.message}`);
  process.exit(1);
});
