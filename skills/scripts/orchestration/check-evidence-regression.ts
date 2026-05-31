#!/usr/bin/env node
/**
 * Historical Evidence Regression Scanner
 *
 * Scans past pipeline log archives, extracts evidence from archived agent-context.md files,
 * and re-verifies them against the current filesystem to detect stale/invalidated evidence.
 *
 * Usage:
 *   [runtime] check-evidence-regression.ts --days=30              # Check last 30 days
 *   [runtime] check-evidence-regression.ts --pipeline=<id>        # Check specific pipeline
 *   [runtime] check-evidence-regression.ts --all                   # Check all historical evidence
 *   [runtime] check-evidence-regression.ts --days=30 --verbose    # Detailed output
 *   [runtime] check-evidence-regression.ts --days=30 --fix        # Auto-fix stale entries
 *
 * Exit codes:
 *   0 = all evidence still valid
 *   1 = some evidence invalidated
 *   2 = parse error / file not found
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

// ── Types ──

interface HistoricalEvidence {
  pipelineId: string;
  feature: string;
  date: string;
  agentName: string;
  claim: string;
  source: string;
  lines: number[];
  originalContentHash: string | null;
  method: string;
  command: string;
  originalResult: string;
  excerpt: string;
}

interface RegressionResult {
  evidence: HistoricalEvidence;
  status: 'still_valid' | 'partially_valid' | 'invalidated' | 'file_deleted' | 'file_modified_claim_holds' | 'unverifiable';
  currentContentHash: string | null;
  recheckResult: string;
  confidence: number;
}

interface RegressionReport {
  totalScanned: number;
  stillValid: number;
  partiallyValid: number;
  invalidated: number;
  fileDeleted: number;
  fileModifiedClaimHolds: number;
  unverifiable: number;
  details: RegressionResult[];
  summary: string;
}

interface CliArgs {
  days: number | null;
  pipeline: string | null;
  all: boolean;
  verbose: boolean;
  fix: boolean;
  dir: string;
}

}

// ── CLI Parsing ──

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    days: null,
    pipeline: null,
    all: false,
    verbose: false,
    fix: false,
    dir: process.cwd(),
  };

  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--days=')) {
      const val = parseInt(arg.slice(7), 10);
      if (isNaN(val) || val <= 0) {
        console.error(`Invalid --days value: ${arg.slice(7)}`);
        process.exit(2);
      }
      args.days = val;
    } else if (arg.startsWith('--pipeline=')) {
      args.pipeline = arg.slice(11);
    } else if (arg === '--all') {
      args.all = true;
    } else if (arg === '--verbose') {
      args.verbose = true;
    } else if (arg === '--fix') {
      args.fix = true;
    } else if (arg.startsWith('--dir=')) {
      args.dir = path.resolve(arg.slice(6));
    } else {
      console.error(`Unknown option: ${arg}`);
      process.exit(2);
    }
  }

  return args;
}

// ── Pipeline Log Parsing ──
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffMs = cutoff.getTime();

  return entries.filter((e) => {
    const entryDate = new Date(e.date);
    return !isNaN(entryDate.getTime()) && entryDate.getTime() >= cutoffMs;
  });
}

// ── Pipeline Log Parsing ──

function parseFrontmatter(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  content = content.replace(/\r\n/g, '\n');
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return result;

  const yamlBlock = frontmatterMatch[1];
  const lines = yamlBlock.split('\n');
  let currentKey: string | null = null;
  let currentArray: unknown[] | null = null;
  let currentArrayKey: string | null = null;
  let currentObject: Record<string, unknown> | null = null;
  let currentObjectKey: string | null = null;
  const stack: { key: string; obj: Record<string, unknown> }[] = [];
  let root: Record<string, unknown> = result;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    // Detect indentation level
    const indent = line.search(/\S/);
    const indentLevel = indent < 0 ? 0 : indent;

    // Pop stack if indentation decreased
    while (stack.length > 0 && indentLevel <= stack[stack.length - 1].key.length / 2) {
      stack.pop();
    }

    // Determine parent context
    if (stack.length > 0) {
      root = stack[stack.length - 1].obj;
    } else {
      root = result;
    }

    // Check for list item
    const listItemMatch = trimmed.match(/^-\s+(.+)$/);
    if (listItemMatch && currentArrayKey && currentArray) {
      const val = parseScalar(listItemMatch[1]);
      if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        // Inline object like: - key: value
        const objVal = val as Record<string, unknown>;
        currentArray.push(objVal);
      } else {
        currentArray.push(val);
      }
      continue;
    }

    // Check for key-value pair
    const kvMatch = trimmed.match(/^(\w[\w_-]*):\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const valuePart = kvMatch[2].trim();

      if (valuePart === '') {
        // This key maps to a nested object or array
        currentObject = {};
        currentObjectKey = key;
        root[key] = currentObject;
        stack.push({ key: line.slice(0, indent), obj: currentObject });
        currentKey = key;

        // Check next line for array indicator
        currentArrayKey = null;
        currentArray = null;
      } else if (valuePart === '[') {
        // Array starts
        currentArray = [];
        currentArrayKey = key;
        root[key] = currentArray;
        currentKey = key;
      } else {
        // Simple key-value
        root[key] = parseScalar(valuePart);
        currentKey = key;
        currentArrayKey = null;
      }
      continue;
    }

    // Detect array continuation (list items without a parent key)
    if (listItemMatch && stack.length > 0) {
      const parent = stack[stack.length - 1].obj;
      // If parent has a list key, append to it
      for (const pk of Object.keys(parent)) {
        if (Array.isArray(parent[pk])) {
          const val = parseScalar(listItemMatch[1]);
          if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
            (parent[pk] as unknown[]).push(val);
          } else {
            (parent[pk] as unknown[]).push(val);
          }
          break;
        }
      }
    }
  }

  return result;
}

function parseScalar(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  if (/^\d+\.\d+$/.test(value)) return parseFloat(value);
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

function extractEvidenceFromFrontmatter(
  frontmatter: Record<string, unknown>,
  pipelineId: string,
  feature: string,
): HistoricalEvidence[] {
  const evidence: HistoricalEvidence[] = [];

  // Extract from agentHistory[].evidence[]
  const agentHistory = frontmatter['agentHistory'] as Record<string, unknown>[] | undefined;
  if (Array.isArray(agentHistory)) {
    for (const entry of agentHistory) {
      const agentName = (entry['agentName'] as string) || (entry['agent'] as string) || '';
      const entryEvidence = entry['evidence'] as Record<string, unknown>[] | undefined;
      if (Array.isArray(entryEvidence)) {
        for (const ev of entryEvidence) {
          evidence.push(normalizeEvidence(ev, pipelineId, feature, agentName));
        }
      }
    }
  }

  // Extract from agentOutputs.<agent>.evidence[]
  const agentOutputs = frontmatter['agentOutputs'] as Record<string, unknown> | undefined;
  if (agentOutputs) {
    for (const agentName of Object.keys(agentOutputs)) {
      const output = agentOutputs[agentName] as Record<string, unknown> | undefined;
      if (!output) continue;
      const outputEvidence = output['evidence'] as Record<string, unknown>[] | undefined;
      if (Array.isArray(outputEvidence)) {
        for (const ev of outputEvidence) {
          evidence.push(normalizeEvidence(ev, pipelineId, feature, agentName));
        }
      }
    }
  }

  return evidence;
}

function normalizeEvidence(
  raw: Record<string, unknown>,
  pipelineId: string,
  feature: string,
  agentName: string,
): HistoricalEvidence {
  return {
    pipelineId,
    feature,
    date: (raw['date'] as string) || new Date().toISOString().split('T')[0],
    agentName: (raw['agentName'] as string) || agentName,
    claim: (raw['claim'] as string) || (raw['description'] as string) || '',
    source: (raw['source'] as string) || (raw['file'] as string) || '',
    lines: parseLines(raw['lines']),
    originalContentHash: (raw['contentHash'] as string) || (raw['hash'] as string) || null,
    method: (raw['method'] as string) || 'analysis',
    command: (raw['command'] as string) || (raw['recheckCommand'] as string) || '',
    originalResult: (raw['result'] as string) || (raw['originalResult'] as string) || '',
    excerpt: (raw['excerpt'] as string) || '',
  };
}

function parseLines(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number);
  if (typeof value === 'string') {
    return value.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
  }
  if (typeof value === 'number') return [value];
  return [];
}

function loadPipelineLogs(pipelineDir: string, pipelineId: string, feature: string): HistoricalEvidence[] {
  const agentContextPath = path.join(pipelineDir, pipelineId, 'agent-context.md');
  if (!fs.existsSync(agentContextPath)) {
    return [];
  }

  const content = fs.readFileSync(agentContextPath, 'utf-8');
  const frontmatter = parseFrontmatter(content);
  return extractEvidenceFromFrontmatter(frontmatter, pipelineId, feature);
}

// ── File Hashing ──

function computeFileHash(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

// ── Evidence Re-verification ──

function reverifyEvidence(evidence: HistoricalEvidence, baseDir: string): RegressionResult {
  // Path traversal protection: ensure resolved path stays within baseDir
  const sourcePath = path.resolve(baseDir, evidence.source);
  if (!sourcePath.startsWith(baseDir + path.sep) && sourcePath !== baseDir) {
    return {
      evidence,
      status: 'invalidated',
      currentContentHash: null,
      recheckResult: `Path traversal detected: ${evidence.source} resolves outside base directory`,
      confidence: 100,
    };
  }

  // Check if file exists
  if (!fs.existsSync(sourcePath)) {
    return {
      evidence,
      status: 'file_deleted',
      currentContentHash: null,
      recheckResult: `File no longer exists: ${evidence.source}`,
      confidence: 100,
    };
  }

  const currentHash = computeFileHash(sourcePath);

  // If file unchanged (same hash), evidence is still valid
  if (evidence.originalContentHash && currentHash === evidence.originalContentHash) {
    return {
      evidence,
      status: 'still_valid',
      currentContentHash: currentHash,
      recheckResult: 'File unchanged — evidence confirmed',
      confidence: 100,
    };
  }

  // If method is reason/analysis, we can't automatically re-verify
  if (evidence.method === 'reason' || evidence.method === 'analysis') {
    return {
      evidence,
      status: 'unverifiable',
      currentContentHash: currentHash,
      recheckResult: 'Evidence based on reasoning/analysis — cannot auto-verify',
      confidence: 0,
    };
  }

  // If no command to re-run, do a best-effort check
  if (!evidence.command) {
    return {
      evidence,
      status: 'partially_valid',
      currentContentHash: currentHash,
      recheckResult: 'File modified, no recheck command available — manual review needed',
      confidence: 30,
    };
  }

  // Re-run the original command
  try {
    const command = evidence.command
      .replace(/\$\{baseDir\}/g, baseDir)
      .replace(/\$\{dir\}/g, baseDir)
      .replace(/\$\{source\}/g, evidence.source)
      .replace(/\$\{file\}/g, evidence.source);

    const stdout = execSync(command, {
      cwd: baseDir,
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,}).trim();

    // Exact match
    if (stdout === evidence.originalResult.trim() || stdout.includes(evidence.originalResult.trim())) {
      return {
        evidence,
        status: 'file_modified_claim_holds',
        currentContentHash: currentHash,
        recheckResult: `Command re-ran successfully — result matches original`,
        confidence: 90,
      };
    }

    // Fuzzy match: case-insensitive, whitespace-normalized
    const normalizedStdout = stdout.toLowerCase().replace(/\s+/g, ' ').trim();
    const normalizedOriginal = evidence.originalResult.toLowerCase().replace(/\s+/g, ' ').trim();

    if (normalizedStdout === normalizedOriginal || normalizedStdout.includes(normalizedOriginal)) {
      return {
        evidence,
        status: 'file_modified_claim_holds',
        currentContentHash: currentHash,
        recheckResult: `Command re-ran — fuzzy match confirms claim`,
        confidence: 75,
      };
    }

    // Check if the command itself failed
    return {
      evidence,
      status: 'invalidated',
      currentContentHash: currentHash,
      recheckResult: `Command re-ran but produced different output.\n  Expected: ${evidence.originalResult}\n  Got: ${stdout}`,
      confidence: 95,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      evidence,
      status: 'invalidated',
      currentContentHash: currentHash,
      recheckResult: `Command failed: ${errorMessage}`,
      confidence: 85,
    };
  }
}

// ── Report Generation ──

function generateReport(results: RegressionResult[], cliArgs: CliArgs): RegressionReport {
  const totalScanned = results.length;
  const stillValid = results.filter((r) => r.status === 'still_valid').length;
  const partiallyValid = results.filter((r) => r.status === 'partially_valid').length;
  const invalidated = results.filter((r) => r.status === 'invalidated').length;
  const fileDeleted = results.filter((r) => r.status === 'file_deleted').length;
  const fileModifiedClaimHolds = results.filter((r) => r.status === 'file_modified_claim_holds').length;
  const unverifiable = results.filter((r) => r.status === 'unverifiable').length;

  const totalCheckable = stillValid + partiallyValid + invalidated + fileDeleted + fileModifiedClaimHolds;
  const validCount = stillValid + fileModifiedClaimHolds;

  let summary: string;
  if (totalCheckable === 0) {
    summary = 'No checkable evidence entries found.';
  } else if (invalidated === 0 && fileDeleted === 0) {
    summary = `All ${validCount} checkable evidence entries remain valid. No issues detected.`;
  } else {
    const issues = invalidated + fileDeleted;
    summary = `${issues} of ${totalCheckable} checkable evidence entries have issues (${Math.round((issues / totalCheckable) * 100)}% stale).`;
  }

  return {
    totalScanned,
    stillValid,
    partiallyValid,
    invalidated,
    fileDeleted,
    fileModifiedClaimHolds,
    unverifiable,
    details: results,
    summary,
  };
}

function printReport(report: RegressionReport, cliArgs: CliArgs): void {
  const timeLabel = cliArgs.pipeline
    ? `Pipeline "${cliArgs.pipeline}"`
    : cliArgs.all
      ? 'All historical evidence'
      : `Last ${cliArgs.days} days`;

  const divider = '━'.repeat(55);

  console.log(`📋 Historical Evidence Regression Scan: ${timeLabel}`);
  console.log(divider);
  console.log(`🔍 Scanned: ${report.totalScanned} evidence entries`);
  console.log(`✅ Still valid: ${report.stillValid}`);
  console.log(`🔄 File modified, claim holds: ${report.fileModifiedClaimHolds}`);

  if (report.partiallyValid > 0) {
    console.log(`⚠️  Partially valid: ${report.partiallyValid}`);
  }
  if (report.invalidated > 0) {
    console.log(`❌ Invalidated: ${report.invalidated}`);
  }
  if (report.fileDeleted > 0) {
    console.log(`🗑️  File deleted: ${report.fileDeleted}`);
  }
  if (report.unverifiable > 0) {
    console.log(`⏭️  Unverifiable: ${report.unverifiable}`);
  }

  // Print detailed invalidated entries
  const invalidatedEntries = report.details.filter(
    (d) => d.status === 'invalidated' || d.status === 'file_deleted',
  );

  if (invalidatedEntries.length > 0) {
    console.log(`\n❌ INVALIDATED EVIDENCE:`);
    for (const entry of invalidatedEntries.filter((d) => d.status === 'invalidated')) {
      console.log(`  Pipeline "${entry.evidence.pipelineId}" (${entry.evidence.date}), Agent "${entry.evidence.agentName}"`);
      console.log(`    Claim: ${entry.evidence.claim}`);
      console.log(`    File: ${entry.evidence.source}`);
      console.log(`    Current: ${entry.recheckResult}`);
      console.log(`    → Action: Flag for re-verification\n`);
    }

    console.log(`❌ FILE DELETED:`);
    for (const entry of invalidatedEntries.filter((d) => d.status === 'file_deleted')) {
      console.log(`  Pipeline "${entry.evidence.pipelineId}" (${entry.evidence.date}), Agent "${entry.evidence.agentName}"`);
      console.log(`    Claim: ${entry.evidence.claim}`);
      console.log(`    File: ${entry.evidence.source}`);
      console.log(`    Current: File no longer exists`);
      console.log(`    → Action: Evidence is stale — remove from active reference\n`);
    }
  }

  if (cliArgs.verbose) {
    console.log(`\n📋 DETAILED RESULTS:`);
    for (const entry of report.details) {
      console.log(`  [${entry.status}] ${entry.evidence.pipelineId}/${entry.evidence.agentName}: ${truncateText(entry.evidence.claim, 60)}`);
      if (entry.status !== 'still_valid') {
        console.log(`       ${entry.recheckResult}`);
      }
    }
  }

  console.log(`\n${divider}`);
  console.log(report.summary);
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

// ── Auto-Fix ──

function autoFixStaleEntries(report: RegressionReport, baseDir: string): void {
  const staleLogPath = path.join(baseDir, '.opencode', 'evidence-stale.log');
  const staleEntries: string[] = [];

  for (const result of report.details) {
    if (result.status === 'file_modified_claim_holds') {
      // Evidence is still valid — nothing to fix structurally
      // Log it for awareness
      staleEntries.push(
        `[${new Date().toISOString()}] FILE_MODIFIED_CLAIM_HOLDS pipeline=${result.evidence.pipelineId} date=${result.evidence.date} agent=${result.evidence.agentName} file=${result.evidence.source} claim="${result.evidence.claim}"`,
      );
    } else if (result.status === 'file_deleted') {
      staleEntries.push(
        `[${new Date().toISOString()}] FILE_DELETED pipeline=${result.evidence.pipelineId} date=${result.evidence.date} agent=${result.evidence.agentName} file=${result.evidence.source} claim="${result.evidence.claim}"`,
      );
    } else if (result.status === 'invalidated') {
      staleEntries.push(
        `[${new Date().toISOString()}] INVALIDATED pipeline=${result.evidence.pipelineId} date=${result.evidence.date} agent=${result.evidence.agentName} file=${result.evidence.source} claim="${result.evidence.claim}" reason="${result.recheckResult.replace(/"/g, "'")}"`,
      );
    }
  }

  if (staleEntries.length > 0) {
    fs.mkdirSync(path.dirname(staleLogPath), { recursive: true });
    fs.appendFileSync(staleLogPath, staleEntries.join('\n') + '\n', 'utf-8');
    console.log(`\n📝 Appended ${staleEntries.length} entries to ${staleLogPath}`);
  } else {
    console.log(`\n📝 No stale entries to log.`);
  }
}

// ── Main ──

function main(): void {
  const cliArgs = parseCliArgs(process.argv);
  const baseDir = cliArgs.dir;
  const pipelineLogDir = path.join(baseDir, '.opencode', 'pipeline-logs');

  if (!fs.existsSync(pipelineLogDir)) {
    console.error(`Pipeline logs directory not found at ${pipelineLogDir}`);
    process.exit(2);
  }

  // Gather all evidence from pipeline log directories
  const allEvidence: HistoricalEvidence[] = [];

  if (cliArgs.pipeline) {
    // Load specific pipeline
    const evidence = loadPipelineLogs(pipelineLogDir, cliArgs.pipeline, cliArgs.pipeline);
    allEvidence.push(...evidence);
  } else {
    // Scan all pipeline dirs
    const pipelineDirs = fs.readdirSync(pipelineLogDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const dir of pipelineDirs) {
      const evidence = loadPipelineLogs(pipelineLogDir, dir, dir);
      allEvidence.push(...evidence);
    }
  }

  if (allEvidence.length === 0) {
    console.log('No evidence found in the requested pipelines.');
    process.exit(0);
  }

  // Re-verify each evidence entry
  const results: RegressionResult[] = allEvidence.map((ev) => reverifyEvidence(ev, baseDir));

  // Generate and print report
  const report = generateReport(results, cliArgs);
  printReport(report, cliArgs);

  // Auto-fix if requested
  if (cliArgs.fix) {
    autoFixStaleEntries(report, baseDir);
  }

  // Exit with appropriate code
  if (report.invalidated > 0 || report.fileDeleted > 0) {
    process.exit(1);
  }
  process.exit(0);
}

// Run main if executed directly
if (require.main === module) {
  main();
}
