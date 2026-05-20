/**
 * Skills Framework
 * 
 * Shared utilities and types for all skill scripts.
 * 
 * Usage from any skill script:
 *   import { Logger } from '../shared/logger';
 *   import { readFile, formatReport } from '../shared/utils';
 *   import type { CheckResult, CheckReport, AgentContextFile } from '../shared/types';
 */

export { Logger } from './logger';
export type { LogLevel } from './logger';
export { 
  readFile, writeFile, exists, globFiles, grepFiles,
  timestamp, formatReport, askYesNo, listFilesRecursive, log 
} from './utils';
export type {
  // ── Agent Identity ──
  AgentName, AgentMode, AgentMetadata,

  // ── Pipeline State ──
  PipelineType, PipelineStatus, PipelineResult,
  PipelineIdentity, PipelineState,

  // ── Circuit Breaker ──
  CircuitBreakerState, CircuitBreakerGate, CircuitBreakerConfig,
  DEFAULT_CIRCUIT_BREAKER,

  // ── Git ──
  GitState,

  // ── Errors ──
  ErrorCategory, AgentError,

  // ── Decisions ──
  AgentDecision,

  // ── Base Output Contract ──
  AgentTaskResult, BaseAgentOutput, AgentOutputContract,

  // ── Per-Agent Outputs ──
  FinderOutput, PlanDescriberOutput,
  WiringManifest, SecuritySelfReview, ImplementorOutput,
  RootCauseAnalysis, FixerOutput,
  QAOutput, SuggestedCheckpoint, VerifierOutput,
  MergeCoordinatorOutput, WiringSummary, IntegratorOutput,
  BrowserTesterOutput, DocumentorOutput,

  // ── Agent History ──
  AgentHistoryEntry,

  // ── Visual Data ──
  VisualData, VisualCoverageData, VisualBugSeverity,
  VisualCheckpointResult, VisualDrift, VisualDecision, VisualFileImpact,

  // ── Context File ──
  AgentContextFile, ValidationResult,

  // ── Security ──
  SecurityFinding, SecurityScanReport,

  // ── Retrospective ──
  AgentPerformance, PipelineRetrospective,

  // ── Pre-Flight ──
  CheckStatus, PreFlightCheckResult, PreFlightReport,

  // ── Debugging & Reproducibility ──
  ErrorReproduction, ReproductionCommand, DryRunOutput,
  BugReport, BugReproductionSteps, PipelineCheckpoint,
  DiagnosticResult, ReplayRequest, DebugEscalation,
} from './types';
export type {
  SkillContext, CheckResult, CheckReport, FileChange,
  ScaffoldOptions, VerificationPoint, PlanCheckpoint, PlanManifest,
} from './types';
