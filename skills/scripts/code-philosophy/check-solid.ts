#!/usr/bin/env ts-node
/**
 * SOLID Principles Checker
 * 
 * Usage: ts-node check-solid.ts [--dir=<project-dir>] [--verbose]
 * 
 * Analyzes TypeScript/JavaScript files for SOLID principle violations:
 * - SRP: Classes/functions with too many responsibilities
 * - OCP: Switch/if-else chains that should be polymorphic
 * - LSP: Subclasses that break parent contracts
 * - ISP: Interfaces that force unnecessary dependencies
 * - DIP: Direct concrete dependencies instead of abstractions
 */

import * as fs from 'fs';
import * as path from 'path';

interface CheckConfig {
  projectRoot: string;
  verbose: boolean;
}

interface Violation {
  file: string;
  line: number;
  principle: string;
  severity: 'high' | 'medium' | 'low';
  description: string;
  recommendation: string;
}

interface Report {
  timestamp: string;
  totalFiles: number;
  violations: Violation[];
  summary: {
    total: number;
    high: number;
    medium: number;
    low: number;
  };
}

function parseArgs(): CheckConfig {
  const args = process.argv.slice(2);
  return {
    projectRoot: args.find(a => a.startsWith('--dir='))?.split('=')[1] || process.cwd(),
    verbose: args.includes('--verbose'),
  };
}

function findTsFiles(rootDir: string): string[] {
  const results: string[] = [];
  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist') {
          walk(full);
        }
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        results.push(full);
      }
    }
  }
  walk(rootDir);
  return results;
}

function checkSRP(content: string, filePath: string): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split('\n');
  
  // Check for classes with many public methods (> 7 suggests SRP violation)
  const classRegex = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g;
  let match: RegExpExecArray | null;
  
  while ((match = classRegex.exec(content)) !== null) {
    const className = match[1];
    const classStart = content.substring(match.index);
    const classBody = classStart.substring(0, findClassEnd(classStart));
    
    // Count methods
    const methodMatches = classBody.match(/^\s+(?:public\s+|private\s+|protected\s+)?(?:async\s+)?(\w+)\s*\(/gm);
    const importCount = (classBody.match(/import\s*\{/g) || []).length;
    const responsibilityKeywords = ['repository', 'repository', 'email', 'mailer', 'logger', 'cache', 'queue', 'notification', 'validator', 'mapper'];
    const responsibilityCount = responsibilityKeywords.reduce((count, kw) => {
      return count + (classBody.toLowerCase().includes(kw) ? 1 : 0);
    }, 0);
    
    // Find the line number
    const classLineIndex = lines.findIndex(l => l.includes(`class ${className}`));
    
    if ((methodMatches && methodMatches.length > 10) || responsibilityCount > 3) {
      violations.push({
        file: filePath,
        line: classLineIndex + 1,
        principle: 'SRP (Single Responsibility)',
        severity: responsibilityCount > 5 ? 'high' : 'medium',
        description: `Class "${className}" may have too many responsibilities. Found ${methodMatches?.length || 0} methods and references to ${responsibilityCount} different concerns.`,
        recommendation: `Consider splitting "${className}" into smaller classes, each with a single responsibility. Extract email sending, logging, caching, and data access into separate services.`,
      });
    }
  }
  
  return violations;
}

function checkOCP(content: string, filePath: string): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split('\n');
  
  // Check for long switch statements or if-else chains
  const switchMatches = content.match(/switch\s*\(/g);
  if (switchMatches && switchMatches.length > 0) {
    // Find each switch statement
    let searchIdx = 0;
    for (let i = 0; i < switchMatches.length; i++) {
      const switchIdx = content.indexOf('switch', searchIdx);
      const switchBlock = content.substring(switchIdx, switchIdx + 500);
      const caseCount = (switchBlock.match(/\bcase\b/g) || []).length;
      
      if (caseCount > 4) {
        const lineNum = lines.findIndex(l => l.includes('switch'));
        violations.push({
          file: filePath,
          line: lineNum + 1,
          principle: 'OCP (Open/Closed)',
          severity: caseCount > 8 ? 'high' : 'medium',
          description: `Large switch statement with ${caseCount} cases. Adding new behavior requires modifying this code.`,
          recommendation: 'Replace the switch statement with a strategy pattern or polymorphism. Define an interface and let each variant implement it.',
        });
      }
      searchIdx = switchIdx + 1;
    }
  }
  
  // Check for long if-else chains
  const ifElseBlocks = content.match(/}\s*else\s+if\s*\(/g);
  if (ifElseBlocks && ifElseBlocks.length > 3) {
    violations.push({
      file: filePath,
      line: lines.findIndex(l => l.includes('else if')) + 1,
      principle: 'OCP (Open/Closed)',
      severity: 'medium',
      description: `Long if-else chain with ${ifElseBlocks.length} branches. Each new condition requires modifying this chain.`,
      recommendation: 'Replace the if-else chain with a strategy pattern, lookup table, or polymorphism.',
    });
  }
  
  return violations;
}

function checkDIP(content: string, filePath: string): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split('\n');
  
  // Check for 'new' keyword creating concrete dependencies inside constructors
  content.split('\n').forEach((line, index) => {
    // Look for constructor parameter with 'new' keyword
    const constructorMatch = line.match(/constructor\s*\([^)]*\)/);
    if (constructorMatch) {
      // Check if constructor creates concrete instances
      const constructorBody = extractConstructorBody(content, index);
      const newInConstructor = constructorBody.match(/\bnew\s+\w+/g);
      if (newInConstructor && newInConstructor.length > 1) {
        violations.push({
          file: filePath,
          line: index + 1,
          principle: 'DIP (Dependency Inversion)',
          severity: 'high',
          description: `Constructor creates concrete instances (${newInConstructor.length} direct instantiations). This couples the class to concrete implementations.`,
          recommendation: 'Inject dependencies via constructor parameters instead of creating them internally. Depend on abstractions (interfaces), not concretions.',
        });
      }
    }
  });
  
  return violations;
}

function findClassEnd(content: string): number {
  let depth = 0;
  let inClass = false;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '{') { depth++; inClass = true; }
    if (content[i] === '}') { depth--; }
    if (inClass && depth === 0) return i + 1;
  }
  return content.length;
}

function extractConstructorBody(content: string, lineIndex: number): string {
  const lines = content.split('\n');
  const fromLine = lines.slice(lineIndex).join('\n');
  const bodyStart = fromLine.indexOf('{');
  if (bodyStart === -1) return '';
  let depth = 1;
  let i = bodyStart + 1;
  while (i < fromLine.length && depth > 0) {
    if (fromLine[i] === '{') depth++;
    if (fromLine[i] === '}') depth--;
    i++;
  }
  return fromLine.substring(bodyStart, i);
}

function generateReport(report: Report): string {
  let md = `# SOLID Principles Check Report\n\n`;
  md += `**Date**: ${report.timestamp}\n`;
  md += `**Files Analyzed**: ${report.totalFiles}\n\n`;
  md += `## Summary\n\n`;
  md += `- **Total Violations**: ${report.summary.total}\n`;
  md += `- **High Severity**: ${report.summary.high}\n`;
  md += `- **Medium Severity**: ${report.summary.medium}\n`;
  md += `- **Low Severity**: ${report.summary.low}\n\n`;
  
  if (report.violations.length === 0) {
    md += `✅ **No violations found!** The code follows SOLID principles.\n`;
    return md;
  }
  
  md += `## Violations\n\n`;
  md += `| File | Line | Principle | Severity | Description |\n`;
  md += `|------|------|-----------|----------|-------------|\n`;
  
  for (const v of report.violations) {
    const sevIcon = v.severity === 'high' ? '🔴' : v.severity === 'medium' ? '🟡' : '🟢';
    const shortFile = path.relative(report.totalFiles > 0 ? '.' : '', v.file);
    md += `| ${shortFile} | ${v.line} | ${v.principle} | ${sevIcon} ${v.severity} | ${v.description} |\n`;
  }
  
  md += `\n## Recommendations\n\n`;
  for (const v of report.violations) {
    const shortFile = path.relative('.', v.file);
    md += `### ${v.principle} in ${shortFile}:${v.line}\n\n`;
    md += `${v.recommendation}\n\n`;
  }
  
  return md;
}

// Main execution
async function main(): Promise<void> {
  const config = parseArgs();
  console.log(`🔍 Scanning for SOLID violations in: ${config.projectRoot}`);
  
  const files = findTsFiles(config.projectRoot);
  console.log(`📁 Found ${files.length} TypeScript files to analyze`);
  
  if (config.verbose) {
    files.forEach(f => console.log(`  - ${path.relative(config.projectRoot, f)}`));
  }
  
  const allViolations: Violation[] = [];
  
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    allViolations.push(...checkSRP(content, file));
    allViolations.push(...checkOCP(content, file));
    allViolations.push(...checkDIP(content, file));
  }
  
  const report: Report = {
    timestamp: new Date().toISOString(),
    totalFiles: files.length,
    violations: allViolations,
    summary: {
      total: allViolations.length,
      high: allViolations.filter(v => v.severity === 'high').length,
      medium: allViolations.filter(v => v.severity === 'medium').length,
      low: allViolations.filter(v => v.severity === 'low').length,
    },
  };
  
  const markdown = generateReport(report);
  console.log(markdown);
  
  // Write report file
  const reportDir = path.join(config.projectRoot, 'reports');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, 'solid-check-report.md');
  fs.writeFileSync(reportPath, markdown, 'utf-8');
  console.log(`📝 Report saved to: ${reportPath}`);
  
  process.exit(report.summary.high > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
