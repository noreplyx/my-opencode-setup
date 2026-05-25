#!/usr/bin/env ts-node
/**
 * Tests for update-calibration.ts
 *
 * Tests: parseValue, createDefault, mergeWithDefaults, updateAgent,
 *        updateOrchestrator, parseYaml, serializeYaml
 */

import * as fs from 'fs';
import * as path from 'path';

const TEST_DIR = path.resolve(process.cwd(), 'tmp-test-calibration');

function setup() {
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  }
}

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

function assertEqual(actual: any, expected: any, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ─── Inlined functions from update-calibration.ts ───────────────────────────

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
  buildRetries?: number;
  lintRetries?: number;
  behavioralCheckpointsPerPlan?: number;
  domainBreakdown?: DomainBreakdown[];
  wiringErrorsFixed?: number;
  barrelFilesUpdated?: number;
  docTypesGenerated?: Record<string, number>;
  docAccuracyScore?: number;
  acceptanceCriteriaPerPlan?: number;
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
  handoffQualityScore: number;
  evidenceComplianceRate: number;
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

function parseValue(raw: string): any {
  if (raw === 'null' || raw === '~') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const num = Number(raw);
  if (!isNaN(num) && raw !== '') return num;
  const match = raw.match(/^"(.*)"$/);
  if (match) return match[1];
  const singleMatch = raw.match(/^'(.*)'$/);
  if (singleMatch) return singleMatch[1];
  return raw;
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

function updateAgent(data: CalibrationData, args: CliArgs): void {
  if (!args.agent) {
    throw new Error('--agent is required');
  }

  const agentName: string = args.agent!;

  if (agentName === 'orchestrator') {
    // Delegate to updateOrchestrator
    updateOrchestrator(data, args);
    return;
  }

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

  agent.totalTasks += 1;
  if (args.success === true) {
    agent.successfulTasks += 1;
  } else if (args.success === false) {
    agent.failedTasks += 1;
  }

  // Domain-specific breakdown
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
    const domainSuccessRate = domainEntry.totalTasks > 0
      ? (domainEntry.successfulTasks / domainEntry.totalTasks)
      : 0;
    if (domainSuccessRate >= 0.8) domainEntry.avgEffectiveness = 'good';
    else if (domainSuccessRate >= 0.5) domainEntry.avgEffectiveness = 'ok';
    else domainEntry.avgEffectiveness = 'poor';

    if (args.failurePattern) {
      if (!domainEntry.commonFailurePatterns.includes(args.failurePattern)) {
        domainEntry.commonFailurePatterns.push(args.failurePattern);
      }
    }
  }

  if (args.effectiveness !== null) {
    agent.avgEffectiveness = args.effectiveness;
  }

  if (args.failurePattern !== null) {
    if (!agent.commonFailurePatterns.includes(args.failurePattern)) {
      agent.commonFailurePatterns.push(args.failurePattern);
    }
  }

  if (agent.buildRetries !== undefined && args.buildRetries !== null) {
    agent.buildRetries = args.buildRetries;
  }
  if (agent.lintRetries !== undefined && args.lintRetries !== null) {
    agent.lintRetries = args.lintRetries;
  }
  if (agent.behavioralCheckpointsPerPlan !== undefined && args.checkpoints !== null) {
    agent.behavioralCheckpointsPerPlan = args.checkpoints;
  }

  agent.lastTaskDate = new Date().toISOString();
}

function updateOrchestrator(data: CalibrationData, args: CliArgs): void {
  data.orchestrator.totalPipelines += 1;
  if (args.success === true) {
    data.orchestrator.successfulPipelines += 1;
  } else if (args.success === false) {
    data.orchestrator.failedPipelines += 1;
  }

  if (args.success !== null) {
    const total = data.orchestrator.totalPipelines;
    const correct = data.orchestrator.successfulPipelines;
    data.orchestrator.pipelineSelectionAccuracy = total > 0
      ? Math.round((correct / total) * 1000) / 10
      : 0.0;
  }

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

  if (args.circuitBreakerActivation) {
    data.orchestrator.circuitBreakerActivations += 1;
  }

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

  if (args.evidenceStalenessScan !== null) {
    data.orchestrator.evidenceStalenessScanEnabled = args.evidenceStalenessScan;
  }

  if (args.evidenceComplianceRate !== null) {
    data.orchestrator.evidenceComplianceRate = args.evidenceComplianceRate;
  }

  if (args.failurePattern !== null) {
    data.orchestrator.commonSelectionErrors.push(args.failurePattern);
  }

  data.orchestrator.lastPipelineDate = new Date().toISOString();
}

function parseYaml(content: string): any {
  const result: any = {};
  const lines = content.split('\n');
  let currentSection: string | null = null;
  let currentAgent: string | null = null;
  let currentArray: string[] = [];

  function setNested(obj: any, keys: string[], value: any): void {
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) current[keys[i]] = {};
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

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
        const domainHeaderMatch = line.match(/^    domainBreakdown:/);
        if (domainHeaderMatch) {
          continue;
        }
        const domainItemMatch = line.match(/^      - domain:\s*"(.+)"$/);
        if (domainItemMatch) {
          if (!result.agents[currentAgent].domainBreakdown) {
            result.agents[currentAgent].domainBreakdown = [];
          }
          const domainEntry: any = { domain: domainItemMatch[1] };
          result.agents[currentAgent].domainBreakdown.push(domainEntry);
          continue;
        }
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
            const domainArrayMatch = line.match(/^          -\s*(.*)$/);
            if (domainArrayMatch && last.commonFailurePatterns) {
              last.commonFailurePatterns.push(domainArrayMatch[1].replace(/^"(.*)"$/, '$1'));
              continue;
            }
          }
        }

        const evidenceMetricsHeaderMatch = line.match(/^    evidenceMetrics:/);
        if (evidenceMetricsHeaderMatch) {
          if (!result.agents[currentAgent].evidenceMetrics) {
            result.agents[currentAgent].evidenceMetrics = {};
          }
          continue;
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
              if (!result.agents[currentAgent][key]) {
                result.agents[currentAgent][key] = {};
              }
            }
            continue;
          }
          result.agents[currentAgent][key] = parseValue(rawValue);
          continue;
        }

        const evidenceSubFieldMatch = line.match(/^      (\w[\w]*):\s*(.*)$/);
        if (evidenceSubFieldMatch && result.agents[currentAgent]) {
          const agentObj = result.agents[currentAgent];
          if (agentObj.evidenceMetrics && typeof agentObj.evidenceMetrics === 'object') {
            agentObj.evidenceMetrics[evidenceSubFieldMatch[1]] = parseValue(evidenceSubFieldMatch[2].trim());
            continue;
          }
        }

        const arrayItemMatch = line.match(/^      -\s*(.*)$/);
        if (arrayItemMatch) {
          const item = arrayItemMatch[1].replace(/^"(.*)"$/, '$1').trim();
          if (item) currentArray.push(item);
          continue;
        }
      }
    }

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

  if (currentAgent && currentArray.length > 0 && currentSection === 'agents') {
    setNested(result, [currentSection, currentAgent, 'commonFailurePatterns'], [...currentArray]);
  }

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

// ── Tests ──

async function main() {
  console.log('🔍 update-calibration.ts Tests');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  setup();

  // ── Test 1: parseValue() type coercion ──
  test('parseValue: true boolean', () => {
    assertEqual(parseValue('true'), true, 'true -> true');
  });

  test('parseValue: false boolean', () => {
    assertEqual(parseValue('false'), false, 'false -> false');
  });

  test('parseValue: integer', () => {
    assertEqual(parseValue('42'), 42, '42 -> 42');
  });

  test('parseValue: float', () => {
    assertEqual(parseValue('3.14'), 3.14, '3.14 -> 3.14');
  });

  test('parseValue: null literal', () => {
    assertEqual(parseValue('null'), null, 'null -> null');
  });

  test('parseValue: tilde null', () => {
    assertEqual(parseValue('~'), null, '~ -> null');
  });

  test('parseValue: double-quoted string', () => {
    assertEqual(parseValue('"hello"'), 'hello', '"hello" -> hello');
  });

  test('parseValue: single-quoted string', () => {
    assertEqual(parseValue("'world'"), 'world', "'world' -> world");
  });

  test('parseValue: plain string', () => {
    assertEqual(parseValue('plain'), 'plain', 'plain -> plain');
  });

  test('parseValue: empty string', () => {
    // empty string is not a number, so returns raw
    assertEqual(parseValue(''), '', '"" -> ""');
  });

  // ── Test 2: VALID_EFFECTIVENESS set ──
  test('VALID_EFFECTIVENESS contains good', () => {
    assert(VALID_EFFECTIVENESS.has('good'), 'good should be valid');
  });

  test('VALID_EFFECTIVENESS contains ok', () => {
    assert(VALID_EFFECTIVENESS.has('ok'), 'ok should be valid');
  });

  test('VALID_EFFECTIVENESS contains poor', () => {
    assert(VALID_EFFECTIVENESS.has('poor'), 'poor should be valid');
  });

  test('VALID_EFFECTIVENESS contains unknown', () => {
    assert(VALID_EFFECTIVENESS.has('unknown'), 'unknown should be valid');
  });

  test('VALID_EFFECTIVENESS rejects invalid', () => {
    assert(!VALID_EFFECTIVENESS.has('excellent'), 'excellent should not be valid');
    assert(!VALID_EFFECTIVENESS.has(''), 'empty string should not be valid');
  });

  // ── Test 3: createDefault() ──
  test('createDefault returns CalibrationData with agents and orchestrator', () => {
    const data = createDefault();
    assert(data.agents !== undefined, 'agents should exist');
    assert(data.orchestrator !== undefined, 'orchestrator should exist');
  });

  test('createDefault: all default agents exist', () => {
    const data = createDefault();
    const expectedAgents = ['finder', 'implementor', 'mergeCoordinator', 'plandescriber', 'fixer', 'qa', 'verifier', 'browserTester', 'documentor', 'integrator'];
    for (const name of expectedAgents) {
      assert(data.agents[name] !== undefined, `agent ${name} should exist`);
    }
  });

  test('createDefault: each agent has zero counters', () => {
    const data = createDefault();
    for (const [name, agent] of Object.entries(data.agents)) {
      assertEqual(agent.totalTasks, 0, `${name}.totalTasks should be 0`);
      assertEqual(agent.successfulTasks, 0, `${name}.successfulTasks should be 0`);
      assertEqual(agent.failedTasks, 0, `${name}.failedTasks should be 0`);
    }
  });

  test('createDefault: orchestrator has zero pipelines', () => {
    const data = createDefault();
    assertEqual(data.orchestrator.totalPipelines, 0, 'totalPipelines should be 0');
    assertEqual(data.orchestrator.successfulPipelines, 0, 'successfulPipelines should be 0');
    assertEqual(data.orchestrator.failedPipelines, 0, 'failedPipelines should be 0');
    assertEqual(data.orchestrator.handoffQualityScore, 0, 'handoffQualityScore should be 0');
    assertEqual(data.orchestrator.evidenceStalenessScanEnabled, true, 'evidenceStalenessScanEnabled should be true');
  });

  test('createDefault: agents have domainBreakdown arrays', () => {
    const data = createDefault();
    for (const [name, agent] of Object.entries(data.agents)) {
      assert(Array.isArray(agent.domainBreakdown), `${name}.domainBreakdown should be an array`);
    }
  });

  // ── Test 4: mergeWithDefaults() ──
  test('mergeWithDefaults preserves existing agent data', () => {
    const parsed = {
      agents: {
        implementor: {
          totalTasks: 5,
          successfulTasks: 3,
          failedTasks: 2,
          avgEffectiveness: 'good',
          lastTaskDate: '2026-05-25T00:00:00.000Z',
        },
      },
    };
    const merged = mergeWithDefaults(parsed);
    assertEqual(merged.agents.implementor.totalTasks, 5, 'totalTasks preserved');
    assertEqual(merged.agents.implementor.successfulTasks, 3, 'successfulTasks preserved');
    assertEqual(merged.agents.implementor.failedTasks, 2, 'failedTasks preserved');
    assertEqual(merged.agents.implementor.avgEffectiveness, 'good', 'avgEffectiveness preserved');
  });

  test('mergeWithDefaults adds missing default fields', () => {
    const parsed = {
      agents: {
        implementor: {
          totalTasks: 5,
          successfulTasks: 3,
          failedTasks: 2,
          avgEffectiveness: 'good',
          lastTaskDate: null,
        },
      },
    };
    const merged = mergeWithDefaults(parsed);
    assert(Array.isArray(merged.agents.implementor.strengths), 'strengths should be an array');
    assert(Array.isArray(merged.agents.implementor.commonFailurePatterns), 'commonFailurePatterns should be an array');
    assertEqual(merged.agents.implementor.buildRetries, 0, 'buildRetries default should be 0');
    assertEqual(merged.agents.implementor.lintRetries, 0, 'lintRetries default should be 0');
  });

  test('mergeWithDefaults preserves domainBreakdown arrays', () => {
    const parsed = {
      agents: {
        implementor: {
          totalTasks: 2,
          successfulTasks: 1,
          failedTasks: 1,
          avgEffectiveness: 'ok',
          lastTaskDate: null,
          domainBreakdown: [
            { domain: 'frontend', totalTasks: 2, successfulTasks: 1, failedTasks: 1, avgEffectiveness: 'ok', commonFailurePatterns: ['test error'] },
          ],
        },
      },
    };
    const merged = mergeWithDefaults(parsed);
    assert(Array.isArray(merged.agents.implementor.domainBreakdown), 'domainBreakdown should be an array');
    assertEqual(merged.agents.implementor.domainBreakdown!.length, 1, 'should have 1 domain entry');
    assertEqual(merged.agents.implementor.domainBreakdown![0].domain, 'frontend', 'domain name preserved');
    assertEqual(merged.agents.implementor.domainBreakdown![0].totalTasks, 2, 'domain totalTasks preserved');
    assertEqual(merged.agents.implementor.domainBreakdown![0].commonFailurePatterns[0], 'test error', 'failure pattern preserved');
  });

  test('mergeWithDefaults preserves evidenceMetrics', () => {
    const parsed = {
      agents: {
        implementor: {
          totalTasks: 1,
          successfulTasks: 1,
          failedTasks: 0,
          avgEffectiveness: 'good',
          lastTaskDate: null,
          evidenceMetrics: {
            avgEvidenceQuality: 85,
            evidenceComplianceRate: 90,
            citationPrecision: 75,
            stalenessRate: 10,
            lastEvidenceScore: 80,
            evidenceCount: 10,
          },
        },
      },
    };
    const merged = mergeWithDefaults(parsed);
    assert(merged.agents.implementor.evidenceMetrics !== undefined, 'evidenceMetrics should exist');
    assertEqual(merged.agents.implementor.evidenceMetrics!.avgEvidenceQuality, 85, 'avgEvidenceQuality preserved');
    assertEqual(merged.agents.implementor.evidenceMetrics!.evidenceCount, 10, 'evidenceCount preserved');
  });

  test('mergeWithDefaults merges orchestrator data', () => {
    const parsed = {
      orchestrator: {
        totalPipelines: 10,
        successfulPipelines: 7,
        failedPipelines: 3,
        pipelineSelectionAccuracy: 70,
      },
    };
    const merged = mergeWithDefaults(parsed);
    assertEqual(merged.orchestrator.totalPipelines, 10, 'totalPipelines preserved');
    assertEqual(merged.orchestrator.pipelineSelectionAccuracy, 70, 'pipelineSelectionAccuracy preserved');
    assertEqual(merged.orchestrator.handoffQualityScore, 0, 'handoffQualityScore default preserved');
    assertEqual(merged.orchestrator.evidenceStalenessScanEnabled, true, 'evidenceStalenessScanEnabled default preserved');
  });

  // ── Test 5: updateAgent() counter incrementing ──
  test('updateAgent: totalTasks increments by 1', () => {
    const data = createDefault();
    const args: CliArgs = {
      read: false,
      agent: 'finder',
      success: true,
      effectiveness: null,
      failurePattern: null,
      buildRetries: null,
      lintRetries: null,
      checkpoints: null,
      taskType: null,
      pipelineDurationMin: null,
      circuitBreakerActivation: false,
      domain: null,
      handoffQuality: null,
      evidenceCompliance: null,
      evidenceQuality: null,
      citationPrecision: null,
      stalenessRate: null,
      evidenceCount: null,
      readEvidenceMetrics: false,
      evidenceDashboard: false,
      evidenceQualityAvg: null,
      evidenceComplianceRate: null,
      evidenceStalenessScan: null,
    };
    updateAgent(data, args);
    assertEqual(data.agents.finder.totalTasks, 1, 'totalTasks should be 1');
    assertEqual(data.agents.finder.successfulTasks, 1, 'successfulTasks should be 1');
    assertEqual(data.agents.finder.failedTasks, 0, 'failedTasks should be 0');
  });

  test('updateAgent: failedTasks increments when success=false', () => {
    const data = createDefault();
    const args: CliArgs = {
      read: false,
      agent: 'finder',
      success: false,
      effectiveness: null,
      failurePattern: null,
      buildRetries: null,
      lintRetries: null,
      checkpoints: null,
      taskType: null,
      pipelineDurationMin: null,
      circuitBreakerActivation: false,
      domain: null,
      handoffQuality: null,
      evidenceCompliance: null,
      evidenceQuality: null,
      citationPrecision: null,
      stalenessRate: null,
      evidenceCount: null,
      readEvidenceMetrics: false,
      evidenceDashboard: false,
      evidenceQualityAvg: null,
      evidenceComplianceRate: null,
      evidenceStalenessScan: null,
    };
    updateAgent(data, args);
    assertEqual(data.agents.finder.totalTasks, 1, 'totalTasks should be 1');
    assertEqual(data.agents.finder.successfulTasks, 0, 'successfulTasks should be 0');
    assertEqual(data.agents.finder.failedTasks, 1, 'failedTasks should be 1');
  });

  test('updateAgent: appends failure patterns', () => {
    const data = createDefault();
    const args: CliArgs = {
      read: false,
      agent: 'finder',
      success: false,
      effectiveness: null,
      failurePattern: 'timeout error',
      buildRetries: null,
      lintRetries: null,
      checkpoints: null,
      taskType: null,
      pipelineDurationMin: null,
      circuitBreakerActivation: false,
      domain: null,
      handoffQuality: null,
      evidenceCompliance: null,
      evidenceQuality: null,
      citationPrecision: null,
      stalenessRate: null,
      evidenceCount: null,
      readEvidenceMetrics: false,
      evidenceDashboard: false,
      evidenceQualityAvg: null,
      evidenceComplianceRate: null,
      evidenceStalenessScan: null,
    };
    updateAgent(data, args);
    assertEqual(data.agents.finder.commonFailurePatterns.length, 1, 'should have 1 failure pattern');
    assertEqual(data.agents.finder.commonFailurePatterns[0], 'timeout error', 'failure pattern should match');
  });

  test('updateAgent: updates lastTaskDate to ISO string', () => {
    const data = createDefault();
    const args: CliArgs = {
      read: false,
      agent: 'finder',
      success: true,
      effectiveness: null,
      failurePattern: null,
      buildRetries: null,
      lintRetries: null,
      checkpoints: null,
      taskType: null,
      pipelineDurationMin: null,
      circuitBreakerActivation: false,
      domain: null,
      handoffQuality: null,
      evidenceCompliance: null,
      evidenceQuality: null,
      citationPrecision: null,
      stalenessRate: null,
      evidenceCount: null,
      readEvidenceMetrics: false,
      evidenceDashboard: false,
      evidenceQualityAvg: null,
      evidenceComplianceRate: null,
      evidenceStalenessScan: null,
    };
    updateAgent(data, args);
    assert(data.agents.finder.lastTaskDate !== null, 'lastTaskDate should not be null');
    assert(data.agents.finder.lastTaskDate!.endsWith('Z') || data.agents.finder.lastTaskDate!.includes('T'),
      'lastTaskDate should be ISO format');
  });

  test('updateAgent: deduplicates failure patterns', () => {
    const data = createDefault();
    const args1: CliArgs = {
      read: false,
      agent: 'finder',
      success: false,
      effectiveness: null,
      failurePattern: 'same error',
      buildRetries: null,
      lintRetries: null,
      checkpoints: null,
      taskType: null,
      pipelineDurationMin: null,
      circuitBreakerActivation: false,
      domain: null,
      handoffQuality: null,
      evidenceCompliance: null,
      evidenceQuality: null,
      citationPrecision: null,
      stalenessRate: null,
      evidenceCount: null,
      readEvidenceMetrics: false,
      evidenceDashboard: false,
      evidenceQualityAvg: null,
      evidenceComplianceRate: null,
      evidenceStalenessScan: null,
    };
    const args2: CliArgs = { ...args1 };
    updateAgent(data, args1);
    updateAgent(data, args2);
    assertEqual(data.agents.finder.commonFailurePatterns.length, 1, 'should deduplicate failure patterns');
  });

  // ── Test 6: updateAgent() with domain tracking ──
  test('updateAgent with domain: creates new domain entries', () => {
    const data = createDefault();
    const args: CliArgs = {
      read: false,
      agent: 'finder',
      success: true,
      effectiveness: null,
      failurePattern: null,
      buildRetries: null,
      lintRetries: null,
      checkpoints: null,
      taskType: null,
      pipelineDurationMin: null,
      circuitBreakerActivation: false,
      domain: 'frontend',
      handoffQuality: null,
      evidenceCompliance: null,
      evidenceQuality: null,
      citationPrecision: null,
      stalenessRate: null,
      evidenceCount: null,
      readEvidenceMetrics: false,
      evidenceDashboard: false,
      evidenceQualityAvg: null,
      evidenceComplianceRate: null,
      evidenceStalenessScan: null,
    };
    updateAgent(data, args);
    assert(Array.isArray(data.agents.finder.domainBreakdown), 'domainBreakdown should be an array');
    assertEqual(data.agents.finder.domainBreakdown!.length, 1, 'should have 1 domain entry');
    assertEqual(data.agents.finder.domainBreakdown![0].domain, 'frontend', 'domain name should match');
    assertEqual(data.agents.finder.domainBreakdown![0].totalTasks, 1, 'domain totalTasks should be 1');
    assertEqual(data.agents.finder.domainBreakdown![0].successfulTasks, 1, 'domain successfulTasks should be 1');
  });

  test('updateAgent with domain: increments domain counters on second call', () => {
    const data = createDefault();
    const args: CliArgs = {
      read: false,
      agent: 'finder',
      success: true,
      effectiveness: null,
      failurePattern: null,
      buildRetries: null,
      lintRetries: null,
      checkpoints: null,
      taskType: null,
      pipelineDurationMin: null,
      circuitBreakerActivation: false,
      domain: 'frontend',
      handoffQuality: null,
      evidenceCompliance: null,
      evidenceQuality: null,
      citationPrecision: null,
      stalenessRate: null,
      evidenceCount: null,
      readEvidenceMetrics: false,
      evidenceDashboard: false,
      evidenceQualityAvg: null,
      evidenceComplianceRate: null,
      evidenceStalenessScan: null,
    };
    updateAgent(data, args);
    updateAgent(data, args);
    assertEqual(data.agents.finder.domainBreakdown![0].totalTasks, 2, 'domain totalTasks should be 2');
    assertEqual(data.agents.finder.domainBreakdown![0].successfulTasks, 2, 'domain successfulTasks should be 2');
  });

  test('updateAgent with domain: calculates avgEffectiveness from success rate (good)', () => {
    const data = createDefault();
    for (let i = 0; i < 8; i++) {
      const args: CliArgs = {
        read: false,
        agent: 'finder',
        success: true,
        effectiveness: null,
        failurePattern: null,
        buildRetries: null,
        lintRetries: null,
        checkpoints: null,
        taskType: null,
        pipelineDurationMin: null,
        circuitBreakerActivation: false,
        domain: 'frontend',
        handoffQuality: null,
        evidenceCompliance: null,
        evidenceQuality: null,
        citationPrecision: null,
        stalenessRate: null,
        evidenceCount: null,
        readEvidenceMetrics: false,
        evidenceDashboard: false,
        evidenceQualityAvg: null,
        evidenceComplianceRate: null,
        evidenceStalenessScan: null,
      };
      updateAgent(data, args);
    }
    // 8/8 = 100% >= 80% -> 'good'
    assertEqual(data.agents.finder.domainBreakdown![0].avgEffectiveness, 'good', '100% success -> good');
  });

  test('updateAgent with domain: calculates avgEffectiveness (ok)', () => {
    const data = createDefault();
    // 6 success, 4 failure = 60% -> between 50% and 80% -> 'ok'
    for (let i = 0; i < 6; i++) {
      const args: CliArgs = {
        read: false,
        agent: 'finder',
        success: true,
        effectiveness: null,
        failurePattern: null,
        buildRetries: null,
        lintRetries: null,
        checkpoints: null,
        taskType: null,
        pipelineDurationMin: null,
        circuitBreakerActivation: false,
        domain: 'backend',
        handoffQuality: null,
        evidenceCompliance: null,
        evidenceQuality: null,
        citationPrecision: null,
        stalenessRate: null,
        evidenceCount: null,
        readEvidenceMetrics: false,
        evidenceDashboard: false,
        evidenceQualityAvg: null,
        evidenceComplianceRate: null,
        evidenceStalenessScan: null,
      };
      updateAgent(data, args);
    }
    for (let i = 0; i < 4; i++) {
      const args: CliArgs = {
        read: false,
        agent: 'finder',
        success: false,
        effectiveness: null,
        failurePattern: null,
        buildRetries: null,
        lintRetries: null,
        checkpoints: null,
        taskType: null,
        pipelineDurationMin: null,
        circuitBreakerActivation: false,
        domain: 'backend',
        handoffQuality: null,
        evidenceCompliance: null,
        evidenceQuality: null,
        citationPrecision: null,
        stalenessRate: null,
        evidenceCount: null,
        readEvidenceMetrics: false,
        evidenceDashboard: false,
        evidenceQualityAvg: null,
        evidenceComplianceRate: null,
        evidenceStalenessScan: null,
      };
      updateAgent(data, args);
    }
    assertEqual(data.agents.finder.domainBreakdown![0].avgEffectiveness, 'ok', '60% -> ok');
  });

  test('updateAgent with domain: calculates avgEffectiveness (poor)', () => {
    const data = createDefault();
    // 1 success, 9 failure = 10% -> < 50% -> 'poor'
    for (let i = 0; i < 1; i++) {
      const args: CliArgs = {
        read: false,
        agent: 'finder',
        success: true,
        effectiveness: null,
        failurePattern: null,
        buildRetries: null,
        lintRetries: null,
        checkpoints: null,
        taskType: null,
        pipelineDurationMin: null,
        circuitBreakerActivation: false,
        domain: 'testing',
        handoffQuality: null,
        evidenceCompliance: null,
        evidenceQuality: null,
        citationPrecision: null,
        stalenessRate: null,
        evidenceCount: null,
        readEvidenceMetrics: false,
        evidenceDashboard: false,
        evidenceQualityAvg: null,
        evidenceComplianceRate: null,
        evidenceStalenessScan: null,
      };
      updateAgent(data, args);
    }
    for (let i = 0; i < 9; i++) {
      const args: CliArgs = {
        read: false,
        agent: 'finder',
        success: false,
        effectiveness: null,
        failurePattern: null,
        buildRetries: null,
        lintRetries: null,
        checkpoints: null,
        taskType: null,
        pipelineDurationMin: null,
        circuitBreakerActivation: false,
        domain: 'testing',
        handoffQuality: null,
        evidenceCompliance: null,
        evidenceQuality: null,
        citationPrecision: null,
        stalenessRate: null,
        evidenceCount: null,
        readEvidenceMetrics: false,
        evidenceDashboard: false,
        evidenceQualityAvg: null,
        evidenceComplianceRate: null,
        evidenceStalenessScan: null,
      };
      updateAgent(data, args);
    }
    assertEqual(data.agents.finder.domainBreakdown![0].avgEffectiveness, 'poor', '10% -> poor');
  });

  // ── Test 7: updateOrchestrator() ──
  test('updateOrchestrator: totalPipelines increments by 1', () => {
    const data = createDefault();
    const args: CliArgs = {
      read: false,
      agent: 'orchestrator',
      success: true,
      effectiveness: null,
      failurePattern: null,
      buildRetries: null,
      lintRetries: null,
      checkpoints: null,
      taskType: null,
      pipelineDurationMin: null,
      circuitBreakerActivation: false,
      domain: null,
      handoffQuality: null,
      evidenceCompliance: null,
      evidenceQuality: null,
      citationPrecision: null,
      stalenessRate: null,
      evidenceCount: null,
      readEvidenceMetrics: false,
      evidenceDashboard: false,
      evidenceQualityAvg: null,
      evidenceComplianceRate: null,
      evidenceStalenessScan: null,
    };
    updateOrchestrator(data, args);
    assertEqual(data.orchestrator.totalPipelines, 1, 'totalPipelines should be 1');
  });

  test('updateOrchestrator: pipelineSelectionAccuracy recalculates', () => {
    const data = createDefault();
    const args1: CliArgs = {
      read: false,
      agent: 'orchestrator',
      success: true,
      effectiveness: null,
      failurePattern: null,
      buildRetries: null,
      lintRetries: null,
      checkpoints: null,
      taskType: null,
      pipelineDurationMin: null,
      circuitBreakerActivation: false,
      domain: null,
      handoffQuality: null,
      evidenceCompliance: null,
      evidenceQuality: null,
      citationPrecision: null,
      stalenessRate: null,
      evidenceCount: null,
      readEvidenceMetrics: false,
      evidenceDashboard: false,
      evidenceQualityAvg: null,
      evidenceComplianceRate: null,
      evidenceStalenessScan: null,
    };
    const args2: CliArgs = { ...args1, success: false };
    updateOrchestrator(data, args1);
    // 1/1 = 100%
    assertEqual(data.orchestrator.pipelineSelectionAccuracy, 100, '1/1 success -> 100%');
    updateOrchestrator(data, args2);
    // 1/2 = 50%
    assertEqual(data.orchestrator.pipelineSelectionAccuracy, 50, '1/2 success -> 50%');
  });

  test('updateOrchestrator: avgPipelineDuration running average', () => {
    const data = createDefault();
    const args1: CliArgs = {
      read: false,
      agent: 'orchestrator',
      success: true,
      effectiveness: null,
      failurePattern: null,
      buildRetries: null,
      lintRetries: null,
      checkpoints: null,
      taskType: null,
      pipelineDurationMin: 10,
      circuitBreakerActivation: false,
      domain: null,
      handoffQuality: null,
      evidenceCompliance: null,
      evidenceQuality: null,
      citationPrecision: null,
      stalenessRate: null,
      evidenceCount: null,
      readEvidenceMetrics: false,
      evidenceDashboard: false,
      evidenceQualityAvg: null,
      evidenceComplianceRate: null,
      evidenceStalenessScan: null,
    };
    const args2: CliArgs = { ...args1, pipelineDurationMin: 20 };
    updateOrchestrator(data, args1);
    assertEqual(data.orchestrator.avgPipelineDuration, 10, 'first pipeline duration = 10');
    updateOrchestrator(data, args2);
    // ((10 * 1) + 20) / 2 = 15
    assertEqual(data.orchestrator.avgPipelineDuration, 15, 'running avg of 10 and 20 = 15');
  });

  test('updateOrchestrator: circuitBreakerActivations increments', () => {
    const data = createDefault();
    const args: CliArgs = {
      read: false,
      agent: 'orchestrator',
      success: true,
      effectiveness: null,
      failurePattern: null,
      buildRetries: null,
      lintRetries: null,
      checkpoints: null,
      taskType: null,
      pipelineDurationMin: null,
      circuitBreakerActivation: true,
      domain: null,
      handoffQuality: null,
      evidenceCompliance: null,
      evidenceQuality: null,
      citationPrecision: null,
      stalenessRate: null,
      evidenceCount: null,
      readEvidenceMetrics: false,
      evidenceDashboard: false,
      evidenceQualityAvg: null,
      evidenceComplianceRate: null,
      evidenceStalenessScan: null,
    };
    updateOrchestrator(data, args);
    assertEqual(data.orchestrator.circuitBreakerActivations, 1, 'should be 1');
    updateOrchestrator(data, args);
    assertEqual(data.orchestrator.circuitBreakerActivations, 2, 'should be 2');
  });

  test('updateOrchestrator: handoffQualityScore running average', () => {
    const data = createDefault();
    const args1: CliArgs = {
      read: false,
      agent: 'orchestrator',
      success: true,
      effectiveness: null,
      failurePattern: null,
      buildRetries: null,
      lintRetries: null,
      checkpoints: null,
      taskType: null,
      pipelineDurationMin: null,
      circuitBreakerActivation: false,
      domain: null,
      handoffQuality: 8,
      evidenceCompliance: null,
      evidenceQuality: null,
      citationPrecision: null,
      stalenessRate: null,
      evidenceCount: null,
      readEvidenceMetrics: false,
      evidenceDashboard: false,
      evidenceQualityAvg: null,
      evidenceComplianceRate: null,
      evidenceStalenessScan: null,
    };
    const args2: CliArgs = { ...args1, handoffQuality: 4 };
    updateOrchestrator(data, args1);
    assertEqual(data.orchestrator.handoffQualityScore, 8, 'first handoff = 8');
    updateOrchestrator(data, args2);
    // ((8 * 1) + 4) / 2 = 6
    assertEqual(data.orchestrator.handoffQualityScore, 6, 'running avg of 8 and 4 = 6');
  });

  test('updateOrchestrator: pipelineSelectionAccuracyByType initial', () => {
    const data = createDefault();
    const args: CliArgs = {
      read: false,
      agent: 'orchestrator',
      success: true,
      effectiveness: null,
      failurePattern: null,
      buildRetries: null,
      lintRetries: null,
      checkpoints: null,
      taskType: 'full',
      pipelineDurationMin: null,
      circuitBreakerActivation: false,
      domain: null,
      handoffQuality: null,
      evidenceCompliance: null,
      evidenceQuality: null,
      citationPrecision: null,
      stalenessRate: null,
      evidenceCount: null,
      readEvidenceMetrics: false,
      evidenceDashboard: false,
      evidenceQualityAvg: null,
      evidenceComplianceRate: null,
      evidenceStalenessScan: null,
    };
    updateOrchestrator(data, args);
    assertEqual(data.orchestrator.pipelineSelectionAccuracyByType['full'], 100, 'initial full accuracy = 100');
  });

  // ── Test 8: parseYaml() ──
  test('parseYaml: parses simple agent entries with properties', () => {
    const yaml = `agents:
  finder:
    totalTasks: 5
    successfulTasks: 3
    failedTasks: 2
    avgEffectiveness: "good"
    lastTaskDate: null
    commonFailurePatterns: []
    strengths:
      - "Codebase exploration"
orchestrator:
  totalPipelines: 1
  successfulPipelines: 1
  failedPipelines: 0
  pipelineSelectionAccuracy: 100
  pipelineSelectionAccuracyByType:
    {}
  lastPipelineDate: null
  commonSelectionErrors: []
  circuitBreakerActivations: 0
  avgPipelineDuration: 0
  handoffQualityScore: 0
  evidenceComplianceRate: 0
  avgEvidenceQualityPipeline: 0
  evidenceStalenessScanEnabled: true
`;
    const result = parseYaml(yaml);
    assert(result.agents !== undefined, 'agents section should exist');
    assert(result.agents.finder !== undefined, 'finder agent should exist');
    assertEqual(result.agents.finder.totalTasks, 5, 'totalTasks should be 5');
    assertEqual(result.agents.finder.successfulTasks, 3, 'successfulTasks should be 3');
    assertEqual(result.agents.finder.failedTasks, 2, 'failedTasks should be 2');
    assertEqual(result.agents.finder.avgEffectiveness, 'good', 'avgEffectiveness should be good');
    assert(result.orchestrator !== undefined, 'orchestrator should exist');
    assertEqual(result.orchestrator.totalPipelines, 1, 'totalPipelines should be 1');
  });

  test('parseYaml: parses domainBreakdown arrays', () => {
    const yaml = `agents:
  implementor:
    totalTasks: 2
    successfulTasks: 1
    failedTasks: 1
    avgEffectiveness: "ok"
    lastTaskDate: null
    commonFailurePatterns: []
    domainBreakdown:
      - domain: "frontend"
        totalTasks: 2
        successfulTasks: 1
        failedTasks: 1
        avgEffectiveness: "ok"
        commonFailurePatterns:
          - "build fail"
    strengths: []
orchestrator:
  totalPipelines: 0
  successfulPipelines: 0
  failedPipelines: 0
  pipelineSelectionAccuracy: 0
  pipelineSelectionAccuracyByType:
    {}
  lastPipelineDate: null
  commonSelectionErrors: []
  circuitBreakerActivations: 0
  avgPipelineDuration: 0
  handoffQualityScore: 0
  evidenceComplianceRate: 0
  avgEvidenceQualityPipeline: 0
  evidenceStalenessScanEnabled: true
`;
    const result = parseYaml(yaml);
    assert(Array.isArray(result.agents.implementor.domainBreakdown), 'domainBreakdown should be array');
    assertEqual(result.agents.implementor.domainBreakdown.length, 1, 'should have 1 domain entry');
    assertEqual(result.agents.implementor.domainBreakdown[0].domain, 'frontend', 'domain name should match');
    assertEqual(result.agents.implementor.domainBreakdown[0].totalTasks, 2, 'domain totalTasks should be 2');
    assertEqual(result.agents.implementor.domainBreakdown[0].commonFailurePatterns[0], 'build fail', 'failure pattern should match');
  });

  test('parseYaml: parses evidenceMetrics objects', () => {
    const yaml = `agents:
  implementor:
    totalTasks: 1
    successfulTasks: 1
    failedTasks: 0
    avgEffectiveness: "good"
    lastTaskDate: null
    commonFailurePatterns: []
    evidenceMetrics:
      avgEvidenceQuality: 90
      evidenceComplianceRate: 85
      citationPrecision: 80
      stalenessRate: 5
      lastEvidenceScore: 82
      evidenceCount: 15
    strengths: []
orchestrator:
  totalPipelines: 0
  successfulPipelines: 0
  failedPipelines: 0
  pipelineSelectionAccuracy: 0
  pipelineSelectionAccuracyByType:
    {}
  lastPipelineDate: null
  commonSelectionErrors: []
  circuitBreakerActivations: 0
  avgPipelineDuration: 0
  handoffQualityScore: 0
  evidenceComplianceRate: 0
  avgEvidenceQualityPipeline: 0
  evidenceStalenessScanEnabled: true
`;
    const result = parseYaml(yaml);
    assert(result.agents.implementor.evidenceMetrics !== undefined, 'evidenceMetrics should exist');
    assertEqual(result.agents.implementor.evidenceMetrics.avgEvidenceQuality, 90, 'avgEvidenceQuality should be 90');
    assertEqual(result.agents.implementor.evidenceMetrics.evidenceCount, 15, 'evidenceCount should be 15');
    assertEqual(result.agents.implementor.evidenceMetrics.lastEvidenceScore, 82, 'lastEvidenceScore should be 82');
  });

  test('parseYaml: parses orchestrator section with pipelineSelectionAccuracyByType', () => {
    const yaml = `agents:
  finder:
    totalTasks: 0
    successfulTasks: 0
    failedTasks: 0
    avgEffectiveness: "unknown"
    lastTaskDate: null
    commonFailurePatterns: []
    strengths:
      - "test"
orchestrator:
  totalPipelines: 5
  successfulPipelines: 3
  failedPipelines: 2
  pipelineSelectionAccuracy: 60
  pipelineSelectionAccuracyByType:
    full: 80
    quick: 50
  lastPipelineDate: "2026-05-25T00:00:00.000Z"
  commonSelectionErrors: []
  circuitBreakerActivations: 1
  avgPipelineDuration: 12
  handoffQualityScore: 7
  evidenceComplianceRate: 85
  avgEvidenceQualityPipeline: 75
  evidenceStalenessScanEnabled: true
`;
    const result = parseYaml(yaml);
    assertEqual(result.orchestrator.totalPipelines, 5, 'totalPipelines should be 5');
    assertEqual(result.orchestrator.pipelineSelectionAccuracy, 60, 'accuracy should be 60');
    assertEqual(result.orchestrator.pipelineSelectionAccuracyByType['full'], 80, 'full accuracy should be 80');
    assertEqual(result.orchestrator.pipelineSelectionAccuracyByType['quick'], 50, 'quick accuracy should be 50');
    assertEqual(result.orchestrator.avgPipelineDuration, 12, 'avgPipelineDuration should be 12');
  });

  // ── Test 9: serializeYaml() format validation ──
  test('serializeYaml: produces valid YAML with agent data', () => {
    const original = createDefault();
    // Add some realistic data
    original.agents.finder.totalTasks = 10;
    original.agents.finder.successfulTasks = 7;
    original.agents.finder.failedTasks = 3;
    original.agents.finder.avgEffectiveness = 'good';
    original.agents.finder.commonFailurePatterns = ['timeout', 'network error'];
    original.agents.finder.lastTaskDate = '2026-05-25T00:00:00.000Z';
    original.agents.finder.domainBreakdown = [
      { domain: 'frontend', totalTasks: 6, successfulTasks: 4, failedTasks: 2, avgEffectiveness: 'ok', commonFailurePatterns: ['timeout'] },
    ];
    original.agents.finder.evidenceMetrics = {
      avgEvidenceQuality: 80,
      evidenceComplianceRate: 90,
      citationPrecision: 75,
      stalenessRate: 10,
      lastEvidenceScore: 78,
      evidenceCount: 20,
    };
    original.orchestrator.totalPipelines = 5;
    original.orchestrator.successfulPipelines = 4;
    original.orchestrator.failedPipelines = 1;
    original.orchestrator.pipelineSelectionAccuracy = 80;
    original.orchestrator.pipelineSelectionAccuracyByType = { full: 80, quick: 100 };
    original.orchestrator.avgPipelineDuration = 15;
    original.orchestrator.circuitBreakerActivations = 2;
    original.orchestrator.handoffQualityScore = 7;
    original.orchestrator.lastPipelineDate = '2026-05-25T00:00:00.000Z';

    const yaml = serializeYaml(original);

    // Verify YAML contains expected sections and keys
    assert(yaml.includes('agents:'), 'YAML should contain agents section');
    assert(yaml.includes('  finder:'), 'YAML should finder agent');
    assert(yaml.includes('    totalTasks: 10'), 'YAML should contain totalTasks: 10');
    assert(yaml.includes('    commonFailurePatterns:'), 'YAML should contain failure patterns section');
    assert(yaml.includes('      - "timeout"'), 'YAML should contain timeout pattern');
    assert(yaml.includes('      - "network error"'), 'YAML should contain network error pattern');
    assert(yaml.includes('    domainBreakdown:'), 'YAML should contain domainBreakdown section');
    assert(yaml.includes('      - domain: "frontend"'), 'YAML should contain domain entry');
    assert(yaml.includes('    evidenceMetrics:'), 'YAML should contain evidenceMetrics section');
    assert(yaml.includes('      avgEvidenceQuality: 80'), 'YAML should contain avgEvidenceQuality');
    assert(yaml.includes('      evidenceCount: 20'), 'YAML should contain evidenceCount');
    assert(yaml.includes('      - "timeout"'), 'YAML should contain domain timeout pattern');
    assert(yaml.includes('orchestrator:'), 'YAML should contain orchestrator section');
    assert(yaml.includes('  totalPipelines: 5'), 'YAML should contain totalPipelines: 5');
    assert(yaml.includes('  pipelineSelectionAccuracy: 80'), 'YAML should contain accuracy: 80');
    assert(yaml.includes('  circuitBreakerActivations: 2'), 'YAML should contain CB activations: 2');

    // Verify YAML is parseable
    const reparsed = parseYaml(yaml);
    assert(reparsed.agents !== undefined, 'parsed YAML should have agents');
    assert(reparsed.agents.finder !== undefined, 'parsed YAML should have finder');
    assertEqual(reparsed.agents.finder.totalTasks, 10, 'parse of serialized YAML: totalTasks');
    assertEqual(reparsed.agents.finder.avgEffectiveness, 'good', 'parse of serialized YAML: avgEffectiveness');
    assertEqual(reparsed.agents.finder.domainBreakdown.length, 1, 'parse of serialized YAML: domain entries count');
    assert(reparsed.agents.finder.domainBreakdown[0].domain === 'frontend', 'parse of serialized YAML: domain name');
    assert(reparsed.agents.finder.evidenceMetrics !== undefined, 'parse of serialized YAML: evidenceMetrics exists');
    assertEqual(reparsed.orchestrator.totalPipelines, 5, 'parse of serialized YAML: totalPipelines');
    assertEqual(reparsed.orchestrator.pipelineSelectionAccuracy, 80, 'parse of serialized YAML: accuracy');
  });

  test('serializeYaml: default data produces parseable YAML with agent names', () => {
    const original = createDefault();
    const yaml = serializeYaml(original);

    // Verify YAML contains expected default agent names
    assert(yaml.includes('agents:'), 'YAML should contain agents section');
    assert(yaml.includes('  finder:'), 'YAML should contain finder agent');
    assert(yaml.includes('  implementor:'), 'YAML should contain implementor agent');
    assert(yaml.includes('  mergeCoordinator:'), 'YAML should contain mergeCoordinator agent');
    assert(yaml.includes('  plandescriber:'), 'YAML should contain plandescriber agent');
    assert(yaml.includes('  fixer:'), 'YAML should contain fixer agent');
    assert(yaml.includes('  qa:'), 'YAML should contain qa agent');
    assert(yaml.includes('  verifier:'), 'YAML should contain verifier agent');
    assert(yaml.includes('  browserTester:'), 'YAML should contain browserTester agent');
    assert(yaml.includes('  documentor:'), 'YAML should contain documentor agent');
    assert(yaml.includes('  integrator:'), 'YAML should contain integrator agent');
    assert(yaml.includes('orchestrator:'), 'YAML should contain orchestrator section');

    // Verify default values
    assert(yaml.includes('    totalTasks: 0'), 'YAML should contain totalTasks: 0');
    assert(yaml.includes('    avgEffectiveness: "unknown"'), 'YAML should contain unknown effectiveness');
    assert(yaml.includes('    commonFailurePatterns: []'), 'YAML should contain empty failure patterns');

    // Verify YAML can be parsed without errors
    const reparsed = parseYaml(yaml);
    assert(reparsed.agents !== undefined, 'parsed YAML should have agents');
    assert(reparsed.agents.finder !== undefined, 'parsed YAML should have finder');
    assertEqual(reparsed.agents.finder.totalTasks, 0, 'parse of serialized YAML: totalTasks');
    assertEqual(reparsed.agents.finder.avgEffectiveness, 'unknown', 'parse of serialized YAML: avgEffectiveness');
    assertEqual(reparsed.orchestrator.evidenceStalenessScanEnabled, true, 'parse of serialized YAML: evidenceStalenessScanEnabled');
    assertEqual(reparsed.orchestrator.avgEvidenceQualityPipeline, 0, 'parse of serialized YAML: avgEvidenceQualityPipeline');
  });

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

  cleanup();

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(`  ❌ Test suite error: ${err.message}`);
  process.exit(1);
});
