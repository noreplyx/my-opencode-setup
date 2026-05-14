#!/usr/bin/env ts-node
/**
 * Skill Scaffold Generator
 * 
 * Usage: ts-node scaffold-skill.ts --name=<skill-name> --description="<skill-description>" [--dir=<output-dir>]
 * 
 * Generates a new skill directory with:
 * - SKILL.md with proper frontmatter
 * - scripts/ directory for TS tools
 * - references/ directory for docs
 * - assets/ directory for templates
 * - Package configuration
 */

import * as fs from 'fs';
import * as path from 'path';

interface SkillConfig {
  name: string;
  description: string;
  outputDir: string;
  withScripts: boolean;
  withTests: boolean;
}

const SKILL_TEMPLATE = `---
name: SKILL_NAME_PLACEHOLDER
description: SKILL_DESC_PLACEHOLDER
---

# SKILL_NAME_PLACEHOLDER Skill

## Overview

TODO: Add a brief overview of what this skill does.

## Core Principles

TODO: List the core principles and guidelines.

### Principle 1

Description of the first principle with examples.

### Principle 2

Description of the second principle with examples.

## Available Tools

This skill provides the following executable scripts to help implement its guidelines:

| Script | Purpose | Usage |
|--------|---------|-------|
| \`scripts/check-example.ts\` | Checks for X, Y, Z violations | \`ts-node scripts/check-example.ts --dir=<project-dir>\` |

## Workflow

When applying this skill:

1. **Analyze** — Read the code and identify which principles are violated
2. **Identify** — Point out specific violations with precision
3. **Propose** — Suggest fixes following the patterns in this skill
4. **Verify** — Use the provided scripts to validate the implementation

\`\`\`bash
# Example: Run the compliance check
ts-node scripts/check-example.ts --dir=./
\`\`\`

## Testing Guidelines

TODO: Describe how to test implementations that follow this skill.
`;

const CHECK_SCRIPT_TEMPLATE = `#!/usr/bin/env ts-node
/**
 * CHECK_NAME_PLACEHOLDER Checker
 * 
 * Usage: ts-node scripts/check-NAME_PLACEHOLDER.ts --dir=<project-dir> [--verbose]
 * 
 * TODO: Describe what this script checks for.
 */

import * as fs from 'fs';
import * as path from 'path';

interface CheckItem {
  name: string;
  category: string;
  status: 'pass' | 'fail' | 'warn';
  details: string;
  recommendation?: string;
}

async function main(): Promise<void> {
  const rootDir = process.argv.find(a => a.startsWith('--dir='))?.split('=')[1] || process.cwd();
  const verbose = process.argv.includes('--verbose');
  
  console.log(\`🔍 Running CHECK_NAME_PLACEHOLDER check on: \${rootDir}\n\`);

  // TODO: Implement your checks here
  const results: CheckItem[] = [];
  
  // Example check
  results.push({
    name: 'Example Check',
    category: 'example',
    status: 'warn',
    details: 'This is a placeholder check. Implement your validation logic here.',
    recommendation: 'Add actual check logic in the scripts directory.',
  });

  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const warnings = results.filter(r => r.status === 'warn').length;

  console.log(\`## Check Results\n\`);
  console.log(\`**\${passed}** passed | **\${failed}** failed | **\${warnings}** warnings\n\`);

  for (const result of results) {
    const icon = result.status === 'pass' ? '✅' : result.status === 'fail' ? '❌' : '⚠️';
    console.log(\`\${icon} **\${result.name}**: \${result.details}\`);
    if (result.status !== 'pass' && result.recommendation && verbose) {
      console.log(\`   💡 \${result.recommendation}\`);
    }
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
`;

function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

function scaffold(config: SkillConfig): void {
  const { name, description, outputDir } = config;
  const kebabName = toKebabCase(name);
  const skillDir = path.join(outputDir, kebabName);
  
  console.log(`🏗️  Scaffolding skill: ${name}`);
  console.log(`   Directory: ${skillDir}\n`);

  // Create directory structure
  const dirs = [
    skillDir,
    path.join(skillDir, 'scripts'),
    path.join(skillDir, 'references'),
    path.join(skillDir, 'assets'),
  ];
  
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`  📁 Created: ${path.relative(outputDir, dir)}`);
  }

  // Create SKILL.md
  const skillContent = SKILL_TEMPLATE
    .replace(/SKILL_NAME_PLACEHOLDER/g, name)
    .replace(/SKILL_DESC_PLACEHOLDER/g, description);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent, 'utf-8');
  console.log('  📝 Created: SKILL.md');

  // Create placeholder check script
  const checkName = toKebabCase(name);
  const checkScript = CHECK_SCRIPT_TEMPLATE
    .replace(/CHECK_NAME_PLACEHOLDER/g, name)
    .replace(/NAME_PLACEHOLDER/g, checkName);
  fs.writeFileSync(path.join(skillDir, 'scripts', `check-${checkName}.ts`), checkScript, 'utf-8');
  console.log(`  📝 Created: scripts/check-${checkName}.ts`);

  // Create .gitkeep files
  fs.writeFileSync(path.join(skillDir, 'references', '.gitkeep'), '', 'utf-8');
  fs.writeFileSync(path.join(skillDir, 'assets', '.gitkeep'), '', 'utf-8');
  console.log('  📝 Created: .gitkeep files in references/ and assets/');

  console.log(`\n✅ Skill "${name}" scaffolded successfully!`);
  console.log(`\nStructure:`);
  console.log(`  ${kebabName}/`);
  console.log(`  ├── SKILL.md`);
  console.log(`  ├── scripts/`);
  console.log(`  │   └── check-${checkName}.ts`);
  console.log(`  ├── references/`);
  console.log(`  └── assets/`);
}

// Parse arguments
const name = process.argv.find(a => a.startsWith('--name='))?.split('=')[1];
const description = process.argv.find(a => a.startsWith('--description='))?.split('=')[1];
const outputDir = process.argv.find(a => a.startsWith('--dir='))?.split('=')[1] || process.cwd();

if (!name || !description) {
  console.error('❌ Usage: ts-node scaffold-skill.ts --name=<skill-name> --description="<skill-description>" [--dir=<output-dir>]');
  process.exit(1);
}

scaffold({ name, description, outputDir, withScripts: true, withTests: false });
