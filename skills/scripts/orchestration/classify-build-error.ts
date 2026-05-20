#!/usr/bin/env ts-node
/**
 * Build Output Classifier & Verifier
 *
 * Analyzes build/lint output and classifies errors into categories.
 * Each category maps to a recommended resolution strategy.
 * Also verifies that build/lint output is genuine (not fabricated/truncated).
 *
 * Usage:
 *   ts-node classify-build-error.ts --output="<build-output-text>"
 *   ts-node classify-build-error.ts --file=<path-to-build-log>
 *   ts-node classify-build-error.ts --pipeline   (reads from agent-context.md)
 *   ts-node classify-build-error.ts --verify --output="<build-output-text>"
 *   ts-node classify-build-error.ts --verify --file=<path-to-build-log>
 *   ts-node classify-build-error.ts --verify --pipeline
 *
 * Exit codes:
 *   0 = Build passed (no errors, genuine output)
 *   1 = Build failed with classified errors or suspicious output
 *   2 = Parse error
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Types ──

type ErrorCategory =
  | 'import-error'
  | 'type-error'
  | 'syntax-error'
  | 'config-error'
  | 'dependency-error'
  | 'lint-error'
  | 'test-failure'
  | 'missing-export'
  | 'duplicate-identifier'
  | 'unknown-error'
  | 'suspicious-output';  // NEW — detected fabricated/truncated build output

interface ClassifiedError {
  category: ErrorCategory;
  message: string;
  file: string | null;
  line: number | null;
  column: number | null;
  recommendedAction: string;
  targetAgent: string;
}

interface ClassificationResult {
  passed: boolean;
  totalErrors: number;
  categories: Record<ErrorCategory, number>;
  errors: ClassifiedError[];
  summary: string;
}

// ── Build Output Verification Types ──

interface BuildOutputVerification {
  isGenuine: boolean;
  confidence: number;  // 0-100
  checks: {
    positivePatterns: { pattern: string; found: boolean; count: number }[];
    negativePatterns: { pattern: string; found: boolean; count: number }[];
    outputLength: { status: 'ok' | 'truncated' | 'too_short'; actual: number };
    exitCodeConsistency: { status: 'consistent' | 'inconsistent'; exitCodeClaimed: number; exitCodeActual: number };
    timestampFreshness: { status: 'fresh' | 'stale'; ageMs: number };
  };
  warningMessages: string[];
}

// ── Error Patterns ──

interface ErrorPattern {
  category: ErrorCategory;
  regex: RegExp;
  extractFile?: RegExp;
  extractLine?: RegExp;
  targetAgent: string;
  recommendedAction: string;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  // Import errors
  {
    category: 'import-error',
    regex: /Cannot find module|Cannot resolve|Module not found|module '.*' not found|unexpected module/i,
    targetAgent: 'integrator',
    recommendedAction: 'Fix import paths in the wiring files — the import target does not exist or the path is incorrect',
  },
  {
    category: 'import-error',
    regex: /is not a module|does not provide an export|has no exported member/i,
    targetAgent: 'integrator',
    recommendedAction: 'The imported module exists but does not export the requested symbol — check export names',
  },
  // Type errors
  {
    category: 'type-error',
    regex: /Type\s+['"].*?['"]\s+is not assignable|Type\s+.*?\s+is not assignable to type|Argument of type/i,
    targetAgent: 'fixer',
    recommendedAction: 'Type mismatch between caller and callee — check type signatures',
  },
  {
    category: 'type-error',
    regex: /Property\s+['"].*?['"]\s+does not exist on type/i,
    targetAgent: 'fixer',
    recommendedAction: 'Referencing a property that does not exist on the type definition',
  },
  {
    category: 'type-error',
    regex: /Object is possibly 'undefined'|Object is possibly 'null'|cannot be used as an index type/i,
    targetAgent: 'fixer',
    recommendedAction: 'Add null/undefined checks or use strict null checks',
  },
  // Syntax errors
  {
    category: 'syntax-error',
    regex: /Unexpected token|Missing semicolon|Missing initializer|Declaration or statement expected|Expression expected/i,
    targetAgent: 'implementor',
    recommendedAction: 'Fix syntax — missing semicolon, bracket, or malformed expression',
  },
  {
    category: 'syntax-error',
    regex: /Cannot find name\s+['"].*?['"]/i,
    targetAgent: 'implementor',
    recommendedAction: 'Referencing an undefined variable or type — check spelling or imports',
  },
  // Config errors
  {
    category: 'config-error',
    regex: /Unknown compiler option|tsconfig\.json|Invalid project|Cannot find tsconfig|Cannot write file/i,
    targetAgent: 'orchestrator',
    recommendedAction: 'TypeScript/compiler configuration issue — review tsconfig.json',
  },
  {
    category: 'config-error',
    regex: /eslint|prettier|\.eslintrc|\.prettierrc/i,
    targetAgent: 'orchestrator',
    recommendedAction: 'Linter configuration issue — review linter config files',
  },
  // Dependency errors
  {
    category: 'dependency-error',
    regex: /npm ERR|npm WARN|package\.json|Cannot find package|Module build failed|node_modules/i,
    targetAgent: 'orchestrator',
    recommendedAction: 'Missing or incompatible dependency — check package.json and run npm install',
  },
  // Lint errors
  {
    category: 'lint-error',
    regex: /is missing in props validation|is defined but never used|is assigned a value but never used|Expected.*but found|must be in camelcase|Strings must use/i,
    targetAgent: 'implementor',
    recommendedAction: 'Lint violation — fix the code style issue',
  },
  // Test failures
  {
    category: 'test-failure',
    regex: /FAIL|Tests:\s+\d+ failed|expect\(|AssertionError|Received:|Expected:|toBe|toEqual/i,
    targetAgent: 'fixer',
    recommendedAction: 'Test assertion failed — review the test expectations and fix the implementation',
  },
  // Missing exports
  {
    category: 'missing-export',
    regex: /is not exported from|Module has no exported member|attempted import.*but it's not exported|is not a module/i,
    targetAgent: 'implementor',
    recommendedAction: 'Add the missing export to the source file',
  },
  // Duplicate identifier
  {
    category: 'duplicate-identifier',
    regex: /Duplicate identifier|Cannot redeclare|conflicts with declaration/i,
    targetAgent: 'implementor',
    recommendedAction: 'Remove or rename the duplicate declaration',
  },
];

// ── Verification Constants ──

const POSITIVE_PATTERNS = [
  /Build succeeded/i,
  /Done/i,
  /0 errors/i,
  /compilation complete/i,
  /Successfully compiled/i,
];

const NEGATIVE_PATTERNS = [
  /error TS\d+/i,
  /Build failed/i,
  /Cannot find module/i,
  /ERR!/i,
  /^Error:/im,
  /Failed to compile/i,
];

const MIN_OUTPUT_LENGTH = 20;
const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000; // 5 minutes
const SUSPICIOUS_FAKE_STRINGS = [
  'Build succeeded',
  'Build passed',
  'Done',
  '0 errors',
  'No errors',
  'compilation complete',
  'Successfully compiled',
  'Build completed successfully',
  'All checks passed',
  'Lint passed',
  'Build successful',
];

// ── Verification ──

/**
 * Check whether the build/lint output appears to be GENUINE
 * rather than fabricated, truncated, or misleading.
 */
function verifyBuildOutput(output: string): BuildOutputVerification {
  const warningMessages: string[] = [];

  // ── Positive pattern checks ──
  const positivePatterns = POSITIVE_PATTERNS.map(pattern => {
    let count = 0;
    let match: RegExpExecArray | null;
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    while ((match = re.exec(output)) !== null) {
      count++;
    }
    return {
      pattern: pattern.source,
      found: count > 0,
      count,
    };
  });

  // ── Negative pattern checks ──
  const negativePatterns = NEGATIVE_PATTERNS.map(pattern => {
    let count = 0;
    let match: RegExpExecArray | null;
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    while ((match = re.exec(output)) !== null) {
      count++;
    }
    // For multi-line patterns, count matching lines
    const lineCount = output.split('\n').filter(line => pattern.test(line)).length;
    return {
      pattern: pattern.source,
      found: count > 0,
      count: lineCount || count,
    };
  });

  // ── Output length check ──
  const actualLength = output.length;
  let outputLengthStatus: 'ok' | 'truncated' | 'too_short';
  if (actualLength < MIN_OUTPUT_LENGTH) {
    outputLengthStatus = 'too_short';
    warningMessages.push(
      `Output is very short (${actualLength} chars) — minimum expected ${MIN_OUTPUT_LENGTH} chars`
    );
  } else {
    outputLengthStatus = 'ok';
  }

  // Check if output is exactly a common fake string with nothing else
  const trimmedOutput = output.trim();
  const isExactFake = SUSPICIOUS_FAKE_STRINGS.some(fake => {
    const normalizedOutput = trimmedOutput.replace(/\s+/g, ' ').trim().toLowerCase();
    const normalizedFake = fake.toLowerCase();
    return normalizedOutput === normalizedFake;
  });
  if (isExactFake) {
    outputLengthStatus = 'too_short';
    warningMessages.push(
      `Output is exactly the string "${trimmedOutput}" with no other content — this looks fabricated`
    );
  }

  // ── Exit code consistency ──
  // We cannot re-run the build without knowing the command, so we check
  // whether the output claims an exit code and flag if it's inconsistent
  // with any exit code mention in the output itself.
  const exitCodeClaimed = detectClaimedExitCode(output);
  const exitCodeActual = 0; // default — we can't know without re-running
  let exitCodeConsistencyStatus: 'consistent' | 'inconsistent';
  let exitCodeReportedClaimed = exitCodeClaimed;
  let exitCodeReportedActual = exitCodeActual;

  if (exitCodeClaimed !== null) {
    // If the output claims to have errors but has exit code 0, flag it
    const negativePatternFound = negativePatterns.some(p => p.found && p.count >= 3);
    if (negativePatternFound && exitCodeClaimed === 0) {
      exitCodeConsistencyStatus = 'inconsistent';
      exitCodeReportedActual = 1; // infer actual failure
      warningMessages.push(
        `Output contains error indicators (${negativePatterns.filter(p => p.found).length} negative patterns) but claims exit code 0`
      );
    } else if (!negativePatternFound && exitCodeClaimed !== 0) {
      // Output claims failure but no actual errors found — could be false positive
      exitCodeConsistencyStatus = 'inconsistent';
      warningMessages.push(
        `Output claims exit code ${exitCodeClaimed} but no error patterns were detected`
      );
    } else {
      exitCodeConsistencyStatus = 'consistent';
    }
  } else {
    // No exit code claimed in output — we can't verify consistency
    exitCodeConsistencyStatus = 'consistent';
    exitCodeReportedClaimed = -1;
    exitCodeReportedActual = -1;
  }

  // ── Timestamp freshness ──
  const timestamps = extractTimestamps(output);
  let timestampFreshnessStatus: 'fresh' | 'stale';
  let maxAgeMs = 0;

  if (timestamps.length > 0) {
    const now = Date.now();
    const ages = timestamps.map(ts => Math.abs(now - ts.getTime()));
    maxAgeMs = Math.max(...ages);
    timestampFreshnessStatus = maxAgeMs <= MAX_TIMESTAMP_AGE_MS ? 'fresh' : 'stale';
    if (timestampFreshnessStatus === 'stale') {
      warningMessages.push(
        `Timestamp in output is ${Math.round(maxAgeMs / 1000)}s old (limit: ${MAX_TIMESTAMP_AGE_MS / 1000}s)`
      );
    }
  } else {
    // No timestamps found — cannot verify freshness
    timestampFreshnessStatus = 'fresh';
    maxAgeMs = 0;
  }

  // ── Confidence calculation ──
  let confidence = 100;

  // Deduct for truncated/short output
  if (outputLengthStatus === 'too_short') confidence -= 25;
  if (isExactFake) confidence -= 25;

  // Deduct if exit code is inconsistent
  if (exitCodeConsistencyStatus === 'inconsistent') confidence -= 30;

  // Deduct if timestamps are stale
  if (timestampFreshnessStatus === 'stale') confidence -= 20;

  // Deduct for suspicious patterns
  const negativeWithContent = negativePatterns.filter(p => p.found && p.count >= 3);
  if (negativeWithContent.length > 0) {
    // This is actually a sign the output is REAL (contains real errors)
    // but we already handle this through classification; don't penalize verification
  }

  // Check for telltale signs of fabrication
  const fabricationSignals = detectFabricationSignals(output);
  confidence -= fabricationSignals.penalty;
  fabricationSignals.messages.forEach(m => warningMessages.push(m));

  confidence = Math.max(0, Math.min(100, confidence));

  const isGenuine = confidence >= 50;

  return {
    isGenuine,
    confidence,
    checks: {
      positivePatterns,
      negativePatterns,
      outputLength: { status: outputLengthStatus, actual: actualLength },
      exitCodeConsistency: {
        status: exitCodeConsistencyStatus,
        exitCodeClaimed: exitCodeReportedClaimed,
        exitCodeActual: exitCodeReportedActual,
      },
      timestampFreshness: { status: timestampFreshnessStatus, ageMs: maxAgeMs },
    },
    warningMessages,
  };
}

/**
 * Detect claimed exit codes in build output (e.g., "Process finished with exit code 0",
 * "Exit code: 1", or the absence of such claims).
 */
function detectClaimedExitCode(output: string): number | null {
  const exitPatterns = [
    /exit code\s*[:\s]+(\d+)/i,
    /process\s+(finished|exited|ended)\s+(with\s+)?exit\s+code\s+(\d+)/i,
    /exited with code\s+(\d+)/i,
    /Exit\s*:\s*(\d+)/i,
  ];
  for (const pattern of exitPatterns) {
    const match = output.match(pattern);
    if (match) {
      const code = parseInt(match[match.length - 1], 10);
      if (!isNaN(code)) return code;
    }
  }
  return null;
}

/**
 * Extract ISO 8601 and other common timestamp formats from output.
 */
function extractTimestamps(output: string): Date[] {
  const timestamps: Date[] = [];
  // ISO 8601: 2024-01-15T10:30:00.000Z or 2024-01-15T10:30:00+00:00
  const isoPattern = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})/g;
  let match: RegExpExecArray | null;
  while ((match = isoPattern.exec(output)) !== null) {
    const d = new Date(match[0]);
    if (!isNaN(d.getTime())) timestamps.push(d);
  }
  // Unix timestamps (10 digits): 1705321800
  const unixPattern = /\b(1[6-9]\d{8})\b/g;
  while ((match = unixPattern.exec(output)) !== null) {
    const d = new Date(parseInt(match[1], 10) * 1000);
    if (!isNaN(d.getTime())) timestamps.push(d);
  }
  // HH:MM:SS timestamps (relative, check if they could be recent)
  // Only match if there's also a date nearby
  return timestamps;
}

/**
 * Detect telltale signs of fabricated build output.
 */
function detectFabricationSignals(output: string): { penalty: number; messages: string[] } {
  let penalty = 0;
  const messages: string[] = [];

  // Signal 1: Output contains no line breaks (single line)
  const lines = output.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 1 && output.length > 0 && output.length < 200) {
    penalty += 15;
    messages.push('Output is a single line — real build output typically spans multiple lines');
  }

  // Signal 2: Perfectly repetitive output (e.g., same line repeated)
  const uniqueLines = new Set(lines);
  if (lines.length >= 5 && uniqueLines.size === 1) {
    penalty += 20;
    messages.push('Output consists of the same line repeated — looks fabricated');
  }

  // Signal 3: Contains phrases that suggest the output was written by an AI assistant
  const aiPhrases = [
    /the build (succeeded|passed|completed)/i,
    /as expected/i,
    /no (errors|issues) found/i,
    /everything looks good/i,
    /i (ran|executed|performed) the build/i,
    /the linter (passed|reported no errors)/i,
  ];
  const aiPhraseCount = aiPhrases.filter(p => p.test(output)).length;
  if (aiPhraseCount >= 2) {
    penalty += 10 * aiPhraseCount;
    messages.push(
      `Output contains ${aiPhraseCount} phrase(s) typical of AI-generated summaries (e.g., "as expected", "the build succeeded")`
    );
  }

  // Signal 4: No error output despite claiming errors
  // (handled in exit code consistency check)

  return { penalty, messages };
}

// ── Classification ──

function classifyBuildOutput(output: string): ClassificationResult {
  const errors: ClassifiedError[] = [];
  const categories: Record<ErrorCategory, number> = {
    'import-error': 0,
    'type-error': 0,
    'syntax-error': 0,
    'config-error': 0,
    'dependency-error': 0,
    'lint-error': 0,
    'test-failure': 0,
    'missing-export': 0,
    'duplicate-identifier': 0,
    'unknown-error': 0,
    'suspicious-output': 0,
  };

  const lines = output.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let matched = false;

    for (const pattern of ERROR_PATTERNS) {
      if (pattern.regex.test(trimmed)) {
        // Extract file and line info
        let file: string | null = null;
        let lineNum: number | null = null;
        let col: number | null = null;

        // Common pattern: "src/file.ts:12:34 - error TS..."
        const fileMatch = trimmed.match(/([\w/.-]+\.[a-z]+)(?:\((\d+),(\d+)\))?(?::(\d+)(?::(\d+))?)?/);
        if (fileMatch) {
          file = fileMatch[1];
          lineNum = fileMatch[4] ? parseInt(fileMatch[4], 10) : null;
          col = fileMatch[5] ? parseInt(fileMatch[5], 10) : null;
        }

        errors.push({
          category: pattern.category,
          message: trimmed,
          file,
          line: lineNum,
          column: col,
          recommendedAction: pattern.recommendedAction,
          targetAgent: pattern.targetAgent,
        });

        categories[pattern.category]++;
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Check if line looks like an error (contains "error" or "Error")
      if (/\berror\b/i.test(trimmed) || /^Error:/i.test(trimmed)) {
        errors.push({
          category: 'unknown-error',
          message: trimmed,
          file: null,
          line: null,
          column: null,
          recommendedAction: 'Unclassified error — manual review required',
          targetAgent: 'implementor',
        });
        categories['unknown-error']++;
      }
    }
  }

  // Build summary
  const totalErrors = errors.length;
  const nonEmptyCategories = Object.entries(categories)
    .filter(([_, count]) => count > 0)
    .sort(([_, a], [__, b]) => b - a);

  let summary: string;
  if (totalErrors === 0) {
    summary = '✅ Build passed — no errors detected';
  } else {
    const topCategory = nonEmptyCategories[0];
    const topAgent = errors.find(e => e.category === topCategory[0])?.targetAgent || 'implementor';
    summary = `❌ ${totalErrors} error(s) detected. Most common: ${topCategory[0]} (${topCategory[1]}). Route to: ${topAgent}.`;
  }

  const passed = totalErrors === 0;

  return { passed, totalErrors, categories, errors, summary };
}

/**
 * Add suspicious-output error entries when verification flags the output.
 */
function addSuspiciousOutputErrors(
  result: ClassificationResult,
  verification: BuildOutputVerification
): ClassificationResult {
  if (verification.isGenuine) return result;

  const suspiciousError: ClassifiedError = {
    category: 'suspicious-output',
    message: `Build output verification failed (confidence: ${verification.confidence}%)`,
    file: null,
    line: null,
    column: null,
    recommendedAction: 'Build output appears to be fabricated or truncated — verify manually',
    targetAgent: 'orchestrator',
  };

  result.errors.unshift(suspiciousError);
  result.categories['suspicious-output']++;
  result.totalErrors++;
  result.passed = false;
  result.summary = `❌ Suspicious build output detected (confidence: ${verification.confidence}%). Route to: orchestrator for manual review.`;

  return result;
}

// ── Output ──

function printResult(result: ClassificationResult): void {
  const icon = result.passed ? '✅' : '❌';
  console.log(`\n${icon} Build Output Classification`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Passed: ${result.passed}`);
  if (!result.passed) {
    console.log(`Total errors: ${result.totalErrors}`);
    console.log();
    console.log('Error Categories:');
    for (const [category, count] of Object.entries(result.categories)) {
      if (count > 0) {
        console.log(`  ${count}x ${category}`);
      }
    }
    console.log();
    console.log('Recommendation:');
    // Group by target agent
    const byAgent: Record<string, string[]> = {};
    for (const err of result.errors) {
      if (!byAgent[err.targetAgent]) byAgent[err.targetAgent] = [];
      byAgent[err.targetAgent].push(err.recommendedAction);
    }
    for (const [agent, actions] of Object.entries(byAgent)) {
      const uniqueActions = [...new Set(actions)];
      console.log(`  Route to ${agent}:`);
      for (const action of uniqueActions) {
        console.log(`    → ${action}`);
      }
    }
    console.log();
    console.log('First 5 errors:');
    for (const err of result.errors.slice(0, 5)) {
      const loc = err.file ? `${err.file}:${err.line || '?'}:${err.column || '?'}` : '(unknown location)';
      console.log(`  [${err.category}] ${loc}`);
      console.log(`    ${err.message.slice(0, 150)}`);
    }
  }
  console.log(`\n${result.summary}`);
}

/**
 * Print verification results alongside classification.
 */
function printVerificationResult(
  result: ClassificationResult,
  verification: BuildOutputVerification
): void {
  console.log(`\n🔍 Build Output Verification`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Genuine: ${verification.isGenuine ? 'YES' : 'NO'} (confidence: ${verification.confidence}%)`);
  console.log('Checks:');

  // Positive patterns
  const positiveFound = verification.checks.positivePatterns.filter(p => p.found).length;
  const positiveTotal = verification.checks.positivePatterns.length;
  console.log(`  ${positiveFound === positiveTotal ? '✅' : '⚠️'} Positive patterns found: ${positiveFound}/${positiveTotal}`);
  for (const p of verification.checks.positivePatterns) {
    const icon = p.found ? '✅' : '⬜';
    console.log(`     ${icon} /${p.pattern}/ — found ${p.count}x`);
  }

  // Negative patterns
  const negativeFound = verification.checks.negativePatterns.filter(p => p.found && p.count >= 3).length;
  console.log(`  ${negativeFound === 0 ? '✅' : '⚠️'} Negative patterns absent: ${negativeFound} found with ≥3 matches`);
  for (const p of verification.checks.negativePatterns) {
    if (p.found && p.count >= 3) {
      console.log(`     ❌ /${p.pattern}/ — found ${p.count}x (suspicious)`);
    } else if (p.found) {
      console.log(`     ⬜ /${p.pattern}/ — found ${p.count}x (below threshold)`);
    }
  }

  // Output length
  const lengthIcon = verification.checks.outputLength.status === 'ok' ? '✅' : '❌';
  console.log(`  ${lengthIcon} Output length: ${verification.checks.outputLength.actual} chars (${verification.checks.outputLength.status})`);

  // Exit code consistency
  const exitIcon = verification.checks.exitCodeConsistency.status === 'consistent' ? '✅' : '❌';
  console.log(`  ${exitIcon} Exit code consistency: claimed ${verification.checks.exitCodeConsistency.exitCodeClaimed}, actual ${verification.checks.exitCodeConsistency.exitCodeActual} (${verification.checks.exitCodeConsistency.status})`);

  // Timestamp freshness
  if (verification.checks.timestampFreshness.ageMs > 0) {
    const tsIcon = verification.checks.timestampFreshness.status === 'fresh' ? '✅' : '❌';
    const ageSec = Math.round(verification.checks.timestampFreshness.ageMs / 1000);
    console.log(`  ${tsIcon} Timestamp: ${ageSec}s old (${verification.checks.timestampFreshness.status})`);
  } else {
    console.log(`  ⏱️  Timestamp: no timestamps found in output`);
  }

  // Warnings
  if (verification.warningMessages.length > 0) {
    console.log();
    console.log('⚠️  Warnings:');
    for (const msg of verification.warningMessages) {
      console.log(`  • ${msg}`);
    }
  }

  // Then print standard classification
  console.log();
  printResult(result);
}

// ── Pipeline Mode ──

function readBuildOutputFromPipeline(): string | null {
  const contextPath = path.resolve('agent-context.md');
  if (!fs.existsSync(contextPath)) return null;

  const content = fs.readFileSync(contextPath, 'utf-8');
  // Try to extract buildOutput from various agent blocks
  const buildOutputMatch = content.match(/buildOutput:\s*"([^"]*)"|buildOutput:\s*'([^']*)'/);
  return buildOutputMatch ? (buildOutputMatch[1] || buildOutputMatch[2]) : null;
}

// ── Main ──

function main(): void {
  const args = process.argv.slice(2);
  const outputArg = args.find(a => a.startsWith('--output='));
  const fileArg = args.find(a => a.startsWith('--file='));
  const pipelineArg = args.includes('--pipeline');
  const verifyArg = args.includes('--verify');

  let output: string | null = null;

  if (pipelineArg) {
    output = readBuildOutputFromPipeline();
    if (!output) {
      console.log('No build output found in agent-context.md');
      process.exit(0);
    }
  } else if (fileArg) {
    const filePath = fileArg.split('=')[1];
    const resolvedPath = path.resolve(filePath);
    // Path traversal protection: ensure resolved path stays within the workspace
    const workspaceDir = path.resolve(process.cwd());
    if (!resolvedPath.startsWith(workspaceDir + path.sep) && resolvedPath !== workspaceDir) {
      console.error(`Access denied: ${resolvedPath} is outside the workspace (${workspaceDir})`);
      process.exit(2);
    }
    if (!fs.existsSync(resolvedPath)) {
      console.error(`File not found: ${resolvedPath}`);
      process.exit(2);
    }
    output = fs.readFileSync(resolvedPath, 'utf-8');
  } else if (outputArg) {
    output = outputArg.split('=')[1];
  }

  if (!output) {
    console.error(`
Usage:
  ts-node classify-build-error.ts --output="<build-output-text>"
  ts-node classify-build-error.ts --file=<path-to-build-log>
  ts-node classify-build-error.ts --pipeline

  With verification:
  ts-node classify-build-error.ts --verify --output="<build-output-text>"
  ts-node classify-build-error.ts --verify --file=<path-to-build-log>
  ts-node classify-build-error.ts --verify --pipeline

Options:
  --output=<text>    Classify/verify inline build output
  --file=<path>      Classify/verify build output from a file
  --pipeline         Read build output from agent-context.md
  --verify           Run build output verification to detect fabricated/truncated output

Exit codes:
  0 = Build passed (no errors, genuine output if --verify used)
  1 = Build failed with classified errors or suspicious output
  2 = Parse error
`);
    process.exit(2);
  }

  // Run classification
  const result = classifyBuildOutput(output);

  if (verifyArg) {
    // Run verification
    const verification = verifyBuildOutput(output);

    // If verification fails, add suspicious-output errors to the classification
    const finalResult = addSuspiciousOutputErrors(result, verification);

    // Print verification + classification together
    printVerificationResult(finalResult, verification);

    // Exit with error if verification failed OR classification has errors
    process.exit(verification.isGenuine && result.passed ? 0 : 1);
  } else {
    // Standard classification only
    printResult(result);
    process.exit(result.passed ? 0 : 1);
  }
}

main();
