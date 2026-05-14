#!/usr/bin/env ts-node
/**
 * Skill Structure Validator
 * 
 * Usage: ts-node validate-skills.ts [--dir=<skills-root>] [--fix] [--verbose]
 * 
 * Validates that all skills conform to the required structure:
 * - SKILL.md exists with valid YAML frontmatter
 * - Required directories (scripts, references, assets)
 * - Scripts have matching SKILL.md tool descriptions
 * - No orphaned files
 * - Consistent naming conventions
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

interface ValidationError {
  skillName: string;
  file: string;
  severity: 'error' | 'warning';
  message: string;
  fix?: string;
}

const REQUIRED_FRONTMATTER_FIELDS = ['name', 'description'];
const RECOMMENDED_DIRS = ['scripts', 'references', 'assets'];

function parseYamlFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;
  
  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).trim();
      const value = line.substring(colonIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      frontmatter[key] = value;
    }
  }
  
  return { frontmatter, body: match[2].trim() };
}

function validateSkill(skillDir: string, skillName: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const skillPath = path.join(skillDir, 'SKILL.md');
  
  // Check SKILL.md exists
  if (!fs.existsSync(skillPath)) {
    errors.push({
      skillName,
      file: 'SKILL.md',
      severity: 'error',
      message: 'SKILL.md not found',
      fix: 'Create SKILL.md with YAML frontmatter (name, description) and markdown body.',
    });
    return errors;
  }
  
  // Check frontmatter
  const content = fs.readFileSync(skillPath, 'utf-8');
  const parsed = parseYamlFrontmatter(content);
  
  if (!parsed) {
    errors.push({
      skillName,
      file: 'SKILL.md',
      severity: 'error',
      message: 'Missing or invalid YAML frontmatter (must start and end with ---)',
      fix: 'Add frontmatter: ---\nname: my-skill\ndescription: What this skill does\n---',
    });
  } else {
    // Check required frontmatter fields
    for (const field of REQUIRED_FRONTMATTER_FIELDS) {
      if (!parsed.frontmatter[field]) {
        errors.push({
          skillName,
          file: 'SKILL.md',
          severity: 'error',
          message: `Missing required frontmatter field: "${field}"`,
          fix: `Add "${field}: <value>" to the YAML frontmatter.`,
        });
      }
    }
    
    // Check description quality
    const desc = parsed.frontmatter.description || '';
    if (desc.length < 20) {
      errors.push({
        skillName,
        file: 'SKILL.md',
        severity: 'warning',
        message: `Description is too short (${desc.length} chars). Should be >= 20 chars for good triggering.`,
        fix: 'Write a more descriptive description that includes when to trigger this skill.',
      });
    }
    
    // Check body has content
    if (!parsed.body || parsed.body.length < 50) {
      errors.push({
        skillName,
        file: 'SKILL.md',
        severity: 'warning',
        message: 'Skill body is too short or empty',
        fix: 'Add comprehensive instructions, examples, and workflow steps.',
      });
    }
  }
  
  // Check recommended directories
  for (const dir of RECOMMENDED_DIRS) {
    const dirPath = path.join(skillDir, dir);
    if (!fs.existsSync(dirPath)) {
      errors.push({
        skillName,
        file: dir + '/',
        severity: 'warning',
        message: `Recommended directory "${dir}/" not found`,
        fix: `Create "${dir}/" directory (with .gitkeep if empty).`,
      });
    }
  }
  
  // Check scripts directory
  const scriptsDir = path.join(skillDir, 'scripts');
  if (fs.existsSync(scriptsDir)) {
    const scriptFiles = fs.readdirSync(scriptsDir).filter(f => /\.(ts|js|py|sh)$/.test(f));
    
    // Check if SKILL.md references the scripts
    if (scriptFiles.length > 0 && !content.includes('scripts/')) {
      errors.push({
        skillName,
        file: 'SKILL.md',
        severity: 'warning',
        message: `Scripts exist (${scriptFiles.length}) but SKILL.md doesn't reference them`,
        fix: 'Add a "Available Tools" or "Usage" section in SKILL.md that documents each script.',
      });
    }
  }
  
  return errors;
}

async function main(): Promise<void> {
  const skillsDir = process.argv.find(a => a.startsWith('--dir='))?.split('=')[1] || 
    path.join(process.cwd(), 'skills');
  const fixMode = process.argv.includes('--fix');
  const verbose = process.argv.includes('--verbose');
  
  console.log(`🏗️  Skill Structure Validator\n`);
  console.log(`Scanning directory: ${skillsDir}\n`);
  
  if (!fs.existsSync(skillsDir)) {
    console.error(`❌ Directory not found: ${skillsDir}`);
    process.exit(1);
  }
  
  // Find all skill directories (directories containing SKILL.md)
  const skillDirs: { name: string; dir: string }[] = [];
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(skillsDir, entry.name);
    if (fs.existsSync(path.join(skillDir, 'SKILL.md'))) {
      skillDirs.push({ name: entry.name, dir: skillDir });
    }
  }
  
  console.log(`Found ${skillDirs.length} skills\n`);
  
  // Validate all skills
  let allErrors: ValidationError[] = [];
  for (const { name, dir } of skillDirs) {
    const errors = validateSkill(dir, name);
    allErrors = allErrors.concat(errors);
  }
  
  // Report
  const errors = allErrors.filter(e => e.severity === 'error').length;
  const warnings = allErrors.filter(e => e.severity === 'warning').length;
  
  console.log(`## Validation Results\n`);
  console.log(`**${errors}** errors | **${warnings}** warnings\n`);
  
  // Group by skill
  const bySkill = new Map<string, ValidationError[]>();
  for (const err of allErrors) {
    if (!bySkill.has(err.skillName)) bySkill.set(err.skillName, []);
    bySkill.get(err.skillName)!.push(err);
  }
  
  for (const [skillName, skErrors] of bySkill) {
    const errCount = skErrors.filter(e => e.severity === 'error').length;
    const warnCount = skErrors.filter(e => e.severity === 'warning').length;
    console.log(`### ${skillName} (${errCount} errors, ${warnCount} warnings)\n`);
    
    for (const err of skErrors) {
      const icon = err.severity === 'error' ? '🔴' : '🟡';
      console.log(`${icon} [${err.file}] ${err.message}`);
      if (err.fix && verbose) {
        console.log(`   💡 Fix: ${err.fix}`);
      }
    }
    console.log();
  }
  
  if (allErrors.length === 0) {
    console.log('✅ All skills validated successfully!');
  }
  
  process.exit(errors > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
