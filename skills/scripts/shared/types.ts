/** Common types used across all skill scripts */

export interface SkillContext {
  /** Working directory for the project being operated on */
  projectRoot: string;
  /** Optional verbose mode */
  verbose?: boolean;
}

export interface CheckResult {
  name: string;
  passed: boolean;
  details: string;
  recommendation?: string;
}

export interface CheckReport {
  skillName: string;
  timestamp: string;
  totalChecks: number;
  passed: number;
  failed: number;
  results: CheckResult[];
  summary: string;
}

export interface FileChange {
  filePath: string;
  description: string;
  type: 'create' | 'modify' | 'delete';
  content?: string;
}

export interface ScaffoldOptions {
  name: string;
  description: string;
  outputDir: string;
  withScripts?: boolean;
  withTests?: boolean;
}

export interface VerificationPoint {
  id: string;
  type: 'file' | 'export' | 'function' | 'class' | 'method' | 'route' | 'behavioral';
  target: string;
  description: string;
}

export interface PlanCheckpoint {
  id: string;
  type: 'structural' | 'behavioral';
  description: string;
  target: string;
  verify: Record<string, string>;
  dependsOn: string[];
}

export interface PlanManifest {
  manifestVersion: number;
  planSummary: string;
  createdAt: string;
  checkpoints: PlanCheckpoint[];
}
