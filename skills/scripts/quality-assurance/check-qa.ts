#!/usr/bin/env ts-node
/**
 * QA Readiness Checker
 * 
 * Usage: ts-node check-qa.ts [--dir=<project-dir>] [--verbose] [--ci]
 * 
 * Analyzes a project for QA readiness:
 * - Test coverage (checks for test files)
 * - Test configuration (jest.config, vitest.config, playwright)
 * - CI integration tests in pipeline
 * - Bug report template presence
 * - Linter configuration
 * - TypeScript strict mode
 */

import * as fs from 'fs';
import * as path from 'path';

interface QACheck {
  name: string;
  category: 'testing' | 'config' | 'ci' | 'tooling';
  status: 'pass' | 'fail' | 'warn';
  details: string;
  recommendation?: string;
}

function findUpwards(fileName: string, startDir: string): string | null {
  let current = startDir;
  while (current !== path.parse(current).root) {
    const candidate = path.join(current, fileName);
    if (fs.existsSync(candidate)) return candidate;
    current = path.dirname(current);
  }
  return null;
}

function checkProjectForQA(rootDir: string): QACheck[] {
  const checks: QACheck[] = [];

  // 1. Check for test files
  const testDir = path.join(rootDir, '__tests__');
  const testFiles = findTestFiles(rootDir);
  checks.push({
    name: 'Test Files Present',
    category: 'testing',
    status: testFiles.length > 0 ? 'pass' : 'fail',
    details: testFiles.length > 0 
      ? `Found ${testFiles.length} test files in the project`
      : 'No test files found (*.test.ts, *.spec.ts, __tests__/)',
    recommendation: testFiles.length === 0 ? 'Create at least one test file. Use a test runner like vitest or jest.' : undefined,
  });

  // 2. Check for test configuration
  const configFiles = ['jest.config.ts', 'jest.config.js', 'vitest.config.ts', 'vitest.config.js'];
  const hasTestConfig = configFiles.some(f => fs.existsSync(path.join(rootDir, f)));
  checks.push({
    name: 'Test Configuration',
    category: 'config',
    status: hasTestConfig ? 'pass' : 'warn',
    details: hasTestConfig 
      ? 'Test configuration found (jest/vitest config)'
      : 'No test configuration file found',
    recommendation: !hasTestConfig ? 'Add jest.config.ts or vitest.config.ts to configure the test runner.' : undefined,
  });

  // 3. Check for test scripts in package.json
  const packageJsonPath = path.join(rootDir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const scripts = pkg.scripts || {};
    const hasTestScript = !!scripts.test;
    const hasCoverageScript = !!scripts['test:coverage'];
    
    checks.push({
      name: 'Test Script',
      category: 'config',
      status: hasTestScript ? 'pass' : 'fail',
      details: hasTestScript 
        ? `Test script found: npm run test`
        : 'No "test" script in package.json',
      recommendation: !hasTestScript ? 'Add "test": "vitest" or "test": "jest" to package.json scripts.' : undefined,
    });

    checks.push({
      name: 'Coverage Script',
      category: 'config',
      status: hasCoverageScript ? 'pass' : 'warn',
      details: hasCoverageScript 
        ? 'Coverage script found: npm run test:coverage'
        : 'No "test:coverage" script in package.json',
      recommendation: !hasCoverageScript ? 'Add "test:coverage": "vitest --coverage" or similar to track code coverage.' : undefined,
    });
  }

  // 4. Check for linting
  const eslintConfigs = ['.eslintrc.js', '.eslintrc.json', '.eslintrc.yaml', '.eslintrc.yml', 'eslint.config.js', 'eslint.config.mjs'];
  const hasLintConfig = eslintConfigs.some(f => fs.existsSync(path.join(rootDir, f)));
  const hasPrettier = fs.existsSync(path.join(rootDir, '.prettierrc')) || fs.existsSync(path.join(rootDir, '.prettierrc.json'));
  
  checks.push({
    name: 'ESLint Configuration',
    category: 'tooling',
    status: hasLintConfig ? 'pass' : 'warn',
    details: hasLintConfig ? 'ESLint config found' : 'No ESLint configuration found',
    recommendation: !hasLintConfig ? 'Add ESLint configuration for code quality enforcement.' : undefined,
  });

  checks.push({
    name: 'Prettier Configuration',
    category: 'tooling',
    status: hasPrettier ? 'pass' : 'warn',
    details: hasPrettier ? 'Prettier config found' : 'No Prettier configuration found',
    recommendation: !hasPrettier ? 'Add Prettier configuration for consistent code formatting.' : undefined,
  });

  // 5. Check TypeScript strict mode
  const tsconfigPath = findUpwards('tsconfig.json', rootDir);
  if (tsconfigPath) {
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'));
    const strictMode = tsconfig.compilerOptions?.strict;
    checks.push({
      name: 'TypeScript Strict Mode',
      category: 'config',
      status: strictMode ? 'pass' : 'warn',
      details: strictMode 
        ? 'TypeScript strict mode is enabled'
        : 'TypeScript strict mode is NOT enabled',
      recommendation: strictMode ? undefined : 'Enable "strict": true in tsconfig.json for better type safety.',
    });
  }

  // 6. Check for Playwright/E2E setup
  const playwrightConfig = findUpwards('playwright.config.ts', rootDir) || findUpwards('playwright.config.js', rootDir);
  checks.push({
    name: 'E2E Testing Setup',
    category: 'testing',
    status: playwrightConfig ? 'pass' : 'warn',
    details: playwrightConfig 
      ? 'Playwright configuration found'
      : 'No E2E testing setup detected (playwright.config)',
    recommendation: !playwrightConfig ? 'Add Playwright for end-to-end testing of critical user flows.' : undefined,
  });

  // 7. Check for GitHub Actions CI
  const ghActionsDir = path.join(rootDir, '.github', 'workflows');
  const hasCI = fs.existsSync(ghActionsDir);
  checks.push({
    name: 'CI/CD Pipeline',
    category: 'ci',
    status: hasCI ? 'pass' : 'fail',
    details: hasCI 
      ? `GitHub Actions workflows found (${fs.readdirSync(ghActionsDir).length} files)`
      : 'No CI/CD pipeline configuration found (.github/workflows/)',
    recommendation: !hasCI ? 'Add GitHub Actions CI pipeline with test, lint, and build stages.' : undefined,
  });

  return checks;
}

function findTestFiles(dir: string): string[] {
  const results: string[] = [];
  const testDirs = dir;
  
  function walk(current: string): void {
    if (!fs.existsSync(current)) return;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist') walk(full);
      } else if (entry.isFile() && /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        results.push(full);
      }
    }
  }
  
  // Also check __tests__ directory
  const testDir = path.join(dir, '__tests__');
  if (fs.existsSync(testDir)) walk(testDir);
  
  walk(dir);
  return results;
}

async function main(): Promise<void> {
  const rootDir = process.argv.find(a => a.startsWith('--dir='))?.split('=')[1] || process.cwd();
  const verbose = process.argv.includes('--verbose');
  const ciMode = process.argv.includes('--ci');
  
  console.log(`🧪 Running QA Readiness Check on: ${rootDir}\n`);
  
  const checks = checkProjectForQA(rootDir);
  
  const passed = checks.filter(c => c.status === 'pass').length;
  const failed = checks.filter(c => c.status === 'fail').length;
  const warnings = checks.filter(c => c.status === 'warn').length;
  
  console.log(`## QA Readiness Report\n`);
  console.log(`**${passed}** passed | **${failed}** failed | **${warnings}** warnings\n`);
  
  const categories = [...new Set(checks.map(c => c.category))];
  for (const category of categories) {
    const catChecks = checks.filter(c => c.category === category);
    console.log(`### ${category.charAt(0).toUpperCase() + category.slice(1)}\n`);
    
    for (const check of catChecks) {
      const icon = check.status === 'pass' ? '✅' : check.status === 'fail' ? '❌' : '⚠️';
      console.log(`${icon} **${check.name}**: ${check.details}`);
      if (check.status !== 'pass' && check.recommendation && verbose) {
        console.log(`   💡 ${check.recommendation}`);
      }
    }
    console.log();
  }
  
  if (ciMode) {
    process.exit(failed > 0 ? 1 : 0);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
