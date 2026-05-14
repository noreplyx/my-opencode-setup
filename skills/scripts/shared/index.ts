/**
 * Skills Framework
 * 
 * Shared utilities and types for all skill scripts.
 * 
 * Usage from any skill script:
 *   import { Logger } from '../shared/logger';
 *   import { readFile, formatReport } from '../shared/utils';
 *   import type { CheckResult, CheckReport } from '../shared/types';
 */

export { Logger } from './logger';
export type { LogLevel } from './logger';
export { 
  readFile, writeFile, exists, globFiles, grepFiles,
  timestamp, formatReport, askYesNo, listFilesRecursive, log 
} from './utils';
export type {
  SkillContext, CheckResult, CheckReport, FileChange,
  ScaffoldOptions, VerificationPoint, PlanCheckpoint, PlanManifest
} from './types';
