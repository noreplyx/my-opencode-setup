#!/usr/bin/env bun
import { readFileSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";
import { execSync, execFileSync } from "node:child_process";
import type { Plan, PlanData, AcceptanceCriterion } from "../skills/plan-protocol/scripts/types.ts";

// ── Types ────────────────────────────────────────────────────────────────────

export type CoverageStatus = "covered" | "partial" | "missing" | "unknown";

export interface EvidenceItem {
  file: string;
  line: number;
  content: string;
}

export interface ACResult {
  id: string;
  description: string;
  verification_method: string;
  status: CoverageStatus;
  evidence: EvidenceItem[];
  suggestions: string[];
}

export interface CheckpointResult {
  id: string;
  title: string;
  acs: ACResult[];
}

export interface CoverageReport {
  plan_title: string;
  summary: {
    total: number;
    covered: number;
    partial: number;
    missing: number;
    unknown: number;
    coverage_pct: number;
  };
  results: CheckpointResult[];
}

// ── Help ──────────────────────────────────────────────────────────────────────

function showHelp(): void {
  const help = `
Usage: bun scripts/verify-plan-coverage.ts [options]

Cross-reference plan acceptance criteria against the codebase to verify coverage.

Options:
  --plan <plan.json>       Path to the plan JSON file (required)
  --project <project-root> Project root to search (default: current working directory)
  --format <text|json>     Output format: text (default) or json
  --threshold <0-100>      Minimum coverage percentage to exit with code 0 (default: 0)
  --help, -h               Show this help message

Examples:
  bun scripts/verify-plan-coverage.ts --plan plan.json
  bun scripts/verify-plan-coverage.ts --plan plan.json --project /path/to/project
  bun scripts/verify-plan-coverage.ts --plan plan.json --format json
  bun scripts/verify-plan-coverage.ts --plan plan.json --threshold 80
`;
  console.log(help);
}

// ── Argument Parsing ──────────────────────────────────────────────────────────

export interface CliArgs {
  planPath: string;
  projectRoot: string;
  format: "text" | "json";
  threshold: number;
}

export function parseArgs(argv: string[]): CliArgs | null {
  if (argv.includes("--help") || argv.includes("-h")) {
    showHelp();
    return null;
  }

  const planIdx = argv.indexOf("--plan");
  if (planIdx === -1 || planIdx + 1 >= argv.length) {
    console.error("Error: --plan <plan.json> is required");
    return null;
  }
  const planPath = resolve(argv[planIdx + 1]);

  const projectIdx = argv.indexOf("--project");
  const projectRoot = projectIdx !== -1 && projectIdx + 1 < argv.length
    ? resolve(argv[projectIdx + 1])
    : resolve(".");

  const formatIdx = argv.indexOf("--format");
  const formatRaw = formatIdx !== -1 && formatIdx + 1 < argv.length
    ? argv[formatIdx + 1]
    : "text";
  const format = (formatRaw === "json" ? "json" : "text") as "text" | "json";

  const thresholdIdx = argv.indexOf("--threshold");
  let threshold = 0;
  if (thresholdIdx !== -1 && thresholdIdx + 1 < argv.length) {
    const parsed = parseInt(argv[thresholdIdx + 1], 10);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
      threshold = parsed;
    } else {
      console.error("Error: --threshold must be a number between 0 and 100");
      return null;
    }
  }

  return { planPath, projectRoot, format, threshold };
}

// ── File / Grep Utilities ────────────────────────────────────────────────────

/**
 * Use ripgrep (rg) for fast recursive file search with glob patterns.
 * Falls back to a simple find-based approach if rg is unavailable.
 */
function findFiles(projectRoot: string, patterns: string[]): string[] {
  const results = new Set<string>();
  try {
    const out = execFileSync("rg", ["--files", ...patterns.map(p => `--glob=${p}`), projectRoot], {
      encoding: "utf-8",
      timeout: 15000,
      shell: false,
    });
    for (const line of out.split("\n").filter(Boolean)) {
      results.add(line.trim());
    }
  } catch {
    // rg returns non-zero if no matches; fall back to find
    for (const pattern of patterns) {
      try {
        const out = execFileSync("find", [projectRoot, "-path", "*/node_modules", "-prune", "-o", "-path", "*/.git", "-prune", "-o", "-type", "f", "-name", pattern, "-print"], {
          encoding: "utf-8",
          timeout: 15000,
          shell: false,
        });
        for (const line of out.split("\n").filter(Boolean)) {
          results.add(line.trim());
        }
      } catch {
        // no matches
      }
    }
  }
  return [...results];
}

/**
 * Search a specific set of files for a keyword using ripgrep.
 */
function grepFiles(
  keyword: string,
  filePaths: string[],
): { file: string; line: number; content: string }[] {
  const results: { file: string; line: number; content: string }[] = [];
  if (filePaths.length === 0) return results;

  try {
    const out = execFileSync("rg", ["-n", "-i", "--max-count", "3", keyword, ...filePaths], {
      encoding: "utf-8",
      timeout: 30000,
      shell: false,
    });
    for (const line of out.split("\n").filter(Boolean)) {
      const match = line.match(/^(.+?):(\d+):(.*)$/);
      if (match) {
        results.push({
          file: match[1],
          line: parseInt(match[2], 10),
          content: match[3].trim().substring(0, 120),
        });
      }
    }
  } catch {
    // rg returns non-zero if no matches
  }
  return results;
}

/**
 * Search the entire project (excluding node_modules/.git) for a keyword
 * in files matching the given glob patterns, using ripgrep.
 */
function grepProject(
  projectRoot: string,
  keyword: string,
  includePatterns: string[],
): { file: string; line: number; content: string }[] {
  const results: { file: string; line: number; content: string }[] = [];

  try {
    const globFlags = includePatterns.flatMap(p => ["--glob", p]);
    const out = execFileSync("rg", ["-n", "-i", "--max-count", "2", ...globFlags, keyword, projectRoot], {
      encoding: "utf-8",
      timeout: 30000,
      shell: false,
    });
    for (const line of out.split("\n").filter(Boolean)) {
      const match = line.match(/^(.+?):(\d+):(.*)$/);
      if (match) {
        results.push({
          file: match[1],
          line: parseInt(match[2], 10),
          content: match[3].trim().substring(0, 120),
        });
      }
    }
  } catch {
    // rg returns non-zero if no matches
  }
  return results;
}

// ── Coverage Analysis ────────────────────────────────────────────────────────

const TEST_FILE_PATTERNS = [
  "*.test.*",
  "*.spec.*",
  "test_*",
  "*_test.*",
  "tests/**/*",
  "__tests__/**/*",
];

const SOURCE_FILE_PATTERNS = [
  "*.ts",
  "*.tsx",
  "*.js",
  "*.jsx",
  "*.py",
  "*.go",
  "*.rs",
  "*.java",
  "*.rb",
  "*.php",
  "*.vue",
  "*.svelte",
];

const COMMAND_PATTERNS = [
  /\b(?:npm\s+test|bun\s+test|npx\s+\S+|python\s+-m\s+\S+|go\s+test|cargo\s+test|pytest|jest|mocha|vitest)\b/i,
  /\bcurl\s+\S+/i,
];

const VAGUE_PATTERNS = [
  /\bmanual\s+inspection\b/i,
  /\bcode\s+review\b/i,
  /\bvisual\s+check\b/i,
  /\bvisual\s+inspection\b/i,
  /\bpeer\s+review\b/i,
  /\bhuman\s+review\b/i,
  /\bdemo\b/i,
  /\bwalk[- ]?through\b/i,
];

export function isVagueVerification(method: string): boolean {
  return VAGUE_PATTERNS.some(p => p.test(method));
}

export function hasTestCommand(method: string): boolean {
  return COMMAND_PATTERNS.some(p => p.test(method));
}

export function extractKeywords(text: string): string[] {
  return text
    .split(/[\s,;:.!?()\[\]{}"'/=+_\-\\|`~@#$%^&*<>]+/)
    .map(w => w.replace(/^['"]|['"]$/g, "").trim().toLowerCase())
    .filter(w => w.length > 2 && !/^\d+$/.test(w));
}

export function extractFilePaths(method: string): string[] {
  const paths: string[] = [];
  const fileRegex = /(?:\/[\w.\-]+)+\.\w+/g;
  let match: RegExpExecArray | null;
  while ((match = fileRegex.exec(method)) !== null) {
    paths.push(match[0]);
  }
  return paths;
}

export function extractApiEndpoints(method: string): string[] {
  const endpoints: string[] = [];
  const apiRegex = /(?:(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+)?\/[\w\-/]+/gi;
  let match: RegExpExecArray | null;
  while ((match = apiRegex.exec(method)) !== null) {
    endpoints.push(match[0].trim());
  }
  return endpoints;
}

export function analyzeAC(
  ac: AcceptanceCriterion,
  projectRoot: string,
  testFiles: string[],
): ACResult {
  const suggestions: string[] = [];
  const vm = ac.verification_method;
  const acDesc = ac.description;

  // Check if verification method is too vague
  if (isVagueVerification(vm)) {
    return {
      id: ac.id,
      description: acDesc,
      verification_method: vm,
      status: "unknown",
      evidence: [],
      suggestions: [
        `Replace "${vm.trim()}" with a concrete test command or automated verification step`,
      ],
    };
  }

  const hasCmd = hasTestCommand(vm);
  const keywords = extractKeywords(acDesc + " " + vm);
  const mentionedPaths = extractFilePaths(vm);
  const apiEndpoints = extractApiEndpoints(vm);

  // Search test files for keywords
  let testFileEvidence: EvidenceItem[] = [];
  if (testFiles.length > 0 && keywords.length > 0) {
    const searchKeywords = keywords.slice(0, 5);
    for (const kw of searchKeywords) {
      const hits = grepFiles(kw, testFiles);
      for (const h of hits) {
        testFileEvidence.push(h);
      }
    }
  }

  // Also search for mentioned file paths in test files
  if (mentionedPaths.length > 0 && testFiles.length > 0) {
    for (const mp of mentionedPaths) {
      const fileName = mp.split("/").pop() || mp;
      const hits = grepFiles(fileName, testFiles);
      for (const h of hits) {
        testFileEvidence.push(h);
      }
    }
  }

  // Search for API endpoints in test files
  if (apiEndpoints.length > 0 && testFiles.length > 0) {
    for (const ep of apiEndpoints) {
      const epShort = ep.replace(/^(GET|POST|PUT|DELETE|PATCH)\s+/i, "");
      const hits = grepFiles(epShort, testFiles);
      for (const h of hits) {
        testFileEvidence.push(h);
      }
    }
  }

  // Deduplicate test file evidence
  const seenTest = new Set<string>();
  const uniqueTestEvidence: EvidenceItem[] = [];
  for (const e of testFileEvidence) {
    const key = `${e.file}:${e.line}`;
    if (!seenTest.has(key)) {
      seenTest.add(key);
      uniqueTestEvidence.push(e);
    }
  }

  // Search source code for keywords, function names, API endpoints
  let sourceEvidence: EvidenceItem[] = [];
  if (keywords.length > 0) {
    const searchKeywords = keywords.slice(0, 5);
    for (const kw of searchKeywords) {
      const hits = grepProject(projectRoot, kw, SOURCE_FILE_PATTERNS);
      for (const h of hits) {
        sourceEvidence.push(h);
      }
    }
  }

  // Search for API endpoints in source
  if (apiEndpoints.length > 0) {
    for (const ep of apiEndpoints) {
      const epShort = ep.replace(/^(GET|POST|PUT|DELETE|PATCH)\s+/i, "");
      const hits = grepProject(projectRoot, epShort, SOURCE_FILE_PATTERNS);
      for (const h of hits) {
        sourceEvidence.push(h);
      }
    }
  }

  // Search for mentioned file paths in source
  if (mentionedPaths.length > 0) {
    for (const mp of mentionedPaths) {
      const fileName = mp.split("/").pop() || mp;
      const hits = grepProject(projectRoot, fileName, SOURCE_FILE_PATTERNS);
      for (const h of hits) {
        sourceEvidence.push(h);
      }
    }
  }

  // Deduplicate source evidence
  const seenSrc = new Set<string>();
  const uniqueSourceEvidence: EvidenceItem[] = [];
  for (const e of sourceEvidence) {
    const key = `${e.file}:${e.line}`;
    if (!seenSrc.has(key)) {
      seenSrc.add(key);
      uniqueSourceEvidence.push(e);
    }
  }

  // Combine evidence (test evidence first)
  const allEvidence = [...uniqueTestEvidence, ...uniqueSourceEvidence];

  // Determine status
  const hasTestEvidence = uniqueTestEvidence.length > 0;
  const hasSourceEvidence = uniqueSourceEvidence.length > 0;

  let status: CoverageStatus;
  if (hasCmd && hasTestEvidence) {
    status = "covered";
  } else if (hasTestEvidence || hasSourceEvidence) {
    status = "partial";
  } else {
    status = "missing";
  }

  // Generate suggestions
  if (status === "missing") {
    if (hasCmd) {
      suggestions.push(
        `Test command found ("${vm.trim().substring(0, 80)}") but no matching test files or source code found`,
      );
    }
    suggestions.push(
      `Create a test file for acceptance criterion "${ac.id}: ${acDesc.substring(0, 60)}"`,
    );
    if (keywords.length > 0) {
      suggestions.push(
        `Consider adding tests that cover: ${keywords.slice(0, 3).join(", ")}`,
      );
    }
  } else if (status === "partial") {
    if (!hasCmd) {
      suggestions.push(
        `Add a concrete test command to the verification method (e.g., "bun test ...")`,
      );
    }
    if (!hasTestEvidence) {
      suggestions.push(
        `Add a test that verifies: ${acDesc.substring(0, 80)}`,
      );
    }
  }

  return {
    id: ac.id,
    description: acDesc,
    verification_method: vm,
    status,
    evidence: allEvidence.slice(0, 10),
    suggestions,
  };
}

// ── Report Generation ────────────────────────────────────────────────────────

export function generateReport(plan: Plan, projectRoot: string): CoverageReport {
  const testFiles = findFiles(projectRoot, TEST_FILE_PATTERNS);

  const results: CheckpointResult[] = [];
  let total = 0;
  let covered = 0;
  let partial = 0;
  let missing = 0;
  let unknown = 0;

  for (const cp of plan.checkpoints) {
    const acs: ACResult[] = [];
    for (const ac of cp.acceptance_criteria) {
      const result = analyzeAC(ac, projectRoot, testFiles);
      acs.push(result);
      total++;
      switch (result.status) {
        case "covered": covered++; break;
        case "partial": partial++; break;
        case "missing": missing++; break;
        case "unknown": unknown++; break;
      }
    }
    results.push({ id: cp.id, title: cp.title, acs });
  }

  const coveragePct = total > 0 ? Math.round((covered / total) * 100) : 0;

  return {
    plan_title: plan.title,
    summary: { total, covered, partial, missing, unknown, coverage_pct: coveragePct },
    results,
  };
}

// ── Output Formatting ────────────────────────────────────────────────────────

export function formatText(report: CoverageReport): string {
  const lines: string[] = [];
  const s = report.summary;

  lines.push(`# Plan Coverage Report: ${report.plan_title}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Total ACs: ${s.total}`);
  lines.push(`- Covered: ${s.covered} (${s.total > 0 ? Math.round((s.covered / s.total) * 100) : 0}%)`);
  lines.push(`- Partial: ${s.partial} (${s.total > 0 ? Math.round((s.partial / s.total) * 100) : 0}%)`);
  lines.push(`- Missing: ${s.missing} (${s.total > 0 ? Math.round((s.missing / s.total) * 100) : 0}%)`);
  lines.push(`- Unknown: ${s.unknown} (${s.total > 0 ? Math.round((s.unknown / s.total) * 100) : 0}%)`);
  lines.push(`- Overall Coverage: ${s.coverage_pct}%`);
  lines.push("");

  for (const cpResult of report.results) {
    lines.push(`## Per-AC Results`);
    lines.push("");
    lines.push(`### [${cpResult.id}] ${cpResult.title}`);
    lines.push("");

    for (const ac of cpResult.acs) {
      let icon: string;
      switch (ac.status) {
        case "covered": icon = "✅"; break;
        case "partial": icon = "⚠️"; break;
        case "missing": icon = "❌"; break;
        case "unknown": icon = "❓"; break;
      }

      lines.push(`- ${icon} [${ac.id}] ${ac.description} — **${ac.status}**`);
      lines.push(`  - Verification: ${ac.verification_method}`);

      if (ac.evidence.length > 0) {
        lines.push(`  - Evidence:`);
        for (const ev of ac.evidence) {
          const relPath = relative(process.cwd(), ev.file);
          lines.push(`    - ${relPath} (line ${ev.line}): "${ev.content}"`);
        }
      } else {
        lines.push(`  - Evidence: (none found)`);
      }

      if (ac.suggestions.length > 0) {
        lines.push(`  - Suggestions:`);
        for (const sug of ac.suggestions) {
          lines.push(`    - ${sug}`);
        }
      } else {
        lines.push(`  - Suggestions: (none)`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function formatJson(report: CoverageReport): string {
  return JSON.stringify(report, null, 2);
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    return 1;
  }

  const { planPath, projectRoot, format, threshold } = args;

  // Validate plan file exists
  if (!existsSync(planPath)) {
    console.error(`Error: plan file not found: "${planPath}"`);
    return 1;
  }

  // Validate project root exists
  if (!existsSync(projectRoot)) {
    console.error(`Error: project root not found: "${projectRoot}"`);
    return 1;
  }

  // Read and parse plan
  let data: PlanData;
  try {
    const raw = readFileSync(planPath, "utf-8");
    data = JSON.parse(raw) as PlanData;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Error reading plan file "${planPath}": ${msg}`);
    return 1;
  }

  if (!data.plan || !data.plan.checkpoints) {
    console.error(`Error: plan file "${planPath}" is missing required "plan.checkpoints" field`);
    return 1;
  }

  // Generate coverage report
  const report = generateReport(data.plan, projectRoot);

  // Output
  if (format === "json") {
    console.log(formatJson(report));
  } else {
    console.log(formatText(report));
  }

  // Exit code: 0 if coverage >= threshold, 1 if below threshold
  if (report.summary.coverage_pct < threshold) {
    console.error(
      `\nCoverage threshold not met: ${report.summary.coverage_pct}% < ${threshold}%`,
    );
    return 1;
  }

  return 0;
}

if (import.meta.main) {
  process.exit(main());
}
