#!/usr/bin/env ts-node
/**
 * Frontend Code Philosophy Checker
 * 
 * Usage: ts-node check-frontend.ts [--dir=<project-dir>] [--verbose]
 * 
 * Checks for frontend-specific concerns:
 * - Business logic in render methods (React components)
 * - Missing accessibility attributes
 * - Inline styles instead of CSS modules/styled-components
 * - Missing error boundaries
 * - Dangerous innerHTML usage
 * - Missing loading/error states
 * - Large component files (should be split)
 */

import * as fs from 'fs';
import * as path from 'path';

interface FrontendIssue {
  file: string;
  line: number;
  category: string;
  severity: 'high' | 'medium' | 'low';
  description: string;
  recommendation: string;
}

function findComponentFiles(rootDir: string): string[] {
  const results: string[] = [];
  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist') walk(full);
      } else if (entry.isFile() && /\.(tsx|jsx)$/.test(entry.name)) {
        results.push(full);
      }
    }
  }
  walk(rootDir);
  return results;
}

function analyzeComponent(filePath: string): FrontendIssue[] {
  const issues: FrontendIssue[] = [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const relativePath = path.relative(process.cwd(), filePath);
  
  // Check 1: dangerouslySetInnerHTML
  lines.forEach((line, index) => {
    if (/dangerouslySetInnerHTML/.test(line)) {
      const hasSanitization = content.includes('DOMPurify') || content.includes('sanitize') || content.includes('xss');
      issues.push({
        file: relativePath,
        line: index + 1,
        category: 'Security',
        severity: hasSanitization ? 'medium' : 'high',
        description: 'dangerouslySetInnerHTML used' + (hasSanitization ? ' (with sanitization)' : ' without sanitization'),
        recommendation: hasSanitization 
          ? 'Consider if rendering HTML is necessary. Prefer text rendering to avoid XSS risks entirely.'
          : 'Sanitize HTML with DOMPurify before using dangerouslySetInnerHTML, or prefer text rendering.',
      });
    }
  });
  
  // Check 2: Business logic in render (data transformation in component body)
  const hasUseEffect = content.includes('useEffect') || content.includes('useMemo') || content.includes('useCallback');
  const hasInlineTransform = /\.(map|filter|reduce|sort)\(/.test(content) && 
    !content.includes('useMemo') && !content.includes('useCallback');
  
  if (hasInlineTransform && !hasUseEffect && content.includes('function') && content.includes('return (')) {
    const transformLines = lines.filter(l => /\.(map|filter|reduce)\(/.test(l) && !l.includes('useMemo'));
    if (transformLines.length > 2) {
      const firstLine = lines.findIndex(l => /\.(map|filter|reduce)\(/.test(l) && !l.includes('useMemo'));
      issues.push({
        file: relativePath,
        line: firstLine + 1,
        category: 'Rendering Purity',
        severity: 'medium',
        description: `Data transformation detected directly in component body (${transformLines.length} occurrences). Business logic should not be in render.`,
        recommendation: 'Extract data transformations into custom hooks, selectors, or memoized values using useMemo.',
      });
    }
  }
  
  // Check 3: Missing aria attributes on interactive elements
  const buttonCount = (content.match(/<button/g) || []).length;
  const ariaLabelCount = (content.match(/aria-label/g) || []).length;
  if (buttonCount > ariaLabelCount + 1 && buttonCount > 2) {
    issues.push({
      file: relativePath,
      line: 1,
      category: 'Accessibility',
      severity: 'medium',
      description: `${buttonCount} buttons found but only ${ariaLabelCount} aria-labels. Icon buttons need aria-label.`,
      recommendation: 'Add aria-label to all icon-only buttons. Ensure all interactive elements have accessible names.',
    });
  }
  
  // Check 4: Missing ErrorBoundary
  if (content.includes('React') && !content.includes('ErrorBoundary') && !content.includes('errorBoundary')) {
    issues.push({
      file: relativePath,
      line: 1,
      category: 'Error Handling',
      severity: 'low',
      description: 'React component file without ErrorBoundary wrapping.',
      recommendation: 'Wrap major sections with ErrorBoundary components to prevent entire app crashes from isolated errors.',
    });
  }
  
  // Check 5: Large component file (> 300 lines suggests need to split)
  if (lines.length > 300) {
    issues.push({
      file: relativePath,
      line: 1,
      category: 'Component Size',
      severity: lines.length > 500 ? 'high' : 'medium',
      description: `Component file is ${lines.length} lines. Large components are hard to maintain and test.`,
      recommendation: 'Split this component into smaller, focused sub-components. Extract reusable hooks and utility functions.',
    });
  }
  
  // Check 6: Missing loading and error states in data-fetching components
  if (content.includes('useQuery') || content.includes('useSWR') || content.includes('fetch(') || content.includes('axios(')) {
    const hasLoading = content.includes('isLoading') || content.includes('loading');
    const hasError = content.includes('isError') || content.includes('error');
    
    if (!hasLoading) {
      issues.push({
        file: relativePath,
        line: 1,
        category: 'UX Completeness',
        severity: 'medium',
        description: 'Data fetching detected but no loading state handling found.',
        recommendation: 'Add loading state rendering (skeleton/spinner) while data is being fetched.',
      });
    }
    if (!hasError) {
      issues.push({
        file: relativePath,
        line: 1,
        category: 'UX Completeness',
        severity: 'medium',
        description: 'Data fetching detected but no error state handling found.',
        recommendation: 'Add error state rendering with retry capability when data fetching fails.',
      });
    }
  }
  
  return issues;
}

async function main(): Promise<void> {
  const rootDir = process.argv.find(a => a.startsWith('--dir='))?.split('=')[1] || process.cwd();
  const verbose = process.argv.includes('--verbose');
  
  console.log(`🎨 Running Frontend Code Philosophy check on: ${rootDir}`);
  const files = findComponentFiles(rootDir);
  
  if (files.length === 0) {
    console.log('No React/JSX component files found (.tsx/.jsx).');
    process.exit(0);
  }
  
  let allIssues: FrontendIssue[] = [];
  for (const file of files) {
    allIssues = allIssues.concat(analyzeComponent(file));
  }
  
  // Group by category
  const byCategory = new Map<string, FrontendIssue[]>();
  for (const issue of allIssues) {
    if (!byCategory.has(issue.category)) byCategory.set(issue.category, []);
    byCategory.get(issue.category)!.push(issue);
  }
  
  console.log(`\n## Frontend Code Check Results`);
  console.log(`**Component files analyzed**: ${files.length}`);
  console.log(`**Total issues**: ${allIssues.length}`);
  console.log(`  🟡 High: ${allIssues.filter(i => i.severity === 'high').length}`);
  console.log(`  🔵 Medium: ${allIssues.filter(i => i.severity === 'medium').length}`);
  console.log(`  🟢 Low: ${allIssues.filter(i => i.severity === 'low').length}`);
  console.log();
  
  for (const [category, issues] of byCategory) {
    const icons: Record<string, string> = {
      'Security': '🔒',
      'Rendering Purity': '✨',
      'Accessibility': '♿',
      'Error Handling': '🛡️',
      'Component Size': '📦',
      'UX Completeness': '🎯',
    };
    console.log(`${icons[category] || '•'} ${category}: ${issues.length} issues`);
    if (verbose) {
      issues.forEach(i => {
        const sevIcon = i.severity === 'high' ? '🟡' : i.severity === 'medium' ? '🔵' : '🟢';
        console.log(`  ${sevIcon} ${i.file}:${i.line} — ${i.description}`);
      });
    }
  }
  
  if (allIssues.length === 0) {
    console.log('✅ No frontend issues found!');
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
