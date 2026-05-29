#!/usr/bin/env node
/**
 * Pipeline Gitleaks Scan
 *
 * Automated Gitleaks secret scanning for the pipeline Security Scan gate.
 * Replaces the manual "Orchestrator loads gitleaks-scan skill and runs podman"
 * workflow with a single script call.
 *
 * Features:
 *   - Checks podman availability
 *   - Auto-pulls gitleaks container image if not present
 *   - Runs gitleaks in git mode (full history scan)
 *   - Returns structured JSON output for machine parsing
 *   - Exit code 0 = no leaks, 1 = leaks detected, 2 = error
 *   - Integrates with pipeline circuit breaker and agent-context.md
 *
 * Usage:
 *   pipeline-gitleaks.ts [options]
 *
 * Options:
 *   --workspace=<path>    Path to workspace root (default: $PWD)
 *   --mode=<mode>         Scan mode: git (default), dir, stdin
 *   --report-format=<fmt> Output format: json (default), csv, sarif, junit
 *   --verbose             Enable verbose gitleaks output
 *   --no-banner           Suppress gitleaks banner (default: true)
 *   --baseline=<path>     Path to baseline.json for incremental scanning
 *   --config=<path>       Path to custom .gitleaks.toml
 *   --ignore=<path>       Path to .gitleaksignore
 *   --max-target-mb=<N>   Max target file size in MB (default: 50)
 *   --timeout=<N>         Timeout in seconds (default: 300)
 *   --fail-on-leaks       Exit 1 if leaks found (default: true)
 *   --image=<name>        Container image (default: docker.io/zricethezav/gitleaks:latest)
 *   --no-pull             Skip pulling the container image
 *
 * Exit codes:
 *   0 = No leaks found (PASS)
 *   1 = Leaks detected (FAIL)
 *   2 = Error (tool unavailable, podman error, etc.)
 *
 * Output (JSON to stdout):
 *   {
 *     "scanPassed": boolean,
 *     "findings": Array<{...}>,
 *     "summary": { "total": number, "high": number, "medium": number, "low": number },
 *     "exitCode": number,
 *     "toolCheck": { "podman": boolean, "image": boolean },
 *     "duration": number (ms)
 *   }
 */

import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';

// ── Types ──────────────────────────────────────────────────────────

interface GitleaksFinding {
  Description: string;
  Secret: string;
  RuleID: string;
  Entropy: number;
  File: string;
  Line: string;
  StartLine: number;
  EndLine: number;
  Commit: string;
  Author: string;
  Email: string;
  Date: string;
  Fingerprint: string;
  Tags: string[];
  Match: string;
  [key: string]: unknown;
}

interface ScanSummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
}

interface ScanResult {
  scanPassed: boolean;
  findings: GitleaksFinding[];
  summary: ScanSummary;
  exitCode: number;
  toolCheck: {
    podman: boolean;
    image: boolean;
    imageVersion: string | null;
  };
  duration: number;
  error?: string;
  rawStdout: string;
  rawStderr: string;
}

interface Args {
  workspace: string;
  mode: 'git' | 'dir' | 'stdin';
  reportFormat: string;
  verbose: boolean;
  noBanner: boolean;
  baseline: string | null;
  config: string | null;
  ignore: string | null;
  maxTargetMb: number;
  timeout: number;
  failOnLeaks: boolean;
  image: string;
  noPull: boolean;
}

// ── Defaults ───────────────────────────────────────────────────────

const DEFAULTS: Args = {
  workspace: process.cwd(),
  mode: 'git',
  reportFormat: 'json',
  verbose: false,
  noBanner: true,
  baseline: null,
  config: null,
  ignore: null,
  maxTargetMb: 50,
  timeout: 300,
  failOnLeaks: true,
  image: 'docker.io/zricethezav/gitleaks:latest',
  noPull: false,
};

// ── Helpers ────────────────────────────────────────────────────────

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  const args: Args = { ...DEFAULTS };

  for (const a of raw) {
    if (a === '--verbose') { args.verbose = true; continue; }
    if (a === '--no-banner') { args.noBanner = true; continue; }
    if (a === '--fail-on-leaks') { args.failOnLeaks = true; continue; }
    if (a === '--no-fail-on-leaks') { args.failOnLeaks = false; continue; }
    if (a === '--no-pull') { args.noPull = true; continue; }
    if (a.startsWith('--workspace=')) { args.workspace = a.split('=')[1]; continue; }
    if (a.startsWith('--mode=')) {
      const m = a.split('=')[1];
      if (m === 'git' || m === 'dir' || m === 'stdin') args.mode = m;
      continue;
    }
    if (a.startsWith('--report-format=')) { args.reportFormat = a.split('=')[1]; continue; }
    if (a.startsWith('--baseline=')) { args.baseline = a.split('=')[1]; continue; }
    if (a.startsWith('--config=')) { args.config = a.split('=')[1]; continue; }
    if (a.startsWith('--ignore=')) { args.ignore = a.split('=')[1]; continue; }
    if (a.startsWith('--max-target-mb=')) { args.maxTargetMb = parseInt(a.split('=')[1], 10) || 50; continue; }
    if (a.startsWith('--timeout=')) { args.timeout = parseInt(a.split('=')[1], 10) || 300; continue; }
    if (a.startsWith('--image=')) { args.image = a.split('=')[1]; continue; }
    // Unknown flag — warn and ignore (don't crash)
    if (a.startsWith('--')) {
      console.error(`[pipeline-gitleaks] Warning: unknown flag "${a.split('=')[0]}" ignored`);
    }
  }

  return args;
}

function exec(
  cmd: string,
  cwd?: string,
  timeout?: number
): { stdout: string; stderr: string; code: number } {
  try {
    const result = child_process.spawnSync(cmd, {
      shell: true,
      cwd: cwd || DEFAULTS.workspace,
      encoding: 'utf-8',
      timeout: (timeout || DEFAULTS.timeout) * 1000,
      maxBuffer: 10 * 1024 * 1024, // 10 MB
    });
    return {
      stdout: result.stdout?.trim() || '',
      stderr: result.stderr?.trim() || '',
      code: result.status ?? 1,
    };
  } catch (e) {
    // spawnSync throws on timeout or signal. Use code 124 (like timeout) or 255.
    const msg = (e as Error).message;
    const isTimeout = msg.includes('timeout') || msg.includes('ETIMEDOUT');
    return { stdout: '', stderr: msg, code: isTimeout ? 124 : 255 };
  }
}

function sanitizeRelPath(workspace: string, userPath: string): string {
  // Compute relative path and prevent traversal outside workspace
  const rel = path.relative(workspace, path.resolve(userPath));
  if (rel.startsWith('..')) {
    // Path traversal detected — use just the basename
    console.error(`[pipeline-gitleaks] Warning: path "${userPath}" is outside workspace. Using basename.`);
    return path.basename(userPath);
  }
  return rel;
}

function checkPodman(): { available: boolean; version: string | null } {
  const r = exec('podman --version 2>/dev/null');
  if (r.code === 0 && r.stdout.length > 0) {
    return { available: true, version: r.stdout.split('\n')[0].trim() };
  }
  // Try docker as fallback
  const r2 = exec('docker --version 2>/dev/null');
  if (r2.code === 0 && r2.stdout.length > 0) {
    return { available: false, version: null };
    // Note: we report false for podman check even though docker is available,
    // because the pipeline is configured for podman. The error message will guide the user.
  }
  return { available: false, version: null };
}

function checkContainerImage(image: string): { exists: boolean; version: string | null } {
  // Try podman first
  const r = exec(`podman image exists "${image}" 2>&1`);
  if (r.code === 0) {
    // Get version from image labels (no container start needed)
    const v = exec(`podman inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "${image}" 2>/dev/null`);
    return { exists: true, version: v.code === 0 && v.stdout.trim() ? v.stdout.trim() : null };
  }
  return { exists: false, version: null };
}

function pullContainerImage(image: string): boolean {
  console.error(`[pipeline-gitleaks] Pulling image: ${image} ...`);
  const r = exec(`podman pull "${image}" 2>&1`);
  if (r.code !== 0) {
    console.error(`[pipeline-gitleaks] Failed to pull image: ${r.stderr}`);
    return false;
  }
  console.error(`[pipeline-gitleaks] Image pulled successfully.`);
  return true;
}

function buildGitleaksCommand(args: Args): string[] {
  const parts: string[] = [];

  parts.push('podman run --rm');
  parts.push(`-v "${args.workspace}:/src:Z"`);

  if (args.timeout) {
    parts.push(`--timeout=${args.timeout}`);
  }

  parts.push(`"${args.image}"`);

  if (args.mode === 'git') {
    // Gitleaks v8.30+ git mode: path is positional arg, not --source flag
    parts.push('git');
    if (args.noBanner) parts.push('--no-banner');
    if (args.verbose) parts.push('--verbose');
    parts.push('--exit-code=1');
    parts.push(`--report-format=${args.reportFormat}`);
    parts.push('--report-path=-'); // stdout
    if (args.maxTargetMb) parts.push(`--max-target-megabytes=${args.maxTargetMb}`);
    if (args.baseline) parts.push(`--baseline-path="/src/${sanitizeRelPath(args.workspace, args.baseline)}"`);
    if (args.config) parts.push(`--config="/src/${sanitizeRelPath(args.workspace, args.config)}"`);
    if (args.ignore) parts.push(`--gitleaks-ignore-path="/src/${sanitizeRelPath(args.workspace, args.ignore)}"`);
    // Repo path as positional arg
    parts.push('/src');
  } else if (args.mode === 'stdin') {
    parts.push('stdin');
    if (args.noBanner) parts.push('--no-banner');
    if (args.verbose) parts.push('--verbose');
    parts.push('--exit-code=1');
    parts.push(`--report-format=${args.reportFormat}`);
    parts.push('--report-path=-');
    if (args.config) parts.push(`--config="/src/${sanitizeRelPath(args.workspace, args.config)}"`);
    if (args.maxTargetMb) parts.push(`--max-target-megabytes=${args.maxTargetMb}`);
  } else {
    // dir mode (gitleaks v8.30+: path is positional arg)
    parts.push('dir');
    parts.push('/src');
    if (args.noBanner) parts.push('--no-banner');
    if (args.verbose) parts.push('--verbose');
    parts.push('--exit-code=1');
    parts.push(`--report-format=${args.reportFormat}`);
    parts.push('--report-path=-');
    if (args.maxTargetMb) parts.push(`--max-target-megabytes=${args.maxTargetMb}`);
    if (args.baseline) parts.push(`--baseline-path="/src/${sanitizeRelPath(args.workspace, args.baseline)}"`);
    if (args.config) parts.push(`--config="/src/${sanitizeRelPath(args.workspace, args.config)}"`);
    if (args.ignore) parts.push(`--gitleaks-ignore-path="/src/${sanitizeRelPath(args.workspace, args.ignore)}"`);
  }

  return parts;
}

function parseGitleaksFindings(stdout: string): GitleaksFinding[] {
  // Try parsing as JSON array
  try {
    const trimmed = stdout.trim();
    let parsed: unknown[] | null = null;

    if (trimmed.startsWith('[')) {
      parsed = JSON.parse(trimmed);
    } else if (trimmed.startsWith('{')) {
      const obj = JSON.parse(trimmed);
      // Gitleaks JSON report with metadata wrapper
      if (obj.vulnerabilities) parsed = obj.vulnerabilities;
      else if (obj.findings) parsed = obj.findings;
      else parsed = [obj];
    }

    if (parsed && Array.isArray(parsed)) {
      // Normalize field names: gitleaks v8.30+ uses StartLine, not Line
      return (parsed as Record<string, unknown>[]).map((f: Record<string, unknown>) => {
        const finding: Record<string, unknown> = { ...f };
        // Map StartLine → Line for compatibility
        if (finding.StartLine !== undefined && finding.Line === undefined) {
          finding.Line = String(finding.StartLine);
        }
        if (finding.EndLine !== undefined && finding.Line === undefined) {
          finding.Line = String(finding.EndLine);
        }
        return finding as unknown as GitleaksFinding;
      });
    }
  } catch {
    // Not JSON — findings in human-readable format or empty
  }
  return [];
}

function classifySeverity(finding: GitleaksFinding): 'critical' | 'high' | 'medium' | 'low' {
  const tags = finding.Tags || [];
  const desc = (finding.Description || '').toLowerCase();
  const ruleId = (finding.RuleID || '').toLowerCase();

  // Critical severity indicators
  if (
    tags.some(t => t.toLowerCase().includes('critical')) ||
    desc.includes('critical') ||
    ruleId.includes('critical')
  ) return 'critical';

  // High severity indicators
  if (
    tags.some(t => t.toLowerCase().includes('high')) ||
    desc.includes('high') ||
    ruleId.includes('high') ||
    ruleId.includes('aws') ||
    ruleId.includes('gcp') ||
    ruleId.includes('github') ||
    ruleId.includes('slack') ||
    ruleId.includes('stripe') ||
    ruleId.includes('private-key')
  ) return 'high';

  // Medium severity
  if (
    tags.some(t => t.toLowerCase().includes('medium')) ||
    desc.includes('medium') ||
    ruleId.includes('generic') ||
    ruleId.includes('api')
  ) return 'medium';

  return 'low';
}

function summarizeFindings(findings: GitleaksFinding[]): ScanSummary {
  const summary: ScanSummary = { total: findings.length, critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };

  for (const f of findings) {
    const severity = classifySeverity(f);
    summary[severity]++;
  }

  return summary;
}

function printJson(result: ScanResult): void {
  // Strip raw buffers from output for cleaner machine parsing
  const output: Record<string, unknown> = { ...result };
  // Keep rawStdout/rawStderr only if they have content and it's useful
  if (!output.rawStdout) delete output.rawStdout;
  if (!output.rawStderr) delete output.rawStderr;
  // Strip empty error field
  if (!output.error) delete output.error;
  // Use a fixed order for important fields
  const ordered: Record<string, unknown> = {
    scanPassed: output.scanPassed,
    exitCode: output.exitCode,
    summary: output.summary,
    findings: output.findings,
    toolCheck: output.toolCheck,
    duration: output.duration,
  };
  if (output.error) ordered.error = output.error;
  console.log(JSON.stringify(ordered, null, 2));
}

// ── Main Scan Logic ────────────────────────────────────────────────

function runScan(args: Args): ScanResult {
  const startTime = Date.now();
  const result: ScanResult = {
    scanPassed: false,
    findings: [],
    summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
    exitCode: 2,
    toolCheck: { podman: false, image: false, imageVersion: null },
    duration: 0,
    rawStdout: '',
    rawStderr: '',
  };

  // ── Step 1: Check podman ──────────────────────────────────────
  const podmanCheck = checkPodman();
  result.toolCheck.podman = podmanCheck.available;

  if (!podmanCheck.available) {
    result.error = 'podman is not available. Install podman (https://podman.io/docs/installation) or run: brew install podman';
    result.duration = Date.now() - startTime;
    return result;
  }

  // ── Step 2: Check/pull image ──────────────────────────────────
  const imageCheck = checkContainerImage(args.image);
  result.toolCheck.image = imageCheck.exists;
  result.toolCheck.imageVersion = imageCheck.version;

  if (!imageCheck.exists) {
    if (args.noPull) {
      result.error = `Container image "${args.image}" not found locally and --no-pull is set. Run: podman pull "${args.image}"`;
      result.duration = Date.now() - startTime;
      return result;
    }
    const pulled = pullContainerImage(args.image);
    if (!pulled) {
      result.error = `Failed to pull container image "${args.image}". Check network connectivity or run: podman pull "${args.image}"`;
      result.duration = Date.now() - startTime;
      return result;
    }
    // Re-check after pull
    const reCheck = checkContainerImage(args.image);
    result.toolCheck.image = reCheck.exists;
    result.toolCheck.imageVersion = reCheck.version;
    if (!reCheck.exists) {
      result.error = `Container image "${args.image}" still not found after pull attempt.`;
      result.duration = Date.now() - startTime;
      return result;
    }
  }

  // ── Step 3: Run gitleaks ──────────────────────────────────────
  const cmd = buildGitleaksCommand(args).join(' ');
  console.error(`[pipeline-gitleaks] Running: gitleaks ${args.mode} scan ...`);

  const scanResult = exec(cmd, args.workspace, args.timeout + 30); // extra 30s buffer

  result.rawStdout = scanResult.stdout;
  result.rawStderr = scanResult.stderr;
  result.exitCode = scanResult.code;

  // ── Step 4: Parse findings ────────────────────────────────────
  // Gitleaks v8.30+ outputs JSON to stdout when --report-path=-,
  // or human-readable to stderr when no JSON flag. Check both.
  if (scanResult.stdout.length > 0) {
    result.findings = parseGitleaksFindings(scanResult.stdout);
  }
  // If stdout had no findings but exit code is 1, stderr may have findings
  // in human-readable format. Attempt JSON parse on stderr too.
  if (result.findings.length === 0 && scanResult.stderr.length > 0 && scanResult.code === 1) {
    result.findings = parseGitleaksFindings(scanResult.stderr);
    // If stderr was human-readable (not JSON), we can't parse it — mark generically
    if (result.findings.length === 0 && scanResult.stderr.includes('Finding:')) {
      // Human-readable findings count: count "Finding:" occurrences
      const findingCount = (scanResult.stderr.match(/Finding:/g) || []).length;
      result.summary.total = findingCount;
      // Can't determine severity from human-readable output; classify each as unknown
      result.summary.unknown = findingCount;
    }
  }

  result.summary = summarizeFindings(result.findings);

  // ── Step 5: Determine verdict ──────────────────────────────────
  // With --report-path=- and --exit-code=1, gitleaks exits 1 on findings.
  // Without --exit-code=1, it exits 0 even with findings — we check stdout.
  // Exit 124 = podman timeout, 255 = podman/gitleaks crash — always errors.
  if (scanResult.code === 124) {
    result.scanPassed = false;
    result.error = result.error || `Gitleaks scan timed out after ${args.timeout}s. Increase --timeout or reduce --max-target-mb.`;
  } else if (scanResult.code === 0 && result.findings.length > 0) {
    // Exit 0 but findings present in stdout (no --exit-code flag)
    result.scanPassed = !args.failOnLeaks;
  } else if (scanResult.code === 0) {
    result.scanPassed = true;
  } else if (scanResult.code === 1) {
    result.scanPassed = !args.failOnLeaks;
  } else {
    // Exit code 2+ (or 255) = tool error
    result.scanPassed = false;
    result.error = result.error || `Gitleaks exited with code ${scanResult.code}`;
    if (scanResult.stderr) {
      result.error += `: ${scanResult.stderr.split('\n').slice(0, 5).join('; ')}`;
    }
  }

  result.duration = Date.now() - startTime;
  return result;
}

// ── Report Formatter ───────────────────────────────────────────────

function formatMarkdownReport(result: ScanResult, args: Args): string {
  const lines: string[] = [];

  lines.push('## Gitleaks Secret Scan Report');
  lines.push('');
  lines.push('### Configuration');
  lines.push(`- **Mode**: ${args.mode} (full history)`);
  lines.push(`- **Image**: ${args.image}`);
  lines.push(`- **Tool**: Podman ${result.toolCheck.podman ? '✅' : '❌'} | Image ${result.toolCheck.image ? '✅' : '❌'}`);
  if (result.toolCheck.imageVersion) lines.push(`- **Version**: ${result.toolCheck.imageVersion}`);
  lines.push(`- **Duration**: ${(result.duration / 1000).toFixed(1)}s`);
  lines.push('');

  if (result.error) {
    lines.push('### Error');
    lines.push(`❌ **${result.error}**`);
    lines.push('');
  }

  if (result.findings.length === 0 && !result.error) {
    lines.push('### Findings');
    lines.push('✅ **No secrets found.**');
    lines.push('');
    lines.push('### Verdict');
    lines.push('**✅ PASS** — No hardcoded secrets detected.');
    lines.push('');
    return lines.join('\n');
  }

  if (result.findings.length > 0) {
    lines.push('### Findings Overview');
    lines.push('| Severity | Count |');
    lines.push('|----------|-------|');
    if (result.summary.critical > 0) lines.push(`| 🔴 CRITICAL | ${result.summary.critical} |`);
    if (result.summary.high > 0) lines.push(`| 🔴 HIGH | ${result.summary.high} |`);
    if (result.summary.medium > 0) lines.push(`| 🟡 MEDIUM | ${result.summary.medium} |`);
    if (result.summary.low > 0) lines.push(`| 🔵 LOW | ${result.summary.low} |`);
    lines.push(`| **Total** | **${result.summary.total}** |`);
    lines.push('');

    lines.push('### Detailed Findings');
    lines.push('| Severity | Rule | File | Line | Commit |');
    lines.push('|----------|------|------|------|--------|');
    for (const f of result.findings) {
      const severity = classifySeverity(f);
      const severityIcon = severity === 'critical' || severity === 'high' ? '🔴' : severity === 'medium' ? '🟡' : '🔵';
      const commitShort = f.Commit ? f.Commit.substring(0, 8) : 'N/A';
      lines.push(`| ${severityIcon} ${severity.toUpperCase()} | ${f.RuleID || 'N/A'} | ${f.File || 'N/A'} | ${f.Line || 'N/A'} | ${commitShort} |`);
    }
    lines.push('');

    lines.push('### Verdict');
    if (result.scanPassed) {
      lines.push('**✅ PASS** — No blocking secrets detected.');
    } else {
      lines.push('**❌ FAIL** — Secrets detected, pipeline blocked.');
      lines.push('');
      lines.push('### Recommendations');
      lines.push('1. Remove hardcoded secrets from source code');
      lines.push('2. Move secrets to environment variables or a secrets manager');
      lines.push('3. Rotate any exposed credentials immediately');
      lines.push('4. Add matching fingerprints to `.gitleaksignore` if these are false positives');
    }
  }

  lines.push('');
  return lines.join('\n');
}

// ── Usage ──────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`
Pipeline Gitleaks Scan — Automated secret scanning for pipeline Security Gate

Usage:
  pipeline-gitleaks.ts [options]

Options:
  --workspace=<path>    Path to workspace root (default: $PWD)
  --mode=<mode>         Scan mode: git (default), dir, stdin
  --report-format=<fmt> Output format: json (default), csv, sarif, junit
  --verbose             Enable verbose gitleaks output
  --no-banner           Suppress gitleaks banner (default: true)
  --baseline=<path>     Path to baseline.json for incremental scanning
  --config=<path>       Path to custom .gitleaks.toml
  --ignore=<path>       Path to .gitleaksignore
  --max-target-mb=<N>   Max target file size in MB (default: 50)
  --timeout=<N>         Timeout in seconds (default: 300)
  --fail-on-leaks       Exit 1 if leaks found (default: true)
  --no-fail-on-leaks    Exit 0 even if leaks found (informational mode)
  --image=<name>        Container image
  --no-pull             Skip pulling the container image
  --markdown            Output human-readable markdown report instead of JSON
  --help                Show this help

Exit codes:
  0 = No leaks found (PASS)
  1 = Leaks detected (FAIL — pipeline blocked)
  2 = Error (tool unavailable, podman error, etc.)

Examples:
  pipeline-gitleaks.ts
  pipeline-gitleaks.ts --workspace=/path/to/repo --verbose
  pipeline-gitleaks.ts --mode=dir --config=.gitleaks.toml
  pipeline-gitleaks.ts --baseline=baseline.json --fail-on-leaks
  pipeline-gitleaks.ts --markdown
`);
}

// ── Main ───────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs();

  // Handle --help
  if (process.argv.slice(2).includes('--help') || process.argv.slice(2).includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const outputMarkdown = process.argv.slice(2).includes('--markdown');

  // Validate workspace
  if (!fs.existsSync(args.workspace)) {
    console.error(`Error: Workspace path not found: ${args.workspace}`);
    process.exit(2);
  }

  // Run the scan
  const result = runScan(args);

  // Output
  if (outputMarkdown) {
    console.log(formatMarkdownReport(result, args));
  } else {
    printJson(result);
  }

  // Exit with appropriate code
  if (result.exitCode === 2 || result.exitCode === 124 || result.exitCode === 255) {
    // Tool error / timeout — exit with the raw code
    process.exit(result.exitCode);
  }

  if (result.scanPassed) {
    process.exit(0);
  }

  if (result.findings.length > 0) {
    // --fail-on-leaks (default): exit 1 to block pipeline
    // This also handles the edge case where gitleaks exits 0 but findings exist
    // in stdout (e.g., no --exit-code=1 flag) and failOnLeaks=true
    process.exit(1);
  }

  // Fallback: exit with gitleaks' exit code (only reached if no findings and scan didn't pass)
  process.exit(result.exitCode);
}

if (require.main === module) {
  main();
}
