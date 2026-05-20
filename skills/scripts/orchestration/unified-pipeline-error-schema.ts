#!/usr/bin/env ts-node
/**
 * Unified Pipeline Error Schema
 *
 * Defines the canonical PipelineError type used across all agents,
 * provides error code registration, and validates error objects.
 * Replaces stringly-typed error classifications with a structured,
 * typed system.
 *
 * Usage (CLI):
 *   ts-node unified-pipeline-error-schema.ts --lookup=IMP-001
 *   ts-node unified-pipeline-error-schema.ts --validate
 *   ts-node unified-pipeline-error-schema.ts --list
 *   ts-node unified-pipeline-error-schema.ts --list --category=implementation
 *   ts-node unified-pipeline-error-schema.ts --report --file=agent-output.yaml
 *   ts-node unified-pipeline-error-schema.ts --export=json
 *   ts-node unified-pipeline-error-schema.ts --classify="..." --fixer-classification=implementation-error
 *
 * Usage (module):
 *   import { createPipelineError, lookupErrorCode, ... } from './unified-pipeline-error-schema';
 *
 * Exit codes:
 *   0 = Success
 *   1 = Validation error / lookup not found
 *   2 = Parse / usage error
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Canonical Types ──

export type ErrorCategory = 'plan' | 'implementation' | 'integration' | 'environment' | 'security' | 'unknown';
export type ErrorSeverity = 'blocking' | 'warning' | 'info';
export type AgentRole =
  | 'finder'
  | 'plandescriber'
  | 'implementor'
  | 'fixer'
  | 'qa'
  | 'verifier'
  | 'documentor'
  | 'integrator'
  | 'merge-coordinator'
  | 'browser-tester'
  | 'orchestrator';

export interface PipelineError {
  errorCode: string; // e.g., "IMP-001"
  category: ErrorCategory;
  severity: ErrorSeverity;
  detector: AgentRole;
  checkpointId?: string; // Plan checkpoint ID if applicable
  rootCause: string; // Human-readable
  reproduction?: string; // Executable command to reproduce
  firstSeenSession?: string; // Cross-session dedup
  timesSeen: number; // How many times this errorCode has been seen
  affectedFiles?: string[]; // Files affected by this error
  suggestedFix?: string; // Optional fix suggestion
  createdAt: string; // ISO-8601
}

export interface ErrorCodeDefinition {
  errorCode: string;
  category: ErrorCategory;
  defaultSeverity: ErrorSeverity;
  title: string;
  description: string;
  suggestedFix?: string;
}

// ── Error Code Registry ──

export const ERROR_CODE_REGISTRY: ErrorCodeDefinition[] = [
  // Plan errors (PLN-0xx)
  {
    errorCode: 'PLN-001',
    category: 'plan',
    defaultSeverity: 'blocking',
    title: 'Missing checkpoint',
    description: 'Plan omitted a required checkpoint',
  },
  {
    errorCode: 'PLN-002',
    category: 'plan',
    defaultSeverity: 'blocking',
    title: 'Ambiguous specification',
    description: 'Checkpoint description is too vague to verify',
  },
  {
    errorCode: 'PLN-003',
    category: 'plan',
    defaultSeverity: 'warning',
    title: 'Missing error handling',
    description: 'Plan does not specify error handling for this checkpoint',
  },

  // Implementation errors (IMP-0xx)
  {
    errorCode: 'IMP-001',
    category: 'implementation',
    defaultSeverity: 'blocking',
    title: 'Missing export',
    description: 'Required export not found in implemented file',
  },
  {
    errorCode: 'IMP-002',
    category: 'implementation',
    defaultSeverity: 'blocking',
    title: 'Type mismatch',
    description: 'Implementation type does not match plan specification',
  },
  {
    errorCode: 'IMP-003',
    category: 'implementation',
    defaultSeverity: 'blocking',
    title: 'Missing implementation',
    description: 'Required function/class not implemented',
  },
  {
    errorCode: 'IMP-004',
    category: 'implementation',
    defaultSeverity: 'warning',
    title: 'Missing error handling',
    description: 'Error handling not implemented where expected',
  },
  {
    errorCode: 'IMP-005',
    category: 'implementation',
    defaultSeverity: 'warning',
    title: 'Missing input validation',
    description: 'Input validation not implemented where expected',
  },
  {
    errorCode: 'IMP-006',
    category: 'implementation',
    defaultSeverity: 'blocking',
    title: 'Build failure',
    description: 'Code does not compile',
  },
  {
    errorCode: 'IMP-007',
    category: 'implementation',
    defaultSeverity: 'warning',
    title: 'Lint failure',
    description: 'Code fails lint checks',
  },
  {
    errorCode: 'IMP-008',
    category: 'implementation',
    defaultSeverity: 'blocking',
    title: 'Security vulnerability',
    description: 'Security anti-pattern detected in implementation',
  },
  {
    errorCode: 'IMP-009',
    category: 'implementation',
    defaultSeverity: 'warning',
    title: 'Scope creep',
    description: 'Implementation includes code not in plan',
  },

  // Integration errors (INT-0xx)
  {
    errorCode: 'INT-001',
    category: 'integration',
    defaultSeverity: 'blocking',
    title: 'Broken import',
    description: 'Import path does not resolve to existing file',
  },
  {
    errorCode: 'INT-002',
    category: 'integration',
    defaultSeverity: 'blocking',
    title: 'Missing barrel export',
    description: 'New module not re-exported from barrel file',
  },
  {
    errorCode: 'INT-003',
    category: 'integration',
    defaultSeverity: 'blocking',
    title: 'DI registration missing',
    description: 'New service not registered in DI container',
  },
  {
    errorCode: 'INT-004',
    category: 'integration',
    defaultSeverity: 'warning',
    title: 'Route not wired',
    description: 'New controller not wired into route system',
  },
  {
    errorCode: 'INT-005',
    category: 'integration',
    defaultSeverity: 'blocking',
    title: 'API contract mismatch',
    description: 'Implemented API does not match specified contract',
  },

  // Environment errors (ENV-0xx)
  {
    errorCode: 'ENV-001',
    category: 'environment',
    defaultSeverity: 'blocking',
    title: 'Missing tool',
    description: 'Required tool/command not available',
  },
  {
    errorCode: 'ENV-002',
    category: 'environment',
    defaultSeverity: 'warning',
    title: 'Wrong Node version',
    description: 'Node version does not match project requirements',
  },
  {
    errorCode: 'ENV-003',
    category: 'environment',
    defaultSeverity: 'blocking',
    title: 'Missing dependency',
    description: 'Required npm package not installed',
  },

  // Security errors (SEC-0xx)
  {
    errorCode: 'SEC-001',
    category: 'security',
    defaultSeverity: 'blocking',
    title: 'Critical vulnerability',
    description: 'Dependency with critical vulnerability found',
  },
  {
    errorCode: 'SEC-002',
    category: 'security',
    defaultSeverity: 'blocking',
    title: 'Hardcoded secret',
    description: 'Secret/credential hardcoded in source code',
  },
  {
    errorCode: 'SEC-003',
    category: 'security',
    defaultSeverity: 'blocking',
    title: 'SQL injection risk',
    description: 'SQL query built from string concatenation',
  },
  {
    errorCode: 'SEC-004',
    category: 'security',
    defaultSeverity: 'blocking',
    title: 'Command injection risk',
    description: 'Shell command built from string concatenation',
  },
  {
    errorCode: 'SEC-005',
    category: 'security',
    defaultSeverity: 'blocking',
    title: 'Path traversal risk',
    description: 'File path built from user input without validation',
  },
  {
    errorCode: 'SEC-006',
    category: 'security',
    defaultSeverity: 'warning',
    title: 'SSRF risk',
    description: 'URL built from user input for fetch/request',
  },
  {
    errorCode: 'SEC-007',
    category: 'security',
    defaultSeverity: 'warning',
    title: 'Prototype pollution risk',
    description: 'Dynamic property assignment from user input',
  },
  {
    errorCode: 'SEC-008',
    category: 'security',
    defaultSeverity: 'blocking',
    title: 'Install script detected',
    description: 'Package with install scripts in dependency tree',
  },
];

// ── Fixer Classification to Error Code Mapping ──

const FIXER_CLASSIFICATION_MAP: Record<string, string[]> = {
  'plan-omission': ['PLN-001', 'PLN-002'],
  'implementation-error': ['IMP-001', 'IMP-002', 'IMP-003'],
  'edge-case-miss': ['IMP-004', 'IMP-005'],
  'integration-mismatch': ['INT-001', 'INT-002', 'INT-003'],
  'environment-issue': ['ENV-001', 'ENV-002', 'ENV-003'],
};

// ── Registry Index (built once) ──

const ERROR_CODE_INDEX = new Map<string, ErrorCodeDefinition>();
const ERROR_CATEGORY_INDEX = new Map<ErrorCategory, ErrorCodeDefinition[]>();

function buildIndexes(): void {
  ERROR_CODE_INDEX.clear();
  ERROR_CATEGORY_INDEX.clear();

  for (const def of ERROR_CODE_REGISTRY) {
    ERROR_CODE_INDEX.set(def.errorCode, def);

    const existing = ERROR_CATEGORY_INDEX.get(def.category);
    if (existing) {
      existing.push(def);
    } else {
      ERROR_CATEGORY_INDEX.set(def.category, [def]);
    }
  }
}

buildIndexes();

// ── Public API Functions ──

/**
 * Look up an error code definition in the registry.
 * Returns the definition or undefined if not found.
 */
export function lookupErrorCode(code: string): ErrorCodeDefinition | undefined {
  return ERROR_CODE_INDEX.get(code);
}

/**
 * Create a PipelineError from a registered error code plus overrides.
 * The errorCode, category, and severity are derived from the registry definition.
 * The rootCause and detector are required in overrides.
 * Throws if the error code is not found or if required fields are missing.
 */
export function createPipelineError(
  code: string,
  overrides: Partial<PipelineError>
): PipelineError {
  const def = lookupErrorCode(code);
  if (!def) {
    throw new Error(`Unknown error code: "${code}". Valid codes: ${ERROR_CODE_REGISTRY.map(d => d.errorCode).join(', ')}`);
  }

  if (!overrides.rootCause || overrides.rootCause.trim().length === 0) {
    throw new Error('rootCause is required when creating a PipelineError');
  }

  if (!overrides.detector) {
    throw new Error('detector (AgentRole) is required when creating a PipelineError');
  }

  const error: PipelineError = {
    errorCode: def.errorCode,
    category: def.category,
    severity: overrides.severity ?? def.defaultSeverity,
    detector: overrides.detector,
    checkpointId: overrides.checkpointId,
    rootCause: overrides.rootCause,
    reproduction: overrides.reproduction,
    firstSeenSession: overrides.firstSeenSession,
    timesSeen: overrides.timesSeen ?? 1,
    affectedFiles: overrides.affectedFiles,
    suggestedFix: overrides.suggestedFix ?? def.suggestedFix,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  };

  return error;
}

/**
 * Validate an unknown object as a PipelineError.
 * Returns { valid: true } or { valid: false, errors: string[] }.
 */
export function validatePipelineError(error: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!error || typeof error !== 'object') {
    return { valid: false, errors: ['error must be a non-null object'] };
  }

  const e = error as Record<string, unknown>;

  // errorCode: required, string, must exist in registry
  if (typeof e.errorCode !== 'string' || e.errorCode.trim().length === 0) {
    errors.push('errorCode: required non-empty string');
  } else if (!ERROR_CODE_INDEX.has(e.errorCode)) {
    errors.push(`errorCode: "${e.errorCode}" is not a registered error code`);
  }

  // category: optional on the object (derived from errorCode), but if present must match
  const validCategories: ErrorCategory[] = ['plan', 'implementation', 'integration', 'environment', 'security', 'unknown'];
  if (e.category !== undefined && !validCategories.includes(e.category as ErrorCategory)) {
    errors.push(`category: must be one of ${validCategories.join(', ')}`);
  }

  // severity: optional on the object (derived from errorCode), but if present must match
  const validSeverities: ErrorSeverity[] = ['blocking', 'warning', 'info'];
  if (e.severity !== undefined && !validSeverities.includes(e.severity as ErrorSeverity)) {
    errors.push(`severity: must be one of ${validSeverities.join(', ')}`);
  }

  // detector: required
  const validAgentRoles: AgentRole[] = [
    'finder', 'plandescriber', 'implementor', 'fixer', 'qa', 'verifier',
    'documentor', 'integrator', 'merge-coordinator', 'browser-tester', 'orchestrator',
  ];
  if (typeof e.detector !== 'string' || !validAgentRoles.includes(e.detector as AgentRole)) {
    errors.push(`detector: required, must be one of ${validAgentRoles.join(', ')}`);
  }

  // rootCause: required non-empty string
  if (typeof e.rootCause !== 'string' || e.rootCause.trim().length === 0) {
    errors.push('rootCause: required non-empty string');
  }

  // timesSeen: optional but must be a non-negative number
  if (e.timesSeen !== undefined) {
    if (typeof e.timesSeen !== 'number' || !Number.isFinite(e.timesSeen) || e.timesSeen < 0) {
      errors.push('timesSeen: must be a non-negative finite number');
    } else if (!Number.isInteger(e.timesSeen)) {
      errors.push('timesSeen: must be an integer');
    }
  }

  // createdAt: optional but must be ISO-8601 if present
  if (e.createdAt !== undefined) {
    if (typeof e.createdAt !== 'string') {
      errors.push('createdAt: must be a string');
    } else {
      const d = new Date(e.createdAt);
      if (isNaN(d.getTime())) {
        errors.push(`createdAt: "${e.createdAt}" is not a valid ISO-8601 date`);
      }
    }
  }

  // checkpointId: optional string
  if (e.checkpointId !== undefined && typeof e.checkpointId !== 'string') {
    errors.push('checkpointId: must be a string');
  }

  // reproduction: optional string
  if (e.reproduction !== undefined && typeof e.reproduction !== 'string') {
    errors.push('reproduction: must be a string');
  }

  // firstSeenSession: optional string
  if (e.firstSeenSession !== undefined && typeof e.firstSeenSession !== 'string') {
    errors.push('firstSeenSession: must be a string');
  }

  // affectedFiles: optional string array
  if (e.affectedFiles !== undefined) {
    if (!Array.isArray(e.affectedFiles)) {
      errors.push('affectedFiles: must be an array of strings');
    } else if (!e.affectedFiles.every((f: unknown) => typeof f === 'string')) {
      errors.push('affectedFiles: all elements must be strings');
    }
  }

  // suggestedFix: optional string
  if (e.suggestedFix !== undefined && typeof e.suggestedFix !== 'string') {
    errors.push('suggestedFix: must be a string');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Classify a Fixer root cause message into a registered error code.
 * Uses keyword matching against the rootCause string.
 * Falls back to 'IMP-003' (missing implementation) for unknown classifications.
 */
export function classifyError(rootCause: string, classification: string): string {
  const candidates = FIXER_CLASSIFICATION_MAP[classification];
  if (!candidates) {
    return 'IMP-003'; // Default fallback
  }

  // Try to find the best match based on keywords in rootCause
  const classificationKeywordMap: Record<string, Record<string, string[]>> = {
    'plan-omission': {
      'PLN-001': ['checkpoint', 'step', 'phase', 'stage'],
      'PLN-002': ['ambiguous', 'vague', 'unclear', 'specification', 'spec'],
    },
    'implementation-error': {
      'IMP-001': ['export', 'not exported', 'missing export'],
      'IMP-002': ['type', 'mismatch', 'type.*error', 'incompatible'],
      'IMP-003': ['missing', 'not found', 'not implemented', 'does not exist'],
    },
    'edge-case-miss': {
      'IMP-004': ['error handling', 'try', 'catch', 'reject', 'exception'],
      'IMP-005': ['validation', 'validate', 'sanitize', 'input', 'schema'],
    },
    'integration-mismatch': {
      'INT-001': ['import', 'module', 'path', 'resolve'],
      'INT-002': ['barrel', 're-export', 'index'],
      'INT-003': ['di', 'container', 'inject', 'register', 'provider'],
    },
    'environment-issue': {
      'ENV-001': ['tool', 'command', 'not available', 'not found'],
      'ENV-002': ['version', 'node', 'engine'],
      'ENV-003': ['dependency', 'package', 'npm', 'install', 'missing'],
    },
  };

  const keywordMap = classificationKeywordMap[classification];
  if (keywordMap) {
    const lowerRootCause = rootCause.toLowerCase();
    let bestMatch = candidates[0]; // Default to first candidate
    let bestScore = 0;

    for (const [code, keywords] of Object.entries(keywordMap)) {
      let score = 0;
      for (const kw of keywords) {
        if (lowerRootCause.includes(kw.toLowerCase())) {
          score++;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = code;
      }
    }

    return bestMatch;
  }

  return candidates[0];
}

/**
 * Get all error code definitions in a given category.
 */
export function getErrorsByCategory(category: ErrorCategory): ErrorCodeDefinition[] {
  return ERROR_CATEGORY_INDEX.get(category) ?? [];
}

/**
 * Format a PipelineError as a human-readable string.
 */
export function formatError(error: PipelineError): string {
  const lines: string[] = [];
  lines.push(`[${error.errorCode}] ${error.category.toUpperCase()} / ${error.severity.toUpperCase()}`);
  lines.push(`  Detector:    ${error.detector}`);
  lines.push(`  Root Cause:  ${error.rootCause}`);
  if (error.checkpointId) {
    lines.push(`  Checkpoint:  ${error.checkpointId}`);
  }
  if (error.reproduction) {
    lines.push(`  Reproduce:   ${error.reproduction}`);
  }
  if (error.suggestedFix) {
    lines.push(`  Suggested:   ${error.suggestedFix}`);
  }
  if (error.affectedFiles && error.affectedFiles.length > 0) {
    lines.push(`  Files:       ${error.affectedFiles.join(', ')}`);
  }
  lines.push(`  Seen:        ${error.timesSeen}x`);
  if (error.firstSeenSession) {
    lines.push(`  First Seen:  ${error.firstSeenSession}`);
  }
  lines.push(`  Created:     ${error.createdAt}`);
  return lines.join('\n');
}

/**
 * Generate a YAML report string from an array of PipelineErrors.
 */
export function generateErrorReport(errors: PipelineError[]): string {
  const parts: string[] = ['# Pipeline Error Report', `# Generated: ${new Date().toISOString()}`, `# Total Errors: ${errors.length}`, ''];

  // Count by category
  const byCategory: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  for (const err of errors) {
    byCategory[err.category] = (byCategory[err.category] ?? 0) + 1;
    bySeverity[err.severity] = (bySeverity[err.severity] ?? 0) + 1;
  }

  parts.push('summary:');
  parts.push(`  totalErrors: ${errors.length}`);
  parts.push('  byCategory:');
  for (const [cat, count] of Object.entries(byCategory)) {
    parts.push(`    ${cat}: ${count}`);
  }
  parts.push('  bySeverity:');
  for (const [sev, count] of Object.entries(bySeverity)) {
    parts.push(`    ${sev}: ${count}`);
  }
  parts.push('');

  parts.push('errors:');
  for (let i = 0; i < errors.length; i++) {
    const err = errors[i];
    parts.push(`  - errorCode: ${err.errorCode}`);
    parts.push(`    category: ${err.category}`);
    parts.push(`    severity: ${err.severity}`);
    parts.push(`    detector: ${err.detector}`);
    if (err.checkpointId) {
      parts.push(`    checkpointId: ${err.checkpointId}`);
    }
    parts.push(`    rootCause: ${err.rootCause}`);
    if (err.reproduction) {
      parts.push(`    reproduction: ${err.reproduction}`);
    }
    if (err.firstSeenSession) {
      parts.push(`    firstSeenSession: ${err.firstSeenSession}`);
    }
    parts.push(`    timesSeen: ${err.timesSeen}`);
    if (err.affectedFiles && err.affectedFiles.length > 0) {
      parts.push('    affectedFiles:');
      for (const file of err.affectedFiles) {
        parts.push(`      - ${file}`);
      }
    }
    if (err.suggestedFix) {
      parts.push(`    suggestedFix: ${err.suggestedFix}`);
    }
    parts.push(`    createdAt: ${err.createdAt}`);
    if (i < errors.length - 1) {
      parts.push('');
    }
  }

  return parts.join('\n');
}

// ── Exported JSON Representation ──

export function exportRegistryAsJson(): string {
  return JSON.stringify(
    {
      schema: {
        errorCategory: ['plan', 'implementation', 'integration', 'environment', 'security', 'unknown'],
        errorSeverity: ['blocking', 'warning', 'info'],
        agentRole: [
          'finder', 'plandescriber', 'implementor', 'fixer', 'qa', 'verifier',
          'documentor', 'integrator', 'merge-coordinator', 'browser-tester', 'orchestrator',
        ],
        pipelineErrorFields: [
          'errorCode', 'category', 'severity', 'detector', 'checkpointId',
          'rootCause', 'reproduction', 'firstSeenSession', 'timesSeen',
          'affectedFiles', 'suggestedFix', 'createdAt',
        ],
      },
      registry: ERROR_CODE_REGISTRY,
      fixerClassificationMap: FIXER_CLASSIFICATION_MAP,
    },
    null,
    2
  );
}

// ── CLI Mode ──

function parseArgs(args: string[]): Record<string, string | boolean | undefined> {
  const parsed: Record<string, string | boolean | undefined> = {};

  for (const arg of args) {
    if (arg.startsWith('--lookup=')) {
      parsed.lookup = arg.split('=')[1];
    } else if (arg.startsWith('--category=')) {
      parsed.category = arg.split('=')[1];
    } else if (arg.startsWith('--file=')) {
      parsed.file = arg.split('=')[1];
    } else if (arg.startsWith('--export=')) {
      parsed.export = arg.split('=')[1];
    } else if (arg.startsWith('--classify=')) {
      parsed.classify = arg.split('=')[1];
    } else if (arg.startsWith('--fixer-classification=')) {
      parsed.fixerClassification = arg.split('=')[1];
    } else if (arg.startsWith('--format=')) {
      parsed.format = arg.split('=')[1];
    } else if (arg === '--validate') {
      parsed.validate = true;
    } else if (arg === '--list') {
      parsed.list = true;
    } else if (arg === '--report') {
      parsed.report = true;
    } else if (arg === '--json') {
      parsed.format = 'json';
    }
  }

  return parsed;
}

function printUsage(): void {
  console.log(`
Usage:
  ts-node unified-pipeline-error-schema.ts --lookup=<error-code>
  ts-node unified-pipeline-error-schema.ts --validate
  ts-node unified-pipeline-error-schema.ts --list [--category=<category>]
  ts-node unified-pipeline-error-schema.ts --report --file=<agent-output.yaml>
  ts-node unified-pipeline-error-schema.ts --export=json
  ts-node unified-pipeline-error-schema.ts --classify="<root-cause>" --fixer-classification=<classification>

Options:
  --lookup=<code>              Look up an error code (e.g., IMP-001)
  --validate                   Read a PipelineError JSON from stdin and validate it
  --list                       List all registered error codes
  --category=<category>        Filter by category (plan, implementation, integration, environment, security)
  --report --file=<path>       Generate error report from a YAML/JSON file containing an array of errors
  --export=json                Export the entire registry as JSON
  --classify="<root cause>"    Classify a Fixer root cause into an error code
  --fixer-classification=<c>   Fixer classification category
  --format=json                Output in JSON format (machine-readable)
`);
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    process.exit(2);
  }

  const options = parseArgs(args);

  // --lookup
  if (options.lookup && typeof options.lookup === 'string') {
    const def = lookupErrorCode(options.lookup);
    if (!def) {
      const output = options.format === 'json'
        ? JSON.stringify({ found: false, errorCode: options.lookup })
        : `Error code "${options.lookup}" not found in registry.`;
      console.log(output);
      process.exit(1);
    }
    if (options.format === 'json') {
      console.log(JSON.stringify(def, null, 2));
    } else {
      console.log(`Error Code: ${def.errorCode}`);
      console.log(`Category:   ${def.category}`);
      console.log(`Severity:   ${def.defaultSeverity}`);
      console.log(`Title:      ${def.title}`);
      console.log(`Description: ${def.description}`);
      if (def.suggestedFix) {
        console.log(`Suggested:  ${def.suggestedFix}`);
      }
    }
    process.exit(0);
  }

  // --validate
  if (options.validate) {
    const stdin = fs.readFileSync('/dev/stdin', 'utf-8').trim();
    if (!stdin) {
      console.log('No input provided on stdin for validation.');
      process.exit(2);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdin);
    } catch {
      const result = { valid: false, errors: ['Invalid JSON input'] };
      console.log(JSON.stringify(result, null, 2));
      process.exit(1);
    }
    const result = validatePipelineError(parsed);
    if (options.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Valid: ${result.valid}`);
      if (result.errors.length > 0) {
        console.log('Errors:');
        for (const err of result.errors) {
          console.log(`  - ${err}`);
        }
      }
    }
    process.exit(result.valid ? 0 : 1);
  }

  // --list
  if (options.list) {
    const categoryFilter = options.category;
    let codes: ErrorCodeDefinition[];

    if (categoryFilter && typeof categoryFilter === 'string') {
      const validCategories: ErrorCategory[] = ['plan', 'implementation', 'integration', 'environment', 'security', 'unknown'];
      if (!validCategories.includes(categoryFilter as ErrorCategory)) {
        console.error(`Invalid category: "${categoryFilter}". Valid: ${validCategories.join(', ')}`);
        process.exit(2);
      }
      codes = getErrorsByCategory(categoryFilter as ErrorCategory);
    } else {
      codes = ERROR_CODE_REGISTRY;
    }

    if (options.format === 'json') {
      console.log(JSON.stringify(codes, null, 2));
    } else {
      if (categoryFilter) {
        console.log(`\nError Codes (filtered by category: ${categoryFilter}):`);
      } else {
        console.log('\nAll Registered Error Codes:');
      }
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      let currentCategory = '';
      for (const def of codes) {
        if (def.category !== currentCategory) {
          currentCategory = def.category;
          console.log(`\n${currentCategory.toUpperCase()}:`);
        }
        console.log(`  ${def.errorCode} [${def.defaultSeverity}] ${def.title}`);
        console.log(`    ${def.description}`);
        if (def.suggestedFix) {
          console.log(`    Suggested: ${def.suggestedFix}`);
        }
      }
      console.log(`\nTotal: ${codes.length} error codes`);
    }
    process.exit(0);
  }

  // --report --file=<path>
  if (options.report) {
    if (!options.file || typeof options.file !== 'string') {
      console.error('--report requires --file=<path>');
      process.exit(2);
    }
    const filePath = path.resolve(options.file as string);
    // Path traversal protection
    const workspaceDir = path.resolve(process.cwd());
    if (!filePath.startsWith(workspaceDir + path.sep) && filePath !== workspaceDir) {
      console.error(`Access denied: ${filePath} is outside the workspace (${workspaceDir})`);
      process.exit(2);
    }
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(2);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    let errors: PipelineError[];

    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        errors = parsed as PipelineError[];
      } else if (parsed.errors && Array.isArray(parsed.errors)) {
        errors = parsed.errors as PipelineError[];
      } else {
        errors = [parsed as PipelineError];
      }
    } catch {
      // Try YAML-like parsing (simple line-based)
      errors = parseSimpleYamlErrors(content);
    }

    // Validate each error
    const validErrors: PipelineError[] = [];
    const validationErrors: string[] = [];
    for (const err of errors) {
      const result = validatePipelineError(err);
      if (result.valid) {
        validErrors.push(err);
      } else {
        validationErrors.push(`Error code ${err.errorCode || '(unknown)'}: ${result.errors.join('; ')}`);
      }
    }

    if (options.format === 'json') {
      console.log(
        JSON.stringify(
          {
            totalParsed: errors.length,
            validErrors: validErrors.length,
            invalidCount: validationErrors.length,
            validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
            report: generateErrorReport(validErrors),
          },
          null,
          2
        )
      );
    } else {
      if (validationErrors.length > 0) {
        console.log(`Warning: ${validationErrors.length} error(s) failed validation and were excluded:`);
        for (const ve of validationErrors) {
          console.log(`  - ${ve}`);
        }
        console.log();
      }
      console.log(generateErrorReport(validErrors));
    }
    process.exit(0);
  }

  // --export=json
  if (options.export === 'json') {
    console.log(exportRegistryAsJson());
    process.exit(0);
  }

  // --classify
  if (options.classify && typeof options.classify === 'string') {
    const classification = options.fixerClassification && typeof options.fixerClassification === 'string'
      ? options.fixerClassification
      : 'implementation-error';
    const errorCode = classifyError(options.classify, classification);
    if (options.format === 'json') {
      console.log(
        JSON.stringify({
          rootCause: options.classify,
          fixerClassification: classification,
          matchedErrorCode: errorCode,
          definition: lookupErrorCode(errorCode),
        })
      );
    } else {
      const def = lookupErrorCode(errorCode);
      console.log(`Root Cause:    "${options.classify}"`);
      console.log(`Fixer Class:   ${classification}`);
      console.log(`Matched Code:  ${errorCode}`);
      if (def) {
        console.log(`Category:      ${def.category}`);
        console.log(`Title:         ${def.title}`);
        console.log(`Description:   ${def.description}`);
      }
    }
    process.exit(0);
  }

  // No recognized command
  console.error('No recognized command. See usage:');
  printUsage();
  process.exit(2);
}

/**
 * Simple line-based YAML parser for error arrays.
 * Handles the YAML format produced by generateErrorReport.
 */
function parseSimpleYamlErrors(content: string): PipelineError[] {
  const lines = content.split('\n');
  const errors: PipelineError[] = [];
  let current: Record<string, unknown> | null = null;
  let inErrorsSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === 'errors:') {
      inErrorsSection = true;
      continue;
    }

    if (!inErrorsSection) continue;

    if (trimmed.startsWith('- errorCode:')) {
      if (current) {
        errors.push(current as unknown as PipelineError);
      }
      current = { errorCode: trimmed.split(':')[1].trim() };
    } else if (current && trimmed.startsWith('- ') && !trimmed.startsWith('- errorCode:')) {
      // File list items inside affectedFiles
      if (current.affectedFiles) {
        (current.affectedFiles as string[]).push(trimmed.substring(2).trim());
      } else {
        current.affectedFiles = [trimmed.substring(2).trim()];
      }
    } else if (current && trimmed.startsWith('    ')) {
      // Handle nested fields
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.substring(0, colonIdx).trim();
        let value: string | number | string[] = trimmed.substring(colonIdx + 1).trim();

        // Remove quotes if present
        if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
          value = value.substring(1, value.length - 1);
        }

        if (key === 'timesSeen') {
          current[key] = parseInt(value as string, 10) || 0;
        } else if (key === 'affectedFiles') {
          current[key] = [];
        } else {
          current[key] = value;
        }
      }
    }
  }

  if (current) {
    errors.push(current as unknown as PipelineError);
  }

  return errors;
}

// Run CLI if executed directly
if (require.main === module) {
  main();
}

// Re-export for convenient wildcard imports
export default {
  PipelineError: {} as PipelineError,
  ErrorCodeDefinition: {} as ErrorCodeDefinition,
  ERROR_CODE_REGISTRY,
  lookupErrorCode,
  createPipelineError,
  validatePipelineError,
  classifyError,
  getErrorsByCategory,
  formatError,
  generateErrorReport,
  exportRegistryAsJson,
};
