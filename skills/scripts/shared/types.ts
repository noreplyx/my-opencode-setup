/**
 * Common types used across all skill scripts and agent output contracts.
 * 
 * This is the single source of truth for:
 * - Agent output contracts (what each agent MUST return)
 * - Pipeline state types
 * - Circuit breaker types
 * - Error taxonomy
 * - Agent metadata
 */

// ── Agent Identity ────────────────────────────────────────────────

export type AgentName =
  | 'orchestrator'
  | 'finder'
  | 'plandescriber'
  | 'implementor'
  | 'fixer'
  | 'qa'
  | 'verifier'
  | 'merge-coordinator'
  | 'integrator'
  | 'browser-tester'
  | 'documentor'
  | 'security-scan';

export type AgentMode = 'primary' | 'subagent';

export interface AgentMetadata {
  name: AgentName;
  version: string;
  mode: AgentMode;
  description: string;
  lastModified: string;
  skills: string[];
  canParallelizeWith: string[];
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
  temperature?: number;
}

// ── Pipeline Identity & State ─────────────────────────────────────

export type PipelineType =
  | 'full'
  | 'quick'
  | 'fixer-only'
  | 'documentation'
  | 'parallel'
  | 'tdd'
  | 'refactor'
  | 'micro-pipeline'
  | 'research';

export type PipelineStatus = 'running' | 'completed' | 'failed' | 'stale';

export type PipelineResult = 'pass' | 'fail' | 'partial';

export interface PipelineIdentity {
  pipelineId: string;
  feature: string;
  pipelineType: PipelineType;
}

export interface PipelineState {
  pipelineId: string;
  feature: string;
  pipelineType: PipelineType;
  currentStep: AgentName;
  status: PipelineStatus;
  createdAt: string;
  pipelineHeartbeat?: string;
}

// ── Circuit Breaker ───────────────────────────────────────────────

export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

export type CircuitBreakerGate =
  | 'build'
  | 'lint'
  | 'securityScan'
  | 'smokeTest'
  | 'verifier';

export interface CircuitBreakerConfig {
  state: CircuitBreakerState;
  counters: Record<CircuitBreakerGate, number>;
  thresholds: Record<CircuitBreakerGate, number>;
}

export const DEFAULT_CIRCUIT_BREAKER: CircuitBreakerConfig = {
  state: 'closed',
  counters: { build: 0, lint: 0, securityScan: 0, smokeTest: 0, verifier: 0 },
  thresholds: { build: 3, lint: 3, securityScan: 3, smokeTest: 3, verifier: 3 },
};

// ── Git State ─────────────────────────────────────────────────────

export interface GitState {
  branch: string;
  dirtyFiles: string[];
  lastCommitSha: string;
}

// ── Error Taxonomy ────────────────────────────────────────────────

export type ErrorCategory =
  | 'build_failure'
  | 'lint_failure'
  | 'import_resolution_error'
  | 'type_mismatch'
  | 'plan_omission'
  | 'implementation_error'
  | 'edge_case_miss'
  | 'integration_mismatch'
  | 'environment_issue'
  | 'circuit_breaker_open'
  | 'security_violation'
  | 'output_contract_violation'
  | 'timeout'
  | 'unknown';

export interface AgentError {
  category: ErrorCategory;
  message: string;
  source: AgentName;
  timestamp: string;
  details?: Record<string, unknown>;
  recoverable: boolean;
}

// ── Agent Decision ────────────────────────────────────────────────

export interface AgentDecision {
  what: string;
  why: string;
  by_who: AgentName;
}

// ── Base Agent Output Contract ───────────────────────────────────

export type AgentTaskResult = 'completed' | 'failed' | 'partial';

export interface BaseAgentOutput {
  status: AgentTaskResult;
  resultSummary: string;
  buildPassed: boolean | null;
  lintPassed: boolean | null;
  buildOutput?: string;
  lintOutput?: string;
}

export interface AgentOutputContract {
  status: AgentTaskResult;
  resultSummary: string;
  decisions: AgentDecision[];
  warnings: string[];
  changedFiles: string[];
  artifacts: string[];
}

// ── Per-Agent Output Contracts ────────────────────────────────────

export interface FinderOutput extends AgentOutputContract {
  explorationCache?: {
    used: boolean;
    lastCommitSha?: string;
  };
}

export interface PlanDescriberOutput extends AgentOutputContract {
  manifestPath: string;
  manifestVersion: number;
  phases: number;
  estimatedEffort: 'small' | 'medium' | 'large' | 'x-large';
  riskLevel: 'low' | 'medium' | 'high';
}

export interface WiringManifest {
  exports: string[];
  classes: string[];
  diRequirements: string[];
  barrelExports: string[];
}

export interface SecuritySelfReview {
  passed: boolean;
  itemsPassed: number;
  itemsTotal: number;
  failures: Array<{
    file: string;
    line: number;
    check: string;
    detail: string;
    fixed: boolean;
  }>;
}

export interface ImplementorOutput extends AgentOutputContract {
  selfReview: {
    confidence: number;
    securityItemsPassed: number;
    securityItemsTotal: number;
    securitySelfReviewPassed: boolean;
    preCheckPassed: boolean;
    scopeGuardFlags: string[];
    wiringManifest: WiringManifest;
  };
  securitySelfReview: SecuritySelfReview;
}

export interface RootCauseAnalysis {
  classification: 'plan-omission' | 'implementation-error' | 'edge-case-miss' | 'integration-mismatch' | 'environment-issue';
  primaryCause: string;
  contributingFactors: string[];
  fixApplied: string;
  fixConfidence: number; // 1-10
  crossModuleCheck: Array<{
    module: string;
    status: 'unaffected' | 'affected' | 'needsReview';
  }>;
}

export interface FixerOutput extends AgentOutputContract {
  rootCauseAnalysis: RootCauseAnalysis;
  testPassed: boolean | null;
  testOutput?: string;
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
}

export interface SuggestedCheckpoint {
  id: string;
  type: string;
  description: string;
  file: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
  scope: 'suggested' | 'manifest';
  basedOn: string;
}

export interface VerifierOutput extends AgentOutputContract {
  complianceScore: number;
  weightedScore?: number;
  totalCheckpoints: number;
  passedCheckpoints: number;
  failedCheckpoints: number;
  skippedCheckpoints: number;
  suggestedCheckpoints: SuggestedCheckpoint[];
}

export interface MergeCoordinatorOutput extends AgentOutputContract {
  filesChecked: string[];
  importIssues: number;
  typeIssues: number;
  reexportIssues: number;
  blocking: boolean;
}

export interface WiringSummary {
  barrelFilesUpdated: string[];
  diRegistrationsAdded: string[];
  routesAdded: Array<{ method: string; path: string; handler: string }>;
  importsFixed: Array<{ file: string; from: string; to: string }>;
}

export interface IntegratorOutput extends AgentOutputContract {
  wiringSummary: WiringSummary;
}

export interface BrowserTesterOutput extends AgentOutputContract {
  urlsVisited: string[];
  bugsFound: number;
  testScriptsCreated: string[];
}

export interface DocumentorOutput extends AgentOutputContract {
  docsCreated: string[];
  docsUpdated: string[];
  apiDocsGenerated: boolean;
}

// ── Agent History Entry ───────────────────────────────────────────

export interface AgentHistoryEntry {
  step: AgentName;
  agent: string; // session ID (e.g. "ses_xxx")
  result: AgentTaskResult;
  summary: string;
  decisions: AgentDecision[];
  warnings: string[];
  changedFiles: string[];
  artifacts: string[];
  errors?: AgentError[];
  durationSeconds?: number;
}

// ── Visual Data ───────────────────────────────────────────────────

export interface VisualCoverageData {
  file: string;
  percent: number;
}

export interface VisualBugSeverity {
  severity: string;
  count: number;
}

export interface VisualCheckpointResult {
  id: string;
  type: 'structural' | 'behavioral';
  verdict: 'pass' | 'fail';
}

export interface VisualDrift {
  planned: string;
  actual: string;
}

export interface VisualDecision {
  label: string;
  chosen: boolean;
  children?: VisualDecision[];
}

export interface VisualFileImpact {
  path: string;
  status: 'new' | 'modified' | 'deleted';
  imports: string[];
  importedBy: string[];
}

export interface VisualData {
  coverage?: {
    totalCoverage: number;
    files: VisualCoverageData[];
  };
  bugSeverity?: VisualBugSeverity[];
  checkpoints?: VisualCheckpointResult[];
  drift?: VisualDrift[];
  decisions?: VisualDecision[];
  fileImpact?: VisualFileImpact[];
}

// ── agent-context.md ──────────────────────────────────────────────

export interface AgentContextFile {
  // Pipeline Identity
  pipelineId: string;
  feature: string;
  pipelineType: PipelineType;
  currentStep: AgentName;
  status: PipelineStatus;
  createdAt: string;
  pipelineHeartbeat?: string;

  // Agent History
  agentHistory: AgentHistoryEntry[];

  // Agent Outputs
  agentOutputs: Record<string, BaseAgentOutput>;

  // Circuit Breaker
  circuitBreaker: CircuitBreakerConfig;

  // Git State
  gitState: GitState;

  // Next Objective
  nextObjective: string;

  // Failure Summary (optional)
  failureSummary?: {
    lastFailedGate: string;
    rootCause: string;
    attemptedFixes: string[];
    escalationCount: number;
  };

  // Visuals (optional)
  visuals?: {
    lastPipelineDiagram: string;
    lastUpdated: string;
    generated: Array<{ type: string; file: string }>;
  };
}

// ── Validation Result ─────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  parsedContext?: AgentContextFile;
}

// ── Security Scan ─────────────────────────────────────────────────

export interface SecurityFinding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  type: string;
  description: string;
  file?: string;
  line?: number;
  recommendation?: string;
  autoFixable: boolean;
}

export interface SecurityScanReport {
  scanType: string;
  timestamp: string;
  totalFindings: number;
  findings: SecurityFinding[];
  passed: boolean;
  summary: string;
}

// ── Retrospective ─────────────────────────────────────────────────

export interface AgentPerformance {
  role: AgentName;
  effectiveness: 'good' | 'ok' | 'poor';
  notes: string;
}

export interface PipelineRetrospective {
  pipelineQuality: 'smooth' | 'rough' | 'failed';
  handoffQuality: {
    rating: number; // 1-10
    issues: string[];
  };
  agentPerformance: AgentPerformance[];
  wastedSteps: string[];
  improvementsForNextPipeline: string[];
  lessonsLearned: string[];
}

// ── Pre-Flight Check ──────────────────────────────────────────────

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip';

export interface PreFlightCheckResult {
  name: string;
  status: CheckStatus;
  details: string;
}

export interface PreFlightReport {
  checks: PreFlightCheckResult[];
  goNoGo: 'go' | 'no-go';
  crossSessionLessons?: string[];
  timestamp: string;
}
