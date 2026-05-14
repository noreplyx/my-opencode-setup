#!/usr/bin/env ts-node
/**
 * Backend Code Philosophy Checker
 * 
 * Usage: ts-node check-backend.ts [--dir=<project-dir>] [--verbose]
 * 
 * Checks for backend-specific concerns:
 * - Statelessness violations (in-memory state that should be external)
 * - Missing health check endpoints
 * - Missing error handling middleware
 * - Missing structured logging
 * - N+1 query patterns
 * - Missing input validation
 * - Missing graceful shutdown
 */

import * as fs from 'fs';
import * as path from 'path';

interface BackendIssue {
  file: string;
  line: number;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  recommendation: string;
}

function findSourceFiles(rootDir: string): string[] {
  const results: string[] = [];
  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== 'build') walk(full);
      } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        results.push(full);
      }
    }
  }
  walk(rootDir);
  return results;
}

function analyzeFile(filePath: string, allFiles: string[]): BackendIssue[] {
  const issues: BackendIssue[] = [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const relativePath = path.relative(process.cwd(), filePath);
  
  // Check 1: In-memory state that should use external store (Redis/DB)
  lines.forEach((line, index) => {
    const statePatterns = [
      /(?:const|let|var)\s+(?:\w+Store|sessionStore|cache|inMemory)\s*=\s*new\s+Map/,
      /(?:const|let|var)\s+(?:\w+Store|sessionStore|cache|inMemory)\s*=\s*\{\}/,
      /(?:const|let|var)\s+\w+Store\s*=\s*new\s+Array/,
    ];
    
    for (const pattern of statePatterns) {
      if (pattern.test(line)) {
        issues.push({
          file: relativePath,
          line: index + 1,
          category: 'Statefulness',
          severity: 'high',
          description: `In-memory state detected. This breaks horizontal scaling.`,
          recommendation: 'Use external stores (Redis for cache/sessions, database for persistent data) instead of in-process memory.',
        });
        break;
      }
    }
  });
  
  // Check 2: Missing structured logging (console.log vs logger)
  if (content.includes('console.log') && !content.includes('logger.')) {
    const logLines = lines.filter(l => /console\.(log|error)\(/.test(l));
    if (logLines.length > 3) {
      issues.push({
        file: relativePath,
        line: lines.findIndex(l => /console\.(log|error)\(/.test(l)) + 1,
        category: 'Observability',
        severity: 'medium',
        description: `Uses console.log/error instead of a structured logger (${logLines.length} occurrences).`,
        recommendation: 'Replace console.log with a structured logger like pino, winston, or the project\'s built-in logger.',
      });
    }
  }
  
  // Check 3: Missing health check endpoint
  if (content.includes('app.listen') || content.includes('server.listen')) {
    if (!content.includes('/health') && !content.includes('health')) {
      issues.push({
        file: relativePath,
        line: lines.findIndex(l => l.includes('listen')) + 1,
        category: 'Observability',
        severity: 'medium',
        description: 'Server entry point found but no health check endpoint detected.',
        recommendation: 'Add a GET /health endpoint for liveness probes and GET /health/ready for readiness probes.',
      });
    }
  }
  
  // Check 4: Missing global error handler middleware in Express/Fastify
  if (content.includes('express') || content.includes('Fastify')) {
    const hasErrorHandler = content.includes('errorHandler') || content.includes('error handler') || 
                           content.includes('app.use((err') || content.includes('.setErrorHandler');
    if (!hasErrorHandler && content.includes('app.')) {
      issues.push({
        file: relativePath,
        line: 1,
        category: 'Error Handling',
        severity: 'high',
        description: 'Express/Fastify app detected without global error handler middleware.',
        recommendation: 'Add a global error handler middleware that catches all errors, logs them with context, and returns structured error responses.',
      });
    }
  }
  
  // Check 5: N+1 query pattern (in loops)
  const queryMethods = ['.findUnique', '.findMany', '.findFirst', '.find', '.query(', '.execute('];
  lines.forEach((line, index) => {
    const isLoop = /for\s*\(|\.forEach\(|\.map\(/.test(line);
    const nextLines = lines.slice(index, Math.min(index + 3, lines.length)).join(' ');
    const hasQuery = queryMethods.some(q => nextLines.includes(q));
    
    if (isLoop && hasQuery) {
      issues.push({
        file: relativePath,
        line: index + 1,
        category: 'Performance',
        severity: 'high',
        description: 'Potential N+1 query pattern: database query inside a loop.',
        recommendation: 'Batch queries outside the loop. Use eager loading (include/join) or DataLoader pattern instead.',
      });
    }
  });
  
  // Check 6: Missing input validation
  if ((content.includes('app.post') || content.includes('router.post') || content.includes('app.put') || content.includes('router.put')) && 
      !content.includes('zod') && !content.includes('Joi') && !content.includes('class-validator') && 
      !content.includes('validate') && !content.includes('ValidationPipe') && !content.includes('safeParse')) {
    issues.push({
      file: relativePath,
      line: 1,
      category: 'Security',
      severity: 'high',
      description: 'POST/PUT route handlers found but no input validation library detected.',
      recommendation: 'Use zod, Joi, or class-validator to validate and sanitize all inputs at the API boundary.',
    });
  }
  
  // Check 7: Missing graceful shutdown
  if (content.includes('process.on') && !content.includes('SIGTERM') && !content.includes('SIGINT')) {
    issues.push({
      file: relativePath,
      line: 1,
      category: 'Reliability',
      severity: 'medium',
      description: 'Process signal handlers found but no SIGTERM/SIGINT handling.',
      recommendation: 'Add graceful shutdown handling for SIGTERM/SIGINT to drain connections and close resources.',
    });
  }
  
  return issues;
}

async function main(): Promise<void> {
  const rootDir = process.argv.find(a => a.startsWith('--dir='))?.split('=')[1] || process.cwd();
  const verbose = process.argv.includes('--verbose');
  
  console.log(`🔧 Running Backend Code Philosophy check on: ${rootDir}`);
  const files = findSourceFiles(rootDir);
  let allIssues: BackendIssue[] = [];
  
  for (const file of files) {
    allIssues = allIssues.concat(analyzeFile(file, files));
  }
  
  // Group by category
  const byCategory = new Map<string, BackendIssue[]>();
  for (const issue of allIssues) {
    if (!byCategory.has(issue.category)) byCategory.set(issue.category, []);
    byCategory.get(issue.category)!.push(issue);
  }
  
  console.log(`\n## Backend Code Check Results`);
  console.log(`**Files analyzed**: ${files.length}`);
  console.log(`**Total issues**: ${allIssues.length}`);
  console.log(`  🔴 Critical: ${allIssues.filter(i => i.severity === 'critical').length}`);
  console.log(`  🟡 High: ${allIssues.filter(i => i.severity === 'high').length}`);
  console.log(`  🔵 Medium: ${allIssues.filter(i => i.severity === 'medium').length}`);
  console.log();
  
  for (const [category, issues] of byCategory) {
    const icons: Record<string, string> = {
      'Statefulness': '💾',
      'Observability': '📊',
      'Error Handling': '🛡️',
      'Performance': '⚡',
      'Security': '🔒',
      'Reliability': '🔄',
    };
    console.log(`${icons[category] || '•'} **${category}**: ${issues.length} issues`);
    if (verbose) {
      issues.forEach(i => {
        const sevIcon = i.severity === 'critical' ? '🔴' : i.severity === 'high' ? '🟡' : i.severity === 'medium' ? '🔵' : '⚪';
        console.log(`  ${sevIcon} ${i.file}:${i.line} — ${i.description}`);
      });
    }
  }
  
  if (allIssues.length === 0) {
    console.log('✅ No backend code issues found!');
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
