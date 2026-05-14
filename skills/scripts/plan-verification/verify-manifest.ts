#!/usr/bin/env ts-node
/**
 * Plan Manifest Verifier
 * 
 * Usage: ts-node verify-manifest.ts --manifest=<path-to-manifest> [--dir=<project-dir>] [--verbose]
 * 
 * Reads a plan-manifest.json and verifies each checkpoint against the actual code.
 * Produces a compliance score report.
 */

import * as fs from 'fs';
import * as path from 'path';

interface Checkpoint {
  id: string;
  type: 'structural' | 'behavioral';
  description: string;
  target: string;
  verify: Record<string, string>;
  dependsOn: string[];
}

interface VerificationResult {
  checkpointId: string;
  type: string;
  description: string;
  status: 'pass' | 'fail' | 'skipped';
  reason?: string;
}

function loadManifest(manifestPath: string): { planSummary: string; checkpoints: Checkpoint[] } {
  const content = fs.readFileSync(manifestPath, 'utf-8');
  const manifest = JSON.parse(content);
  return {
    planSummary: manifest.planSummary || '',
    checkpoints: manifest.checkpoints || [],
  };
}

function verifyFileExists(target: string, rootDir: string): boolean {
  const fullPath = path.join(rootDir, target);
  return fs.existsSync(fullPath);
}

function verifyExportExists(target: string, exportName: string, rootDir: string): boolean {
  const fullPath = path.join(rootDir, target);
  if (!fs.existsSync(fullPath)) return false;
  const content = fs.readFileSync(fullPath, 'utf-8');
  return new RegExp(`export\\s+(?:class|function|const|interface|type|enum)\\s+${exportName}`).test(content);
}

function verifyFunctionExists(target: string, functionName: string, rootDir: string): boolean {
  const fullPath = path.join(rootDir, target);
  if (!fs.existsSync(fullPath)) return false;
  const content = fs.readFileSync(fullPath, 'utf-8');
  return new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${functionName}\\s*\\(`).test(content) ||
         new RegExp(`(?:export\\s+)?const\\s+${functionName}\\s*[:=]`).test(content);
}

function verifyMethodExists(target: string, className: string, methodName: string, rootDir: string): boolean {
  const fullPath = path.join(rootDir, target);
  if (!fs.existsSync(fullPath)) return false;
  const content = fs.readFileSync(fullPath, 'utf-8');
  
  // Find class
  const classMatch = new RegExp(`class\\s+${className}`).exec(content);
  if (!classMatch) return false;
  
  // Check method in class body
  const classBody = content.substring(classMatch.index);
  const methodPattern = new RegExp(`(?:public|private|protected|static)?\\s*(?:async\\s+)?${methodName}\\s*\\(`);
  return methodPattern.test(classBody);
}

function verifyCheckpoint(cp: Checkpoint, rootDir: string, results: Map<string, VerificationResult>): VerificationResult {
  // Check dependency status
  for (const depId of cp.dependsOn) {
    const depResult = results.get(depId);
    if (depResult && depResult.status !== 'pass') {
      return {
        checkpointId: cp.id,
        type: cp.type,
        description: cp.description,
        status: 'skipped',
        reason: `Depends on ${depId} which ${depResult.status === 'fail' ? 'failed' : 'was skipped'}`,
      };
    }
  }

  const kind = cp.verify.kind;
  const target = cp.target;
  
  switch (kind) {
    case 'fileExists':
      return {
        checkpointId: cp.id,
        type: cp.type,
        description: cp.description,
        status: verifyFileExists(target, rootDir) ? 'pass' : 'fail',
        reason: verifyFileExists(target, rootDir) ? undefined : `File not found: ${target}`,
      };

    case 'fileNotExists':
      return {
        checkpointId: cp.id,
        type: cp.type,
        description: cp.description,
        status: !verifyFileExists(target, rootDir) ? 'pass' : 'fail',
        reason: !verifyFileExists(target, rootDir) ? undefined : `File exists when it should not: ${target}`,
      };

    case 'exportExists': {
      const exportName = cp.verify.exportName || '';
      const exists = verifyExportExists(target, exportName, rootDir);
      return {
        checkpointId: cp.id,
        type: cp.type,
        description: cp.description,
        status: exists ? 'pass' : 'fail',
        reason: exists ? undefined : `Export "${exportName}" not found in ${target}`,
      };
    }

    case 'functionExists': {
      const funcName = cp.verify.functionName || '';
      const exists = verifyFunctionExists(target, funcName, rootDir);
      return {
        checkpointId: cp.id,
        type: cp.type,
        description: cp.description,
        status: exists ? 'pass' : 'fail',
        reason: exists ? undefined : `Function "${funcName}" not found in ${target}`,
      };
    }

    case 'methodExists': {
      const className = cp.verify.className || '';
      const methodName = cp.verify.methodName || '';
      const exists = verifyMethodExists(target, className, methodName, rootDir);
      return {
        checkpointId: cp.id,
        type: cp.type,
        description: cp.description,
        status: exists ? 'pass' : 'fail',
        reason: exists ? undefined : `Method "${methodName}" not found in class "${className}" in ${target}`,
      };
    }

    case 'handlesError': {
      const fullPath = path.join(rootDir, target);
      if (!fs.existsSync(fullPath)) {
        return { checkpointId: cp.id, type: cp.type, description: cp.description, status: 'fail', reason: `File not found: ${target}` };
      }
      const content = fs.readFileSync(fullPath, 'utf-8');
      // Accept try/catch blocks or if-guard-throw patterns as error handling
      const hasErrorHandling = /try\s*\{[\s\S]*?\}\s*catch/.test(content) ||
                               /if\s*\([^)]+\)\s*\{[^}]*throw\s+/.test(content) ||
                               /if\s*\([^)]+\)\s*throw\s+/.test(content);
      return {
        checkpointId: cp.id,
        type: cp.type,
        description: cp.description,
        status: hasErrorHandling ? 'pass' : 'fail',
        reason: hasErrorHandling ? undefined : `No error handling (try/catch or if-guard-throw) found in ${target}`,
      };
    }

    case 'validatesInput': {
      const fullPath = path.join(rootDir, target);
      if (!fs.existsSync(fullPath)) {
        return { checkpointId: cp.id, type: cp.type, description: cp.description, status: 'fail', reason: `File not found: ${target}` };
      }
      const content = fs.readFileSync(fullPath, 'utf-8');
      // Accept zod/Joi schemas, if-guard-throw, validate/assert calls
      const hasValidation = /(?:zod|Joi|safeParse|validate|assert|if\s*\(|typeof\s+\w+\s*===?\s*['"])/.test(content);
      return {
        checkpointId: cp.id,
        type: cp.type,
        description: cp.description,
        status: hasValidation ? 'pass' : 'fail',
        reason: hasValidation ? undefined : `No input validation (zod, if-guard, validate/assert) detected in ${target}`,
      };
    }

    default:
      return {
        checkpointId: cp.id,
        type: cp.type,
        description: cp.description,
        status: 'skipped',
        reason: `Unknown verification kind: ${kind}`,
      };
  }
}

async function main(): Promise<void> {
  const manifestPath = process.argv.find(a => a.startsWith('--manifest='))?.split('=')[1];
  const rootDir = process.argv.find(a => a.startsWith('--dir='))?.split('=')[1] || process.cwd();
  const verbose = process.argv.includes('--verbose');
  
  if (!manifestPath) {
    console.error('❌ Usage: ts-node verify-manifest.ts --manifest=<path-to-manifest> [--dir=<project-dir>]');
    process.exit(1);
  }

  const resolvedManifestPath = path.resolve(rootDir, manifestPath);
  console.log(`📋 Loading plan manifest: ${resolvedManifestPath}\n`);

  if (!fs.existsSync(resolvedManifestPath)) {
    console.error(`❌ Manifest file not found: ${resolvedManifestPath}`);
    process.exit(1);
  }

  const { planSummary, checkpoints } = loadManifest(resolvedManifestPath);
  console.log(`Plan: ${planSummary}`);
  console.log(`Checkpoints: ${checkpoints.length}\n`);

  // Verify in dependency order
  const results = new Map<string, VerificationResult>();
  const order = topologicalSort(checkpoints);
  
  for (const cpId of order) {
    const cp = checkpoints.find(c => c.id === cpId);
    if (!cp) continue;
    const result = verifyCheckpoint(cp, rootDir, results);
    results.set(cp.id, result);
  }

  // Calculate score
  const total = results.size;
  const passed = [...results.values()].filter(r => r.status === 'pass').length;
  const failed = [...results.values()].filter(r => r.status === 'fail').length;
  const skipped = [...results.values()].filter(r => r.status === 'skipped').length;
  const score = total - skipped > 0 ? Math.round((passed / (total - skipped)) * 100) : 0;

  // Generate report
  console.log(`## Verification Report\n`);
  console.log(`**Plan**: ${planSummary}`);
  console.log(`**Manifest**: ${manifestPath}`);
  console.log(`**Compliance Score**: ${score}%\n`);
  
  console.log(`| Category | Total | Passed | Failed | Skipped |`);
  console.log(`|----------|-------|--------|--------|---------|`);
  const structural = [...results.values()].filter(r => r.type === 'structural');
  const behavioral = [...results.values()].filter(r => r.type === 'behavioral');
  console.log(`| Structural | ${structural.length} | ${structural.filter(r => r.status === 'pass').length} | ${structural.filter(r => r.status === 'fail').length} | ${structural.filter(r => r.status === 'skipped').length} |`);
  console.log(`| Behavioral | ${behavioral.length} | ${behavioral.filter(r => r.status === 'pass').length} | ${behavioral.filter(r => r.status === 'fail').length} | ${behavioral.filter(r => r.status === 'skipped').length} |`);
  console.log(`| **Total** | **${total}** | **${passed}** | **${failed}** | **${skipped}** |\n`);

  // Failed checkpoints
  const failedResults = [...results.values()].filter(r => r.status === 'fail');
  if (failedResults.length > 0) {
    console.log('### Failed Checkpoints\n');
    for (const r of failedResults) {
      console.log(`❌ **${r.checkpointId}**: ${r.description}`);
      console.log(`   Reason: ${r.reason}\n`);
    }
  }

  // Skipped checkpoints
  const skippedResults = [...results.values()].filter(r => r.status === 'skipped');
  if (skippedResults.length > 0 && verbose) {
    console.log('### Skipped Checkpoints\n');
    for (const r of skippedResults) {
      console.log(`⏭️ **${r.checkpointId}**: ${r.description}`);
      console.log(`   Reason: ${r.reason}\n`);
    }
  }

  // Verdict
  console.log('### Verdict\n');
  if (score >= 100) {
    console.log('✅ **PASS** — All checkpoints verified successfully.');
  } else if (score >= 80) {
    console.log('⚠️ **PARTIAL** — Most checkpoints pass, but some need attention.');
  } else if (score >= 50) {
    console.log('❌ **LOW COMPLIANCE** — Significant gaps between plan and implementation.');
  } else {
    console.log('🚫 **CRITICAL** — Major deviations from the plan.');
  }

  process.exit(failed > 0 ? 1 : 0);
}

function topologicalSort(checkpoints: Checkpoint[]): string[] {
  const visited = new Set<string>();
  const order: string[] = [];
  
  function visit(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    const cp = checkpoints.find(c => c.id === id);
    if (cp) {
      for (const depId of cp.dependsOn) {
        visit(depId);
      }
    }
    order.push(id);
  }
  
  for (const cp of checkpoints) {
    visit(cp.id);
  }
  
  return order;
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
