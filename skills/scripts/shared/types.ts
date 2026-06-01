#!/usr/bin/env node
/**
 * Shared TypeScript types for orchestration scripts and shared-agent-workflow.
 *
 * This file is referenced by:
 *   - skills/scripts/orchestration/*.ts (orchestration pipeline tools)
 *   - skills/scripts/code-philosophy/*.ts (security scanners)
 *   - skills/shared-agent-workflow/SKILL.md (output contract format reference)
 *
 * IMPORTANT: If you add or modify a type here, also update the corresponding
 * agent instruction files in agents/subagent/ and skills SKILL.md files
 * to keep the output contract documentation in sync.
 */

// =============================================================================
// Generic / Shared
// =============================================================================

/**
 * Standardized structured output format for ALL orchestration subagents.
 * Every agent MUST return this structure at the top of its response as YAML frontmatter.
 *
 * @see skills/shared-agent-workflow/SKILL.md — Part A: YAML Frontmatter
 */
export interface AgentOutputContract {
  status: 'completed' | 'failed' | 'partial';
  resultSummary: string;
  agentOutputs: Record<string, AgentOutputEntry>;
  decisions?: Array<{
    what: string;
    why: string;
    by_who: string;
  }>;
  warnings?: string[];
  changedFiles: string[];
  artifacts: string[];
  errors?: Array<{
    category: string;
    message: string;
    source: string;
    recoverable: boolean;
    details?: Record<string, unknown>;
  }>;
  reproduction?: ReproductionCommand;
  checkpoint?: CheckpointRequest;
  errorReproduction?: ErrorReproductionPacket;
  dryRun?: DryRunManifest;
}

export interface AgentOutputEntry {
  status: 'completed' | 'failed' | 'partial';
  resultSummary: string;
  buildPassed?: boolean | null;
  lintPassed?: boolean | null;
  buildOutput?: string;
  lintOutput?: string;
}

// =============================================================================
// Reproduction / Error / Dry-Run
// =============================================================================

export interface ReproductionCommand {
  command: string;
  expectedExitCode: number;
  actualExitCode: number;
  expectedOutput?: string;
  actualOutputSnippet?: string;
  environment?: {
    nodeVersion?: string;
    dependencies?: string[];
  };
}

export interface ErrorReproductionPacket {
  pipelineId: string;
  failedStep: string;
  feature: string;
  attemptNumber: number;
  symptom: string;
  reproduction: ReproductionCommand;
  inputState: {
    files: string[];
    gitHeadSha: string;
    uncommittedChanges: boolean;
  };
  environment: {
    nodeVersion: string;
    os: string;
    workspaceHash: string;
  };
  context: {
    planCheckpointsAtFailure: string[];
    priorAgentResults: Array<{
      step: string;
      result: string;
    }>;
  };
}

export interface DryRunManifest {
  enabled: boolean;
  wouldCreate: string[];
  wouldModify: string[];
  wouldDelete: string[];
  estimatedLOC: number;
  planAdherence: number;
  risks: string[];
  diffPreview: string;
}

export interface CheckpointRequest {
  create: boolean;
  message: string;
  changedFiles: string[];
}

// =============================================================================
// Agent-Specific Output Contracts
// =============================================================================

// ── Finder ──────────────────────────────────────────────────────────────────

export interface FinderOutput extends AgentOutputContract {
  explorationCache?: {
    used: boolean;
    lastCommitSha: string;
  };
}

// ── PlanDescriber ───────────────────────────────────────────────────────────

export interface PlanDescriberOutput extends AgentOutputContract {
  manifestPath: string;
  manifestVersion: number;
  phases: number;
  estimatedEffort: string;
  riskLevel: 'low' | 'medium' | 'high';
}

// ── Implementor ─────────────────────────────────────────────────────────────

export interface ImplementorOutput extends AgentOutputContract {
  selfReview: {
    confidence: number;
    securityItemsPassed: number;
    securityItemsTotal: number;
    securitySelfReviewPassed: boolean;
    preCheckPassed: boolean;
    wiringManifest: string[];
  };
  securitySelfReview: SecuritySelfReviewReport;
}

export interface SecuritySelfReviewReport {
  passed: boolean;
  itemsPassed: number;
  itemsTotal: number;
  failures?: Array<{
    file: string;
    line: number;
    check: string;
    detail: string;
    fixed: boolean;
  }>;
}

// ── Fixer ───────────────────────────────────────────────────────────────────

export interface RootCauseAnalysis {
  classification: 'plan-omission' | 'implementation-error' | 'edge-case-miss' | 'integration-mismatch' | 'environment-issue';
  primaryCause: string;
  fixApplied: string;
  fixConfidence: number;
  crossModuleCheck: string;
}

export interface SecurityFixDetails {
  vulnerabilityType: 'sql-injection' | 'xss' | 'path-traversal' | 'command-injection' | 'ssrf' | 'prototype-pollution' | 'idor' | 'auth-bypass' | 'other';
  severity: 'critical' | 'high' | 'medium' | 'low';
  cwe: string;
  fixApplied: string;
  antiPatternFixed: string;
  selfReviewPassed: boolean;
  regressionTestsCreated: number;
}

export interface FixerOutput extends AgentOutputContract {
  rootCauseAnalysis: RootCauseAnalysis;
  securityFixDetails?: SecurityFixDetails;
  testPassed: boolean | null;
  testOutput?: string;
}

// ── QA ──────────────────────────────────────────────────────────────────────

export interface SecurityTestCoverageReport {
  patternsDetected: number;
  testsGenerated: number;
  coverage: number;
  gatePassed: boolean;
  missingTests?: Array<{
    pattern: string;
    file: string;
    risk: string;
    reason: string;
  }>;
}

export interface QAOutput extends AgentOutputContract {
  projectType: string;
  smokeTestPassed: boolean;
  testFramework: string | null;
  coverage?: {
    totalCoverage: number;
    files: Array<{ file: string; percent: number }>;
  };
  securityTestsGenerated: number;
  securityTestCoverage?: SecurityTestCoverageReport;
}

// ── Verifier ────────────────────────────────────────────────────────────────

export interface SuggestedCheckpoint {
  id: string;
  type: string;
  description: string;
  file: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
  scope: 'suggested' | 'manifest';
  basedOn: string;
}

export interface SecurityTestCoverageGate {
  securityPatternsDetected: number;
  securityTestsGenerated: number;
  coverage: number;
  gatePassed: boolean;
  missingTestPatterns?: Array<{
    pattern: string;
    file: string;
    risk: string;
  }>;
}

export interface VerifierOutput extends AgentOutputContract {
  complianceScore: number;
  weightedScore?: number;
  totalCheckpoints: number;
  passedCheckpoints: number;
  failedCheckpoints: number;
  skippedCheckpoints: number;
  suggestedCheckpoints: SuggestedCheckpoint[];
  securityTestCoverageGate?: SecurityTestCoverageGate;
}

// ── MergeCoordinator ────────────────────────────────────────────────────────

export interface MergeCoordinatorOutput extends AgentOutputContract {
  filesChecked: number;
  importIssues: Array<{ file: string; import: string; issue: string }>;
  typeIssues: Array<{ file: string; symbol: string; issue: string }>;
  blocking: boolean;
}

// ── Integrator ──────────────────────────────────────────────────────────────

export interface IntegratorOutput extends AgentOutputContract {
  wiringSummary: {
    barrelFilesUpdated: number;
    diRegistrationsAdded: number;
    routesAdded: number;
    importsFixed: number;
  };
}

// ── BrowserTester ───────────────────────────────────────────────────────────

export interface BrowserTesterOutput extends AgentOutputContract {
  urlsVisited: number;
  bugsFound: number;
  testScriptsCreated: number;
}

// ── Documentor ──────────────────────────────────────────────────────────────

export interface DocumentorOutput extends AgentOutputContract {
  docsCreated: number;
  docsUpdated: number;
}

// =============================================================================
// Agent Context Schema (agent-context.md YAML frontmatter)
// =============================================================================

export interface AgentContext {
  pipelineId: string;
  feature: string;
  pipelineType: string;
  currentStep: string;
  status: 'running' | 'completed' | 'failed' | 'stale';
  createdAt: string;
  pipelineHeartbeat?: string;
  agentHistory: AgentContextHistoryEntry[];
  agentOutputs: Record<string, AgentOutputEntry>;
  circuitBreaker: CircuitBreakerState;
  gitState: GitState;
  nextObjective?: string;
  chainOfCustody?: ChainOfCustodyEntry[];
  failedGates?: string[];
}

/**
 * Branded string type for pipeline IDs.
 * Use this instead of raw strings wherever a pipeline ID is expected.
 * Enables type-safe pipeline ID passing between agents and scripts.
 */
export type AgentContextPipelineId = string & { __brand: 'AgentContextPipelineId' };

export interface AgentContextHistoryEntry {
  step: string;
  agent: string;
  result: 'completed' | 'failed' | 'partial';
  summary: string;
  decisions?: Array<{ what: string; why: string; by_who: string }>;
  warnings?: string[];
  changedFiles: string[];
  artifacts: string[];
}

export interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  counters: Record<string, number>;
  thresholds: Record<string, number>;
}

export interface GitState {
  branch: string;
  dirtyFiles: string[];
  lastCommitSha: string;
}

export interface ChainOfCustodyEntry {
  step: string;
  timestamp: string;
  sha256: string;
  previousSha: string | null;
}
