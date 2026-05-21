#!/usr/bin/env node
/**
 * Shared Test Manifest Creator — QA + Browser Tester Coordination
 *
 * Creates and manages a shared test manifest that coordinates parallel execution
 * between QA (logic tests) and Browser Tester (UI tests). Prevents the race
 * condition where "QA passed but Browser Tester was never run."
 *
 * Usage:
 *   ts-node shared-test-manifest.ts --generate --manifest=<path> --feature=<name> --out=<path>
 *   ts-node shared-test-manifest.ts --status
 *   ts-node shared-test-manifest.ts --complete --test-type=<type> --test-file=<path> --result=pass|fail
 *   ts-node shared-test-manifest.ts --start --agent=<name>
 *   ts-node shared-test-manifest.ts --wait --timeout=<ms>
 *   ts-node shared-test-manifest.ts --plan --files=<csv> --feature=<name>
 *   ts-node shared-test-manifest.ts --clean
 *
 * Exit codes:
 *   0 = Success
 *   1 = Error (invalid args, file not found, timeout)
 *   2 = Tests incomplete (from --wait)
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TestStatus = 'pending' | 'running' | 'passed' | 'failed';
type OverallStatus = 'pending' | 'running' | 'completed' | 'failed';
type TestAgent = 'qa' | 'browser-tester';
type TestType = 'logic' | 'ui' | 'integration' | 'security-regression';

interface Checkpoint {
  id: string;
  type: string;
  target: string;
  weight: string;
  verify?: string;
}

interface Phase {
  phase: number;
  name: string;
  steps: string[];
  checkpoints: Checkpoint[];
}

interface PlanManifest {
  manifestVersion: number;
  feature: string;
  createdAt: string;
  phases: Phase[];
  totalPhases: number;
  totalCheckpoints: number;
  dependencyOrdering?: string[];
  architectureDecisions?: string[];
}

interface TestEntry {
  testFile: string;
  agent: TestAgent;
  status: TestStatus;
  startedAt: string | null;
  completedAt: string | null;
  resultSummary: string | null;
}

interface TestResultEntry {
  testFile: string;
  agent: TestAgent;
  type: TestType;
  status: TestStatus;
  source: string;
}

interface SharedSetup {
  command: string;
  port: number;
  healthCheck: string;
  required: boolean;
}

interface CrossResults {
  logicPassed: boolean | null;
  uiPassed: boolean | null;
  securityPassed: boolean | null;
  overallVerdict: 'pending' | 'passed' | 'failed';
}

interface DecisionRule {
  condition: string;
  then: string;
}

interface TestManifest {
  testManifest: {
    manifestVersion: string;
    feature: string;
    createdAt: string;
    updatedAt: string;
    totalTests: number;
    completedTests: number;
    passedTests: number;
    failedTests: number;
    status: OverallStatus;
    logicTests: TestEntry[];
    uiTests: TestEntry[];
    testResults: TestResultEntry[];
    sharedSetup: SharedSetup[];
    crossResults: CrossResults;
    decisionRules: DecisionRule[];
  };
}

interface CliArgs {
  command: 'generate' | 'status' | 'complete' | 'start' | 'wait' | 'plan' | 'clean';
  manifest?: string;
  feature?: string;
  out?: string;
  testType?: TestType;
  testFile?: string;
  result?: 'pass' | 'fail';
  agent?: TestAgent;
  timeout?: number;
  files?: string[];
  format?: 'yaml' | 'json';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MANIFEST_PATH = path.resolve('.opencode/test-manifest.yaml');
const POLL_INTERVAL_MS = 2000;

const DECISION_RULES: DecisionRule[] = [
  {
    condition: 'logicTests ALL passed AND uiTests ALL passed',
    then: 'proceed to Verifier',
  },
  {
    condition: 'logicTests ANY failed',
    then: 'cycle to Fixer (logic)',
  },
  {
    condition: 'uiTests ANY failed',
    then: 'cycle to Fixer (UI)',
  },
];

const DEFAULT_SHARED_SETUP: SharedSetup[] = [
  {
    command: 'npm run dev',
    port: 3000,
    healthCheck: '/api/health',
    required: true,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoNow(): string {
  return new Date().toISOString();
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  const result: CliArgs = {
    command: 'status',
    format: 'yaml',
  };

  for (const arg of args) {
    if (arg === '--generate') {
      result.command = 'generate';
    } else if (arg === '--status') {
      result.command = 'status';
    } else if (arg === '--complete') {
      result.command = 'complete';
    } else if (arg === '--start') {
      result.command = 'start';
    } else if (arg === '--wait') {
      result.command = 'wait';
    } else if (arg === '--plan') {
      result.command = 'plan';
    } else if (arg === '--clean') {
      result.command = 'clean';
    } else if (arg === '--format=json') {
      result.format = 'json';
    } else if (arg.startsWith('--manifest=')) {
      result.manifest = arg.split('=')[1];
    } else if (arg.startsWith('--feature=')) {
      result.feature = arg.split('=')[1];
    } else if (arg.startsWith('--out=')) {
      result.out = arg.split('=')[1];
    } else if (arg.startsWith('--test-type=')) {
      const tt = arg.split('=')[1] as TestType;
      if (!['logic', 'ui', 'integration', 'security-regression'].includes(tt)) {
        console.error(`❌ Invalid --test-type: "${tt}". Must be: logic, ui, integration, security-regression`);
        process.exit(1);
      }
      result.testType = tt;
    } else if (arg.startsWith('--test-file=')) {
      result.testFile = arg.split('=')[1];
    } else if (arg.startsWith('--result=')) {
      const r = arg.split('=')[1];
      if (r !== 'pass' && r !== 'fail') {
        console.error(`❌ --result must be "pass" or "fail", got "${r}"`);
        process.exit(1);
      }
      result.result = r;
    } else if (arg.startsWith('--agent=')) {
      const a = arg.split('=')[1] as TestAgent;
      if (!['qa', 'browser-tester'].includes(a)) {
        console.error(`❌ --agent must be "qa" or "browser-tester", got "${a}"`);
        process.exit(1);
      }
      result.agent = a;
    } else if (arg.startsWith('--timeout=')) {
      const t = parseInt(arg.split('=')[1], 10);
      if (isNaN(t) || t <= 0) {
        console.error(`❌ --timeout must be a positive integer (ms), got "${arg.split('=')[1]}"`);
        process.exit(1);
      }
      result.timeout = t;
    } else if (arg.startsWith('--files=')) {
      const raw = arg.split('=')[1];
      result.files = raw ? raw.split(',').map(f => f.trim()).filter(Boolean) : [];
    } else {
      console.error(`❌ Unknown argument: ${arg}`);
      printUsage();
      process.exit(1);
    }
  }

  return result;
}

function printUsage(): void {
  console.log('Shared Test Manifest Creator — QA + Browser Tester Coordination');
  console.log('');
  console.log('Usage:');
  console.log('  Generate test manifest from plan manifest:');
  console.log('    ts-node shared-test-manifest.ts --generate --manifest=<path> --feature=<name> [--out=<path>]');
  console.log('');
  console.log('  Check status:');
  console.log('    ts-node shared-test-manifest.ts --status [--format=json]');
  console.log('');
  console.log('  Mark a test completed:');
  console.log('    ts-node shared-test-manifest.ts --complete --test-type=<type> --test-file=<path> --result=pass|fail');
  console.log('');
  console.log('  Mark all tests started for an agent:');
  console.log('    ts-node shared-test-manifest.ts --start --agent=qa|browser-tester');
  console.log('');
  console.log('  Wait for all tests to complete:');
  console.log('    ts-node shared-test-manifest.ts --wait [--timeout=300000]');
  console.log('');
  console.log('  Generate test plan from changed files:');
  console.log('    ts-node shared-test-manifest.ts --plan --files=file1.ts,file2.ts --feature=<name>');
  console.log('');
  console.log('  Clean up test manifest:');
  console.log('    ts-node shared-test-manifest.ts --clean');
  console.log('');
  console.log('Options:');
  console.log('  --format=json     Output in JSON format (default: yaml)');
  console.log('  --timeout=<ms>    Maximum time to wait (default: no limit)');
  console.log('  --out=<path>      Output path for generated manifest');
}

// ---------------------------------------------------------------------------
// Manifest persistence
// ---------------------------------------------------------------------------

function getManifestPath(cliOut?: string): string {
  if (cliOut) return path.resolve(cliOut);
  return DEFAULT_MANIFEST_PATH;
}

function readManifest(filePath: string): TestManifest | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content = fs.readFileSync(filePath, 'utf-8');

  // Support both YAML and JSON reading for flexibility
  if (filePath.endsWith('.json')) {
    try {
      return JSON.parse(content) as TestManifest;
    } catch {
      return null;
    }
  }

  // Parse YAML manually (no external deps)
  return parseYamlManifest(content);
}

function parseYamlManifest(content: string): TestManifest | null {
  try {
    const lines = content.split('\n');
    const parsed: Record<string, any> = {};

    // Stack holds: { key, obj, indent }
    // obj is the object that holds the 'key' property at the given indent level
    const stack: Array<{ key: string; obj: any; indent: number }> = [];

    // Initialize with root object at indent -1
    stack.push({ key: '', obj: parsed, indent: -1 });

    for (let li = 0; li < lines.length; li++) {
      const rawLine = lines[li];
      const line = rawLine.trimEnd();
      if (line.trim() === '' || line.trim().startsWith('#')) continue;

      const indent = line.search(/\S/);
      const trimmed = line.trim();

      // Check for list item
      const listItemMatch = trimmed.match(/^-\s+(.+)$/);
      if (listItemMatch) {
        const itemContent = listItemMatch[1].trim();

        // Pop back to the level where the list belongs
        while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
          stack.pop();
        }

        // Find the nearest parent key with indent < current indent
        let listKey: string | null = null;
        let listParent: any = null;
        for (let i = stack.length - 1; i >= 0; i--) {
          const entry = stack[i];
          if (entry.indent < indent && entry.key) {
            listKey = entry.key;
            listParent = entry.obj;
            break;
          }
        }

        if (!listKey || !listParent) continue;

        // Ensure the parent has an array for this key
        if (!Array.isArray(listParent[listKey])) {
          listParent[listKey] = [];
        }

        // Check if this list item is an object (key: value) or scalar
        const objItemMatch = itemContent.match(/^([\w-]+):\s*(.*)$/);
        if (objItemMatch) {
          const objKey = objItemMatch[1];
          const objValue = objItemMatch[2].trim();
          const newObj: Record<string, any> = {};
          // Set the first property directly
          if (objValue === '' || objValue === '|') {
            newObj[objKey] = {};
          } else {
            newObj[objKey] = parseScalarValue(objValue);
          }
          (listParent[listKey] as any[]).push(newObj);
          // Push the list's parent obj WITH the current indent so sibling
          // key-value pairs at deeper indent can find this newObj
          stack.push({ key: listKey, obj: newObj, indent });
        } else {
          (listParent[listKey] as any[]).push(parseScalarValue(itemContent));
        }
        continue;
      }

      // Key-value pair
      const kvMatch = trimmed.match(/^([\w-]+):\s*(.*)$/);
      if (!kvMatch) continue;

      const key = kvMatch[1];
      const rawValue = kvMatch[2].trim();

      // Pop stack to correct indent level
      // We stop at the first entry with indent < current indent
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }

      // The current target is the object at the top of the stack
      let targetObj: any = stack[stack.length - 1]?.obj || parsed;

      if (rawValue === '' || rawValue === '|') {
        // Key with nested content
        // Check the next non-empty line to determine if this is a list
        let nextLine: string | null = null;
        for (let j = li + 1; j < lines.length; j++) {
          const nl = lines[j].trim();
          if (nl && !nl.startsWith('#')) { nextLine = nl; break; }
        }
        const isList = nextLine && nextLine.startsWith('- ');

        if (isList) {
          // Pre-initialize as empty array — list items will populate it
          if (!Array.isArray(targetObj[key])) {
            targetObj[key] = [];
          }
          stack.push({ key, obj: targetObj, indent });
        } else if (Array.isArray(targetObj[key])) {
          // Already an array from list processing — push for context
          stack.push({ key, obj: targetObj, indent });
        } else {
          // Create empty object
          targetObj[key] = targetObj[key] || {};
          stack.push({ key, obj: targetObj[key], indent });
        }
      } else {
        // Leaf value
        targetObj[key] = parseScalarValue(rawValue);
        // Push this to stack so sibling detection works
        stack.push({ key, obj: targetObj, indent });
      }
    }

    return restoreTestManifest(parsed);
  } catch {
    return null;
  }
}

function parseScalarValue(raw: string): any {
  if (raw === 'null' || raw === '~') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  // Quoted string
  const quotedMatch = raw.match(/^"(.*)"$/);
  if (quotedMatch) return quotedMatch[1];

  // Number
  const num = Number(raw);
  if (!isNaN(num) && raw !== '') return num;

  return raw;
}

function restoreTestManifest(parsed: Record<string, any>): TestManifest | null {
  try {
    const tm = parsed.testManifest || parsed;
    const manifest: TestManifest = {
      testManifest: {
        manifestVersion: String(tm.manifestVersion || '1.0'),
        feature: String(tm.feature || 'unknown'),
        createdAt: String(tm.createdAt || isoNow()),
        updatedAt: String(tm.updatedAt || isoNow()),
        totalTests: Number(tm.totalTests) || 0,
        completedTests: Number(tm.completedTests) || 0,
        passedTests: Number(tm.passedTests) || 0,
        failedTests: Number(tm.failedTests) || 0,
        status: (tm.status as OverallStatus) || 'pending',
        logicTests: Array.isArray(tm.logicTests) ? tm.logicTests.map(normalizeTestEntry) : [],
        uiTests: Array.isArray(tm.uiTests) ? tm.uiTests.map(normalizeTestEntry) : [],
        testResults: Array.isArray(tm.testResults) ? tm.testResults.map(normalizeTestResultEntry) : [],
        sharedSetup: Array.isArray(tm.sharedSetup) ? tm.sharedSetup : [...DEFAULT_SHARED_SETUP],
        crossResults: {
          logicPassed: tm.crossResults?.logicPassed ?? null,
          uiPassed: tm.crossResults?.uiPassed ?? null,
          securityPassed: tm.crossResults?.securityPassed ?? null,
          overallVerdict: tm.crossResults?.overallVerdict || 'pending',
        },
        decisionRules: Array.isArray(tm.decisionRules) ? tm.decisionRules : [...DECISION_RULES],
      },
    };
    return manifest;
  } catch {
    return null;
  }
}

function normalizeTestEntry(entry: any): TestEntry {
  return {
    testFile: String(entry.testFile || entry.test_file || ''),
    agent: (entry.agent || 'qa') as TestAgent,
    status: (entry.status || 'pending') as TestStatus,
    startedAt: entry.startedAt || entry.started_at || null,
    completedAt: entry.completedAt || entry.completed_at || null,
    resultSummary: entry.resultSummary || entry.result_summary || null,
  };
}

function normalizeTestResultEntry(entry: any): TestResultEntry {
  return {
    testFile: String(entry.testFile || entry.test_file || ''),
    agent: (entry.agent || 'qa') as TestAgent,
    type: (entry.type || 'logic') as TestType,
    status: (entry.status || 'pending') as TestStatus,
    source: String(entry.source || 'manual'),
  };
}

function writeManifest(filePath: string, manifest: TestManifest, format: 'yaml' | 'json'): void {
  // Ensure directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const ext = path.extname(filePath);
  const outputFormat = format || (ext === '.json' ? 'json' : 'yaml');

  if (outputFormat === 'json') {
    fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2), 'utf-8');
  } else {
    fs.writeFileSync(filePath, serializeManifestToYaml(manifest), 'utf-8');
  }
}

function serializeManifestToYaml(manifest: TestManifest): string {
  const m = manifest.testManifest;
  const lines: string[] = [];
  lines.push('testManifest:');
  lines.push(`  manifestVersion: "${m.manifestVersion}"`);
  lines.push(`  feature: "${m.feature}"`);
  lines.push(`  createdAt: "${m.createdAt}"`);
  lines.push(`  updatedAt: "${m.updatedAt}"`);
  lines.push(`  totalTests: ${m.totalTests}`);
  lines.push(`  completedTests: ${m.completedTests}`);
  lines.push(`  passedTests: ${m.passedTests}`);
  lines.push(`  failedTests: ${m.failedTests}`);
  lines.push(`  status: "${m.status}"`);

  // Logic tests
  lines.push('  logicTests:');
  for (const t of m.logicTests) {
    lines.push(`    - testFile: "${t.testFile}"`);
    lines.push(`      agent: "${t.agent}"`);
    lines.push(`      status: "${t.status}"`);
    lines.push(`      startedAt: ${t.startedAt ? `"${t.startedAt}"` : 'null'}`);
    lines.push(`      completedAt: ${t.completedAt ? `"${t.completedAt}"` : 'null'}`);
    lines.push(`      resultSummary: ${t.resultSummary ? `"${escapeYamlString(t.resultSummary)}"` : 'null'}`);
  }

  // UI tests
  lines.push('  uiTests:');
  for (const t of m.uiTests) {
    lines.push(`    - testFile: "${t.testFile}"`);
    lines.push(`      agent: "${t.agent}"`);
    lines.push(`      status: "${t.status}"`);
    lines.push(`      startedAt: ${t.startedAt ? `"${t.startedAt}"` : 'null'}`);
    lines.push(`      completedAt: ${t.completedAt ? `"${t.completedAt}"` : 'null'}`);
    lines.push(`      resultSummary: ${t.resultSummary ? `"${escapeYamlString(t.resultSummary)}"` : 'null'}`);
  }

  // Test results
  lines.push('  testResults:');
  for (const r of m.testResults) {
    lines.push(`    - testFile: "${r.testFile}"`);
    lines.push(`      agent: "${r.agent}"`);
    lines.push(`      type: "${r.type}"`);
    lines.push(`      status: "${r.status}"`);
    lines.push(`      source: "${r.source}"`);
  }

  // Shared setup
  lines.push('  sharedSetup:');
  for (const s of m.sharedSetup) {
    lines.push(`    - command: "${escapeYamlString(s.command)}"`);
    lines.push(`      port: ${s.port}`);
    lines.push(`      healthCheck: "${s.healthCheck}"`);
    lines.push(`      required: ${s.required}`);
  }

  // Cross results
  lines.push('  crossResults:');
  lines.push(`    logicPassed: ${m.crossResults.logicPassed === null ? 'null' : m.crossResults.logicPassed}`);
  lines.push(`    uiPassed: ${m.crossResults.uiPassed === null ? 'null' : m.crossResults.uiPassed}`);
  lines.push(`    securityPassed: ${m.crossResults.securityPassed === null ? 'null' : m.crossResults.securityPassed}`);
  lines.push(`    overallVerdict: "${m.crossResults.overallVerdict}"`);

  // Decision rules
  lines.push('  decisionRules:');
  for (const r of m.decisionRules) {
    lines.push(`    - condition: "${escapeYamlString(r.condition)}"`);
    lines.push(`      then: "${r.then}"`);
  }

  return lines.join('\n') + '\n';
}

function escapeYamlString(s: string): string {
  return s.replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

// ---------------------------------------------------------------------------
// Generate from plan manifest
// ---------------------------------------------------------------------------

function generateFromManifest(manifestPath: string, feature: string, outPath: string, format: 'yaml' | 'json'): void {
  if (!fs.existsSync(manifestPath)) {
    console.error(`❌ Plan manifest not found: ${manifestPath}`);
    process.exit(1);
  }

  let planManifest: PlanManifest | undefined;
  try {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    planManifest = JSON.parse(content) as PlanManifest;
  } catch (err) {
    console.error(`❌ Failed to parse plan manifest: ${err}`);
    process.exit(1);
  }
  /* istanbul ignore next */
  if (!planManifest) {
    console.error('❌ Plan manifest could not be loaded');
    process.exit(1);
  }

  const featureName = feature || planManifest.feature;
  const logicTests: TestEntry[] = [];
  const uiTests: TestEntry[] = [];
  const testResults: TestResultEntry[] = [];
  const seenTargets = new Set<string>();

  for (const phase of planManifest.phases) {
    for (const cp of phase.checkpoints) {
      // Deduplicate
      if (seenTargets.has(cp.target)) continue;
      seenTargets.add(cp.target);

      if (cp.type.includes('behavioral')) {
        // Check if this looks like a UI-related checkpoint
        const isUI = /ui|e2e|browser|page|component|render|spec|visual|screen/.test(cp.target) ||
                     /ui|e2e|browser|page|component|render|spec|visual|screen/.test(cp.verify || '');
        const isSecurity = /security|sqli|xss|auth|owasp|injection/.test(cp.target) ||
                           /security|sqli|xss|auth|owasp|injection/.test(cp.verify || '');

        if (isUI) {
          const testFile = deriveTestFile(cp.target, 'e2e');
          uiTests.push(createTestEntry(testFile, 'browser-tester'));
          if (isSecurity) {
            testResults.push(createTestResultEntry(testFile, 'browser-tester', 'security-regression'));
          }
        } else if (isSecurity) {
          const testFile = deriveTestFile(cp.target, 'security');
          logicTests.push(createTestEntry(testFile, 'qa'));
          testResults.push(createTestResultEntry(testFile, 'qa', 'security-regression'));
        } else {
          const testFile = deriveTestFile(cp.target, 'unit');
          logicTests.push(createTestEntry(testFile, 'qa'));
        }
      } else if (cp.type.includes('structural')) {
        // Structural checkpoints → integration tests
        const testFile = deriveTestFile(cp.target, 'integration');
        logicTests.push(createTestEntry(testFile, 'qa'));
      }
    }
  }

  // Add test results from existing sources (auto-generated / security-regression detection)
  const resultSources: TestResultEntry[] = generateSecurityTestEntries(planManifest);
  testResults.push(...resultSources);

  // Deduplicate test results by testFile
  const seenResults = new Set<string>();
  const dedupedResults: TestResultEntry[] = [];
  for (const r of testResults) {
    const key = `${r.testFile}:${r.type}`;
    if (!seenResults.has(key)) {
      seenResults.add(key);
      dedupedResults.push(r);
    }
  }

  const totalTests = logicTests.length + uiTests.length;

  const manifest: TestManifest = {
    testManifest: {
      manifestVersion: '1.0',
      feature: featureName,
      createdAt: isoNow(),
      updatedAt: isoNow(),
      totalTests,
      completedTests: 0,
      passedTests: 0,
      failedTests: 0,
      status: 'pending',
      logicTests,
      uiTests,
      testResults: dedupedResults,
      sharedSetup: [...DEFAULT_SHARED_SETUP],
      crossResults: {
        logicPassed: null,
        uiPassed: null,
        securityPassed: null,
        overallVerdict: 'pending',
      },
      decisionRules: [...DECISION_RULES],
    },
  };

  writeManifest(outPath, manifest, format);
  console.log(`✅ Test manifest created: ${path.relative(process.cwd(), outPath)}`);
  console.log(`   Feature: ${featureName}`);
  console.log(`   Total tests: ${totalTests} (${logicTests.length} logic, ${uiTests.length} UI)`);
}

function deriveTestFile(target: string, subdir: string): string {
  // Convert checkpoint targets to test file paths
  // Uses whatever file extension the target has (e.g., .ts, .py, .go, .rs)
  const fileExt = path.extname(target);
  const basename = path.basename(target, fileExt);

  let testDir: string;
  let testSuffix = '.test' + (fileExt || '');

  switch (subdir) {
    case 'e2e':
      testDir = 'tests/e2e';
      testSuffix = '.spec' + (fileExt || '');
      break;
    case 'integration':
      testDir = 'tests/integration';
      break;
    case 'security':
      testDir = 'tests/security';
      break;
    default:
      testDir = 'tests/unit';
  }

  // Convert path separators to hyphens for test file naming
  const dirPart = path.dirname(target);
  let prefix = '';
  if (dirPart && dirPart !== '.') {
    prefix = dirPart.replace(/\//g, '-') + '-';
  }

  return `${testDir}/${prefix}${basename}${testSuffix}`;
}

function createTestEntry(testFile: string, agent: TestAgent): TestEntry {
  return {
    testFile,
    agent,
    status: 'pending',
    startedAt: null,
    completedAt: null,
    resultSummary: null,
  };
}

function createTestResultEntry(testFile: string, agent: TestAgent, type: TestType): TestResultEntry {
  return {
    testFile,
    agent,
    type,
    status: 'pending',
    source: 'auto-generated',
  };
}

function generateSecurityTestEntries(manifest: PlanManifest): TestResultEntry[] {
  const entries: TestResultEntry[] = [];
  const seen = new Set<string>();

  for (const phase of manifest.phases) {
    for (const cp of phase.checkpoints) {
      const target = cp.target;
      const verify = cp.verify || '';

      const isSecurity = /security|sqli|xss|auth|owasp|injection|sanitize|validation/.test(target) ||
                         /security|sqli|xss|auth|owasp|injection|sanitize|validation/.test(verify);

      if (isSecurity) {
        const testFile = deriveTestFile(target, 'security');
        const key = `${testFile}:security-regression`;
        if (!seen.has(key)) {
          seen.add(key);
          entries.push({
            testFile,
            agent: 'qa',
            type: 'security-regression',
            status: 'pending',
            source: 'auto-generated',
          });
        }
      }
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Status command
// ---------------------------------------------------------------------------

function printStatus(args: CliArgs): void {
  const manifestPath = getManifestPath();
  const manifest = readManifest(manifestPath);

  if (!manifest) {
    if (args.format === 'json') {
      console.log(JSON.stringify({ error: 'No test manifest found', path: manifestPath }));
    } else {
      console.log(`❌ No test manifest found at ${manifestPath}`);
      console.log('   Run --generate first to create one.');
    }
    return;
  }

  const m = manifest.testManifest;

  if (args.format === 'json') {
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  // Print colored status table
  const separator = '━'.repeat(31 + m.feature.length);
  console.log(`Test Manifest Status: ${m.feature}`);
  console.log(separator);
  console.log('');
  console.log(`Overall: ${statusBadge(m.status)} (${m.completedTests}/${m.totalTests} completed)`);
  console.log('');

  // Logic tests
  const logicCount = m.logicTests.length;
  const logicCompleted = m.logicTests.filter(t => t.status === 'passed' || t.status === 'failed').length;
  const logicPassed = m.logicTests.filter(t => t.status === 'passed').length;
  const logicFailed = m.logicTests.filter(t => t.status === 'failed').length;
  const logicRunning = m.logicTests.filter(t => t.status === 'running').length;
  const logicPending = m.logicTests.filter(t => t.status === 'pending').length;
  const logicIcon = logicFailed > 0 ? '❌' : logicRunning > 0 ? '🔄' : logicPending > 0 ? '⏳' : '✅';

  console.log(`Logic: ${logicPassed}/${logicCount} ${logicIcon}`);
  for (const t of m.logicTests) {
    const icon = t.status === 'passed' ? '✓' : t.status === 'failed' ? '✗' : t.status === 'running' ? '~' : '-';
    const statusLabel = t.status === 'passed' ? '✅ PASS' : t.status === 'failed' ? '❌ FAIL' : t.status === 'running' ? '🔄 RUNNING' : '⏳ PENDING';
    console.log(`  ${icon} ${t.testFile} (${statusLabel})`);
  }
  console.log('');

  // UI tests
  const uiCount = m.uiTests.length;
  const uiCompleted = m.uiTests.filter(t => t.status === 'passed' || t.status === 'failed').length;
  const uiPassed = m.uiTests.filter(t => t.status === 'passed').length;
  const uiFailed = m.uiTests.filter(t => t.status === 'failed').length;
  const uiRunning = m.uiTests.filter(t => t.status === 'running').length;
  const uiPending = m.uiTests.filter(t => t.status === 'pending').length;
  const uiIcon = uiFailed > 0 ? '❌' : uiRunning > 0 ? '🔄' : uiPending > 0 ? '⏳' : '✅';

  console.log(`UI: ${uiPassed}/${uiCount} ${uiIcon}`);
  for (const t of m.uiTests) {
    const icon = t.status === 'passed' ? '✓' : t.status === 'failed' ? '✗' : t.status === 'running' ? '~' : '-';
    const statusLabel = t.status === 'passed' ? '✅ PASS' : t.status === 'failed' ? '❌ FAIL' : t.status === 'running' ? '🔄 RUNNING' : '⏳ PENDING';
    console.log(`  ${icon} ${t.testFile} (${statusLabel})`);
  }
  console.log('');

  // Security regression tests
  const securityTests = m.testResults.filter(r => r.type === 'security-regression');
  if (securityTests.length > 0) {
    const secPassed = securityTests.filter(r => r.status === 'passed').length;
    const secFailed = securityTests.filter(r => r.status === 'failed').length;
    const secPending = securityTests.filter(r => r.status === 'pending').length;
    const secIcon = secFailed > 0 ? '❌' : secPending > 0 ? '⏳' : '✅';

    console.log(`Security: ${secPassed}/${securityTests.length} ${secIcon}`);
    for (const r of securityTests) {
      const icon = r.status === 'passed' ? '✓' : r.status === 'failed' ? '✗' : '-';
      const statusLabel = r.status === 'passed' ? '✅ PASS' : r.status === 'failed' ? '❌ FAIL' : '⏳ PENDING';
      console.log(`  ${icon} ${r.testFile} (${statusLabel})`);
    }
    console.log('');
  }

  // Verdict
  console.log('');
  console.log(`Verdict: ${verdictMessage(m)}`);
}

function statusBadge(status: OverallStatus): string {
  switch (status) {
    case 'pending': return '⏳ PENDING';
    case 'running': return '🔄 RUNNING';
    case 'completed': return '✅ COMPLETED';
    case 'failed': return '❌ FAILED';
  }
}

function verdictMessage(m: TestManifest['testManifest']): string {
  const cr = m.crossResults;
  const allLogicDone = m.logicTests.every(t => t.status === 'passed' || t.status === 'failed');
  const allUiDone = m.uiTests.every(t => t.status === 'passed' || t.status === 'failed');
  const securityTests = m.testResults.filter(r => r.type === 'security-regression');
  const allSecurityDone = securityTests.every(r => r.status === 'passed' || r.status === 'failed');

  const anyLogicFailed = m.logicTests.some(t => t.status === 'failed');
  const anyUiFailed = m.uiTests.some(t => t.status === 'failed');
  const anySecurityFailed = securityTests.some(r => r.status === 'failed');

  if (!allLogicDone) return '⏳ Waiting for logic tests...';
  if (!allUiDone) return '⏳ Waiting for UI tests...';
  if (!allSecurityDone && securityTests.length > 0) return '⏳ Waiting for security tests...';

  if (anyLogicFailed) return '❌ Logic tests failed — cycle to Fixer (logic)';
  if (anyUiFailed) return '❌ UI tests failed — cycle to Fixer (UI)';
  if (anySecurityFailed) return '❌ Security tests failed — cycle to Fixer (security)';

  if (allLogicDone && allUiDone && allSecurityDone) return '✅ All tests passed — proceed to Verifier';
  return '⏳ Verdict pending...';
}

// ---------------------------------------------------------------------------
// Complete command
// ---------------------------------------------------------------------------

function markComplete(args: CliArgs): void {
  const missing: string[] = [];
  if (!args.testType) missing.push('--test-type');
  if (!args.testFile) missing.push('--test-file');
  if (!args.result) missing.push('--result');

  if (missing.length > 0) {
    console.error(`❌ Missing required arguments: ${missing.join(', ')}`);
    console.error('Usage: --complete --test-type=<type> --test-file=<path> --result=pass|fail');
    process.exit(1);
  }

  const manifestPath = getManifestPath();
  const manifest = readManifest(manifestPath);

  if (!manifest) {
    console.error(`❌ No test manifest found at ${manifestPath}`);
    console.error('   Run --generate first.');
    process.exit(1);
  }

  const m = manifest.testManifest;
  const testFile = args.testFile!;
  const result = args.result!;
  const testType = args.testType!;

  // Find the test entry in logic or UI tests
  let found = false;

  const findAndUpdate = (entries: TestEntry[]): boolean => {
    for (const entry of entries) {
      if (entry.testFile === testFile) {
        entry.status = result === 'pass' ? 'passed' : 'failed';
        entry.completedAt = isoNow();
        entry.resultSummary = result === 'pass' ? 'All checks passed' : 'One or more checks failed';
        return true;
      }
    }
    return false;
  };

  // Update logic tests
  if (testType === 'logic' || testType === 'integration') {
    found = findAndUpdate(m.logicTests) || found;
  }

  // Update UI tests
  if (testType === 'ui') {
    found = findAndUpdate(m.uiTests) || found;
  }

  // Update test results
  for (const r of m.testResults) {
    if (r.testFile === testFile) {
      r.status = result === 'pass' ? 'passed' : 'failed';
      found = true;
    }
  }

  if (!found) {
    // Add as new entry if not found
    const agent: TestAgent = testType === 'ui' ? 'browser-tester' : 'qa';
    const entry = createTestEntry(testFile, agent);
    entry.status = result === 'pass' ? 'passed' : 'failed';
    entry.completedAt = isoNow();
    entry.resultSummary = result === 'pass' ? 'All checks passed' : 'One or more checks failed';

    if (testType === 'ui') {
      m.uiTests.push(entry);
    } else {
      m.logicTests.push(entry);
    }

    m.testResults.push({
      testFile,
      agent,
      type: testType,
      status: result === 'pass' ? 'passed' : 'failed',
      source: 'manual',
    });
  }

  // Recalculate summary
  recalculateManifest(m);
  m.updatedAt = isoNow();

  writeManifest(manifestPath, manifest, 'yaml');
  console.log(`✅ Marked ${testFile} as ${result === 'pass' ? 'PASSED' : 'FAILED'}`);
  console.log(`   Status: ${m.completedTests}/${m.totalTests} completed, ${m.passedTests} passed, ${m.failedTests} failed`);
}

function recalculateManifest(m: TestManifest['testManifest']): void {
  const completed = (entry: TestEntry) => entry.status === 'passed' || entry.status === 'failed';
  const passed = (entry: TestEntry) => entry.status === 'passed';
  const failed = (entry: TestEntry) => entry.status === 'failed';

  const allEntries = [...m.logicTests, ...m.uiTests];
  m.totalTests = allEntries.length;
  m.completedTests = allEntries.filter(completed).length;
  m.passedTests = allEntries.filter(passed).length;
  m.failedTests = allEntries.filter(failed).length;

  const hasRunning = allEntries.some(e => e.status === 'running');
  const allDone = allEntries.every(completed);
  const anyFailed = allEntries.some(failed);

  // Update status
  if (allDone) {
    m.status = anyFailed ? 'failed' : 'completed';
  } else if (hasRunning || m.completedTests > 0) {
    m.status = 'running';
  } else {
    m.status = 'pending';
  }

  // Update crossResults
  const logicDone = m.logicTests.every(completed);
  const uiDone = m.uiTests.every(completed);

  if (logicDone) {
    m.crossResults.logicPassed = m.logicTests.every(passed);
  }
  if (uiDone) {
    m.crossResults.uiPassed = m.uiTests.every(passed);
  }

  const securityTests = m.testResults.filter(r => r.type === 'security-regression');
  const securityDone = securityTests.length > 0 && securityTests.every(r => r.status === 'passed' || r.status === 'failed');
  if (securityDone) {
    m.crossResults.securityPassed = securityTests.every(r => r.status === 'passed');
  }

  // Overall verdict
  if (
    logicDone && uiDone && securityDone &&
    m.crossResults.logicPassed && m.crossResults.uiPassed && m.crossResults.securityPassed
  ) {
    m.crossResults.overallVerdict = 'passed';
  } else if (anyFailed) {
    m.crossResults.overallVerdict = 'failed';
  }
}

// ---------------------------------------------------------------------------
// Start command
// ---------------------------------------------------------------------------

function markStarted(args: CliArgs): void {
  if (!args.agent) {
    console.error('❌ --agent is required for --start');
    console.error('Usage: --start --agent=qa|browser-tester');
    process.exit(1);
  }

  const manifestPath = getManifestPath();
  const manifest = readManifest(manifestPath);

  if (!manifest) {
    console.error(`❌ No test manifest found at ${manifestPath}`);
    process.exit(1);
  }

  const m = manifest.testManifest;
  const now = isoNow();
  let count = 0;

  const updateEntries = (entries: TestEntry[], agent: TestAgent): void => {
    for (const entry of entries) {
      if (entry.agent === agent && entry.status === 'pending') {
        entry.status = 'running';
        entry.startedAt = now;
        count++;
      }
    }
  };

  updateEntries(m.logicTests, args.agent);
  updateEntries(m.uiTests, args.agent);

  // Also update test results for this agent
  for (const r of m.testResults) {
    if (r.agent === args.agent && r.status === 'pending') {
      r.status = 'running';
    }
  }

  if (count > 0 && m.status === 'pending') {
    m.status = 'running';
  }

  m.updatedAt = now;
  writeManifest(manifestPath, manifest, 'yaml');
  console.log(`✅ Marked ${count} test(s) as running for agent "${args.agent}"`);
}

// ---------------------------------------------------------------------------
// Wait command
// ---------------------------------------------------------------------------

function waitForTests(args: CliArgs): void {
  const manifestPath = getManifestPath();
  const timeout = args.timeout || 0;
  const startTime = Date.now();

  console.log('⏳ Waiting for all tests to complete...');
  if (timeout > 0) {
    console.log(`   Timeout: ${timeout}ms`);
  }
  console.log('');

  const poll = (): void => {
    const manifest = readManifest(manifestPath);

    if (!manifest) {
      console.error('❌ Test manifest deleted or not found — aborting wait.');
      process.exit(1);
    }

    const m = manifest.testManifest;
    const allDone = m.logicTests.every(t => t.status === 'passed' || t.status === 'failed') &&
                    m.uiTests.every(t => t.status === 'passed' || t.status === 'failed');

    // Print progress
    const total = m.totalTests;
    const done = m.completedTests;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const passed = m.passedTests;
    const failed = m.failedTests;
    const running = total - done;

    process.stdout.write(`\r   ${done}/${total} (${pct}%) — ✅ ${passed} passed, ❌ ${failed} failed, 🔄 ${running} running    `);

    if (allDone) {
      process.stdout.write('\n\n');
      console.log('✅ All tests completed!');
      console.log(`   Result: ${m.crossResults.overallVerdict}`);
      process.exit(m.crossResults.overallVerdict === 'passed' ? 0 : 2);
    }

    // Check timeout
    if (timeout > 0 && (Date.now() - startTime) > timeout) {
      process.stdout.write('\n\n');
      console.error(`❌ Timeout reached (${timeout}ms). Tests not all completed.`);
      console.error(`   ${done}/${total} completed.`);
      process.exit(2);
    }

    setTimeout(poll, POLL_INTERVAL_MS);
  };

  poll();
}

// ---------------------------------------------------------------------------
// Plan command (generate test plan from changed files)
// ---------------------------------------------------------------------------

function generateTestPlan(args: CliArgs): void {
  if (!args.files || args.files.length === 0) {
    console.error('❌ --files is required for --plan (comma-separated file paths)');
    process.exit(1);
  }

  if (!args.feature) {
    console.error('❌ --feature is required for --plan');
    process.exit(1);
  }

  const plan: Array<{
    sourceFile: string;
    suggestedTestFiles: string[];
    testType: TestType;
    notes: string;
  }> = [];

  for (const file of args.files) {
    const resolvedPath = path.resolve(file);
    if (!fs.existsSync(resolvedPath)) {
      plan.push({
        sourceFile: file,
        suggestedTestFiles: [],
        testType: 'logic',
        notes: '⚠️ File does not exist on disk',
      });
      continue;
    }

    const content = fs.readFileSync(resolvedPath, 'utf-8');
    const fileName = path.basename(file, path.extname(file));
    const fileDir = path.dirname(file);

    // Detect test type from file content
    let testType: TestType = 'logic';
    const suggestions: string[] = [];

    if (
      /describe\(.*component|render\(|screen\.|fireEvent|page\.\$|browser\.|playwright|cy\./i.test(content)
    ) {
      testType = 'ui';
    } else if (
      /sqli|xss|auth|owasp|injection|sanitize|validation/i.test(content) ||
      /security/i.test(file)
    ) {
      testType = 'security-regression';
    } else if (/router|route|app\.(get|post|put|delete)|controller|api|endpoint/i.test(content)) {
      testType = 'integration';
    }

    // Look for existing test files
    const existingTestFiles = findExistingTests(resolvedPath, fileName, fileDir, fileExt);

    if (existingTestFiles.length > 0) {
      suggestions.push(...existingTestFiles);
    } else {
      // Suggest test files based on content analysis
      if (testType === 'ui') {
        suggestions.push(`tests/e2e/${fileName}.spec${fileExt}`);
        suggestions.push(`tests/unit/${fileName}.test${fileExt}`);
      } else if (testType === 'integration') {
        suggestions.push(`tests/integration/${fileName}.test${fileExt}`);

      } else if (testType === 'security-regression') {
        suggestions.push(`tests/security/${fileName}-sqli.test${fileExt}`);
        suggestions.push(`tests/security/${fileName}-auth.test${fileExt}`);
      } else {
        suggestions.push(`tests/unit/${fileName}.test${fileExt}`);
      }
    }

    plan.push({
      sourceFile: file,
      suggestedTestFiles: [...new Set(suggestions)],
      testType,
      notes: existingTestFiles.length > 0
        ? `Found ${existingTestFiles.length} existing test file(s)`
        : 'No existing tests found — suggested files to create',
    });
  }

  // Output
  if (args.format === 'json') {
    console.log(JSON.stringify({ feature: args.feature, plan, generatedAt: isoNow() }, null, 2));
  } else {
    const separator = '━'.repeat(31 + args.feature.length);
    console.log(`Test Plan: ${args.feature}`);
    console.log(separator);
    console.log('');

    for (const item of plan) {
      console.log(`File: ${item.sourceFile}`);
      console.log(`  Type: ${item.testType}`);
      console.log(`  ${item.notes}`);
      for (const suggestion of item.suggestedTestFiles) {
        const exists = fs.existsSync(path.resolve(suggestion));
        console.log(`  ${exists ? '✅' : '🆕'} ${suggestion}${exists ? ' (exists)' : ' (to create)'}`);
      }
      console.log('');
    }
  }
}

function findExistingTests(filePath: string, fileName: string, fileDir: string): string[] {
  const found: string[] = [];
  const searchDirs = ['tests/unit', 'tests/integration', 'tests/e2e', 'tests/security', '__tests__'];

  for (const dir of searchDirs) {
    // Common naming patterns
    const patterns = [
      path.join(dir, `${fileName}.test${fileExt}`),
      path.join(dir, `${fileName}.spec${fileExt}`),
      path.join(dir, `${fileName}-test${fileExt}`),
      path.join(dir, `${fileName}-spec${fileExt}`),
    ];

    // Also check with the directory prefix
    const dirPrefix = fileDir.replace(/\//g, '-');
    if (dirPrefix && dirPrefix !== '.') {
      patterns.push(path.join(dir, `${dirPrefix}-${fileName}.test${fileExt}`));
      patterns.push(path.join(dir, `${dirPrefix}-${fileName}.spec${fileExt}`));
    }

    for (const pattern of patterns) {
      const fullPath = path.resolve(pattern);
      if (fs.existsSync(fullPath)) {
        found.push(pattern);
      }
    }
  }

  return [...new Set(found)];
}

// ---------------------------------------------------------------------------
// Clean command
// ---------------------------------------------------------------------------

function cleanManifest(): void {
  const manifestPath = getManifestPath();

  if (!fs.existsSync(manifestPath)) {
    console.log('⏭️  No test manifest to clean.');
    return;
  }

  fs.unlinkSync(manifestPath);
  console.log(`🧹 Test manifest deleted: ${path.relative(process.cwd(), manifestPath)}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs();

  switch (args.command) {
    case 'generate':
      if (!args.manifest) {
        console.error('❌ --manifest is required for --generate');
        process.exit(1);
      }
      if (!args.feature) {
        console.error('❌ --feature is required for --generate');
        process.exit(1);
      }
      const outPath = getManifestPath(args.out);
      generateFromManifest(args.manifest, args.feature, outPath, args.format || 'yaml');
      break;

    case 'status':
      printStatus(args);
      break;

    case 'complete':
      markComplete(args);
      break;

    case 'start':
      markStarted(args);
      break;

    case 'wait':
      waitForTests(args);
      break;

    case 'plan':
      generateTestPlan(args);
      break;

    case 'clean':
      cleanManifest();
      break;

    default:
      printUsage();
      process.exit(1);
  }
}

main();
