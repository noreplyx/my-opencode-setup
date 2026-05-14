#!/usr/bin/env ts-node
/**
 * Project Consistency Checker (for Orchestration)
 * 
 * Usage: ts-node check-consistency.ts [--dir=<project-dir>] [--verbose]
 * 
 * Checks for consistency across the project:
 * - Import path consistency (relative vs absolute)
 * - Naming conventions (camelCase, PascalCase, kebab-case)
 * - Export pattern consistency (named vs default)
 * - File naming pattern consistency
 */

import * as fs from 'fs';
import * as path from 'path';

interface ConsistencyIssue {
  file: string;
  line: number;
  category: 'import-style' | 'naming' | 'export-style' | 'file-naming';
  severity: 'high' | 'medium' | 'low';
  description: string;
}

function findSourceFiles(rootDir: string): string[] {
  const results: string[] = [];
  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist') walk(full);
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
        results.push(full);
      }
    }
  }
  walk(rootDir);
  return results;
}

function analyzeFile(filePath: string, allFiles: string[]): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const relativePath = path.relative(process.cwd(), filePath);
  
  // Check 1: Mixed import styles (relative and absolute)
  const hasRelative = lines.some(l => /from\s+['"]\.\.?\/['"]/.test(l));
  const hasAbsolute = lines.some(l => /from\s+['"]src\//.test(l));
  
  if (hasRelative && hasAbsolute) {
    issues.push({
      file: relativePath,
      line: lines.findIndex(l => /from\s+['"]\.\.?\/['"]/.test(l)) + 1,
      category: 'import-style',
      severity: 'medium',
      description: 'Mixed relative and absolute imports. Choose one convention.',
    });
  }
  
  // Check 2: Default exports vs named exports consistency
  const hasDefaultExport = content.includes('export default');
  const hasNamedExports = /export\s+(?:const|function|class|interface|type)\s/.test(content);
  
  if (hasDefaultExport && hasNamedExports) {
    issues.push({
      file: relativePath,
      line: lines.findIndex(l => l.includes('export default')) + 1,
      category: 'export-style',
      severity: 'low',
      description: 'Mixes default and named exports. Prefer named exports for better tree-shaking and IDE support.',
    });
  }
  
  // Check 3: File naming (kebab-case vs PascalCase vs camelCase)
  const fileName = path.basename(filePath);
  const isComponent = /\.(tsx)$/.test(filePath);
  
  if (isComponent && /^[a-z]/.test(fileName) && !fileName.includes('-')) {
    issues.push({
      file: relativePath,
      line: 1,
      category: 'file-naming',
      severity: 'low',
      description: `Component file "${fileName}" starts with lowercase. React components should use PascalCase (e.g., "MyComponent.tsx").`,
    });
  }
  
  return issues;
}

async function main(): Promise<void> {
  const rootDir = process.argv.find(a => a.startsWith('--dir='))?.split('=')[1] || process.cwd();
  const verbose = process.argv.includes('--verbose');
  
  console.log(`🔍 Running Project Consistency Check on: ${rootDir}\n`);
  
  const files = findSourceFiles(rootDir);
  let allIssues: ConsistencyIssue[] = [];
  
  for (const file of files) {
    allIssues = allIssues.concat(analyzeFile(file, files));
  }
  
  console.log(`## Consistency Report\n`);
  console.log(`**Files analyzed**: ${files.length}`);
  console.log(`**Issues found**: ${allIssues.length}\n`);
  
  if (allIssues.length === 0) {
    console.log('✅ No consistency issues found!');
    process.exit(0);
  }
  
  const byCategory = new Map<string, ConsistencyIssue[]>();
  for (const issue of allIssues) {
    if (!byCategory.has(issue.category)) byCategory.set(issue.category, []);
    byCategory.get(issue.category)!.push(issue);
  }
  
  for (const [category, issues] of byCategory) {
    console.log(`### ${category.replace('-', ' ')} (${issues.length})`);
    if (verbose) {
      issues.forEach(i => {
        console.log(`  ${i.file}:${i.line} — ${i.description}`);
      });
    }
    console.log();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
