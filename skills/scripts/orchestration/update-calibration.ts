#!/usr/bin/env ts-node
/**
 * Agent Calibration Database Updater
 *
 * Usage:
 *   ts-node update-calibration.ts --agent=<name> --success=true|false [--effectiveness=good|ok|poor] [--failure-pattern="description"] [--build-retries=N] [--lint-retries=N] [--checkpoints=N] [--domain=<domain-name>]
 *   ts-node update-calibration.ts --agent=orchestrator --success=true|false [--task-type=<type>] [--pipeline-duration-min=N] [--circuit-breaker-activation] [--failure-pattern="description"] [--handoff-quality=<1-10>] [--evidence-compliance=<0-100>] [--evidence-quality-avg=<0-100>] [--evidence-staleness-scan=<boolean>]
 *   ts-node update-calibration.ts --agent=<name> --evidence-quality=<0-100> --evidence-compliance=<0-100> --citation-precision=<0-100> --staleness-rate=<0-100> --evidence-count=<number>
 *   ts-node update-calibration.ts --read [--domain=<domain-name>]
 *   ts-node update-calibration.ts --read-evidence-metrics --agent=<name>
 *   ts-node update-calibration.ts --evidence-dashboard
 *
 * Manages .opencode/calibration/agents.yaml — the per-agent success tracking database.
 * NEW: Domain-specific breakdown, handoff quality tracking, evidence compliance, evidence quality metrics.
 * Exit codes: 0 = success, 1 = error
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DomainBreakdown {
  domain: string;
  totalTasks: number;
  successfulTasks: number;
  failedTasks: number;
  avgEffectiveness: string;
  commonFailurePatterns: string[];
}

interface EvidenceMetrics {
  avgEvidenceQuality: number;
  evidenceComplianceRate: number;
  citationPrecision: number;
  stalenessRate: number;
  lastEvidenceScore: number;
  evidenceCount: number;
}

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
  // NEW: Domain-specific breakdown
  domainBreakdown?: DomainBreakdown[];
  // Integrator-specific
  wiringErrorsFixed?: number;
  barrelFilesUpdated?: number;
  // Documentor-specific
  docTypesGenerated?: Record<string, number>;
  docAccuracyScore?: number;
  // PlanDescriber-specific
  acceptanceCriteriaPerPlan?: number;
  // NEW: Evidence metrics
  evidenceMetrics?: EvidenceMetrics;
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
  // NEW
  handoffQualityScore: number;
  evidenceComplianceRate: number;
  // NEW: Evidence quality for orchestrator
  avgEvidenceQualityPipeline: number;
  evidenceStalenessScanEnabled: boolean;
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
  domain: string | null;
  handoffQuality: number | null;
  evidenceCompliance: number | null;
  // NEW: Evidence quality flags
  evidenceQuality: number | null;
  citationPrecision: number | null;
  stalenessRate: number | null;
  evidenceCount: number | null;
  readEvidenceMetrics: boolean;
  evidenceDashboard: boolean;
  evidenceQualityAvg: number | null;
  evidenceComplianceRate: number | null;
  evidenceStalenessScan: boolean | null;
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
    domainBreakdown: [],
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
    domainBreakdown: [],
  },
  mergeCoordinator: {
    totalTasks: 0,
    successfulTasks: 0,
    failedTasks: 0,
    avgEffectiveness: 'unknown',
    lastTaskDate: null,
    commonFailurePatterns: [],
    strengths: ['Cross-file import and type signature verification after parallel dispatch'],
    domainBreakdown: [],
  },
  plandescriber: {
    totalTasks: 0,
    successfulTasks: 0,
    failedTasks: 0,
    avgEffectiveness: 'unknown',
    behavioralCheckpointsPerPlan: 0.0,
    acceptanceCriteriaPerPlan: 0.0,
    lastTaskDate: null,
    commonFailurePatterns: [],
    strengths: ['Comprehensive roadmap creation'],
    domainBreakdown: [],
  },
  fixer: {
    totalTasks: 0,
    successfulTasks: 0,
    failedTasks: 0,
    avgEffectiveness: 'unknown',
    lastTaskDate: null,
    commonFailurePatterns: [],
    strengths: ['Root cause diagnosis and targeted fixes'],
    domainBreakdown: [],
  },
  qa: {
    totalTasks: 0,
    successfulTasks: 0,
    failedTasks: 0,
    avgEffectiveness: 'unknown',
    lastTaskDate: null,
    commonFailurePatterns: [],
    strengths: ['Comprehensive test coverage and quality analysis'],
    domainBreakdown: [],
  },
  verifier: {
    totalTasks: 0,
    successfulTasks: 0,
    failedTasks: 0,
    avgEffectiveness: 'unknown',
    lastTaskDate: null,
    commonFailurePatterns: [],
    strengths: ['Precise plan-compliance verification'],
    domainBreakdown: [],
  },
  browserTester: {
    totalTasks: 0,
    successfulTasks: 0,
    failedTasks: 0,
    avgEffectiveness: 'unknown',
    lastTaskDate: null,
    commonFailurePatterns: [],
    strengths: ['UI/UX bug discovery through Playwright automation'],
    domainBreakdown: [],
  },
  documentor: {
    totalTasks: 0,
    successfulTasks: 0,
    failedTasks: 0,
    avgEffectiveness: 'unknown',
    lastTaskDate: null,
    commonFailurePatterns: [],
    strengths: ['Automated documentation creation and maintenance', 'API docs, inline comments, and ADR generation'],
    docTypesGenerated: {},
    docAccuracyScore: 0,
    domainBreakdown: [],
  },
  integrator: {
    totalTasks: 0,
    successfulTasks: 0,
    failedTasks: 0,
    avgEffectiveness: 'unknown',
    lastTaskDate: null,
    commonFailurePatterns: [],
    strengths: ['Wiring new files into project: barrel, DI, routes'],
    wiringErrorsFixed: 0,
    barrelFilesUpdated: 0,
    domainBreakdown: [],
  },
};

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
  handoffQualityScore: 0,
  evidenceComplianceRate: 0,
  avgEvidenceQualityPipeline: 0,
  evidenceStalenessScanEnabled: true,
};

// ─── YAML Parser (manual, no external deps) ──────────────────────────────────

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

    // Detect agent keys under "agents:"
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

      if (currentAgent) {
        // Domain breakdown detection
        const domainHeaderMatch = line.match(/^    domainBreakdown:/);
        if (domainHeaderMatch) {
          continue;
        }
        const domainItemMatch = line.match(/^      - domain:\s*"(.+)"$/);
        if (domainItemMatch) {
          // Start a new domain entry
          if (!result.agents[currentAgent].domainBreakdown) {
            result.agents[currentAgent].domainBreakdown = [];
          }
          const domainEntry: any = { domain: domainItemMatch[1] };
          result.agents[currentAgent].domainBreakdown.push(domainEntry);
          continue;
        }
        // Domain breakdown sub-fields
        if (result.agents[currentAgent].domainBreakdown) {
          const entries = result.agents[currentAgent].domainBreakdown;
          const last = entries[entries.length - 1];
          if (last) {
            const domainFieldMatch = line.match(/^        (\w[\w]*):\s*(.*)$/);
            if (domainFieldMatch) {
              const val = parseValue(domainFieldMatch[2].trim());
              if (domainFieldMatch[1] === 'commonFailurePatterns') {
                if (!Array.isArray(last.commonFailurePatterns)) {
                  last.commonFailurePatterns = [];
                }
              } else {
                last[domainFieldMatch[1]] = val;
              }
              continue;
            }
            // Domain failure pattern items
            const domainArrayMatch = line.match(/^          -\s*(.*)$/);
            if (domainArrayMatch && last.commonFailurePatterns) {
              last.commonFailurePatterns.push(domainArrayMatch[1].replace(/^"(.*)"$/, '$1'));
              continue;
            }
          }
        }

        // Evidence metrics object detection
        const evidenceMetricsHeaderMatch = line.match(/^    evidenceMetrics:/);
        if (evidenceMetricsHeaderMatch) {
          continue;
        }

        // Evidence metrics sub-fields
        if (currentAgent && result.agents[currentAgent]) {
          const evidenceFieldMatch = line.match(/^      (\w[\w]*):\s*(.*)$/);
          if (evidenceFieldMatch && result.agents[currentAgent].evidenceMetrics === undefined) {
            // This might be an evidenceMetrics field — only capture if inside evidenceMetrics block
            // We track this via a flag, but for simplicity check if previous line was evidenceMetrics
            // Actually, let's handle it in the generic propMatch below
          }
        }

        const propMatch = line.match(/^    (\w[\w]*):\s*(.*)$/);
        if (propMatch) {
          const key = propMatch[1];
          const rawValue = propMatch[2].trim();
          if (key === 'strengths' || key === 'commonFailurePatterns') {
            if (rawValue === '[]' || rawValue === '') {
              result.agents[currentAgent][key] = [];
            }
            continue;
          }
          if (key === 'docTypesGenerated') {
            if (rawValue === '{}' || rawValue === '') {
              result.agents[currentAgent][key] = {};
            } else {
              if (!result.agents[currentAgent][key]) {
                result.agents[currentAgent][key] = {};
              }
            }
            continue;
          }
          if (key === 'evidenceMetrics') {
            if (rawValue === '{}' || rawValue === '' || rawValue === '~') {
              // empty object, but we want it to be present
              if (!result.agents[currentAgent][key]) {
                result.agents[currentAgent][key] = {};
              }
            }
            continue;
          }
          result.agents[currentAgent][key] = parseValue(rawValue);
          continue;
        }

        // Evidence metrics sub-fields (6-space indent)
        const evidenceSubFieldMatch = line.match(/^      (\w[\w]*):\s*(.*)$/);
        if (evidenceSubFieldMatch && result.agents[currentAgent]) {
          const agentObj = result.agents[currentAgent];
          if (agentObj.evidenceMetrics && typeof agentObj.evidenceMetrics === 'object') {
            agentObj.evidenceMetrics[evidenceSubFieldMatch[1]] = parseValue(evidenceSubFieldMatch[2].trim());
            continue;
          }
        }

        // Array items
        const arrayItemMatch = line.match(/^      -\s*(.*)$/);
        if (arrayItemMatch) {
          const item = arrayItemMatch[1].replace(/^"(.*)"$/, '$1').trim();
          if (item) currentArray.push(item);
          continue;
        }
      }
    }

    // Parse orchestrator properties
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
            if (!result.orchestrator[key]) {
              result.orchestrator[key] = {};
            }
          }
          continue;
        }
        result.orchestrator[key] = parseValue(rawValue);
        continue;
      }

      const subPropMatch = line.match(/^    (\w[\w-]*):\s*(.*)$/);
      if (subPropMatch && result.orchestrator && typeof result.orchestrator.pipelineSelectionAccuracyByType === 'object') {
        result.orchestrator.pipelineSelectionAccuracyByType[subPropMatch[1]] = parseValue(subPropMatch[2].trim());
        continue;
      }

      const arrayItemMatch = line.match(/^    -\s*(.*)$/);
      if (arrayItemMatch && result.orchestrator) {
        if (!result.orchestrator.commonSelectionErrors) {
          result.orchestrator.commonSelectionErrors = [];
        }
        result.orchestrator.commonSelectionErrors.push(arrayItemMatch[1].replace(/^"(.*)"$/, '$1').trim());
      }
    }
  }

  // Flush last agent's arrays
  if (currentAgent && currentArray.length > 0 && currentSection === 'agents') {
    setNested(result, [currentSection, currentAgent, 'commonFailurePatterns'], [...currentArray]);
  }

  // Ensure nested arrays exist
  if (result.agents) {
    for (const agentKey of Object.keys(result.agents)) {
      if (!Array.isArray(result.agents[agentKey].commonFailurePatterns)) {
        result.agents[agentKey].commonFailurePatterns = [];
      }
      if (!Array.isArray(result.agents[agentKey].domainBreakdown)) {
        result.agents[agentKey].domainBreakdown = [];
      }
    }
  }

  return result;
}

function parseValue(raw: string): any {
  if (raw === 'null' || raw === '~') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const num = Number(raw);
  if (!isNaN(num) && raw !== '') return num;
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

// ─── YAML Serializer ─────────────────────────────────────────────────────────

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
    if (agent.commonFailurePatterns.length > 0) {
      lines.push(`    commonFailurePatterns:`);
      for (const pattern of agent.commonFailurePatterns) {
        lines.push(`      - "${pattern}"`);
      }
    } else {
      lines.push(`    commonFailurePatterns: []`);
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
    if (agent.acceptanceCriteriaPerPlan !== undefined) {
      lines.push(`    acceptanceCriteriaPerPlan: ${agent.acceptanceCriteriaPerPlan}`);
    }
    if (agent.wiringErrorsFixed !== undefined) {
      lines.push(`    wiringErrorsFixed: ${agent.wiringErrorsFixed}`);
    }
    if (agent.barrelFilesUpdated !== undefined) {
      lines.push(`    barrelFilesUpdated: ${agent.barrelFilesUpdated}`);
    }
    if (agent.docTypesGenerated && Object.keys(agent.docTypesGenerated).length > 0) {
      lines.push(`    docTypesGenerated:`);
      for (const [type, count] of Object.entries(agent.docTypesGenerated)) {
        lines.push(`      ${type}: ${count}`);
      }
    }
    if (agent.docAccuracyScore !== undefined) {
      lines.push(`    docAccuracyScore: ${agent.docAccuracyScore}`);
    }
    // Domain breakdown (NEW)
    if (agent.domainBreakdown && agent.domainBreakdown.length > 0) {
      lines.push(`    domainBreakdown:`);
      for (const domain of agent.domainBreakdown) {
        lines.push(`      - domain: "${domain.domain}"`);
        lines.push(`        totalTasks: ${domain.totalTasks}`);
        lines.push(`        successfulTasks: ${domain.successfulTasks}`);
        lines.push(`        failedTasks: ${domain.failedTasks}`);
        lines.push(`        avgEffectiveness: "${domain.avgEffectiveness}"`);
        if (domain.commonFailurePatterns.length > 0) {
          lines.push(`        commonFailurePatterns:`);
          for (const p of domain.commonFailurePatterns) {
            lines.push(`          - "${p}"`);
          }
        } else {
          lines.push(`        commonFailurePatterns: []`);
        }
      }
    }
    // NEW: Evidence metrics
    if (agent.evidenceMetrics !== undefined) {
      lines.push(`    evidenceMetrics:`);
      lines.push(`      avgEvidenceQuality: ${agent.evidenceMetrics.avgEvidenceQuality}`);
      lines.push(`      evidenceComplianceRate: ${agent.evidenceMetrics.evidenceComplianceRate}`);
      lines.push(`      citationPrecision: ${agent.evidenceMetrics.citationPrecision}`);
      lines.push(`      stalenessRate: ${agent.evidenceMetrics.stalenessRate}`);
      lines.push(`      lastEvidenceScore: ${agent.evidenceMetrics.lastEvidenceScore}`);
      lines.push(`      evidenceCount: ${agent.evidenceMetrics.evidenceCount}`);
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
  lines.push(`  handoffQualityScore: ${orch.handoffQualityScore}`);
  lines.push(`  evidenceComplianceRate: ${orch.evidenceComplianceRate}`);
  lines.push(`  avgEvidenceQualityPipeline: ${orch.avgEvidenceQualityPipeline}`);
  lines.push(`  evidenceStalenessScanEnabled: ${orch.evidenceStalenessScanEnabled}`);

  lines.push('');
  return lines.join('\n');
}

// ─── File Path Resolution ────────────────────────────────────────────────────

function getCalibrationPath(): string {
  const scriptDir = __dirname;
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
        // Deep merge domainBreakdown
        if (Array.isArray(existing.domainBreakdown)) {
          if (!data.agents[key].domainBreakdown) {
            data.agents[key].domainBreakdown = [];
          }
          for (const domainEntry of existing.domainBreakdown) {
            data.agents[key].domainBreakdown.push({ ...domainEntry });
          }
          delete existing.domainBreakdown;
        }
        // Deep merge evidenceMetrics
        if (existing.evidenceMetrics && typeof existing.evidenceMetrics === 'object') {
          data.agents[key].evidenceMetrics = { ...existing.evidenceMetrics };
          delete existing.evidenceMetrics;
        }
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
    domain: null,
    handoffQuality: null,
    evidenceCompliance: null,
    // NEW: Evidence quality defaults
    evidenceQuality: null,
    citationPrecision: null,
    stalenessRate: null,
    evidenceCount: null,
    readEvidenceMetrics: args.includes('--read-evidence-metrics'),
    evidenceDashboard: args.includes('--evidence-dashboard'),
    evidenceQualityAvg: null,
    evidenceComplianceRate: null,
    evidenceStalenessScan: null,
  };

  for (const arg of args) {
    if (arg === '--read' || arg === '--read-evidence-metrics' || arg === '--evidence-dashboard') continue;
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
        if (isNaN(result.buildRetries!) || result.buildRetries! < 0) {
          console.error(`❌ --build-retries must be a non-negative integer, got "${value}"`);
          process.exit(1);
        }
        break;
      case '--lint-retries':
        result.lintRetries = parseInt(value, 10);
        if (isNaN(result.lintRetries!) || result.lintRetries! < 0) {
          console.error(`❌ --lint-retries must be a non-negative integer, got "${value}"`);
          process.exit(1);
        }
        break;
      case '--checkpoints':
        result.checkpoints = parseFloat(value);
        if (isNaN(result.checkpoints!) || result.checkpoints! < 0) {
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
        if (isNaN(result.pipelineDurationMin!) || result.pipelineDurationMin! < 0) {
          console.error(`❌ --pipeline-duration-min must be a non-negative number, got "${value}"`);
          process.exit(1);
        }
        break;
      case '--domain':
        result.domain = value;
        break;
      case '--handoff-quality':
        result.handoffQuality = parseInt(value, 10);
        if (isNaN(result.handoffQuality!) || result.handoffQuality! < 1 || result.handoffQuality! > 10) {
          console.error(`❌ --handoff-quality must be 1-10, got "${value}"`);
          process.exit(1);
        }
        break;
      case '--evidence-compliance':
        result.evidenceCompliance = parseInt(value, 10);
        if (isNaN(result.evidenceCompliance!) || result.evidenceCompliance! < 0 || result.evidenceCompliance! > 100) {
          console.error(`❌ --evidence-compliance must be 0-100, got "${value}"`);
          process.exit(1);
        }
        break;
      // NEW: Evidence quality flags
      case '--evidence-quality':
        result.evidenceQuality = parseInt(value, 10);
        if (isNaN(result.evidenceQuality!) || result.evidenceQuality! < 0 || result.evidenceQuality! > 100) {
          console.error(`❌ --evidence-quality must be 0-100, got "${value}"`);
          process.exit(1);
        }
        break;
      case '--citation-precision':
        result.citationPrecision = parseInt(value, 10);
        if (isNaN(result.citationPrecision!) || result.citationPrecision! < 0 || result.citationPrecision! > 100) {
          console.error(`❌ --citation-precision must be 0-100, got "${value}"`);
          process.exit(1);
        }
        break;
      case '--staleness-rate':
        result.stalenessRate = parseInt(value, 10);
        if (isNaN(result.stalenessRate!) || result.stalenessRate! < 0 || result.stalenessRate! > 100) {
          console.error(`❌ --staleness-rate must be 0-100, got "${value}"`);
          process.exit(1);
        }
        break;
      case '--evidence-count':
        result.evidenceCount = parseInt(value, 10);
        if (isNaN(result.evidenceCount!) || result.evidenceCount! < 0) {
          console.error(`❌ --evidence-count must be a non-negative integer, got "${value}"`);
          process.exit(1);
        }
        break;
      case '--evidence-quality-avg':
        result.evidenceQualityAvg = parseInt(value, 10);
        if (isNaN(result.evidenceQualityAvg!) || result.evidenceQualityAvg! < 0 || result.evidenceQualityAvg! > 100) {
          console.error(`❌ --evidence-quality-avg must be 0-100, got "${value}"`);
          process.exit(1);
        }
        break;
      case '--evidence-compliance-rate':
        result.evidenceComplianceRate = parseInt(value, 10);
        if (isNaN(result.evidenceComplianceRate!) || result.evidenceComplianceRate! < 0 || result.evidenceComplianceRate! > 100) {
          console.error(`❌ --evidence-compliance-rate must be 0-100, got "${value}"`);
          process.exit(1);
        }
        break;
      case '--evidence-staleness-scan':
        if (value !== 'true' && value !== 'false') {
          console.error(`❌ --evidence-staleness-scan must be "true" or "false", got "${value}"`);
          process.exit(1);
        }
        result.evidenceStalenessScan = value === 'true';
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

  const agentName: string = args.agent!;

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
      domainBreakdown: [],
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

  // Update domain-specific breakdown (NEW)
  if (args.domain) {
    if (!agent.domainBreakdown) {
      agent.domainBreakdown = [];
    }
    let domainEntry = agent.domainBreakdown!.find((d: DomainBreakdown) => d.domain === args.domain);
    if (!domainEntry) {
      domainEntry = {
        domain: args.domain,
        totalTasks: 0,
        successfulTasks: 0,
        failedTasks: 0,
        avgEffectiveness: 'unknown',
        commonFailurePatterns: [],
      };
      agent.domainBreakdown.push(domainEntry);
    }
    domainEntry.totalTasks += 1;
    if (args.success === true) {
      domainEntry.successfulTasks += 1;
    } else if (args.success === false) {
      domainEntry.failedTasks += 1;
    }
    // Update domain effectiveness
    const domainSuccessRate = domainEntry.totalTasks > 0
      ? (domainEntry.successfulTasks / domainEntry.totalTasks)
      : 0;
    if (domainSuccessRate >= 0.8) domainEntry.avgEffectiveness = 'good';
    else if (domainSuccessRate >= 0.5) domainEntry.avgEffectiveness = 'ok';
    else domainEntry.avgEffectiveness = 'poor';

    // Add domain-specific failure pattern
    if (args.failurePattern) {
      if (!domainEntry.commonFailurePatterns.includes(args.failurePattern)) {
        domainEntry.commonFailurePatterns.push(args.failurePattern);
      }
    }

    console.log(`📊 Domain Calibration Updated: ${agentName} / ${args.domain}`);
    console.log(`  totalTasks: ${domainEntry.totalTasks}`);
    console.log(`  successRate: ${domainEntry.totalTasks > 0 ? ((domainEntry.successfulTasks / domainEntry.totalTasks) * 100).toFixed(1) : '0.0'}%`);
    console.log(`  effectiveness: ${domainEntry.avgEffectiveness}`);
  }

  // Update effectiveness
  if (args.effectiveness !== null) {
    agent.avgEffectiveness = args.effectiveness;
  }

  // Append failure pattern
  if (args.failurePattern !== null) {
    if (!agent.commonFailurePatterns.includes(args.failurePattern)) {
      agent.commonFailurePatterns.push(args.failurePattern);
    }
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

  // NEW: Update evidence metrics
  const hasEvidenceUpdate = args.evidenceQuality !== null ||
    args.evidenceCompliance !== null ||
    args.citationPrecision !== null ||
    args.stalenessRate !== null ||
    args.evidenceCount !== null;

  if (hasEvidenceUpdate) {
    if (!agent.evidenceMetrics) {
      agent.evidenceMetrics = {
        avgEvidenceQuality: 0,
        evidenceComplianceRate: 0,
        citationPrecision: 0,
        stalenessRate: 0,
        lastEvidenceScore: 0,
        evidenceCount: 0,
      };
    }

    const em = agent.evidenceMetrics;

    if (args.evidenceQuality !== null) {
      em.avgEvidenceQuality = args.evidenceQuality;
    }
    if (args.evidenceCompliance !== null) {
      em.evidenceComplianceRate = args.evidenceCompliance;
    }
    if (args.citationPrecision !== null) {
      em.citationPrecision = args.citationPrecision;
    }
    if (args.stalenessRate !== null) {
      em.stalenessRate = args.stalenessRate;
    }
    if (args.evidenceCount !== null) {
      // Compute weighted average for quality based on count
      const oldCount = em.evidenceCount;
      const newCount = args.evidenceCount;
      if (oldCount > 0 && newCount > oldCount) {
        // Weighted average merge for existing metrics when count increases
        const addedCount = newCount - oldCount;
        if (args.evidenceQuality !== null) {
          em.avgEvidenceQuality = Math.round(
            ((em.avgEvidenceQuality * oldCount) + (args.evidenceQuality * addedCount)) / newCount
          );
        }
        if (args.evidenceCompliance !== null) {
          em.evidenceComplianceRate = Math.round(
            ((em.evidenceComplianceRate * oldCount) + (args.evidenceCompliance * addedCount)) / newCount
          );
        }
        if (args.citationPrecision !== null) {
          em.citationPrecision = Math.round(
            ((em.citationPrecision * oldCount) + (args.citationPrecision * addedCount)) / newCount
          );
        }
        if (args.stalenessRate !== null) {
          em.stalenessRate = Math.round(
            ((em.stalenessRate * oldCount) + (args.stalenessRate * addedCount)) / newCount
          );
        }
      }
      em.evidenceCount = newCount;
    }

    // Recompute lastEvidenceScore as weighted composite
    if (em.evidenceCount > 0) {
      em.lastEvidenceScore = Math.round(
        (em.avgEvidenceQuality * 0.35) +
        (em.evidenceComplianceRate * 0.30) +
        (em.citationPrecision * 0.25) -
        (em.stalenessRate * 0.10)
      );
      // Clamp to 0-100
      if (em.lastEvidenceScore < 0) em.lastEvidenceScore = 0;
      if (em.lastEvidenceScore > 100) em.lastEvidenceScore = 100;
    }

    console.log(`📊 Evidence Metrics Updated: ${agentName}`);
    console.log(`  avgEvidenceQuality: ${em.avgEvidenceQuality}%`);
    console.log(`  evidenceComplianceRate: ${em.evidenceComplianceRate}%`);
    console.log(`  citationPrecision: ${em.citationPrecision}%`);
    console.log(`  stalenessRate: ${em.stalenessRate}%`);
    console.log(`  lastEvidenceScore: ${em.lastEvidenceScore}`);
    console.log(`  evidenceCount: ${em.evidenceCount}`);
  }

  agent.lastTaskDate = new Date().toISOString();

  const successRate = agent.totalTasks > 0
    ? ((agent.successfulTasks / agent.totalTasks) * 100).toFixed(1)
    : '0.0';

  console.log(`📊 Calibration Updated: ${agentName}`);
  console.log(`  totalTasks: ${oldTotal} → ${agent.totalTasks}`);
  console.log(`  successfulTasks: ${oldSuccess} → ${agent.successfulTasks}`);
  console.log(`  failedTasks: ${oldFailed} → ${agent.failedTasks}`);
  console.log(`  successRate: ${successRate}%`);
  console.log(`  lastTaskDate: ${agent.lastTaskDate}`);
  if (args.domain) {
    console.log(`  domain: ${args.domain}`);
  }
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

  // Recalculate accuracy
  if (args.success !== null) {
    const total = data.orchestrator.totalPipelines;
    const correct = data.orchestrator.successfulPipelines;
    data.orchestrator.pipelineSelectionAccuracy = total > 0
      ? Math.round((correct / total) * 1000) / 10
      : 0.0;
  }

  // Update per-type accuracy
  if (args.taskType !== null && args.success !== null) {
    const existingAccuracy = data.orchestrator.pipelineSelectionAccuracyByType[args.taskType];
    if (existingAccuracy === undefined) {
      data.orchestrator.pipelineSelectionAccuracyByType[args.taskType] = args.success ? 100 : 0;
    } else {
      const correctCount = args.success ? 1 : 0;
      data.orchestrator.pipelineSelectionAccuracyByType[args.taskType] = Math.round(
        (existingAccuracy + (correctCount * 100)) / 2
      );
    }
  }

  // Update avgPipelineDuration
  if (args.pipelineDurationMin !== null) {
    const oldDuration = data.orchestrator.avgPipelineDuration;
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

  // NEW: Update handoffQualityScore (running average)
  if (args.handoffQuality !== null) {
    const completedBefore = data.orchestrator.totalPipelines - 1;
    if (completedBefore > 0) {
      data.orchestrator.handoffQualityScore = Math.round(
        ((data.orchestrator.handoffQualityScore * completedBefore) + args.handoffQuality) / data.orchestrator.totalPipelines
      );
    } else {
      data.orchestrator.handoffQualityScore = args.handoffQuality;
    }
  }

  // NEW: Update evidenceComplianceRate (running average)
  if (args.evidenceCompliance !== null) {
    const completedBefore = data.orchestrator.totalPipelines - 1;
    if (completedBefore > 0) {
      data.orchestrator.evidenceComplianceRate = Math.round(
        ((data.orchestrator.evidenceComplianceRate * completedBefore) + args.evidenceCompliance) / data.orchestrator.totalPipelines
      );
    } else {
      data.orchestrator.evidenceComplianceRate = args.evidenceCompliance;
    }
  }

  // NEW: Update avgEvidenceQualityPipeline (running average)
  if (args.evidenceQualityAvg !== null) {
    const completedBefore = data.orchestrator.totalPipelines - 1;
    if (completedBefore > 0) {
      data.orchestrator.avgEvidenceQualityPipeline = Math.round(
        ((data.orchestrator.avgEvidenceQualityPipeline * completedBefore) + args.evidenceQualityAvg) / data.orchestrator.totalPipelines
      );
    } else {
      data.orchestrator.avgEvidenceQualityPipeline = args.evidenceQualityAvg;
    }
  }

  // NEW: Update evidenceStalenessScanEnabled
  if (args.evidenceStalenessScan !== null) {
    data.orchestrator.evidenceStalenessScanEnabled = args.evidenceStalenessScan;
  }

  // NEW: Update evidenceComplianceRate from evidence-compliance-rate flag too
  if (args.evidenceComplianceRate !== null) {
    data.orchestrator.evidenceComplianceRate = args.evidenceComplianceRate;
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
  if (args.handoffQuality !== null) {
    console.log(`  handoffQualityScore: ${data.orchestrator.handoffQualityScore}/10`);
  }
  if (args.evidenceCompliance !== null) {
    console.log(`  evidenceComplianceRate: ${data.orchestrator.evidenceComplianceRate}%`);
  }
  if (args.evidenceQualityAvg !== null) {
    console.log(`  avgEvidenceQualityPipeline: ${data.orchestrator.avgEvidenceQualityPipeline}%`);
  }
  if (args.evidenceStalenessScan !== null) {
    console.log(`  evidenceStalenessScanEnabled: ${data.orchestrator.evidenceStalenessScanEnabled}`);
  }
  console.log(`  lastPipelineDate: ${data.orchestrator.lastPipelineDate}`);
}

// ─── Read Mode ───────────────────────────────────────────────────────────────

function printReadReport(data: CalibrationData, args: CliArgs): void {
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

    // Filter by domain if specified
    if (args.domain && agent.domainBreakdown) {
      const domainEntry = agent.domainBreakdown.find(d => d.domain === args.domain);
      if (domainEntry) {
        const domainSuccessRate = domainEntry.totalTasks > 0
          ? ((domainEntry.successfulTasks / domainEntry.totalTasks) * 100).toFixed(1)
          : 'N/A';
        console.log(`  ${key} [domain: ${args.domain}]:`);
        console.log(`    totalTasks: ${domainEntry.totalTasks}`);
        console.log(`    successRate: ${domainSuccessRate}%`);
        console.log(`    effectiveness: ${domainEntry.avgEffectiveness}`);
        if (domainEntry.commonFailurePatterns.length > 0) {
          console.log(`    failurePatterns:`);
          for (const p of domainEntry.commonFailurePatterns) {
            console.log(`      - "${p}"`);
          }
        }
        const domainFailRate = domainEntry.totalTasks > 0 && (domainEntry.failedTasks / domainEntry.totalTasks) > 0.33;
        if (domainFailRate) {
          console.log(`    ⚠️  HIGH FAILURE RATE (>33%) in domain ${args.domain}`);
        }
        console.log('');
        continue;
      }
      // Domain filter specified but no match — skip this agent
      continue;
    }

    // Normal (non-domain-filtered) output
    console.log(`  ${key}:`);
    console.log(`    totalTasks: ${agent.totalTasks}`);
    console.log(`    successRate: ${successRate}%`);
    console.log(`    failureRate: ${failureRate}%`);
    console.log(`    effectiveness: ${agent.avgEffectiveness}`);

    if (agent.commonFailurePatterns.length > 0) {
      console.log(`    topFailurePatterns:`);
      const topPatterns = agent.commonFailurePatterns.slice(0, 3);
      for (const pattern of topPatterns) {
        console.log(`      - "${pattern}"`);
      }
    } else {
      console.log(`    commonFailurePatterns: (none)`);
    }

    // Show domain breakdown summary
    if (agent.domainBreakdown && agent.domainBreakdown.length > 0) {
      console.log(`    domainBreakdown:`);
      for (const domain of agent.domainBreakdown) {
        const dsr = domain.totalTasks > 0
          ? ((domain.successfulTasks / domain.totalTasks) * 100).toFixed(1)
          : 'N/A';
        console.log(`      ${domain.domain}: ${dsr}% (${domain.totalTasks} tasks, ${domain.avgEffectiveness})`);
      }
    }

    // Show evidence metrics summary
    if (agent.evidenceMetrics) {
      const em = agent.evidenceMetrics;
      console.log(`    evidenceMetrics:`);
      console.log(`      avgEvidenceQuality: ${em.avgEvidenceQuality}%`);
      console.log(`      evidenceComplianceRate: ${em.evidenceComplianceRate}%`);
      console.log(`      citationPrecision: ${em.citationPrecision}%`);
      console.log(`      stalenessRate: ${em.stalenessRate}%`);
      console.log(`      lastEvidenceScore: ${em.lastEvidenceScore}`);
      console.log(`      evidenceCount: ${em.evidenceCount}`);
    }

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
  console.log(`    handoffQualityScore: ${orch.handoffQualityScore}/10`);
  console.log(`    evidenceComplianceRate: ${orch.evidenceComplianceRate}%`);
  console.log(`    avgEvidenceQualityPipeline: ${orch.avgEvidenceQualityPipeline}%`);
  console.log(`    evidenceStalenessScanEnabled: ${orch.evidenceStalenessScanEnabled}`);
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

// ─── Evidence Dashboard ──────────────────────────────────────────────────────

function printEvidenceDashboard(data: CalibrationData): void {
  const header = '📊 Evidence Quality Dashboard';
  const separator = '━'.repeat(header.length);
  console.log(header);
  console.log(separator);

  const colAgent = 'Agent';
  const colQuality = 'Quality';
  const colCompliance = 'Compliance';
  const colPrecision = 'Precision';
  const colStaleness = 'Staleness';

  const padRight = (s: string, len: number): string => s + ' '.repeat(Math.max(0, len - s.length));

  // Header row
  console.log(
    padRight(colAgent, 13) +
    padRight(colQuality, 10) +
    padRight(colCompliance, 13) +
    padRight(colPrecision, 12) +
    padRight(colStaleness, 12)
  );
  console.log('─'.repeat(60));

  let totalQuality = 0;
  let totalCompliance = 0;
  let totalPrecision = 0;
  let totalStaleness = 0;
  let agentsWithMetrics = 0;

  const agentKeys = Object.keys(data.agents).sort();
  for (const key of agentKeys) {
    const agent = data.agents[key];
    let quality: number | string = '—';
    let compliance: number | string = '—';
    let precision: number | string = '—';
    let staleness: number | string = '—';

    if (agent.evidenceMetrics) {
      const em = agent.evidenceMetrics;
      quality = `${em.avgEvidenceQuality}%`;
      compliance = `${em.evidenceComplianceRate}%`;
      precision = `${em.citationPrecision}%`;
      staleness = `${em.stalenessRate}%`;

      totalQuality += em.avgEvidenceQuality;
      totalCompliance += em.evidenceComplianceRate;
      totalPrecision += em.citationPrecision;
      totalStaleness += em.stalenessRate;
      agentsWithMetrics++;
    }

    console.log(
      padRight(key, 13) +
      padRight(String(quality), 10) +
      padRight(String(compliance), 13) +
      padRight(String(precision), 12) +
      padRight(String(staleness), 12)
    );
  }

  console.log('─'.repeat(60));

  // Overall row
  if (agentsWithMetrics > 0) {
    const avgQuality = (totalQuality / agentsWithMetrics).toFixed(1);
    const avgCompliance = (totalCompliance / agentsWithMetrics).toFixed(1);
    const avgPrecision = (totalPrecision / agentsWithMetrics).toFixed(1);
    const avgStaleness = (totalStaleness / agentsWithMetrics).toFixed(1);
    console.log(
      padRight('Overall', 13) +
      padRight(`${avgQuality}%`, 10) +
      padRight(`${avgCompliance}%`, 13) +
      padRight(`${avgPrecision}%`, 12) +
      padRight(`${avgStaleness}%`, 12)
    );
  } else {
    console.log(padRight('No evidence metrics recorded yet', 60));
  }

  // Orchestrator summary
  const orch = data.orchestrator;
  console.log('');
  console.log('  Orchestrator:');
  console.log(`    avgEvidenceQualityPipeline: ${orch.avgEvidenceQualityPipeline}%`);
  console.log(`    evidenceComplianceRate (orch): ${orch.evidenceComplianceRate}%`);
  console.log(`    evidenceStalenessScanEnabled: ${orch.evidenceStalenessScanEnabled}`);
}

// ─── Read Evidence Metrics ───────────────────────────────────────────────────

function printAgentEvidenceMetrics(data: CalibrationData, agentName: string): void {
  if (!data.agents[agentName]) {
    console.error(`❌ Agent "${agentName}" not found`);
    process.exit(1);
  }

  const agent = data.agents[agentName];
  const em = agent.evidenceMetrics;

  if (!em) {
    console.log(`📊 Evidence Metrics for "${agentName}":`);
    console.log('  (no evidence metrics recorded yet)');
    return;
  }

  console.log(`📊 Evidence Metrics for "${agentName}":`);
  console.log(`  avgEvidenceQuality: ${em.avgEvidenceQuality}%`);
  console.log(`  evidenceComplianceRate: ${em.evidenceComplianceRate}%`);
  console.log(`  citationPrecision: ${em.citationPrecision}%`);
  console.log(`  stalenessRate: ${em.stalenessRate}%`);
  console.log(`  lastEvidenceScore: ${em.lastEvidenceScore}`);
  console.log(`  evidenceCount: ${em.evidenceCount}`);

  // Warnings
  if (em.avgEvidenceQuality < 70) {
    console.log(`  ⚠️  Low evidence quality: ${em.avgEvidenceQuality}% (target: >= 70%)`);
  }
  if (em.evidenceComplianceRate < 80) {
    console.log(`  ⚠️  Low evidence compliance: ${em.evidenceComplianceRate}% (target: >= 80%)`);
  }
  if (em.citationPrecision < 50) {
    console.log(`  ⚠️  Low citation precision: ${em.citationPrecision}% (target: >= 50%)`);
  }
  if (em.stalenessRate > 20) {
    console.log(`  ⚠️  High staleness rate: ${em.stalenessRate}% (target: <= 20%)`);
  }

  // Comparison with overall averages
  console.log('');
  console.log('  Comparison vs overall averages:');

  let totalQuality = 0;
  let totalCompliance = 0;
  let totalPrecision = 0;
  let totalStaleness = 0;
  let agentCount = 0;

  for (const key of Object.keys(data.agents)) {
    const aem = data.agents[key].evidenceMetrics;
    if (aem) {
      totalQuality += aem.avgEvidenceQuality;
      totalCompliance += aem.evidenceComplianceRate;
      totalPrecision += aem.citationPrecision;
      totalStaleness += aem.stalenessRate;
      agentCount++;
    }
  }

  if (agentCount > 0) {
    const avgQuality = (totalQuality / agentCount).toFixed(1);
    const avgCompliance = (totalCompliance / agentCount).toFixed(1);
    const avgPrecision = (totalPrecision / agentCount).toFixed(1);
    const avgStaleness = (totalStaleness / agentCount).toFixed(1);

    const qDiff = (em.avgEvidenceQuality - parseFloat(avgQuality)).toFixed(1);
    const cDiff = (em.evidenceComplianceRate - parseFloat(avgCompliance)).toFixed(1);
    const pDiff = (em.citationPrecision - parseFloat(avgPrecision)).toFixed(1);
    const sDiff = (em.stalenessRate - parseFloat(avgStaleness)).toFixed(1);

    console.log(`    avgEvidenceQuality: ${em.avgEvidenceQuality}% (avg: ${avgQuality}%, diff: ${qDiff.startsWith('-') ? '' : '+'}${qDiff}pp)`);
    console.log(`    evidenceComplianceRate: ${em.evidenceComplianceRate}% (avg: ${avgCompliance}%, diff: ${cDiff.startsWith('-') ? '' : '+'}${cDiff}pp)`);
    console.log(`    citationPrecision: ${em.citationPrecision}% (avg: ${avgPrecision}%, diff: ${pDiff.startsWith('-') ? '' : '+'}${pDiff}pp)`);
    console.log(`    stalenessRate: ${em.stalenessRate}% (avg: ${avgStaleness}%, diff: ${sDiff.startsWith('-') ? '' : '+'}${sDiff}pp)`);
  } else {
    console.log('    (no other agents have evidence metrics for comparison)');
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs();

  // Route: --evidence-dashboard
  if (args.evidenceDashboard) {
    const filePath = getCalibrationPath();
    const data = readCalibration(filePath);
    printEvidenceDashboard(data);
    process.exit(0);
  }

  // Route: --read-evidence-metrics
  if (args.readEvidenceMetrics) {
    if (!args.agent) {
      console.error('❌ --agent is required with --read-evidence-metrics');
      process.exit(1);
    }
    const filePath = getCalibrationPath();
    const data = readCalibration(filePath);
    printAgentEvidenceMetrics(data, args.agent!);
    process.exit(0);
  }

  // Route: --read
  if (args.read) {
    const filePath = getCalibrationPath();
    const data = readCalibration(filePath);
    printReadReport(data, args);
    process.exit(0);
  }

  if (!args.agent) {
    console.error('❌ --agent is required (use --read to view without updating)');
    console.error('');
    console.error('Usage:');
    console.error('  ts-node update-calibration.ts --agent=<name> --success=true|false [options]');
    console.error('  ts-node update-calibration.ts --read [--domain=<domain-name>]');
    console.error('  ts-node update-calibration.ts --read-evidence-metrics --agent=<name>');
    console.error('  ts-node update-calibration.ts --evidence-dashboard');
    process.exit(1);
  }

  const filePath = getCalibrationPath();
  const data = readCalibration(filePath);
  updateAgent(data, args);
  writeCalibration(filePath, data);
}

main();
