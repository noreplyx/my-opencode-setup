#!/usr/bin/env node
/**
 * agent-context.md Validator
 * 
 * Validates that agent-context.md conforms to the formal schema defined in shared/types.ts.
 * Called by every agent at step 0 before reading context.
 * 
 * Usage: [runtime] skills/scripts/orchestration/validate-context.ts [--context=agent-context.md]
 * 
 * Returns: JSON with valid (boolean), errors (string[]), warnings (string[])
 * Exit code: 0 = valid, 1 = invalid
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ── Types (inlined to avoid import issues at runtime) ─────────────

type AgentName =
  | 'orchestrator' | 'finder' | 'plandescriber' | 'implementor'
  | 'fixer' | 'qa' | 'verifier' | 'merge-coordinator'
  | 'integrator' | 'browser-tester' | 'documentor' | 'security-scan';

type PipelineType = 'full' | 'quick' | 'fixer-only' | 'documentation'
  | 'parallel' | 'tdd' | 'refactor' | 'micro-pipeline' | 'research';

type PipelineStatus = 'running' | 'completed' | 'failed' | 'stale';

type CircuitBreakerState = 'closed' | 'open' | 'half-open';

type CircuitBreakerGate = 'build' | 'lint' | 'securityScan' | 'smokeTest' | 'verifier';

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  parsedContext?: Record<string, unknown>;
  fileHash?: string;
}

// ── Schema Definitions ────────────────────────────────────────────

const REQUIRED_FIELDS: Array<{ field: string; type: string; description: string }> = [
  { field: 'pipelineId', type: 'string', description: 'Unique pipeline identifier' },
  { field: 'feature', type: 'string', description: 'Feature name' },
  { field: 'pipelineType', type: 'string', description: 'Type of pipeline' },
  { field: 'currentStep', type: 'string', description: 'Current agent step' },
  { field: 'status', type: 'string', description: 'Pipeline status (running/completed/failed/stale)' },
  { field: 'createdAt', type: 'string', description: 'ISO-8601 creation timestamp' },
  { field: 'agentHistory', type: 'array', description: 'Array of agent history entries' },
  { field: 'agentOutputs', type: 'object', description: 'Map of agent outputs' },
  { field: 'circuitBreaker', type: 'object', description: 'Circuit breaker config' },
  { field: 'gitState', type: 'object', description: 'Git state tracking' },
  { field: 'nextObjective', type: 'string', description: 'Next task objective' },
];

const VALID_PIPELINE_TYPES: PipelineType[] = [
  'full', 'quick', 'fixer-only', 'documentation',
  'parallel', 'tdd', 'refactor', 'micro-pipeline', 'research',
];

const VALID_STATUSES: PipelineStatus[] = ['running', 'completed', 'failed', 'stale'];

const VALID_AGENT_NAMES: AgentName[] = [
  'orchestrator', 'finder', 'plandescriber', 'implementor',
  'fixer', 'qa', 'verifier', 'merge-coordinator',
  'integrator', 'browser-tester', 'documentor', 'security-scan',
];

const VALID_CIRCUIT_BREAKER_GATES: CircuitBreakerGate[] = [
  'build', 'lint', 'securityScan', 'smokeTest', 'verifier',
];

const VALID_CIRCUIT_BREAKER_STATES: CircuitBreakerState[] = ['closed', 'open', 'half-open'];

// ── Parsing ───────────────────────────────────────────────────────

function parseFrontmatter(content: string): { frontmatter: string | null; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { frontmatter: null, body: content };
  }
  return { frontmatter: match[1], body: content.slice(match[0].length) };
}

function parseYamlSimple(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');
  const stack: Array<{ key: string; obj: Record<string, unknown> }> = [];
  const indentStack: number[] = [];
  let currentIndent = 0;

  // First pass: detect indentation
  const indentSize = detectIndent(lines);
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    const indent = line.search(/\S|$/);
    
    // Pop stack until we find the right parent
    while (indentStack.length > 0 && indentStack[indentStack.length - 1] >= indent) {
      stack.pop();
      indentStack.pop();
    }
    
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    
    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    
    if (value === '' || value === '|' || value === '>') {
      // Object or array starts
      const newObj: Record<string, unknown> = {};
      const parent = stack.length > 0 ? stack[stack.length - 1].obj : result;
      parent[key] = newObj;
      stack.push({ key, obj: newObj });
      indentStack.push(indent);
      currentIndent = indent;
      
      // Handle inline arrays: key:\n  - item1\n  - item2
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const nextTrimmed = nextLine.trim();
        if (nextTrimmed.startsWith('- ')) {
          const arr: unknown[] = [];
          parent[key] = arr;
          stack[stack.length - 1].obj = arr as unknown as Record<string, unknown>;
        }
      }
    } else {
      // Scalar value
      const parent = stack.length > 0 ? stack[stack.length - 1].obj : result;
      parent[key] = parseScalar(value);
    }
  }
  
  return result;
}

function detectIndent(lines: string[]): number {
  for (const line of lines) {
    const indent = line.search(/\S|$/);
    if (indent > 0) return indent;
  }
  return 2;
}

function parseScalar(value: string): unknown {
  if (value === '{}') return {};
  if (value === '[]') return [];
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  if (/^\d+\.\d+$/.test(value)) return parseFloat(value);
  if ((value.startsWith('"') && value.endsWith('"')) || 
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function computeHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

// ── Validation ────────────────────────────────────────────────────

function validateContext(obj: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Check required top-level fields
  for (const req of REQUIRED_FIELDS) {
    const value = obj[req.field];
    if (value === undefined || value === null) {
      errors.push(`Missing required field: "${req.field}" (${req.description})`);
      continue;
    }
    
    if (req.type === 'string' && typeof value !== 'string') {
      errors.push(`Field "${req.field}" must be a string, got ${typeof value}`);
    } else if (req.type === 'array' && !Array.isArray(value)) {
      errors.push(`Field "${req.field}" must be an array, got ${typeof value}`);
    } else if (req.type === 'object' && (typeof value !== 'object' || Array.isArray(value) || value === null)) {
      errors.push(`Field "${req.field}" must be an object, got ${typeof value}`);
    }
  }

  // 2. Validate pipelineType
  if (obj.pipelineType && !VALID_PIPELINE_TYPES.includes(obj.pipelineType as PipelineType)) {
    errors.push(`Invalid pipelineType: "${obj.pipelineType}". Must be one of: ${VALID_PIPELINE_TYPES.join(', ')}`);
  }

  // 3. Validate status
  if (obj.status && !VALID_STATUSES.includes(obj.status as PipelineStatus)) {
    errors.push(`Invalid status: "${obj.status}". Must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  // 4. Validate currentStep
  if (obj.currentStep && !VALID_AGENT_NAMES.includes(obj.currentStep as AgentName)) {
    warnings.push(`Unknown agent name in currentStep: "${obj.currentStep}". Expected one of: ${VALID_AGENT_NAMES.join(', ')}`);
  }

  // 5. Validate circuitBreaker
  if (obj.circuitBreaker && typeof obj.circuitBreaker === 'object') {
    const cb = obj.circuitBreaker as Record<string, unknown>;
    
    if (cb.state && !VALID_CIRCUIT_BREAKER_STATES.includes(cb.state as CircuitBreakerState)) {
      errors.push(`Invalid circuitBreaker.state: "${cb.state}". Must be one of: ${VALID_CIRCUIT_BREAKER_STATES.join(', ')}`);
    }
    
    if (cb.counters && typeof cb.counters === 'object') {
      for (const gate of VALID_CIRCUIT_BREAKER_GATES) {
        const val = (cb.counters as Record<string, unknown>)[gate];
        if (val !== undefined && typeof val !== 'number') {
          errors.push(`circuitBreaker.counters.${gate} must be a number, got ${typeof val}`);
        }
      }
    }
    
    if (cb.thresholds && typeof cb.thresholds === 'object') {
      for (const gate of VALID_CIRCUIT_BREAKER_GATES) {
        const val = (cb.thresholds as Record<string, unknown>)[gate];
        if (val !== undefined && typeof val !== 'number') {
          errors.push(`circuitBreaker.thresholds.${gate} must be a number, got ${typeof val}`);
        }
      }
    }
  }

  // 6. Validate agentHistory
  if (Array.isArray(obj.agentHistory)) {
    for (let i = 0; i < obj.agentHistory.length; i++) {
      const entry = obj.agentHistory[i] as Record<string, unknown>;
      if (!entry.step) {
        errors.push(`agentHistory[${i}].step is required`);
      } else if (!VALID_AGENT_NAMES.includes(entry.step as AgentName)) {
        warnings.push(`agentHistory[${i}] has unknown step name: "${entry.step}"`);
      }
      if (!entry.result) {
        errors.push(`agentHistory[${i}].result is required`);
      }
      if (!entry.agent) {
        warnings.push(`agentHistory[${i}] missing agent session ID`);
      }
    }
  }

  // 7. Validate agentOutputs
  if (obj.agentOutputs && typeof obj.agentOutputs === 'object') {
    for (const [agentName, output] of Object.entries(obj.agentOutputs as Record<string, unknown>)) {
      if (typeof output !== 'object' || output === null) continue;
      const out = output as Record<string, unknown>;
      if (out.status && !['completed', 'failed', 'partial'].includes(out.status as string)) {
        errors.push(`agentOutputs.${agentName}.status invalid: "${out.status}"`);
      }
    }
  }

  // 8. Validate gitState
  if (obj.gitState && typeof obj.gitState === 'object') {
    const git = obj.gitState as Record<string, unknown>;
    if (git.branch !== undefined && typeof git.branch !== 'string') {
      errors.push('gitState.branch must be a string');
    }
    if (git.dirtyFiles !== undefined && !Array.isArray(git.dirtyFiles)) {
      errors.push('gitState.dirtyFiles must be an array');
    }
    if (git.lastCommitSha !== undefined && typeof git.lastCommitSha !== 'string') {
      errors.push('gitState.lastCommitSha must be a string');
    }
  }

  // 9. Validate timestamp fields
  if (obj.createdAt && typeof obj.createdAt === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}T/.test(obj.createdAt)) {
      warnings.push('createdAt does not appear to be ISO-8601 format');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    parsedContext: obj,
  };
}

// ── CLI Entry Point ──────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const contextPath = args.find(a => a.startsWith('--context='))?.split('=')[1] || 'agent-context.md';
  
  if (!fs.existsSync(contextPath)) {
    const result: ValidationResult = {
      valid: false,
      errors: [`File not found: ${contextPath}`],
      warnings: [],
    };
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  
  const content = fs.readFileSync(contextPath, 'utf-8');
  const hash = computeHash(content);
  const { frontmatter } = parseFrontmatter(content);
  
  if (!frontmatter) {
    const result: ValidationResult = {
      valid: false,
      errors: ['No YAML frontmatter found (must start with ---)'],
      warnings: [],
      fileHash: hash,
    };
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  
  const parsed = parseYamlSimple(frontmatter);
  
  // Merge list-valued fields (YAML lists like agentHistory)
  // This is a simplification — the parseYamlSimple handles basic cases
  const result = validateContext(parsed);
  result.fileHash = hash;
  
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.valid ? 0 : 1);
}

if (require.main === module) {
  main();
}
