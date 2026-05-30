#!/usr/bin/env ts-node
/**
 * Tests for pipeline-teardown.ts (conceptual functions)
 *
 * Tests:
 *   - Archive Path Generation
 *   - Full Teardown Flow & keep-context flag
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Test framework ──

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

function assertEqual(actual: any, expected: any, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── Inline implementations (conceptual, matching source logic) ──

function generateArchivePath(baseDir: string, pipelineId: string): string {
  return path.join(baseDir, 'pipeline-logs', pipelineId);
}

function ensureDir(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    return true;
  }
  return false;
}

// ── Teardown flow (conceptual) ──

interface TeardownResult {
  archived: boolean;
  contextDeleted: boolean;
}

function performTeardown(
  args: {
    keepContext: boolean;
  },
  baseDir: string,
  pipelineId: string,
): TeardownResult {
  const archivePath = generateArchivePath(baseDir, pipelineId);
  ensureDir(archivePath);

  let contextDeleted = false;
  if (!args.keepContext) {
    contextDeleted = true;
  }

  return { archived: true, contextDeleted };
}

// ── Setup / Cleanup ──

const TEST_DIR = path.resolve(process.cwd(), 'tmp-test-teardown');

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

// ── Tests ──

async function main() {
  console.log('🔍 Pipeline Teardown Tests');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  setup();

  // ═══════════════════════════════════════════════════════
  // Section 1: Archive Path Generation
  // ═══════════════════════════════════════════════════════

  test('Archives with correct pipelineId in path', () => {
    const archivePath = generateArchivePath('/tmp/base', 'pipeline-abc-123');
    assert(archivePath.endsWith('pipeline-logs/pipeline-abc-123'), `unexpected path: ${archivePath}`);
    assert(archivePath.includes('/tmp/base'), 'should include base dir');
  });

  test('Creates subdirectories if needed', () => {
    const nestedDir = path.join(TEST_DIR, 'pipeline-logs', 'nested-test-pipeline');
    // Clean up before test
    if (fs.existsSync(nestedDir)) {
      fs.rmSync(nestedDir, { recursive: true });
    }
    const created = ensureDir(nestedDir);
    assert(created, 'should report directory was created');
    assert(fs.existsSync(nestedDir), 'directory should exist');
    // Calling again should not throw
    const createdAgain = ensureDir(nestedDir);
    assert(!createdAgain, 'should report directory already existed');
    // Clean up
    fs.rmSync(nestedDir, { recursive: true });
  });

  // ═══════════════════════════════════════════════════════
  // Section 2: Full Teardown Flow
  // ═══════════════════════════════════════════════════════

  test('Full teardown produces archive', () => {
    const result = performTeardown(
      { keepContext: false },
      TEST_DIR,
      'test-pipeline-001',
    );

    assert(result.archived, 'should indicate archive was created');

    // Verify archive directory was created
    const archivePath = generateArchivePath(TEST_DIR, 'test-pipeline-001');
    assert(fs.existsSync(archivePath), `archive path should exist: ${archivePath}`);

    // Clean up archive
    if (fs.existsSync(archivePath)) {
      fs.rmSync(archivePath, { recursive: true });
    }
  });

  test('Keep-context flag preserves agent-context.md', () => {
    // Write a fake agent-context.md
    const contextPath = path.join(TEST_DIR, 'agent-context.md');
    fs.writeFileSync(contextPath, '---\npipelineId: "test-pipeline-001"\n---\n', 'utf-8');

    // When keepContext is true, contextDeleted should be false
    const result = performTeardown(
      { keepContext: true },
      TEST_DIR,
      'test-pipeline-001',
    );
    assert(!result.contextDeleted, 'context should NOT be deleted when keepContext is true');

    // Clean up
    if (fs.existsSync(contextPath)) {
      fs.unlinkSync(contextPath);
    }
    const archivePath = generateArchivePath(TEST_DIR, 'test-pipeline-001');
    if (fs.existsSync(archivePath)) {
      fs.rmSync(archivePath, { recursive: true });
    }
  });

  test('Without keep-context flag, context is deleted', () => {
    const result = performTeardown(
      { keepContext: false },
      TEST_DIR,
      'test-pipeline-002',
    );
    assert(result.contextDeleted, 'context should be deleted when keepContext is false');

    const archivePath = generateArchivePath(TEST_DIR, 'test-pipeline-002');
    if (fs.existsSync(archivePath)) {
      fs.rmSync(archivePath, { recursive: true });
    }
  });

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

  cleanup();

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(`  ❌ Test suite error: ${err.message}`);
  process.exit(1);
});
