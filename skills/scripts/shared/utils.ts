import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

/**
 * Read file contents as string
 */
export function readFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`Cannot read file: ${filePath} — ${(err as Error).message}`);
  }
}

/**
 * Write content to a file, creating directories if needed
 */
export function writeFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * Check if a file or directory exists
 */
export function exists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/**
 * List files matching a glob pattern (simple implementation)
 */
export function globFiles(pattern: string, rootDir: string): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(rootDir, fullPath);
      
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        if (pattern.endsWith('/*') || pattern.endsWith('/**')) {
          results.push(relativePath);
        } else if (pattern.includes('*')) {
          const ext = pattern.split('.').pop() || '';
          if (entry.name.endsWith(`.${ext}`)) {
            results.push(relativePath);
          }
        } else {
          results.push(relativePath);
        }
      }
    }
  }

  walk(rootDir);
  return results;
}

/**
 * Search for a pattern in files
 */
export function grepFiles(pattern: string, filePath: string): string[] {
  const content = readFile(filePath);
  const lines = content.split('\n');
  const results: string[] = [];
  
  const regex = new RegExp(pattern);
  lines.forEach((line, index) => {
    if (regex.test(line)) {
      results.push(`${index + 1}: ${line.trim()}`);
    }
  });
  
  return results;
}

/**
 * Generate a timestamp string
 */
export function timestamp(): string {
  return new Date().toISOString();
}

/**
 * Format check results as markdown report
 */
export function formatReport(report: CheckReport): string {
  let md = `## ${report.skillName} Check Report\n\n`;
  md += `**Date**: ${report.timestamp}\n`;
  md += `**Summary**: ${report.summary}\n\n`;
  md += `### Results: ${report.passed}/${report.totalChecks} passed\n\n`;
  md += `| # | Check | Status | Details |\n`;
  md += `|---|-------|--------|---------|\n`;
  
  report.results.forEach((r, i) => {
    const icon = r.passed ? '✅' : '❌';
    md += `| ${i + 1} | ${r.name} | ${icon} | ${r.details} |\n`;
  });
  
  md += '\n';
  return md;
}

/**
 * Ask user a yes/no question
 */
export async function askYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  return new Promise((resolve) => {
    rl.question(`${question} (y/n): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Get all files in a directory recursively
 */
export function listFilesRecursive(dir: string, ext?: string): string[] {
  const results: string[] = [];
  
  function walk(current: string): void {
    if (!fs.existsSync(current)) return;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        if (!ext || entry.name.endsWith(ext)) {
          results.push(fullPath);
        }
      }
    }
  }
  
  walk(dir);
  return results;
}

/**
 * Simple logging
 */
export function log(level: 'info' | 'warn' | 'error' | 'debug', message: string, context?: Record<string, unknown>): void {
  const prefix = level.toUpperCase().padEnd(5);
  const timestamp = new Date().toISOString();
  const meta = context ? ` ${JSON.stringify(context)}` : '';
  console.log(`[${timestamp}] ${prefix} ${message}${meta}`);
}
