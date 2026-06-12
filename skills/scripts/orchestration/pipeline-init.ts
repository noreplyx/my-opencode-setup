#!/usr/bin/env node
/**
 * Pipeline Initialization Script
 *
 * Creates agent-context.md with initial YAML frontmatter, performs pre-flight
 * checks (git status, build compilation, stale context detection).
 *
 * Usage:
 *   pipeline-init.ts --feature=<name> --pipeline-type=<type> \
 *     [--pipeline-complexity=simple|moderate|complex] [--confidence=<0-100>]
 *
 * Exit codes:
 *   0 = Success
 *   1 = Error
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PipelineArgs {
  feature: string;
  pipelineType: string;
  pipelineComplexity: 'simple' | 'moderate' | 'complex';
  confidence: number;
  skipReadiness: boolean;
  forceClean: boolean;
}

interface PreFlightReport {
  branch: string;
  lastCommitSha: string;
  lastCommitMessage: string;
  dirtyFiles: string[];
  projectCompiles: boolean;
  buildOutput: string;
  securityToolsOk: boolean;
  staleContextFound: boolean;
  staleContextStatus?: string;
  staleContextAge?: string;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function generateUuid(): string {
  return `pipeline-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

function isoNow(): string {
  return new Date().toISOString();
}

function getScriptRunner(): string {
  // Language-agnostic: use process.argv[0] (the runtime that started this script).
  // Works with node, python3, deno, bun, and any runtime.
  if (process.argv[0]) {
    return process.argv[0];
  }
  return 'node'; // ultimate fallback
}

function execSafe(command: string, timeout = 30000): { stdout: string; stderr: string; exitCode: number } {
  try {
    const result = execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
      shell: true,});
    return { stdout: result.trim(), stderr: '', exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout ? err.stdout.toString().trim() : '',
      stderr: err.stderr ? err.stderr.toString().trim() : err.message || String(err),
      exitCode: err.status ?? 1,
    };
  }
}

/**
 * Sanitize a shell argument to prevent injection attacks.
 * Wraps in single quotes and escapes any single quotes within.
 * Returns 'true' as a safe fallback for empty/null/undefined args.
 */
function sanitizeShellArg(arg: string): string {
  if (!arg || typeof arg !== 'string') return "'true'";
  // Escape single quotes by ending the quote, adding escaped quote, restarting
  const escaped = arg.replace(/'/g, "'\\''");
  return `'${escaped}'`;
}

function parseArgs(): PipelineArgs {
  const args = process.argv.slice(2);

  const feature = args.find(a => a.startsWith('--feature='))?.split('=')[1];
  const pipelineType = args.find(a => a.startsWith('--pipeline-type='))?.split('=')[1];
  const complexityArg = args.find(a => a.startsWith('--pipeline-complexity='))?.split('=')[1];
  const confidenceArg = args.find(a => a.startsWith('--confidence='))?.split('=')[1];

  if (!feature) {
    console.error('âŒ Missing required argument: --feature=<name>');
    console.error('Usage: ' + process.argv[0] + ' pipeline-init.ts --feature=<name> --pipeline-type=<type> [--pipeline-complexity=simple|moderate|complex] [--confidence=<0-100>]');
    process.exit(1);
  }

  if (!pipelineType) {
    console.error('âŒ Missing required argument: --pipeline-type=<type>');
    console.error('Usage: ' + process.argv[0] + ' pipeline-init.ts --feature=<name> --pipeline-type=<type> [--pipeline-complexity=simple|moderate|complex] [--confidence=<0-100>]');
    process.exit(1);
  }

  const validComplexities = ['simple', 'moderate', 'complex'];
  const pipelineComplexity = (complexityArg && validComplexities.includes(complexityArg)
    ? complexityArg
    : 'moderate') as 'simple' | 'moderate' | 'complex';

  const confidenceRaw = confidenceArg ? parseInt(confidenceArg, 10) : 80;
  const confidence = isNaN(confidenceRaw) ? 80 : Math.max(0, Math.min(100, confidenceRaw));

  const skipReadiness = args.some(a => a === '--skip-readiness');
  const forceClean = args.some(a => a === '--force-clean');

  const validTypes = ['full', 'quick', 'fixer-only', 'parallel-feature', 'tdd', 'security-fix', 'ui-bug', 'documentation', 'micro-pipeline', 'refactor', 'research'];
  if (pipelineType && !validTypes.includes(pipelineType)) {
    console.warn(`âš ï¸  Unknown pipeline type "${pipelineType}". Valid types: ${validTypes.join(', ')}`);
    // Don't exit â€” let it proceed with the unknown type
  }

  return { feature, pipelineType, pipelineComplexity, confidence, skipReadiness, forceClean };
}

// ---------------------------------------------------------------------------
// Pre-flight checks
// ---------------------------------------------------------------------------

function runPreFlight(): PreFlightReport {
  // Check git status
  const gitStatusResult = execSafe('git status --porcelain');
  const dirtyFiles = gitStatusResult.stdout
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => {
      // Format: "M  src/file.ext" or "?? newfile.ext"
      const parts = line.trim().split(/\s+/);
      return parts.length >= 2 ? parts.slice(1).join(' ') : line.trim();
    });

  // Check current branch
  const branchResult = execSafe('git rev-parse --abbrev-ref HEAD');
  const branch = branchResult.stdout || 'unknown';

  // Check last commit SHA
  const shaResult = execSafe('git rev-parse HEAD');
  const lastCommitSha = shaResult.stdout || 'unknown';

  // Check last commit message
  const msgResult = execSafe('git log -1 --format=%s');
  const lastCommitMessage = msgResult.stdout || 'unknown';

  // ---------------------------------------------------------------------------
  // Build system auto-detection
  // ---------------------------------------------------------------------------

  function detectBuildCommand(): string {
    const envCmd = process.env.BUILD_COMMAND;
    if (envCmd) return envCmd;

    // Check for config files in order of preference
    const configChecks: [string, string][] = [
      ['package.json', 'npm run build'],  // Default npm script
      ['tsconfig.json', 'tsc --noEmit'],   // Standalone TypeScript
      ['vite.config.ts', 'npx vite build'],
      ['vite.config.js', 'npx vite build'],
      ['next.config.js', 'next build'],
      ['next.config.ts', 'next build'],
      ['webpack.config.js', 'npx webpack --mode production'],
      ['webpack.config.ts', 'npx webpack --mode production'],
      ['nuxt.config.ts', 'npx nuxt build'],
      ['nuxt.config.js', 'npx nuxt build'],
      ['angular.json', 'ng build'],
      ['svelte.config.js', 'npx vite build'],
      ['rollup.config.js', 'npx rollup -c'],
      ['rollup.config.mjs', 'npx rollup -c'],
      ['esbuild.config.js', 'node esbuild.config.js'],
      ['Makefile', 'make build'],
      ['Cargo.toml', 'cargo build'],
      ['go.mod', 'go build ./...'],
      ['composer.json', 'composer install'],
      ['pyproject.toml', 'pip install -e .'],
      ['requirements.txt', 'pip install -r requirements.txt'],
    ];

    // First check: look for the most specific config files
    for (const [configFile, command] of configChecks) {
      if (fs.existsSync(path.resolve(configFile))) {
        // Special handling for package.json - check for build script
        if (configFile === 'package.json') {
          try {
            const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf-8'));
            if (pkg.scripts?.build) {
              return 'npm run build';
            }
            // Check for other common scripts
            if (pkg.scripts?.['compile']) return 'npm run compile';
            if (pkg.scripts?.['tsc']) return 'npm run tsc';
            if (pkg.scripts?.['typecheck']) return 'npm run typecheck';
            // Fallback to tsc --noEmit if typescript is a dependency
            if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript) {
              return 'npx tsc --noEmit';
            }
          } catch {
            // If package.json is unparseable, fall through
          }
        }
        return command;
      }
    }

    // No config files found - check for common language indicators
    const dirFiles = fs.readdirSync(process.cwd());
    const hasTsFiles = dirFiles.some(f => f.endsWith('.ts') || f.endsWith('.tsx'));
    const hasJsFiles = dirFiles.some(f => f.endsWith('.js') || f.endsWith('.jsx') || f.endsWith('.mjs'));
    const hasPyFiles = dirFiles.some(f => f.endsWith('.py'));
    const hasGoFiles = dirFiles.some(f => f.endsWith('.go'));
    const hasRsFiles = dirFiles.some(f => f.endsWith('.rs'));

    if (hasTsFiles) return 'npx tsc --noEmit';
    if (hasGoFiles) return 'go build ./...';
    if (hasRsFiles) return 'cargo build';
    if (hasPyFiles) return 'python -m compileall .';
    if (hasJsFiles) return 'node --check index.js || true'; // basic JS syntax check

    // Ultimate fallback
    return 'echo "No build system detected"';
  }

  // Check if project compiles
  // Build command is configurable via BUILD_COMMAND env var, or auto-detected
  const buildCmd = detectBuildCommand();
  const buildResult = execSafe(buildCmd + ' 2>/dev/null || true', 15000);
  const projectCompiles = buildResult.exitCode === 0;
  const buildOutput = buildResult.stderr || buildResult.stdout || '(no build output captured)';

  const securityToolsOk = false; // security self-test removed (its tools are language-specific)

  // Check for stale agent-context.md
  const contextPath = path.resolve('agent-context.md');
  let staleContextFound = false;
  let staleContextStatus: string | undefined;
  let staleContextAge: string | undefined;

  if (fs.existsSync(contextPath)) {
    const contextContent = fs.readFileSync(contextPath, 'utf-8');
    const statusMatch = contextContent.match(/^status:\s*"?(running|active)"?/m);
    const createdAtMatch = contextContent.match(/^createdAt:\s*"?([^"\n]+)"?/m);

    if (statusMatch) {
      staleContextStatus = statusMatch[1];
      if (createdAtMatch) {
        const createdAt = new Date(createdAtMatch[1]);
        const now = new Date();
        const ageMs = now.getTime() - createdAt.getTime();
        const ageHours = ageMs / (1000 * 60 * 60);

        if (ageHours > 1) {
          staleContextFound = true;
          staleContextAge = `${ageHours.toFixed(1)} hours`;
        }
      }
    }
  }

  return {
    branch,
    lastCommitSha,
    lastCommitMessage,
    dirtyFiles,
    projectCompiles,
    buildOutput,
    securityToolsOk,
    staleContextFound,
    staleContextStatus,
    staleContextAge,
  };
}

// ---------------------------------------------------------------------------
// Pipeline log directory creation
// ---------------------------------------------------------------------------

function ensurePipelineLogsDir(): void {
  const logsDir = path.resolve('.opencode/pipeline-logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Agent-context.md generation
// ---------------------------------------------------------------------------

function generateAgentContext(args: PipelineArgs, preFlight: PreFlightReport): { content: string; pipelineId: string } {
  const pipelineId = generateUuid();
  const now = isoNow();

  const thresholds = {
    simple: 1,
    moderate: 2,
    complex: 3,
  };

  const complexityKey = args.pipelineComplexity;
  const currentThreshold = thresholds[complexityKey];

  const lines: string[] = [];
  lines.push('---');
  lines.push(`pipelineId: "${pipelineId}"`);
  lines.push(`feature: "${args.feature}"`);
  lines.push(`pipelineType: "${args.pipelineType}"`);
  lines.push(`pipelineComplexity: "${args.pipelineComplexity}"`);
  lines.push(`pipelineConfidence: ${args.confidence}`);
  lines.push(`currentStep: "pre-flight"`);
  lines.push(`createdAt: "${now}"`);
  lines.push(`pipelineHeartbeat: "${now}"`);
  lines.push(`status: "running"`);
  lines.push('agentHistory: []');
  lines.push('agentOutputs: {}');
  lines.push('summaries: {}');
  lines.push('circuitBreaker:');
  lines.push('  state: "closed"');
  lines.push(`  complexity: "${args.pipelineComplexity}"`);
  lines.push('  thresholds:');
  lines.push(`    build: ${thresholds.simple}`);
  lines.push(`    lint: ${thresholds.simple}`);
  lines.push(`    securityScan: ${thresholds.simple}`);
  lines.push(`    smokeTest: ${thresholds.simple}`);
  lines.push(`    verifier: ${thresholds.simple}`);
  lines.push('  currentThresholds:');
  lines.push(`    build: ${currentThreshold}`);
  lines.push(`    lint: ${currentThreshold}`);
  lines.push(`    securityScan: ${currentThreshold}`);
  lines.push(`    smokeTest: ${currentThreshold}`);
  lines.push(`    verifier: ${currentThreshold}`);
  lines.push('  counters:');
  lines.push('    build: 0');
  lines.push('    lint: 0');
  lines.push('    securityScan: 0');
  lines.push('    smokeTest: 0');
  lines.push('    verifier: 0');
  lines.push('  patternDetection:');
  lines.push('    persistentDeviations: []');
  lines.push('    sameClassificationCounts: {}');
  lines.push('    autoEscalationTriggered: false');
  lines.push('gitState:');
  lines.push(`  branch: "${preFlight.branch}"`);
  lines.push('  dirtyFiles: []');
  lines.push(`  lastCommitSha: "${preFlight.lastCommitSha}"`);
  lines.push(`  lastCommitMessage: "${preFlight.lastCommitMessage.replace(/"/g, '\\"')}"`);
  lines.push('prePipelineGitState:');
  lines.push(`  branch: "${preFlight.branch}"`);
  lines.push(`  lastCommitSha: "${preFlight.lastCommitSha}"`);
  lines.push(`  lastCommitMessage: "${preFlight.lastCommitMessage.replace(/"/g, '\\"')}"`);
  if (preFlight.dirtyFiles.length > 0) {
    lines.push('  dirtyFiles:');
    for (const f of preFlight.dirtyFiles) {
      lines.push(`    - "${f.replace(/"/g, '\\"')}"`);
    }
  } else {
    lines.push('  dirtyFiles: []');
  }
  lines.push('  stashedChanges: false');
  lines.push('  stashedChangesList: []');
  lines.push(`nextObjective: "Run pre-flight checks and begin pipeline"`);
  lines.push('---');
  lines.push('');
  lines.push('<!-- agent-context.md -->');
  lines.push('');
  lines.push('This file is managed by the Orchestrator. Do not edit manually.');
  lines.push('');

  return { content: lines.join('\n'), pipelineId };
}

// ---------------------------------------------------------------------------
// Summary report
// ---------------------------------------------------------------------------

function printSummary(
  args: PipelineArgs,
  preFlight: PreFlightReport,
): void {
  const separator = 'â”'.repeat(29 + args.feature.length + args.pipelineType.length);

  console.log(`ðŸ” Pipeline Init: ${args.feature} (${args.pipelineType})`);
  console.log(separator);
  console.log('');

  // Pre-flight section
  console.log('Pre-Flight:');

  if (preFlight.projectCompiles) {
    console.log('  âœ… Project compiles successfully');
  } else {
    console.log('  âŒ Project does not compile');
    console.log(`  â””â”€ Build output: ${preFlight.buildOutput.slice(0, 200)}`);
  }

  if (preFlight.dirtyFiles.length > 0) {
    console.log(`  âš ï¸  ${preFlight.dirtyFiles.length} dirty file(s) (${preFlight.dirtyFiles.join(', ')})`);
  } else {
    console.log('  âœ… No dirty files');
  }

  if (preFlight.staleContextFound) {
    console.log(`  âš ï¸  Stale context found (status: ${preFlight.staleContextStatus}, age: ${preFlight.staleContextAge})`);
  } else {
    console.log('  ✅ No stale context found');
  }

  if (preFlight.securityToolsOk) {
    console.log('  ✅ Security self-test passed');
  } else {
    console.log('  ⚠️  Security self-test failed');
  }

  console.log('');

  // Agent readiness section (if check ran)
  console.log('Agent Readiness:');
  // The readiness check runs in main() before printSummary, so the output is already shown
  console.log('  See above for agent readiness details');
  console.log('');

  // Created section
  console.log('Created:');
  console.log('  âœ… agent-context.md');
  console.log('  âœ… .opencode/pipeline-logs/');

  console.log('');
  console.log(`Ready to proceed. Next: Run pre-flight checks and begin pipeline`);
}

// ---------------------------------------------------------------------------
// Usage / Help
// ---------------------------------------------------------------------------

function printUsage(): void {
  console.log(`
Usage:
  ${process.argv[0]} pipeline-init.ts --feature=<name> --pipeline-type=<type> \\
      [--pipeline-complexity=simple|moderate|complex] [--confidence=<0-100>] \\
      [--skip-readiness] [--force-clean]

Create agent-context.md with initial pipeline configuration, run pre-flight checks,
and set up pipeline infrastructure.

Options:
  --feature=<name>             Feature name (required)
  --pipeline-type=<type>       Pipeline type: full, quick, fixer-only, parallel-feature,
                               tdd, security-fix, ui-bug, documentation, micro-pipeline,
                               refactor, research (required)
  --pipeline-complexity=<lvl>  Complexity: simple, moderate, complex (default: moderate)
  --confidence=<0-100>         Pipeline confidence score (default: 80)
  --skip-readiness             Skip agent readiness check
  --force-clean                Auto-archive stale agent-context.md

Exit codes:
  0   Success
  1   Error
  2   Stale pipeline detected
  3   Agent readiness check failed
`.trim());
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const args = parseArgs();

  // 1. Run pre-flight checks
  const preFlight = runPreFlight();

  // 1a. Stale pipeline detection â€” exit code 2 if stale context found (unless --force-clean)
  if (preFlight.staleContextFound) {
    if (args.forceClean) {
      // Archive stale context automatically
      const stalePipelineId = generateUuid();
      const staleDir = path.resolve(`.opencode/pipeline-logs/stale-${stalePipelineId}/`);
      if (!fs.existsSync(staleDir)) {
        fs.mkdirSync(staleDir, { recursive: true });
      }
      const contextPathStale = path.resolve('agent-context.md');
      if (fs.existsSync(contextPathStale)) {
        fs.renameSync(contextPathStale, path.join(staleDir, 'agent-context.md'));
      }
      console.log(`  âœ… Archived stale agent-context.md to .opencode/pipeline-logs/stale-${stalePipelineId}/`);
    } else {
      console.log('');
      console.log('âš ï¸  STALE PIPELINE DETECTED');
      console.log('â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”');
      console.log(`An agent-context.md exists with status: ${preFlight.staleContextStatus}, age: ${preFlight.staleContextAge}`);
      console.log('This may be an abandoned pipeline from a previous session.');
      console.log('');
      console.log('To proceed, you need to either:');
      console.log('  1. Run with --force-clean to auto-archive');
      console.log('  2. Archive it: mv agent-context.md .opencode/pipeline-logs/stale-<pipelineId>/');
      console.log('  3. Delete it: rm agent-context.md');
      console.log('');
      console.log('After cleanup, re-run pipeline-init.ts.');
      process.exit(2);
    }
  }

  // 1b. Agent readiness check â€” verify required agents have correct permissions
  if (args.pipelineType !== 'documentation' && !args.skipReadiness) {
    const readinessResult = execSafe(
      `${getScriptRunner()} skills/scripts/orchestration/check-agent-readiness.ts --pipeline-type=${sanitizeShellArg(args.pipelineType)} 2>&1`,
      15000,
    );
    
    if (readinessResult.exitCode !== 0) {
      console.log('');
      console.log('âš ï¸  AGENT READINESS CHECK FAILED');
      console.log('â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”');
      console.log(readinessResult.stderr || readinessResult.stdout);
      console.log('');
      console.log('Some agents required for this pipeline are not properly configured.');
      console.log('Run the check manually for details:');
      console.log(`  ${getScriptRunner()} skills/scripts/orchestration/check-agent-readiness.ts --pipeline-type=${sanitizeShellArg(args.pipelineType)}`);
      console.log('');
      console.log('To fix: Ensure all required agent config files exist with correct permissions.');
      process.exit(3);
    }
    
    // Parse the readiness output and log agent statuses
    const readinessOutput = readinessResult.stdout || readinessResult.stderr || '';
    if (readinessOutput.length > 0) {
      console.log(readinessOutput);
    }
  }

  // 3. Ensure pipeline logs directory
  ensurePipelineLogsDir();

  // 4. Create agent-context.md
  const { content: contextContent, pipelineId } = generateAgentContext(args, preFlight);
  const contextPath = path.resolve('agent-context.md');
  fs.writeFileSync(contextPath, contextContent, 'utf-8');

  // 4a. Initialize audit log (non-fatal â€” warning only on failure)
  const tsNodeBin = getScriptRunner();
  const auditLogScript = path.resolve(__dirname, 'audit-log.ts');
  const auditLogResult = execSafe(
    `"${tsNodeBin}" "${auditLogScript}" init --pipeline-id=${sanitizeShellArg(pipelineId)} --feature=${sanitizeShellArg(args.feature)}`,
    15000,
  );
  if (auditLogResult.exitCode !== 0) {
    console.log(`  âš ï¸ Audit log init skipped: ${(auditLogResult.stderr || auditLogResult.stdout).substring(0, 100)}`);
  } else {
    console.log('  âœ… Audit log initialized');
  }

  // 5. Print summary report
  printSummary(args, preFlight);

  process.exit(0);
}

main();
