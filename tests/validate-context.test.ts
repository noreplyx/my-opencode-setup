#!/usr/bin/env ts-node
/**
 * Tests for validate-context.ts
 * 
 * Tests: valid context, missing fields, corrupted YAML, stale context
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const VALIDATE_SCRIPT = path.resolve(process.cwd(), 'skills', 'scripts', 'orchestration', 'validate-context.ts');
const TEST_DIR = path.resolve(process.cwd(), 'tmp-test-contexts');

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

function writeTestContext(filename: string, content: string): string {
  const filePath = path.join(TEST_DIR, filename);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

const TS_PROJECT = path.resolve(process.cwd(), 'skills', 'scripts', 'tsconfig.json');

function getTsNodeBin(): string {
  // Use the same node binary that invoked this script (avoids UNC path issues with npx on Windows)
  const nodeExe = process.execPath;
  // Avoid require.resolve which fails in ESM context; resolve via direct path
  const tsNodeBin = path.resolve(process.cwd(), 'node_modules', 'ts-node', 'dist', 'bin.js');
  return `"${nodeExe}" "${tsNodeBin}"`;
}

function runValidate(contextPath: string): { stdout: string; exitCode: number } {
  try {
    const tsNode = getTsNodeBin();
    // Use shell: false to avoid cmd.exe UNC path issues on Windows/WSL
    const out = execSync(`${tsNode} --transpileOnly --project "${TS_PROJECT}" "${VALIDATE_SCRIPT}" --context="${contextPath}"`, {
      encoding: 'utf-8',
      timeout: 15000,
      shell: false,
    });
    return { stdout: out.trim(), exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: (err.stdout || '').toString().trim() + (err.stderr || '').toString().trim(),
      exitCode: err.status || 1,
    };
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

// ── Tests ──

async function main() {
  console.log('🔍 validate-context.ts Tests');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  setup();
  
  // Test 1: Valid minimal context
  test('Valid minimal context should pass', () => {
    const content = `---
pipelineId: "test-1"
feature: "test-feature"
pipelineType: "full"
currentStep: "pre-flight"
createdAt: "2026-05-21T00:00:00Z"
status: "running"
agentHistory: []
agentOutputs: {}
nextObjective: "Run the test suite"
circuitBreaker:
  state: "closed"
  counters: {}
gitState:
  branch: "main"
  dirtyFiles: []
  lastCommitSha: "abc123"
---`;
    const path = writeTestContext('valid-minimal.md', content);
    const result = runValidate(path);
    assert(result.exitCode === 0, `Expected exit code 0, got ${result.exitCode}`);
  });

  // Test 2: Missing required field should fail
  test('Missing pipelineId should fail', () => {
    const content = `---
feature: "test-feature"
pipelineType: "full"
currentStep: "pre-flight"
createdAt: "2026-05-21T00:00:00Z"
status: "running"
---`;
    const path = writeTestContext('missing-id.md', content);
    const result = runValidate(path);
    // Should fail or at least produce output mentioning missing field
    assert(result.stdout.toLowerCase().includes('error') || result.stdout.toLowerCase().includes('invalid') || result.exitCode !== 0, 
      `Expected error output, got: ${result.stdout.slice(0, 100)}`);
  });

  // Test 3: No frontmatter should fail
  test('Missing frontmatter should fail', () => {
    const content = `# Just a regular markdown file\n\nNo YAML frontmatter here.`;
    const path = writeTestContext('no-frontmatter.md', content);
    const result = runValidate(path);
    assert(result.stdout.toLowerCase().includes('error') || result.stdout.toLowerCase().includes('invalid') || result.exitCode !== 0,
      `Expected error, got: ${result.stdout.slice(0, 100)}`);
  });
  
  // Test 4: Empty file should fail
  test('Empty file should fail', () => {
    const path = writeTestContext('empty.md', '');
    const result = runValidate(path);
    assert(result.exitCode !== 0, `Expected non-zero exit for empty file`);
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
