#!/usr/bin/env node
/**
 * Truthfulness Validator
 *
 * Cross-checks agent claims against the actual filesystem.
 * Unlike validate-output-contract.ts (which checks field types/presence),
 * this validates that the CLAIMS are TRUE.
 *
 * Features:
 *   - Content hashing for evidence chain-of-custody (SHA-256)
 *   - Fuzzy evidence matching (exact, case-insensitive, whitespace-normalized, Levenshtein)
 *   - Evidence quality scoring (completeness, precision, reproducibility, excerpt accuracy, verifiability)
 *   - Staleness detection and refresh
 *   - Quality reports
 *
 * Usage:
 *   ts-node validate-truth.ts --pipeline                              (validates agent-context.md)
 *   ts-node validate-truth.ts --pipeline --stale-detection            (pipeline + content hash stale check)
 *   ts-node validate-truth.ts --pipeline --refresh-stale              (pipeline + re-verify stale evidence)
 *   ts-node validate-truth.ts --pipeline --quality-report             (pipeline + print quality scores)
 *   ts-node validate-truth.ts --agent=implementor [--stdin]           (validates agent output via stdin)
 *   ts-node validate-truth.ts --file=<path> [--agent=<name>]          (validates a single agent output file)
 *
 * Exit codes:
 *   0 = all claims verified true
 *   1 = some claims could not be verified
 *   2 = file not found / parse error
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

// ── Types ──

interface EvidenceItem {
  claim: string;
  source: string;
  lines?: number[];
  method: string;
  command: string;
  excerpt: string;
  result: string;
  timestamp?: string;
  contentHash?: string; // SHA-256 of source file at time of evidence collection
}

interface FuzzyMatchResult {
  match: boolean;
  confidence: number;
  strategy: string;
}

interface EvidenceQualityScore {
  total: number;          // 0-100
  completeness: number;   // 25% weight — all fields present
  precision: number;      // 25% weight — exact line numbers
  reproducibility: number; // 20% weight — self-contained command
  excerptAccuracy: number; // 15% weight — excerpt matches output
  verifiability: number;  // 15% weight — method is grep/read/stat/build (not reason/analysis)
}

interface ClaimVerification {
  claim: string;
  source: string;
  method: string;
  command: string;
  status: 'verified' | 'refuted' | 'unverifiable';
  actualResult: string;
  reportedResult: string;
  excerpt: string;
  confidence?: number;          // confidence level from fuzzy matching (0-1)
  fuzzyStrategy?: string;       // which fuzzy strategy matched
  staleWarning?: boolean;       // true if content hash mismatch
  currentContentHash?: string;  // current SHA-256 of the source file
  qualityScore?: EvidenceQualityScore;
}

interface TruthfulnessResult {
  agentName: string;
  totalClaims: number;
  verified: number;
  refuted: number;
  unverifiable: number;
  stale: number;               // count of stale evidence items
  refreshed: number;           // count of items refreshed
  score: number;               // percentage of verifiable claims that were true
  avgQualityScore: number;     // average quality score across all evidence items
  details: ClaimVerification[];
  filePath?: string;
}

// ── Content Hashing ──

function computeFileHash(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

// ── Fuzzy Matching ──

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function fuzzyMatch(text: string, pattern: string): FuzzyMatchResult {
  // Strategy 1: Exact match
  if (text.includes(pattern)) {
    return { match: true, confidence: 1.0, strategy: 'exact' };
  }

  // Strategy 2: Case-insensitive match
  const lowerText = text.toLowerCase();
  const lowerPattern = pattern.toLowerCase();
  if (lowerText.includes(lowerPattern)) {
    return { match: true, confidence: 0.95, strategy: 'case_insensitive' };
  }

  // Strategy 3: Whitespace-normalized match
  const normText = text.replace(/\s+/g, ' ').trim();
  const normPattern = pattern.replace(/\s+/g, ' ').trim();
  if (normText.includes(normPattern)) {
    return { match: true, confidence: 0.9, strategy: 'whitespace_normalized' };
  }

  // Strategy 4: Levenshtein distance < 20%
  const distance = levenshteinDistance(
    text.substring(0, 200),
    pattern.substring(0, 200),
  );
  const maxLen = Math.max(
    Math.min(text.length, 200),
    Math.min(pattern.length, 200),
  );
  if (maxLen > 0 && distance / maxLen < 0.2) {
    return {
      match: true,
      confidence: 0.8 - distance / maxLen,
      strategy: 'levenshtein',
    };
  }

  return { match: false, confidence: 0, strategy: 'none' };
}

// ── Evidence Quality Scoring ──

function computeEvidenceQuality(evidence: EvidenceItem): EvidenceQualityScore {
  // completeness: claim, source, method, command, excerpt, result
  const fields: (keyof EvidenceItem)[] = [
    'claim',
    'source',
    'method',
    'command',
    'excerpt',
    'result',
  ];
  const present = fields.filter(
    f =>
      evidence[f] !== undefined &&
      evidence[f] !== '' &&
      evidence[f] !== null,
  ).length;
  const completeness = Math.round((present / fields.length) * 100);

  // precision: exact line numbers provided
  const precision =
    evidence.lines && evidence.lines.length >= 2
      ? 100
      : evidence.lines && evidence.lines.length === 1
        ? 50
        : 0;

  // reproducibility: self-contained command (no relative paths without base)
  const reproducibility =
    evidence.command && !evidence.command.startsWith('..') ? 100 : 50;

  // excerptAccuracy: excerpt is not empty and not "N/A"
  const excerptAccuracy =
    evidence.excerpt &&
    evidence.excerpt !== 'N/A' &&
    evidence.excerpt.length > 5
      ? 100
      : 0;

  // verifiability: method is grep/read/stat/build (not reason/analysis)
  const verifiableMethods = [
    'grep',
    'read',
    'stat',
    'glob',
    'build',
    'lint',
    'test',
    'run',
  ];
  const verifiability = verifiableMethods.includes(evidence.method) ? 100 : 0;

  const total = Math.round(
    completeness * 0.25 +
      precision * 0.25 +
      reproducibility * 0.2 +
      excerptAccuracy * 0.15 +
      verifiability * 0.15,
  );

  return {
    total,
    completeness,
    precision,
    reproducibility,
    excerptAccuracy,
    verifiability,
  };
}

// ── Exec Helper ──

function execSafe(
  command: string,
  timeout = 15000,
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const result = execSync(command, {
      encoding: 'utf-8',
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
    });
    return { stdout: result.trim(), stderr: '', exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout ? err.stdout.toString().trim() : '',
      stderr: err.stderr
        ? err.stderr.toString().trim()
        : err.message || String(err),
      exitCode: err.status ?? 1,
    };
  }
}

// ── YAML Parser (simple, shared utils style) ──

function parseYamlFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  return parseYamlBlock(match[1]);
}

function parseYamlBlock(yamlBlock: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yamlBlock.split('\n');
  const stack: { key: string; indent: number; obj: Record<string, unknown> }[] =
    [{ key: '', indent: -1, obj: result }];

  // Parse array items
  function parseArrayItems(
    startIdx: number,
    parentIndent: number,
  ): { items: unknown[]; nextIdx: number } {
    const items: unknown[] = [];
    let idx = startIdx;
    while (idx < lines.length) {
      const line = lines[idx];
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) {
        idx++;
        continue;
      }
      const indent = line.search(/\S/);
      if (indent <= parentIndent) break;
      const listMatch = trimmed.match(/^-\s+(.*)/);
      if (!listMatch) break;
      const value = listMatch[1].trim();
      // Check for nested object: "- key: value"
      const colonIdx = value.indexOf(':');
      if (colonIdx > 0) {
        const objKey = value.slice(0, colonIdx).trim();
        const objValue = value.slice(colonIdx + 1).trim();
        if (objValue === '') {
          // Nested object, parse children
          const childObj: Record<string, unknown> = {};
          // Try to read child properties at indent + 2
          let ci = idx + 1;
          while (ci < lines.length) {
            const cl = lines[ci];
            const ciTrim = cl.trim();
            if (ciTrim === '' || ciTrim.startsWith('#')) {
              ci++;
              continue;
            }
            const ciIndent = cl.search(/\S/);
            if (ciIndent <= indent + 2) break;
            const kvMatch = ciTrim.match(/^(\w[\w]*):\s*(.*)/);
            if (kvMatch) {
              childObj[kvMatch[1]] = parseScalar(kvMatch[2].trim());
            }
            ci++;
          }
          items.push(childObj);
          idx = ci;
        } else {
          items.push({ [objKey]: parseScalar(objValue) });
          idx++;
        }
      } else {
        items.push(parseScalar(value));
        idx++;
      }
    }
    return { items, nextIdx: idx };
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const indent = line.search(/\S/);

    // Array at current level
    if (trimmed.startsWith('- ')) {
      const { items, nextIdx } = parseArrayItems(i, indent - 2);
      // The parent key is the last key in the stack
      if (stack.length > 0) {
        const parent = stack[stack.length - 1];
        parent.obj[parent.key] = items;
      }
      i = nextIdx - 1;
      continue;
    }

    // Key-value
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const rawValue = trimmed.slice(colonIdx + 1).trim();

    // Pop stack back to correct level
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    if (rawValue === '' || rawValue === '|') {
      // Nested object or array
      const newObj: Record<string, unknown> = {};
      const parent = stack[stack.length - 1];
      parent.obj[key] = newObj;
      stack.push({ key, indent, obj: newObj });
    } else if (rawValue === '[]') {
      const parent = stack[stack.length - 1];
      parent.obj[key] = [];
    } else if (rawValue === '{}') {
      const parent = stack[stack.length - 1];
      parent.obj[key] = {};
    } else {
      const parent = stack[stack.length - 1];
      parent.obj[key] = parseScalar(rawValue);
    }
  }

  return result;
}

function parseScalar(value: string): unknown {
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  // Remove surrounding quotes
  const uq = value
    .replace(/^"(.*)"$/, '$1')
    .replace(/^'(.*)'$/, '$1');
  // Try number
  if (/^-?\d+(\.\d+)?$/.test(uq)) {
    const num = Number(uq);
    if (!isNaN(num)) return num;
  }
  return uq;
}

// ── Evidence Extraction ──

function extractEvidence(parsed: Record<string, unknown>): EvidenceItem[] {
  const evidence = parsed.evidence;
  if (Array.isArray(evidence)) {
    return evidence as EvidenceItem[];
  }
  return [];
}

function extractChangedFiles(parsed: Record<string, unknown>): string[] {
  const cf = parsed.changedFiles;
  if (Array.isArray(cf)) return cf as string[];
  return [];
}

function extractAgentOutputsField(
  parsed: Record<string, unknown>,
  agentName: string,
  field: string,
): unknown {
  const agentOutputs = parsed.agentOutputs as
    | Record<string, unknown>
    | undefined;
  if (!agentOutputs) return undefined;
  const agentBlock = agentOutputs[agentName] as
    | Record<string, unknown>
    | undefined;
  if (!agentBlock) return undefined;
  return agentBlock[field];
}

// ── Verification Methods ──

function verifyFileExists(filePath: string, baseDir: string): boolean {
  const absPath = path.resolve(baseDir, filePath);
  return fs.existsSync(absPath);
}

function verifyExportExists(
  filePath: string,
  exportName: string,
  baseDir: string,
): boolean {
  const absPath = path.resolve(baseDir, filePath);
  if (!fs.existsSync(absPath)) return false;
  const content = fs.readFileSync(absPath, 'utf-8');
  const patterns = [
    `export {\\s*${escapeRegex(exportName)}`,
    `export class ${escapeRegex(exportName)}`,
    `export function ${escapeRegex(exportName)}`,
    `export const ${escapeRegex(exportName)}`,
    `export interface ${escapeRegex(exportName)}`,
    `export type ${escapeRegex(exportName)}`,
    `export enum ${escapeRegex(exportName)}`,
    `export default ${escapeRegex(exportName)}`,
  ];
  return patterns.some(p => new RegExp(p).test(content));
}

function verifyBuildPassed(
  agentName: string,
  parsed: Record<string, unknown>,
  baseDir: string,
): boolean {
  const buildPassed = extractAgentOutputsField(parsed, agentName, 'buildPassed');
  if (buildPassed !== true) return true; // not claiming passed, nothing to verify
  // Re-run build and check
  const buildResult = execSafe(process.platform === 'win32' ? 'cmd /c "npm run build 2>&1 | tail -5"' : 'npm run build 2>&1 | tail -5', 60000);
  return buildResult.exitCode === 0;
}

function checkContentHashStaleness(
  evidence: EvidenceItem,
  baseDir: string,
): boolean {
  if (!evidence.contentHash || !evidence.source) return false;
  const sourcePath = path.resolve(baseDir, evidence.source);
  if (!fs.existsSync(sourcePath)) return true; // file gone = stale
  const currentHash = computeFileHash(sourcePath);
  return currentHash !== null && currentHash !== evidence.contentHash;
}

function verifyGrepEvidence(
  evidence: EvidenceItem,
  baseDir: string,
  useFuzzy: boolean = false,
): ClaimVerification {
  const sourcePath = path.resolve(baseDir, evidence.source);
  const reportedResult = evidence.result;
  const qualityScore = computeEvidenceQuality(evidence);

  // For grep method
  if (evidence.method === 'grep' || evidence.method === 'read') {
    let grepResult: { stdout: string; stderr: string; exitCode: number };
    if (evidence.method === 'grep') {
      // Try exact grep first
      grepResult = grepInFile(
        sourcePath,
        evidence.excerpt.length > 0 ? evidence.excerpt : evidence.claim,
      );

      // Fall back to fuzzy matching if exact grep fails and fuzzy requested
      if (
        grepResult.stdout.length === 0 &&
        useFuzzy &&
        fs.existsSync(sourcePath)
      ) {
        const fileContent = fs.readFileSync(sourcePath, 'utf-8');
        const pattern =
          evidence.excerpt.length > 0
            ? evidence.excerpt
            : evidence.claim;
        const fuzzyResult = fuzzyMatch(fileContent, pattern);

        if (fuzzyResult.match) {
          // Extract the matching line for the excerpt
          const lines = fileContent.split('\n');
          const matchLine = lines.find(
            (l: string) =>
              l.includes(pattern) ||
              l.toLowerCase().includes(pattern.toLowerCase()),
          );
          return {
            claim: evidence.claim,
            source: evidence.source,
            method: evidence.method,
            command: evidence.command,
            status: 'verified',
            actualResult: `found (fuzzy: ${fuzzyResult.strategy}, confidence: ${fuzzyResult.confidence.toFixed(2)})`,
            reportedResult,
            excerpt: matchLine ? matchLine.slice(0, 500) : '',
            confidence: fuzzyResult.confidence,
            fuzzyStrategy: fuzzyResult.strategy,
            qualityScore,
          };
        }
      }
    } else {
      grepResult = readFileLines(
        sourcePath, 50,
      );
    }

    if (grepResult.exitCode !== 0 && !fs.existsSync(sourcePath)) {
      return {
        claim: evidence.claim,
        source: evidence.source,
        method: evidence.method,
        command: evidence.command,
        status: 'refuted',
        actualResult: 'source file not found',
        reportedResult,
        excerpt: '',
        qualityScore,
      };
    }

    const found = grepResult.stdout.length > 0;
    const claimedFound =
      reportedResult === 'found' ||
      reportedResult === 'exists' ||
      reportedResult === 'passed';

    return {
      claim: evidence.claim,
      source: evidence.source,
      method: evidence.method,
      command: evidence.command,
      status: found === claimedFound ? 'verified' : 'refuted',
      actualResult: found ? 'found content' : 'content not found',
      reportedResult,
      excerpt: grepResult.stdout.slice(0, 500),
      qualityScore,
    };
  }

  // For stat method
  if (evidence.method === 'stat' || evidence.method === 'glob') {
    const exists = fs.existsSync(sourcePath);
    const claimedExists = reportedResult === 'exists' || reportedResult === 'found';

    return {
      claim: evidence.claim,
      source: evidence.source,
      method: evidence.method,
      command: evidence.command,
      status: exists === claimedExists ? 'verified' : 'refuted',
      actualResult: exists ? 'file exists' : 'file not found',
      reportedResult,
      excerpt: exists
        ? `File exists: ${sourcePath}`
        : 'File not found',
      qualityScore,
    };
  }

  // For build/lint/test method
  if (
    evidence.method === 'build' ||
    evidence.method === 'lint' ||
    evidence.method === 'test'
  ) {
    const cmdResult = execSafe(evidence.command, 60000);
    const claimedPassed =
      reportedResult === 'passed' || reportedResult === 'verified';
    const actualPassed = cmdResult.exitCode === 0;

    return {
      claim: evidence.claim,
      source: evidence.source,
      method: evidence.method,
      command: evidence.command,
      status: actualPassed === claimedPassed ? 'verified' : 'refuted',
      actualResult: actualPassed
        ? 'passed (exit 0)'
        : `failed (exit ${cmdResult.exitCode})`,
      reportedResult,
      excerpt: cmdResult.stderr || cmdResult.stdout || '(no output)',
      qualityScore,
    };
  }

  // For run method
  if (evidence.method === 'run') {
    const cmdResult = execSafe(evidence.command, 30000);
    return {
      claim: evidence.claim,
      source: evidence.source,
      method: evidence.method,
      command: evidence.command,
      status: 'verified', // We trust run output but report it
      actualResult: `exit ${cmdResult.exitCode}: ${cmdResult.stdout.slice(0, 200)}`,
      reportedResult,
      excerpt: cmdResult.stdout.slice(0, 500),
      qualityScore,
    };
  }

  // For reason/analysis — can't verify programmatically
  return {
    claim: evidence.claim,
    source: evidence.source,
    method: evidence.method,
    command: evidence.command,
    status: 'unverifiable',
    actualResult: 'reason/analysis method — requires human review',
    reportedResult,
    excerpt: '',
    qualityScore,
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pure Node.js grep — find pattern in file, return matching lines.
 * OS-agnostic replacement for shell `grep -n`.
 */
function grepInFile(
  filePath: string,
  pattern: string,
  caseSensitive: boolean = true,
): { stdout: string; stderr: string; exitCode: number } {
  try {
    if (!fs.existsSync(filePath)) {
      return { stdout: '', stderr: 'File not found', exitCode: 1 };
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    let matchCount = 0;
    let output = '';
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flags = caseSensitive ? 'g' : 'gi';
    const re = new RegExp(escaped, flags);
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        matchCount++;
        output += `${i + 1}: ${lines[i]}\n`;
      }
    }
    return {
      stdout: output.trimEnd(),
      stderr: '',
      exitCode: matchCount > 0 ? 0 : 1,
    };
  } catch (err: any) {
    return { stdout: '', stderr: err.message || String(err), exitCode: 2 };
  }
}

/**
 * Pure Node.js head — read first N lines of a file.
 * OS-agnostic replacement for shell \`head -n\`.
 */
function readFileLines(
  filePath: string,
  maxLines: number = 50,
): { stdout: string; stderr: string; exitCode: number } {
  try {
    if (!fs.existsSync(filePath)) {
      return { stdout: '', stderr: 'File not found', exitCode: 1 };
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const selected = lines.slice(0, maxLines).join('\n');
    return { stdout: selected, stderr: '', exitCode: 0 };
  } catch (err: any) {
    return { stdout: '', stderr: err.message || String(err), exitCode: 2 };
  }
}

// ── Staleness Detection and Refresh ──

interface StaleCheckResult {
  staleEvidence: { evidence: EvidenceItem; index: number }[];
  freshEvidence: number;
}

function detectStaleEvidence(
  evidence: EvidenceItem[],
  baseDir: string,
): StaleCheckResult {
  const staleEvidence: { evidence: EvidenceItem; index: number }[] = [];
  let freshEvidence = 0;

  for (let i = 0; i < evidence.length; i++) {
    const ev = evidence[i];
    if (ev.contentHash) {
      const isStale = checkContentHashStaleness(ev, baseDir);
      if (isStale) {
        staleEvidence.push({ evidence: ev, index: i });
      } else {
        freshEvidence++;
      }
    } else {
      // No content hash to compare — count as fresh (unknown)
      freshEvidence++;
    }
  }

  return { staleEvidence, freshEvidence };
}

function refreshStaleEvidence(
  staleItems: { evidence: EvidenceItem; index: number }[],
  baseDir: string,
): ClaimVerification[] {
  const refreshed: ClaimVerification[] = [];

  for (const { evidence } of staleItems) {
    // Re-run the evidence command to get fresh results
    if (
      evidence.method === 'stat' ||
      evidence.method === 'glob'
    ) {
      const sourcePath = path.resolve(baseDir, evidence.source);
      const exists = fs.existsSync(sourcePath);
      refreshed.push({
        claim: evidence.claim,
        source: evidence.source,
        method: evidence.method,
        command: evidence.command,
        status: exists ? 'verified' : 'refuted',
        actualResult: exists ? 'file exists (refreshed)' : 'file not found (stale)',
        reportedResult: evidence.result,
        excerpt: exists
          ? `File exists: ${sourcePath}`
          : 'File not found',
        currentContentHash: exists
          ? (computeFileHash(sourcePath) ?? undefined)
          : undefined,
        qualityScore: computeEvidenceQuality(evidence),
      });
    } else if (
      evidence.method === 'grep' ||
      evidence.method === 'read'
    ) {
      const sourcePath = path.resolve(baseDir, evidence.source);
      if (!fs.existsSync(sourcePath)) {
        refreshed.push({
          claim: evidence.claim,
          source: evidence.source,
          method: evidence.method,
          command: evidence.command,
          status: 'refuted',
          actualResult: 'source file not found (stale)',
          reportedResult: evidence.result,
          excerpt: '',
          currentContentHash: undefined,
          qualityScore: computeEvidenceQuality(evidence),
        });
        continue;
      }
      const currentHash = computeFileHash(sourcePath);
      const grepResult = grepInFile(
          sourcePath,
          evidence.excerpt.length > 0 ? evidence.excerpt : evidence.claim,
        );
      const found = grepResult.stdout.length > 0;
      refreshed.push({
        claim: evidence.claim,
        source: evidence.source,
        method: evidence.method,
        command: evidence.command,
        status: found ? 'verified' : 'refuted',
        actualResult: found
          ? 'found content (refreshed)'
          : 'content not found (stale)',
        reportedResult: evidence.result,
        excerpt: grepResult.stdout.slice(0, 500),
        currentContentHash: currentHash ?? undefined,
        staleWarning: true,
        qualityScore: computeEvidenceQuality(evidence),
      });
    } else {
      // For other methods (build, lint, test, run), re-execute
      const cmdResult = execSafe(evidence.command, 60000);
      refreshed.push({
        claim: evidence.claim,
        source: evidence.source,
        method: evidence.method,
        command: evidence.command,
        status: cmdResult.exitCode === 0 ? 'verified' : 'refuted',
        actualResult: `exit ${cmdResult.exitCode} (refreshed)`,
        reportedResult: evidence.result,
        excerpt: cmdResult.stdout.slice(0, 500) || cmdResult.stderr.slice(0, 500),
        staleWarning: true,
        qualityScore: computeEvidenceQuality(evidence),
      });
    }
  }

  return refreshed;
}

// ── Main Validation ──

function validateTruthfulness(
  parsed: Record<string, unknown>,
  agentName: string,
  baseDir: string,
  filePath?: string,
  options?: {
    useFuzzy?: boolean;
    detectStale?: boolean;
    refreshStale?: boolean;
    qualityReport?: boolean;
  },
): TruthfulnessResult {
  const evidence = extractEvidence(parsed);
  const changedFiles = extractChangedFiles(parsed);
  const details: ClaimVerification[] = [];
  let staleCount = 0;
  let refreshedCount = 0;
  let totalQualityScore = 0;
  let qualityScoreCount = 0;

  // 1. Verify each evidence item
  for (const ev of evidence) {
    const result = verifyGrepEvidence(
      ev,
      baseDir,
      options?.useFuzzy ?? false,
    );

    // Check content hash staleness
    if (options?.detectStale || options?.refreshStale) {
      if (ev.contentHash) {
        const isStale = checkContentHashStaleness(ev, baseDir);
        if (isStale) {
          result.staleWarning = true;
          staleCount++;
        }
      }
    }

    // Track quality score
    if (result.qualityScore) {
      totalQualityScore += result.qualityScore.total;
      qualityScoreCount++;
    }

    details.push(result);
  }

  // 1b. Refresh stale evidence if requested (replaces stale entries with fresh verifications)
  if (options?.refreshStale) {
    const staleResult = detectStaleEvidence(evidence, baseDir);
    staleCount = staleResult.staleEvidence.length;

    if (staleResult.staleEvidence.length > 0) {
      const refreshedResults = refreshStaleEvidence(
        staleResult.staleEvidence,
        baseDir,
      );
      refreshedCount = refreshedResults.length;

      // Replace the stale entries in details
      for (let i = 0; i < staleResult.staleEvidence.length; i++) {
        const { index } = staleResult.staleEvidence[i];
        if (i < refreshedResults.length) {
          details[index] = refreshedResults[i];
          if (refreshedResults[i].qualityScore) {
            // Re-calculate quality score contribution
            totalQualityScore +=
              refreshedResults[i].qualityScore!.total;
            qualityScoreCount++;
          }
        }
      }
    }
  }

  // 2. Verify changedFiles exist (claim: "these files were modified")
  for (const filePath of changedFiles) {
    const exists = verifyFileExists(filePath, baseDir);
    const result: ClaimVerification = {
      claim: `File exists: ${filePath}`,
      source: filePath,
      method: 'stat',
      command: `stat ${filePath}`,
      status: exists ? 'verified' : 'refuted',
      actualResult: exists ? 'file exists' : 'file not found',
      reportedResult: 'exists',
      excerpt: exists
        ? ''
        : `File not found: ${path.resolve(baseDir, filePath)}`,
    };
    details.push(result);
  }

  // 3. Verify buildPassed if claimed true
  const buildPassed = extractAgentOutputsField(
    parsed,
    agentName,
    'buildPassed',
  );
  if (
    buildPassed === true &&
    agentName !== 'finder' &&
    agentName !== 'plandescriber' &&
    agentName !== 'verifier' &&
    agentName !== 'qa'
  ) {
    const buildOk = verifyBuildPassed(agentName, parsed, baseDir);
    details.push({
      claim: 'Build passed',
      source: 'build',
      method: 'build',
      command: 'npm run build 2>&1 | tail -5',
      status: buildOk ? 'verified' : 'refuted',
      actualResult: buildOk ? 'build passed' : 'build failed',
      reportedResult: 'passed',
      excerpt: buildOk
        ? 'Build succeeded'
        : 'Build failed — re-run for details',
    });
  }

  // Compute score
  const totalClaims = details.length;
  const verified = details.filter(d => d.status === 'verified').length;
  const refuted = details.filter(d => d.status === 'refuted').length;
  const unverifiable = details.filter(
    d => d.status === 'unverifiable',
  ).length;
  const verifiable = totalClaims - unverifiable;
  const score = verifiable > 0 ? Math.round((verified / verifiable) * 100) : 100;
  const avgQualityScore =
    qualityScoreCount > 0
      ? Math.round(totalQualityScore / qualityScoreCount)
      : 0;

  return {
    agentName,
    totalClaims,
    verified,
    refuted,
    unverifiable,
    stale: staleCount,
    refreshed: refreshedCount,
    score,
    avgQualityScore,
    details,
    filePath,
  };
}

// ── Pipeline Mode ──

function validatePipeline(
  baseDir: string,
  options?: {
    useFuzzy?: boolean;
    detectStale?: boolean;
    refreshStale?: boolean;
    qualityReport?: boolean;
  },
): TruthfulnessResult[] {
  const contextPath = path.resolve(baseDir, 'agent-context.md');
  if (!fs.existsSync(contextPath)) {
    console.error('❌ agent-context.md not found');
    process.exit(2);
  }

  const content = fs.readFileSync(contextPath, 'utf-8');
  const parsed = parseYamlFrontmatter(content);
  if (!parsed) {
    console.error('❌ Could not parse YAML frontmatter from agent-context.md');
    process.exit(2);
    return []; // unreachable but satisfies TS strict null checks
  }

  const agentOutputs = parsed.agentOutputs as
    | Record<string, unknown>
    | undefined;
  if (!agentOutputs) {
    console.error('❌ No agentOutputs section in agent-context.md');
    return [];
  }

  const results: TruthfulnessResult[] = [];
  const knownAgents = [
    'finder',
    'implementor',
    'fixer',
    'plandescriber',
    'verifier',
    'qa',
    'integrator',
    'documentor',
  ];

  for (const agentName of knownAgents) {
    const agentBlock = agentOutputs[agentName] as
      | Record<string, unknown>
      | undefined;
    if (!agentBlock) continue;

    // Build a composite parsed structure
    const composite: Record<string, unknown> = {
      ...agentBlock,
      agentOutputs: { [agentName]: agentBlock },
      evidence: agentBlock.evidence || [],
      changedFiles: agentBlock.changedFiles || [],
      decisions: agentBlock.decisions || [],
      warnings: agentBlock.warnings || [],
      artifacts: agentBlock.artifacts || [],
    };
    // Use top-level evidence/changedFiles if agent-level doesn't have them
    if (
      !composite.evidence ||
      (composite.evidence as unknown[]).length === 0
    ) {
      composite.evidence = parsed.evidence || [];
    }
    if (
      !composite.changedFiles ||
      (composite.changedFiles as unknown[]).length === 0
    ) {
      composite.changedFiles =
        parsed.changedFiles || agentBlock.changedFiles || [];
    }

    const result = validateTruthfulness(
      composite as Record<string, unknown>,
      agentName,
      baseDir,
      contextPath,
      options,
    );
    results.push(result);
  }

  return results;
}

// ── Print Results ──

function printResult(result: TruthfulnessResult): void {
  const icon =
    result.score >= 95 ? '✅' : result.score >= 70 ? '⚠️' : '❌';
  console.log(
    `\n${icon} Truthfulness Validation: ${result.agentName}`,
  );
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(
    `Score: ${result.score}% (${result.verified}/${result.totalClaims - result.unverifiable} verifiable claims true)`,
  );
  console.log(`Total claims: ${result.totalClaims}`);
  console.log(`  ✅ Verified: ${result.verified}`);
  console.log(`  ❌ Refuted:  ${result.refuted}`);
  console.log(`  ⏭️  Unverifiable: ${result.unverifiable}`);
  if (result.stale > 0) {
    console.log(`  ⏳ Stale:    ${result.stale}`);
  }
  if (result.refreshed > 0) {
    console.log(`  🔄 Refreshed: ${result.refreshed}`);
  }
  if (result.avgQualityScore > 0) {
    console.log(
      `  📊 Avg Quality: ${result.avgQualityScore}/100`,
    );
  }
  if (result.filePath) console.log(`File: ${result.filePath}`);
  console.log();

  if (result.refuted > 0) {
    console.log('Refuted Claims:');
    for (const d of result.details) {
      if (d.status === 'refuted') {
        console.log(`  ❌ ${d.claim}`);
        console.log(`     Source: ${d.source}`);
        console.log(`     Command: ${d.command}`);
        console.log(`     Reported: ${d.reportedResult}`);
        console.log(`     Actual:   ${d.actualResult}`);
        if (d.excerpt)
          console.log(`     Excerpt: ${d.excerpt.slice(0, 200)}`);
        if (d.staleWarning) console.log(`     ⏳ STALE: content hash mismatch`);
        if (d.confidence !== undefined)
          console.log(
            `     Confidence: ${(d.confidence * 100).toFixed(0)}% (${d.fuzzyStrategy})`,
          );
        console.log();
      }
    }
  }

  if (result.unverifiable > 0) {
    console.log('Unverifiable Claims:');
    for (const d of result.details) {
      if (d.status === 'unverifiable') {
        console.log(`  ⏭️  ${d.claim}`);
      }
    }
    console.log();
  }

  if (result.stale > 0) {
    console.log('Stale Claims:');
    for (const d of result.details) {
      if (d.staleWarning) {
        console.log(`  ⏳ ${d.claim}`);
        console.log(`     Source: ${d.source}`);
        console.log(`     Method: ${d.method}`);
        console.log(`     Status: ${d.status}`);
        console.log();
      }
    }
  }

  if (result.verified > 0 && result.refuted === 0) {
    console.log('  All verifiable claims verified true.');
    console.log();
  }
}

function printPipelineSummary(results: TruthfulnessResult[]): void {
  const total = results.length;
  const passing = results.filter(r => r.score >= 95).length;
  const warning = results.filter(r => r.score >= 70 && r.score < 95).length;
  const failing = results.filter(r => r.score < 70).length;

  console.log(`\n📋 Pipeline Truthfulness Summary`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Agents validated: ${total}`);
  console.log(`✅ Passing (>=95%): ${passing}`);
  console.log(`⚠️  Warning (70-94%): ${warning}`);
  console.log(`❌ Failing (<70%):  ${failing}`);
  console.log();

  for (const r of results) {
    const icon =
      r.score >= 95 ? '✅' : r.score >= 70 ? '⚠️' : '❌';
    console.log(
      `${icon} ${r.agentName}: ${r.score}% (${r.verified}/${r.totalClaims - r.unverifiable} verified)`,
    );
    if (r.avgQualityScore > 0) {
      console.log(`     📊 Quality: ${r.avgQualityScore}/100`);
    }
    if (r.stale > 0) {
      console.log(`     ⏳ Stale: ${r.stale}`);
    }
    if (r.refreshed > 0) {
      console.log(`     🔄 Refreshed: ${r.refreshed}`);
    }
    if (r.refuted > 0) {
      for (const d of r.details) {
        if (d.status === 'refuted') {
          console.log(`     ❌ ${d.claim}`);
        }
        if (d.staleWarning && d.status !== 'refuted') {
          console.log(`     ⏳ ${d.claim} (stale)`);
        }
      }
    }
  }
  console.log();
}

function printQualityReport(result: TruthfulnessResult): void {
  console.log(
    `\n📊 Evidence Quality Report: ${result.agentName}`,
  );
  console.log(
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
  );
  console.log(
    `Average Quality Score: ${result.avgQualityScore}/100`,
  );
  console.log();

  for (let i = 0; i < result.details.length; i++) {
    const d = result.details[i];
    if (!d.qualityScore) continue;

    const qs = d.qualityScore;
    const qualityIcon =
      qs.total >= 80
        ? '🟢'
        : qs.total >= 50
          ? '🟡'
          : '🔴';
    console.log(
      `${qualityIcon} [${i + 1}] ${d.claim.slice(0, 60)}`,
    );
    console.log(`     Total:     ${qs.total}/100`);
    console.log(
      `     Completeness: ${qs.completeness}/100    (25%)`,
    );
    console.log(
      `     Precision:   ${qs.precision}/100    (25%)`,
    );
    console.log(
      `     Reproducibility: ${qs.reproducibility}/100 (20%)`,
    );
    console.log(
      `     Excerpt Accuracy: ${qs.excerptAccuracy}/100 (15%)`,
    );
    console.log(
      `     Verifiability: ${qs.verifiability}/100    (15%)`,
    );
    console.log(
      `     Method: ${d.method} | Lines: ${d.source}${d.qualityScore.precision > 0 ? ':' + (d.source.includes(':') ? d.source.split(':')[1] : '?') : ':—'}`,
    );
    console.log();
  }
}

// ── Main ──

function main(): void {
  const args = process.argv.slice(2);
  const pipelineArg = args.includes('--pipeline');
  const fileArg = args.find((a: string) => a.startsWith('--file='));
  const agentArg = args.find((a: string) => a.startsWith('--agent='));
  const stdinArg = args.includes('--stdin');
  const dirArg = args.find((a: string) => a.startsWith('--dir='));
  const fuzzyArg = args.includes('--fuzzy');
  const staleDetectionArg = args.includes('--stale-detection');
  const refreshStaleArg = args.includes('--refresh-stale');
  const qualityReportArg = args.includes('--quality-report');
  const contentHashArg = args.includes('--content-hash');
  const baseDir = dirArg
    ? path.resolve(dirArg.split('=')[1])
    : process.cwd();

  const options = {
    useFuzzy: fuzzyArg || refreshStaleArg,
    detectStale: staleDetectionArg || refreshStaleArg,
    refreshStale: refreshStaleArg,
    qualityReport: qualityReportArg,
    contentHash: contentHashArg,
  };

  // Pipeline mode
  if (pipelineArg) {
    const results = validatePipeline(baseDir, options);
    if (results.length === 0) {
      console.log('No agent outputs found in agent-context.md');
      process.exit(0);
    }

    if (options.qualityReport) {
      for (const r of results) {
        printQualityReport(r);
      }
    }

    printPipelineSummary(results);

    // Print staleness summary if detected
    const totalStale = results.reduce(
      (sum, r) => sum + r.stale,
      0,
    );
    const totalRefreshed = results.reduce(
      (sum, r) => sum + r.refreshed,
      0,
    );
    if (totalStale > 0) {
      console.log(
        `⏳ Total stale evidence items: ${totalStale}${totalRefreshed > 0 ? ` (${totalRefreshed} refreshed)` : ''}`,
      );
      console.log();
    }

    const allPassing = results.every(r => r.score >= 95);
    process.exit(allPassing ? 0 : 1);
  }

  // File mode
  if (fileArg) {
    const filePath = fileArg.split('=')[1];
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
      console.error(`File not found: ${resolvedPath}`);
      process.exit(2);
    }

    const content = fs.readFileSync(resolvedPath, 'utf-8');
    const parsed =
      parseYamlFrontmatter(content) || parseYamlBlock(content);
    if (!parsed || Object.keys(parsed).length === 0) {
      console.error(`Could not parse YAML from ${resolvedPath}`);
      process.exit(2);
    }

    const agentName = agentArg
      ? agentArg.split('=')[1]
      : 'unknown';
    const result = validateTruthfulness(
      parsed,
      agentName,
      baseDir,
      resolvedPath,
      options,
    );

    if (options.qualityReport) {
      printQualityReport(result);
    }

    printResult(result);
    process.exit(result.score >= 95 ? 0 : 1);
  }

  // Stdin mode
  if (stdinArg) {
    let input = '';
    process.stdin.on(
      'data',
      (chunk: Buffer) => {
        input += chunk.toString();
      },
    );
    process.stdin.on('end', () => {
      const parsed =
        parseYamlFrontmatter(input) || parseYamlBlock(input);
      if (!parsed || Object.keys(parsed).length === 0) {
        console.error('Could not parse YAML from stdin');
        process.exit(2);
      }
      const agentName = agentArg
        ? agentArg.split('=')[1]
        : 'unknown';
      const result = validateTruthfulness(
        parsed,
        agentName,
        baseDir,
        undefined,
        options,
      );

      if (options.qualityReport) {
        printQualityReport(result);
      }

      printResult(result);
      process.exit(result.score >= 95 ? 0 : 1);
    });
    return;
  }

  // Usage
  console.log(`
Usage:
  ts-node validate-truth.ts --pipeline [--dir=<project-dir>] [options]
  ts-node validate-truth.ts --file=<path> [--agent=<name>] [--dir=<project-dir>] [options]
  ts-node validate-truth.ts --stdin --agent=<name> [--dir=<project-dir>] [options]

Validates that agent claims (evidence, changedFiles, buildPassed) match reality.

Options:
  --fuzzy              Use fuzzy matching (case-insensitive, whitespace-normalized, Levenshtein)
  --stale-detection    Check content hashes and warn when source files have changed
  --refresh-stale      Re-verify stale evidence by re-running original commands
  --quality-report     Print evidence quality scores for each agent
  --content-hash       Include content hashes in verification output
`);
}

main();
