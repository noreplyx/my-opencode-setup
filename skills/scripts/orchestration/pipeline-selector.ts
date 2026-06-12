#!/usr/bin/env node
/**
 * Pipeline Selector — Auto-Classifier
 *
 * Analyzes a task description and classifies it into the appropriate pipeline
 * type based on keyword/pattern matching and confidence scoring. Used by the
 * Orchestrator to decide which pipeline to run for a given task.
 *
 * Classification is deterministic and based on keyword weight tables.
 * Each keyword match contributes to a confidence score (0-100).
 * Conflicting matches (e.g., "fix bug" AND "refactor") reduce confidence.
 * The pipeline with the highest confidence wins.
 *
 * Usage:
 *   [runtime] pipeline-selector.ts --description="Add a login form to the frontend"
 *   [runtime] pipeline-selector.ts --description="Fix bug in user service" --confidence=70
 *   [runtime] pipeline-selector.ts --description="Refactor auth module" --verbose
 *   [runtime] pipeline-selector.ts --description-text="Multi-line\ntask description here"
 *   [runtime] pipeline-selector.ts --description="..." --plan
 *   [runtime] pipeline-selector.ts --help
 *
 * Exit codes:
 *   0 = Successfully classified
 *   1 = Error (missing description, parse error, etc.)
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Types ────────────────────────────────────────────────────────────

/** All recognized pipeline types the selector can return. */
export type PipelineType =
  | 'ultra-quick'
  | 'quick'
  | 'review'
  | 'standard'
  | 'full'
  | 'fixer-only'
  | 'research'
  | 'docs'
  | 'tdd'
  | 'security-fix'
  | 'refactor';

/** A single pipeline alternative with its confidence score. */
export interface PipelineAlternative {
  /** Pipeline type name. */
  pipeline: PipelineType;
  /** Confidence score 0-100. */
  confidence: number;
}

/** Full classification result emitted by the selector. */
export interface ClassificationResult {
  /** Original task description that was classified. */
  description: string;
  /** The winning pipeline type. */
  classification: PipelineType;
  /** Confidence score for the winning pipeline (0-100). */
  confidence: number;
  /** Alternative pipeline candidates, sorted descending by confidence. */
  alternatives: PipelineAlternative[];
  /** Human-readable explanation of how the classification was reached. */
  rationale: string;
  /** The actual keyword patterns that matched in the description. */
  matchedKeywords: string[];
  /** Whether this pipeline type requires the Finder agent. */
  requiresFinder: boolean;
  /** Whether this pipeline type includes the Documentor agent. */
  includesDocumentor: boolean;
}

/** Internal keyword rule definition. */
interface KeywordRule {
  /** Pipeline type this rule maps to. */
  pipeline: PipelineType;
  /** Keyword / pattern to search for (lowercase). */
  keyword: string;
  /** Weight contribution when this keyword matches. */
  weight: number;
  /** Whether this match is a "strong signal" (e.g., "fix bug" is stronger than "small"). */
  strong: boolean;
}

/** Per-pipeline accumulated score during classification. */
interface PipelineScore {
  pipeline: PipelineType;
  score: number;
  matchedKeywords: string[];
  strongMatchCount: number;
}

/** Per-pipeline metadata for post-classification enrichment. */
interface PipelineMetadata {
  requiresFinder: boolean;
  includesDocumentor: boolean;
  steps: string;
  description: string;
}

// ── Constants ────────────────────────────────────────────────────────

/** Keyword → Pipeline mapping table. Ordered by specificity (most specific first). */
const KEYWORD_RULES: readonly KeywordRule[] = Object.freeze([
  // ── Research (exploration, understanding) ──
  { pipeline: 'research', keyword: 'explore',     weight: 40, strong: true  },
  { pipeline: 'research', keyword: 'understand',  weight: 35, strong: true  },
  { pipeline: 'research', keyword: 'investigate', weight: 40, strong: true  },
  { pipeline: 'research', keyword: 'research',    weight: 45, strong: true  },
  { pipeline: 'research', keyword: 'find out',    weight: 40, strong: true  },
  { pipeline: 'research', keyword: 'how does',    weight: 30, strong: false },
  { pipeline: 'research', keyword: 'what is',     weight: 20, strong: false },
  { pipeline: 'research', keyword: 'analyze',     weight: 35, strong: true  },

  // ── Docs (documentation-only tasks) ──
  { pipeline: 'docs',     keyword: 'document',    weight: 40, strong: true  },
  { pipeline: 'docs',     keyword: 'readme',      weight: 45, strong: true  },
  { pipeline: 'docs',     keyword: 'changelog',   weight: 45, strong: true  },
  { pipeline: 'docs',     keyword: 'docstring',   weight: 40, strong: true  },
  { pipeline: 'docs',     keyword: 'comment',     weight: 25, strong: false },
  { pipeline: 'docs',     keyword: 'api doc',     weight: 40, strong: true  },

  // ── Fixer-Only (bug with known root cause) ──
  { pipeline: 'fixer-only', keyword: 'fix bug',       weight: 50, strong: true  },
  { pipeline: 'fixer-only', keyword: 'bug fix',       weight: 50, strong: true  },
  { pipeline: 'fixer-only', keyword: 'known bug',     weight: 45, strong: true  },
  { pipeline: 'fixer-only', keyword: 'debug',         weight: 30, strong: false },
  { pipeline: 'fixer-only', keyword: 'root cause known', weight: 55, strong: true  },

  // ── Security Fix ──
  { pipeline: 'security-fix', keyword: 'security',      weight: 40, strong: true  },
  { pipeline: 'security-fix', keyword: 'vulnerability', weight: 50, strong: true  },
  { pipeline: 'security-fix', keyword: 'cve',           weight: 55, strong: true  },
  { pipeline: 'security-fix', keyword: 'cwe',           weight: 55, strong: true  },
  { pipeline: 'security-fix', keyword: 'patch',         weight: 30, strong: false },
  { pipeline: 'security-fix', keyword: 'exploit',       weight: 50, strong: true  },

  // ── Ultra-Quick (trivial, one-line, config) ──
  { pipeline: 'ultra-quick', keyword: 'typo',         weight: 50, strong: true  },
  { pipeline: 'ultra-quick', keyword: 'one-line',     weight: 50, strong: true  },
  { pipeline: 'ultra-quick', keyword: 'config change', weight: 45, strong: true  },
  { pipeline: 'ultra-quick', keyword: 'rename',       weight: 35, strong: false },
  { pipeline: 'ultra-quick', keyword: 'trivial',      weight: 40, strong: true  },

  // ── Quick (small, simple, minor) ──
  { pipeline: 'quick', keyword: 'small',       weight: 25, strong: false },
  { pipeline: 'quick', keyword: 'simple',      weight: 20, strong: false },
  { pipeline: 'quick', keyword: 'minor',       weight: 25, strong: false },
  { pipeline: 'quick', keyword: 'quick fix',   weight: 35, strong: true  },

  // ── TDD ──
  { pipeline: 'tdd', keyword: 'tdd',           weight: 55, strong: true  },
  { pipeline: 'tdd', keyword: 'test-driven',   weight: 55, strong: true  },
  { pipeline: 'tdd', keyword: 'tests first',   weight: 50, strong: true  },

  // ── Refactor ──
  { pipeline: 'refactor', keyword: 'refactor',     weight: 45, strong: true  },
  { pipeline: 'refactor', keyword: 'restructure',  weight: 40, strong: true  },
  { pipeline: 'refactor', keyword: 'reorganize',   weight: 35, strong: false },
  { pipeline: 'refactor', keyword: 'clean up',     weight: 25, strong: false },
  { pipeline: 'refactor', keyword: 'extract',      weight: 25, strong: false },

  // ── Full (complex, large, unfamiliar domain) ──
  { pipeline: 'full', keyword: 'complex',        weight: 35, strong: true  },
  { pipeline: 'full', keyword: 'large',          weight: 30, strong: false },
  { pipeline: 'full', keyword: 'unfamiliar',     weight: 40, strong: true  },
  { pipeline: 'full', keyword: 'multi-module',   weight: 45, strong: true  },
  { pipeline: 'full', keyword: 'cross-cutting',  weight: 40, strong: true  },
  { pipeline: 'full', keyword: 'new domain',     weight: 45, strong: true  },

  // ── Review (audit, review, check) ──
  { pipeline: 'review', keyword: 'review',       weight: 35, strong: true  },
  { pipeline: 'review', keyword: 'audit',        weight: 40, strong: true  },
  { pipeline: 'review', keyword: 'check',        weight: 15, strong: false },

  // ── Standard (feature-like, last resort before default) ──
  { pipeline: 'standard', keyword: 'add',         weight: 15, strong: false },
  { pipeline: 'standard', keyword: 'create',      weight: 15, strong: false },
  { pipeline: 'standard', keyword: 'implement',   weight: 20, strong: false },
  { pipeline: 'standard', keyword: 'build',       weight: 15, strong: false },
  { pipeline: 'standard', keyword: 'feature',     weight: 20, strong: false },
]);

/** Pipeline metadata for enriching the classification output. */
const PIPELINE_METADATA: ReadonlyMap<PipelineType, PipelineMetadata> = new Map([
  ['ultra-quick',   { requiresFinder: false, includesDocumentor: false, steps: 'Implementor -> Build',                                                  description: 'Typo fixes, one-line changes, config edits' }],
  ['quick',         { requiresFinder: false, includesDocumentor: false, steps: 'Implementor -> Build -> Lint -> QA',                                       description: 'Small bug fix, trivial feature' }],
  ['review',        { requiresFinder: false, includesDocumentor: false, steps: 'Implementor -> Build -> Lint -> Security -> QA',                           description: 'Small feature needing safety net' }],
  ['standard',      { requiresFinder: false, includesDocumentor: true,  steps: 'PlanDescriber -> Implementor -> Build -> Lint -> Security -> QA -> Verifier -> Documentor', description: 'New feature in familiar domain' }],
  ['full',          { requiresFinder: true,  includesDocumentor: true,  steps: 'Finder -> Brainstorm -> PlanDescriber -> Implementor(parallel) -> Integrator -> Build -> Lint -> Security -> QA -> Verifier -> Documentor', description: 'New feature, unfamiliar domain, complex' }],
  ['fixer-only',    { requiresFinder: false, includesDocumentor: false, steps: 'Fixer -> Build -> Lint -> Test -> QA -> Verifier',                          description: 'Bug with known root cause' }],
  ['research',      { requiresFinder: true,  includesDocumentor: false, steps: 'Finder -> report to user',                                                 description: 'Understanding code, exploring options' }],
  ['docs',          { requiresFinder: false, includesDocumentor: true,  steps: 'Documentor -> report to user',                                             description: 'Documentation only' }],
  ['tdd',           { requiresFinder: false, includesDocumentor: false, steps: 'PlanDescriber -> QA(tests) -> Implementor -> Build -> Lint -> Security -> Verifier', description: 'Test-driven development' }],
  ['security-fix',  { requiresFinder: false, includesDocumentor: false, steps: 'Implementor -> Security Scan -> QA -> Verifier',                            description: 'Patching a vulnerability' }],
  ['refactor',      { requiresFinder: false, includesDocumentor: false, steps: 'PlanDescriber -> Implementor -> Security -> QA -> Verifier',               description: 'Restructuring without behavior change' }],
]);

/** Pipelines that conflict with each other (mutually exclusive signals). */
const CONFLICT_GROUPS: ReadonlyArray<ReadonlySet<PipelineType>> = Object.freeze([
  Object.freeze(new Set<PipelineType>(['fixer-only', 'refactor'])),
  Object.freeze(new Set<PipelineType>(['research', 'docs'])),
  Object.freeze(new Set<PipelineType>(['ultra-quick', 'full'])),
  Object.freeze(new Set<PipelineType>(['security-fix', 'fixer-only'])),
]);

/** Default pipeline when no keywords match at all. */
const DEFAULT_PIPELINE: PipelineType = 'standard';

// ── Classification Logic ─────────────────────────────────────────────

/**
 * Normalize a description string: lowercase, strip punctuation, collapse
 * whitespace for reliable keyword matching.
 *
 * @param input - Raw task description
 * @returns Normalized lowercase string
 */
export function normalizeDescription(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }
  return input
    .toLowerCase()
    .replace(/[.,!?;:'"(){}[\]<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Score every pipeline type against a normalized description using the
 * keyword rule table.
 *
 * @param normalized - Lowercase, normalized task description
 * @returns Map of PipelineType → accumulated PipelineScore
 */
export function scorePipelines(normalized: string): Map<PipelineType, PipelineScore> {
  const scores = new Map<PipelineType, PipelineScore>();

  // Initialize all pipeline types with zero scores
  const allTypes: PipelineType[] = [
    'ultra-quick', 'quick', 'review', 'standard', 'full',
    'fixer-only', 'research', 'docs', 'tdd', 'security-fix', 'refactor',
  ];
  for (const t of allTypes) {
    scores.set(t, { pipeline: t, score: 0, matchedKeywords: [], strongMatchCount: 0 });
  }

  // Accumulate keyword matches
  for (const rule of KEYWORD_RULES) {
    if (normalized.includes(rule.keyword)) {
      const entry = scores.get(rule.pipeline)!;
      entry.score += rule.weight;
      entry.matchedKeywords.push(rule.keyword);
      if (rule.strong) {
        entry.strongMatchCount++;
      }
    }
  }

  return scores;
}

/**
 * Detect conflicting keywords in the description. When multiple conflict
 * groups have matches, we reduce confidence to indicate ambiguity.
 *
 * @param normalized - Normalized task description
 * @param scores - Per-pipeline scores
 * @returns Number of conflict groups that have matches
 */
export function countConflictGroups(
  normalized: string,
  scores: Map<PipelineType, PipelineScore>,
): number {
  let conflictCount = 0;

  for (const group of CONFLICT_GROUPS) {
    let matchesInGroup = 0;
    for (const pipelineType of group) {
      const entry = scores.get(pipelineType);
      if (entry && entry.matchedKeywords.length > 0) {
        matchesInGroup++;
      }
    }
    if (matchesInGroup >= 2) {
      conflictCount++;
    }
  }

  return conflictCount;
}

/**
 * Apply confidence penalty for conflicting keyword signals. The more
 * conflict groups that fire, the less certain the classification is.
 *
 * @param baseScore - Raw accumulated score
 * @param conflictCount - Number of conflicting groups detected
 * @returns Adjusted confidence (clamped 0-100)
 */
export function applyConflictPenalty(baseScore: number, conflictCount: number): number {
  if (conflictCount <= 0) {
    return Math.min(baseScore, 100);
  }
  // Each conflict group reduces confidence by 15%
  const penalty = conflictCount * 0.15;
  const adjusted = Math.round(baseScore * (1 - penalty));
  return Math.max(0, Math.min(adjusted, 100));
}

/**
 * Classify a task description into a pipeline type.
 *
 * This is the main entry point for classification logic. It:
 * 1. Normalizes the description
 * 2. Scores each pipeline based on keyword matches
 * 3. Detects conflicting signals and applies penalties
 * 4. Selects the winning pipeline
 * 5. Builds the full ClassificationResult with alternatives and rationale
 *
 * @param description - Raw task description string
 * @param userConfidence - Optional user-provided confidence floor (0-100)
 * @returns Fully populated ClassificationResult
 */
export function classify(
  description: string,
  userConfidence?: number,
): ClassificationResult {
  // Input validation
  if (!description || typeof description !== 'string' || description.trim().length === 0) {
    return {
      description: description || '',
      classification: DEFAULT_PIPELINE,
      confidence: 0,
      alternatives: [],
      rationale: 'Empty or invalid description. Falling back to standard pipeline.',
      matchedKeywords: [],
      requiresFinder: PIPELINE_METADATA.get(DEFAULT_PIPELINE)!.requiresFinder,
      includesDocumentor: PIPELINE_METADATA.get(DEFAULT_PIPELINE)!.includesDocumentor,
    };
  }

  const strippedDescription: string = description.trim();

  // Validate userConfidence
  let confidenceFloor: number | undefined;
  if (userConfidence !== undefined) {
    if (typeof userConfidence !== 'number' || Number.isNaN(userConfidence) || userConfidence < 0 || userConfidence > 100) {
      // Invalid confidence passed — ignore
      confidenceFloor = undefined;
    } else {
      confidenceFloor = userConfidence;
    }
  }

  const normalized: string = normalizeDescription(strippedDescription);
  const scores: Map<PipelineType, PipelineScore> = scorePipelines(normalized);
  const conflictCount: number = countConflictGroups(normalized, scores);

  // Convert scores to array and apply conflict penalty
  const scoredArray: Array<{ pipeline: PipelineType; confidence: number; keywords: string[] }> = [];
  for (const [, entry] of scores) {
    const confidence: number = applyConflictPenalty(entry.score, conflictCount);
    scoredArray.push({
      pipeline: entry.pipeline,
      confidence,
      keywords: entry.matchedKeywords,
    });
  }

  // Sort descending by confidence
  scoredArray.sort((a, b) => b.confidence - a.confidence);

  // The winner is the pipeline with the highest confidence
  // If tied, prefer: standard > review > quick > ultra-quick (more conservative)
  let winner: { pipeline: PipelineType; confidence: number; keywords: string[] } | null = null;

  // Group by confidence to handle ties
  const topConfidence: number = scoredArray[0]?.confidence ?? 0;

  if (topConfidence <= 0) {
    // No keywords matched at all — use default
    const defaultEntry = scoredArray.find(s => s.pipeline === DEFAULT_PIPELINE)!;
    winner = {
      pipeline: DEFAULT_PIPELINE,
      confidence: 10,
      keywords: [],
    };

    const meta = PIPELINE_METADATA.get(DEFAULT_PIPELINE)!;

    return {
      description: strippedDescription,
      classification: DEFAULT_PIPELINE,
      confidence: 10,
      alternatives: [],
      rationale: 'No classification keywords detected in the description. Falling back to standard pipeline as the default.',
      matchedKeywords: [],
      requiresFinder: meta.requiresFinder,
      includesDocumentor: meta.includesDocumentor,
    };
  }

  // Find all pipelines tied at top confidence
  const tied: Array<{ pipeline: PipelineType; confidence: number; keywords: string[] }> =
    scoredArray.filter(s => s.confidence === topConfidence);

  if (tied.length === 1) {
    winner = tied[0];
  } else {
    // Break ties by pipeline priority (most conservative first)
    const tieBreakerOrder: PipelineType[] = [
      'full', 'standard', 'tdd', 'security-fix', 'refactor',
      'fixer-only', 'review', 'research', 'docs', 'quick', 'ultra-quick',
    ];
    for (const priority of tieBreakerOrder) {
      const match = tied.find(t => t.pipeline === priority);
      if (match) {
        winner = match;
        break;
      }
    }
    // Fallback (should never happen since all types are in tieBreakerOrder)
    if (!winner) {
      winner = tied[0];
    }
  }

  // Build alternative list (all non-zero pipelines except winner)
  const alternatives: PipelineAlternative[] = scoredArray
    .filter(s => s.pipeline !== winner!.pipeline && s.confidence > 0)
    .slice(0, 5) // Top 5 alternatives max
    .map(s => ({ pipeline: s.pipeline as PipelineType, confidence: s.confidence }));

  // Apply confidence floor if provided
  let finalConfidence: number = winner.confidence;
  if (confidenceFloor !== undefined && confidenceFloor > finalConfidence) {
    finalConfidence = confidenceFloor;
    // Also ensure user confidence doesn't exceed max possible
    if (finalConfidence > 100) {
      finalConfidence = 100;
    }
  }

  // Build rationale
  const rationale: string = buildRationale(
    normalized,
    winner.pipeline,
    finalConfidence,
    winner.keywords,
    conflictCount,
  );

  const meta: PipelineMetadata = PIPELINE_METADATA.get(winner.pipeline)!;

  return {
    description: strippedDescription,
    classification: winner.pipeline,
    confidence: finalConfidence,
    alternatives,
    rationale,
    matchedKeywords: [...winner.keywords],
    requiresFinder: meta.requiresFinder,
    includesDocumentor: meta.includesDocumentor,
  };
}

/**
 * Build a human-readable rationale string explaining the classification.
 *
 * @param normalized - Normalized description text
 * @param pipeline   - The winning pipeline type
 * @param confidence - Final confidence score
 * @param keywords   - Keywords that matched for the winner
 * @param conflictCount - Number of conflicting groups detected
 * @returns Human-readable rationale paragraph
 */
export function buildRationale(
  normalized: string,
  pipeline: PipelineType,
  confidence: number,
  keywords: string[],
  conflictCount: number,
): string {
  const parts: string[] = [];

  if (keywords.length > 0) {
    const keywordList: string = keywords.map(k => `'${k}'`).join(', ');
    parts.push(`Keywords detected: ${keywordList}.`);
  } else {
    parts.push('No specific keywords matched.');
  }

  const meta: PipelineMetadata | undefined = PIPELINE_METADATA.get(pipeline);
  if (meta) {
    parts.push(`Task matches '${pipeline}' pipeline characteristics: ${meta.description}.`);
  }

  if (conflictCount > 0) {
    parts.push(`Confidence reduced due to ${conflictCount} conflicting signal group(s) (e.g., bug fix + refactor keywords both present).`);
  }

  if (confidence >= 70) {
    parts.push('Classification confidence is high.');
  } else if (confidence >= 40) {
    parts.push('Classification confidence is moderate — consider manual review.');
  } else {
    parts.push('Classification confidence is low — manual review recommended.');
  }

  return parts.join(' ');
}

// ── Plan Mode Output ─────────────────────────────────────────────────

/**
 * Generate a human-readable pipeline plan suggestion for --plan mode.
 *
 * @param result - The classification result
 * @returns Formatted multi-line plan string
 */
export function generatePlanSuggestion(result: ClassificationResult): string {
  const meta: PipelineMetadata | undefined = PIPELINE_METADATA.get(result.classification);
  if (!meta) {
    return `## Suggested Pipeline: ${result.classification}\n\n_(No step details available for this pipeline type.)_`;
  }

  const lines: string[] = [
    `## Suggested Pipeline: ${result.classification}`,
    `${meta.steps}`,
    '',
    '### When to Use',
    meta.description,
    '',
    '### Steps',
  ];

  const stepLabels: Record<string, string> = {
    'Finder': 'Explore the codebase to understand context',
    'Brainstorm': 'Generate and evaluate solution options',
    'PlanDescriber': 'Create a detailed implementation plan',
    'Implementor': 'Implement the planned changes',
    'Integrator': 'Merge parallel implementation outputs',
    'Build': 'Ensure build passes',
    'Lint': 'Ensure lint passes',
    'Security': 'Run security scan and fix findings',
    'Security Scan': 'Run security scan and fix findings',
    'QA': 'Run smoke + regression tests',
    'Verifier': 'Verify implementation against plan manifest',
    'Documentor': 'Update documentation',
    'Test': 'Run test suite',
    'report to user': 'Report findings to the user',
  };

  const steps: string[] = meta.steps.split(' -> ');
  for (let i = 0; i < steps.length; i++) {
    const stepName: string = steps[i].trim();
    const label: string = stepLabels[stepName] || `Execute ${stepName} step`;
    lines.push(`${i + 1}. **${stepName}**: ${label}`);
  }

  return lines.join('\n');
}

// ── CLI Entry Point ──────────────────────────────────────────────────

/** Configuration parsed from CLI arguments. */
interface CliConfig {
  description: string;
  verbose: boolean;
  planMode: boolean;
  userConfidence?: number;
}

/**
 * Parse CLI arguments into a typed config object.
 *
 * Supports:
 *   --description="..."       Single-line description
 *   --description-text="..."  Multi-line description (newlines preserved)
 *   --confidence=<number>     User-provided confidence floor
 *   --verbose                 Enable verbose output
 *   --plan                    Output human-readable plan suggestion
 *   --help                    Show help text
 *
 * @param args - Raw process.argv.slice(2)
 * @returns Parsed CLI configuration
 */
export function parseCliArgs(args: string[]): CliConfig {
  const config: CliConfig = { description: '', verbose: false, planMode: false };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }

    if (arg.startsWith('--description=')) {
      config.description = arg.slice('--description='.length);
    } else if (arg.startsWith('--description-text=')) {
      config.description = arg.slice('--description-text='.length);
    } else if (arg.startsWith('--confidence=')) {
      const val: string = arg.slice('--confidence='.length);
      const parsed: number = parseInt(val, 10);
      if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 100) {
        config.userConfidence = parsed;
      }
      // Invalid values are silently ignored (the classify function will also validate)
    } else if (arg === '--verbose') {
      config.verbose = true;
    } else if (arg === '--plan') {
      config.planMode = true;
    }
  }

  return config;
}

/**
 * Print the help text to stdout.
 */
export function printHelp(): void {
  const help: string = `Pipeline Selector — Auto-Classify Task Descriptions

USAGE:
  ${getScriptName()} --description="Add a login form to the frontend"
  ${getScriptName()} --description="Fix bug in user service" --confidence=70
  ${getScriptName()} --description="Refactor auth module" --verbose
  ${getScriptName()} --description-text="Multi-line
  task description here"
  ${getScriptName()} --description="..." --plan
  ${getScriptName()} --help

ARGUMENTS:
  --description=<text>        Single-line task description to classify
  --description-text=<text>   Multi-line task description (newlines preserved)
  --confidence=<0-100>        Optional user-provided confidence floor
  --verbose                   Print verbose classification details to stderr
  --plan                      Also output a human-readable pipeline plan suggestion
  --help, -h                  Show this help message

OUTPUT:
  JSON object with fields:
    description       - The original task description
    classification    - The winning pipeline type
    confidence        - Confidence score (0-100)
    alternatives      - Alternative pipeline candidates
    rationale         - Human-readable explanation
    matchedKeywords   - Keyword patterns that matched
    requiresFinder    - Whether this pipeline needs the Finder agent
    includesDocumentor - Whether this pipeline includes documentation

PIPELINE TYPES:
  ultra-quick    Implementor -> Build
  quick          Implementor -> Build -> Lint -> QA
  review         Implementor -> Build -> Lint -> Security -> QA
  standard       PlanDescriber -> Implementor -> Build -> Lint -> Security -> QA -> Verifier -> Documentor
  full           Finder -> Brainstorm -> PlanDescriber -> Implementor(parallel) -> Integrator -> Build -> Lint -> Security -> QA -> Verifier -> Documentor
  fixer-only     Fixer -> Build -> Lint -> Test -> QA -> Verifier
  research       Finder -> report to user
  docs           Documentor -> report to user
  tdd            PlanDescriber -> QA(tests) -> Implementor -> Build -> Lint -> Security -> Verifier
  security-fix   Implementor -> Security Scan -> QA -> Verifier
  refactor       PlanDescriber -> Implementor -> Security -> QA -> Verifier

EXIT CODES:
  0  Successfully classified
  1  Error (missing description, parse error, etc.)
`;
  console.log(help);
}

/**
 * Get the script name for help text display.
 *
 * @returns The script filename (e.g., "pipeline-selector.ts")
 */
function getScriptName(): string {
  try {
    return path.basename(process.argv[1] || 'pipeline-selector.ts');
  } catch {
    return 'pipeline-selector.ts';
  }
}

/**
 * Main entry point.
 *
 * Parses CLI args, validates input, performs classification, and emits
 * the JSON result to stdout. In verbose mode, also writes diagnostic
 * info to stderr.
 */
function main(): void {
  try {
    const args: string[] = process.argv.slice(2);

    // --help check
    if (args.includes('--help') || args.includes('-h')) {
      printHelp();
      process.exit(0);
    }

    // Parse arguments
    const config: CliConfig = parseCliArgs(args);

    // Validate that we got a description
    if (!config.description || config.description.trim().length === 0) {
      console.error('ERROR: No description provided. Use --description="..." or --description-text="...".');
      console.error('       Run with --help for usage information.');
      process.exit(1);
    }

    // Perform classification
    const result: ClassificationResult = classify(
      config.description,
      config.userConfidence,
    );

    // Verbose output to stderr (diagnostics, not part of JSON contract)
    if (config.verbose) {
      console.error(`[pipeline-selector] Description: "${config.description.slice(0, 200)}${config.description.length > 200 ? '...' : ''}"`);
      console.error(`[pipeline-selector] Classification: ${result.classification}`);
      console.error(`[pipeline-selector] Confidence: ${result.confidence}`);
      console.error(`[pipeline-selector] Matched keywords: ${result.matchedKeywords.length > 0 ? result.matchedKeywords.join(', ') : '(none)'}`);
      console.error(`[pipeline-selector] Alternatives: ${result.alternatives.map(a => `${a.pipeline}(${a.confidence})`).join(', ') || '(none)'}`);
      console.error(`[pipeline-selector] Rationale: ${result.rationale}`);
    }

    // Output JSON result (machine-readable, always to stdout)
    const output: string = JSON.stringify(result, null, 2);

    if (config.planMode) {
      // In plan mode, output JSON first, then plan suggestion
      console.log(output);
      console.log('');
      console.log(generatePlanSuggestion(result));
    } else {
      console.log(output);
    }

    process.exit(0);
  } catch (error: unknown) {
    const errorMessage: string = error instanceof Error ? error.message : String(error);
    console.error(`ERROR: Pipeline classification failed: ${errorMessage}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
