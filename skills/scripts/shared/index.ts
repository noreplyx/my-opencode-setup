#!/usr/bin/env node
/**
 * Skills Framework
 * 
 * Shared utilities and types for all skill scripts.
 * 
 * Usage from any skill script:
 *   import { Logger } from '../shared/logger';
 *   import { readFile } from '../shared/utils';
 *   import type { AgentOutputContract } from '../shared/types';
 */

export { Logger } from './logger';
export type { LogLevel } from './logger';
export { 
  readFile, writeFile, exists, globFiles, grepFiles,
  timestamp, askYesNo, listFilesRecursive, log 
} from './utils';
export type {
  // ── Core Output Contract ──
  AgentOutputContract, AgentOutputEntry,

  // ── Reproduction & Debugging ──
  ReproductionCommand, ErrorReproductionPacket,
  DryRunManifest, CheckpointRequest,

  // ── Per-Agent Outputs ──
  FinderOutput, PlanDescriberOutput,
  ImplementorOutput, SecuritySelfReviewReport,
  RootCauseAnalysis, SecurityFixDetails,
  FixerOutput, SecurityTestCoverageReport,
  QAOutput, SuggestedCheckpoint, SecurityTestCoverageGate,
  VerifierOutput, MergeCoordinatorOutput,
  IntegratorOutput, BrowserTesterOutput, DocumentorOutput,

  // ── Agent Context ──
  AgentContext, AgentContextHistoryEntry,
  CircuitBreakerState, GitState, ChainOfCustodyEntry,
} from './types';
