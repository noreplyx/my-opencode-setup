#!/usr/bin/env ts-node
/**
 * Agent Calibration Database Updater
 *
 * Usage:
 *   ts-node update-calibration.ts --agent=<name> --success=true|false [--effectiveness=good|ok|poor] [--failure-pattern="description"] [--build-retries=N] [--lint-retries=N] [--checkpoints=N]
 *   ts-node update-calibration.ts --agent=orchestrator --success=true|false [--task-type=<type>] [--pipeline-duration-min=N] [--circuit-breaker-activation] [--failure-pattern="description"]
 *   ts-node update-calibration.ts --read
 *
 * Manages .opencode/calibration/agents.yaml — the per-agent success tracking database.
 * Exit codes: 0 = success, 1 = error
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentEntry {
  totalTasks: number;
  successfulTasks: number;
  failedTasks: number;
  avgEffectiveness: string;
  lastTaskDate: string | null;
  commonFailurePatterns: string[];
  strengths: string[];
  // Agent-specific optional fields
  buildRetries?: number;
  lintRetries?: number;
  behavioralCheckpointsPerPlan?: number;
}

interface OrchestratorEntry {
  totalPipelines: number;
  successfulPipelines: number;
  failedPipelines: number;
  pipelineSelectionAccuracy: number;
  pipelineSelectionAccuracyByType: Record<string, number>;
  avgPipelineDuration: number;
  circuitBreakerActivations: number;
  lastPipelineDate: string | null;
  commonSelectionErrors: string[];
}

interface CalibrationData {
  agents: Record<string, AgentEntry>;
  orchestrator: OrchestratorEntry;
}

interface CliArgs {
  read: boolean;
  agent: string | null;
  success: boolean | null;
  effectiveness: string | null;
  failurePattern: string | null;
  buildRetries: number | null;
  lintRetries: number | null;
  checkpoints: number | null;
  taskType: string | null;
  pipelineDurationMin: number | null;
  circuitBreakerActivation: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const VALID_EFFECTIVENESS = new Set(['good', 'ok', 'poor', 'unknown']);

const DEFAULT_AGENTS: Record<string, AgentEntry> = {
  finder: {
    totalTasks: 0,
    successfulTasks: 0,
    failedTasks: 0,
    avgEffectiveness: 'unknown',
    lastTaskDate: null,
    commonFailurePatterns: [],
    strengths: ['Codebase exploration and pattern discovery'],
  },
  implementor: {
    totalTasks: 0,
    successfulTasks: 0,
    failedTasks: 0,
    avgEffectiveness: 'unknown',
    buildRetries: 0,
    lintRetries: 0,
    lastTaskDate: null,
    commonFailurePatterns: [],
    strengths: ['Precise plan-following implementation'],
  },
  mergeCoordinator: {
    totalTasks: 0,
    successfulTasks: 0,
    failedTasks: 0,
    avgEffectiveness: 'unknown',
    lastTaskDate: null,
    commonFailurePatterns: [],
    strengths: ['Cross-file import and type signature verification after parallel dispatch'],
  },
  plandescriber: {
    totalTasks: 0,
    successfulTasks: 0,
    failedTasks: 0,
    avgEffectiveness: 'unknown',
    behavioralCheckpointsPerPlan: 0.0,
    lastTaskDate: null,
    commonFailurePatterns: [],
    strengths: ['Comprehensive roadmap creation'],
  },
  fixer: {
    totalTasks: 0,
    successfulTasks: 0,
    failedTasks: 0,
    avgEffectiveness: 'unknown',
    lastTaskDate: null,
    commonFailurePatterns: [],
    strengths: ['Root cause diagnosis and targeted fixes'],
  },
  qa: {
    totalTasks: 0,
    successfulTasks: 0,
    failedTasks: 0,
    avgEffectiveness: 'unknown',
    lastTaskDate: null,
    commonFailurePatterns: [],
    strengths: ['Comprehensive test coverage and quality analysis'],
  },
  verifier: {
    totalTasks: 0,
    successfulTasks: 0,
    failedTasks: 0,
    avgEffectiveness: 'unknown',
    lastTaskDate: null,
    commonFailurePatterns: [],
    strengths: ['Precise plan-compliance verification'],
  },
  browserTester: {
    totalTasks: 0,
    successfulTasks: 0,
    failedTasks: 0,
    avgEffectiveness: 'unknown',
    lastTaskDate: null,
    commonFailurePatterns: [],
    strengths: ['UI/UX bug discovery through Playwright automation'],
  },
  documentor: {
    totalTasks: 0,
    successfulTasks: 0,
    failedTasks: 0,
    avgEffectiveness: 'unknown',
    lastTaskDate: null,
    commonFailurePatterns: [],
    strengths: ['Automated documentation creation and maintenance', 'API docs, inline comments, and ADR generation'],
  },
  finder: {

const DEFAULT_ORCHESTRATOR: OrchestratorEntry = {
  totalPipelines: 0,
  successfulPipelines: 0,
  failedPipelines: 0,
  pipelineSelectionAccuracy: 0.0,
  pipelineSelectionAccuracyByType: {},
  avgPipelineDuration: 0,
  circuitBreakerActivations: 0,
  lastPipelineDate: null,
  commonSelectionErrors: [],
};

// ─── YAML Parser (manual, no external deps) ──────────────────────────────────
// The YAML format is simple enough for line-by-line parsing.

function parseYaml(content: string): any {
  const result: any = {};
  const lines = content.split('\n');
  let currentSection: string | null = null;
  let currentAgent: string | null = null;
  let currentArray: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    // Detect top-level sections: "agents:" or "orchestrator:"
    const topLevelMatch = line.match(/^(\w+):$/);
    if (topLevelMatch) {
      if (currentAgent && currentSection) {
        // Flush accumulated arrays for current agent
        if (currentArray.length > 0) {
          setNested(result, [currentSection, currentAgent!, 'commonFailurePatterns'], [...currentArray]);
          currentArray = [];
        }
      }
      currentSection = topLevelMatch[1];
      if (!result[currentSection]) {
        result[currentSection] = currentSection === 'agents' ? {} : {};
      }
      currentAgent = null;
      continue;
    }

    // Detect agent keys under "agents:" — e.g., "  finder:"
    if (currentSection === 'agents') {
      const agentMatch = line.match(/^  (\w[\w]*):$/);
      if (agentMatch) {
        if (currentAgent && currentArray.length > 0) {
          setNested(result, [currentSection, currentAgent, 'commonFailurePatterns'], [...currentArray]);
          currentArray = [];
        }
        currentAgent = agentMatch[1];
        if (!result.agents[currentAgent]) {
          result.agents[currentAgent] = {};
        }
        continue;
      }

      // Parse agent properties — e.g., "    totalTasks: 0"
      if (currentAgent) {
        const propMatch = line.match(/^    (\w[\w]*):\s*(.*)$/);
        if (propMatch) {
          const key = propMatch[1];
          const rawValue = propMatch[2].trim();
          if (key === 'strengths') {
            // Ignore the "strengths: []" line, we handle items below
            if (rawValue === '[]' || rawValue === '') {
              result.agents[currentAgent][key] = [];
            }
            continue;
          }
          if (key === 'commonFailurePatterns') {
            if (rawValue === '[]' || rawValue === '') {
              result.agents[currentAgent][key] = [];
            }
            continue;
          }
          result.agents[currentAgent][key] = parseValue(rawValue);
          continue;
        }

        // Array items: "      - \"value\"" or "      - value"
        const arrayItemMatch = line.match(/^      -\s*(.*)$/);
        if (arrayItemMatch) {
          const item = arrayItemMatch[1].replace(/^"(.*)"$/, '$1').trim();
          if (item) currentArray.push(item);
          continue;
        }
      }
    }

    // Parse orchestrator properties — e.g., "  totalPipelines: 0"
    if (currentSection === 'orchestrator') {
      const propMatch = line.match(/^  (\w[\w]*):\s*(.*)$/);
      if (propMatch) {
        const key = propMatch[1];
        const rawValue = propMatch[2].trim();
        if (key === 'commonSelectionErrors') {
          if (rawValue === '[]' || rawValue === '') {
            result.orchestrator[key] = [];
          }
          continue;
        }
        if (key === 'pipelineSelectionAccuracyByType') {
          if (rawValue === '{}' || rawValue === '') {
            result.orchestrator[key] = {};
          } else {
            // Sub-entries will be handled by the 4-space indent match below
            if (!result.orchestrator[key]) {
              result.orchestrator[key] = {};
            }
          }
          continue;
        }
        if (key === 'circuitBreakerActivations' || key === 'avgPipelineDuration' || key === 'avgTokensPerPipeline') {
          result.orchestrator[key] = parseValue(rawValue);
          continue;
        }
        result.orchestrator[key] = parseValue(rawValue);
        continue;
      }

      // Sub-entries for pipelineSelectionAccuracyByType — e.g., "    new-feature-known: 100"
      const subPropMatch = line.match(/^    (\w[\w-]*):\s*(.*)$/);
      if (subPropMatch && result.orchestrator && typeof result.orchestrator.pipelineSelectionAccuracyByType === 'object') {
        const subKey = subPropMatch[1];
        const subValue = parseValue(subPropMatch[2].trim());
        result.orchestrator.pipelineSelectionAccuracyByType[subKey] = subValue;
        continue;
      }

      // Array items for orchestrator
      const arrayItemMatch = line.match(/^    -\s*(.*)$/);
      if (arrayItemMatch && result.orchestrator) {
        if (!result.orchestrator.commonSelectionErrors) {
          result.orchestrator.commonSelectionErrors = [];
        }
        const item = arrayItemMatch[1].replace(/^"(.*)"$/, '$1').trim();
        if (item) result.orchestrator.commonSelectionErrors.push(item);
      }
    }
  }

  // Flush last agent's arrays
  if (currentAgent && currentArray.length > 0 && currentSection === 'agents') {
    setNested(result, [currentSection, currentAgent, 'commonFailurePatterns'], [...currentArray]);
  }

  // Ensure nested arrays exist under strengths
  if (result.agents) {
    for (const agentKey of Object.keys(result.agents)) {
      if (!Array.isArray(result.agents[agentKey].commonFailurePatterns)) {
        result.agents[agentKey].commonFailurePatterns = [];
      }
    }
  }

  return result;
}

function parseValue(raw: string): any {
  if (raw === 'null' || raw === '~') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  // Number
  const num = Number(raw);
  if (!isNaN(num) && raw !== '') return num;
  // Quoted string
  const match = raw.match(/^"(.*)"$/);
  if (match) return match[1];
  return raw;
}

function setNested(obj: any, keys: string[], value: any): void {
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]]) current[keys[i]] = {};
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
}

// ─── YAML Serializer (manual) ────────────────────────────────────────────────

function serializeYaml(data: CalibrationData): string {
  const lines: string[] = [
    '# Agent Calibration Database',
    '# Tracks per-agent success rates across sessions.',
    '# Created on first pipeline, updated after every pipeline.',
    '# Schema documented in skills/orchestration/references/calibration-schema.md',
    '',
    'agents:',
  ];

  const agentKeys = Object.keys(data.agents).sort();
  for (const key of agentKeys) {
    const agent = data.agents[key];
    lines.push(`  ${key}:`);
    lines.push(`    totalTasks: ${agent.totalTasks}`);
    lines.push(`    successfulTasks: ${agent.successfulTasks}`);
    lines.push(`    failedTasks: ${agent.failedTasks}`);
    lines.push(`    avgEffectiveness: "${agent.avgEffectiveness}"`);
    lines.push(`    lastTaskDate: ${agent.lastTaskDate === null ? 'null' : agent.lastTaskDate}`);
    lines.push(`    commonFailurePatterns: []`);
    // Write failure patterns as comments
    if (agent.commonFailurePatterns.length > 0) {
      lines.push(`    # failure-patterns:`);
      for (const pattern of agent.commonFailurePatterns) {
        lines.push(`    #   - "${pattern}"`);
      }
    }
    if (agent.buildRetries !== undefined) {
      lines.push(`    buildRetries: ${agent.buildRetries}`);
    }
    if (agent.lintRetries !== undefined) {
      lines.push(`    lintRetries: ${agent.lintRetries}`);
    }
    if (agent.behavioralCheckpointsPerPlan !== undefined) {
      lines.push(`    behavioralCheckpointsPerPlan: ${agent.behavioralCheckpointsPerPlan}`);
    }
    lines.push(`    strengths:`);
    for (const strength of agent.strengths) {
      lines.push(`      - "${strength}"`);
    }
  }

  lines.push('');
  lines.push('# Orchestrator\'s own calibration');
  lines.push('orchestrator:');
  const orch = data.orchestrator;
  lines.push(`  totalPipelines: ${orch.totalPipelines}`);
  lines.push(`  successfulPipelines: ${orch.successfulPipelines}`);
  lines.push(`  failedPipelines: ${orch.failedPipelines}`);
  lines.push(`  pipelineSelectionAccuracy: ${orch.pipelineSelectionAccuracy}`);
  lines.push(`  pipelineSelectionAccuracyByType:`);
  const typeKeys = Object.keys(orch.pipelineSelectionAccuracyByType).sort();
  if (typeKeys.length === 0) {
    lines.push(`    {}`);
  } else {
    for (const typeKey of typeKeys) {
      lines.push(`    ${typeKey}: ${orch.pipelineSelectionAccuracyByType[typeKey]}`);
    }
  }
  lines.push(`  lastPipelineDate: ${orch.lastPipelineDate === null ? 'null' : orch.lastPipelineDate}`);
  lines.push(`  commonSelectionErrors: []`);
  if (orch.commonSelectionErrors.length > 0) {
    lines.push(`  # selection-errors:`);
    for (const err of orch.commonSelectionErrors) {
      lines.push(`  #   - "${err}"`);
    }
  }
  lines.push(`  circuitBreakerActivations: ${orch.circuitBreakerActivations}`);
  lines.push(`  avgPipelineDuration: ${orch.avgPipelineDuration}`);

  lines.push('');
  return lines.join('\n');
}

// ─── File Path Resolution ────────────────────────────────────────────────────

function getCalibrationPath(): string {
  // Resolve relative to the script location:
  // skills/scripts/orchestration/update-calibration.ts -> .opencode/calibration/agents.yaml
  const scriptDir = __dirname;
  // Navigate up: orchestration -> scripts -> skills -> root
  const rootDir = path.resolve(scriptDir, '..', '..', '..', '..');
  return path.join(rootDir, '.opencode', 'calibration', 'agents.yaml');
}

// ─── Read / Write / Default Creation ─────────────────────────────────────────

function readCalibration(filePath: string): CalibrationData {
  if (!fs.existsSync(filePath)) {
    return createDefault();
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  try {
    const parsed = parseYaml(raw);
    return mergeWithDefaults(parsed);
  } catch (err: any) {
    console.error(`❌ Parse error in ${filePath}: ${err.message}`);
    process.exit(1);
  }
}

function createDefault(): CalibrationData {
  return {
    agents: JSON.parse(JSON.stringify(DEFAULT_AGENTS)),
    orchestrator: { ...DEFAULT_ORCHESTRATOR },
  };
}

function mergeWithDefaults(parsed: any): CalibrationData {
  const data: CalibrationData = createDefault();

  if (parsed.agents && typeof parsed.agents === 'object') {
    for (const key of Object.keys(parsed.agents)) {
      const existing = parsed.agents[key];
      if (existing && typeof existing === 'object') {
        data.agents[key] = {
          ...data.agents[key],
          ...existing,
        };
      }
    }
  }

  if (parsed.orchestrator && typeof parsed.orchestrator === 'object') {
    data.orchestrator = {
      ...data.orchestrator,
      ...parsed.orchestrator,
    };
    // Deep-merge pipelineSelectionAccuracyByType if present
    if (parsed.orchestrator.pipelineSelectionAccuracyByType &&
        typeof parsed.orchestrator.pipelineSelectionAccuracyByType === 'object') {
      data.orchestrator.pipelineSelectionAccuracyByType = {
        ...data.orchestrator.pipelineSelectionAccuracyByType,
        ...parsed.orchestrator.pipelineSelectionAccuracyByType,
      };
    }
  }

  return data;
}

function writeCalibration(filePath: string, data: CalibrationData): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const yaml = serializeYaml(data);
  fs.writeFileSync(filePath, yaml, 'utf-8');
}

// ─── Argument Parsing ────────────────────────────────────────────────────────

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    read: args.includes('--read'),
    agent: null,
    success: null,
    effectiveness: null,
    failurePattern: null,
    buildRetries: null,
    lintRetries: null,
    checkpoints: null,
    taskType: null,
    pipelineDurationMin: null,
    circuitBreakerActivation: args.includes('--circuit-breaker-activation'),
  };

  for (const arg of args) {
    if (arg === '--read') continue;
    const eqIndex = arg.indexOf('=');
    if (eqIndex === -1) {
      console.error(`❌ Invalid argument: ${arg}`);
      process.exit(1);
    }
    const key = arg.substring(0, eqIndex);
    const value = arg.substring(eqIndex + 1);

    switch (key) {
      case '--agent':
        result.agent = value;
        break;
      case '--success':
        if (value !== 'true' && value !== 'false') {
          console.error(`❌ --success must be "true" or "false", got "${value}"`);
          process.exit(1);
        }
        result.success = value === 'true';
        break;
      case '--effectiveness':
        if (!VALID_EFFECTIVENESS.has(value)) {
          console.warn(`⚠️  Invalid effectiveness value "${value}". Valid: good, ok, poor, unknown. Skipping.`);
          result.effectiveness = null;
        } else {
          result.effectiveness = value;
        }
        break;
      case '--failure-pattern':
        result.failurePattern = value;
        break;
      case '--build-retries':
        result.buildRetries = parseInt(value, 10);
        if (isNaN(result.buildRetries) || result.buildRetries < 0) {
          console.error(`❌ --build-retries must be a non-negative integer, got "${value}"`);
          process.exit(1);
        }
        break;
      case '--lint-retries':
        result.lintRetries = parseInt(value, 10);
        if (isNaN(result.lintRetries) || result.lintRetries < 0) {
          console.error(`❌ --lint-retries must be a non-negative integer, got "${value}"`);
          process.exit(1);
        }
        break;
      case '--checkpoints':
        result.checkpoints = parseFloat(value);
        if (isNaN(result.checkpoints) || result.checkpoints < 0) {
          console.error(`❌ --checkpoints must be a non-negative number, got "${value}"`);
          process.exit(1);
        }
        break;
      case '--task-type':
        if (value.trim() === '') {
          console.error(`❌ --task-type must be a non-empty string, got "${value}"`);
          process.exit(1);
        }
        result.taskType = value;
        break;
      case '--pipeline-duration-min':
        result.pipelineDurationMin = parseFloat(value);
        if (isNaN(result.pipelineDurationMin) || result.pipelineDurationMin < 0) {
          console.error(`❌ --pipeline-duration-min must be a non-negative number, got "${value}"`);
          process.exit(1);
        }
        break;
      default:
        console.error(`❌ Unknown argument: ${key}`);
        process.exit(1);
    }
  }

  return result;
}

// ─── Update Logic ────────────────────────────────────────────────────────────

function updateAgent(data: CalibrationData, args: CliArgs): void {
  if (!args.agent) {
    console.error('❌ --agent is required (use --read to view without updating)');
    process.exit(1);
  }

  const agentName = args.agent;

  if (agentName === 'orchestrator') {
    updateOrchestrator(data, args);
    return;
  }

  // Ensure agent exists
  if (!data.agents[agentName]) {
    data.agents[agentName] = {
      totalTasks: 0,
      successfulTasks: 0,
      failedTasks: 0,
      avgEffectiveness: 'unknown',
      lastTaskDate: null,
      commonFailurePatterns: [],
      strengths: [],
    };
  }

  const agent = data.agents[agentName];
  const oldTotal = agent.totalTasks;
  const oldSuccess = agent.successfulTasks;
  const oldFailed = agent.failedTasks;

  // Increment counters
  agent.totalTasks += 1;
  if (args.success === true) {
    agent.successfulTasks += 1;
  } else if (args.success === false) {
    agent.failedTasks += 1;
  }

  // Update effectiveness
  if (args.effectiveness !== null) {
    agent.avgEffectiveness = args.effectiveness;
  }

  // Append failure pattern
  if (args.failurePattern !== null) {
    agent.commonFailurePatterns.push(args.failurePattern);
  }

  // Agent-specific fields
  if (agent.buildRetries !== undefined && args.buildRetries !== null) {
    agent.buildRetries = args.buildRetries;
  }
  if (agent.lintRetries !== undefined && args.lintRetries !== null) {
    agent.lintRetries = args.lintRetries;
  }
  if (agent.behavioralCheckpointsPerPlan !== undefined && args.checkpoints !== null) {
    agent.behavioralCheckpointsPerPlan = args.checkpoints;
  }

  // Timestamp
  agent.lastTaskDate = new Date().toISOString();

  // Print summary
  const successRate = agent.totalTasks > 0
    ? ((agent.successfulTasks / agent.totalTasks) * 100).toFixed(1)
    : '0.0';

  console.log(`📊 Calibration Updated: ${agentName}`);
  console.log(`  totalTasks: ${oldTotal} → ${agent.totalTasks}`);
  console.log(`  successfulTasks: ${oldSuccess} → ${agent.successfulTasks}`);
  console.log(`  failedTasks: ${oldFailed} → ${agent.failedTasks}`);
  console.log(`  successRate: ${successRate}%`);
  console.log(`  lastTaskDate: ${agent.lastTaskDate}`);
}

function updateOrchestrator(data: CalibrationData, args: CliArgs): void {
  const oldPipelines = data.orchestrator.totalPipelines;
  const oldSuccess = data.orchestrator.successfulPipelines;
  const oldFailed = data.orchestrator.failedPipelines;
  const oldAccuracy = data.orchestrator.pipelineSelectionAccuracy;

  data.orchestrator.totalPipelines += 1;
  if (args.success === true) {
    data.orchestrator.successfulPipelines += 1;
  } else if (args.success === false) {
    data.orchestrator.failedPipelines += 1;
  }

  // Recalculate accuracy (ratio of correct pipeline selections)
  if (args.success !== null) {
    const total = data.orchestrator.totalPipelines;
    const correct = data.orchestrator.successfulPipelines;
    data.orchestrator.pipelineSelectionAccuracy = total > 0
      ? Math.round((correct / total) * 1000) / 10
      : 0.0;
  }

  // Update pipelineSelectionAccuracyByType for the given task type
  if (args.taskType !== null && args.success !== null) {
    const existingAccuracy = data.orchestrator.pipelineSelectionAccuracyByType[args.taskType];
    if (existingAccuracy === undefined) {
      // First entry for this task type — assume 100% if success, 0% if failure
      data.orchestrator.pipelineSelectionAccuracyByType[args.taskType] = args.success ? 100 : 0;
    } else {
      // Existing accuracy — compute running average
      const correctCount = args.success ? 1 : 0;
      // Approximate by treating existing accuracy as representing at least 1 entry
      data.orchestrator.pipelineSelectionAccuracyByType[args.taskType] = Math.round(
        (existingAccuracy + (correctCount * 100)) / 2
      );
    }
  }

  // Update avgPipelineDuration
  if (args.pipelineDurationMin !== null) {
    const oldDuration = data.orchestrator.avgPipelineDuration;
    // Running average across total pipelines completed so far (before this one)
    const completedBefore = data.orchestrator.totalPipelines - 1;
    if (completedBefore > 0) {
      data.orchestrator.avgPipelineDuration = Math.round(
        ((oldDuration * completedBefore) + args.pipelineDurationMin) / data.orchestrator.totalPipelines
      );
    } else {
      data.orchestrator.avgPipelineDuration = args.pipelineDurationMin;
    }
  }

  // Update circuitBreakerActivations
  if (args.circuitBreakerActivation) {
    data.orchestrator.circuitBreakerActivations += 1;
  }

  if (args.failurePattern !== null) {
    data.orchestrator.commonSelectionErrors.push(args.failurePattern);
  }

  data.orchestrator.lastPipelineDate = new Date().toISOString();

  console.log(`📊 Calibration Updated: orchestrator`);
  console.log(`  totalPipelines: ${oldPipelines} → ${data.orchestrator.totalPipelines}`);
  console.log(`  successfulPipelines: ${oldSuccess} → ${data.orchestrator.successfulPipelines}`);
  console.log(`  failedPipelines: ${oldFailed} → ${data.orchestrator.failedPipelines}`);
  console.log(`  pipelineSelectionAccuracy: ${oldAccuracy}% → ${data.orchestrator.pipelineSelectionAccuracy}%`);
  if (args.taskType !== null) {
    console.log(`  pipelineSelectionAccuracyByType["${args.taskType}"]: ${data.orchestrator.pipelineSelectionAccuracyByType[args.taskType]}%`);
  }
  if (args.pipelineDurationMin !== null) {
    console.log(`  avgPipelineDuration: ${data.orchestrator.avgPipelineDuration} min`);
  }
  if (args.circuitBreakerActivation) {
    console.log(`  circuitBreakerActivations: ${data.orchestrator.circuitBreakerActivations}`);
  }
  console.log(`  lastPipelineDate: ${data.orchestrator.lastPipelineDate}`);
}

// ─── Read Mode ───────────────────────────────────────────────────────────────

function printReadReport(data: CalibrationData): void {
  console.log('📋 Agent Calibration Report');
  console.log('');

  const agentKeys = Object.keys(data.agents).sort();
  for (const key of agentKeys) {
    const agent = data.agents[key];
    const successRate = agent.totalTasks > 0
      ? ((agent.successfulTasks / agent.totalTasks) * 100).toFixed(1)
      : 'N/A';
    const failureRate = agent.totalTasks > 0
      ? ((agent.failedTasks / agent.totalTasks) * 100).toFixed(1)
      : 'N/A';

    console.log(`  ${key}:`);
    console.log(`    totalTasks: ${agent.totalTasks}`);
    console.log(`    successRate: ${successRate}%`);
    console.log(`    failureRate: ${failureRate}%`);
    console.log(`    effectiveness: ${agent.avgEffectiveness}`);

    if (agent.commonFailurePatterns.length > 0) {
      console.log(`    topFailurePatterns:`);
      // Show top 3
      const topPatterns = agent.commonFailurePatterns.slice(0, 3);
      for (const pattern of topPatterns) {
        console.log(`      - "${pattern}"`);
      }
    } else {
      console.log(`    commonFailurePatterns: (none)`);
    }

    // Flag agents with > 33% failure rate
    if (agent.totalTasks > 0 && (agent.failedTasks / agent.totalTasks) > 0.33) {
      console.log(`    ⚠️  HIGH FAILURE RATE (>33%)`);
    }

    console.log('');
  }

  // Orchestrator summary
  const orch = data.orchestrator;
  console.log(`  orchestrator:`);
  console.log(`    totalPipelines: ${orch.totalPipelines}`);
  console.log(`    pipelineSelectionAccuracy: ${orch.pipelineSelectionAccuracy}%`);
  const typeKeys = Object.keys(orch.pipelineSelectionAccuracyByType).sort();
  if (typeKeys.length > 0) {
    console.log(`    pipelineSelectionAccuracyByType:`);
    for (const typeKey of typeKeys) {
      console.log(`      ${typeKey}: ${orch.pipelineSelectionAccuracyByType[typeKey]}%`);
    }
  }
  console.log(`    avgPipelineDuration: ${orch.avgPipelineDuration} min`);
  console.log(`    circuitBreakerActivations: ${orch.circuitBreakerActivations}`);
  const orchFailureRate = orch.totalPipelines > 0
    ? ((orch.failedPipelines / orch.totalPipelines) * 100).toFixed(1)
    : 'N/A';
  console.log(`    pipelineFailureRate: ${orchFailureRate}%`);
  if (orch.commonSelectionErrors.length > 0) {
    console.log(`    commonSelectionErrors:`);
    for (const err of orch.commonSelectionErrors) {
      console.log(`      - "${err}"`);
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs();

  if (args.read) {
    const filePath = getCalibrationPath();
    const data = readCalibration(filePath);
    printReadReport(data);
    process.exit(0);
  }

  if (!args.agent) {
    console.error('❌ --agent is required (use --read to view without updating)');
    console.error('');
    console.error('Usage:');
    console.error('  ts-node update-calibration.ts --agent=<name> --success=true|false [options]');
    console.error('  ts-node update-calibration.ts --read');
    process.exit(1);
  }

  const filePath = getCalibrationPath();
  const data = readCalibration(filePath);
  updateAgent(data, args);
  writeCalibration(filePath, data);
}

main();
