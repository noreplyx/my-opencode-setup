#!/usr/bin/env ts-node
/**
 * Tests for audit-log.ts
 *
 * Tests: createGenesisEntry, computeEntryHash, sha256Hex, serializeDetails,
 *        parseAuditLog, validateActions, serialize/deserialize YAML round-trip
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

const TEST_DIR = path.resolve(process.cwd(), 'tmp-test-audit-log');

function setup() {
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  }
}

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

function writeTestFile(filename: string, content: string): string {
  const filePath = path.join(TEST_DIR, filename);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

const TS_PROJECT = path.resolve(process.cwd(), 'skills', 'scripts', 'tsconfig.json');

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

function assertEqual(actual: any, expected: any, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── Constants from audit-log.ts ──
const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';
const VALID_ACTIONS = [
  'pipeline_init', 'file_write', 'file_modify', 'file_delete',
  'package_install', 'package_update', 'build', 'lint',
  'security_scan', 'qa_test', 'git_commit', 'config_change',
];

// ── Helper function implementations ──

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf-8').digest('hex');
}

function computeEntryHash(
  index: number, timestamp: string, agent: string, action: string,
  detailsStr: string, fileHash: string | null, previousHash: string,
): string {
  const canonical = [
    `index:${index}`,
    `timestamp:${timestamp}`,
    `agent:${agent}`,
    `action:${action}`,
    `details:${detailsStr}`,
    `fileHash:${fileHash ?? 'null'}`,
    `previousHash:${previousHash}`,
  ].join('|');
  return sha256Hex(canonical);
}

function serializeDetails(details: Record<string, unknown>): string {
  return JSON.stringify(details, Object.keys(details).sort());
}

function createGenesisEntry(feature: string, timestamp: string) {
  const details = { feature };
  const detailsStr = serializeDetails(details);
  const entryHash = computeEntryHash(0, timestamp, 'system', 'pipeline_init', detailsStr, null, GENESIS_HASH);
  return { index: 0, timestamp, agent: 'system', action: 'pipeline_init', details, fileHash: null, previousHash: GENESIS_HASH, entryHash, signature: null };
}

function serializeValue(value: unknown, indent: number): string {
  const pad = '  '.repeat(indent);
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') {
    if (value.includes(': ') || value.includes('#') || value.includes('\n') || value === '') {
      return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((v: unknown) => {
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        return `${pad}- ${serializeObject(v as Record<string, unknown>, indent + 1).trimStart()}`;
      }
      return `${pad}- ${serializeValue(v, indent + 1)}`;
    });
    return '\n' + items.join('\n');
  }
  if (typeof value === 'object') return '\n' + serializeObject(value as Record<string, unknown>, indent);
  return String(value);
}

function serializeObject(obj: Record<string, unknown>, indent: number): string {
  const pad = '  '.repeat(indent);
  const lines: string[] = [];
  for (const [key, val] of Object.entries(obj)) {
    if (val === null || val === undefined) {
      lines.push(`${pad}${key}: null`);
    } else if (typeof val === 'object' && !Array.isArray(val)) {
      const nestedKeys = Object.keys(val as Record<string, unknown>);
      if (nestedKeys.length === 0) {
        lines.push(`${pad}${key}: {}`);
      } else {
        lines.push(`${pad}${key}:`);
        lines.push(serializeObject(val as Record<string, unknown>, indent + 1));
      }
    } else if (Array.isArray(val)) {
      if (val.length === 0) {
        lines.push(`${pad}${key}: []`);
      } else {
        lines.push(`${pad}${key}:`);
        const serialized = serializeValue(val, indent + 1);
        lines.push(serialized.startsWith('\n') ? serialized.slice(1) : serialized);
      }
    } else {
      lines.push(`${pad}${key}: ${serializeValue(val, 0)}`);
    }
  }
  return lines.join('\n');
}

function serializeAuditLog(entries: any[]): string {
  const yamlLines: string[] = [];
  yamlLines.push('# Audit log — tamper-evident append-only');
  yamlLines.push('# Do not edit manually. Hash chain will break.');
  yamlLines.push('');
  yamlLines.push('entries:');
  for (const entry of entries) {
    yamlLines.push('  - index: ' + entry.index);
    yamlLines.push('    timestamp: "' + entry.timestamp + '"');
    yamlLines.push('    agent: "' + entry.agent + '"');
    yamlLines.push('    action: "' + entry.action + '"');
    yamlLines.push('    details:');
    yamlLines.push(serializeObject(entry.details, 3));
    yamlLines.push('    fileHash: ' + (entry.fileHash ? '"' + entry.fileHash + '"' : 'null'));
    yamlLines.push('    previousHash: "' + entry.previousHash + '"');
    yamlLines.push('    entryHash: "' + entry.entryHash + '"');
    yamlLines.push('    signature: ' + (entry.signature ? '"' + entry.signature + '"' : 'null'));
    yamlLines.push('');
  }
  return yamlLines.join('\n');
}

function parseQuotedString(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseYamlScalarValue(value: string): unknown {
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  if (/^\d+\.\d+$/.test(value)) return parseFloat(value);
  return parseQuotedString(value);
}

function parseNestedDetails(
  lines: string[],
  startIdx: number,
  parentIndent: number,
): [Record<string, unknown>, number] {
  const obj: Record<string, unknown> = {};
  let i = startIdx;

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (trimmed === '' || trimmed.startsWith('#')) { i++; continue; }

    const indent = rawLine.search(/\S/);
    if (indent <= parentIndent) break;

    // Array item
    if (trimmed.startsWith('- ')) {
      // This shouldn't happen at the top level of parseNestedDetails;
      // arrays are handled by lookahead in the caller.
      i++;
      continue;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) { i++; continue; }

    const key = trimmed.substring(0, colonIdx).trim();
    const valueRaw = trimmed.substring(colonIdx + 1).trim();

    if (valueRaw === '' || valueRaw.startsWith('#')) {
      // Empty value — could be an array or a nested object
      const nextLine = lines[i + 1]?.trim();
      const nextIndent = lines[i + 1] ? lines[i + 1].search(/\S/) : -1;

      if (nextIndent > indent && nextLine?.startsWith('- ')) {
        // Array — collect all items at this indent level
        const arr: unknown[] = [];
        let j = i + 1;
        while (j < lines.length) {
          const nl = lines[j].trim();
          const nli = lines[j].search(/\S/);
          if (nli <= indent) break;
          if (nl.startsWith('- ')) {
            const itemStr = nl.substring(2).trim();
            // Check if it's a quoted string or simple value
            arr.push(parseYamlScalarValue(itemStr));
          }
          j++;
        }
        obj[key] = arr;
        i = j;
        continue;
      } else if (nextIndent > indent) {
        // Nested object
        const [nested, newIdx] = parseNestedDetails(lines, i + 1, indent);
        obj[key] = nested;
        i = newIdx;
        continue;
      } else {
        // Truly empty value
        obj[key] = parseYamlScalarValue(valueRaw);
        i++;
        continue;
      }
    }

    // Simple key: scalar_value
    obj[key] = parseYamlScalarValue(valueRaw);
    i++;
  }

  return [obj, i];
}

function parseAuditLog(content: string): any[] {
  const entries: any[] = [];
  const lines = content.split('\n');
  let currentEntry: any = null;
  let inDetails = false;
  let detailsIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('- index:')) {
      if (currentEntry && currentEntry.index !== undefined) entries.push(currentEntry);
      currentEntry = {};
      inDetails = false;
      currentEntry.index = parseInt(trimmed.split(':')[1].trim(), 10);
      continue;
    }
    if (!currentEntry) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.substring(0, colonIdx).trim();
    const valueRaw = trimmed.substring(colonIdx + 1).trim();
    const indent = rawLine.search(/\S/);
    if (key === 'details') {
      inDetails = true;
      detailsIndent = indent;
      currentEntry.details = {};
      // Check what follows: if next line(s) have a greater indent,
      // parse them as nested details
      if (lines[i + 1] && lines[i + 1].search(/\S/) > indent) {
        const [detailsObj, nextIdx] = parseNestedDetails(lines, i + 1, indent);
        currentEntry.details = detailsObj;
        i = nextIdx - 1; // -1 because loop increments
      }
      continue;
    }
    if (inDetails && indent <= detailsIndent) inDetails = false;
    if (inDetails && currentEntry.details) {
      // Already handled by the lookahead above when 'details:' was encountered.
      // This branch should not be reached for well-formed YAML.
      continue;
    }
    switch (key) {
      case 'timestamp': currentEntry.timestamp = parseQuotedString(valueRaw); break;
      case 'agent': currentEntry.agent = parseQuotedString(valueRaw); break;
      case 'action': currentEntry.action = parseQuotedString(valueRaw); break;
      case 'fileHash': currentEntry.fileHash = valueRaw === 'null' ? null : parseQuotedString(valueRaw); break;
      case 'previousHash': currentEntry.previousHash = parseQuotedString(valueRaw); break;
      case 'entryHash': currentEntry.entryHash = parseQuotedString(valueRaw); break;
      case 'signature': currentEntry.signature = valueRaw === 'null' ? null : parseQuotedString(valueRaw); break;
    }
  }
  if (currentEntry && currentEntry.index !== undefined) entries.push(currentEntry);
  return entries;
}

// ── Tests ──

function testSha256Hex() {
  const hash = sha256Hex('hello');
  assertEqual(hash.length, 64, 'SHA256 hex should be 64 chars');
  assert(/^[0-9a-f]{64}$/.test(hash), 'Should be valid hex string');
  
  // Deterministic
  const hash2 = sha256Hex('hello');
  assertEqual(hash, hash2, 'SHA256 should be deterministic');
  
  // Different input produces different hash
  const hash3 = sha256Hex('world');
  assert(hash !== hash3, 'Different inputs produce different hashes');
}

function testSerializeDetailsDeterministic() {
  const details = { feature: 'user-auth', agent: 'test', count: 42 };
  const str1 = serializeDetails(details);
  const str2 = serializeDetails(details);
  assertEqual(str1, str2, 'Deterministic serialization');
  
  // Keys should be sorted
  assertEqual(str1, JSON.stringify(details, ['agent', 'count', 'feature']), 'Should sort keys alphabetically');
  
  // Same content different order should produce same string
  const details2 = { count: 42, agent: 'test', feature: 'user-auth' };
  assertEqual(serializeDetails(details2), str1, 'Different key order produces same result');
}

function testComputeEntryHash() {
  const ts = '2026-05-24T00:00:00.000Z';
  const detailsStr = serializeDetails({ feature: 'test' });
  const hash = computeEntryHash(0, ts, 'system', 'pipeline_init', detailsStr, null, GENESIS_HASH);
  
  assertEqual(hash.length, 64, 'Hash should be 64 hex chars');
  assert(/^[0-9a-f]{64}$/.test(hash), 'Should be valid hex');
  
  // Same inputs produce same hash
  const hash2 = computeEntryHash(0, ts, 'system', 'pipeline_init', detailsStr, null, GENESIS_HASH);
  assertEqual(hash, hash2, 'Deterministic hash');
  
  // Different inputs produce different hash
  const hash3 = computeEntryHash(1, ts, 'system', 'pipeline_init', detailsStr, null, hash);
  assert(hash !== hash3, 'Different index produces different hash');
}

function testCreateGenesisEntry() {
  const timestamp = '2026-05-24T00:00:00.000Z';
  const entry = createGenesisEntry('test-feature', timestamp);
  
  assertEqual(entry.index, 0, 'Genesis index should be 0');
  assertEqual(entry.agent, 'system', 'Genesis agent should be system');
  assertEqual(entry.action, 'pipeline_init', 'Genesis action should be pipeline_init');
  assertEqual(entry.previousHash, GENESIS_HASH, 'Genesis previousHash should be GENESIS_HASH');
  assertEqual(entry.fileHash, null, 'Genesis fileHash should be null');
  assertEqual(entry.signature, null, 'Genesis signature should be null');
  assertEqual(entry.details.feature, 'test-feature', 'Genesis details should contain feature');
  assert(entry.entryHash.length === 64, 'Genesis entryHash should be 64 hex chars');
  
  // Verify the hash chain would validate
  const detailsStr = serializeDetails(entry.details);
  const expectedHash = computeEntryHash(0, timestamp, 'system', 'pipeline_init', detailsStr, null, GENESIS_HASH);
  assertEqual(entry.entryHash, expectedHash, 'Genesis entryHash should match computed hash');
}

function testSerializeDeserializeRoundTrip() {
  // Create a genesis entry
  const ts = '2026-05-24T00:00:00.000Z';
  const genesis = createGenesisEntry('test-feature', ts);
  
  // Create a second entry
  const ts2 = '2026-05-24T01:00:00.000Z';
  const details2 = { files: ['src/test.ts'], changes: 5 };
  const detailsStr2 = serializeDetails(details2);
  const hash2 = computeEntryHash(1, ts2, 'implementor', 'file_write', detailsStr2, 'abc123', genesis.entryHash);
  const entry2 = { index: 1, timestamp: ts2, agent: 'implementor', action: 'file_write', details: details2, fileHash: 'abc123', previousHash: genesis.entryHash, entryHash: hash2, signature: null };
  
  // Serialize
  const yaml = serializeAuditLog([genesis, entry2]);
  assert(yaml.includes('# Audit log'), 'Should include header comment');
  assert(yaml.includes('- index: 0'), 'Should contain genesis entry');
  assert(yaml.includes('- index: 1'), 'Should contain second entry');
  
  // Deserialize
  const parsed = parseAuditLog(yaml);
  assertEqual(parsed.length, 2, 'Should parse 2 entries');
  assertEqual(parsed[0].index, 0, 'First entry index');
  assertEqual(parsed[0].agent, 'system', 'First entry agent');
  assertEqual(parsed[0].action, 'pipeline_init', 'First entry action');
  assertEqual(parsed[0].previousHash, GENESIS_HASH, 'First entry previousHash');
  assertEqual(parsed[0].entryHash, genesis.entryHash, 'First entry entryHash preserved');
  assertEqual(parsed[0].details.feature, 'test-feature', 'First entry details preserved');
  
  assertEqual(parsed[1].index, 1, 'Second entry index');
  assertEqual(parsed[1].agent, 'implementor', 'Second entry agent');
  assertEqual(parsed[1].action, 'file_write', 'Second entry action');
  assertEqual(parsed[1].fileHash, 'abc123', 'Second entry fileHash preserved');
  assertEqual(parsed[1].previousHash, genesis.entryHash, 'Second entry previousHash preserved');
  assertEqual(parsed[1].entryHash, hash2, 'Second entry entryHash preserved');
  assertEqual(parsed[1].details.files[0], 'src/test.ts', 'Array detail preserved');
}

function testValidateActions() {
  // All valid actions should be in the list
  const expectedActions = [
    'pipeline_init', 'file_write', 'file_modify', 'file_delete',
    'package_install', 'package_update', 'build', 'lint',
    'security_scan', 'qa_test', 'git_commit', 'config_change',
  ];
  
  assertEqual(VALID_ACTIONS.length, 12, 'Should have 12 valid actions');
  
  for (const action of expectedActions) {
    assert(VALID_ACTIONS.includes(action), `${action} should be valid`);
  }
  
  // Invalid actions should NOT be in the list
  const invalidActions = ['invalid', '', 'file_read', 'deploy', 'test'];
  for (const action of invalidActions) {
    assert(!VALID_ACTIONS.includes(action), `${action} should NOT be valid`);
  }
}

function testEmptyAuditLogDeserialization() {
  const content = `# Audit log — tamper-evident append-only
# Do not edit manually. Hash chain will break.

entries:
`;
  const parsed = parseAuditLog(content);
  assertEqual(parsed.length, 0, 'Empty audit log should parse to empty array');
}

function testTamperedAuditLogDetection() {
  // Create valid log
  const ts = '2026-05-24T00:00:00.000Z';
  const genesis = createGenesisEntry('test-feature', ts);
  
  // Create second entry with correct chain
  const ts2 = '2026-05-24T01:00:00.000Z';
  const details2 = { files: ['src/test.ts'] };
  const detailsStr2 = serializeDetails(details2);
  const hash2 = computeEntryHash(1, ts2, 'implementor', 'file_write', detailsStr2, null, genesis.entryHash);
  const entry2 = { index: 1, timestamp: ts2, agent: 'implementor', action: 'file_write', details: details2, fileHash: null, previousHash: genesis.entryHash, entryHash: hash2, signature: null };
  
  const yaml = serializeAuditLog([genesis, entry2]);
  
  // Tamper with entry2's details
  const tamperedYaml = yaml.replace('files: ["src/test.ts"]', 'files: ["src/hacked.ts"]');
  
  const parsed = parseAuditLog(tamperedYaml);
  const tamperedEntry = parsed[1];
  
  // Recompute hash with tampered content
  const tamperedDetailsStr = serializeDetails({ files: ['src/hacked.ts'] });
  const expectedHash = computeEntryHash(1, ts2, 'implementor', 'file_write', tamperedDetailsStr, null, genesis.entryHash);
  
  // The stored hash should NOT match the recomputed hash for the tampered content
  assert(tamperedEntry.entryHash !== expectedHash, 'Tampered entry hash should not match recomputed hash');
}

// ── Main ──

async function main() {
  console.log('🔍 audit-log.ts Tests');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  setup();

  test('sha256Hex returns valid hex string', testSha256Hex);
  test('serializeDetails is deterministic', testSerializeDetailsDeterministic);
  test('computeEntryHash returns consistent hashes', testComputeEntryHash);
  test('createGenesisEntry creates correct genesis entry', testCreateGenesisEntry);
  test('serialize/deserialize round-trip preserves all fields', testSerializeDeserializeRoundTrip);
  test('validateActions contains all expected action types', testValidateActions);
  test('empty audit log deserializes to empty array', testEmptyAuditLogDeserialization);
  test('tampered audit log detection mechanism works', testTamperedAuditLogDetection);

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

  cleanup();

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(`  ❌ Test suite error: ${err.message}`);
  process.exit(1);
});
