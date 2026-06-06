#!/usr/bin/env node
/**
 * Pre-Flight Agent Readiness Check
 *
 * Verifies that all agents needed by a pipeline have the correct tool permissions
 * and skill access before the pipeline starts. Prevents "agent silently fails
 * mid-pipeline because it lacks write access" type bugs.
 *
 * Usage:
 *   [runtime] check-agent-readiness.ts --agents=implementor,verifier,qa
 *   [runtime] check-agent-readiness.ts --pipeline-type=full
 *   [runtime] check-agent-readiness.ts --file=agent-context.md
 *   [runtime] check-agent-readiness.ts --agents=implementor --format=json
 *   [runtime] check-agent-readiness.ts --agents=implementor --fix --apply
 *
 * Exit codes:
 *   0 = all agents ready
 *   1 = some agents not ready (blocking issues exist)
 *   2 = config parsing error
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AgentName =
  | 'finder'
  | 'plandescriber'
  | 'implementor'
  | 'fixer'
  | 'qa'
  | 'verifier'
  | 'integrator'
  | 'browser-tester'
  | 'documentor'
  | 'debug';

type PipelineType = 'full' | 'quick' | 'fixer-only' | 'parallel-feature' | 'tdd' | 'security-fix' | 'ui-bug';

type IssueSeverity = 'error' | 'warning';

type AgentStatus = 'ready' | 'has_warnings' | 'not_ready';

interface AgentIssue {
  type: IssueSeverity;
  message: string;
}

interface ToolPermissions {
  write?: boolean;
  edit?: boolean;
  bash?: boolean;
  read?: boolean;
  glob?: boolean;
  grep?: boolean;
  skill?: boolean;
  task?: boolean;
  lsp?: boolean;
  question?: boolean;
  webfetch?: boolean;
  websearch?: boolean;
  external_directory?: boolean;
  [key: string]: boolean | undefined;
}

interface SkillPermissions {
  [skillName: string]: string;
}

interface AgentConfig {
  description?: string;
  mode?: string;
  temperature?: number;
  reasoningEffort?: string;
  tools?: ToolPermissions;
  permission?: {
    task?: Record<string, string>;
    skill?: SkillPermissions;
  };
  agentVersion?: string;
  lastModified?: string;
  [key: string]: unknown;
}

interface AgentReadinessResult {
  agent: AgentName;
  configFile: string;
  exists: boolean;
  hasRequiredTools: boolean;
  hasRequiredSkills: boolean;
  issues: AgentIssue[];
  status: AgentStatus;
}

interface ToolRequirement {
  agent: AgentName;
  tool: string;
  expected: boolean;
}

interface SkillRequirement {
  agent: AgentName;
  skill: string;
  expectedAccess: string;
}

interface ReadinessReport {
  agentReadiness: AgentReadinessResult[];
  pipelineReady: boolean;
  blockingIssues: number;
  warnings: number;
}

// ---------------------------------------------------------------------------
// Pipeline Type → Agent Mapping
// ---------------------------------------------------------------------------

const PIPELINE_TYPE_MAP: Record<PipelineType, AgentName[]> = {
  'full':              ['finder', 'plandescriber', 'implementor', 'qa', 'verifier', 'documentor'],
  'quick':             ['implementor', 'qa'],
  'fixer-only':        ['fixer', 'qa', 'verifier'],
  'parallel-feature':  ['implementor', 'integrator', 'qa', 'verifier'],
  'tdd':               ['plandescriber', 'qa', 'implementor', 'verifier'],
  'security-fix':      ['implementor'],
  'ui-bug':            ['browser-tester', 'fixer', 'qa'],
};

// ---------------------------------------------------------------------------
// Required Tool Permissions per Agent
// ---------------------------------------------------------------------------

const TOOL_REQUIREMENTS: ToolRequirement[] = [
  // Agents that need to write code
  { agent: 'implementor',       tool: 'write', expected: true },
  { agent: 'fixer',             tool: 'write', expected: true },
  { agent: 'integrator',        tool: 'write', expected: true },
  { agent: 'plandescriber',     tool: 'write', expected: true },
  { agent: 'documentor',        tool: 'write', expected: true },
  { agent: 'browser-tester',    tool: 'write', expected: true },
  { agent: 'qa',                tool: 'write', expected: true },

  // Agents that need to run builds
  { agent: 'implementor',       tool: 'bash', expected: true },
  { agent: 'fixer',             tool: 'bash', expected: true },
  { agent: 'integrator',        tool: 'bash', expected: true },
  { agent: 'qa',                tool: 'bash', expected: true },
  { agent: 'plandescriber',     tool: 'bash', expected: true },
  { agent: 'documentor',        tool: 'bash', expected: true },
  { agent: 'verifier',          tool: 'bash', expected: true },
  { agent: 'browser-tester',    tool: 'bash', expected: true },

  // Agents that need to edit files
  { agent: 'implementor',       tool: 'edit', expected: true },
  { agent: 'fixer',             tool: 'edit', expected: true },
  { agent: 'integrator',        tool: 'edit', expected: true },
  { agent: 'qa',                tool: 'edit', expected: true },
  { agent: 'documentor',        tool: 'edit', expected: true },
  { agent: 'plandescriber',     tool: 'edit', expected: true },
  { agent: 'browser-tester',    tool: 'edit', expected: true },
];

// ---------------------------------------------------------------------------
// Required Skill Permissions per Agent
// ---------------------------------------------------------------------------

const SKILL_REQUIREMENTS: SkillRequirement[] = [
  // All agents need shared-agent-workflow
  { agent: 'finder',             skill: 'shared-agent-workflow', expectedAccess: 'allow' },
  { agent: 'plandescriber',      skill: 'shared-agent-workflow', expectedAccess: 'allow' },
  { agent: 'implementor',        skill: 'shared-agent-workflow', expectedAccess: 'allow' },
  { agent: 'fixer',              skill: 'shared-agent-workflow', expectedAccess: 'allow' },
  { agent: 'qa',                 skill: 'shared-agent-workflow', expectedAccess: 'allow' },
  { agent: 'verifier',           skill: 'shared-agent-workflow', expectedAccess: 'allow' },
  { agent: 'integrator',         skill: 'shared-agent-workflow', expectedAccess: 'allow' },
  { agent: 'browser-tester',     skill: 'shared-agent-workflow', expectedAccess: 'allow' },
  { agent: 'documentor',         skill: 'shared-agent-workflow', expectedAccess: 'allow' },
  { agent: 'debug',              skill: 'shared-agent-workflow', expectedAccess: 'allow' },

  // Implementor needs code-philosophy
  { agent: 'implementor',        skill: 'code-philosophy', expectedAccess: 'allow' },

  // Fixer needs code-philosophy, plan-verification, qa-workflow
  { agent: 'fixer',              skill: 'code-philosophy', expectedAccess: 'allow' },
  { agent: 'fixer',              skill: 'plan-verification', expectedAccess: 'allow' },
  { agent: 'fixer',              skill: 'qa-workflow',        expectedAccess: 'allow' },

  // QA needs qa-workflow
  { agent: 'qa',                 skill: 'qa-workflow',        expectedAccess: 'allow' },

  // Verifier needs plan-verification
  { agent: 'verifier',           skill: 'plan-verification', expectedAccess: 'allow' },

  // Finder needs code-philosophy
  { agent: 'finder',             skill: 'code-philosophy', expectedAccess: 'allow' },

  // PlanDescriber needs plan-describe
  { agent: 'plandescriber',      skill: 'plan-describe', expectedAccess: 'allow' },

  // Integrator needs integrator skill
  { agent: 'integrator',         skill: 'integrator', expectedAccess: 'allow' },

  // Documentor needs api-documentation
  { agent: 'documentor',         skill: 'api-documentation', expectedAccess: 'allow' },

  // Browser-tester needs playwright-cli
  { agent: 'browser-tester',     skill: 'playwright-cli', expectedAccess: 'allow' },
];

// ---------------------------------------------------------------------------
// CLI Argument Parsing
// ---------------------------------------------------------------------------

interface CLIOptions {
  agents: AgentName[] | null;
  pipelineType: PipelineType | null;
  file: string | null;
  format: 'yaml' | 'json';
  fix: boolean;
  apply: boolean;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    agents: null,
    pipelineType: null,
    file: null,
    format: 'yaml',
    fix: false,
    apply: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--agents=')) {
      const value = arg.slice('--agents='.length);
      options.agents = value.split(',').map(a => a.trim()).filter(Boolean) as AgentName[];
    } else if (arg.startsWith('--pipeline-type=')) {
      const value = arg.slice('--pipeline-type='.length) as PipelineType;
      if (!(value in PIPELINE_TYPE_MAP)) {
        console.error(`Unknown pipeline type: "${value}". Valid types: ${Object.keys(PIPELINE_TYPE_MAP).join(', ')}`);
        process.exit(2);
      }
      options.pipelineType = value;
      options.agents = PIPELINE_TYPE_MAP[value];
    } else if (arg.startsWith('--file=')) {
      options.file = arg.slice('--file='.length);
    } else if (arg.startsWith('--format=')) {
      const value = arg.slice('--format='.length);
      if (value !== 'json' && value !== 'yaml') {
        console.error(`Unknown format: "${value}". Valid formats: json, yaml`);
        process.exit(2);
      }
      options.format = value;
    } else if (arg === '--fix') {
      options.fix = true;
    } else if (arg === '--apply') {
      options.apply = true;
    } else {
      console.error(`Unknown argument: "${arg}"`);
      process.exit(2);
    }
  }

  // If --file is provided, read agents from agent-context.md pipelineType
  if (options.file && !options.agents) {
    const pipelineType = extractPipelineTypeFromFile(options.file);
    if (pipelineType) {
      options.pipelineType = pipelineType;
      options.agents = PIPELINE_TYPE_MAP[pipelineType];
    } else {
      console.error(`Could not determine pipeline type from ${options.file}`);
      process.exit(2);
    }
  }

  if (!options.agents || options.agents.length === 0) {
    console.error(
      'No agents specified. Use --agents=<agent1,agent2,...>, --pipeline-type=<type>, or --file=<agent-context.md>'
    );
    process.exit(2);
  }

  return options;
}

function extractPipelineTypeFromFile(filePath: string): PipelineType | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const match = content.match(/pipelineType:\s*["']?(\S+?)["']?[\s\n]/);
    if (match) {
      const type = match[1] as PipelineType;
      if (type in PIPELINE_TYPE_MAP) {
        return type;
      }
    }
    return null;
  } catch {
    console.error(`Cannot read file: ${filePath}`);
    process.exit(2);
    return null;
  }
}

// ---------------------------------------------------------------------------
// YAML Frontmatter Parsing (lightweight, no external deps)
// ---------------------------------------------------------------------------

function parseYamlFrontmatter(filePath: string): AgentConfig | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return parseYamlString(content);
  } catch {
    return null;
  }
}

function parseYamlString(content: string): AgentConfig | null {
  // Match YAML frontmatter between --- markers
  content = content.replace(/\r\n/g, '\n');
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return null;
  }

  const yamlBlock = match[1];
  return parseYamlBlock(yamlBlock);
}

function parseYamlBlock(yamlBlock: string): AgentConfig {
  const result: AgentConfig = {};
  const lines = yamlBlock.split('\n');
  // Stack tracks nested objects. Each entry: { obj, indent }
  // Root is at indent -1 — everything is a child of root.
  const stack: Array<{ obj: Record<string, unknown>; indent: number }> = [
    { obj: result, indent: -1 },
  ];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');

    // Skip empty lines and comments
    if (line.trim() === '' || line.trim().startsWith('#')) {
      continue;
    }

    const indent = line.search(/\S/);
    const trimmed = line.trim();

    // Pop stack when we return to a shallower or equal indent level.
    // The last entry that has indent < current indent is our parent.
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const currentObj = stack[stack.length - 1].obj;

    if (trimmed.endsWith(':')) {
      // New nested key (e.g., "tools:" or "permission:")
      const key = trimmed.slice(0, -1);
      const newObj: Record<string, unknown> = {};
      currentObj[key] = newObj;
      stack.push({ obj: newObj, indent });
    } else if (trimmed.startsWith('- ')) {
      // Array item
      const arrayItem = trimmed.slice(2);
      if (!Array.isArray(currentObj.items)) {
        currentObj.items = [];
      }
      (currentObj.items as string[]).push(arrayItem);
    } else {
      // Key: value pair — handles:
      //   simple: value
      //   "quoted-key": "quoted-value"
      //   key: "quoted value"
      //   "*": "deny"
      let key: string;
      let valueStr: string;

      // Find the colon separator — look for ':' followed by optional space
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue; // skip malformed lines

      const beforeColon = trimmed.slice(0, colonIdx);
      const afterColon = trimmed.slice(colonIdx + 1).trim();

      // Strip quotes from key
      key = beforeColon.trim();
      if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
        key = key.slice(1, -1);
      }

      valueStr = afterColon;

      // Strip trailing comma from value (YAML allows trailing commas in some contexts)
      if (valueStr.endsWith(',')) {
        valueStr = valueStr.slice(0, -1);
      }

      // Parse value
      let parsedValue: unknown = valueStr;

      // Strip quotes from value
      if (
        (valueStr.startsWith('"') && valueStr.endsWith('"')) ||
        (valueStr.startsWith("'") && valueStr.endsWith("'"))
      ) {
        parsedValue = valueStr.slice(1, -1);
      } else if (valueStr === 'true') {
        parsedValue = true;
      } else if (valueStr === 'false') {
        parsedValue = false;
      } else if (/^\d+(\.\d+)?$/.test(valueStr)) {
        parsedValue = valueStr.includes('.') ? parseFloat(valueStr) : parseInt(valueStr, 10);
      }

      currentObj[key] = parsedValue;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Extract tools and permissions from parsed config
// ---------------------------------------------------------------------------

function getTools(config: AgentConfig): ToolPermissions {
  if (config && typeof config.tools === 'object' && !Array.isArray(config.tools)) {
    // Normalize true/false strings
    const tools: ToolPermissions = {};
    for (const [key, value] of Object.entries(config.tools)) {
      if (typeof value === 'string') {
        tools[key] = value === 'true' ? true : value === 'false' ? false : undefined;
      } else if (typeof value === 'boolean') {
        tools[key] = value;
      } else {
        tools[key] = value as boolean | undefined;
      }
    }
    return tools;
  }
  return {};
}

function getSkillPermissions(config: AgentConfig): SkillPermissions {
  if (
    config &&
    typeof config.permission === 'object' &&
    config.permission &&
    typeof config.permission.skill === 'object' &&
    config.permission.skill &&
    !Array.isArray(config.permission.skill)
  ) {
    return config.permission.skill as SkillPermissions;
  }
  return {};
}

// ---------------------------------------------------------------------------
// Agent Check Logic
// ---------------------------------------------------------------------------

function checkAgent(
  agentName: AgentName,
  configDir: string,
  options: CLIOptions
): AgentReadinessResult {
  const configFile = path.join(configDir, `${agentName}.md`);
  const result: AgentReadinessResult = {
    agent: agentName,
    configFile: `agents/subagent/${agentName}.md`,
    exists: fs.existsSync(configFile),
    hasRequiredTools: true,
    hasRequiredSkills: true,
    issues: [],
    status: 'ready',
  };

  if (!result.exists) {
    result.issues.push({
      type: 'error',
      message: `Agent config file not found at agents/subagent/${agentName}.md`,
    });
    result.hasRequiredTools = false;
    result.hasRequiredSkills = false;
    result.status = 'not_ready';
    return result;
  }

  const config = parseYamlFrontmatter(configFile);
  if (!config) {
    result.issues.push({
      type: 'error',
      message: `Cannot parse YAML frontmatter in agents/subagent/${agentName}.md`,
    });
    result.status = 'not_ready';
    return result;
  }

  const tools = getTools(config);
  const skillPerms = getSkillPermissions(config);

  // ── Check tool permissions ──────────────────────────────────────
  // Normalize tools to their canonical boolean values
  const normalizedTools: ToolPermissions = {};
  for (const [key, value] of Object.entries(tools)) {
    if (typeof value === 'string') {
      normalizedTools[key] = value === 'true';
    } else {
      normalizedTools[key] = value === true;
    }
  }

  const requiredTools = TOOL_REQUIREMENTS.filter(r => r.agent === agentName);

  for (const req of requiredTools) {
    const actual = normalizedTools[req.tool];
    if (actual !== req.expected) {
      result.hasRequiredTools = false;
      const severity: IssueSeverity = req.tool === 'write' || req.tool === 'bash' ? 'error' : 'warning';
      result.issues.push({
        type: severity,
        message: `Missing ${req.tool}:${req.expected} permission (got ${actual === undefined ? 'undefined' : actual})`,
      });
    }
  }

  // ── Check skill permissions ─────────────────────────────────────
  const requiredSkills = SKILL_REQUIREMENTS.filter(r => r.agent === agentName);

  for (const req of requiredSkills) {
    const actual = skillPerms[req.skill];
    if (actual !== req.expectedAccess) {
      result.hasRequiredSkills = false;
      const severity: IssueSeverity = req.skill === 'shared-agent-workflow' ? 'error' : 'warning';
      result.issues.push({
        type: severity,
        message: `Missing skill "${req.skill}": "${req.expectedAccess}" (got "${actual || 'not found'}")`,
      });
    }
  }

  // ── Compute final status ────────────────────────────────────────
  const errors = result.issues.filter(i => i.type === 'error').length;
  const warnings = result.issues.filter(i => i.type === 'warning').length;

  if (errors > 0) {
    result.status = 'not_ready';
  } else if (warnings > 0) {
    result.status = 'has_warnings';
  } else {
    result.status = 'ready';
  }

  return result;
}

// ---------------------------------------------------------------------------
// --fix mode: attempt to add missing skill permissions
// ---------------------------------------------------------------------------

interface FixAction {
  agent: AgentName;
  configFile: string;
  skill: string;
  expectedAccess: string;
  changeType: 'add_skill';
}

function planFixes(
  agentResults: AgentReadinessResult[],
  configDir: string
): FixAction[] {
  const fixes: FixAction[] = [];

  for (const result of agentResults) {
    if (!result.exists) continue;

    const configFile = path.join(configDir, `${result.agent}.md`);
    const config = parseYamlFrontmatter(configFile);
    if (!config) continue;

    const skillPerms = getSkillPermissions(config);
    const requiredSkills = SKILL_REQUIREMENTS.filter(r => r.agent === result.agent);

    for (const req of requiredSkills) {
      const actual = skillPerms[req.skill];
      if (actual !== req.expectedAccess) {
        fixes.push({
          agent: result.agent,
          configFile: `agents/subagent/${result.agent}.md`,
          skill: req.skill,
          expectedAccess: req.expectedAccess,
          changeType: 'add_skill',
        });
      }
    }
  }

  return fixes;
}

function applyFixes(fixes: FixAction[]): void {
  for (const fix of fixes) {
    const absolutePath = path.resolve(process.cwd(), fix.configFile);
    let content: string;

    try {
      content = fs.readFileSync(absolutePath, 'utf-8');
    } catch {
      console.error(`  ✗ Cannot read ${fix.configFile} for fix application`);
      continue;
    }

    // Find the skill block in the YAML frontmatter and add the missing skill
    content = content.replace(/\r\n/g, '\n');
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      console.error(`  ✗ No frontmatter found in ${fix.configFile}`);
      continue;
    }

    const frontmatter = frontmatterMatch[1];

    // Locate the skill permission block. We find everything from `skill:` up to the
    // next top-level key (or end of frontmatter). Within that block, we find the last
    // `"key": "value"` line to append after it, or update existing if already present.
    const skillHeaderRegex = /^(\s+)skill:\s*$/m;
    const skillHeaderMatch = frontmatter.match(skillHeaderRegex);

    if (!skillHeaderMatch) {
      console.error(`  ✗ No skill permission block found in ${fix.configFile}`);
      continue;
    }

    const skillIndent = (skillHeaderMatch[1] || '  ') + '  ';
    const headerIndent = skillHeaderMatch[1] || '  ';

    // Find the range of the skill block: from `skill:` to the next top-level key or end
    const skillStart = skillHeaderMatch.index!;
    const restAfterSkill = frontmatter.slice(skillStart);

    // Find all lines in the skill block. Skill block lines look like: `      "skill-name": "allow"`
    const skillBlockLines: string[] = [];
    const lines = restAfterSkill.split('\n');
    for (const line of lines) {
      if (line.trim() === '') continue;
      if (line.startsWith(headerIndent) || line.startsWith(headerIndent + '  ')) {
        skillBlockLines.push(line);
      } else if (skillBlockLines.length > 0) {
        // We've left the skill block
        break;
      }
    }

    if (skillBlockLines.length === 0) {
      console.error(`  ✗ No skill entries found in ${fix.configFile}`);
      continue;
    }

    const newLine = `${skillIndent}"${fix.skill}": "${fix.expectedAccess}"`;

    // Check if the skill key already exists
    const existingSkillLine = skillBlockLines.find(l =>
      l.trim().startsWith(`"${fix.skill}"`)
    );

    if (existingSkillLine) {
      // Update existing entry
      const existingRegex = new RegExp(
        `("${fix.skill}":\\s*)"[^"]*"`,
        'm'
      );
      const updatedFrontmatter = frontmatter.replace(
        existingRegex,
        `$1"${fix.expectedAccess}"`
      );
      const newContent = content.replace(frontmatter, updatedFrontmatter);
      fs.writeFileSync(absolutePath, newContent, 'utf-8');
      console.log(`  ✓ Updated "${fix.skill}" permission in ${fix.configFile}`);
    } else {
      // Add new entry after the last skill block line
      const lastSkillLine = skillBlockLines[skillBlockLines.length - 1];
      const lastLineTrimmed = lastSkillLine.trimEnd();
      const updatedFrontmatter = frontmatter.replace(
        lastLineTrimmed,
        `${lastLineTrimmed}\n${newLine}`
      );
      const newContent = content.replace(frontmatter, updatedFrontmatter);
      fs.writeFileSync(absolutePath, newContent, 'utf-8');
      console.log(`  ✓ Added "${fix.skill}": "${fix.expectedAccess}" to ${fix.configFile}`);
    }
  }
}

// ---------------------------------------------------------------------------
// YAML Output
// ---------------------------------------------------------------------------

function generateYamlOutput(report: ReadinessReport, fixActions: FixAction[]): string {
  const lines: string[] = [];

  lines.push('agentReadiness:');

  for (const r of report.agentReadiness) {
    lines.push(`  - agent: "${r.agent}"`);
    lines.push(`    configFile: "${r.configFile}"`);
    lines.push(`    exists: ${r.exists}`);
    lines.push(`    hasRequiredTools: ${r.hasRequiredTools}`);
    lines.push(`    hasRequiredSkills: ${r.hasRequiredSkills}`);
    if (r.issues.length > 0) {
      lines.push('    issues:');
      for (const issue of r.issues) {
        lines.push(`      - type: "${issue.type}"`);
        lines.push(`        message: "${issue.message}"`);
      }
    } else {
      lines.push('    issues: []');
    }
    lines.push(`    status: "${r.status}"`);
  }

  lines.push(`pipelineReady: ${report.pipelineReady}`);
  lines.push(`blockingIssues: ${report.blockingIssues}`);
  lines.push(`warnings: ${report.warnings}`);

  if (fixActions.length > 0) {
    lines.push('fixActions:');
    for (const fix of fixActions) {
      lines.push(`  - agent: "${fix.agent}"`);
      lines.push(`    configFile: "${fix.configFile}"`);
      lines.push(`    skill: "${fix.skill}"`);
      lines.push(`    expectedAccess: "${fix.expectedAccess}"`);
      lines.push(`    changeType: "${fix.changeType}"`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const options = parseArgs();
  const configDir = path.resolve(process.cwd(), 'agents', 'subagent');

  // Check that the config directory exists
  if (!fs.existsSync(configDir)) {
    console.error(`Agent config directory not found: ${configDir}`);
    process.exit(2);
  }

  // Check each agent
  // agents is guaranteed non-null here — parseArgs exits with code 2 if no agents resolved
  const resolvedAgents = options.agents!;
  const agentResults: AgentReadinessResult[] = [];
  for (const agentName of resolvedAgents) {
    const result = checkAgent(agentName, configDir, options);
    agentResults.push(result);
  }

  // Compute aggregate report
  const errors = agentResults.reduce((sum, r) => sum + r.issues.filter(i => i.type === 'error').length, 0);
  const warnings = agentResults.reduce((sum, r) => sum + r.issues.filter(i => i.type === 'warning').length, 0);

  const report: ReadinessReport = {
    agentReadiness: agentResults,
    pipelineReady: errors === 0,
    blockingIssues: errors,
    warnings,
  };

  // Handle --fix mode
  if (options.fix) {
    const fixActions = planFixes(agentResults, configDir);

    if (fixActions.length === 0) {
      console.log('No fixes needed — all skill permissions are correct.');
    } else {
      console.log(`Planned fixes (${fixActions.length}):`);
      for (const fix of fixActions) {
        console.log(`  ${fix.changeType}: "${fix.skill}" → "${fix.expectedAccess}" in ${fix.configFile}`);
      }

      if (options.apply) {
        console.log('\nApplying fixes...');
        applyFixes(fixActions);
        console.log('\nDone.');
      } else {
        console.log('\nUse --apply to apply these changes.');
      }
    }
  }

  // Output the report
  if (options.format === 'json') {
    const fixActions = options.fix ? planFixes(agentResults, configDir) : [];
    const output = {
      ...report,
      fixActions: fixActions.length > 0 ? fixActions : undefined,
    };
    // Use JSON.stringify with indentation — no extra properties
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  } else {
    const fixActions = options.fix ? planFixes(agentResults, configDir) : [];
    process.stdout.write(generateYamlOutput(report, fixActions) + '\n');
  }

  // Exit code
  if (errors > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main();
