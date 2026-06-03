#!/usr/bin/env node
/**
 * Plan Contract Validator
 *
 * Reads a plan-manifest.json file, validates its `contractRules` array
 * against the project filesystem. Runs before or after implementation
 * to ensure architectural constraints are enforced.
 *
 * Usage:
 *   ts-node skills/scripts/orchestration/check-plan-contract.ts --manifest=plan-manifests/<feature>/v1-manifest.json [--dir=./] [--mode=pre-implement|post-implement]
 *
 * Modes:
 *   pre-implement  - Pre-implementation checks (file doesn't exist, import targets exist)
 *   post-implement - Post-implementation checks (stat, grep, compare expectedResult)
 *
 * Exit codes:
 *   0 = all blocking rules pass
 *   1 = any blocking rule fails
 *   2 = config/parsing error
 *
 * Output: JSON to stdout
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ContractRuleType =
  | 'import_restriction'
  | 'import_required'
  | 'library_restriction'
  | 'method_must_exist'
  | 'pattern_must_exist'
  | 'pattern_forbidden'
  | 'naming_convention';

type ContractSeverity = 'blocking' | 'warning';

type ExpectedResult = 'no_matches' | 'matches_found';

type RunMode = 'pre-implement' | 'post-implement';

interface ContractRule {
  id: string;
  type: ContractRuleType;
  severity: ContractSeverity;
  description: string;
  rule: string;
  expectedResult: ExpectedResult;
}

interface PlanManifest {
  manifestVersion: number;
  planSummary?: string;
  contractRules?: ContractRule[];
  checkpoints?: Array<{
    id: string;
    type: string;
    description: string;
    target?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

interface RuleResult {
  id: string;
  type: ContractRuleType;
  severity: ContractSeverity;
  passed: boolean;
  message: string;
}

interface CheckpointIssue {
  checkpointId: string;
  description: string;
  target: string;
  issue: string;
}

interface PlanContractOutput {
  valid: boolean;
  mode: RunMode;
  rules: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
  };
  checkpointIssues: CheckpointIssue[];
  results: RuleResult[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// CLI Argument Parsing
// ---------------------------------------------------------------------------

interface CLIOptions {
  manifest: string;
  dir: string;
  mode: RunMode;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    manifest: '',
    dir: process.cwd(),
    mode: 'pre-implement',
  };

  for (const arg of args) {
    if (arg.startsWith('--manifest=')) {
      options.manifest = arg.slice('--manifest='.length);
    } else if (arg.startsWith('--dir=')) {
      options.dir = arg.slice('--dir='.length);
    } else if (arg.startsWith('--mode=')) {
      const mode = arg.slice('--mode='.length);
      if (mode !== 'pre-implement' && mode !== 'post-implement') {
        console.error(`Invalid mode: "${mode}". Must be "pre-implement" or "post-implement".`);
        process.exit(2);
      }
      options.mode = mode;
    } else {
      console.error(`Unknown argument: "${arg}"`);
      console.error('Usage: ts-node check-plan-contract.ts --manifest=<path> [--dir=.] [--mode=pre-implement|post-implement]');
      process.exit(2);
    }
  }

  if (!options.manifest) {
    console.error('Missing required argument: --manifest=<path>');
    process.exit(2);
  }

  return options;
}

// ---------------------------------------------------------------------------
// Shell Execution
// ---------------------------------------------------------------------------

/**
 * Run a shell command safely with a 30-second timeout.
 * On win32, use PowerShell 5.1 as the shell.
 * On non-win32, use /bin/sh.
 * Handles both simple commands and grep pipelines.
 */
function runShellCommand(
  command: string,
  cwd: string,
): { stdout: string; stderr: string; exitCode: number } {
  const isWindows = process.platform === 'win32';

  // Determine the shell and command wrapper
  let shell: string;
  let wrappedCommand: string;

  if (isWindows) {
    shell = 'powershell.exe';
    // PowerShell commands: use & { ... } to capture output
    // Convert grep/rg to Select-String equivalents if needed
    wrappedCommand = convertToPowerShell(command);
  } else {
    shell = '/bin/sh';
    wrappedCommand = command;
  }

  try {
    const result = execSync(wrappedCommand, {
      cwd,
      shell,
      timeout: 30_000, // 30 seconds per rule
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024, // 10MB max output
    } as import('child_process').ExecSyncOptions);

    return {
      stdout: (result || '').toString(),
      stderr: '',
      exitCode: 0,
    };
  } catch (err: unknown) {
    const error = err as {
      status?: number;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };
    return {
      stdout: error.stdout ? error.stdout.toString() : '',
      stderr: error.stderr ? error.stderr.toString() : '',
      exitCode: error.status ?? 1,
    };
  }
}

/**
 * Convert Unix grep/rg commands to PowerShell-compatible equivalents.
 * Handles common patterns:
 *   grep -rn 'pattern' path        -> Select-String -Pattern 'pattern' -Path path -Recurse
 *   grep -rn 'pattern' path/*.ts   -> Select-String -Pattern 'pattern' -Path path -Filter *.ts -Recurse
 *   rg 'pattern' path              -> Select-String -Pattern 'pattern' -Path path -Recurse
 *   grep -n 'pattern' file.ts      -> Select-String -Pattern 'pattern' -Path file.ts
 */
function convertToPowerShell(command: string): string {
  // Check if the command already uses PowerShell syntax
  if (command.includes('Select-String') || command.startsWith('& ') || command.includes('|')) {
    // Already a PowerShell command, just wrap it
    return `& { ${command} } 2>$null`;
  }

  // Handle rg (ripgrep) commands
  let cmd = command.replace(/^rg\s+/, '');
  let useRg = command.trimStart().startsWith('rg ');

  // Handle grep commands
  const grepMatch = command.match(/^grep\s+(?:-(?:\w*[rn]+)+)\s+/);
  if (grepMatch) {
    cmd = command.slice(grepMatch[0].length);
    useRg = false;
  }

  if (useRg) {
    // Use rg directly if available (it works on Windows too)
    return `& { ${command} } 2>$null`;
  }

  // Parse the grep-style command into Select-String params
  // Expected form: 'pattern' <path> [--include='*.ts']
  const parts = cmd.match(/'([^']*)'\s+(\S+(?:\s+\S+)*)/);
  if (!parts) {
    // Fallback: run the command as-is
    return `& { ${command} } 2>$null`;
  }

  const pattern = parts[1];
  const rest = parts[2].trim();

  // Extract --include pattern if present
  const includeMatch = rest.match(/--include='([^']+)'/);
  const includeFilter = includeMatch ? includeMatch[1] : undefined;
  let filePath = rest.replace(/--include='[^']+'/, '').trim();

  // Build Select-String command
  // Use | Select-Object -ExpandProperty Line to get clean per-match output (no line wrapping artifacts)
  let psCommand = `Select-String -Pattern '${pattern.replace(/'/g, "''")}'`;

  // Determine if path is a single file or directory
  const fullPath = path.resolve(filePath);
  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
    psCommand += ' -Recurse';
    if (includeFilter) {
      psCommand += ` -Include '${includeFilter}'`;
    }
    psCommand += ` -Path '${filePath}'`;
  } else {
    // It's a file or glob — use -LiteralPath for UNC path safety
    psCommand += ` -LiteralPath '${filePath}'`;
  }

  // Pipe through Select-Object to get clean line-by-line output
  psCommand += ' | Select-Object -ExpandProperty Line';

  // Wrap in script block to suppress errors and get exit code compatible output
  return `& { ${psCommand} 2>$null }`;
}

// ---------------------------------------------------------------------------
// Pre-Implementation Checks
// ---------------------------------------------------------------------------

function runPreImplementChecks(
  manifest: PlanManifest,
  workingDir: string,
): RuleResult[] {
  const results: RuleResult[] = [];

  if (!manifest.contractRules || manifest.contractRules.length === 0) {
    return results;
  }

  for (const rule of manifest.contractRules) {
    const result = runShellCommand(rule.rule, workingDir);

    switch (rule.type) {
      case 'import_restriction':
      case 'library_restriction': {
        // These should have NO matches. If matches exist, it's a warning
        // (pre-existing violations in the codebase — can't stop pipeline).
        if (result.exitCode === 0 && result.stdout.trim().length > 0) {
          results.push({
            id: rule.id,
            type: rule.type,
            severity: rule.severity,
            passed: true, // still "passed" in pre-implement mode (can't fix pre-existing)
            message: `Pre-existing matches found — this is a warning. ${countMatchLines(result.stdout)} match(es) found.`,
          });
        } else {
          results.push({
            id: rule.id,
            type: rule.type,
            severity: rule.severity,
            passed: true,
            message: 'No matches found — rule satisfied (pre-implement mode)',
          });
        }
        break;
      }

      case 'import_required': {
        // These SHOULD have matches. If no matches, the target import doesn't exist yet.
        // This is expected in pre-implement mode for files that don't exist yet.
        // But we check if the file(s) in the rule path exist.
        const filePaths = extractFilePaths(rule.rule, workingDir);
        const nonExistentFiles = filePaths.filter(fp => !fs.existsSync(fp));

        if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
          if (nonExistentFiles.length > 0) {
            results.push({
              id: rule.id,
              type: rule.type,
              severity: rule.severity,
              passed: true,
              message: `Expected matches in ${filePaths.join(', ')} but file(s) don't exist yet (pre-implement mode)`,
            });
          } else {
            results.push({
              id: rule.id,
              type: rule.type,
              severity: rule.severity,
              passed: true,
              message: 'Expected matches but none found — will be verified in post-implement mode',
            });
          }
        } else {
          results.push({
            id: rule.id,
            type: rule.type,
            severity: rule.severity,
            passed: true,
            message: 'Required imports already exist — OK',
          });
        }
        break;
      }

      case 'pattern_forbidden':
      case 'naming_convention': {
        // These should have NO matches (forbidden patterns / naming violations)
        if (result.exitCode === 0 && result.stdout.trim().length > 0) {
          results.push({
            id: rule.id,
            type: rule.type,
            severity: rule.severity,
            passed: true, // pre-existing violations — can't stop pipeline
            message: `Pre-existing matches found — warning. ${countMatchLines(result.stdout)} match(es) found.`,
          });
        } else {
          results.push({
            id: rule.id,
            type: rule.type,
            severity: rule.severity,
            passed: true,
            message: 'No matches found — rule satisfied (pre-implement mode)',
          });
        }
        break;
      }

      case 'pattern_must_exist':
      case 'method_must_exist': {
        // These SHOULD have matches. In pre-implement mode, files may not exist yet.
        const filePaths = extractFilePaths(rule.rule, workingDir);
        const nonExistentFiles = filePaths.filter(fp => !fs.existsSync(fp));

        if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
          if (nonExistentFiles.length > 0) {
            results.push({
              id: rule.id,
              type: rule.type,
              severity: rule.severity,
              passed: true,
              message: `Expected matches in ${filePaths.join(', ')} but file(s) do not exist yet (pre-implement mode)`,
            });
          } else {
            results.push({
              id: rule.id,
              type: rule.type,
              severity: rule.severity,
              passed: true,
              message: 'Expected pattern not found — will be verified in post-implement mode',
            });
          }
        } else {
          const matchCount = countMatchLines(result.stdout);
          results.push({
            id: rule.id,
            type: rule.type,
            severity: rule.severity,
            passed: true,
            message: `Found ${matchCount} match(es) — OK (pre-implement mode)`,
          });
        }
        break;
      }

      default: {
        // Unknown rule type — can't validate, pass with warning
        results.push({
          id: rule.id,
          type: rule.type,
          severity: rule.severity,
          passed: true,
          message: `Unknown rule type "${rule.type}" — cannot validate, treating as passed`,
        });
        break;
      }
    }
  }

  return results;
}

/**
 * Extract file paths from a grep command's file arguments.
 * Understands patterns like:
 *   grep -n 'pattern' src/controllers/*.ts
 *   grep -rn 'UserRepository' src/services/user.ts
 */
function extractFilePaths(command: string, workingDir: string): string[] {
  const paths: string[] = [];

  // Remove the grep/rg command and flags, extract file path arguments
  // Pattern: the last space-separated tokens that look like paths
  const cleaned = command
    .replace(/^grep\s+(?:-\w*\s+)*/, '')
    .replace(/^rg\s+(?:-\w*\s+)*/, '')
    .replace(/'[^']*'\s*/, '') // remove the quoted pattern
    .replace(/--include='[^']*'\s*/, '') // remove --include
    .trim();

  if (!cleaned) return [];

  // Split on spaces and resolve each path
  const tokens = cleaned.split(/\s+/);

  for (const token of tokens) {
    if (!token) continue;

    // Resolve relative to working dir, expand globs using simple directory listing
    const resolved = path.resolve(workingDir, token);

    // Check if it's a literal file path
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      paths.push(resolved);
    } else {
      // It might be a glob pattern — try the parent directory
      const dir = path.dirname(resolved);
      const base = path.basename(resolved);

      if (fs.existsSync(dir)) {
        try {
          const entries = fs.readdirSync(dir);
          const regex = new RegExp(
            '^' + base.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
          );
          for (const entry of entries) {
            if (regex.test(entry)) {
              paths.push(path.join(dir, entry));
            }
          }
        } catch {
          // If we can't list the directory, just record the unresolved path
          paths.push(resolved);
        }
      } else {
        // Directory doesn't exist yet — record it as a reference
        paths.push(resolved);
      }
    }
  }

  return paths;
}

// ---------------------------------------------------------------------------
// Checkpoint Pre-Implementation Issues
// ---------------------------------------------------------------------------

function checkCheckpointFileConflicts(
  manifest: PlanManifest,
  workingDir: string,
): CheckpointIssue[] {
  const issues: CheckpointIssue[] = [];

  if (!manifest.checkpoints || manifest.checkpoints.length === 0) {
    return issues;
  }

  for (const cp of manifest.checkpoints) {
    if (!cp.target) continue;

    const targetPath = path.resolve(workingDir, cp.target);
    if (fs.existsSync(targetPath)) {
      issues.push({
        checkpointId: cp.id,
        description: cp.description,
        target: cp.target,
        issue: `Target file "${cp.target}" already exists — implementation will overwrite this file`,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Count the number of match lines in command output.
 * Normalizes \r\n line endings to \n to handle PowerShell output correctly.
 * Filters out empty lines to provide an accurate match count.
 */
function countMatchLines(stdout: string): number {
  const normalized = stdout.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalized
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .length;
}

// ---------------------------------------------------------------------------
// Post-Implementation Checks
// ---------------------------------------------------------------------------

function runPostImplementChecks(
  manifest: PlanManifest,
  workingDir: string,
): RuleResult[] {
  const results: RuleResult[] = [];

  if (!manifest.contractRules || manifest.contractRules.length === 0) {
    return results;
  }

  for (const rule of manifest.contractRules) {
    const result = runShellCommand(rule.rule, workingDir);

    switch (rule.expectedResult) {
      case 'no_matches': {
        // Rule passes if command exits 0 (no matches found)
        // grep exits 0 when matches are found (unix), exits 1 when no matches
        // Select-String exits 0 when matches found, exits 1 when no matches
        // So: "no matches" = non-zero exit OR empty stdout
        const hasMatches = result.exitCode === 0 && result.stdout.trim().length > 0;

        if (!hasMatches) {
          results.push({
            id: rule.id,
            type: rule.type,
            severity: rule.severity,
            passed: true,
            message: 'No matches found — OK',
          });
        } else {
          const matchCount = countMatchLines(result.stdout);
          results.push({
            id: rule.id,
            type: rule.type,
            severity: rule.severity,
            passed: rule.severity !== 'blocking',
            message: `Found ${matchCount} match(es) where none were expected`,
          });
        }
        break;
      }

      case 'matches_found': {
        // Rule passes if command exits 0 AND produces output
        const hasMatches = result.exitCode === 0 && result.stdout.trim().length > 0;

        if (hasMatches) {
          const matchCount = countMatchLines(result.stdout);
          results.push({
            id: rule.id,
            type: rule.type,
            severity: rule.severity,
            passed: true,
            message: `Found ${matchCount} match(es) — OK`,
          });
        } else {
          results.push({
            id: rule.id,
            type: rule.type,
            severity: rule.severity,
            passed: rule.severity !== 'blocking',
            message: 'Expected matches but found none',
          });
        }
        break;
      }

      default: {
        results.push({
          id: rule.id,
          type: rule.type,
          severity: rule.severity,
          passed: true,
          message: `Unknown expectedResult "${rule.expectedResult}" — cannot validate, treating as passed`,
        });
        break;
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const options = parseArgs();

  // Validate --dir exists
  const workingDir = path.resolve(options.dir);
  if (!fs.existsSync(workingDir)) {
    const output: PlanContractOutput = {
      valid: false,
      mode: options.mode,
      rules: { total: 0, passed: 0, failed: 0, warnings: 0 },
      checkpointIssues: [],
      results: [],
      errors: [`Working directory does not exist: ${workingDir}`],
    };
    console.log(JSON.stringify(output, null, 2));
    process.exit(2);
  }

  // Validate --manifest exists
  const manifestPath = path.resolve(options.manifest);
  if (!fs.existsSync(manifestPath)) {
    const output: PlanContractOutput = {
      valid: false,
      mode: options.mode,
      rules: { total: 0, passed: 0, failed: 0, warnings: 0 },
      checkpointIssues: [],
      results: [],
      errors: [`Manifest file not found: ${manifestPath}`],
    };
    console.log(JSON.stringify(output, null, 2));
    process.exit(2);
  }

  // Parse manifest
  let manifest: PlanManifest;
  try {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    manifest = JSON.parse(content);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const output: PlanContractOutput = {
      valid: false,
      mode: options.mode,
      rules: { total: 0, passed: 0, failed: 0, warnings: 0 },
      checkpointIssues: [],
      results: [],
      errors: [`Failed to parse manifest: ${errorMessage}`],
    };
    console.log(JSON.stringify(output, null, 2));
    process.exit(2);
  }

  // Edge case: no contractRules field — treat as pass with info
  const results: RuleResult[] = [];
  const checkpointIssues: CheckpointIssue[] = [];
  const allErrors: string[] = [];

  if (!manifest.contractRules || manifest.contractRules.length === 0) {
    // No contract rules to check — this is a pass
    const output: PlanContractOutput = {
      valid: true,
      mode: options.mode,
      rules: { total: 0, passed: 0, failed: 0, warnings: 0 },
      checkpointIssues: [],
      results: [],
      errors: [],
    };
    console.log(JSON.stringify(output, null, 2));
    process.exit(0);
  }

  // Run rules based on mode
  if (options.mode === 'pre-implement') {
    // Pre-implementation checks
    const ruleResults = runPreImplementChecks(manifest, workingDir);
    results.push(...ruleResults);

    // Check for file conflicts in checkpoints
    const cpIssues = checkCheckpointFileConflicts(manifest, workingDir);
    checkpointIssues.push(...cpIssues);
  } else {
    // Post-implementation checks
    const ruleResults = runPostImplementChecks(manifest, workingDir);
    results.push(...ruleResults);
  }

  // Compute summary
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const warnings = results.filter(r => r.severity === 'warning' && !r.passed).length;

  // Determine overall validity: all blocking rules must pass
  const blockingFailed = results.filter(r => r.severity === 'blocking' && !r.passed);
  const valid = blockingFailed.length === 0;

  // Build output
  const output: PlanContractOutput = {
    valid,
    mode: options.mode,
    rules: {
      total,
      passed,
      failed,
      warnings,
    },
    checkpointIssues,
    results,
    errors: allErrors,
  };

  console.log(JSON.stringify(output, null, 2));

  // Exit code
  if (blockingFailed.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// CLI Entry
// ---------------------------------------------------------------------------

if (require.main === module) {
  main();
}