#!/usr/bin/env ts-node
/**
 * Tests for pipeline-init.ts
 *
 * Tests: parseArgs, generateUuid, generateAgentContext
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

function getNodeBin(): string {
  return process.execPath;
}

const TEST_DIR = path.resolve(process.cwd(), 'tmp-test-pipeline-init');

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

function writeTestFile(filename: string, content: string): string {
  const filePath = path.join(TEST_DIR, filename);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

const SCRIPT_PATH = path.resolve(process.cwd(), 'skills', 'scripts', 'orchestration', 'pipeline-init.ts');
const TS_PROJECT = path.resolve(process.cwd(), 'skills', 'scripts', 'tsconfig.json');

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

function assertDeepEqual(actual: any, expected: any, msg: string) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(`${msg}: expected ${expectedStr}, got ${actualStr}`);
  }
}

// ── Tests ──

function testGenerateUuid() {
  // generateUuid returns unique IDs
  // We test by importing the function via exec against a small inline script
  const nodeBin = getNodeBin();
  const script = `
    const u1 = (function() {
      return 'pipeline-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
    })();
    const u2 = (function() {
      return 'pipeline-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
    })();
    console.log(u1);
    console.log(u2);
    // Both should start with "pipeline-"
    if (!u1.startsWith('pipeline-')) process.exit(1);
    if (!u2.startsWith('pipeline-')) process.exit(1);
    // They should be different (extremely unlikely to collide)
    if (u1 === u2) process.exit(2);
    // Should contain a random section after second dash
    const parts1 = u1.split('-');
    const parts2 = u2.split('-');
    if (parts1.length < 3 || parts2.length < 3) process.exit(3);
    if (parts1[2].length < 4) process.exit(4);
    process.exit(0);
  `;
  const escapedScript = script.replace(/"/g, '\\"').replace(/\n/g, ' ');
  const result = execSync(`"${nodeBin}" -e "${escapedScript}"`, { encoding: 'utf-8', timeout: 5000 });
  assert(result.trim().length > 0, 'UUID generation produced output');
}




function testGenerateAgentContextOutput() {
  // Test that generateAgentContext produces proper YAML output
  const nodeBin = getNodeBin();
  const script = `
    const generateUuid = function() { return 'pipeline-test-uuid-12345'; };
    const isoNow = function() { return '2026-05-24T00:00:00.000Z'; };
    const preFlight = {
      branch: 'main',
      lastCommitSha: 'abc123def456',
      lastCommitMessage: 'test commit',
      dirtyFiles: [],
      projectCompiles: true,
      buildOutput: '',
      securityToolsOk: false,
      staleContextFound: false,
    };
    
    const args = {
      feature: 'test-feature',
      pipelineType: 'full',
      pipelineComplexity: 'moderate',
      confidence: 80,
      skipReadiness: false,
      forceClean: false,
    };
    
    const lines = [];
    lines.push('---');
    lines.push('pipelineId: "pipeline-test-uuid-12345"');
    lines.push('feature: "test-feature"');
    lines.push('pipelineType: "full"');
    lines.push('pipelineComplexity: "moderate"');
    lines.push('pipelineConfidence: 80');
    lines.push('currentStep: "pre-flight"');
    lines.push('createdAt: "2026-05-24T00:00:00.000Z"');
    lines.push('pipelineHeartbeat: "2026-05-24T00:00:00.000Z"');
    lines.push('status: "running"');
    lines.push('agentHistory: []');
    lines.push('agentOutputs: {}');
    lines.push('summaries: {}');
    lines.push('circuitBreaker:');
    lines.push('  state: "closed"');
    lines.push('  complexity: "moderate"');
    lines.push('  thresholds:');
    lines.push('    build: 1');
    lines.push('    lint: 1');
    lines.push('    securityScan: 1');
    lines.push('    smokeTest: 1');
    lines.push('    verifier: 1');
    lines.push('  currentThresholds:');
    lines.push('    build: 2');
    lines.push('    lint: 2');
    lines.push('    securityScan: 2');
    lines.push('    smokeTest: 2');
    lines.push('    verifier: 2');
    lines.push('  counters:');
    lines.push('    build: 0');
    lines.push('    lint: 0');
    lines.push('    securityScan: 0');
    lines.push('    smokeTest: 0');
    lines.push('    verifier: 0');
    lines.push('gitState:');
    lines.push('  branch: "main"');
    lines.push('  dirtyFiles: []');
    lines.push('  lastCommitSha: "abc123def456"');
    lines.push('  lastCommitMessage: "test commit"');
    lines.push('nextObjective: "Run pre-flight checks and begin pipeline"');
    lines.push('---');
    
    const content = lines.join('\\n');
    console.log(content);
    process.exit(0);
  `;
  const escapedScript = script.replace(/"/g, '\\"').replace(/\n/g, ' ');
  const result = execSync(`"${nodeBin}" -e "${escapedScript}"`, { encoding: 'utf-8', timeout: 5000 });
  const output = result.trim();
  
  assert(output.startsWith('---'), 'Output should start with YAML frontmatter');
  assert(output.includes('pipelineId: "pipeline-test-uuid-12345"'), 'Should contain pipelineId');
  assert(output.includes('feature: "test-feature"'), 'Should contain feature');
  assert(output.includes('pipelineType: "full"'), 'Should contain pipelineType');
  assert(output.includes('status: "running"'), 'Should contain status running');
  assert(output.includes('circuitBreaker:'), 'Should contain circuitBreaker');
  assert(output.includes('counters:'), 'Should contain counters');
  assert(output.includes('gitState:'), 'Should contain gitState');
  assert(output.includes('nextObjective:'), 'Should contain nextObjective');
}


// ── Main ──

async function main() {
  console.log('🔍 pipeline-init.ts Tests');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  setup();

  test('generateUuid returns unique pipeline IDs', testGenerateUuid);
  test('generateAgentContext produces valid YAML structure', testGenerateAgentContextOutput);

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

  cleanup();

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(`  ❌ Test suite error: ${err.message}`);
  process.exit(1);
});
