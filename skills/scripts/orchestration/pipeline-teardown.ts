#!/usr/bin/env node
/**
 * Pipeline Teardown & Finalization
 *
 * Handles the complete teardown and finalization of a pipeline run:
 *   - Archives agent-context.md raw outputs to .opencode/pipeline-logs/
 *   - Cleans up agent-context.md
 *
 * Usage:
 *   [runtime] pipeline-teardown.ts --feature=<name> --pipeline-type=<type> --result=pass|fail|partial
 *     [--duration-minutes=<N>] [--files-changed=<file1,file2,...>]
 *     [--failed-gates=<gate1,gate2,...>] [--circuit-breaker-events=<json>]
 *     [--keep-context]
 *
 * Exit codes:
 *   0 = Teardown complete
 *   1 = Error
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CliArgs {
  feature: string;
  pipelineType: string;
  result: 'pass' | 'fail' | 'partial';
  durationMinutes: number;
  filesChanged: string[];
  failedGates: string[];
  circuitBreakerEvents: CircuitBreakerEvent[];
  keepContext: boolean;
}

interface CircuitBreakerEvent {
  gate: string;
  attempts: number;
  resolution: string;
}

interface AgentContextData {
  pipelineId: string;
  feature: string;
  pipelineType: string;
  createdAt: string;
  circuitBreaker: {
    counters: Record<string, number>;
    state: string;
    patternDetection: string[];
  };
  agentHistory: AgentHistoryEntry[];
  failureSummary: string | null;
  agentOutputs: Record<string, any>;
}

interface AgentHistoryEntry {
  step: number;
  agent: string;
  result: string;
  duration?: number;
  decisions: string[];
  warnings: string[];
  output?: string;
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function getRootDir(): string {
  // skills/scripts/orchestration/ -> root
  return path.resolve(__dirname, '..', '..', '..', '..');
}

function getAgentContextPath(rootDir: string): string {
  return path.join(rootDir, 'agent-context.md');
}

function getPipelineLogsDir(rootDir: string): string {
  return path.join(rootDir, '.opencode', 'pipeline-logs');
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    feature: '',
    pipelineType: '',
    result: 'pass',
    durationMinutes: 0,
    filesChanged: [],
    failedGates: [],
    circuitBreakerEvents: [],
    keepContext: false,
  };

  for (const arg of args) {
    if (arg === '--keep-context') {
      result.keepContext = true;
      continue;
    }

    const eqIndex = arg.indexOf('=');
    if (eqIndex === -1) {
      console.error(`❌ Invalid argument: ${arg}`);
      process.exit(1);
    }

    const key = arg.substring(0, eqIndex);
    const value = arg.substring(eqIndex + 1);

    switch (key) {
      case '--feature':
        result.feature = value;
        break;
      case '--pipeline-type':
        result.pipelineType = value;
        break;
      case '--result':
        if (!['pass', 'fail', 'partial'].includes(value)) {
          console.error(`❌ --result must be "pass", "fail", or "partial", got "${value}"`);
          process.exit(1);
        }
        result.result = value as 'pass' | 'fail' | 'partial';
        break;
      case '--duration-minutes':
        result.durationMinutes = parseInt(value, 10);
        if (isNaN(result.durationMinutes) || result.durationMinutes < 0) {
          console.error(`❌ --duration-minutes must be a non-negative integer, got "${value}"`);
          process.exit(1);
        }
        break;
      case '--files-changed':
        result.filesChanged = value ? value.split(',').map(f => f.trim()).filter(Boolean) : [];
        break;
      case '--failed-gates':
        result.failedGates = value ? value.split(',').map(g => g.trim()).filter(Boolean) : [];
        break;
      case '--circuit-breaker-events':
        try {
          result.circuitBreakerEvents = value ? JSON.parse(value) : [];
        } catch {
          console.error(`❌ --circuit-breaker-events must be valid JSON, got "${value}"`);
          process.exit(1);
        }
        break;
      default:
        console.error(`❌ Unknown argument: ${key}`);
        process.exit(1);
    }
  }

  if (!result.feature) {
    console.error('❌ --feature is required');
    console.error('');
    console.error('Usage:');
    console.error('  [runtime] pipeline-teardown.ts --feature=<name> --pipeline-type=<type> --result=pass|fail|partial [options]');
    process.exit(1);
  }

  if (!result.pipelineType) {
    console.error('❌ --pipeline-type is required');
    process.exit(1);
  }

  return result;
}

// ---------------------------------------------------------------------------
// agent-context.md parser (YAML frontmatter + body, no external deps)
// ---------------------------------------------------------------------------

function parseAgentContext(filePath: string): AgentContextData | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = fs.readFileSync(filePath, 'utf-8');

  // Extract YAML frontmatter between --- markers
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!frontmatterMatch) {
    return null;
  }

  const yamlContent = frontmatterMatch[1];
  const parsed: Record<string, any> = {};

  let stack: Array<{ key: string; obj: any; indent: number }> = [];

  const lines = yamlContent.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    const indent = line.search(/\S/);
    const trimmed = line.trim();

    // Detect list items
    const listItemMatch = trimmed.match(/^-\s+(.*)$/);
    if (listItemMatch) {
      if (stack.length > 0) {
        const parent = stack[stack.length - 1];
        if (!Array.isArray(parent.obj[parent.key])) {
          parent.obj[parent.key] = [];
        }
        parent.obj[parent.key].push(parseRawValue(listItemMatch[1]));
      }
      continue;
    }

    // Key: value pair
    const kvMatch = trimmed.match(/^([\w-]+):\s*(.*)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const rawValue = kvMatch[2].trim();

    // Navigate to the right depth level
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    let targetObj: any;
    if (stack.length === 0) {
      targetObj = parsed;
    } else {
      targetObj = stack[stack.length - 1].obj;
      const parentKey = stack[stack.length - 1].key;
      if (typeof targetObj[parentKey] === 'object' && !Array.isArray(targetObj[parentKey])) {
        // Already an object, use it
      } else if (targetObj[parentKey] === undefined || targetObj[parentKey] === null) {
        targetObj[parentKey] = {};
      }
      targetObj = targetObj[parentKey];
    }

    if (rawValue === '' || rawValue === '|') {
      targetObj[key] = targetObj[key] || {};
      stack.push({ key, obj: targetObj, indent });
    } else {
      targetObj[key] = parseRawValue(rawValue);
      stack.push({ key, obj: targetObj, indent });
    }
  }

  return transformParsedContext(parsed, raw);
}

function parseRawValue(raw: string): any {
  if (raw === 'null' || raw === '~') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  const quotedMatch = raw.match(/^"(.*)"$/);
  if (quotedMatch) return quotedMatch[1];

  const num = Number(raw);
  if (!isNaN(num) && raw !== '') return num;

  return raw;
}

function transformParsedContext(raw: Record<string, any>, fullContent: string): AgentContextData {
  const pipelineId: string = raw.pipelineId || raw.pipeline_id || `pipeline-${Date.now()}`;
  const feature: string = raw.feature || 'unknown';
  const pipelineType: string = raw.pipelineType || raw.pipeline_type || 'standard';
  const createdAt: string = raw.createdAt || raw.created_at || new Date().toISOString();

  const cb = raw.circuitBreaker || raw.circuit_breaker || {};
  const circuitBreaker = {
    counters: (typeof cb.counters === 'object' ? cb.counters : {}) as Record<string, number>,
    state: typeof cb.state === 'string' ? cb.state : 'closed',
    patternDetection: Array.isArray(cb.patternDetection || cb.pattern_detection) ? (cb.patternDetection || cb.pattern_detection) : [],
  };

  const history = Array.isArray(raw.agentHistory || raw.agent_history)
    ? (raw.agentHistory || raw.agent_history).map((entry: any, idx: number) => ({
        step: typeof entry.step === 'number' ? entry.step : idx + 1,
        agent: entry.agent || entry.role || 'unknown',
        result: entry.result || 'unknown',
        duration: typeof entry.duration === 'number' ? entry.duration : undefined,
        decisions: Array.isArray(entry.decisions) ? entry.decisions.map(String) : [],
        warnings: Array.isArray(entry.warnings) ? entry.warnings.map(String) : [],
        output: typeof entry.output === 'string' ? entry.output : undefined,
      }))
    : [];

  const failureSummary: string | null = raw.failureSummary || raw.failure_summary || null;
  const agentOutputs: Record<string, any> =
    typeof raw.agentOutputs === 'object' && !Array.isArray(raw.agentOutputs)
      ? raw.agentOutputs
      : {};

  return {
    pipelineId,
    feature,
    pipelineType,
    createdAt,
    circuitBreaker,
    agentHistory: history,
    failureSummary,
    agentOutputs,
  };
}

// ---------------------------------------------------------------------------
// Archive raw agent outputs
// ---------------------------------------------------------------------------

function archiveAgentContext(rootDir: string, ctx: AgentContextData, args: CliArgs, rawContent: string): void {
  const logsDir = getPipelineLogsDir(rootDir);
  const pipelineDir = path.join(logsDir, ctx.pipelineId);

  if (!fs.existsSync(pipelineDir)) {
    fs.mkdirSync(pipelineDir, { recursive: true });
  }

  // Write full raw content of agent-context.md (before teardown)
  const contextLogPath = path.join(pipelineDir, 'agent-context.md');
  fs.writeFileSync(contextLogPath, rawContent, 'utf-8');
  console.log(`📦 Archive: ✅ agent-context.md -> ${path.relative(rootDir, contextLogPath)}`);

  // Write timeline.txt with agent step order and durations
  const timelineLines: string[] = [
    `Pipeline Teardown Timeline`,
    `========================`,
    `Pipeline ID: ${ctx.pipelineId}`,
    `Feature: ${args.feature}`,
    `Type: ${args.pipelineType}`,
    `Result: ${args.result}`,
    `Duration: ${formatDuration(args.durationMinutes)}`,
    `Created: ${ctx.createdAt}`,
    `Archived: ${new Date().toISOString()}`,
    ``,
    `Agent Steps:`,
    `-----------`,
  ];

  if (ctx.agentHistory.length === 0) {
    timelineLines.push('  (No agent history recorded)');
  } else {
    for (const entry of ctx.agentHistory) {
      const durationStr = entry.duration !== undefined ? `${entry.duration}s` : '?';
      const statusIcon = entry.result === 'pass' || entry.result === 'completed' ? '✓' : '✗';
      timelineLines.push(`  Step ${entry.step}: [${statusIcon}] ${entry.agent} (${durationStr}) — ${entry.result}`);
    }
  }

  timelineLines.push('');
  timelineLines.push('Circuit Breaker:');
  timelineLines.push(`  State: ${ctx.circuitBreaker.state}`);
  timelineLines.push(`  Counters:`);
  const cbCounters = ctx.circuitBreaker.counters;
  const counterKeys = Object.keys(cbCounters);
  if (counterKeys.length === 0) {
    timelineLines.push('    (none)');
  } else {
    for (const key of counterKeys) {
      timelineLines.push(`    ${key}: ${cbCounters[key]}`);
    }
  }

  const timelinePath = path.join(pipelineDir, 'timeline.txt');
  fs.writeFileSync(timelinePath, timelineLines.join('\n') + '\n', 'utf-8');
  console.log(`📦 Archive: ✅ timeline.txt written to ${path.relative(rootDir, timelinePath)}`);

  // Write raw agent outputs as separate log files
  if (Object.keys(ctx.agentOutputs).length > 0) {
    const outputsDir = path.join(pipelineDir, 'outputs');
    if (!fs.existsSync(outputsDir)) {
      fs.mkdirSync(outputsDir, { recursive: true });
    }
    for (const [agentName, output] of Object.entries(ctx.agentOutputs)) {
      const outputPath = path.join(outputsDir, `${agentName}.log`);
      const content = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
      fs.writeFileSync(outputPath, content, 'utf-8');
    }
    console.log(`📦 Archive: ✅ Agent outputs archived to ${path.relative(rootDir, outputsDir)}/`);
  }
}

// ---------------------------------------------------------------------------
// Delete agent-context.md
// ---------------------------------------------------------------------------

function deleteAgentContext(rootDir: string, keepContext: boolean): void {
  if (keepContext) {
    console.log('📄 agent-context.md: ⏭️  Preserved (--keep-context flag set)');
    return;
  }
  const contextPath = getAgentContextPath(rootDir);
  if (fs.existsSync(contextPath)) {
    fs.unlinkSync(contextPath);
    console.log('📄 agent-context.md: ✅ Deleted');
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatDuration(minutes: number): string {
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  const mins = Math.floor(minutes);
  const secs = Math.round((minutes - mins) * 60);
  if (secs === 0) return `${mins}m`;
  return `${mins}m ${secs}s`;
}

function getResultEmoji(result: string): string {
  switch (result) {
    case 'pass': return '✅ Pass';
    case 'fail': return '❌ Fail';
    case 'partial': return '⚠️  Partial';
    default: return result;
  }
}

function printSummary(ctx: AgentContextData | null, args: CliArgs): void {
  const completedCount = ctx
    ? ctx.agentHistory.filter(e => e.result === 'pass' || e.result === 'completed').length
    : 0;
  const failedCount = ctx
    ? ctx.agentHistory.filter(e => e.result !== 'pass' && e.result !== 'completed').length
    : 0;

  const separator = '━'.repeat(31 + args.feature.length);

  console.log('');
  console.log(`🧹 Pipeline Teardown: ${args.feature}`);
  console.log(separator);
  console.log('');
  console.log(`Result: ${getResultEmoji(args.result)} (${formatDuration(args.durationMinutes)})`);
  console.log(`Agents: ${completedCount} completed, ${failedCount} failed`);

  if (args.filesChanged.length > 0) {
    const gatesPassed = args.failedGates.length > 0 ? '(inferred)' : '(all)';
    console.log(`Gates Passed: ${gatesPassed}`);
    if (args.failedGates.length > 0) {
      console.log(`Gates Failed: ${args.failedGates.join(', ')}`);
    } else {
      console.log(`Gates Failed: (none)`);
    }
  }

  console.log('');
  const archiveRelPath = ctx
    ? `pipeline-logs/${ctx.pipelineId}/`
    : 'pipeline-logs/(no context)/';
  console.log(`Archive: ✅ ${archiveRelPath}`);
  console.log('');
  console.log('');
  console.log('Cleanup complete.');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs();
  const rootDir = getRootDir();
  const contextPath = getAgentContextPath(rootDir);

  // Read agent-context.md
  let rawContent = '';
  let ctx: AgentContextData | null = null;

  if (fs.existsSync(contextPath)) {
    rawContent = fs.readFileSync(contextPath, 'utf-8');
    ctx = parseAgentContext(contextPath);
    if (ctx) {
      console.log(`📄 agent-context.md: ✅ Read (pipelineId=${ctx.pipelineId}, ${ctx.agentHistory.length} agent step(s))`);
    } else {
      console.warn('⚠️  agent-context.md found but could not parse frontmatter — proceeding with minimal data');
    }
  } else {
    console.warn('⚠️  agent-context.md not found — proceeding with CLI args only');
  }

  // Build context from args if no file
  if (!ctx) {
    ctx = {
      pipelineId: `pipeline-${Date.now()}`,
      feature: args.feature,
      pipelineType: args.pipelineType,
      createdAt: new Date().toISOString(),
      circuitBreaker: {
        counters: {},
        state: 'closed',
        patternDetection: [],
      },
      agentHistory: [],
      failureSummary: null,
      agentOutputs: {},
    };
  }

  // Step 1: Archive raw agent outputs
  if (rawContent) {
    archiveAgentContext(rootDir, ctx, args, rawContent);
  } else {
    console.log('📦 Archive: ⏭️  No agent-context.md to archive');
  }

  // Step 2: Delete agent-context.md
  deleteAgentContext(rootDir, args.keepContext);

  // Step 3: Print summary
  printSummary(ctx, args);

  process.exit(0);
}

main();
