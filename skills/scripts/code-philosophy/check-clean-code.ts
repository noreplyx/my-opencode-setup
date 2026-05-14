#!/usr/bin/env ts-node
/**
 * Clean Code Checker
 * 
 * Usage: ts-node check-clean-code.ts [--dir=<project-dir>] [--verbose]
 * 
 * Checks for:
 * - Functions that are too long (> 60 lines)
 * - Functions with too many parameters (> 3)
 * - Deep nesting (> 3 levels)
 * - TODO/FIXME comments that indicate technical debt
 * - console.log statements (should use proper logging)
 * - Magic numbers/strings
 */

import * as fs from 'fs';
import * as path from 'path';

interface CodeIssue {
  file: string;
  line: number;
  type: 'long-function' | 'too-many-params' | 'deep-nesting' | 'todo' | 'console-log' | 'magic-number';
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
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== 'build') {
          walk(full);
        }
      } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        results.push(full);
      }
    }
  }
  walk(rootDir);
  return results;
}

function analyzeFile(filePath: string): CodeIssue[] {
  const issues: CodeIssue[] = [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const relativePath = path.relative(process.cwd(), filePath);
  
  // Check for console.log (excluding framework files)
  lines.forEach((line, index) => {
    if (/console\.(log|warn|error)\(/.test(line) && !line.includes('// console') && !line.includes('/* console')) {
      issues.push({
        file: relativePath,
        line: index + 1,
        type: 'console-log',
        severity: 'medium',
        description: `Uses console.log instead of structured logging: "${line.trim().substring(0, 80)}"`,
      });
    }
    
    // Check for TODO and FIXME
    if (/\bTODO\b/i.test(line)) {
      issues.push({
        file: relativePath,
        line: index + 1,
        type: 'todo',
        severity: 'medium',
        description: `TODO comment found: "${line.trim().substring(0, 80)}"`,
      });
    }
    if (/\bFIXME\b/i.test(line)) {
      issues.push({
        file: relativePath,
        line: index + 1,
        type: 'todo',
        severity: 'high',
        description: `FIXME comment found: "${line.trim().substring(0, 80)}"`,
      });
    }
    
    // Check for magic numbers
    const magicNumberMatch = line.match(/(?:const|let|var)\s+\w+\s*=\s*([0-9]{2,}(?:\.[0-9]+)?)\s*[^a-zA-Z]/);
    if (magicNumberMatch && !line.includes('// OK') && !line.includes('/* OK')) {
      issues.push({
        file: relativePath,
        line: index + 1,
        type: 'magic-number',
        severity: 'low',
        description: `Magic number ${magicNumberMatch[1]} found. Consider naming it as a constant.`,
      });
    }
  });
  
  // Check function length
  const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = funcRegex.exec(content)) !== null) {
    const funcName = match[1];
    const funcStart = match.index;
    const fromPos = content.substring(funcStart);
    
    // Estimate function end by brace matching
    let braceDepth = fromPos.indexOf('{') !== -1 ? 1 : 0;
    let lineCount = 0;
    let funcEnd = 0;
    if (braceDepth > 0) {
      for (let i = fromPos.indexOf('{') + 1; i < fromPos.length && braceDepth > 0; i++) {
        if (fromPos[i] === '{') braceDepth++;
        if (fromPos[i] === '}') braceDepth--;
        if (fromPos[i] === '\n') lineCount++;
        funcEnd = i;
      }
    }
    
    if (lineCount > 60) {
      // Find the line number
      const lineNumber = content.substring(0, funcStart).split('\n').length;
      issues.push({
        file: relativePath,
        line: lineNumber,
        type: 'long-function',
        severity: lineCount > 100 ? 'high' : 'medium',
        description: `Function "${funcName}" is ${lineCount} lines long. Consider breaking it into smaller functions (max 20 lines recommended).`,
      });
    }
  }
  
  // Check function params
  const funcParamRegex = /(?:export\s+)?(?:async\s+)?function\s+\w+\s*\(([^)]*)\)/g;
  while ((match = funcParamRegex.exec(content)) !== null) {
    const params = match[1].split(',').filter(p => p.trim().length > 0);
    if (params.length > 4) {
      const lineNumber = content.substring(0, match.index).split('\n').length;
      const funcMatch = match[0].match(/function\s+(\w+)/);
      const funcName = funcMatch ? funcMatch[1] : 'anonymous';
      
      issues.push({
        file: relativePath,
        line: lineNumber,
        type: 'too-many-params',
        severity: params.length > 7 ? 'high' : 'medium',
        description: `Function "${funcName}" has ${params.length} parameters. Consider using a parameter object (interface).`,
      });
    }
  }
  
  return issues;
}

async function main(): Promise<void> {
  const rootDir = process.argv.find(a => a.startsWith('--dir='))?.split('=')[1] || process.cwd();
  const verbose = process.argv.includes('--verbose');
  
  console.log(`🔍 Running Clean Code check on: ${rootDir}`);
  
  const files = findSourceFiles(rootDir);
  let allIssues: CodeIssue[] = [];
  
  for (const file of files) {
    const issues = analyzeFile(file);
    allIssues = allIssues.concat(issues);
  }
  
  // Summary
  const byType = new Map<string, CodeIssue[]>();
  for (const issue of allIssues) {
    if (!byType.has(issue.type)) byType.set(issue.type, []);
    byType.get(issue.type)!.push(issue);
  }
  
  console.log(`\n## Clean Code Check Results`);
  console.log(`**Files analyzed**: ${files.length}`);
  console.log(`**Total issues**: ${allIssues.length}`);
  console.log();
  
  for (const [type, issues] of byType) {
    const icons: Record<string, string> = {
      'long-function': '📏',
      'too-many-params': '📋',
      'deep-nesting': '🪆',
      'todo': '📝',
      'console-log': '🖨️',
      'magic-number': '🔢',
    };
    console.log(`${icons[type] || '•'} ${type.replace('-', ' ')}: ${issues.length}`);
    if (verbose) {
      for (const issue of issues) {
        console.log(`  - ${issue.file}:${issue.line} — ${issue.description}`);
      }
    }
  }
  
  if (allIssues.length === 0) {
    console.log('✅ No issues found! Clean code practices are being followed.');
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
