#!/usr/bin/env node
/**
 * Output Contract Validator
 *
 * Validates whether a subagent's output follows the structured output contract
 * defined in the orchestration system.
 *
 * Usage:
 *   ts-node validate-output-contract.ts --file=<path>
 *   ts-node validate-output-contract.ts --agent=<finder|implementor|fixer|plandescriber|verifier|qa|browser-tester>
 *   ts-node validate-output-contract.ts --pipeline
 *
 * Exit codes:
 *   0 = valid
 *   1 = validation failed
 *   2 = file not found
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Types ──

export type AgentName = 'finder' | 'implementor' | 'fixer' | 'plandescriber' | 'verifier' | 'qa' | 'browser-tester';
export type FieldType = 'string' | 'boolean' | 'null' | 'array' | 'object' | 'string[]' | 'number';
export type ValidationStatus = 'valid' | 'invalid' | 'partial';

export interface ValidationIssue {
  type: 'error' | 'warning';
  message: string;
}

export interface ValidationResult {
  agentName: AgentName | 'pipeline' | 'unknown';
  valid: boolean;
  score: { passed: number; total: number };
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  filePath?: string;
}

export interface FieldRule {
  name: string;
  type: FieldType;
  required: boolean;
  /** For array types, check the type of elements */
  elementType?: FieldType;
  /** Nested fields to validate */
  children?: FieldRule[];
  /** If true, the field is expected to be present but can be null */
  nullable?: boolean;
}

export interface AgentSchema {
  agentName: AgentName;
  topLevelFields: FieldRule[];
  agentOutputsFields: FieldRule[];
  /** Additional checks beyond field presence/types */
  additionalChecks?: (parsed: Record<string, unknown>) => ValidationIssue[];
}

// ── Schema Definitions ──

const PIPELINE_ERROR_CHILDREN: FieldRule[] = [
  { name: 'errorCode', type: 'string', required: true },
  { name: 'category', type: 'string', required: true },
  { name: 'severity', type: 'string', required: true },
  { name: 'detector', type: 'string', required: false },
  { name: 'checkpointId', type: 'string', required: false },
  { name: 'rootCause', type: 'string', required: true },
  { name: 'reproduction', type: 'string', required: false },
  { name: 'firstSeenSession', type: 'string', required: false },
  { name: 'timesSeen', type: 'number', required: false },
];

const ROLLBACK_CHILDREN: FieldRule[] = [
  { name: 'checkpointCommit', type: 'string', required: true },
  { name: 'rollbackCommand', type: 'string', required: true },
  { name: 'filesChanged', type: 'array', required: false, elementType: 'string' },
];

const BASE_TOP_LEVEL_FIELDS: FieldRule[] = [
  { name: 'status', type: 'string', required: true },
  { name: 'resultSummary', type: 'string', required: true },
  { name: 'evidence', type: 'array', required: true, elementType: 'object' },
  { name: 'decisions', type: 'array', required: true, elementType: 'object' },
  { name: 'warnings', type: 'array', required: true, elementType: 'string' },
  { name: 'changedFiles', type: 'array', required: true, elementType: 'string' },
  { name: 'artifacts', type: 'array', required: true, elementType: 'string' },
  // v2.0 fields (optional)
  { name: 'pipelineError', type: 'object', required: false, children: PIPELINE_ERROR_CHILDREN },
  { name: 'sources', type: 'array', required: false, elementType: 'object' },
  { name: 'rollback', type: 'object', required: false, children: ROLLBACK_CHILDREN },
  { name: 'diagnostics', type: 'array', required: false, elementType: 'object' },
  { name: 'checkpointResults', type: 'array', required: false, elementType: 'object' },
];

const AGENT_OUTPUT_BASE_FIELDS: FieldRule[] = [
  { name: 'status', type: 'string', required: true },
  { name: 'resultSummary', type: 'string', required: true },
  { name: 'buildPassed', type: 'boolean', required: true, nullable: true },
  { name: 'lintPassed', type: 'boolean', required: true, nullable: true },
  { name: 'buildOutput', type: 'string', required: true, nullable: true },
  { name: 'lintOutput', type: 'string', required: true, nullable: true },
];

const SCHEMAS: AgentSchema[] = [
  // ── Finder ──
  {
    agentName: 'finder',
    topLevelFields: [...BASE_TOP_LEVEL_FIELDS],
    agentOutputsFields: [
      { name: 'status', type: 'string', required: true },
      { name: 'resultSummary', type: 'string', required: true },
      { name: 'buildPassed', type: 'null', required: true },
      { name: 'lintPassed', type: 'null', required: true },
    ],
    additionalChecks: (parsed: Record<string, unknown>) => {
      const issues: ValidationIssue[] = [];
      const output = parsed.agentOutputs as Record<string, unknown> | undefined;
      const finder = output?.finder as Record<string, unknown> | undefined;
      if (finder && finder.buildPassed !== null) {
        issues.push({ type: 'warning', message: `finder.buildPassed should be null (read-only agent); got ${typeof finder.buildPassed}` });
      }
      const topDecisions = parsed.decisions as Array<Record<string, unknown>> | undefined;
      if (!topDecisions || topDecisions.length === 0) {
        issues.push({ type: 'warning', message: 'decisions is empty — Finder should report exploration decisions' });
      }
      return issues;
    },
  },
  // ── Implementor ──
  {
    agentName: 'implementor',
    topLevelFields: [...BASE_TOP_LEVEL_FIELDS],
    agentOutputsFields: [
      { name: 'status', type: 'string', required: true },
      { name: 'resultSummary', type: 'string', required: true },
      { name: 'buildPassed', type: 'boolean', required: true },
      { name: 'lintPassed', type: 'boolean', required: true, nullable: true },
      { name: 'buildOutput', type: 'string', required: true, nullable: true },
      { name: 'lintOutput', type: 'string', required: true, nullable: true },
      { name: 'wiringManifest', type: 'object', required: false, children: [
        { name: 'exports', type: 'array', required: false, elementType: 'string' },
        { name: 'classes', type: 'array', required: false, elementType: 'string' },
        { name: 'diRequirements', type: 'array', required: false, elementType: 'string' },
        { name: 'barrelExports', type: 'array', required: false, elementType: 'string' },
      ]},
    ],
    additionalChecks: (parsed: Record<string, unknown>) => {
      const issues: ValidationIssue[] = [];
      const output = parsed.agentOutputs as Record<string, unknown> | undefined;
      const impl = output?.implementor as Record<string, unknown> | undefined;
      if (impl && typeof impl.buildPassed === 'boolean' && !impl.buildPassed) {
        issues.push({ type: 'warning', message: 'implementor.buildPassed is false — build failed' });
      }
      const changed = parsed.changedFiles as string[] | undefined;
      if (!changed || changed.length === 0) {
        issues.push({ type: 'warning', message: 'changedFiles is empty — Implementor should report files created/modified' });
      }
      // Validate wiringManifest if present
      const wiring = (impl && typeof impl === 'object') ? (impl as Record<string, unknown>).wiringManifest : undefined;
      if (wiring && typeof wiring === 'object') {
        const wm = wiring as Record<string, unknown>;
        if (!Array.isArray(wm.exports)) {
          issues.push({ type: 'warning', message: 'wiringManifest.exports should be a string[]' });
        }
        if (!Array.isArray(wm.classes)) {
          issues.push({ type: 'warning', message: 'wiringManifest.classes should be a string[]' });
        }
      }
      return issues;
    },
  },
  // ── Fixer ──
  {
    agentName: 'fixer',
    topLevelFields: [...BASE_TOP_LEVEL_FIELDS],
    agentOutputsFields: [
      { name: 'status', type: 'string', required: true },
      { name: 'resultSummary', type: 'string', required: true },
      { name: 'buildPassed', type: 'boolean', required: true },
      { name: 'lintPassed', type: 'boolean', required: true, nullable: true },
      { name: 'buildOutput', type: 'string', required: true, nullable: true },
      { name: 'lintOutput', type: 'string', required: true, nullable: true },
      { name: 'diagnostics', type: 'array', required: false, elementType: 'object' },
      {
        name: 'rootCauseAnalysis',
        type: 'object',
        required: true,
        children: [
          { name: 'classification', type: 'string', required: true },
          { name: 'fixConfidence', type: 'number', required: true },
          { name: 'crossModuleCheck', type: 'array', required: true, elementType: 'object' },
        ],
      },
    ],
    additionalChecks: (parsed: Record<string, unknown>) => {
      const issues: ValidationIssue[] = [];
      const output = parsed.agentOutputs as Record<string, unknown> | undefined;
      const fixer = output?.fixer as Record<string, unknown> | undefined;
      if (fixer && typeof fixer.buildPassed === 'boolean' && !fixer.buildPassed) {
        issues.push({ type: 'warning', message: 'fixer.buildPassed is false — fix did not compile' });
      }
      if (fixer && fixer.rootCauseAnalysis) {
        const rca = fixer.rootCauseAnalysis as Record<string, unknown>;
        const confidence = rca.fixConfidence;
        if (typeof confidence === 'number' && confidence < 5) {
          issues.push({ type: 'warning', message: `fixer.rootCauseAnalysis.fixConfidence is ${confidence} — low confidence fix` });
        }
        const classification = rca.classification;
        const validClassifications = [
          'logic-error', 'integration-error', 'type-error',
          'missing-implementation', 'side-effect', 'plan-omission',
          'implementation-error', 'edge-case-miss',
        ];
        if (typeof classification === 'string' && !validClassifications.includes(classification)) {
          issues.push({ type: 'warning', message: `fixer.rootCauseAnalysis.classification "${classification}" is non-standard; expected one of: ${validClassifications.join(', ')}` });
        }
      }
      const changed = parsed.changedFiles as string[] | undefined;
      if (!changed || changed.length === 0) {
        issues.push({ type: 'warning', message: 'changedFiles is empty — Fixer should report modified files' });
      }
      const decs = parsed.decisions as Array<Record<string, unknown>> | undefined;
      if (!decs || decs.length === 0) {
        issues.push({ type: 'warning', message: 'decisions is empty — Fixer should report root cause decisions' });
      }
      return issues;
    },
  },
  // ── PlanDescriber ──
  {
    agentName: 'plandescriber',
    topLevelFields: [...BASE_TOP_LEVEL_FIELDS],
    agentOutputsFields: [
      { name: 'status', type: 'string', required: true },
      { name: 'resultSummary', type: 'string', required: true },
      { name: 'buildPassed', type: 'null', required: true },
      { name: 'lintPassed', type: 'null', required: true },
    ],
    additionalChecks: (parsed: Record<string, unknown>) => {
      const issues: ValidationIssue[] = [];
      const changed = parsed.changedFiles as string[] | undefined;
      if (!changed || changed.length === 0) {
        issues.push({ type: 'error', message: 'changedFiles is empty — PlanDescriber must include plan manifest paths' });
      } else {
        const hasManifest = changed.some(f => f.includes('manifest') || f.includes('plan-manifests'));
        if (!hasManifest) {
          issues.push({ type: 'warning', message: 'changedFiles should contain plan manifest paths (e.g., plan-manifests/<feature>/v<version>-manifest.json)' });
        }
      }
      const decs = parsed.decisions as Array<Record<string, unknown>> | undefined;
      if (!decs || decs.length === 0) {
        issues.push({ type: 'warning', message: 'decisions is empty — PlanDescriber should report architectural decisions' });
      }
      return issues;
    },
  },
  // ── Verifier ──
  {
    agentName: 'verifier',
    topLevelFields: [...BASE_TOP_LEVEL_FIELDS],
    agentOutputsFields: [
      { name: 'status', type: 'string', required: true },
      { name: 'resultSummary', type: 'string', required: true },
      { name: 'buildPassed', type: 'null', required: true },
      { name: 'lintPassed', type: 'null', required: true },
      { name: 'buildOutput', type: 'null', required: true },
      { name: 'lintOutput', type: 'null', required: true },
      { name: 'suggestedCheckpoints', type: 'array', required: false, elementType: 'object' },
      { name: 'driftDetection', type: 'object', required: false },
      { name: 'checkpointResults', type: 'array', required: false, elementType: 'object' },
    ],
  },
  // ── QA ──
  {
    agentName: 'qa',
    topLevelFields: [...BASE_TOP_LEVEL_FIELDS],
    agentOutputsFields: [
      { name: 'status', type: 'string', required: true },
      { name: 'resultSummary', type: 'string', required: true },
      { name: 'buildPassed', type: 'null', required: true },
      { name: 'lintPassed', type: 'null', required: true },
    ],
    additionalChecks: (parsed: Record<string, unknown>) => {
      const issues: ValidationIssue[] = [];
      const changed = parsed.changedFiles as string[] | undefined;
      if (!changed || changed.length === 0) {
        issues.push({ type: 'warning', message: 'changedFiles is empty — QA should report test files created/modified' });
      } else {
        const hasTestFile = changed.some(f => f.includes('test') || f.includes('spec') || f.includes('fixture'));
        if (!hasTestFile) {
          issues.push({ type: 'warning', message: 'changedFiles should contain test file paths (e.g., tests/path/to/test-file.ts)' });
        }
      }
      const decs = parsed.decisions as Array<Record<string, unknown>> | undefined;
      if (!decs || decs.length === 0) {
        issues.push({ type: 'warning', message: 'decisions is empty — QA should report test-related decisions' });
      }
      return issues;
    },
  },
  // ── BrowserTester ──
  {
    agentName: 'browser-tester',
    topLevelFields: [...BASE_TOP_LEVEL_FIELDS],
    agentOutputsFields: [
      { name: 'status', type: 'string', required: true },
      { name: 'resultSummary', type: 'string', required: true },
      { name: 'buildPassed', type: 'null', required: true },
      { name: 'lintPassed', type: 'null', required: true },
    ],
    additionalChecks: (parsed: Record<string, unknown>) => {
      const issues: ValidationIssue[] = [];
      const changed = parsed.changedFiles as string[] | undefined;
      if (!changed || changed.length === 0) {
        issues.push({ type: 'warning', message: 'changedFiles is empty — BrowserTester should report test scripts' });
      } else {
        const hasTestScript = changed.some(f => f.includes('.spec.') || f.includes('.test.'));
        if (!hasTestScript) {
          issues.push({ type: 'warning', message: 'changedFiles should contain test script files (e.g., tests/path/to/test-script.spec.ts)' });
        }
      }
      return issues;
    },
  },
];

// ── Simple YAML Parser (no external deps) ──

/**
 * Parse YAML frontmatter from a file's content.
 * Looks for content between first `---` and second `---` markers.
 * Returns a flat key-value map with basic type coercion.
 */
function parseYamlFrontmatter(content: string): Record<string, unknown> | null {
  // Extract frontmatter between --- markers
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;

  const yamlBlock = match[1];
  return parseYamlBlock(yamlBlock);
}

/**
 * Parse a YAML block (string without the --- markers) into a nested object.
 * Uses a two-phase approach for correctness:
 *
 * Phase 1: Build a tree of "nodes" where each node knows its indent level,
 *          its key, its type (scalar/object/array), and whether it was
 *          declared with empty value (placeholder for array or object).
 *
 * Phase 2: Convert the tree of nodes into the final nested structure.
 *
 * Supports:
 *   - Simple key: value pairs (strings, numbers, booleans, null)
 *   - Nested key: value with indentation
 *   - Arrays with `- ` prefix (scalar and object elements)
 *   - Inline arrays like `[]` and inline objects like `{}`
 *   - Quoted strings (double and single)
 */
function parseYamlBlock(yamlBlock: string): Record<string, unknown> {
  const lines = yamlBlock.split('\n');

  // ── Phase 1: Tokenize into a flat list of entries ──
  interface Entry {
    indent: number;
    /** The raw text, trimmed */
    text: string;
    /** True if this line starts with `- ` */
    isArrayElement: boolean;
    /** For key:value lines: the key */
    key?: string;
    /** For key:value lines: the raw value string */
    rawValue?: string;
  }

  const entries: Entry[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const indent = rawLine.search(/\S/);
    const isArrayElement = /^-\s/.test(trimmed);

    let key: string | undefined;
    let rawValue: string | undefined;

    if (!isArrayElement) {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx !== -1) {
        key = trimmed.slice(0, colonIdx).trim();
        rawValue = trimmed.slice(colonIdx + 1).trim();
      } else {
        // Line without colon — skip (shouldn't happen in well-formed YAML)
        continue;
      }
    }

    entries.push({ indent, text: trimmed, isArrayElement, key, rawValue });
  }

  // ── Phase 2: Build node tree from flat entries ──
  // Each node is either:
  //   { type: 'scalar', value: ... }
  //   { type: 'object', children: {...} }
  //   { type: 'array', items: [...] }

  interface ScalarNode { type: 'scalar'; value: unknown }
  interface ObjectNode { type: 'object'; children: Record<string, Node> }
  interface ArrayNode { type: 'array'; items: Node[] }
  type Node = ScalarNode | ObjectNode | ArrayNode;

  function buildNode(entryIdx: number, parentIndent: number): { node: Node; nextIdx: number } {
    const entry = entries[entryIdx];
    if (!entry) {
      return { node: { type: 'scalar', value: null }, nextIdx: entryIdx };
    }

    // Array elements at this level
    if (entry.isArrayElement) {
      const items: Node[] = [];
      let idx = entryIdx;
      while (idx < entries.length && entries[idx].isArrayElement && entries[idx].indent === entry.indent) {
        const currentEntry = entries[idx];
        const afterDash = currentEntry.text.replace(/^-\s*/, '');
        const colonIdx = afterDash.indexOf(':');

        if (colonIdx !== -1 && colonIdx > 0) {
          // `- key: value` or `- key:` — this is an object
          const elemKey = afterDash.slice(0, colonIdx).trim();
          const elemValue = afterDash.slice(colonIdx + 1).trim();
          const objChildren: Record<string, Node> = {};

          if (elemValue === '') {
            // `- key:` — children follow on indented lines
            const { node: childNode, nextIdx } = buildNode(idx + 1, entry.indent + 2);
            objChildren[elemKey] = childNode;
            items.push({ type: 'object', children: objChildren });
            idx = nextIdx;
            // After the nested object, there may be more sibling keys at same indent as `-`
            while (idx < entries.length &&
                   !entries[idx].isArrayElement &&
                   entries[idx].indent === entry.indent + 2) {
              const sk = entries[idx];
              if (sk.key) {
                const { node: valNode, nextIdx: ni } = buildScalarOrChild(idx, entry.indent + 2);
                const lastObj = items[items.length - 1];
                if (lastObj.type === 'object') {
                  lastObj.children[sk.key] = valNode;
                }
                idx = ni;
              } else {
                idx++;
              }
            }
            // Also handle sibling keys at indent 0 (relative to array)?
            // They'll be caught at the same indent as the `- `
            // But for now, continue
          } else {
            // `- key: value` — this array element object has just this key
            const val = parseScalar(elemValue);
            objChildren[elemKey] = { type: 'scalar', value: val };
            items.push({ type: 'object', children: objChildren });
            idx++;

            // Check if subsequent lines at indent = entry.indent + 2 are more keys for this object
            while (idx < entries.length &&
                   !entries[idx].isArrayElement &&
                   entries[idx].indent === entry.indent + 2) {
              const sk = entries[idx];
              if (sk.key) {
                const { node: valNode, nextIdx: ni } = buildScalarOrChild(idx, entry.indent + 2);
                const lastObj = items[items.length - 1];
                if (lastObj.type === 'object') {
                  lastObj.children[sk.key] = valNode;
                }
                idx = ni;
              } else {
                idx++;
              }
            }
          }
        } else {
          // Scalar array element
          const value = parseScalar(afterDash);
          items.push({ type: 'scalar', value });
          idx++;
        }
      }
      return { node: { type: 'array', items }, nextIdx: idx };
    }

    // Key-value pair at this level
    if (entry.key !== undefined) {
      const { node, nextIdx } = buildScalarOrChild(entryIdx, parentIndent);
      return { node, nextIdx };
    }

    // Fallback
    return { node: { type: 'scalar', value: null }, nextIdx: entryIdx + 1 };
  }

  function buildScalarOrChild(entryIdx: number, parentIndent: number): { node: Node; nextIdx: number } {
    const entry = entries[entryIdx];
    if (!entry) {
      return { node: { type: 'scalar', value: null }, nextIdx: entryIdx };
    }

    // Check if the rawValue is one of the inline forms
    if (entry.rawValue === '[]') {
      return { node: { type: 'array', items: [] }, nextIdx: entryIdx + 1 };
    }
    if (entry.rawValue === '{}') {
      return { node: { type: 'object', children: {} }, nextIdx: entryIdx + 1 };
    }

    // Empty value: check next entry to determine array vs object
    if (entry.rawValue === '' || entry.rawValue === '|') {
      const nextEntry = entries[entryIdx + 1];
      if (nextEntry && nextEntry.indent > entry.indent) {
        if (nextEntry.isArrayElement) {
          // It's an array!
          const { node: arrNode, nextIdx } = buildNode(entryIdx + 1, entry.indent);
          return { node: arrNode, nextIdx };
        } else {
          // It's a nested object
          const children: Record<string, Node> = {};
          let idx = entryIdx + 1;
          while (idx < entries.length && entries[idx].indent > entry.indent) {
            if (!entries[idx].isArrayElement && entries[idx].key) {
              const { node: childNode, nextIdx: ni } = buildScalarOrChild(idx, entry.indent);
              children[entries[idx].key!] = childNode;
              idx = ni;
            } else if (entries[idx].isArrayElement) {
              // Array at this indent level — it's a child
              const { node: arrNode, nextIdx: ni } = buildNode(idx, entry.indent);
              // We need a key for this — but it has none, so something's wrong
              idx = ni;
            } else {
              idx++;
            }
          }
          return { node: { type: 'object', children }, nextIdx: idx };
        }
      }
      // No children — empty object
      return { node: { type: 'object', children: {} }, nextIdx: entryIdx + 1 };
    }

    // Inline array: `key: - value`
    if (/^-\s/.test(entry.rawValue!)) {
      const arrValue = parseScalar(entry.rawValue!.replace(/^-\s+/, ''));
      return { node: { type: 'array', items: [{ type: 'scalar', value: arrValue }] }, nextIdx: entryIdx + 1 };
    }

    // Standard scalar value
    return { node: { type: 'scalar', value: parseScalar(entry.rawValue!) }, nextIdx: entryIdx + 1 };
  }

  // ── Phase 3: Build the top-level structure ──
  // Collect all top-level (indent 0) key-value pairs into the result
  const result: Record<string, unknown> = {};
  let idx = 0;
  while (idx < entries.length) {
    const entry = entries[idx];
    if (entry.isArrayElement) {
      // Top-level array elements — shouldn't happen in typical YAML frontmatter
      const { node, nextIdx } = buildNode(idx, -1);
      if (node.type === 'array') {
        result['_root_array'] = nodeToValue(node);
      }
      idx = nextIdx;
    } else if (entry.key) {
      const { node, nextIdx } = buildScalarOrChild(idx, -1);
      result[entry.key] = nodeToValue(node);
      idx = nextIdx;
    } else {
      idx++;
    }
  }

  return result;
}

/**
 * Convert a node tree back into plain JS values.
 * Works with any object that has { type, value/children/items } shape.
 */
function nodeToValue(node: { type: string; value?: unknown; children?: Record<string, unknown>; items?: unknown[] }): unknown {
  switch (node.type) {
    case 'scalar':
      return node.value;
    case 'object': {
      const obj: Record<string, unknown> = {};
      if (node.children) {
        for (const [k, v] of Object.entries(node.children)) {
          obj[k] = nodeToValue(v as { type: string; value?: unknown; children?: Record<string, unknown>; items?: unknown[] });
        }
      }
      return obj;
    }
    case 'array':
      if (node.items) {
        return node.items.map((item: unknown) => nodeToValue(item as { type: string; value?: unknown; children?: Record<string, unknown>; items?: unknown[] }));
      }
      return [];
  }
}

/**
 * Convert a kebab-case string to camelCase (e.g., "browser-tester" -> "browserTester").
 */
function kebabToCamel(s: string): string {
  return s.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase());
}

/**
 * Strip matching surrounding quotes from a string.
 */
function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Parse a YAML scalar value with type coercion.
 */
function parseScalar(value: string): unknown {
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Handle inline empty array `[]`
  if (value === '[]') return [];

  // Handle inline empty object `{}`
  if (value === '{}') return {};

  // Remove surrounding double or single quotes
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  // Try number (only if it looks like a number: digits, dot, minus)
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (!isNaN(num)) return num;
  }

  // If it contains spaces but isn't quoted, it's a plain string
  return trimmed;
}

// ── File Reading ──

/**
 * Read a file and parse its YAML frontmatter.
 */
function readAndParseFile(filePath: string): Record<string, unknown> | null {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    return null;
  }
  const content = fs.readFileSync(resolvedPath, 'utf-8');
  const parsed = parseYamlFrontmatter(content);
  if (!parsed) {
    // Check if it's a pure JSON-like object (no --- markers)
    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      // Also try parsing the entire content as YAML (no frontmatter markers)
      const fullParsed = parseYamlBlock(content);
      if (Object.keys(fullParsed).length > 0) {
        return fullParsed;
      }
      return null;
    }
  }
  return parsed;
}

// ── Validation Logic ──

/**
 * Check if a value matches the expected type.
 */
function checkType(value: unknown, expectedType: FieldType, fieldPath: string, nullable?: boolean): ValidationIssue | null {
  // Handle null values
  if (value === null) {
    // If the expected type is 'null', null is correct
    if (expectedType === 'null') return null;
    // If nullable is allowed, null is ok
    if (nullable) return null;
    // Otherwise, null is wrong
    return { type: 'error', message: `Wrong type: ${fieldPath} expected ${expectedType} got null` };
  }

  switch (expectedType) {
    case 'string':
      if (typeof value !== 'string') {
        return { type: 'error', message: `Wrong type: ${fieldPath} expected string got ${typeof value}` };
      }
      break;
    case 'boolean':
      if (typeof value !== 'boolean') {
        return { type: 'error', message: `Wrong type: ${fieldPath} expected boolean got ${typeof value}` };
      }
      break;
    case 'null':
      if (value !== null) {
        return { type: 'error', message: `Wrong type: ${fieldPath} expected null got ${typeof value}` };
      }
      break;
    case 'number':
      if (typeof value !== 'number') {
        return { type: 'error', message: `Wrong type: ${fieldPath} expected number got ${typeof value}` };
      }
      break;
    case 'array':
      if (!Array.isArray(value)) {
        return { type: 'error', message: `Wrong type: ${fieldPath} expected array got ${typeof value}` };
      }
      break;
    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return { type: 'error', message: `Wrong type: ${fieldPath} expected object got ${value === null ? 'null' : typeof value}` };
      }
      break;
    case 'string[]': {
      if (!Array.isArray(value)) {
        return { type: 'error', message: `Wrong type: ${fieldPath} expected string[] got ${typeof value}` };
      }
      const nonStrings = (value as unknown[]).filter(v => typeof v !== 'string');
      if (nonStrings.length > 0) {
        return { type: 'error', message: `Wrong type: ${fieldPath} expected string[] but found ${nonStrings.length} non-string elements` };
      }
      break;
    }
  }
  return null;
}

/**
 * Validate a set of fields against rules within a context object.
 */
function validateFields(
  obj: Record<string, unknown>,
  rules: FieldRule[],
  prefix: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const rule of rules) {
    const fieldPath = prefix ? `${prefix}.${rule.name}` : rule.name;
    const value = obj[rule.name];

    // Check required fields
    if (rule.required && value === undefined) {
      if (rule.nullable) {
        // Nullable required fields can be null, but must be present
        issues.push({ type: 'error', message: `Missing field: ${fieldPath}` });
      } else {
        issues.push({ type: 'error', message: `Missing field: ${fieldPath}` });
      }
      continue;
    }

    // Skip optional fields that are not present
    if (!rule.required && value === undefined) {
      continue;
    }

    // Type check
    if (rule.elementType) {
      // Array with element type check
      const typeIssue = checkType(value, 'array', fieldPath);
      if (typeIssue) {
        issues.push(typeIssue);
      } else if (Array.isArray(value)) {
        // Check array elements have the expected structure
        if (rule.elementType === 'object') {
          for (let i = 0; i < value.length; i++) {
            const elem = value[i];
            if (typeof elem !== 'object' || elem === null) {
              issues.push({ type: 'error', message: `Wrong type: ${fieldPath}[${i}] expected object got ${elem === null ? 'null' : typeof elem}` });
            } else if (rule.name === 'evidence' || rule.name === 'sources') {
              // Recursive validation: evidence/sources items must have required fields
              const evFields: FieldRule[] = [
                { name: 'claim', type: 'string', required: true },
                { name: 'source', type: 'string', required: true },
                { name: 'method', type: 'string', required: true },
                { name: 'command', type: 'string', required: true },
                { name: 'excerpt', type: 'string', required: true },
                { name: 'result', type: 'string', required: true },
                { name: 'lines', type: 'array', required: false, elementType: 'number' },
                { name: 'contentHash', type: 'string', required: false },
                { name: 'timestamp', type: 'string', required: false },
                { name: 'qualityScore', type: 'object', required: false },
              ];
              issues.push(...validateFields(elem as Record<string, unknown>, evFields, `${fieldPath}[${i}]`));
            }
          }
        } else if (rule.elementType === 'string') {
          for (let i = 0; i < value.length; i++) {
            if (typeof value[i] !== 'string') {
              issues.push({ type: 'error', message: `Wrong type: ${fieldPath}[${i}] expected string got ${typeof value[i]}` });
            }
          }
        }
      }
    } else if (rule.children) {
      // Nested object
      const typeIssue = checkType(value, 'object', fieldPath);
      if (typeIssue) {
        issues.push(typeIssue);
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        issues.push(...validateFields(value as Record<string, unknown>, rule.children, fieldPath));
      }
    } else {
      // Simple type check
      const typeIssue = checkType(value, rule.type, fieldPath, rule.nullable);
      if (typeIssue) {
        issues.push(typeIssue);
      }
    }
  }

  return issues;
}

/**
 * Determine which schema to use based on the agent name.
 */
function findSchema(agentName: string): AgentSchema | undefined {
  return SCHEMAS.find(s => s.agentName === agentName);
}

/**
 * Validate agent output against the expected schema.
 * The parsed data can be either a full top-level output (with agentOutputs.<agent> nested)
 * or just the agent-specific output block.
 */
function validateAgainstSchema(
  parsed: Record<string, unknown>,
  schema: AgentSchema,
  filePath?: string,
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Track field count for scoring
  let totalChecks = 0;
  let passedChecks = 0;

  // 1. Validate top-level fields
  const topIssues = validateFields(parsed, schema.topLevelFields, '');
  for (const issue of topIssues) {
    totalChecks++;
    if (issue.type === 'error') {
      errors.push(issue);
    } else {
      warnings.push(issue);
      passedChecks++;
    }
  }
  // Count passed top-level fields (non-error)
  passedChecks += schema.topLevelFields.length - topIssues.filter(i => i.type === 'error').length;

  // 2. Validate agentOutputs.<agent> fields
  const agentOutputs = parsed.agentOutputs as Record<string, unknown> | undefined;
  if (agentOutputs) {
    // Check both kebab-case and camelCase keys
    const kebabKey = schema.agentName;
    const camelKey = kebabToCamel(kebabKey);
    const agentBlock = (agentOutputs[kebabKey] ?? agentOutputs[camelKey]) as Record<string, unknown> | undefined;
    if (agentBlock) {
      const agentIssues = validateFields(agentBlock, schema.agentOutputsFields, `agentOutputs.${schema.agentName}`);
      for (const issue of agentIssues) {
        totalChecks++;
        if (issue.type === 'error') {
          errors.push(issue);
        } else {
          warnings.push(issue);
          passedChecks++;
        }
      }
      // Count passed agent fields
      const agentErrorCount = agentIssues.filter(i => i.type === 'error').length;
      passedChecks += schema.agentOutputsFields.length - agentErrorCount;
    } else {
      errors.push({ type: 'error', message: `Missing field: agentOutputs.${schema.agentName}` });
      totalChecks++;
    }
  } else {
    // Maybe the parsed data IS the agent block itself (--file mode with a single agent output file)
    const agentIssues = validateFields(parsed, schema.agentOutputsFields, schema.agentName);
    for (const issue of agentIssues) {
      totalChecks++;
      if (issue.type === 'error') {
        errors.push(issue);
      } else {
        warnings.push(issue);
        passedChecks++;
      }
    }
    const agentErrorCount = agentIssues.filter(i => i.type === 'error').length;
    passedChecks += schema.agentOutputsFields.length - agentErrorCount;

    // Also check decisions/warnings/changedFiles/artifacts
    const baseIssues = validateFields(parsed, BASE_TOP_LEVEL_FIELDS, '');
    for (const issue of baseIssues) {
      totalChecks++;
      if (issue.type === 'error') {
        errors.push(issue);
      } else {
        warnings.push(issue);
        passedChecks++;
      }
    }
    passedChecks += BASE_TOP_LEVEL_FIELDS.length - baseIssues.filter(i => i.type === 'error').length;
  }

  // 3. Run additional checks
  if (schema.additionalChecks) {
    const extraIssues = schema.additionalChecks(parsed);
    for (const issue of extraIssues) {
      totalChecks++;
      if (issue.type === 'error') {
        errors.push(issue);
      } else {
        warnings.push(issue);
        passedChecks++;
      }
    }
  }

  return {
    agentName: schema.agentName,
    valid: errors.length === 0,
    score: { passed: passedChecks, total: totalChecks + passedChecks }, // total includes passed
    errors,
    warnings,
    filePath,
  };
}

/**
 * Detect which agent the parsed output belongs to by examining
 * agentOutputs keys or the data shape.
 */
function detectAgent(parsed: Record<string, unknown>): AgentName | 'unknown' {
  const agentOutputs = parsed.agentOutputs as Record<string, unknown> | undefined;
  if (agentOutputs) {
    const knownAgents: AgentName[] = ['finder', 'implementor', 'fixer', 'plandescriber', 'verifier', 'qa', 'browser-tester'];
    for (const agent of knownAgents) {
      if (agentOutputs[agent] !== undefined) {
        return agent;
      }
    }
    // Also check camelCase variants (e.g., browserTester instead of browser-tester)
    // because YAML keys can use camelCase in some agent output formats
    const camelToKebab: Record<string, AgentName> = {
      browserTester: 'browser-tester',
    };
    for (const [camelKey, kebabName] of Object.entries(camelToKebab)) {
      if (agentOutputs[camelKey] !== undefined) {
        return kebabName;
      }
    }
  }

  // Try to detect from fields present
  if (parsed.rootCauseAnalysis) return 'fixer';
  if (parsed.suggestedCheckpoints || parsed.driftDetection) return 'verifier';
  if (parsed.knowledgeGraph) return 'finder';
  if (parsed.selfReview) return 'implementor';
  if (parsed.buildPassed === null && parsed.changedFiles && (parsed.changedFiles as string[]).some(f => f.includes('manifest'))) return 'plandescriber';
  if (parsed.buildPassed === null && parsed.changedFiles && (parsed.changedFiles as string[]).some(f => f.includes('test') || f.includes('spec'))) return 'qa';

  return 'unknown';
}

// ── Report Printing ──

/**
 * Print validation result in a human-readable format.
 */
function printResult(result: ValidationResult): void {
  const icon = result.valid ? '✅' : '❌';
  console.log(`\n${icon} Output Contract Validation`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Valid: ${result.valid}`);
  console.log(`Agent: ${result.agentName}`);
  console.log(`Score: ${result.score.passed}/${result.score.total} fields valid`);
  if (result.filePath) {
    console.log(`File:  ${result.filePath}`);
  }
  console.log();

  if (result.errors.length > 0) {
    console.log(`Errors (${result.errors.length}):`);
    result.errors.forEach(e => console.log(`  ❌ ${e.message}`));
    console.log();
  }

  if (result.warnings.length > 0) {
    console.log(`Warnings (${result.warnings.length}):`);
    result.warnings.forEach(w => console.log(`  ⚠️  ${w.message}`));
    console.log();
  }

  if (result.errors.length === 0 && result.warnings.length === 0) {
    console.log('  No issues found.');
    console.log();
  }
}

/**
 * Print a pipeline summary report.
 */
function printPipelineSummary(results: ValidationResult[]): void {
  const total = results.length;
  const valid = results.filter(r => r.valid).length;
  const invalid = results.filter(r => !r.valid).length;
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
  const totalWarnings = results.reduce((sum, r) => sum + r.warnings.length, 0);

  console.log(`\n📋 Pipeline Output Contract Validation Summary`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Agents validated: ${total}`);
  console.log(`Valid:            ${valid}`);
  console.log(`Invalid:          ${invalid}`);
  console.log(`Total errors:     ${totalErrors}`);
  console.log(`Total warnings:   ${totalWarnings}`);
  console.log();

  for (const result of results) {
    const icon = result.valid ? '✅' : '❌';
    const agentLabel = result.agentName === 'unknown' ? 'Unknown Agent' : result.agentName;
    console.log(`${icon} ${agentLabel} — ${result.score.passed}/${result.score.total} — ${result.errors.length} errors, ${result.warnings.length} warnings`);
    if (result.errors.length > 0) {
      result.errors.forEach(e => console.log(`     ❌ ${e.message}`));
    }
    if (result.warnings.length > 0) {
      result.warnings.forEach(w => console.log(`     ⚠️  ${w.message}`));
    }
  }
  console.log();
}

// ── Pipeline Mode ──

/**
 * Validate all agent entries in agent-context.md.
 */
function validatePipeline(filePath: string): ValidationResult[] {
  const results: ValidationResult[] = [];
  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    return results;
  }

  const content = fs.readFileSync(resolvedPath, 'utf-8');
  const parsed = parseYamlFrontmatter(content);

  if (!parsed) {
    console.error(`No YAML frontmatter found in ${resolvedPath}`);
    return results;
  }

  const agentOutputs = parsed.agentOutputs as Record<string, unknown> | undefined;
  if (!agentOutputs) {
    console.error(`No agentOutputs section found in ${resolvedPath}`);
    return results;
  }

  const knownAgents: AgentName[] = ['finder', 'implementor', 'fixer', 'plandescriber', 'verifier', 'qa', 'browser-tester'];

  for (const agentName of knownAgents) {
    // Check both kebab-case and camelCase keys
    const camelKey = kebabToCamel(agentName);
    const agentData = (agentOutputs[agentName] ?? agentOutputs[camelKey]) as Record<string, unknown> | undefined;
    if (agentData === undefined) continue;

    const schema = findSchema(agentName);
    if (!schema) {
      results.push({
        agentName,
        valid: false,
        score: { passed: 0, total: 0 },
        errors: [{ type: 'error', message: `No schema defined for agent: ${agentName}` }],
        warnings: [],
        filePath: resolvedPath,
      });
      continue;
    }

    // Build a composite object that mimics the full agent output
    const composite: Record<string, unknown> = {
      ...agentData,
      agentOutputs: { [agentName]: agentData },
      decisions: parsed.decisions,
      warnings: parsed.warnings,
      changedFiles: parsed.changedFiles || agentData.changedFiles || [],
      artifacts: parsed.artifacts || agentData.artifacts || [],
      resultSummary: parsed.resultSummary || agentData.resultSummary,
      status: parsed.status || agentData.status,
    };

    // Use top-level fields from agent-context if available
    if (parsed.status) composite.status = parsed.status;
    if (parsed.resultSummary) composite.resultSummary = parsed.resultSummary;
    if (parsed.decisions) composite.decisions = parsed.decisions;
    if (parsed.warnings) composite.warnings = parsed.warnings;
    if (parsed.artifacts) composite.artifacts = parsed.artifacts;
    const cf = parsed.changedFiles as string[] | undefined;
    if (cf && cf.length > 0) composite.changedFiles = cf;

    const result = validateAgainstSchema(composite, schema, resolvedPath);
    results.push(result);
  }

  if (results.length === 0) {
    console.log('No agent outputs found in agent-context.md');
  }

  return results;
}

// ── Main Entry Point ──

function main(): void {
  const args = process.argv.slice(2);

  if (args.includes('--version')) {
    console.log('validate-output-contract.ts v2.0');
    console.log('Output Contract Validator for OpenCode orchestration system');
    process.exit(0);
  }

  const fileArg = args.find(a => a.startsWith('--file='));
  const agentArg = args.find(a => a.startsWith('--agent='));
  const pipelineArg = args.includes('--pipeline');

  // ── --pipeline mode ──
  if (pipelineArg) {
    const agentContextPath = path.resolve('agent-context.md');
    if (!fs.existsSync(agentContextPath)) {
      console.error(`File not found: agent-context.md`);
      process.exit(2);
    }

    const results = validatePipeline(agentContextPath);
    if (results.length === 0) {
      console.log('No agent outputs found in agent-context.md');
      process.exit(0);
    }

    printPipelineSummary(results);

    const allValid = results.every(r => r.valid);
    process.exit(allValid ? 0 : 1);
  }

  // ── --file mode ──
  if (fileArg) {
    const filePath = fileArg.split('=')[1];
    const resolvedPath = path.resolve(filePath);

    if (!fs.existsSync(resolvedPath)) {
      console.error(`File not found: ${resolvedPath}`);
      process.exit(2);
    }

    const parsed = readAndParseFile(filePath);
    if (!parsed) {
      console.error(`Could not parse YAML frontmatter from ${resolvedPath}`);
      process.exit(2);
    }

    let agentName: AgentName | 'unknown';

    if (agentArg) {
      agentName = agentArg.split('=')[1] as AgentName;
    } else {
      agentName = detectAgent(parsed);
    }

    if (agentName === 'unknown') {
      // Try agentOutputs.<something>
      const agentOutputs = parsed.agentOutputs as Record<string, unknown> | undefined;
      if (agentOutputs) {
        const keys = Object.keys(agentOutputs);
        if (keys.length > 0) {
          agentName = detectAgent(parsed);
        }
      }
    }

    if (agentName === 'unknown') {
      console.error('Could not detect agent type. Use --agent=<name> to specify.');
      process.exit(1);
    }

    const schema = findSchema(agentName);
    if (!schema) {
      console.error(`No schema defined for agent: ${agentName}`);
      process.exit(1);
    }

    const result = validateAgainstSchema(parsed, schema, resolvedPath);
    printResult(result);
    process.exit(result.valid ? 0 : 1);
  }

  // ── --agent mode (validate against schema, reading from stdin or template) ──
  if (agentArg) {
    const agentName = agentArg.split('=')[1] as AgentName;
    const schema = findSchema(agentName);

    if (!schema) {
      console.error(`No schema defined for agent: ${agentName}`);
      process.exit(1);
    }

    // Read from stdin if piped, otherwise report error
    if (!process.stdin.isTTY) {
      let input = '';
      process.stdin.on('data', (chunk: Buffer) => {
        input += chunk.toString();
      });
      process.stdin.on('end', () => {
        const parsed = parseYamlFrontmatter(input) || parseYamlBlock(input);
        const result = validateAgainstSchema(parsed, schema);
        printResult(result);
        process.exit(result.valid ? 0 : 1);
      });
    } else {
      // No stdin pipe; show what the schema expects
      console.log(`\n📋 Schema expectations for agent: ${agentName}\n`);
      console.log('Top-level fields:');
      schema.topLevelFields.forEach(f => {
        const req = f.required ? 'required' : 'optional';
        const nullInfo = f.nullable ? ' (nullable)' : '';
        console.log(`  ${f.name}: ${f.type} (${req})${nullInfo}`);
      });
      console.log(`\nagentOutputs.${agentName} fields:`);
      schema.agentOutputsFields.forEach(f => {
        const req = f.required ? 'required' : 'optional';
        const nullInfo = f.nullable ? ' (nullable)' : '';
        const childrenInfo = f.children ? ` with ${f.children.length} nested fields` : '';
        console.log(`  ${f.name}: ${f.type}${childrenInfo} (${req})${nullInfo}`);
      });
      console.log('\nPipe a YAML file or use --file=<path> to validate.');
      process.exit(0);
    }
    return;
  }

  // ── No arguments ──
  console.log(`
Usage:
  ts-node validate-output-contract.ts --file=<path> [--agent=<name>]
  ts-node validate-output-contract.ts --agent=<name>          (pipe YAML via stdin)
  ts-node validate-output-contract.ts --pipeline              (validates agent-context.md)

  v2.0 — New fields validated: pipelineError, sources, rollback, diagnostics, checkpointResults

Agents: finder, implementor, fixer, plandescriber, verifier, qa, browser-tester
`);
  process.exit(0);
}

main();
