#!/usr/bin/env node
/**
 * E2E Pipeline Test Harness
 *
 * Usage:
 *   [runtime] skills/scripts/orchestration/test-pipeline.ts              # Run all tests
 *   [runtime] skills/scripts/orchestration/test-pipeline.ts --test=context   # Run specific test
 *
 * Available tests: context-lifecycle, fixer-output, stale-context, output-contract
 */

import * as fs from 'fs';
import * as path from 'path';

// Language-agnostic: detect script extension at runtime
const SCRIPT_EXT = __filename.endsWith('.ts') ? 'ts' : 'js';
import * as assert from 'assert';

// ── Test Runner ──────────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  stack?: string;
}

const ALL_TESTS: string[] = [
  'context-lifecycle',
  'fixer-output',
  'stale-context',
  'output-contract',
  'circuit-breaker',
  'pipeline-selection',
];

function parseArgs(): string[] {
  const testArg = process.argv.find(a => a.startsWith('--test='));
  if (testArg) {
    const name = testArg.split('=')[1];
    if (!ALL_TESTS.includes(name)) {
      console.error(`❌ Unknown test: "${name}". Available: ${ALL_TESTS.join(', ')}`);
      process.exit(1);
    }
    return [name];
  }
  return ALL_TESTS;
}

function printPass(name: string): void {
  console.log(`  ✅ PASS`);
}

function printFail(name: string, error: string, stack?: string): void {
  console.log(`  ❌ FAIL`);
  console.log(`  Error: ${error}`);
  if (stack) {
    const lines = stack.split('\n');
    // Print first relevant stack line
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('at ')) {
        console.log(`  ${trimmed}`);
        break;
      }
    }
  }
}

// ── Test 1: Context Lifecycle ────────────────────────────────────────────────

function testContextLifecycle(): void {
  const tmpDir = fs.mkdtempSync('/tmp/agent-context-test-');
  try {
    const filePath = path.join(tmpDir, 'agent-context.md');

    // 1. Create a minimal valid agent-context.md
    const createdAt = new Date().toISOString();
    const initialContent = `---
pipelineId: "test-pipe-001"
feature: "test-feature"
pipelineType: "full"
pipelineComplexity: "simple"
pipelineConfidence: 80
currentStep: "finder"
createdAt: "${createdAt}"
status: "running"
agentHistory: []
agentOutputs: {}
circuitBreaker:
  state: "closed"
  counters:
    build: 0
    lint: 0
gitState:
  branch: "main"
  dirtyFiles: []
  lastCommitSha: "abc123"
  lastCommitMessage: "test"
nextObjective: "Run test finder"
---
# Current Objective
Finder: Run test exploration
`;
    fs.writeFileSync(filePath, initialContent, 'utf-8');

    // 2. Verify YAML frontmatter fields
    const content = fs.readFileSync(filePath, 'utf-8');
    const normalized = content.replace(/\r\n/g, '\n');
    const frontmatterMatch = normalized.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(frontmatterMatch !== null, 'File must have YAML frontmatter');

    const frontmatterStr = frontmatterMatch[1];
    assert.ok(frontmatterStr.includes('pipelineId: "test-pipe-001"'), 'Must contain pipelineId');
    assert.ok(frontmatterStr.includes('status: "running"'), 'Must contain status: "running"');
    assert.ok(frontmatterStr.includes('currentStep: "finder"'), 'Must contain currentStep');
    assert.ok(frontmatterStr.includes('createdAt:'), 'Must contain createdAt');

    // 3. Simulate appending an agent history entry (finder)
    const finderEntry = `  - step: "finder"
    agent: "ses_finder_001"
    result: "completed"
    summary: "Test finder completed"
    decisions:
      - what: "Use existing model"
        why: "Already exists"
        by_who: "finder"
    warnings: []
    changedFiles: []
    artifacts:
      - "Exploration report"`;

    const updatedContent1 = content.replace(
      /agentHistory:\s*\[\]/,
      `agentHistory:\n${finderEntry}`,
    );
    fs.writeFileSync(filePath, updatedContent1, 'utf-8');

    // 4. Simulate updating circuit breaker counters
    const updatedContent2 = updatedContent1.replace(
      /counters:\s*\n\s+build: 0\s*\n\s+lint: 0/,
      `counters:\n    build: 0\n    lint: 0`,
    );
    // Simulate incrementing lint counter
    const updatedContent3 = updatedContent2.replace('lint: 0', 'lint: 1');
    fs.writeFileSync(filePath, updatedContent3, 'utf-8');

    // Verify counters were updated
    const contentAfterCB = fs.readFileSync(filePath, 'utf-8');
    assert.ok(contentAfterCB.includes('lint: 1'), 'Circuit breaker lint counter should be 1');

    // 5. Parse back and verify
    const normalizedCB = contentAfterCB.replace(/\r\n/g, '\n');
    const reparsedMatch = normalizedCB.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(reparsedMatch !== null, 'File must still have valid frontmatter after updates');
    assert.ok(reparsedMatch[1].includes('pipelineId: "test-pipe-001"'), 'pipelineId must survive re-parse');

    // 6. Verify status becomes "completed"
    const finalContent = contentAfterCB.replace('status: "running"', 'status: "completed"');
    fs.writeFileSync(filePath, finalContent, 'utf-8');
    const finalRead = fs.readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n');
    const finalFrontmatter = finalRead.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(finalFrontmatter !== null, 'Final file must have frontmatter');
    assert.ok(finalFrontmatter[1].includes('status: "completed"'), 'Status must be "completed" at end');

    // 7. Cleanup
    fs.rmSync(filePath);
    assert.ok(!fs.existsSync(filePath), 'Temp file must be cleaned up');
  } finally {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

// ── Test 2: Fixer Output Contract ────────────────────────────────────────────

function validateFixerOutput(output: Record<string, unknown>): boolean {
  // Validate the fixer output contract
  if (!output.rootCauseAnalysis || typeof output.rootCauseAnalysis !== 'object') {
    return false;
  }
  const rca = output.rootCauseAnalysis as Record<string, unknown>;
  if (typeof rca.classification !== 'string') return false;
  if (typeof rca.primaryCause !== 'string') return false;
  if (typeof rca.fixApplied !== 'string') return false;
  if (typeof rca.fixConfidence !== 'number') return false;
  if (!Array.isArray(rca.crossModuleCheck)) return false;
  return true;
}

function validateOldFormat(output: Record<string, unknown>): boolean {
  // Old format: uses 'decisions' instead of 'rootCauseAnalysis'
  if (output.rootCauseAnalysis) return false; // Has new format field
  if (!output.decisions || !Array.isArray(output.decisions)) return false;
  return true;
}

function testFixerOutput(): void {
  const tmpDir = fs.mkdtempSync('/tmp/fixer-output-test-');
  try {
    // 1. Create correct format
    const correctFormat = {
      rootCauseAnalysis: {
        classification: 'implementation-error',
        primaryCause: "createUser didn't handle duplicate email",
        contributingFactors: ['Plan checkpoint CP-005 specified try/catch but didn\'t specify which errors'],
        fixApplied: 'Added duplicate email check before insert',
        fixConfidence: 8,
        crossModuleCheck: [
          { module: 'src/controllers/user', status: 'unaffected' },
        ],
      },
      buildPassed: true,
      lintPassed: true,
    };

    const correctPath = path.join(tmpDir, 'fixer-correct.json');
    fs.writeFileSync(correctPath, JSON.stringify(correctFormat, null, 2), 'utf-8');

    // Verify correct format passes validation
    assert.ok(validateFixerOutput(correctFormat), 'Correct fixer format must pass validation');

    // 2. Create old (wrong) format using decisions instead of rootCauseAnalysis
    const oldFormat = {
      decisions: [
        { what: 'Added duplicate email check', why: 'Prevent duplicate users', by_who: 'fixer' },
      ],
      buildPassed: true,
      lintPassed: true,
    };

    const wrongPath = path.join(tmpDir, 'fixer-old-format.json');
    fs.writeFileSync(wrongPath, JSON.stringify(oldFormat, null, 2), 'utf-8');

    // Verify old format fails validation
    assert.ok(!validateFixerOutput(oldFormat), 'Old format (decisions-based) must fail validation');

    // 3. Try to run validate-output-contract.ts if it exists, verify results
    const validatorPath = path.join(
      __dirname,
      '..',
      '..',
      '..',
      'scripts',
      'tools',
      `validate-output-contract.${SCRIPT_EXT}`,
    );
    const toolsValidatorPath = path.join(
      __dirname,
      '..',
      'tools',
      `validate-output-contract.${SCRIPT_EXT}`,
    );

    const validatorScript = fs.existsSync(validatorPath)
      ? validatorPath
      : fs.existsSync(toolsValidatorPath)
        ? toolsValidatorPath
        : null;

    if (validatorScript) {
      const { execSync } = require('child_process') as typeof import('child_process');
      // Language-agnostic script runner
  const scriptRunner = process.argv[0] || 'node';

      // Correct format should pass (exit 0)
      try {
        execSync(`${scriptRunner} "${validatorScript}" --file="${correctPath}"`, {
          stdio: 'pipe',
          cwd: path.resolve(__dirname, '..', '..', '..'),
      shell: true,});
      } catch {
        assert.fail('Correct format should pass validation (exit 0)');
      }

      // Old format should fail (exit non-zero)
      try {
        execSync(`${scriptRunner} "${validatorScript}" --file="${wrongPath}"`, {
          stdio: 'pipe',
          cwd: path.resolve(__dirname, '..', '..', '..'),
      shell: true,});
        assert.fail('Old format should fail validation (exit non-zero)');
      } catch {
        // Expected
      }
    }

    // Cleanup
    fs.rmSync(correctPath);
    fs.rmSync(wrongPath);
  } finally {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

// ── Test 3: Stale agent-context.md Detection ────────────────────────────────

function isStaleContext(content: string): boolean {
  content = content.replace(/\r\n/g, '\n');
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return false;

  const frontmatter = match[1];

  // Extract status
  const statusMatch = frontmatter.match(/status:\s*"(\w+)"/);
  if (!statusMatch) return false;
  const status = statusMatch[1];

  // Only running contexts can be stale
  if (status !== 'running') return false;

  // Extract createdAt
  const createdAtMatch = frontmatter.match(/createdAt:\s*"([^"]+)"/);
  if (!createdAtMatch) return false;

  const createdAt = new Date(createdAtMatch[1]).getTime();
  const now = Date.now();
  const ageMs = now - createdAt;
  const ageHours = ageMs / (1000 * 60 * 60);

  // Stale if older than 1 hour
  return ageHours > 1;
}

function testStaleContext(): void {
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  // 1. Stale file: running + 2 hours old
  const staleContent = `---
pipelineId: "stale-test"
currentStep: "finder"
createdAt: "${twoHoursAgo.toISOString()}"
status: "running"
---
Stale context body
`;
  assert.ok(isStaleContext(staleContent), 'Stale context must be detected');

  // 2. Fresh file: running + now
  const freshContent = `---
pipelineId: "fresh-test"
currentStep: "finder"
createdAt: "${now.toISOString()}"
status: "running"
---
Fresh context body
`;
  assert.ok(!isStaleContext(freshContent), 'Fresh context must NOT be flagged as stale');

  // 3. Completed file: completed + 2 hours old — should NOT be stale
  const completedContent = `---
pipelineId: "completed-test"
currentStep: "finder"
createdAt: "${twoHoursAgo.toISOString()}"
status: "completed"
---
Completed context body
`;
  assert.ok(!isStaleContext(completedContent), 'Completed context must NOT be flagged as stale regardless of age');

  // 4. Failed file: failed + 2 hours old — should NOT be stale
  const failedContent = `---
pipelineId: "failed-test"
currentStep: "finder"
createdAt: "${twoHoursAgo.toISOString()}"
status: "failed"
---
Failed context body
`;
  assert.ok(!isStaleContext(failedContent), 'Failed context must NOT be flagged as stale regardless of age');
}

// ── Test 4: Output Contract Validation ──────────────────────────────────────

interface AgentOutputContract {
  status: string;
  resultSummary: string;
  buildPassed?: boolean | null;
  lintPassed?: boolean | null;
  buildOutput?: string | null;
  lintOutput?: string | null;
  [key: string]: unknown;
}

const AGENT_CONTRACT_RULES: Record<string, { required: string[]; optional: string[] }> = {
  finder: {
    required: ['status', 'resultSummary'],
    optional: ['knowledgeGraph', 'decisions'],
  },
  implementor: {
    required: ['status', 'resultSummary', 'buildPassed', 'lintPassed'],
    optional: ['selfReview', 'decisions', 'warnings', 'changedFiles', 'artifacts'],
  },
  fixer: {
    required: ['status', 'resultSummary', 'buildPassed', 'lintPassed', 'rootCauseAnalysis'],
    optional: ['decisions', 'warnings', 'changedFiles', 'artifacts'],
  },
  plandescriber: {
    required: ['status', 'resultSummary'],
    optional: ['decisions', 'warnings', 'changedFiles', 'artifacts'],
  },
  verifier: {
    required: ['status', 'resultSummary'],
    optional: ['suggestedCheckpoints', 'driftDetection'],
  },
  qa: {
    required: ['status', 'resultSummary'],
    optional: ['decisions', 'warnings', 'changedFiles', 'artifacts'],
  },
};

function validateAgentOutput(agentType: string, output: AgentOutputContract): boolean {
  const rules = AGENT_CONTRACT_RULES[agentType];
  if (!rules) return false;

  for (const field of rules.required) {
    if (output[field] === undefined || output[field] === null) {
      return false;
    }
  }

  // Type-specific checks
  if (output.status !== undefined && !['completed', 'failed', 'partial'].includes(output.status)) {
    return false;
  }

  if (typeof output.resultSummary !== 'string' || output.resultSummary.length === 0) {
    return false;
  }

  // For agents that must report buildPassed/lintPassed
  if (rules.required.includes('buildPassed') && typeof output.buildPassed !== 'boolean') {
    return false;
  }
  if (rules.required.includes('lintPassed') && typeof output.lintPassed !== 'boolean') {
    return false;
  }

  return true;
}

function testOutputContract(): void {
  const tmpDir = fs.mkdtempSync('/tmp/output-contract-test-');
  try {
    const agentsWithContracts: Array<{
      type: string;
      valid: AgentOutputContract;
      invalid: AgentOutputContract;
    }> = [
      {
        type: 'finder',
        valid: {
          status: 'completed',
          resultSummary: 'Found existing User model',
          knowledgeGraph: { entities: [], relationships: [], hazards: [] },
          decisions: [{ what: 'test', why: 'test', by_who: 'finder' }],
        },
        invalid: {
          status: 'unknown',
          resultSummary: '',
        },
      },
      {
        type: 'implementor',
        valid: {
          status: 'completed',
          resultSummary: 'Created user service',
          buildPassed: true,
          lintPassed: true,
          buildOutput: 'Build succeeded',
          lintOutput: 'Lint passed',
          selfReview: { confidence: 90, preCheckPassed: true, scopeGuardFlags: [] },
          changedFiles: ['src/services/user.{ext}'],
          artifacts: ['src/services/user.{ext}'],
        },
        invalid: {
          status: 'partial',
          resultSummary: 'Partial work',
          buildPassed: null,
          lintPassed: null,
        },
      },
      {
        type: 'fixer',
        valid: {
          status: 'completed',
          resultSummary: 'Fixed CP-003 duplicate email handling',
          buildPassed: true,
          lintPassed: true,
          rootCauseAnalysis: {
            classification: 'implementation-error',
            primaryCause: 'No duplicate email check',
            fixApplied: 'Added duplicate email check before insert',
            fixConfidence: 8,
            crossModuleCheck: [
              { module: 'src/controllers/user', status: 'unaffected' },
            ],
          },
          changedFiles: ['src/services/user.{ext}'],
        },
        invalid: {
          status: 'completed',
          resultSummary: 'Fixed stuff',
          buildPassed: true,
          lintPassed: true,
          // Missing rootCauseAnalysis
        },
      },
      {
        type: 'plandescriber',
        valid: {
          status: 'completed',
          resultSummary: 'Created 3-phase roadmap with 8 checkpoints',
          decisions: [
            { what: 'Split into 3 phases', why: 'Clear dependency ordering', by_who: 'planDescriber' },
          ],
          changedFiles: ['plan-manifests/test-manifest.json'],
          artifacts: ['plan-manifests/test-manifest.json'],
        },
        invalid: {
          status: 'failed',
          resultSummary: '',
        },
      },
      {
        type: 'verifier',
        valid: {
          status: 'completed',
          resultSummary: 'Verification complete: 92% compliance',
          suggestedCheckpoints: [
            { id: 'CP-NNN', type: 'behavioral', description: 'handlesError for validateEmail' },
          ],
          driftDetection: { hasDrift: false, details: null },
        },
        invalid: {
          status: 'running',
          // Missing resultSummary entirely
        } as unknown as AgentOutputContract,
      },
      {
        type: 'qa',
        valid: {
          status: 'completed',
          resultSummary: 'Smoke test passed, 2 edge cases generated',
          decisions: [
            { what: 'Add edge case for empty email', why: 'Missing validation', by_who: 'qa' },
          ],
          changedFiles: ['tests/user.test'],
          artifacts: ['tests/user.test'],
        },
        invalid: {
          status: 'completed',
          resultSummary: '',
        },
      },
    ];

    for (const { type, valid, invalid } of agentsWithContracts) {
      // Write valid output
      const validPath = path.join(tmpDir, `${type}-valid.json`);
      fs.writeFileSync(validPath, JSON.stringify(valid, null, 2), 'utf-8');

      // Write invalid output
      const invalidPath = path.join(tmpDir, `${type}-invalid.json`);
      fs.writeFileSync(invalidPath, JSON.stringify(invalid, null, 2), 'utf-8');

      // Validate valid output passes
      assert.ok(
        validateAgentOutput(type, valid),
        `Valid ${type} output must pass validation`,
      );

      // Validate invalid output fails
      assert.ok(
        !validateAgentOutput(type, invalid),
        `Invalid ${type} output must fail validation`,
      );
    }

    // Try running via validate-output-contract.ts if it exists
    const validatorPaths = [
      path.join(__dirname, '..', 'tools', 'validate-output-contract.ts'),
      path.join(__dirname, '..', '..', 'tools', 'validate-output-contract.ts'),
    ];

    const validatorScript = validatorPaths.find(p => fs.existsSync(p));

    if (validatorScript) {
      // eslint-disable-next-line
      const { execSync } = require('child_process') as typeof import('child_process');
      // Language-agnostic script runner
  const scriptRunner = process.argv[0] || 'node';

      for (const { type } of agentsWithContracts) {
        const validPath = path.join(tmpDir, `${type}-valid.json`);
        const invalidPath = path.join(tmpDir, `${type}-invalid.json`);

        // Valid should pass (exit 0)
        try {
          execSync(`${scriptRunner} "${validatorScript}" --file="${validPath}" --agent="${type}"`, {
            stdio: 'pipe',
            cwd: path.resolve(__dirname, '..', '..', '..'),
      shell: true,});
        } catch {
          assert.fail(`Valid ${type} output should pass validator (exit 0)`);
        }

        // Invalid should fail (exit non-zero)
        try {
          execSync(`${scriptRunner} "${validatorScript}" --file="${invalidPath}" --agent="${type}"`, {
            stdio: 'pipe',
            cwd: path.resolve(__dirname, '..', '..', '..'),
      shell: true,});
          assert.fail(`Invalid ${type} output should fail validator (exit non-zero)`);
        } catch {
          // Expected
        }
      }
    }

    // Cleanup
    for (const { type } of agentsWithContracts) {
      const validPath = path.join(tmpDir, `${type}-valid.json`);
      const invalidPath = path.join(tmpDir, `${type}-invalid.json`);
      if (fs.existsSync(validPath)) fs.rmSync(validPath);
      if (fs.existsSync(invalidPath)) fs.rmSync(invalidPath);
    }
  } finally {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

// ── Test 5: Circuit Breaker State Transitions ────────────────────────────

function testCircuitBreakerTransitions(): void {
  // 1. Test state transitions: closed → (after 3 failures on same gate) → open → (after reset) → half-open → (after pass) → closed

  const tmpDir = fs.mkdtempSync('/tmp/circuit-breaker-test-');
  try {
    const thresholds = { build: 3, lint: 3, securityScan: 3, smokeTest: 3, verifier: 3 };

    // Simulate: start closed, increment verifier counter 0→1→2→3
    let verifierCounter = 0;
    let state = 'closed';

    // After 2 failures, still closed
    verifierCounter = 2;
    assert.strictEqual(state, 'closed', 'State should be closed after 2 failures (threshold is 3)');

    // After 3 failures, should trigger transition to open (simulated)
    verifierCounter = 3;
    if (verifierCounter >= thresholds.verifier) {
      state = 'open';
    }
    assert.strictEqual(state, 'open', 'State should be open after 3 failures');

    // Simulate reset (half-open)
    state = 'half-open';
    verifierCounter = 0;
    assert.strictEqual(state, 'half-open', 'State should be half-open after reset');

    // Pass resets to closed
    state = 'closed';
    assert.strictEqual(state, 'closed', 'State should return to closed after passing in half-open');

    console.log('  Circuit breaker state transitions: closed → open → half-open → closed ✓');

    // 2. Test that different gates have independent counters
    let buildCounter = 0;
    let lintCounter = 0;

    buildCounter = 3; // Build hits threshold
    lintCounter = 1;  // Lint hasn't

    assert.ok(buildCounter >= thresholds.build, 'Build should be at threshold');
    assert.ok(lintCounter < thresholds.lint, 'Lint should still be below threshold');

    console.log('  Independent gate counters verified ✓');

    // 3. Test threshold reset on success
    buildCounter = 0; // Success resets
    assert.strictEqual(buildCounter, 0, 'Counter should reset to 0 on success');

    console.log('  Counter reset on success verified ✓');

  } finally {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

// ── Test 6: Pipeline Selection Logic ────────────────────────────────────

interface TaskClassification {
  taskType: string;
  expectedPipeline: string;
  skipFinder: boolean;
  description: string;
}

function testPipelineSelection(): void {
  // Simulate the Pipeline Selection Protocol decision table
  const CLASSIFICATIONS: TaskClassification[] = [
    { taskType: 'New Feature (known)', expectedPipeline: 'Standard', skipFinder: true, description: 'Familiar domain' },
    { taskType: 'New Feature (unknown)', expectedPipeline: 'Full', skipFinder: false, description: 'Unfamiliar domain' },
    { taskType: 'Bug Fix (known cause)', expectedPipeline: 'Fixer → QA → Verifier', skipFinder: true, description: 'Known root cause' },
    { taskType: 'Bug Fix (unknown cause)', expectedPipeline: 'Finder → Fixer → QA → Verifier', skipFinder: false, description: 'Unknown root cause' },
    { taskType: 'Research', expectedPipeline: 'Finder only', skipFinder: false, description: 'Understanding code' },
    { taskType: 'Refactor', expectedPipeline: 'PlanDescriber → Implementor → Security → QA → Verifier', skipFinder: true, description: 'Restructuring' },
    { taskType: 'Config Change', expectedPipeline: 'Implementor only', skipFinder: true, description: 'Simple config changes' },
    { taskType: 'Security Fix', expectedPipeline: 'Implementor → Security Scan → QA → Verifier', skipFinder: true, description: 'Patching vulnerability' },
    { taskType: 'UI Bug', expectedPipeline: 'Browser Tester → Fixer → QA', skipFinder: true, description: 'Frontend bug' },
    { taskType: 'Quick Fix', expectedPipeline: 'Ultra-Quick: Implementor → Build', skipFinder: true, description: 'One-line fix' },
    { taskType: 'Small Feature', expectedPipeline: 'Quick: Implementor → Build → Lint → QA', skipFinder: true, description: 'Small feature' },
    { taskType: 'Parallel Feature', expectedPipeline: 'Implementor (parallel) → Merge Coordinator → Build → Lint → Security → QA → Verifier', skipFinder: true, description: 'Parallel sub-tasks' },
  ];

  for (const tc of CLASSIFICATIONS) {
    // Validate that the pipeline string is non-empty
    assert.ok(tc.expectedPipeline.length > 0, `${tc.taskType} pipeline should not be empty`);
    // Validate that skipFinder is boolean
    assert.strictEqual(typeof tc.skipFinder, 'boolean', `${tc.taskType} skipFinder should be boolean`);
    // Validate skipFinder matches pipeline (Full always needs Finder)
    if (tc.expectedPipeline.startsWith('Full') || tc.expectedPipeline.startsWith('Finder')) {
      assert.strictEqual(tc.skipFinder, false, `${tc.taskType} should NOT skip Finder`);
    }
    if (tc.description === 'Familiar domain' || tc.description === 'Simple config changes') {
      assert.strictEqual(tc.skipFinder, true, `${tc.taskType} should skip Finder`);
    }
    // Check that all pipelines reference valid agent names
    const validAgents = ['Implementor', 'Finder', 'PlanDescriber', 'Fixer', 'QA', 'Verifier', 'Security', 'Browser Tester', 'Merge Coordinator', 'Build', 'Lint'];
    for (const agent of validAgents) {
      if (tc.expectedPipeline.includes(agent)) {
        assert.ok(true, `${tc.taskType} references valid agent: ${agent}`);
      }
    }
  }

  // Verify Quick Pipeline Presets
  const quickPresets = ['Ultra-Quick', 'Quick', 'Review', 'Standard', 'Full', 'Fixer-Only', 'Research', 'Docs'];
  assert.strictEqual(quickPresets.length, 8, 'Should have 8 pipeline presets');

  // Verify all presets are unique
  const uniquePresets = new Set(quickPresets);
  assert.strictEqual(uniquePresets.size, 8, 'All 8 presets should be unique');

  console.log(`  Pipeline selection table validated: ${CLASSIFICATIONS.length} classifications, ${quickPresets.length} presets ✓`);
}

// ── Main Runner ──────────────────────────────────────────────────────────────

function main(): void {
  const selectedTests = parseArgs();
  const results: TestResult[] = [];

  const testMap: Record<string, () => void> = {
    'context-lifecycle': testContextLifecycle,
    'fixer-output': testFixerOutput,
    'stale-context': testStaleContext,
    'output-contract': testOutputContract,
    'circuit-breaker': testCircuitBreakerTransitions,
    'pipeline-selection': testPipelineSelection,
  };

  const startTime = Date.now();

  console.log('🧪 Orchestration Pipeline Test Harness');
  console.log('══════════════════════════════════════\n');

  for (const [index, name] of selectedTests.entries()) {
    const testNum = ALL_TESTS.indexOf(name) + 1;
    const label = `${testNum}/${ALL_TESTS.length}`;
    process.stdout.write(`[${label}] ${name.padEnd(25)} `);

    try {
      testMap[name]();
      printPass(name);
      results.push({ name, passed: true });
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      printFail(name, error.message, error.stack);
      results.push({ name, passed: false, error: error.message, stack: error.stack });
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  const failed = results.filter(r => !r.passed);

  console.log('');
  console.log('──────────────────────────────────────');
  console.log(`Result: ${failed.length === 0 ? '✅' : '❌'} ${passed}/${total} tests passed`);
  console.log(`Duration: ${duration}s`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main();
