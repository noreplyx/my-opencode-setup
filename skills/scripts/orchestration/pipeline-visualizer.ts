#!/usr/bin/env node
/**
 * Pipeline Visualizer
 *
 * Generates Mermaid.js pipeline visualization from agent history.
 *
 * Usage:
 *   [runtime] pipeline-visualizer.ts --from-context=<path-to-agent-context.md>
 *   [runtime] pipeline-visualizer.ts --from-file=<path-to-pipeline-history.json>
 *   [runtime] pipeline-visualizer.ts --all --out=<output-dir>
 *
 * Exit codes:
 *   0 = Success (diagram generated)
 *   1 = Error
 *   2 = Not applicable (no history found)
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Types ───────────────────────────────────────────────────────────────────

interface AgentHistoryEntry {
  step: string;
  agent: string;
  result: string;
  summary?: string;
  decisions?: string[];
  warnings?: string[];
  changedFiles?: string[];
  artifacts?: string[];
}

interface PipelineContext {
  pipelineId?: string;
  feature?: string;
  pipelineType?: string;
  currentStep?: string;
  status?: string;
  createdAt?: string;
  agentHistory?: AgentHistoryEntry[];
  [key: string]: unknown;
}

interface PipelineHistoryEntry {
  step: string;
  agent: string;
  result: string;
  summary?: string;
  timestamp?: string;
  duration?: number;
}

interface PipelineHistoryFile {
  pipelineId?: string;
  feature?: string;
  steps?: PipelineHistoryEntry[];
  [key: string]: unknown;
}

// ── Argument Parsing ────────────────────────────────────────────────────────

function parseArgs(): Record<string, string> {
  const args = process.argv.slice(2);
  const result: Record<string, string> = {};

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showUsageAndExit(0);
  }

  for (const arg of args) {
    if (arg.startsWith('--') && arg.includes('=')) {
      const eqIdx = arg.indexOf('=');
      const key = arg.substring(2, eqIdx);
      const value = arg.substring(eqIdx + 1);
      result[key] = value;
    }
  }

  // Check for --all flag (no =value)
  if (args.includes('--all')) {
    result['_all'] = 'true';
  }

  return result;
}

function showUsageAndExit(exitCode: number): void {
  console.log(`
Pipeline Visualizer — Mermaid.js pipeline diagram generator

Usage:
  [runtime] pipeline-visualizer.ts --from-context=<path-to-agent-context.md>
  [runtime] pipeline-visualizer.ts --from-file=<path-to-pipeline-history.json>
  [runtime] pipeline-visualizer.ts --all --out=<output-dir>

Options:
  --from-context   Path to agent-context.md with YAML frontmatter
  --from-file      Path to a JSON pipeline history file
  --all            Scan .opencode/pipeline-logs/ for all archived contexts
  --out            Output directory (required with --all)

Exit codes:
  0 = Success
  1 = Error
  2 = No history found
  `.trim());
  process.exit(exitCode);
}

// ── YAML Parsing (same pattern as validate-context.ts) ──────────────────────

function parseFrontmatter(content: string): { frontmatter: string | null; body: string } {
  content = content.replace(/\r\n/g, '\n');
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { frontmatter: null, body: content };
  }
  return { frontmatter: match[1], body: content.slice(match[0].length) };
}

function parseYamlBlock(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');
  const stack: Array<{ key: string; obj: Record<string, unknown> }> = [];
  const indentStack: number[] = [];

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

/**
 * Extract array items from a parsed YAML object that may contain array-like
 * data stored as indexed numeric keys.
 */
function extractArray(obj: unknown): AgentHistoryEntry[] {
  if (Array.isArray(obj)) {
    return obj as AgentHistoryEntry[];
  }
  if (typeof obj === 'object' && obj !== null) {
    // Some YAML parsers store arrays as objects with numeric keys
    const entries: AgentHistoryEntry[] = [];
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      if (/^\d+$/.test(key) && typeof val === 'object' && val !== null) {
        entries.push(val as AgentHistoryEntry);
      }
    }
    return entries.sort((a, b) => {
      const aIdx = Object.keys(obj as Record<string, unknown>).indexOf(String(entries.indexOf(a)));
      const bIdx = Object.keys(obj as Record<string, unknown>).indexOf(String(entries.indexOf(b)));
      return aIdx - bIdx;
    });
  }
  return [];
}

/**
 * Normalize agent history from various possible structures into a uniform array.
 */
function normalizeAgentHistory(context: PipelineContext): AgentHistoryEntry[] {
  const raw = context.agentHistory;
  if (!raw) return [];
  return extractArray(raw);
}

// ── Mermaid Diagram Generation ─────────────────────────────────────────────

const RESULT_COLORS: Record<string, string> = {
  completed: 'fill:#e8f5e9,stroke:#388e3c',
  passed: 'fill:#e8f5e9,stroke:#388e3c',
  success: 'fill:#e8f5e9,stroke:#388e3c',
  failed: 'fill:#ffebee,stroke:#d32f2f',
  error: 'fill:#ffebee,stroke:#d32f2f',
  partial: 'fill:#fff8e1,stroke:#f9a825',
  warning: 'fill:#fff8e1,stroke:#f9a825',
  skipped: 'fill:#f3e5f5,stroke:#7b1fa2',
};

const STEP_CLASS = 'fill:#e1f5fe,stroke:#0288d1';
const WARN_CLASS = 'fill:#fff8e1,stroke:#f9a825';

function getNodeClass(result: string): string {
  const normalized = result.toLowerCase();
  if (RESULT_COLORS[normalized]) return RESULT_COLORS[normalized];
  return STEP_CLASS;
}

function getResultLabel(result: string): string {
  switch (result.toLowerCase()) {
    case 'completed':
    case 'passed':
    case 'success':
      return '✅';
    case 'failed':
    case 'error':
      return '❌';
    case 'partial':
    case 'warning':
      return '⚠️';
    default:
      return '';
  }
}

function generateMermaidDiagram(entries: AgentHistoryEntry[], pipelineId?: string): string {
  if (entries.length === 0) {
    return '```mermaid\nflowchart LR\n  Empty["No agent history found"]\n```';
  }

  const lines: string[] = [];
  lines.push('```mermaid');
  lines.push('graph LR');
  lines.push('');

  const nodeIds: string[] = [];
  const edgeLines: string[] = [];

  // Track agent name counts for loop detection
  const agentStepCount: Record<string, number> = {};
  const agentFirstIndex: Record<string, number> = {};

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const step = entry.step || 'unknown';
    const agent = entry.agent || step;
    const result = entry.result || 'completed';
    const summary = entry.summary || '';

    const nodeId = `S${i}`;
    nodeIds.push(nodeId);

    // Track if this agent appeared before (loop detection)
    const agentKey = step;
    if (agentStepCount[agentKey] === undefined) {
      agentStepCount[agentKey] = 0;
      agentFirstIndex[agentKey] = i;
    }
    agentStepCount[agentKey]++;

    // Build node label: show agent name, optionally with result emoji
    const resultLabel = getResultLabel(result);
    const label = resultLabel ? `${step} ${resultLabel}` : step;
    const nodeStyle = getNodeClass(result);

    // Check if this is a fixer loop (appears more than once)
    const isLoop = agentStepCount[agentKey] > 1;
    const styleClass = isLoop ? 'warn' : 'step';

    lines.push(`  ${nodeId}["${label}"]:::${styleClass}`);

    // Edge from previous node
    if (i > 0) {
      edgeLines.push(`  ${nodeIds[i - 1]} --> ${nodeId}`);
    }
  }

  lines.push('');

  // Add edges
  for (const edge of edgeLines) {
    lines.push(edge);
  }

  lines.push('');
  lines.push('  classDef step fill:#e1f5fe,stroke:#0288d1');
  lines.push('  classDef fail fill:#ffebee,stroke:#d32f2f');
  lines.push('  classDef pass fill:#e8f5e9,stroke:#388e3c');
  lines.push('  classDef warn fill:#fff8e1,stroke:#f9a825');
  lines.push('```');

  if (pipelineId) {
    lines.push('');
    lines.push(`_Pipeline: ${pipelineId}_`);
  }

  return lines.join('\n');
}

// ── History File Generation ─────────────────────────────────────────────────

function generateMarkdownFile(mermaid: string, pipelineId: string): string {
  const lines: string[] = [];
  lines.push(`# Pipeline Visualization — ${pipelineId}`);
  lines.push('');
  lines.push(mermaid);
  lines.push('');
  return lines.join('\n');
}

// ── Command Handlers ────────────────────────────────────────────────────────

function cmdFromContext(contextPath: string): void {
  if (!fs.existsSync(contextPath)) {
    console.error(`❌ File not found: ${contextPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(contextPath, 'utf-8');
  const { frontmatter } = parseFrontmatter(content);

  if (!frontmatter) {
    console.error(`❌ No YAML frontmatter found in: ${contextPath}`);
    process.exit(1);
  }

  const parsed = parseYamlBlock(frontmatter) as PipelineContext;
  const pipelineId = parsed.pipelineId || 'unknown';
  const entries = normalizeAgentHistory(parsed);

  if (entries.length === 0) {
    console.log('⏭️  No agent history found in context');
    process.exit(2);
  }

  const mermaid = generateMermaidDiagram(entries, pipelineId);
  const markdown = generateMarkdownFile(mermaid, pipelineId);

  // Write output file next to the context file
  const contextDir = path.dirname(path.resolve(contextPath));
  const outputFile = path.join(contextDir, `${pipelineId}-pipeline.md`);

  fs.writeFileSync(outputFile, markdown, 'utf-8');
  console.log(`✅ Pipeline diagram written to: ${outputFile}`);
}

function cmdFromFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    process.exit(1);
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.error(`❌ Could not read file: ${filePath}`);
    process.exit(1);
  }

  let data: PipelineHistoryFile;
  try {
    data = JSON.parse(raw) as PipelineHistoryFile;
  } catch {
    console.error(`❌ Invalid JSON in: ${filePath}`);
    process.exit(1);
  }

  const pipelineId = data.pipelineId || path.basename(filePath, '.json');

  // Convert pipeline history steps to agent history entries
  const entries: AgentHistoryEntry[] = [];
  if (Array.isArray(data.steps)) {
    for (const step of data.steps) {
      entries.push({
        step: step.step || 'unknown',
        agent: step.agent || step.step || 'unknown',
        result: step.result || 'completed',
        summary: step.summary,
      });
    }
  }

  if (entries.length === 0) {
    console.log('⏭️  No steps found in pipeline history file');
    process.exit(2);
  }

  const mermaid = generateMermaidDiagram(entries, pipelineId);

  // Write output next to the input file
  const fileDir = path.dirname(path.resolve(filePath));
  const outputFile = path.join(fileDir, `${pipelineId}-pipeline.md`);

  const markdown = generateMarkdownFile(mermaid, pipelineId);
  fs.writeFileSync(outputFile, markdown, 'utf-8');
  console.log(`✅ Pipeline diagram written to: ${outputFile}`);
}

function cmdAll(outDir: string): void {
  const resolvedOut = path.resolve(outDir);

  // Create output directory if needed
  if (!fs.existsSync(resolvedOut)) {
    fs.mkdirSync(resolvedOut, { recursive: true });
  }

  // Look for .opencode/pipeline-logs/
  const possibleDirs = [
    path.resolve('.opencode', 'pipeline-logs'),
    path.resolve(process.cwd(), '.opencode', 'pipeline-logs'),
  ];

  let logDir: string | null = null;
  for (const dir of possibleDirs) {
    if (fs.existsSync(dir)) {
      logDir = dir;
      break;
    }
  }

  if (!logDir) {
    console.error('❌ No .opencode/pipeline-logs/ directory found');
    process.exit(1);
  }

  // Find all agent-context.md files (may be nested under pipeline log dirs)
  const files = findContextFiles(logDir);
  if (files.length === 0) {
    console.log('⏭️  No agent-context.md files found in pipeline logs');
    process.exit(2);
  }

  let generated = 0;
  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const { frontmatter } = parseFrontmatter(content);

      if (!frontmatter) continue;

      const parsed = parseYamlBlock(frontmatter) as PipelineContext;
      const pipelineId = parsed.pipelineId || `pipeline-${path.basename(path.dirname(filePath))}`;
      const entries = normalizeAgentHistory(parsed);

      if (entries.length === 0) continue;

      const mermaid = generateMermaidDiagram(entries, pipelineId);
      const markdown = generateMarkdownFile(mermaid, pipelineId);

      const outputFile = path.join(resolvedOut, `${pipelineId}-pipeline.md`);
      fs.writeFileSync(outputFile, markdown, 'utf-8');
      console.log(`  ✅ ${pipelineId} → ${path.basename(outputFile)}`);
      generated++;
    } catch {
      // Skip files that fail parsing
      console.error(`  ⚠️  Skipped: ${filePath} (parse error)`);
    }
  }

  console.log('');
  console.log(`✅ Generated ${generated} pipeline diagram(s) in: ${resolvedOut}`);
}

function findContextFiles(dir: string): string[] {
  const results: string[] = [];

  function walk(currentDir: string): void {
    let entries: string[];
    try {
      entries = fs.readdirSync(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (entry === 'agent-context.md') {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

// ── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs();
  const fromContext = args['from-context'];
  const fromFile = args['from-file'];
  const outDir = args['out'];
  const allMode = args['_all'] === 'true';

  // Validate argument combinations
  const modeCount = [fromContext, fromFile, allMode ? '--all' : null].filter(Boolean).length;

  if (modeCount === 0) {
    console.error('❌ Must specify one of: --from-context, --from-file, --all');
    showUsageAndExit(1);
  }

  if (modeCount > 1) {
    console.error('❌ Specify only one mode: --from-context, --from-file, or --all');
    process.exit(1);
  }

  if (fromContext) {
    cmdFromContext(fromContext);
  } else if (fromFile) {
    cmdFromFile(fromFile);
  } else if (allMode) {
    if (!outDir) {
      console.error('❌ --out=<output-dir> is required with --all');
      process.exit(1);
    }
    cmdAll(outDir);
  }
}

main();
