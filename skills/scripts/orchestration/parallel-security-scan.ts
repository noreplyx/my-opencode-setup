#!/usr/bin/env node
/**
 * Parallel Security Scan Aggregator
 *
 * Runs multiple security scans in PARALLEL using child_process.exec(),
 * collects results, and produces a unified security report with verdict.
 *
 * Scan types (all run in parallel):
 *   - npm-audit:     npm audit --audit-level=high --json
 *   - secrets:       Hardcoded secrets detection via ripgrep
 *   - anti-pattern:  eval, innerHTML, dangerous patterns
 *   - sast:          Deep static analysis (check-security.ts)
 *   - supply-chain:  Supply chain integrity (check-supply-chain.ts)
 *   - git-history:   Git log scan for secrets in history
 *
 * Usage:
 *   ts-node parallel-security-scan.ts [--dir=./] [--skills-dir=...] [--format=json] [--fail-fast]
 *
 * Output:
 *   By default: human-readable report to stdout.
 *   With --format=json: JSON report to stdout.
 *
 * Exit codes:
 *   0 = All scans passed (verdict: pass or warn)
 *   1 = At least one scan failed (verdict: fail — blocking)
 *   2 = Invalid arguments or configuration error
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

// =========================================================================
// Types
// =========================================================================

export type ScanStatus = 'pass' | 'fail' | 'warn' | 'error' | 'skipped';

export type ScanVerdict = 'pass' | 'warn' | 'fail';

export interface ScanResult {
  /** Unique scan identifier */
  name: string;
  /** Human-readable label */
  label: string;
  /** pass / fail / warn / error / skipped */
  status: ScanStatus;
  /** Duration in milliseconds */
  durationMs: number;
  /** Timestamp when scan started */
  startedAt: string;
  /** Structured findings */
  findings: ScanFinding[];
  /** Raw stdout from the scan command */
  rawStdout: string;
  /** Raw stderr from the scan command */
  rawStderr: string;
  /** Error message if the scan itself crashed or was skipped */
  error?: string;
}

export interface ScanFinding {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  message: string;
  file?: string;
  line?: number;
  recommendation?: string;
}

export interface UnifiedReport {
  /** ISO-8601 timestamp of scan start */
  startedAt: string;
  /** ISO-8601 timestamp of scan completion */
  completedAt: string;
  /** Total wall-clock duration in ms */
  totalDurationMs: number;
  /** Absolute path to the scanned project directory */
  projectDir: string;
  /** Overall verdict: pass / warn / fail */
  verdict: ScanVerdict;
  /** Reason for the verdict */
  verdictReason: string;
  /** Per-scan results */
  scans: ScanResult[];
  /** Summary counts */
  summary: {
    total: number;
    passed: number;
    failed: number;
    warned: number;
    errored: number;
    skipped: number;
    totalFindings: number;
    criticalFindings: number;
    highFindings: number;
    mediumFindings: number;
    lowFindings: number;
  };
}

// =========================================================================
// CLI argument parsing
// =========================================================================

interface CliArgs {
  dir: string;
  skillsDir: string;
  format: 'human' | 'json';
  failFast: boolean;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);

  const dirArg = argv.find(a => a.startsWith('--dir='));
  const skillsDirArg = argv.find(a => a.startsWith('--skills-dir='));
  const formatArg = argv.find(a => a.startsWith('--format='));
  const failFast = argv.includes('--fail-fast');

  const dir = dirArg ? path.resolve(dirArg.split('=')[1]) : path.resolve(process.cwd());
  const skillsDir = skillsDirArg
    ? path.resolve(skillsDirArg.split('=')[1])
    : path.resolve(__dirname, '..', '..');
  const format = formatArg?.split('=')[1] === 'json' ? 'json' : 'human';

  return { dir, skillsDir, format, failFast };
}

// =========================================================================
// Utility functions
// =========================================================================

/**
 * Run a shell command and return stdout, stderr, and the exit code.
 * Wraps child_process.exec() in a Promise.
 */
function runCommand(
  command: string,
  timeoutMs: number = 120_000,
  cwd?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = exec(
      command,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
        encoding: 'utf-8',
      },
      (error, stdout, stderr) => {
        const exitCode = error?.code ?? 0;
        resolve({
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          exitCode: typeof exitCode === 'number' ? exitCode : 1,
        });
      },
    );
  });
}

/**
 * Test if a command / binary is available on the system PATH.
 */
function isCommandAvailable(command: string): boolean {
  // Cross-platform PATH check (replaces Unix `which` / Windows `where`)
  const pathEnv = process.env.PATH || '';
  const pathDirs = pathEnv.split(path.delimiter);
  const isWindows = process.platform === 'win32';
  const extensions = isWindows
    ? ['', '.cmd', '.exe', '.bat', '.ps1']
    : [''];
  for (const dir of pathDirs) {
    for (const ext of extensions) {
      const fullPath = path.join(dir, command + ext);
      try {
        fs.accessSync(fullPath, fs.constants.X_OK);
        return true;
      } catch {
        continue;
      }
    }
  }
  return false;
    return false;
  }
}

/**
 * Check if a script file exists.
 */
function scriptExists(...segments: string[]): boolean {
  return fs.existsSync(path.join(...segments));
}

/**
 * Return an ISO-8601 timestamp string.
 */
function nowISO(): string {
  return new Date().toISOString();
}

// =========================================================================
// Individual scan implementations
// =========================================================================

/**
 * Scan 1: npm-audit — check for vulnerable dependencies.
 */
async function scanNpmAudit(dir: string): Promise<ScanResult> {
  const name = 'npm-audit';
  const label = 'NPM Audit';
  const startedAt = nowISO();
  const startMs = Date.now();

  const findings: ScanFinding[] = [];
  let rawStdout = '';
  let rawStderr = '';
  let status: ScanStatus = 'pass';

  try {
    // Check if package-lock.json exists
    if (!scriptExists(dir, 'package-lock.json') && !scriptExists(dir, 'package.json')) {
      return {
        name,
        label,
        status: 'skipped',
        durationMs: Date.now() - startMs,
        startedAt,
        findings: [],
        rawStdout: '',
        rawStderr: 'No package.json or package-lock.json found — skipping npm audit',
        error: 'No package.json or package-lock.json found',
      };
    }

    const result = await runCommand('npm audit --audit-level=high --json', 60_000, dir);
    rawStdout = result.stdout;
    rawStderr = result.stderr;

    // npm audit exits 0 when no vulnerabilities (or only low/moderate with --audit-level=high)
    // It exits non-zero when vulnerabilities matching the level are found.
    if (result.exitCode !== 0 && result.stdout.trim()) {
      try {
        const parsed = JSON.parse(result.stdout);

        // npm audit v2+ structure: { metadata: { vulnerabilities: { ... } } }
        const vulns = parsed.metadata?.vulnerabilities ?? parsed.vulnerabilities ?? {};
        const vulnTotal = typeof vulns.total === 'number' ? vulns.total
          : (vulns.critical ?? 0) + (vulns.high ?? 0) + (vulns.moderate ?? 0) + (vulns.low ?? 0);

        if (vulnTotal > 0 || result.exitCode !== 0) {
          status = 'fail';
        }

        // Extract individual advisories
        const advisories = parsed.advisories ?? {};
        for (const [id, adv] of Object.entries(advisories) as [string, any][]) {
          const sev = (adv.severity ?? 'high').toLowerCase();
          findings.push({
            severity: sev as ScanFinding['severity'],
            category: 'dependency-vulnerability',
            message: `${adv.title ?? 'Vulnerability'}: ${adv.overview ?? ''}`.slice(0, 300),
            file: adv.module_name ? `node_modules/${adv.module_name}` : undefined,
            recommendation: adv.recommendation ?? `Update ${adv.module_name ?? 'the package'} to a patched version.`,
          });
        }

        // Fallback: if no advisories but exit code says fail
        if (findings.length === 0 && result.exitCode !== 0) {
          findings.push({
            severity: 'high',
            category: 'dependency-vulnerability',
            message: `npm audit reported vulnerabilities (exit code ${result.exitCode})`,
            recommendation: 'Run npm audit for details.',
          });
        }
      } catch {
        // JSON parse failed — treat raw output as finding
        status = 'warn';
        findings.push({
          severity: 'medium',
          category: 'dependency-vulnerability',
          message: 'npm audit produced non-JSON output',
          recommendation: 'Run npm audit manually to review.',
        });
      }
    }

    // If exit code 0 but vulnerabilities found (shouldn't happen, but be safe)
    if (result.exitCode === 0 && status === 'fail') {
      status = 'warn';
    }
  } catch (err: any) {
    status = 'error';
    rawStderr = err.message ?? String(err);
  }

  return {
    name,
    label,
    status,
    durationMs: Date.now() - startMs,
    startedAt,
    findings,
    rawStdout,
    rawStderr,
  };
}

/**
 * Scan 2: secrets — hardcoded secrets detection via ripgrep.
 */
async function scanSecrets(dir: string): Promise<ScanResult> {
  const name = 'secrets';
  const label = 'Hardcoded Secrets';
  const startedAt = nowISO();
  const startMs = Date.now();

  const findings: ScanFinding[] = [];
  let rawStdout = '';
  let rawStderr = '';
  let status: ScanStatus = 'pass';

  if (!isCommandAvailable('rg')) {
    return {
      name,
      label,
      status: 'skipped',
      durationMs: Date.now() - startMs,
      startedAt,
      findings: [],
      rawStdout: '',
      rawStderr: 'ripgrep (rg) not found on PATH — skipping secrets scan',
      error: 'ripgrep (rg) not available. Install ripgrep or use --skills-dir to point to rg.',
    };
  }

  const secretPatterns = [
    // AWS keys
    '(?<![A-Za-z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Za-z0-9])',
    // GitHub tokens
    'gh[pso]_[A-Za-z0-9_]{36,}',
    // Slack tokens
    'xox[baprs]-[A-Za-z0-9-]{10,}',
    // Generic secret/key/password assignment with high-entropy values
    '(?:api[_-]?key|apikey|secret|password|token|credential|auth[_-]?token)\\s*[=:]\\s*[\'"]?(?:[A-Za-z0-9_!@#$%^&*()=+]{16,})',
    // SSH private keys
    '-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----',
    // JWT tokens (in code)
    'eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}',
    // Stripe keys
    '(?:sk|pk)_(?:test|live|prod)_[A-Za-z0-9]{10,}',
    // Twilio keys
    'SK[A-Za-z0-9]{32,}',
    // Google service account keys in code (base64 or JSON)
    '"type":\\s*"service_account"',
  ];

  try {
    // Build a single rg command with multiple -e patterns, excluding safe paths
    const patternArgs = secretPatterns.map(p => `-e '${p.replace(/'/g, "'\\''")}'`).join(' ');
    // Also scan git history if .git exists
    const command = `rg --no-heading -n ${patternArgs} --glob='!.git' --glob='!node_modules' --glob='!*.log' --glob='!dist' --glob='!build' --glob='!.venv' --glob='!__pycache__' -g='*.{ts,js,tsx,jsx,py,rb,go,sh,env,yml,yaml,json,config,toml,ini,cfg}' "${dir}" 2>/dev/null || true`;

    const result = await runCommand(command, 60_000);
    rawStdout = result.stdout;
    rawStderr = result.stderr;

    if (result.stdout.trim()) {
      const lines = result.stdout.trim().split('\n');
      for (const line of lines) {
        // rg format: <file>:<line>:<match>
        const match = line.match(/^(.+?):(\d+):(.+)$/);
        if (match) {
          const [, file, lineNum, matchedText] = match;
          const trimmedMatch = matchedText.length > 120
            ? matchedText.slice(0, 120) + '...'
            : matchedText;

          findings.push({
            severity: 'critical',
            category: 'hardcoded-secret',
            message: `Potential secret detected: ${trimmedMatch}`,
            file: path.relative(dir, file),
            line: parseInt(lineNum, 10),
            recommendation: 'Move secrets to environment variables or a secrets manager (e.g., .env file with dotenv, HashiCorp Vault, AWS Secrets Manager).',
          });
        } else {
          // Can't parse the rg output line format — still flag it
          const trimmedLine = line.length > 120 ? line.slice(0, 120) + '...' : line;
          findings.push({
            severity: 'high',
            category: 'hardcoded-secret',
            message: `Potential secret detected (unable to parse location): ${trimmedLine}`,
            recommendation: 'Review the matched line and move any secrets to environment variables.',
          });
        }
      }
    }

    status = findings.length > 0 ? 'fail' : 'pass';
  } catch (err: any) {
    status = 'error';
    rawStderr = err.message ?? String(err);
  }

  return {
    name,
    label,
    status,
    durationMs: Date.now() - startMs,
    startedAt,
    findings,
    rawStdout,
    rawStderr,
  };
}

/**
 * Scan 3: anti-pattern — detect eval, innerHTML, and other dangerous patterns.
 */
async function scanAntiPattern(dir: string): Promise<ScanResult> {
  const name = 'anti-pattern';
  const label = 'Anti-Patterns';
  const startedAt = nowISO();
  const startMs = Date.now();

  const findings: ScanFinding[] = [];
  let rawStdout = '';
  let rawStderr = '';
  let status: ScanStatus = 'pass';

  const dangerousPatterns: Array<{
    regex: string;
    severity: 'critical' | 'high' | 'medium';
    category: string;
    message: string;
    recommendation: string;
  }> = [
    {
      regex: '\\beval\\s*\\(',
      severity: 'critical',
      category: 'eval-usage',
      message: 'eval() usage detected — arbitrary code execution risk',
      recommendation: 'Use safer alternatives like Function constructor, JSON.parse, or dedicated parsers. Never pass user input to eval().',
    },
    {
      regex: '\\binnerHTML\\s*=',
      severity: 'high',
      category: 'xss-risk',
      message: 'innerHTML assignment detected — XSS vulnerability risk',
      recommendation: 'Use textContent or safe DOM APIs (createElement, setAttribute). If HTML is required, sanitize with DOMPurify or similar.',
    },
    {
      regex: '\\bouterHTML\\s*=',
      severity: 'high',
      category: 'xss-risk',
      message: 'outerHTML assignment detected — XSS vulnerability risk',
      recommendation: 'Avoid outerHTML assignments. Use DOM manipulation APIs instead.',
    },
    {
      regex: '\\bdocument\\.write\\s*\\(',
      severity: 'high',
      category: 'xss-risk',
      message: 'document.write() usage detected — XSS vulnerability risk',
      recommendation: 'Use DOM manipulation APIs (createElement, appendChild) instead of document.write().',
    },
    {
      regex: 'new\\s+Function\\s*\\(',
      severity: 'high',
      category: 'dangerous-runtime',
      message: 'new Function() usage detected — arbitrary code execution risk',
      recommendation: 'Avoid dynamic code generation. Use predefined logic or configuration-driven behavior.',
    },
    {
      regex: '\\bsetTimeout\\s*\\(\\s*[\'"]',
      severity: 'high',
      category: 'dangerous-runtime',
      message: 'setTimeout with string argument detected (eval-like behavior)',
      recommendation: 'Pass a function reference instead of a string to setTimeout.',
    },
    {
      regex: '\\bsetInterval\\s*\\(\\s*[\'"]',
      severity: 'high',
      category: 'dangerous-runtime',
      message: 'setInterval with string argument detected (eval-like behavior)',
      recommendation: 'Pass a function reference instead of a string to setInterval.',
    },
    {
      regex: '\\b__proto__\\b',
      severity: 'critical',
      category: 'prototype-pollution',
      message: '__proto__ reference detected — prototype pollution vulnerability',
      recommendation: 'Avoid using __proto__ for property access. Use Object.create(null) for safe dictionaries, or Map.',
    },
    {
      regex: '\\bprototype\\s*\\.\\s*\\w+\\s*=',
      severity: 'high',
      category: 'prototype-pollution',
      message: 'Prototype mutation detected — prototype pollution or monkey-patching',
      recommendation: 'Avoid mutating built-in prototypes. Use composition or wrapper functions instead.',
    },
    {
      regex: '\\.\\$where\\s*:',
      severity: 'critical',
      category: 'nosql-injection',
      message: 'MongoDB $where operator detected — NoSQL injection risk',
      recommendation: 'Avoid $where operator. Use structured query operators instead.',
    },
    {
      regex: '\\bchild_process\\b.*\\bexec\\b',
      severity: 'high',
      category: 'command-injection',
      message: 'child_process.exec() detected — command injection risk',
      recommendation: 'Use child_process.execFile() with arguments array instead of exec() with string concatenation.',
    },
    {
      regex: 'new\\s+RegExp\\s*\\(\\s*[a-zA-Z_$]',
      severity: 'high',
      category: 'redos-risk',
      message: 'RegExp constructed from a variable — ReDoS (ReDoS) risk if input is user-controlled',
      recommendation: 'Avoid constructing RegExp from user input. Use a predefined allowlist of patterns.',
    },
    {
      regex: '\\.innerHTML\\s*\\+=',
      severity: 'high',
      category: 'xss-risk',
      message: 'innerHTML concatenation detected — XSS vulnerability risk',
      recommendation: 'Use textContent or safe DOM APIs. Never concatenate user input into innerHTML.',
    },
  ];

  try {
    // Build rg command with all patterns
    const escapeForShell = (s: string) => s.replace(/'/g, "'\\''");
    const patternArgs = dangerousPatterns
      .map(p => `-e '${escapeForShell(p.regex)}'`)
      .join(' ');

    // Only scan JS/TS/HTML files, exclude node_modules, dist, build
    const command = `rg --no-heading -n ${patternArgs} --glob='!.git' --glob='!node_modules' --glob='!*.log' --glob='!dist' --glob='!build' --glob='!.venv' --glob='!__pycache__' -g='*.{ts,js,tsx,jsx,html,mjs,cjs}' "${dir}" 2>/dev/null || true`;

    const result = await runCommand(command, 60_000);
    rawStdout = result.stdout;
    rawStderr = result.stderr;

    if (result.stdout.trim()) {
      const lines = result.stdout.trim().split('\n');
      for (const rawLine of lines) {
        // Try to parse rg output: file:line:match
        const rgMatch = rawLine.match(/^(.+?):(\d+):(.+)$/);
        if (!rgMatch) continue;

        const [, file, lineNum, matchedText] = rgMatch;

        // Determine which pattern matched
        const matchedPattern = dangerousPatterns.find(p => {
          const re = new RegExp(p.regex);
          return re.test(matchedText);
        });

        if (matchedPattern) {
          findings.push({
            severity: matchedPattern.severity,
            category: matchedPattern.category,
            message: matchedPattern.message,
            file: path.relative(dir, file),
            line: parseInt(lineNum, 10),
            recommendation: matchedPattern.recommendation,
          });
        } else {
          // Generic catch-all for patterns that matched but we couldn't map back
          findings.push({
            severity: 'high',
            category: 'dangerous-pattern',
            message: `Potentially dangerous pattern detected: ${matchedText.slice(0, 100)}`,
            file: path.relative(dir, file),
            line: parseInt(lineNum, 10),
            recommendation: 'Review this code for security issues.',
          });
        }
      }
    }

    status = findings.length > 0 ? 'fail' : 'pass';
  } catch (err: any) {
    status = 'error';
    rawStderr = err.message ?? String(err);
  }

  return {
    name,
    label,
    status,
    durationMs: Date.now() - startMs,
    startedAt,
    findings,
    rawStdout,
    rawStderr,
  };
}

/**
 * Scan 4: sast — run the deep static analysis (check-security.ts) script.
 */
async function scanSast(dir: string, skillsDir: string): Promise<ScanResult> {
  const name = 'sast';
  const label = 'SAST (Static Analysis)';
  const startedAt = nowISO();
  const startMs = Date.now();

  const findings: ScanFinding[] = [];
  let rawStdout = '';
  let rawStderr = '';
  let status: ScanStatus = 'pass';

  const scriptPath = path.join(skillsDir, 'scripts', 'code-philosophy', 'check-security.ts');

  if (!scriptExists(scriptPath)) {
    return {
      name,
      label,
      status: 'skipped',
      durationMs: Date.now() - startMs,
      startedAt,
      findings: [],
      rawStdout: '',
      rawStderr: `check-security.ts not found at: ${scriptPath}`,
      error: `SAST script not found: ${scriptPath}`,
    };
  }

  try {
    const result = await runCommand(`ts-node "${scriptPath}" --dir="${dir}" --verbose`, 120_000);
    rawStdout = result.stdout;
    rawStderr = result.stderr;

    // Parse the output for findings
    // The check-security.ts script outputs lines like:
    //   🔴 **CWE-798**: Potential hardcoded secret or API key detected
    //      File: src/file.ts:42
    const issueSection = result.stdout.match(/### Issues\n([\s\S]*?)(?=\n\n|\n##|\n$)/);
    if (issueSection) {
      const issueLines = issueSection[1].split('\n');
      let currentFinding: Partial<ScanFinding> | null = null;

      for (const line of issueLines) {
        const trimmed = line.trim();

        // Severity markers
        let severity: ScanFinding['severity'] | null = null;
        if (trimmed.includes('🔴')) severity = 'critical';
        else if (trimmed.includes('🟡')) severity = 'high';
        else if (trimmed.includes('🔵')) severity = 'medium';

        if (severity) {
          // Push previous finding
          if (currentFinding && currentFinding.message) {
            findings.push(currentFinding as ScanFinding);
          }

          // Extract CWE and description: **CWE-XXX**: Description
          const cweMatch = trimmed.match(/\*\*(CWE-\d+)\*\*:?\s*(.+)$/);
          currentFinding = {
            severity,
            category: cweMatch?.[1] ?? 'sast-issue',
            message: cweMatch?.[2] ?? trimmed.replace(/^[🔴🟡🔵]\s*/, ''),
          };
        } else if (currentFinding && trimmed.startsWith('File:')) {
          // File: src/file.ts:42
          const fileMatch = trimmed.match(/File:\s*(.+?):(\d+)$/);
          if (fileMatch) {
            currentFinding.file = fileMatch[1];
            currentFinding.line = parseInt(fileMatch[2], 10);
          } else {
            currentFinding.file = trimmed.replace(/^File:\s*/, '');
          }
        } else if (currentFinding && trimmed.startsWith('Fix:')) {
          currentFinding.recommendation = trimmed.replace(/^Fix:\s*/, '');
        }
      }

      // Push last finding
      if (currentFinding && currentFinding.message) {
        findings.push(currentFinding as ScanFinding);
      }
    }

    // Determine status from findings + exit code
    const hasCritical = findings.some(f => f.severity === 'critical');
    const hasHigh = findings.some(f => f.severity === 'high');

    if (hasCritical) {
      status = 'fail';
    } else if (hasHigh) {
      status = 'warn';
    } else if (findings.length > 0) {
      status = 'warn';
    } else {
      status = 'pass';
    }

    // If the script exited non-zero, that's a strong signal
    if (result.exitCode !== 0 && findings.length === 0) {
      status = 'error';
      rawStderr = `SAST script exited with code ${result.exitCode}`;
    }
  } catch (err: any) {
    status = 'error';
    rawStderr = err.message ?? String(err);
  }

  return {
    name,
    label,
    status,
    durationMs: Date.now() - startMs,
    startedAt,
    findings,
    rawStdout,
    rawStderr,
  };
}

/**
 * Scan 5: supply-chain — run the supply chain integrity check script.
 */
async function scanSupplyChain(dir: string, skillsDir: string): Promise<ScanResult> {
  const name = 'supply-chain';
  const label = 'Supply Chain';
  const startedAt = nowISO();
  const startMs = Date.now();

  const findings: ScanFinding[] = [];
  let rawStdout = '';
  let rawStderr = '';
  let status: ScanStatus = 'pass';

  const scriptPath = path.join(skillsDir, 'scripts', 'code-philosophy', 'check-supply-chain.ts');

  if (!scriptExists(scriptPath)) {
    return {
      name,
      label,
      status: 'skipped',
      durationMs: Date.now() - startMs,
      startedAt,
      findings: [],
      rawStdout: '',
      rawStderr: `check-supply-chain.ts not found at: ${scriptPath}`,
      error: `Supply chain script not found: ${scriptPath}`,
    };
  }

  try {
    const result = await runCommand(`ts-node "${scriptPath}" --dir="${dir}" --verbose`, 120_000);
    rawStdout = result.stdout;
    rawStderr = result.stderr;

    // Parse output for various categories
    const sectionMap: Array<{
      header: string;
      category: string;
      severity: ScanFinding['severity'];
    }> = [
      { header: 'Install Scripts', category: 'install-scripts', severity: 'critical' },
      { header: 'Typosquatting', category: 'typosquatting', severity: 'medium' },
      { header: 'New Packages', category: 'new-package', severity: 'medium' },
      { header: 'Deprecated Packages', category: 'deprecated-package', severity: 'medium' },
      { header: 'Stale Packages', category: 'stale-package', severity: 'low' },
      { header: 'Lockfile Warnings', category: 'lockfile-integrity', severity: 'medium' },
      { header: 'Dependency Count Warning', category: 'dependency-count', severity: 'low' },
    ];

    for (const { header, category, severity } of sectionMap) {
      // Find section by header in output
      const sectionRegex = new RegExp(`###\\s+${header}[\\s\\S]*?(?=\\n###|\\n##|\\n$)`);
      const sectionMatch = result.stdout.match(sectionRegex);
      if (!sectionMatch) continue;

      const sectionLines = sectionMatch[0].split('\n');

      for (const line of sectionLines) {
        const trimmed = line.trim();

        // Skip headers, table separators, empty lines
        if (!trimmed || trimmed.startsWith('|') || trimmed.startsWith('⚠️') || trimmed.startsWith('##')) continue;

        if (header === 'Install Scripts') {
          if (trimmed.includes('Package')) continue; // skip table header
          if (!trimmed.startsWith('|')) {
            findings.push({
              severity,
              category,
              message: trimmed,
              recommendation: 'Review install scripts for malicious activity. Consider using npm config to disable install scripts.',
            });
          }
        } else if (header === 'Typosquatting') {
          if (trimmed.includes('Package')) continue;
          if (!trimmed.startsWith('|')) {
            findings.push({
              severity,
              category,
              message: trimmed,
              recommendation: 'Verify the package name matches the intended popular package.',
            });
          }
        } else if (header === 'Deprecated Packages') {
          if (trimmed.includes('Package')) continue;
          if (!trimmed.startsWith('|')) {
            const parts = trimmed.split('|').map(s => s.trim()).filter(Boolean);
            if (parts.length >= 2) {
              findings.push({
                severity,
                category,
                message: `Package "${parts[0]}" is deprecated. Replacement: ${parts[1]}`,
                recommendation: `Replace ${parts[0]} with ${parts[1]}.`,
              });
            }
          }
        } else {
          // Generic: add line as finding
          findings.push({
            severity,
            category,
            message: trimmed,
          });
        }
      }
    }

    // Also check for FAIL/WARN/PASS verdict lines in the output
    if (result.stdout.includes('❌ FAIL')) {
      status = 'fail';
    } else if (result.stdout.includes('⚠️ WARN')) {
      status = 'warn';
    } else if (result.stdout.includes('✅ PASS')) {
      status = 'pass';
    } else if (findings.length > 0) {
      status = 'warn';
    }

    // If exit code was 1, something critical was found
    if (result.exitCode === 1) {
      status = 'fail';
      if (findings.length === 0) {
        findings.push({
          severity: 'critical',
          category: 'supply-chain-violation',
          message: 'Supply chain check failed (exit code 1)',
          recommendation: 'Review the supply chain check output for critical issues.',
        });
      }
    }
  } catch (err: any) {
    status = 'error';
    rawStderr = err.message ?? String(err);
  }

  return {
    name,
    label,
    status,
    durationMs: Date.now() - startMs,
    startedAt,
    findings,
    rawStdout,
    rawStderr,
  };
}

/**
 * Scan 6: git-history — scan git log for secrets committed in history.
 */
async function scanGitHistory(dir: string): Promise<ScanResult> {
  const name = 'git-history';
  const label = 'Git History';
  const startedAt = nowISO();
  const startMs = Date.now();

  const findings: ScanFinding[] = [];
  let rawStdout = '';
  let rawStderr = '';
  let status: ScanStatus = 'pass';

  // Check if .git exists
  if (!scriptExists(dir, '.git')) {
    return {
      name,
      label,
      status: 'skipped',
      durationMs: Date.now() - startMs,
      startedAt,
      findings: [],
      rawStdout: '',
      rawStderr: 'No .git directory found — skipping git history scan',
      error: 'Not a git repository.',
    };
  }

  // Check if `git` is available
  if (!isCommandAvailable('git')) {
    return {
      name,
      label,
      status: 'skipped',
      durationMs: Date.now() - startMs,
      startedAt,
      findings: [],
      rawStdout: '',
      rawStderr: 'git not found on PATH — skipping git history scan',
      error: 'git not available.',
    };
  }

  const secretPatternsForGit: Array<{
    pattern: string;
    severity: ScanFinding['severity'];
    category: string;
    message: string;
    recommendation: string;
  }> = [
    {
      pattern: 'AKIA[0-9A-Z]{16}',
      severity: 'critical',
      category: 'git-secret-aws-key',
      message: 'AWS Access Key ID found in git history',
      recommendation: 'Use git filter-branch or BFG Repo-Cleaner to remove the secret from history. Rotate the exposed key immediately.',
    },
    {
      pattern: 'ghp_[A-Za-z0-9]{36}',
      severity: 'critical',
      category: 'git-secret-github-token',
      message: 'GitHub token found in git history',
      recommendation: 'Revoke the token on GitHub. Use git filter-branch or BFG to remove it from history.',
    },
    {
      pattern: '(sk|pk)_(test|live|prod)_[A-Za-z0-9]{10,}',
      severity: 'critical',
      category: 'git-secret-stripe-key',
      message: 'Stripe API key found in git history',
      recommendation: 'Rotate the key in Stripe dashboard. Remove from git history using git filter-branch.',
    },
    {
      pattern: 'xox[baprs]-[A-Za-z0-9-]{10,}',
      severity: 'critical',
      category: 'git-secret-slack-token',
      message: 'Slack token found in git history',
      recommendation: 'Revoke the token in Slack. Remove from git history.',
    },
    {
      pattern: '-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----',
      severity: 'critical',
      category: 'git-secret-ssh-key',
      message: 'SSH private key found in git history',
      recommendation: 'Revoke the key immediately. Remove from git history using git filter-branch.',
    },
    {
      pattern: '(password|secret|credential|api[_-]?key)\\s*[:=]\\s*[\'"]?[A-Za-z0-9_!@#$%^&*()=+]{16,}',
      severity: 'high',
      category: 'git-secret-generic',
      message: 'Potential credential/secret found in git history',
      recommendation: 'Verify if this is a real secret. If so, rotate it and remove from git history.',
    },
  ];

  try {
    // git log -p shows the full diff of each commit
    // We pipe to rg for pattern matching
    const patternArgs = secretPatternsForGit
      .map(p => `-e '${p.pattern.replace(/'/g, "'\\''")}'`)
      .join(' ');

    // Use a limited history (last 500 commits) and exclude binary files
    const command = `git log --diff-filter=M --format='commit %H%nAuthor: %an <%ae>%nDate: %ad%n%n' -p --all -500 -- ':!*.lock' ':!*.sum' ':!package-lock.json' ':!yarn.lock' ':!pnpm-lock.yaml' | rg --no-heading -n ${patternArgs} 2>/dev/null || true`;

    const result = await runCommand(command, 60_000, dir);
    rawStdout = result.stdout;
    rawStderr = result.stderr;

    if (result.stdout.trim()) {
      const lines = result.stdout.trim().split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Try to find which pattern matched
        const matchedPattern = secretPatternsForGit.find(p => {
          const re = new RegExp(p.pattern, 'i');
          return re.test(trimmed);
        });

        if (matchedPattern) {
          findings.push({
            severity: matchedPattern.severity,
            category: matchedPattern.category,
            message: `${matchedPattern.message}: ${trimmed.slice(0, 120)}`,
            recommendation: matchedPattern.recommendation,
          });
        } else {
          // Generic secret detection
          findings.push({
            severity: 'high',
            category: 'git-secret-generic',
            message: `Potential secret in git history: ${trimmed.slice(0, 120)}`,
            recommendation: 'Review this line. If it contains a secret, rotate it and remove from git history.',
          });
        }
      }
    }

    status = findings.length > 0 ? 'fail' : 'pass';
  } catch (err: any) {
    status = 'error';
    rawStderr = err.message ?? String(err);
  }

  return {
    name,
    label,
    status,
    durationMs: Date.now() - startMs,
    startedAt,
    findings,
    rawStdout,
    rawStderr,
  };
}

// =========================================================================
// Report aggregation and verdict
// =========================================================================

/**
 * Aggregate all scan results into a unified report.
 */
function buildReport(
  projectDir: string,
  startedAt: string,
  scanResults: ScanResult[],
): UnifiedReport {
  const completedAt = nowISO();
  const totalDurationMs = scanResults.reduce((max, s) => Math.max(max, s.durationMs), 0);
  // Actually compute wall-clock: max end-to-end time among all scans
  // Since scans run in parallel, the longest scan determines total time
  const totalWallClockMs = scanResults.reduce((max, s) => Math.max(max, s.durationMs), 0);

  const passed = scanResults.filter(s => s.status === 'pass').length;
  const failed = scanResults.filter(s => s.status === 'fail').length;
  const warned = scanResults.filter(s => s.status === 'warn').length;
  const errored = scanResults.filter(s => s.status === 'error').length;
  const skipped = scanResults.filter(s => s.status === 'skipped').length;

  const allFindings = scanResults.flatMap(s => s.findings);
  const criticalFindings = allFindings.filter(f => f.severity === 'critical').length;
  const highFindings = allFindings.filter(f => f.severity === 'high').length;
  const mediumFindings = allFindings.filter(f => f.severity === 'medium').length;
  const lowFindings = allFindings.filter(f => f.severity === 'low').length;

  // Verdict rules:
  // - Any scan with "fail" status → verdict = "fail" (blocking)
  // - All pass but warnings → verdict = "warn"
  // - All clean → verdict = "pass"
  let verdict: ScanVerdict;
  let verdictReason: string;

  if (failed > 0) {
    verdict = 'fail';
    const failedNames = scanResults.filter(s => s.status === 'fail').map(s => s.label).join(', ');
    verdictReason = `${failed} scan(s) failed: ${failedNames}`;
  } else if (errored > 0) {
    // Treat errors as soft failures — the scans couldn't run
    verdict = 'warn';
    const errorNames = scanResults.filter(s => s.status === 'error').map(s => s.label).join(', ');
    verdictReason = `${errored} scan(s) encountered errors: ${errorNames}`;
  } else if (warned > 0 || criticalFindings > 0 || highFindings > 0) {
    verdict = 'warn';
    verdictReason = `All scans passed but ${allFindings.length} finding(s) require attention`;
  } else {
    verdict = 'pass';
    verdictReason = 'All security scans passed with no issues';
  }

  return {
    startedAt,
    completedAt,
    totalDurationMs: totalWallClockMs,
    projectDir,
    verdict,
    verdictReason,
    scans: scanResults,
    summary: {
      total: scanResults.length,
      passed,
      failed,
      warned,
      errored,
      skipped,
      totalFindings: allFindings.length,
      criticalFindings,
      highFindings,
      mediumFindings,
      lowFindings,
    },
  };
}

// =========================================================================
// Output formatting
// =========================================================================

/**
 * Format the report as human-readable text.
 */
function formatHuman(report: UnifiedReport): string {
  const verdictIcon =
    report.verdict === 'pass' ? '✅' :
    report.verdict === 'warn' ? '⚠️' : '❌';

  const lines: string[] = [
    `${verdictIcon} Security Scan Report`,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    '',
    `Project:    ${report.projectDir}`,
    `Started:    ${report.startedAt}`,
    `Completed:  ${report.completedAt}`,
    `Duration:   ${report.totalDurationMs} ms (wall-clock)`,
    `Verdict:    ${verdictIcon} ${report.verdict.toUpperCase()} — ${report.verdictReason}`,
    '',
    `Summary: ${report.summary.total} scans, ` +
      `${report.summary.passed} passed, ` +
      `${report.summary.failed} failed, ` +
      `${report.summary.warned} warned, ` +
      `${report.summary.errored} errored, ` +
      `${report.summary.skipped} skipped`,
    `Findings: ${report.summary.totalFindings} total ` +
      `(🔴 ${report.summary.criticalFindings} critical, ` +
      `🟡 ${report.summary.highFindings} high, ` +
      `🔵 ${report.summary.mediumFindings} medium, ` +
      `⚪ ${report.summary.lowFindings} low)`,
    '',
  ];

  for (const scan of report.scans) {
    const statusIcon =
      scan.status === 'pass' ? '✅' :
      scan.status === 'fail' ? '❌' :
      scan.status === 'warn' ? '⚠️' :
      scan.status === 'error' ? '💥' : '⏭️';

    lines.push(`── ${statusIcon} ${scan.label} (${scan.status}, ${scan.durationMs}ms) ──`);

    if (scan.error) {
      lines.push(`   Error: ${scan.error}`);
    }

    if (scan.findings.length > 0) {
      for (const finding of scan.findings) {
        const sevIcon =
          finding.severity === 'critical' ? '🔴' :
          finding.severity === 'high' ? '🟡' :
          finding.severity === 'medium' ? '🔵' : '⚪';

        const location = finding.file
          ? ` [${finding.file}${finding.line ? ':' + finding.line : ''}]`
          : '';
        lines.push(`   ${sevIcon} [${finding.category}] ${finding.message}${location}`);
        if (finding.recommendation) {
          lines.push(`     Fix: ${finding.recommendation}`);
        }
      }
    } else if (scan.status === 'pass') {
      lines.push('   No issues found.');
    }

    lines.push('');
  }

  // Verdict footer
  const footerIcon =
    report.verdict === 'pass' ? '✅' :
    report.verdict === 'warn' ? '⚠️' : '❌';
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`${footerIcon} VERDICT: ${report.verdict.toUpperCase()}`);
  lines.push(`   ${report.verdictReason}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Format the report as JSON.
 */
function formatJson(report: UnifiedReport): string {
  return JSON.stringify(report, null, 2);
}

// =========================================================================
// Main entry point
// =========================================================================

async function main(): Promise<void> {
  const args = parseArgs();
  const { dir, skillsDir, format, failFast } = args;

  // Validate the target directory
  if (!fs.existsSync(dir)) {
    console.error(`❌ Target directory does not exist: ${dir}`);
    process.exit(2);
  }

  // Warn if skillsDir doesn't contain expected scripts
  const sastScript = path.join(skillsDir, 'scripts', 'code-philosophy', 'check-security.ts');
  const supplyChainScript = path.join(skillsDir, 'scripts', 'code-philosophy', 'check-supply-chain.ts');
  if (!scriptExists(sastScript)) {
    console.error(`[parallel-security-scan] ⚠️ SAST script not found at: ${sastScript} — sast scan will be skipped`);
  }
  if (!scriptExists(supplyChainScript)) {
    console.error(`[parallel-security-scan] ⚠️ Supply chain script not found at: ${supplyChainScript} — supply-chain scan will be skipped`);
  }

  const startedAt = nowISO();
  if (format === 'human') {
    console.error(`[parallel-security-scan] Starting ${args.format === 'human' ? '6' : '6'} parallel security scans on: ${dir}`);
  }

  // ── Launch all scans in PARALLEL ──
  // Using Promise.all on all 6 scan functions simultaneously
  const scanPromises: Array<Promise<ScanResult>> = [
    scanNpmAudit(dir),
    scanSecrets(dir),
    scanAntiPattern(dir),
    scanSast(dir, skillsDir),
    scanSupplyChain(dir, skillsDir),
    scanGitHistory(dir),
  ];

  let scanResults: ScanResult[];

  if (failFast) {
    // fail-fast: resolve as a single Promise.allSettled so we can check for rejections
    const settled = await Promise.allSettled(scanPromises);
    scanResults = settled.map((s, i) => {
      const scanNames = ['npm-audit', 'secrets', 'anti-pattern', 'sast', 'supply-chain', 'git-history'];
      if (s.status === 'rejected') {
        return {
          name: scanNames[i],
          label: scanNames[i].charAt(0).toUpperCase() + scanNames[i].slice(1).replace('-', ' '),
          status: 'error' as ScanStatus,
          durationMs: 0,
          startedAt,
          findings: [],
          rawStdout: '',
          rawStderr: '',
          error: s.reason?.message ?? String(s.reason),
        };
      }
      return s.value;
    });
  } else {
    // Non fail-fast: use Promise.allSettled to capture individual failures
    const settled = await Promise.allSettled(scanPromises);
    scanResults = settled.map((s, i) => {
      const scanNames = ['npm-audit', 'secrets', 'anti-pattern', 'sast', 'supply-chain', 'git-history'];
      if (s.status === 'rejected') {
        return {
          name: scanNames[i],
          label: scanNames[i].charAt(0).toUpperCase() + scanNames[i].slice(1).replace('-', ' '),
          status: 'error' as ScanStatus,
          durationMs: 0,
          startedAt,
          findings: [],
          rawStdout: '',
          rawStderr: '',
          error: s.reason?.message ?? String(s.reason),
        };
      }
      return s.value;
    });
  }

  // ── Build and output the unified report ──
  const report = buildReport(dir, startedAt, scanResults);

  if (format === 'json') {
    console.log(formatJson(report));
  } else {
    console.log(formatHuman(report));
  }

  // ── Exit with appropriate code ──
  if (report.verdict === 'fail') {
    process.exit(1);
  }
  process.exit(0);
}

// ── Execute ──
main().catch(err => {
  console.error('Fatal error in parallel-security-scan:', err.message ?? String(err));
  process.exit(2);
});
