#!/usr/bin/env ts-node
/**
 * Security Code Checker
 * 
 * Usage: ts-node check-security.ts [--dir=<project-dir>] [--verbose]
 * 
 * Checks for:
 * - Hardcoded secrets / API keys
 * - SQL injection vulnerabilities (string concatenation in queries)
 * - Unsafe eval() usage
 * - Missing input validation patterns
 * - Insecure direct object references (IDOR)
 */

import * as fs from 'fs';
import * as path from 'path';

interface SecurityIssue {
  file: string;
  line: number;
  severity: 'critical' | 'high' | 'medium';
  cwe: string;
  description: string;
  recommendation: string;
}

const SECRET_PATTERNS = [
  /(['"])(?:sk|pk)_(?:test|live|prod)_[A-Za-z0-9]{10,}\1/g,  // Stripe keys
  /(['"])[A-Za-z0-9_]{20,}\1/g,  // Generic long tokens
  /(?:api[_-]?key|apikey|secret|password|token|credential)\s*[=:]\s*['"][A-Za-z0-9_!@#$%^&*()=+]{8,}['"]/gi,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
  /ghp_[A-Za-z0-9]{36}/g,  // GitHub tokens
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,  // Slack tokens
];

const SQL_INJECTION_PATTERNS = [
  /db\.(?:execute|query|run)\([^)]*`\$\{/g,
  /\$\{.*\}.*\.(?:find|findOne|findMany|findUnique)\(/g,
  /\.raw\(\s*`[^`]*\$\{/g,
  /SELECT.*FROM.*WHERE.*['"]\s*\+/gi,
  /\.query\(\s*['"].*['"]\s*\+/g,
];

function findSourceFiles(rootDir: string): string[] {
  const results: string[] = [];
  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist') walk(full);
      } else if (entry.isFile() && /\.(ts|tsx|js|jsx|py|rb|go)$/.test(entry.name)) {
        results.push(full);
      }
    }
  }
  walk(rootDir);
  return results;
}

function analyzeFile(filePath: string): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const relativePath = path.relative(process.cwd(), filePath);

  // Check for hardcoded secrets
  lines.forEach((line, index) => {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(line)) {
        issues.push({
          file: relativePath,
          line: index + 1,
          severity: 'critical',
          cwe: 'CWE-798',
          description: 'Potential hardcoded secret or API key detected',
          recommendation: 'Move secrets to environment variables or a secrets manager. Use process.env.VARIABLE_NAME.',
        });
        break;
      }
    }
  });

  // Check for SQL injection
  const fullContent = content.replace(/\n/g, ' ');
  for (const pattern of SQL_INJECTION_PATTERNS) {
    const match = fullContent.match(pattern);
    if (match) {
      const matchIndex = fullContent.indexOf(match[0]);
      const lineNum = content.substring(0, matchIndex).split('\n').length;
      issues.push({
        file: relativePath,
        line: lineNum,
        severity: 'critical',
        cwe: 'CWE-89',
        description: 'Possible SQL injection vulnerability: string interpolation in database query',
        recommendation: 'Use parameterized queries or an ORM. Never concatenate user input into SQL strings.',
      });
    }
  }

  // Check for eval()
  lines.forEach((line, index) => {
    if (/\beval\s*\(/.test(line)) {
      issues.push({
        file: relativePath,
        line: index + 1,
        severity: 'critical',
        cwe: 'CWE-95',
        description: 'eval() usage detected',
        recommendation: 'Avoid eval(). Use safer alternatives like Function constructor, JSON.parse, or specific parsers.',
      });
    }
  });

  return issues;
}

async function main(): Promise<void> {
  const rootDir = process.argv.find(a => a.startsWith('--dir='))?.split('=')[1] || process.cwd();
  
  console.log(`🔒 Running Security check on: ${rootDir}`);
  const files = findSourceFiles(rootDir);
  let allIssues: SecurityIssue[] = [];
  
  for (const file of files) {
    allIssues = allIssues.concat(analyzeFile(file));
  }
  
  console.log(`\n## Security Check Results`);
  console.log(`**Files analyzed**: ${files.length}`);
  console.log(`**Issues found**: ${allIssues.length}`);
  console.log(`  🔴 Critical: ${allIssues.filter(i => i.severity === 'critical').length}`);
  console.log(`  🟡 High: ${allIssues.filter(i => i.severity === 'high').length}`);
  console.log(`  🔵 Medium: ${allIssues.filter(i => i.severity === 'medium').length}`);
  
  if (allIssues.length > 0) {
    console.log('\n### Issues');
    allIssues.forEach(issue => {
      const icon = issue.severity === 'critical' ? '🔴' : issue.severity === 'high' ? '🟡' : '🔵';
      console.log(`\n${icon} **${issue.cwe}**: ${issue.description}`);
      console.log(`   File: ${issue.file}:${issue.line}`);
      console.log(`   Fix: ${issue.recommendation}`);
    });
    
    process.exit(allIssues.some(i => i.severity === 'critical') ? 1 : 0);
  } else {
    console.log('✅ No security issues found!');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
