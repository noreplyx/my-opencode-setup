#!/usr/bin/env ts-node
/**
 * Accessibility Checker (Static Analysis)
 * 
 * Usage: ts-node check-a11y.ts [--dir=<project-dir>] [--verbose]
 * 
 * Static analysis of React/HTML components for accessibility issues:
 * - Missing alt attributes on images
 * - Missing form labels
 * - Missing aria attributes on interactive elements
 * - Non-semantic HTML (div buttons)
 * - Missing lang attribute on HTML
 * - Color-only information patterns
 * - Focusable elements without visible focus indicators
 */

import * as fs from 'fs';
import * as path from 'path';

interface A11yIssue {
  file: string;
  line: number;
  wcag: string;
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
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist') walk(full);
      } else if (entry.isFile() && /\.(tsx|jsx|html|vue)$/.test(entry.name)) {
        results.push(full);
      }
    }
  }
  walk(rootDir);
  return results;
}

function analyzeFile(filePath: string): A11yIssue[] {
  const issues: A11yIssue[] = [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const relativePath = path.relative(process.cwd(), filePath);

  // Check 1: Missing alt attributes on img tags (WCAG 1.1.1)
  lines.forEach((line, index) => {
    const imgMatches = line.match(/<img\s[^>]*>/g);
    if (imgMatches) {
      for (const imgTag of imgMatches) {
        if (!/alt\s*=\s*["']/.test(imgTag) && !/aria-hidden\s*=\s*["']true["']/.test(imgTag)) {
          issues.push({
            file: relativePath,
            line: index + 1,
            wcag: 'WCAG 1.1.1',
            severity: 'critical',
            description: 'Image missing alt attribute',
            recommendation: 'Add alt="description" for informative images or alt="" (empty) for decorative images.',
          });
        }
      }
    }
  });

  // Check 2: Missing form input labels (WCAG 1.3.1, 4.1.2)
  lines.forEach((line, index) => {
    const inputMatches = line.match(/<(input|select|textarea)\s[^>]*>/g);
    if (inputMatches) {
      for (const inputTag of inputMatches) {
        const hasAriaLabel = /aria-label\s*=\s*["']/.test(inputTag);
        const hasAriaLabelledBy = /aria-labelledby\s*=/.test(inputTag);
        const typeHidden = /type\s*=\s*["']hidden["']/.test(inputTag);
        
        if (!typeHidden && !hasAriaLabel && !hasAriaLabelledBy) {
          // Check if there's a wrapping label or label htmlFor
          const prevLine = index > 0 ? lines[index - 1] : '';
          const nextLine = index < lines.length - 1 ? lines[index + 1] : '';
          const hasLabelNearby = /<label[\s>]/.test(prevLine) || /<label[\s>]/.test(nextLine) || /htmlFor\s*=\s*/.test(prevLine);
          
          if (!hasLabelNearby && !typeHidden) {
            issues.push({
              file: relativePath,
              line: index + 1,
              wcag: 'WCAG 1.3.1',
              severity: 'high',
              description: 'Form input without accessible label',
              recommendation: 'Add aria-label, aria-labelledby, or wrap with a <label> element.',
            });
          }
        }
      }
    }
  });

  // Check 3: Div/span used as buttons (WCAG 2.1.1, 4.1.2)
  lines.forEach((line, index) => {
    const divClickMatches = line.match(/<(div|span)\s[^>]*\bonclick\s*=/g);
    if (divClickMatches) {
      for (const match of divClickMatches) {
        if (!/role\s*=\s*["']button["']/.test(line) && !/tabIndex\s*=\s*0/.test(line) && !/tabindex\s*=\s*0/.test(line)) {
          issues.push({
            file: relativePath,
            line: index + 1,
            wcag: 'WCAG 4.1.2',
            severity: 'high',
            description: 'Non-interactive element (div/span) used with onclick handler',
            recommendation: 'Use a <button> element instead, or add role="button", tabIndex={0}, and keyboard event handlers.',
          });
        }
      }
    }
  });

  // Check 4: Missing lang attribute on HTML (WCAG 3.1.1)
  if (content.includes('<html') && !/lang\s*=\s*["'][a-zA-Z-]+["']/.test(content)) {
    const htmlLine = lines.findIndex(l => l.includes('<html'));
    issues.push({
      file: relativePath,
      line: htmlLine + 1,
      wcag: 'WCAG 3.1.1',
      severity: 'high',
      description: '<html> element missing lang attribute',
      recommendation: 'Add lang="en" (or appropriate language code) to the <html> element.',
    });
  }

  // Check 5: Color-only information (WCAG 1.4.1)
  lines.forEach((line, index) => {
    const colorPatterns = [
      /color\s*:\s*(red|green|blue|#f00|#ff0000|#00ff00|#0000ff|#0f0|#00f)/i,
      /className.*\b(error|success|warning|danger|info)\b/,
    ];
    
    for (const pattern of colorPatterns) {
      if (pattern.test(line) && !/icon|text|label|aria-label/.test(line)) {
        issues.push({
          file: relativePath,
          line: index + 1,
          wcag: 'WCAG 1.4.1',
          severity: 'medium',
          description: 'Color used as the only visual means of conveying information',
          recommendation: 'Add an icon, text label, or pattern supplement to the color indicator.',
        });
        break;
      }
    }
  });

  // Check 6: Missing focus outline (WCAG 2.4.7)
  lines.forEach((line, index) => {
    if (/outline\s*:\s*none/.test(line) || /outline\s*:\s*0/.test(line)) {
      const hasReplacement = /outline\s*:/.test(line) && !/(?:none|0)\s*!important/.test(line);
      if (!hasReplacement) {
        issues.push({
          file: relativePath,
          line: index + 1,
          wcag: 'WCAG 2.4.7',
          severity: 'high',
          description: 'Focus outline removed without providing a visible replacement',
          recommendation: 'Never use outline: none without providing a custom focus indicator. Add :focus-visible styles.',
        });
      }
    }
  });

  // Check 7: Missing aria-live for dynamic content (WCAG 4.1.3)
  if (content.includes('useEffect') || content.includes('setTimeout')) {
    const hasDynamicContent = /(toast|notification|alert|message|error|success)/i.test(content);
    const hasLiveRegion = /aria-live|role=["'](alert|status|log)["']/.test(content);
    
    if (hasDynamicContent && !hasLiveRegion) {
      const dynamicLine = lines.findIndex(l => /(toast|notification|alert)/i.test(l));
      issues.push({
        file: relativePath,
        line: dynamicLine + 1,
        wcag: 'WCAG 4.1.3',
        severity: 'medium',
        description: 'Dynamic content detected but no aria-live region found',
        recommendation: 'Add aria-live="polite" to containers that receive dynamic updates (toasts, notifications).',
      });
    }
  }

  return issues;
}

async function main(): Promise<void> {
  const rootDir = process.argv.find(a => a.startsWith('--dir='))?.split('=')[1] || process.cwd();
  const verbose = process.argv.includes('--verbose');
  
  console.log(`♿ Running Accessibility (a11y) Check on: ${rootDir}\n`);
  
  const files = findSourceFiles(rootDir);
  let allIssues: A11yIssue[] = [];
  
  for (const file of files) {
    allIssues = allIssues.concat(analyzeFile(file));
  }
  
  const critical = allIssues.filter(i => i.severity === 'critical').length;
  const high = allIssues.filter(i => i.severity === 'high').length;
  const medium = allIssues.filter(i => i.severity === 'medium').length;
  const low = allIssues.filter(i => i.severity === 'low').length;
  
  console.log(`## Accessibility (WCAG) Report\n`);
  console.log(`**Files analyzed**: ${files.length}`);
  console.log(`**Issues found**: ${allIssues.length}`);
  console.log(`  🔴 Critical: ${critical}`);
  console.log(`  🟡 High: ${high}`);
  console.log(`  🔵 Medium: ${medium}`);
  console.log(`  🟢 Low: ${low}\n`);
  
  // Group by WCAG criterion
  const byWCAG = new Map<string, A11yIssue[]>();
  for (const issue of allIssues) {
    if (!byWCAG.has(issue.wcag)) byWCAG.set(issue.wcag, []);
    byWCAG.get(issue.wcag)!.push(issue);
  }
  
  for (const [wcag, issues] of byWCAG) {
    console.log(`### ${wcag}: ${issues.length} issue(s)\n`);
    if (verbose) {
      issues.forEach(i => {
        const icon = i.severity === 'critical' ? '🔴' : i.severity === 'high' ? '🟡' : i.severity === 'medium' ? '🔵' : '🟢';
        console.log(`${icon} ${i.file}:${i.line} — ${i.description}`);
        console.log(`   💡 ${i.recommendation}\n`);
      });
    }
  }
  
  if (allIssues.length > 0 && !verbose) {
    console.log('Run with --verbose to see per-file details.');
  }
  
  if (allIssues.length === 0) {
    console.log('✅ No accessibility issues found!');
  }
  
  // Exit with error code if critical or high issues found (for CI)
  process.exit((critical + high) > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
