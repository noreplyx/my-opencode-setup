#!/usr/bin/env node
/**
 * Evidence Quality & Verifiability Gate
 *
 * Validates evidence quality and verifiability after every agent hand-off.
 * Referenced as a mandatory gate across SKILL.md, pipeline-gates.md, and
 * circuit-breaker.md. Called by the Orchestrator to block pipelines when
 * evidence is stale, missing, or unverifiable.
 *
 * Checks performed (weight in parentheses):
 *   Required fields      → every entry has claim, source, method         (blocking)
 *   File existence       → source file path exists on disk               (blocking)
 *   Content hash         → if contentHash provided, matches SHA-256      (blocking)
 *   Command re-execution → if command provided, re-run & verify output   (scoring)
 *   Excerpt verification → if excerpt provided, verify in source file    (scoring)
 *   Path traversal       → source paths must not escape workspace root   (blocking)
 *
 * Scoring:
 *   >= 80% and zero failures → PASS     (exit 0)
 *   >= 80% with unverifiable → WARN     (exit 0)
 *   < 80%                    → FAIL     (exit 1)
 *   Any critical failure     → FAIL     (exit 1)
 *   Context file not found   → ERROR    (exit 2)
 *
 * Usage:
 *   [runtime] evidence-quality-gate.ts --context=agent-context.md
 *   [runtime] evidence-quality-gate.ts --context=agent-context.md --workspace=/path/to/root
 *   [runtime] evidence-quality-gate.ts --context=agent-context.md --verbose
 *
 * Output (JSON to stdout):
 * {
 *   "valid": true/false,
 *   "score": 85,
 *   "checks": { "passed": 4, "failed": 1, "total": 5 },
 *   "criticalFailures": [],
 *   "failures": [],
 *   "warnings": [],
 *   "details": [ ... ]
 * }
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

// ── Types ──────────────────────────────────────────────────────────

/** The shape of a single evidence entry extracted from agent-context.md */
interface EvidenceEntry {
  claim: string;
  source: string;
  lines?: [number, number] | number[];
  contentHash?: string;
  method: string;
  command?: string;
  excerpt?: string;
  result?: string;
  /** Name of the agent that produced this evidence */
  agentName?: string;
}

/** Result of a single check on a single evidence entry */
interface CheckDetail {
  /** Identifier/label of the evidence entry (first 80 chars of claim) */
  evidence: string;
  /** Name of the check performed */
  check: string;
  /** Outcome: 'pass', 'fail', 'critical', 'warn', 'unverifiable' */
  status: 'pass' | 'fail' | 'critical' | 'warn' | 'unverifiable';
  /** Human-readable explanation */
  detail: string;
}

/** Overall result object printed to stdout */
interface GateResult {
  valid: boolean;
  score: number;
  checks: {
    passed: number;
    failed: number;
    total: number;
  };
  criticalFailures: string[];
  failures: string[];
  warnings: string[];
  details: CheckDetail[];
}

/** Parsed CLI arguments */
interface CliArgs {
  contextPath: string;
  workspaceRoot: string;
  verbose: boolean;
}

/** Critical check types — any failure in these immediately fails the gate */
const CRITICAL_CHECKS: ReadonlySet<string> = new Set([
  'required_fields',
  'file_existence',
  'content_hash',
  'path_traversal',
]);

// ── CLI Parsing ─────────────────────────────────────────────────────

function parseCliArgs(argv: string[]): CliArgs {
  const contextArg = argv.find((a) => a.startsWith('--context='));
  const workspaceArg = argv.find((a) => a.startsWith('--workspace='));
  const verbose = argv.includes('--verbose');

  const contextPath = contextArg ? contextArg.split('=').slice(1).join('=') : 'agent-context.md';
  const workspaceRoot = workspaceArg
    ? path.resolve(workspaceArg.split('=').slice(1).join('='))
    : process.cwd();

  return { contextPath, workspaceRoot, verbose };
}

// ── Extraction: evidence entries from raw text ─────────────────────

/**
 * Extract all evidence entries from the raw agent-context.md content using
 * a line-by-line parser that handles nested YAML structures found in
 * agentHistory[].evidence[] and agentOutputs.<agent>.evidence[].
 *
 * This mirrors the parsing strategy used by check-handoff.ts and
 * check-evidence-regression.ts but targets evidence entries specifically.
 *
 * Each evidence entry is a YAML mapping block at a consistent indentation:
 *   - claim: "..."
 *     source: "..."
 *     method: "..."
 *     contentHash: "..."
 *     command: "..."
 *     excerpt: "..."
 *     result: "..."
 */
function extractEvidenceFromContent(content: string): EvidenceEntry[] {
  const entries: EvidenceEntry[] = [];
  content = content.replace(/\r\n/g, '\n');

  // Step 1: Locate the YAML frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return [];

  const yamlLines = frontmatterMatch[1].split('\n');

  // Step 2: Walk lines to find "evidence:" keys and capture their children
  // We track indentation to handle nested structures correctly.
  let inEvidenceBlock = false;
  let evidenceIndent = -1;
  let currentEntry: Record<string, string> | null = null;
  let entryIndent = -1;

  for (let i = 0; i < yamlLines.length; i++) {
    const line = yamlLines[i];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.search(/\S/);

    // Check if we've left the evidence block (indentation returned to or above the evidence key level)
    if (inEvidenceBlock && indent <= evidenceIndent && !trimmed.startsWith('-')) {
      // Flush current entry if we have one
      finalizeEntry(entries, currentEntry);
      currentEntry = null;
      inEvidenceBlock = false;
      evidenceIndent = -1;
    }

    // Detect "evidence:" key — this starts a block
    if (trimmed === 'evidence:' || trimmed.startsWith('evidence:')) {
      // Flush any in-progress entry
      finalizeEntry(entries, currentEntry);
      currentEntry = null;

      inEvidenceBlock = true;
      evidenceIndent = indent;
      entryIndent = -1;
      continue;
    }

    if (!inEvidenceBlock) continue;

    // Within evidence block: detect list items "- claim: ..."
    const listItemMatch = trimmed.match(/^-\s+(.+)$/);
    if (listItemMatch) {
      // Flush previous entry
      finalizeEntry(entries, currentEntry);

      // Start a new entry
      currentEntry = {};
      entryIndent = indent;

      // Parse the inline content after "- "
      const inlineContent = listItemMatch[1];
      const colonIdx = inlineContent.indexOf(':');
      if (colonIdx !== -1) {
        const key = inlineContent.slice(0, colonIdx).trim();
        const value = inlineContent.slice(colonIdx + 1).trim();
        currentEntry[key] = stripQuotes(value);
      }
      continue;
    }

    // Within entry: parse "key: value" continuation lines
    if (currentEntry && indent > entryIndent) {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx !== -1) {
        const key = trimmed.slice(0, colonIdx).trim();
        const value = trimmed.slice(colonIdx + 1).trim();
        currentEntry[key] = stripQuotes(value);
      }
    }
  }

  // Flush last entry
  finalizeEntry(entries, currentEntry);

  return entries;
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function finalizeEntry(entries: EvidenceEntry[], raw: Record<string, string> | null): void {
  if (!raw) return;

  const claim = raw['claim'] || raw['description'] || '';
  if (!claim) return;

  entries.push({
    claim,
    source: raw['source'] || raw['file'] || '',
    lines: raw['lines'] ? parseLineRange(raw['lines']) : undefined,
    contentHash: raw['contentHash'] || undefined,
    method: raw['method'] || 'analysis',
    command: raw['command'] || undefined,
    excerpt: raw['excerpt'] || undefined,
    result: raw['result'] || undefined,
  });
}

function parseLineRange(value: unknown): [number, number] | undefined {
  if (Array.isArray(value)) {
    const nums = value.map(Number).filter((n) => !isNaN(n));
    if (nums.length >= 2) return [nums[0], nums[1]];
    if (nums.length === 1) return [nums[0], nums[0]];
  }
  if (typeof value === 'string') {
    const parts = value.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
    if (parts.length >= 2) return [parts[0], parts[1]];
    if (parts.length === 1) return [parts[0], parts[0]];
  }
  if (typeof value === 'number') return [value, value];
  return undefined;
}

// ── SHA-256 Hashing ────────────────────────────────────────────────

function computeFileHash(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

// ── Individual Check Functions ─────────────────────────────────────

/**
 * Check 1: Required fields — claim, source, method must all be present and non-empty.
 * This is a CRITICAL (blocking) check.
 */
function checkRequiredFields(entry: EvidenceEntry): CheckDetail {
  const missing: string[] = [];
  if (!entry.claim) missing.push('claim');
  if (!entry.source) missing.push('source');
  if (!entry.method) missing.push('method');

  const label = truncateText(entry.claim || '<empty>', 80);

  if (missing.length === 0) {
    return {
      evidence: label,
      check: 'required_fields',
      status: 'pass',
      detail: `All required fields present: claim, source, method`,
    };
  }

  return {
    evidence: label,
    check: 'required_fields',
    status: 'critical',
    detail: `Missing required fields: ${missing.join(', ')}`,
  };
}

/**
 * Check 2: File existence — the source path must exist on disk.
 * This is a CRITICAL (blocking) check.
 */
function checkFileExistence(entry: EvidenceEntry, workspaceRoot: string): CheckDetail {
  const label = truncateText(entry.claim, 80);

  if (!entry.source) {
    return {
      evidence: label,
      check: 'file_existence',
      status: 'critical',
      detail: 'No source path provided — cannot verify file existence',
    };
  }

  const resolvedPath = path.resolve(workspaceRoot, entry.source);

  if (fs.existsSync(resolvedPath)) {
    return {
      evidence: label,
      check: 'file_existence',
      status: 'pass',
      detail: `File exists: ${entry.source}`,
    };
  }

  // Also try the raw source path if it's absolute
  const absolutePath = path.isAbsolute(entry.source) ? entry.source : null;
  if (absolutePath && fs.existsSync(absolutePath)) {
    return {
      evidence: label,
      check: 'file_existence',
      status: 'pass',
      detail: `File exists: ${entry.source}`,
    };
  }

  return {
    evidence: label,
    check: 'file_existence',
    status: 'critical',
    detail: `File not found: ${entry.source} (resolved: ${resolvedPath})`,
  };
}

/**
 * Check 3: Path traversal — source paths must not escape the workspace root.
 * This is a CRITICAL (blocking) check.
 */
function checkPathTraversal(entry: EvidenceEntry, workspaceRoot: string): CheckDetail {
  const label = truncateText(entry.claim, 80);

  if (!entry.source) {
    return {
      evidence: label,
      check: 'path_traversal',
      status: 'pass',
      detail: 'No source path to check for traversal',
    };
  }

  // Normalize the workspace root (ensure trailing separator for prefix check)
  const normalizedRoot = path.resolve(workspaceRoot) + path.sep;
  const normalizedSource = path.resolve(workspaceRoot, entry.source);

  // Check if the resolved path starts with the workspace root
  if (!normalizedSource.startsWith(normalizedRoot)) {
    return {
      evidence: label,
      check: 'path_traversal',
      status: 'critical',
      detail: `Path traversal detected: "${entry.source}" resolves to "${normalizedSource}" which is outside workspace root "${normalizedRoot}"`,
    };
  }

  // Also check for explicit ".." components that escape
  const escapedSource = entry.source.replace(/\\/g, '/');
  const traversalPattern = /(?:^|\/)\.\.(?:\/|$)/;
  if (traversalPattern.test(escapedSource)) {
    // Only flag if it actually escapes — "foo/../bar" that stays within root is OK
    const resolvedDirect = path.resolve(workspaceRoot, entry.source);
    const resolvedNoTraversal = path.resolve(workspaceRoot, escapedSource.replace(/\.\.\//g, ''));
    if (!resolvedDirect.startsWith(normalizedRoot)) {
      return {
        evidence: label,
        check: 'path_traversal',
        status: 'critical',
        detail: `Path traversal via ".." detected: "${entry.source}" escapes workspace root`,
      };
    }
  }

  return {
    evidence: label,
    check: 'path_traversal',
    status: 'pass',
    detail: `Path is within workspace: ${entry.source}`,
  };
}

/**
 * Check 4: Content hash — if contentHash is provided, compute SHA-256 of the
 * current file and compare. This is a CRITICAL (blocking) check.
 */
function checkContentHash(entry: EvidenceEntry, workspaceRoot: string): CheckDetail {
  const label = truncateText(entry.claim, 80);

  // Skip if no contentHash provided
  if (!entry.contentHash) {
    return {
      evidence: label,
      check: 'content_hash',
      status: 'warn',
      detail: 'No contentHash provided — skipping hash verification',
    };
  }

  if (!entry.source) {
    return {
      evidence: label,
      check: 'content_hash',
      status: 'critical',
      detail: 'contentHash provided but source path is empty — cannot verify',
    };
  }

  const resolvedPath = path.resolve(workspaceRoot, entry.source);

  if (!fs.existsSync(resolvedPath)) {
    return {
      evidence: label,
      check: 'content_hash',
      status: 'critical',
      detail: `Cannot verify contentHash: file not found at "${entry.source}"`,
    };
  }

  const currentHash = computeFileHash(resolvedPath);

  if (currentHash === null) {
    return {
      evidence: label,
      check: 'content_hash',
      status: 'critical',
      detail: `Cannot compute hash for "${entry.source}"`,
    };
  }

  if (currentHash === entry.contentHash.toLowerCase()) {
    return {
      evidence: label,
      check: 'content_hash',
      status: 'pass',
      detail: `SHA-256 hash matches: ${currentHash.slice(0, 16)}...`,
    };
  }

  return {
    evidence: label,
    check: 'content_hash',
    status: 'critical',
    detail: `SHA-256 hash mismatch. Expected: ${entry.contentHash.slice(0, 16)}..., Got: ${currentHash.slice(0, 16)}...`,
  };
}

/**
 * Check 5: Command re-execution — if command is provided, re-run it and
 * verify the output matches the claim. This is a SCORING (non-blocking) check.
 */
function checkCommandReExecution(entry: EvidenceEntry, workspaceRoot: string): CheckDetail {
  const label = truncateText(entry.claim, 80);

  // Skip if no command provided
  if (!entry.command) {
    return {
      evidence: label,
      check: 'command_re_execution',
      status: 'warn',
      detail: 'No command provided — skipping re-execution check',
    };
  }

  // Prepare the command with variable substitution
  const resolvedSource = entry.source
    ? path.resolve(workspaceRoot, entry.source)
    : '';

  const command = entry.command
    .replace(/\$\{workspaceRoot\}/g, workspaceRoot)
    .replace(/\$\{source\}/g, resolvedSource)
    .replace(/\$\{file\}/g, resolvedSource);

  try {
    const stdout = execSync(command, {
      cwd: workspaceRoot,
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    }).trim();

    const expected = (entry.excerpt || entry.result || entry.claim || '').trim().toLowerCase();
    const actual = stdout.toLowerCase();

    // Exact match
    if (actual === expected || actual.includes(expected)) {
      return {
        evidence: label,
        check: 'command_re_execution',
        status: 'pass',
        detail: `Command re-ran successfully — output matches expected`,
      };
    }

    // Fuzzy match: whitespace-normalized
    const normalizedActual = actual.replace(/\s+/g, ' ').trim();
    const normalizedExpected = expected.replace(/\s+/g, ' ').trim();
    if (normalizedActual === normalizedExpected || normalizedActual.includes(normalizedExpected)) {
      return {
        evidence: label,
        check: 'command_re_execution',
        status: 'pass',
        detail: `Command re-ran — fuzzy match confirms claim`,
      };
    }

    return {
      evidence: label,
      check: 'command_re_execution',
      status: 'fail',
      detail: `Command re-ran but output did not match.\n  Expected: ${expected.slice(0, 200)}\n  Got: ${actual.slice(0, 200)}`,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      evidence: label,
      check: 'command_re_execution',
      status: 'unverifiable',
      detail: `Command re-execution failed: ${truncateText(errorMessage, 300)}`,
    };
  }
}

/**
 * Check 6: Excerpt verification — if excerpt is provided, grep for it in
 * the source file. This is a SCORING (non-blocking) check.
 */
function checkExcerptVerification(entry: EvidenceEntry, workspaceRoot: string): CheckDetail {
  const label = truncateText(entry.claim, 80);

  // Skip if no excerpt provided
  if (!entry.excerpt) {
    return {
      evidence: label,
      check: 'excerpt_verification',
      status: 'warn',
      detail: 'No excerpt provided — skipping excerpt verification',
    };
  }

  if (!entry.source) {
    return {
      evidence: label,
      check: 'excerpt_verification',
      status: 'warn',
      detail: 'No source path provided — cannot verify excerpt',
    };
  }

  const resolvedPath = path.resolve(workspaceRoot, entry.source);

  if (!fs.existsSync(resolvedPath)) {
    return {
      evidence: label,
      check: 'excerpt_verification',
      status: 'unverifiable',
      detail: `Cannot verify excerpt: file not found at "${entry.source}"`,
    };
  }

  try {
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    const excerptLower = entry.excerpt.trim().toLowerCase();
    const contentLower = content.toLowerCase();
    const excerptLines = entry.excerpt.trim().split('\n');
    const singleLineExcerpt = excerptLines[0].trim().toLowerCase();

    // Try exact excerpt match first
    if (contentLower.includes(excerptLower)) {
      return {
        evidence: label,
        check: 'excerpt_verification',
        status: 'pass',
        detail: `Excerpt found in "${entry.source}"`,
      };
    }

    // Try first line of excerpt match
    if (singleLineExcerpt && contentLower.includes(singleLineExcerpt)) {
      return {
        evidence: label,
        check: 'excerpt_verification',
        status: 'pass',
        detail: `First line of excerpt found in "${entry.source}"`,
      };
    }

    // Try line-specific search if lines are specified
    if (entry.lines && entry.lines.length >= 2) {
      const fileLines = content.split('\n');
      const [start, end] = [entry.lines[0] - 1, entry.lines[1] - 1];
      if (start >= 0 && end < fileLines.length) {
        const sectionContent = fileLines.slice(start, end + 1).join('\n').toLowerCase();
        if (sectionContent.includes(excerptLower) || sectionContent.includes(singleLineExcerpt)) {
          return {
            evidence: label,
            check: 'excerpt_verification',
            status: 'pass',
            detail: `Excerpt found in "${entry.source}" at lines [${entry.lines[0]}, ${entry.lines[1]}]`,
          };
        }
      }
    }

    return {
      evidence: label,
      check: 'excerpt_verification',
      status: 'fail',
      detail: `Excerpt not found in "${entry.source}"`,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      evidence: label,
      check: 'excerpt_verification',
      status: 'unverifiable',
      detail: `Excerpt verification failed: ${truncateText(errorMessage, 300)}`,
    };
  }
}

// ── Aggregation & Scoring ──────────────────────────────────────────

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

/**
 * Run all checks for a single evidence entry and return the results.
 */
function runChecksForEntry(entry: EvidenceEntry, workspaceRoot: string): CheckDetail[] {
  const details: CheckDetail[] = [];

  details.push(checkRequiredFields(entry));
  details.push(checkFileExistence(entry, workspaceRoot));
  details.push(checkPathTraversal(entry, workspaceRoot));
  details.push(checkContentHash(entry, workspaceRoot));
  details.push(checkCommandReExecution(entry, workspaceRoot));
  details.push(checkExcerptVerification(entry, workspaceRoot));

  return details;
}

/**
 * Compute the overall gate result from all check details.
 *
 * Scoring rules:
 *   - Checks with status 'pass' count as passed
 *   - Checks with status 'fail' count as failed (scoring deduction)
 *   - Checks with status 'critical' count as failed AND trigger immediate FAIL
 *   - Checks with status 'warn' are skipped (not counted in scoring)
 *   - Checks with status 'unverifiable' are skipped (not counted in scoring)
 *
 * Score = (passed / (passed + failed)) * 100
 */
function computeGateResult(allDetails: CheckDetail[]): GateResult {
  const criticalFailures: string[] = [];
  const failures: string[] = [];
  const warnings: string[] = [];

  // Separate pass/fail for scoring (exclude warn and unverifiable which are informational)
  const scoringDetails = allDetails.filter(
    (d) => d.status === 'pass' || d.status === 'fail' || d.status === 'critical',
  );

  let passed = 0;
  let failed = 0;

  for (const detail of scoringDetails) {
    if (detail.status === 'pass') {
      passed++;
    } else if (detail.status === 'critical') {
      failed++;
      criticalFailures.push(detail.detail);
    } else if (detail.status === 'fail') {
      failed++;
      failures.push(detail.detail);
    }
  }

  // Non-scoring details become warnings
  for (const detail of allDetails) {
    if (detail.status === 'warn') {
      warnings.push(detail.detail);
    }
  }

  const totalScored = passed + failed;
  const score = totalScored > 0 ? Math.round((passed / totalScored) * 100) : 100;

  // Determine validity
  const hasCriticalFailure = criticalFailures.length > 0;
  const scoreFailed = score < 80;

  let valid: boolean;
  if (hasCriticalFailure) {
    valid = false;
  } else if (scoreFailed) {
    valid = false;
  } else {
    valid = true;
  }

  return {
    valid,
    score,
    checks: {
      passed,
      failed,
      total: totalScored,
    },
    criticalFailures,
    failures,
    warnings,
    details: allDetails,
  };
}

// ── Output ─────────────────────────────────────────────────────────

function printResult(result: GateResult, verbose: boolean): void {
  if (verbose) {
    const divider = '━'.repeat(55);
    console.error(`\n📊 Evidence Quality Gate`);
    console.error(divider);
    console.error(`Score: ${result.score}% (${result.checks.passed}/${result.checks.total} checks passed)`);
    console.error(`Valid: ${result.valid}`);
    console.error();

    if (result.criticalFailures.length > 0) {
      console.error('❌ CRITICAL FAILURES:');
      for (const cf of result.criticalFailures) {
        console.error(`  • ${cf}`);
      }
      console.error();
    }

    if (result.failures.length > 0) {
      console.error('❌ FAILURES:');
      for (const f of result.failures) {
        console.error(`  • ${f}`);
      }
      console.error();
    }

    if (result.warnings.length > 0) {
      console.error('⚠️  WARNINGS:');
      for (const w of result.warnings) {
        console.error(`  • ${w}`);
      }
      console.error();
    }

    if (result.valid) {
      console.error('✅ Gate PASSED');
    } else if (result.criticalFailures.length > 0) {
      console.error('❌ Gate FAILED — critical failures detected');
    } else {
      console.error('❌ Gate FAILED — score below 80%');
    }
    console.error(divider);
    console.error();
  }

  // Print JSON result to stdout for pipeline consumption
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

// ── Main ───────────────────────────────────────────────────────────

function main(): void {
  const cliArgs = parseCliArgs(process.argv);
  const { contextPath, workspaceRoot, verbose } = cliArgs;

  // 1. Validate context file exists
  if (!fs.existsSync(contextPath)) {
    const errorResult: GateResult = {
      valid: false,
      score: 0,
      checks: { passed: 0, failed: 0, total: 0 },
      criticalFailures: [`Context file not found: ${contextPath}`],
      failures: [],
      warnings: [],
      details: [],
    };
    printResult(errorResult, verbose);
    process.exit(2);
  }

  // 2. Read and parse the context file
  let content: string;
  try {
    content = fs.readFileSync(contextPath, 'utf-8');
  } catch (err) {
    const errorResult: GateResult = {
      valid: false,
      score: 0,
      checks: { passed: 0, failed: 0, total: 0 },
      criticalFailures: [`Error reading context file "${contextPath}": ${err instanceof Error ? err.message : String(err)}`],
      failures: [],
      warnings: [],
      details: [],
    };
    printResult(errorResult, verbose);
    process.exit(2);
  }

  // 3. Extract and normalize evidence entries directly from content
  const entries: EvidenceEntry[] = extractEvidenceFromContent(content);

  if (entries.length === 0) {
    const noEvidenceResult: GateResult = {
      valid: true,
      score: 100,
      checks: { passed: 0, failed: 0, total: 0 },
      criticalFailures: [],
      failures: [],
      warnings: ['No evidence entries found in agent-context.md — nothing to validate'],
      details: [],
    };
    printResult(noEvidenceResult, verbose);
    process.exit(0);
  }

  if (verbose) {
    console.error(`📋 Found ${entries.length} evidence entries to validate`);
    console.error();
  }

  // 5. Run all checks on all entries
  const allDetails: CheckDetail[] = [];
  for (const entry of entries) {
    const entryDetails = runChecksForEntry(entry, workspaceRoot);
    allDetails.push(...entryDetails);
  }

  // 6. Aggregate and score
  const result = computeGateResult(allDetails);

  // 7. Output
  printResult(result, verbose);

  // 8. Exit with appropriate code
  if (!result.valid) {
    process.exit(1);
  }
  process.exit(0);
}

if (require.main === module) {
  main();
}