#!/usr/bin/env ts-node
/**
 * Audit Log Script
 *
 * Creates and manages a tamper-evident append-only audit log of agent actions.
 * Uses a SHA-256 hash chain for integrity verification.
 *
 * Usage:
 *   ts-node audit-log.ts init --pipeline-id=<id> --feature=<name> [--dir=<project-dir>]
 *   ts-node audit-log.ts append --pipeline-id=<id> --agent=<name> --action=<type> \
 *     --details=<json> [--file-hashes=<json>] [--dir=<project-dir>]
 *   ts-node audit-log.ts verify --pipeline-id=<id> [--dir=<project-dir>]
 *   ts-node audit-log.ts report --pipeline-id=<id> [--dir=<project-dir>] [--since=<iso-timestamp>]
 *
 * Exit codes:
 *   0 = Success
 *   1 = Error
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

const VALID_ACTIONS = [
  'pipeline_init',
  'file_write',
  'file_modify',
  'file_delete',
  'npm_install',
  'npm_update',
  'build',
  'lint',
  'security_scan',
  'qa_test',
  'git_commit',
  'config_change',
] as const;

type AuditAction = (typeof VALID_ACTIONS)[number];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditEntry {
  index: number;
  timestamp: string;
  agent: string;
  action: AuditAction;
  details: Record<string, unknown>;
  fileHash: string | null;
  previousHash: string;
  entryHash: string;
  signature: string | null;
}

interface FileHashEntry {
  file: string;
  sha256: string;
}

interface AuditLogData {
  entries: AuditEntry[];
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function parseArgs(): Record<string, string> {
  const args = process.argv.slice(2);
  const result: Record<string, string> = {};

  const command = args.find(a => !a.startsWith('--'));
  if (command) {
    result['_command'] = command;
  }

  for (const arg of args) {
    if (arg.startsWith('--') && arg.includes('=')) {
      const eqIdx = arg.indexOf('=');
      const key = arg.substring(2, eqIdx);
      const value = arg.substring(eqIdx + 1);
      result[key] = value;
    }
  }

  return result;
}

function showUsageAndExit(exitCode = 0): void {
  console.log(`
Audit Log — Tamper-evident append-only audit log

Usage:
  ts-node audit-log.ts init --pipeline-id=<id> --feature=<name> [--dir=<project-dir>]
  ts-node audit-log.ts append --pipeline-id=<id> --agent=<name> --action=<type> \\
    --details=<json> [--file-hashes=<json>] [--dir=<project-dir>]
  ts-node audit-log.ts verify --pipeline-id=<id> [--dir=<project-dir>]
  ts-node audit-log.ts report --pipeline-id=<id> [--dir=<project-dir>] [--since=<iso-timestamp>]

Commands:
  init     Create a new audit log with genesis entry
  append   Append a new entry to an existing audit log
  verify   Verify the integrity of the hash chain
  report   Print a human-readable audit trail

Valid actions:
  file_write, file_modify, file_delete, npm_install, npm_update, build,
  lint, security_scan, qa_test, git_commit, config_change
  `.trim());
  process.exit(exitCode);
}

// ---------------------------------------------------------------------------
// Audit log file I/O
// ---------------------------------------------------------------------------

function getAuditDir(projectDir: string): string {
  return path.resolve(projectDir, '.opencode', 'audit');
}

function getAuditFilePath(projectDir: string, pipelineId: string): string {
  return path.join(getAuditDir(projectDir), `${pipelineId}.audit.yaml`);
}

function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// YAML serialization (manual, no external dependencies)
// ---------------------------------------------------------------------------

function serializeValue(value: unknown, indent: number): string {
  const pad = '  '.repeat(indent);

  if (value === null || value === undefined) {
    return 'null';
  }

  if (typeof value === 'string') {
    // Escape double quotes and wrap in quotes if contains special chars
    if (value.includes(': ') || value.includes('#') || value.includes('\n') || value === '') {
      return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map(v => {
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        const objLines = serializeObject(v as Record<string, unknown>, indent + 1);
        return `${pad}- ${objLines.trimStart()}`;
      }
      return `${pad}- ${serializeValue(v, indent + 1)}`;
    });
    return '\n' + items.join('\n');
  }

  if (typeof value === 'object') {
    return '\n' + serializeObject(value as Record<string, unknown>, indent);
  }

  return String(value);
}

function serializeObject(obj: Record<string, unknown>, indent: number): string {
  const pad = '  '.repeat(indent);
  const lines: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      lines.push(`${pad}${key}: null`);
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      const nestedKeys = Object.keys(value as Record<string, unknown>);
      if (nestedKeys.length === 0) {
        lines.push(`${pad}${key}: {}`);
      } else {
        lines.push(`${pad}${key}:`);
        lines.push(serializeObject(value as Record<string, unknown>, indent + 1));
      }
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${pad}${key}: []`);
      } else {
        lines.push(`${pad}${key}:`);
        const serialized = serializeValue(value, indent + 1);
        lines.push(serialized.startsWith('\n') ? serialized.slice(1) : serialized);
      }
    } else {
      const formatted = serializeValue(value, 0);
      lines.push(`${pad}${key}: ${formatted}`);
    }
  }

  return lines.join('\n');
}

function serializeAuditLog(data: AuditLogData): string {
  const yamlLines: string[] = [];

  yamlLines.push('# Audit log — tamper-evident append-only');
  yamlLines.push('# Do not edit manually. Hash chain will break.');
  yamlLines.push('');
  yamlLines.push('entries:');

  for (const entry of data.entries) {
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

// ---------------------------------------------------------------------------
// YAML parsing (manual, no external dependencies)
// ---------------------------------------------------------------------------

function parseAuditLog(content: string): AuditLogData {
  const entries: AuditEntry[] = [];
  const lines = content.split('\n');

  let currentEntry: Partial<AuditEntry> | null = null;
  let currentDetails: Record<string, unknown> | null = null;
  let inDetails = false;
  let detailsIndent = 0;
  let currentListKey: string | null = null;
  let currentListIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Skip comments and empty lines
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }

    // Detect entry start
    if (trimmed.startsWith('- index:')) {
      if (currentEntry && currentEntry.index !== undefined) {
        entries.push(currentEntry as AuditEntry);
      }
      currentEntry = {};
      currentDetails = null;
      inDetails = false;
      currentListKey = null;

      const val = trimmed.split(':')[1].trim();
      currentEntry.index = parseInt(val, 10);
      continue;
    }

    if (!currentEntry) continue;

    // Parse key-value pairs
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.substring(0, colonIdx).trim();
    const valueRaw = trimmed.substring(colonIdx + 1).trim();

    // Handle indentation tracking for details
    const indent = rawLine.search(/\S/);

    if (key === 'details') {
      inDetails = true;
      detailsIndent = indent;
      currentDetails = {};
      currentEntry.details = currentDetails;
      currentListKey = null;
      continue;
    }

    if (inDetails && indent <= detailsIndent) {
      inDetails = false;
    }

    if (inDetails && currentDetails !== null) {
      parseNestedKey(rawLine, currentDetails, indent, detailsIndent, lines, i);
      continue;
    }

    // Top-level entry keys
    switch (key) {
      case 'timestamp':
        currentEntry.timestamp = parseQuotedString(valueRaw);
        break;
      case 'agent':
        currentEntry.agent = parseQuotedString(valueRaw);
        break;
      case 'action':
        currentEntry.action = parseQuotedString(valueRaw) as AuditAction;
        break;
      case 'fileHash':
        currentEntry.fileHash = valueRaw === 'null' ? null : parseQuotedString(valueRaw);
        break;
      case 'previousHash':
        currentEntry.previousHash = parseQuotedString(valueRaw);
        break;
      case 'entryHash':
        currentEntry.entryHash = parseQuotedString(valueRaw);
        break;
      case 'signature':
        currentEntry.signature = valueRaw === 'null' ? null : parseQuotedString(valueRaw);
        break;
    }
  }

  // Push last entry
  if (currentEntry && currentEntry.index !== undefined) {
    entries.push(currentEntry as AuditEntry);
  }

  return { entries };
}

function parseQuotedString(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseNestedKey(
  rawLine: string,
  target: Record<string, unknown>,
  indent: number,
  parentIndent: number,
  lines: string[],
  currentIdx: number,
): void {
  const trimmed = rawLine.trim();
  const colonIdx = trimmed.indexOf(':');

  if (colonIdx === -1) return;

  const key = trimmed.substring(0, colonIdx).trim();
  const valueRaw = trimmed.substring(colonIdx + 1).trim();

  // List item
  if (key.startsWith('- ')) {
    // This is a top-level list item under a parent key
    const listVal = key.substring(2).trim();
    // Try to find the parent array
    // For simple key: value list items, they are at the start
    if (valueRaw === '' || colonIdx === -1) {
      // Scalar list item or object start
    }
    return;
  }

  // Check for nested list (array of scalars or objects)
  if (valueRaw === '' || valueRaw.startsWith('#')) {
    // Might be an array or nested object — look ahead
    const nextLine = lines[currentIdx + 1]?.trim();
    if (nextLine?.startsWith('- ')) {
      // Array — collect items
      const arr: unknown[] = [];
      let j = currentIdx + 1;
      while (j < lines.length) {
        const nl = lines[j].trim();
        const nli = lines[j].search(/\S/);
        if (nli <= indent) break;
        if (nl.startsWith('- ')) {
          const itemVal = nl.substring(2).trim();
          const icIdx = itemVal.indexOf(':');
          if (icIdx !== -1 && itemVal.substring(icIdx + 1).trim() === '') {
            // Nested object in array
            const obj: Record<string, unknown> = {};
            const objKey = itemVal.substring(0, icIdx).trim();
            const nextNext = lines[j + 1]?.trim();
            if (nextNext && !nextNext.startsWith('- ') && lines[j + 1]?.search(/\S/) > nli) {
              // Object with properties
              j++;
              while (j < lines.length) {
                const pl = lines[j].trim();
                const pli = lines[j].search(/\S/);
                if (pli <= nli || pl.startsWith('- ')) break;
                const pcIdx = pl.indexOf(':');
                if (pcIdx !== -1) {
                  const pk = pl.substring(0, pcIdx).trim();
                  const pv = pl.substring(pcIdx + 1).trim();
                  obj[pk] = parseYamlScalarValue(pv);
                }
                j++;
              }
              // Wrap in outer object
              const wrapper: Record<string, unknown> = {};
              wrapper[objKey] = obj;
              arr.push(wrapper);
              continue;
            } else {
              obj[objKey] = null;
              arr.push(obj);
            }
          } else {
            const icIdx2 = itemVal.indexOf(':');
            if (icIdx2 !== -1) {
              const ok = itemVal.substring(0, icIdx2).trim();
              const ov = itemVal.substring(icIdx2 + 1).trim();
              const obj: Record<string, unknown> = {};
              obj[ok] = parseYamlScalarValue(ov);
              arr.push(obj);
            } else {
              arr.push(parseYamlScalarValue(itemVal));
            }
          }
        }
        j++;
      }
      target[key] = arr;
      return;
    }

    // Nested object
    const nested: Record<string, unknown> = {};
    let j = currentIdx + 1;
    while (j < lines.length) {
      const nl = lines[j].trim();
      if (nl === '' || nl.startsWith('#')) { j++; continue; }
      const nli = lines[j].search(/\S/);
      if (nli <= indent) break;
      const ncIdx = nl.indexOf(':');
      if (ncIdx !== -1) {
        const nk = nl.substring(0, ncIdx).trim();
        const nv = nl.substring(ncIdx + 1).trim();
        if (nv === '' || nv.startsWith('#')) {
          parseNestedKey(lines[j], nested, nli, indent, lines, j);
        } else {
          nested[nk] = parseYamlScalarValue(nv);
        }
      }
      j++;
    }
    target[key] = nested;
    return;
  }

  // Simple key: value
  target[key] = parseYamlScalarValue(valueRaw);
}

function parseYamlScalarValue(value: string): unknown {
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  if (/^\d+\.\d+$/.test(value)) return parseFloat(value);
  return parseQuotedString(value);
}

// ---------------------------------------------------------------------------
// Hash computation
// ---------------------------------------------------------------------------

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf-8').digest('hex');
}

function computeEntryHash(
  index: number,
  timestamp: string,
  agent: string,
  action: string,
  detailsStr: string,
  fileHash: string | null,
  previousHash: string,
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

// ---------------------------------------------------------------------------
// Genesis entry creation
// ---------------------------------------------------------------------------

function createGenesisEntry(feature: string): AuditEntry {
  const timestamp = new Date().toISOString();
  const details: Record<string, unknown> = { feature };

  const detailsStr = serializeDetails(details);
  const entryHash = computeEntryHash(
    0,
    timestamp,
    'system',
    'pipeline_init',
    detailsStr,
    null,
    GENESIS_HASH,
  );

  return {
    index: 0,
    timestamp,
    agent: 'system',
    action: 'pipeline_init',
    details,
    fileHash: null,
    previousHash: GENESIS_HASH,
    entryHash,
    signature: null,
  };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdInit(args: Record<string, string>): void {
  const pipelineId = args['pipeline-id'];
  const feature = args.feature;
  const projectDir = args.dir || '.';

  if (!pipelineId) {
    console.error('❌ Missing required argument: --pipeline-id=<id>');
    process.exit(1);
  }

  if (!feature) {
    console.error('❌ Missing required argument: --feature=<name>');
    process.exit(1);
  }

  const auditDir = getAuditDir(projectDir);
  const auditFile = getAuditFilePath(projectDir, pipelineId);

  // Create audit directory if needed
  if (!fs.existsSync(auditDir)) {
    fs.mkdirSync(auditDir, { recursive: true });
  }

  // Check if already exists
  if (fileExists(auditFile)) {
    console.error(`❌ Audit log already exists: ${auditFile}`);
    process.exit(1);
  }

  // Create genesis entry
  const genesis = createGenesisEntry(feature);
  const data: AuditLogData = { entries: [genesis] };
  const yaml = serializeAuditLog(data);

  fs.writeFileSync(auditFile, yaml, 'utf-8');
  console.log(`✅ Audit log initialized: ${auditFile}`);
  console.log(`   Pipeline ID: ${pipelineId}`);
  console.log(`   Feature: ${feature}`);
  console.log(`   Genesis hash: ${genesis.entryHash}`);
}

function cmdAppend(args: Record<string, string>): void {
  const pipelineId = args['pipeline-id'];
  const agent = args.agent;
  const action = args.action as AuditAction;
  const detailsRaw = args.details;
  const fileHashesRaw = args['file-hashes'];
  const projectDir = args.dir || '.';

  if (!pipelineId) {
    console.error('❌ Missing required argument: --pipeline-id=<id>');
    process.exit(1);
  }

  if (!agent) {
    console.error('❌ Missing required argument: --agent=<name>');
    process.exit(1);
  }

  if (!action) {
    console.error('❌ Missing required argument: --action=<type>');
    process.exit(1);
  }

  if (!VALID_ACTIONS.includes(action)) {
    console.error(`❌ Invalid action: "${action}". Valid actions: ${VALID_ACTIONS.join(', ')}`);
    process.exit(1);
  }

  if (!detailsRaw) {
    console.error('❌ Missing required argument: --details=<json>');
    process.exit(1);
  }

  // Parse details JSON
  let details: Record<string, unknown>;
  try {
    details = JSON.parse(detailsRaw);
  } catch {
    console.error('❌ Invalid JSON for --details');
    process.exit(1);
  }

  // Parse file hashes
  let fileHashes: FileHashEntry[] = [];
  let fileHash: string | null = null;

  if (fileHashesRaw) {
    try {
      fileHashes = JSON.parse(fileHashesRaw);
      if (!Array.isArray(fileHashes)) {
        console.error('❌ --file-hashes must be a JSON array');
        process.exit(1);
      }
      // Compute combined hash of all file hashes
      const combined = fileHashes
        .map(fh => `${fh.file}:${fh.sha256}`)
        .sort()
        .join('|');
      fileHash = sha256Hex(combined);
    } catch {
      console.error('❌ Invalid JSON for --file-hashes');
      process.exit(1);
    }
  }

  // Validate file-hashes requirement for file actions
  if ((action === 'file_write' || action === 'file_modify') && !fileHashesRaw) {
    console.error(`❌ --file-hashes is required for action "${action}"`);
    process.exit(1);
  }

  const auditFile = getAuditFilePath(projectDir, pipelineId);

  if (!fileExists(auditFile)) {
    console.error(`❌ Audit log not found: ${auditFile}. Run init first.`);
    process.exit(1);
  }

  // Read existing log
  const content = fs.readFileSync(auditFile, 'utf-8');
  const data = parseAuditLog(content);

  if (data.entries.length === 0) {
    console.error('❌ Audit log is empty — possible corruption');
    process.exit(1);
  }

  const lastEntry = data.entries[data.entries.length - 1];
  const newIndex = lastEntry.index + 1;
  const timestamp = new Date().toISOString();

  // Build entry
  const detailsStr = serializeDetails(details);
  const entryHash = computeEntryHash(
    newIndex,
    timestamp,
    agent,
    action,
    detailsStr,
    fileHash,
    lastEntry.entryHash,
  );

  const newEntry: AuditEntry = {
    index: newIndex,
    timestamp,
    agent,
    action,
    details,
    fileHash,
    previousHash: lastEntry.entryHash,
    entryHash,
    signature: null,
  };

  data.entries.push(newEntry);

  // Write back
  const yaml = serializeAuditLog(data);
  fs.writeFileSync(auditFile, yaml, 'utf-8');

  console.log(`✅ Entry #${newIndex} appended to audit log`);
  console.log(`   Agent: ${agent}`);
  console.log(`   Action: ${action}`);
  console.log(`   Entry hash: ${entryHash}`);
  console.log(`   Previous hash: ${lastEntry.entryHash}`);
}

function cmdVerify(args: Record<string, string>): void {
  const pipelineId = args['pipeline-id'];
  const projectDir = args.dir || '.';

  if (!pipelineId) {
    console.error('❌ Missing required argument: --pipeline-id=<id>');
    process.exit(1);
  }

  const auditFile = getAuditFilePath(projectDir, pipelineId);

  if (!fileExists(auditFile)) {
    console.error(`❌ Audit log not found: ${auditFile}`);
    process.exit(1);
  }

  const content = fs.readFileSync(auditFile, 'utf-8');
  const data = parseAuditLog(content);

  if (data.entries.length === 0) {
    console.error('❌ Audit log is empty');
    process.exit(1);
  }

  let chainBroken = false;
  let brokenAtIndex = -1;

  for (let i = 0; i < data.entries.length; i++) {
    const entry = data.entries[i];

    // Compute expected hash
    const detailsStr = serializeDetails(entry.details as Record<string, unknown>);
    const expectedHash = computeEntryHash(
      entry.index,
      entry.timestamp,
      entry.agent,
      entry.action,
      detailsStr,
      entry.fileHash,
      entry.previousHash,
    );

    // Check entry hash
    if (expectedHash !== entry.entryHash) {
      chainBroken = true;
      brokenAtIndex = entry.index;
      console.log(`❌ Entry #${entry.index}: hash MISMATCH`);
      console.log(`   Expected: ${expectedHash}`);
      console.log(`   Stored:   ${entry.entryHash}`);
      break;
    }

    // Check previous hash chain (skip genesis)
    if (i > 0) {
      const prevEntry = data.entries[i - 1];
      if (entry.previousHash !== prevEntry.entryHash) {
        chainBroken = true;
        brokenAtIndex = entry.index;
        console.log(`❌ Entry #${entry.index}: previousHash MISMATCH`);
        console.log(`   Expected: ${prevEntry.entryHash}`);
        console.log(`   Stored:   ${entry.previousHash}`);
        break;
      }
    } else {
      // Genesis must have GENESIS_HASH
      if (entry.previousHash !== GENESIS_HASH) {
        chainBroken = true;
        brokenAtIndex = 0;
        console.log(`❌ Genesis entry #${entry.index}: previousHash should be genesis hash`);
        break;
      }
    }
  }

  if (chainBroken) {
    console.log('');
    console.log(`Chain integrity: ❌ BROKEN at entry ${brokenAtIndex}`);
    process.exit(1);
  } else {
    console.log(`✅ All ${data.entries.length} entries verified`);
    console.log(`Chain integrity: ✅ INTACT`);
  }
}

function cmdReport(args: Record<string, string>): void {
  const pipelineId = args['pipeline-id'];
  const projectDir = args.dir || '.';
  const sinceRaw = args.since;

  if (!pipelineId) {
    console.error('❌ Missing required argument: --pipeline-id=<id>');
    process.exit(1);
  }

  const auditFile = getAuditFilePath(projectDir, pipelineId);

  if (!fileExists(auditFile)) {
    console.error(`❌ Audit log not found: ${auditFile}`);
    process.exit(1);
  }

  const content = fs.readFileSync(auditFile, 'utf-8');
  const data = parseAuditLog(content);

  if (data.entries.length === 0) {
    console.log('No audit entries found.');
    return;
  }

  // Parse since filter
  let sinceFilter: Date | null = null;
  if (sinceRaw) {
    sinceFilter = new Date(sinceRaw);
    if (isNaN(sinceFilter.getTime())) {
      console.error(`❌ Invalid --since timestamp: "${sinceRaw}"`);
      process.exit(1);
    }
  }

  // Filter entries
  let filteredEntries = data.entries;
  if (sinceFilter) {
    filteredEntries = data.entries.filter(e => new Date(e.timestamp) >= sinceFilter!);
  }

  if (filteredEntries.length === 0) {
    console.log('No entries match the filters.');
    return;
  }

  const separator = '─'.repeat(72);

  console.log(`Audit Trail — Pipeline: ${pipelineId}`);
  console.log(`Entries: ${filteredEntries.length} (of ${data.entries.length} total)`);
  if (sinceFilter) {
    console.log(`Since: ${sinceFilter.toISOString()}`);
  }
  console.log(separator);

  for (const entry of filteredEntries) {
    const dt = new Date(entry.timestamp);
    const timeStr = dt.toISOString().replace('T', ' ').substring(0, 19);

    console.log(`  #${String(entry.index).padStart(3, ' ')}  ${timeStr}  ${entry.agent.padEnd(12, ' ')}  ${entry.action}`);
    console.log(`       Previous: ${entry.previousHash.substring(0, 16)}...`);
    console.log(`       Entry:    ${entry.entryHash.substring(0, 16)}...`);

    // Show details compactly
    const detailKeys = Object.keys(entry.details);
    if (detailKeys.length > 0) {
      const detailStr = detailKeys.map(k => {
        const v = entry.details[k];
        if (Array.isArray(v)) {
          return `${k}: [${v.length} items]`;
        }
        return `${k}: ${String(v).substring(0, 60)}`;
      }).join(', ');
      console.log(`       Details: ${detailStr}`);
    }

    if (entry.fileHash) {
      console.log(`       File hash: ${entry.fileHash.substring(0, 16)}...`);
    }

    console.log('');
  }

  console.log(separator);
  console.log(`End of audit trail — ${filteredEntries.length} entries shown`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs();
  const command = args['_command'];

  // --help or no command
  if (!command || command === '--help' || command === '-h') {
    showUsageAndExit(0);
  }

  switch (command) {
    case 'init':
      cmdInit(args);
      break;
    case 'append':
      cmdAppend(args);
      break;
    case 'verify':
      cmdVerify(args);
      break;
    case 'report':
      cmdReport(args);
      break;
    default:
      console.error(`❌ Unknown command: "${command}"`);
      console.error('Valid commands: init, append, verify, report');
      process.exit(1);
  }
}

main();
