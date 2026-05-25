#!/usr/bin/env ts-node
/**
 * Tests for validate-output-contract.ts
 *
 * Tests inline implementations of: parseScalar, parseYamlFrontmatter,
 * parseYamlBlock, checkType, validateFields, findSchema, detectAgent,
 * kebabToCamel, validateAgainstSchema, BASE_TOP_LEVEL_FIELDS, stripQuotes.
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Inline implementations from validate-output-contract.ts ──

type FieldType = 'string' | 'boolean' | 'null' | 'array' | 'object' | 'string[]' | 'number';

interface ValidationIssue {
  type: 'error' | 'warning';
  message: string;
}

interface ValidationResult {
  agentName: string;
  valid: boolean;
  score: { passed: number; total: number };
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  filePath?: string;
}

interface FieldRule {
  name: string;
  type: FieldType;
  required: boolean;
  elementType?: FieldType;
  children?: FieldRule[];
  nullable?: boolean;
}

interface AgentSchema {
  agentName: string;
  topLevelFields: FieldRule[];
  agentOutputsFields: FieldRule[];
  additionalChecks?: (parsed: Record<string, unknown>) => ValidationIssue[];
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseScalar(value: string): unknown {
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === '[]') return [];
  if (value === '{}') return {};
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (!isNaN(num)) return num;
  }
  return trimmed;
}

function kebabToCamel(s: string): string {
  return s.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase());
}

function parseYamlBlock(yamlBlock: string): Record<string, unknown> {
  const lines = yamlBlock.split('\n');

  interface Entry {
    indent: number;
    text: string;
    isArrayElement: boolean;
    key?: string;
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
        continue;
      }
    }

    entries.push({ indent, text: trimmed, isArrayElement, key, rawValue });
  }

  interface ScalarNode { type: 'scalar'; value: unknown }
  interface ObjectNode { type: 'object'; children: Record<string, Node> }
  interface ArrayNode { type: 'array'; items: Node[] }
  type Node = ScalarNode | ObjectNode | ArrayNode;

  function nodeToValue(node: Node): unknown {
    switch (node.type) {
      case 'scalar':
        return node.value;
      case 'object': {
        const obj: Record<string, unknown> = {};
        if (node.children) {
          for (const [k, v] of Object.entries(node.children)) {
            obj[k] = nodeToValue(v);
          }
        }
        return obj;
      }
      case 'array':
        if (node.items) {
          return node.items.map((item) => nodeToValue(item));
        }
        return [];
    }
  }

  function buildScalarOrChild(entryIdx: number, parentIndent: number): { node: Node; nextIdx: number } {
    const entry = entries[entryIdx];
    if (!entry) {
      return { node: { type: 'scalar', value: null }, nextIdx: entryIdx };
    }

    if (entry.rawValue === '[]') {
      return { node: { type: 'array', items: [] }, nextIdx: entryIdx + 1 };
    }
    if (entry.rawValue === '{}') {
      return { node: { type: 'object', children: {} }, nextIdx: entryIdx + 1 };
    }

    if (entry.rawValue === '' || entry.rawValue === '|') {
      const nextEntry = entries[entryIdx + 1];
      if (nextEntry && nextEntry.indent > entry.indent) {
        if (nextEntry.isArrayElement) {
          const { node: arrNode, nextIdx } = buildNode(entryIdx + 1, entry.indent);
          return { node: arrNode, nextIdx };
        } else {
          const children: Record<string, Node> = {};
          let idx = entryIdx + 1;
          while (idx < entries.length && entries[idx].indent > entry.indent) {
            if (!entries[idx].isArrayElement && entries[idx].key) {
              const { node: childNode, nextIdx: ni } = buildScalarOrChild(idx, entry.indent);
              children[entries[idx].key!] = childNode;
              idx = ni;
            } else if (entries[idx].isArrayElement) {
              const { node: arrNode, nextIdx: ni } = buildNode(idx, entry.indent);
              idx = ni;
            } else {
              idx++;
            }
          }
          return { node: { type: 'object', children }, nextIdx: idx };
        }
      }
      return { node: { type: 'object', children: {} }, nextIdx: entryIdx + 1 };
    }

    if (/^-\s/.test(entry.rawValue!)) {
      const arrValue = parseScalar(entry.rawValue!.replace(/^-\s+/, ''));
      return { node: { type: 'array', items: [{ type: 'scalar', value: arrValue }] }, nextIdx: entryIdx + 1 };
    }

    return { node: { type: 'scalar', value: parseScalar(entry.rawValue!) }, nextIdx: entryIdx + 1 };
  }

  function buildNode(entryIdx: number, parentIndent: number): { node: Node; nextIdx: number } {
    const entry = entries[entryIdx];
    if (!entry) {
      return { node: { type: 'scalar', value: null }, nextIdx: entryIdx };
    }

    if (entry.isArrayElement) {
      const items: Node[] = [];
      let idx = entryIdx;
      while (idx < entries.length && entries[idx].isArrayElement && entries[idx].indent === entry.indent) {
        const currentEntry = entries[idx];
        const afterDash = currentEntry.text.replace(/^-\s*/, '');
        const colonIdx = afterDash.indexOf(':');

        if (colonIdx !== -1 && colonIdx > 0) {
          const elemKey = afterDash.slice(0, colonIdx).trim();
          const elemValue = afterDash.slice(colonIdx + 1).trim();
          const objChildren: Record<string, Node> = {};

          if (elemValue === '') {
            const { node: childNode, nextIdx } = buildNode(idx + 1, entry.indent + 2);
            objChildren[elemKey] = childNode;
            items.push({ type: 'object', children: objChildren });
            idx = nextIdx;
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
          } else {
            const val = parseScalar(elemValue);
            objChildren[elemKey] = { type: 'scalar', value: val };
            items.push({ type: 'object', children: objChildren });
            idx++;
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
          const value = parseScalar(afterDash);
          items.push({ type: 'scalar', value });
          idx++;
        }
      }
      return { node: { type: 'array', items }, nextIdx: idx };
    }

    if (entry.key !== undefined) {
      const { node, nextIdx } = buildScalarOrChild(entryIdx, parentIndent);
      return { node, nextIdx };
    }

    return { node: { type: 'scalar', value: null }, nextIdx: entryIdx + 1 };
  }

  const result: Record<string, unknown> = {};
  let idx = 0;
  while (idx < entries.length) {
    const entry = entries[idx];
    if (entry.isArrayElement) {
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

function parseYamlFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  const yamlBlock = match[1];
  return parseYamlBlock(yamlBlock);
}

function checkType(value: unknown, expectedType: FieldType, fieldPath: string, nullable?: boolean): ValidationIssue | null {
  if (value === null) {
    if (expectedType === 'null') return null;
    if (nullable) return null;
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

function validateFields(
  obj: Record<string, unknown>,
  rules: FieldRule[],
  prefix: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const rule of rules) {
    const fieldPath = prefix ? `${prefix}.${rule.name}` : rule.name;
    const value = obj[rule.name];

    if (rule.required && value === undefined) {
      issues.push({ type: 'error', message: `Missing field: ${fieldPath}` });
      continue;
    }

    if (!rule.required && value === undefined) {
      continue;
    }

    if (rule.elementType) {
      const typeIssue = checkType(value, 'array', fieldPath);
      if (typeIssue) {
        issues.push(typeIssue);
      } else if (Array.isArray(value)) {
        if (rule.elementType === 'string') {
          for (let i = 0; i < value.length; i++) {
            if (typeof value[i] !== 'string') {
              issues.push({ type: 'error', message: `Wrong type: ${fieldPath}[${i}] expected string got ${typeof value[i]}` });
            }
          }
        }
      }
    } else if (rule.children) {
      const typeIssue = checkType(value, 'object', fieldPath);
      if (typeIssue) {
        issues.push(typeIssue);
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        issues.push(...validateFields(value as Record<string, unknown>, rule.children, fieldPath));
      }
    } else {
      const typeIssue = checkType(value, rule.type, fieldPath, rule.nullable);
      if (typeIssue) {
        issues.push(typeIssue);
      }
    }
  }

  return issues;
}

// ── Schema definitions (minimal for testing) ──

const FINDER_SCHEMA: AgentSchema = {
  agentName: 'finder',
  topLevelFields: [
    { name: 'status', type: 'string', required: true },
    { name: 'resultSummary', type: 'string', required: true },
  ],
  agentOutputsFields: [
    { name: 'status', type: 'string', required: true },
    { name: 'resultSummary', type: 'string', required: true },
  ],
};

const SCHEMAS: AgentSchema[] = [
  { agentName: 'finder', topLevelFields: FINDER_SCHEMA.topLevelFields, agentOutputsFields: FINDER_SCHEMA.agentOutputsFields },
  { agentName: 'implementor', topLevelFields: FINDER_SCHEMA.topLevelFields, agentOutputsFields: FINDER_SCHEMA.agentOutputsFields },
  { agentName: 'fixer', topLevelFields: FINDER_SCHEMA.topLevelFields, agentOutputsFields: FINDER_SCHEMA.agentOutputsFields },
  { agentName: 'plandescriber', topLevelFields: FINDER_SCHEMA.topLevelFields, agentOutputsFields: FINDER_SCHEMA.agentOutputsFields },
  { agentName: 'verifier', topLevelFields: FINDER_SCHEMA.topLevelFields, agentOutputsFields: FINDER_SCHEMA.agentOutputsFields },
  { agentName: 'qa', topLevelFields: FINDER_SCHEMA.topLevelFields, agentOutputsFields: FINDER_SCHEMA.agentOutputsFields },
  { agentName: 'browser-tester', topLevelFields: FINDER_SCHEMA.topLevelFields, agentOutputsFields: FINDER_SCHEMA.agentOutputsFields },
];

function findSchema(agentName: string): AgentSchema | undefined {
  return SCHEMAS.find(s => s.agentName === agentName);
}

function detectAgent(parsed: Record<string, unknown>): string {
  const agentOutputs = parsed.agentOutputs as Record<string, unknown> | undefined;
  if (agentOutputs) {
    const knownAgents = ['finder', 'implementor', 'fixer', 'plandescriber', 'verifier', 'qa', 'browser-tester'];
    for (const agent of knownAgents) {
      if (agentOutputs[agent] !== undefined) {
        return agent;
      }
    }
    const camelToKebab: Record<string, string> = { browserTester: 'browser-tester' };
    for (const [camelKey, kebabName] of Object.entries(camelToKebab)) {
      if (agentOutputs[camelKey] !== undefined) {
        return kebabName;
      }
    }
  }

  if (parsed.rootCauseAnalysis) return 'fixer';
  if (parsed.suggestedCheckpoints || parsed.driftDetection) return 'verifier';
  if (parsed.knowledgeGraph) return 'finder';
  if (parsed.selfReview) return 'implementor';
  if (parsed.buildPassed === null && parsed.changedFiles && (parsed.changedFiles as string[]).some((f: string) => f.includes('manifest'))) return 'plandescriber';
  if (parsed.buildPassed === null && parsed.changedFiles && (parsed.changedFiles as string[]).some((f: string) => f.includes('test') || f.includes('spec'))) return 'qa';

  return 'unknown';
}

function validateAgainstSchema(
  parsed: Record<string, unknown>,
  schema: AgentSchema,
  filePath?: string,
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  let totalChecks = 0;
  let passedChecks = 0;

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
  passedChecks += schema.topLevelFields.length - topIssues.filter(i => i.type === 'error').length;

  const agentOutputs = parsed.agentOutputs as Record<string, unknown> | undefined;
  if (agentOutputs) {
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
      const agentErrorCount = agentIssues.filter(i => i.type === 'error').length;
      passedChecks += schema.agentOutputsFields.length - agentErrorCount;
    } else {
      errors.push({ type: 'error', message: `Missing field: agentOutputs.${schema.agentName}` });
      totalChecks++;
    }
  } else {
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
  }

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
    score: { passed: passedChecks, total: totalChecks + passedChecks },
    errors,
    warnings,
    filePath,
  };
}

const BASE_TOP_LEVEL_FIELDS: FieldRule[] = [
  { name: 'status', type: 'string', required: true },
  { name: 'resultSummary', type: 'string', required: true },
  { name: 'evidence', type: 'array', required: true, elementType: 'object' },
  { name: 'decisions', type: 'array', required: true, elementType: 'object' },
  { name: 'warnings', type: 'array', required: true, elementType: 'string' },
  { name: 'changedFiles', type: 'array', required: true, elementType: 'string' },
  { name: 'artifacts', type: 'array', required: true, elementType: 'string' },
];

// ── Test Helpers ──

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

function assertEqual(actual: unknown, expected: unknown, msg: string) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) throw new Error(`${msg}: expected ${expectedStr}, got ${actualStr}`);
}

function assertDeepEqual(actual: unknown, expected: unknown, msg: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── Tests ──

function main() {
  console.log('🔍 validate-output-contract.ts Tests');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ── 1. parseScalar() ──

  test('parseScalar: boolean true', () => {
    assertEqual(parseScalar('true'), true, 'true -> true');
  });

  test('parseScalar: boolean false', () => {
    assertEqual(parseScalar('false'), false, 'false -> false');
  });

  test('parseScalar: null values', () => {
    assertEqual(parseScalar('null'), null, 'null -> null');
    assertEqual(parseScalar('~'), null, '~ -> null');
  });

  test('parseScalar: numbers', () => {
    assertEqual(parseScalar('42'), 42, '42 -> 42');
    assertEqual(parseScalar('3.14'), 3.14, '3.14 -> 3.14');
    assertEqual(parseScalar('-7'), -7, '-7 -> -7');
  });

  test('parseScalar: quoted strings', () => {
    assertEqual(parseScalar('"hello"'), 'hello', '"hello" -> hello');
    assertEqual(parseScalar("'world'"), 'world', "'world' -> world");
  });

  test('parseScalar: empty array/object', () => {
    assertDeepEqual(parseScalar('[]'), [], '[] -> []');
    assertDeepEqual(parseScalar('{}'), {}, '{} -> {}');
  });

  test('parseScalar: plain text', () => {
    assertEqual(parseScalar('plain text'), 'plain text', 'plain text -> plain text');
  });

  // ── 2. parseYamlFrontmatter() ──

  test('parseYamlFrontmatter: valid frontmatter returns object', () => {
    const content = `---
key: value
count: 42
active: true
---`;
    const result = parseYamlFrontmatter(content);
    assert(result !== null, 'Expected non-null result');
    assertEqual(result!.key, 'value', 'key should be value');
    assertEqual(result!.count, 42, 'count should be 42');
    assertEqual(result!.active, true, 'active should be true');
  });

  test('parseYamlFrontmatter: no markers returns null', () => {
    const content = `Just a plain text file\nno frontmatter here`;
    const result = parseYamlFrontmatter(content);
    assertEqual(result, null, 'Expected null for no markers');
  });

  test('parseYamlFrontmatter: empty content returns null', () => {
    const result = parseYamlFrontmatter('');
    assertEqual(result, null, 'Expected null for empty content');
  });

  // ── 3. parseYamlBlock() ──

  test('parseYamlBlock: simple key:value pairs', () => {
    const result = parseYamlBlock('name: test\ncount: 10');
    assertEqual(result.name, 'test', 'name should be test');
    assertEqual(result.count, 10, 'count should be 10');
  });

  test('parseYamlBlock: nested objects with indentation', () => {
    const yaml = 'outer:\n  inner: value\n  num: 99';
    const result = parseYamlBlock(yaml);
    assert(result.outer !== null, 'outer should exist');
    assert(typeof result.outer === 'object', 'outer should be object');
    const outer = result.outer as Record<string, unknown>;
    assertEqual(outer.inner, 'value', 'outer.inner should be value');
    assertEqual(outer.num, 99, 'outer.num should be 99');
  });

  test('parseYamlBlock: arrays with - prefix (scalar items)', () => {
    const yaml = 'items:\n  - a\n  - b\n  - c';
    const result = parseYamlBlock(yaml);
    assert(Array.isArray(result.items), 'items should be array');
    assertDeepEqual(result.items, ['a', 'b', 'c'], 'items should match');
  });

  test('parseYamlBlock: arrays of objects', () => {
    const yaml = 'entries:\n  - key: one\n    val: 1\n  - key: two\n    val: 2';
    const result = parseYamlBlock(yaml);
    assert(Array.isArray(result.entries), 'entries should be array');
    const entries = result.entries as Array<Record<string, unknown>>;
    assertEqual(entries.length, 2, 'should have 2 entries');
    assertEqual(entries[0].key, 'one', 'first entry key');
    assertEqual(entries[0].val, 1, 'first entry val');
    assertEqual(entries[1].key, 'two', 'second entry key');
    assertEqual(entries[1].val, 2, 'second entry val');
  });

  test('parseYamlBlock: empty array/object inline', () => {
    const yaml = 'emptyArr: []\nemptyObj: {}';
    const result = parseYamlBlock(yaml);
    assertDeepEqual(result.emptyArr, [], 'emptyArr should be []');
    assertDeepEqual(result.emptyObj, {}, 'emptyObj should be {}');
  });

  test('parseYamlBlock: mixed complex structures', () => {
    const yaml = 'config:\n  name: app\n  tags:\n    - a\n    - b\n  items:\n    - id: 1\n      label: first\n    - id: 2\n      label: second';
    const result = parseYamlBlock(yaml);
    assert(typeof result.config === 'object', 'config should be object');
    const config = result.config as Record<string, unknown>;
    assertEqual(config.name, 'app', 'config.name');
    assertDeepEqual(config.tags, ['a', 'b'], 'config.tags');
    assert(Array.isArray(config.items), 'config.items should be array');
    const items = config.items as Array<Record<string, unknown>>;
    assertEqual(items.length, 2, 'items length');
    assertEqual(items[0].id, 1, 'items[0].id');
    assertEqual(items[0].label, 'first', 'items[0].label');
    assertEqual(items[1].id, 2, 'items[1].id');
    assertEqual(items[1].label, 'second', 'items[1].label');
  });

  // ── 4. checkType() ──

  test('checkType: valid types pass', () => {
    assertEqual(checkType('hello', 'string', 'f'), null, 'string passes');
    assertEqual(checkType(true, 'boolean', 'f'), null, 'boolean passes');
    assertEqual(checkType(42, 'number', 'f'), null, 'number passes');
    assertEqual(checkType(null, 'null', 'f'), null, 'null passes');
    assertEqual(checkType([], 'array', 'f'), null, 'array passes');
    assertEqual(checkType({}, 'object', 'f'), null, 'object passes');
    assertEqual(checkType(['a', 'b'], 'string[]', 'f'), null, 'string[] passes');
  });

  test('checkType: nullable handles null values', () => {
    assertEqual(checkType(null, 'string', 'f', true), null, 'nullable string accepts null');
    assertEqual(checkType(null, 'boolean', 'f', true), null, 'nullable boolean accepts null');
  });

  test('checkType: wrong types return ValidationIssue', () => {
    const issue = checkType(42, 'string', 'myField');
    assert(issue !== null, 'Expected issue for wrong type');
    assertEqual(issue!.type, 'error', 'issue type should be error');
    assert(issue!.message.includes('myField'), 'message should include field name');
  });

  test('checkType: string[] rejects non-string elements', () => {
    const issue = checkType([1, 2], 'string[]', 'arr');
    assert(issue !== null, 'Expected issue for non-string elements');
    assert(issue!.message.includes('non-string'), 'message should mention non-string');
  });

  // ── 5. validateFields() ──

  test('validateFields: missing required fields produce errors', () => {
    const rules: FieldRule[] = [
      { name: 'requiredField', type: 'string', required: true },
    ];
    const issues = validateFields({}, rules, '');
    assert(issues.length > 0, 'Should have issues');
    assert(issues[0].message.includes('Missing field'), 'Should say missing field');
  });

  test('validateFields: string with wrong type produces errors', () => {
    const rules: FieldRule[] = [
      { name: 'str', type: 'string', required: true },
    ];
    const issues = validateFields({ str: 123 }, rules, '');
    assert(issues.length > 0, 'Should have issues');
    assert(issues[0].message.includes('expected string'), 'Should mention expected string');
  });

  test('validateFields: nested children validated recursively', () => {
    const rules: FieldRule[] = [
      { name: 'obj', type: 'object', required: true, children: [
        { name: 'inner', type: 'string', required: true },
      ]},
    ];
    const issues = validateFields({ obj: {} }, rules, '');
    assert(issues.length > 0, 'Should have issues for missing nested field');
    assert(issues[0].message.includes('inner'), 'Should mention inner field');
  });

  test('validateFields: array element type validated', () => {
    const rules: FieldRule[] = [
      { name: 'list', type: 'array', required: true, elementType: 'string' },
    ];
    const issues = validateFields({ list: [1, 2] }, rules, '');
    assert(issues.length > 0, 'Should have issues for non-string elements');
    assert(issues[0].message.includes('expected string'), 'Should mention expected string');
  });

  test('validateFields: optional fields absent produce no issues', () => {
    const rules: FieldRule[] = [
      { name: 'opt', type: 'string', required: false },
    ];
    const issues = validateFields({}, rules, '');
    assertEqual(issues.length, 0, 'No issues for missing optional field');
  });

  // ── 6. findSchema() ──

  test('findSchema: returns schema for known agents', () => {
    const agents = ['finder', 'implementor', 'fixer', 'plandescriber', 'verifier', 'qa', 'browser-tester'];
    for (const agent of agents) {
      const schema = findSchema(agent);
      assert(schema !== undefined, `Schema should exist for ${agent}`);
      assertEqual(schema!.agentName, agent, `agentName should be ${agent}`);
      assert(Array.isArray(schema!.topLevelFields), 'topLevelFields should be array');
      assert(Array.isArray(schema!.agentOutputsFields), 'agentOutputsFields should be array');
    }
  });

  test('findSchema: returns undefined for unknown agent', () => {
    const schema = findSchema('nonexistent-agent');
    assertEqual(schema, undefined, 'Should be undefined');
  });

  // ── 7. detectAgent() ──

  test('detectAgent: rootCauseAnalysis detects fixer', () => {
    const result = detectAgent({ rootCauseAnalysis: {} });
    assertEqual(result, 'fixer', 'Should detect fixer');
  });

  test('detectAgent: suggestedCheckpoints detects verifier', () => {
    const result = detectAgent({ suggestedCheckpoints: [] });
    assertEqual(result, 'verifier', 'Should detect verifier');
  });

  test('detectAgent: driftDetection detects verifier', () => {
    const result = detectAgent({ driftDetection: {} });
    assertEqual(result, 'verifier', 'Should detect verifier');
  });

  test('detectAgent: selfReview detects implementor', () => {
    const result = detectAgent({ selfReview: {} });
    assertEqual(result, 'implementor', 'Should detect implementor');
  });

  test('detectAgent: knowledgeGraph detects finder', () => {
    const result = detectAgent({ knowledgeGraph: {} });
    assertEqual(result, 'finder', 'Should detect finder');
  });

  // ── 8. kebabToCamel() ──

  test('kebabToCamel: browser-tester -> browserTester', () => {
    assertEqual(kebabToCamel('browser-tester'), 'browserTester', 'should convert');
  });

  test('kebabToCamel: simple stays simple', () => {
    assertEqual(kebabToCamel('simple'), 'simple', 'no change');
  });

  test('kebabToCamel: multi-word-test -> multiWordTest', () => {
    assertEqual(kebabToCamel('multi-word-test'), 'multiWordTest', 'should convert');
  });

  // ── 9. validateAgainstSchema() ──

  test('validateAgainstSchema: valid output contract passes', () => {
    const data = {
      status: 'ok',
      resultSummary: 'done',
      agentOutputs: {
        finder: {
          status: 'ok',
          resultSummary: 'found',
        },
      },
    };
    const schema = findSchema('finder')!;
    const result = validateAgainstSchema(data, schema);
    assertEqual(result.valid, true, 'Should be valid');
    assert(result.score.total > 0, 'Should have checks');
  });

  test('validateAgainstSchema: missing required fields cause failure', () => {
    const data = {
      agentOutputs: {
        finder: {
          status: 'ok',
          resultSummary: 'found',
        },
      },
    };
    const schema = findSchema('finder')!;
    const result = validateAgainstSchema(data, schema);
    assertEqual(result.valid, false, 'Should be invalid');
    assert(result.errors.length > 0, 'Should have errors');
  });

  test('validateAgainstSchema: score tracks passed/total correctly', () => {
    const data = {
      status: 'ok',
      resultSummary: 'done',
      agentOutputs: {
        finder: {
          status: 'ok',
          resultSummary: 'found',
        },
      },
    };
    const schema = findSchema('finder')!;
    const result = validateAgainstSchema(data, schema);
    assert(result.score.passed <= result.score.total, 'passed <= total');
    assert(result.score.passed > 0, 'some checks passed');
  });

  // ── 10. BASE_TOP_LEVEL_FIELDS ──

  test('BASE_TOP_LEVEL_FIELDS contains all required fields', () => {
    const names = BASE_TOP_LEVEL_FIELDS.map(f => f.name);
    const required = ['status', 'resultSummary', 'evidence', 'decisions', 'warnings', 'changedFiles', 'artifacts'];
    for (const name of required) {
      assert(names.includes(name), `Should include ${name}`);
    }
    assert(required.every(r => names.includes(r)), 'All required fields present');
  });

  // ── 11. stripQuotes() ──

  test('stripQuotes: double quotes', () => {
    assertEqual(stripQuotes('"hello"'), 'hello', 'strips double quotes');
  });

  test('stripQuotes: single quotes', () => {
    assertEqual(stripQuotes("'world'"), 'world', 'strips single quotes');
  });

  test('stripQuotes: unquoted unchanged', () => {
    assertEqual(stripQuotes('plain'), 'plain', 'unchanged');
  });

  // ── Summary ──

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

  if (failed > 0) process.exit(1);
}

main();
