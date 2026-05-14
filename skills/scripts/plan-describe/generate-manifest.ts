#!/usr/bin/env ts-node
/**
 * Plan Manifest Generator
 * 
 * Usage: ts-node generate-manifest.ts --name=<feature-name> --out=<output-dir>
 * 
 * Scaffolds a plan-manifest.json template for the plan-describe skill.
 * The planner fills in the details and checkpoints.
 */

import * as fs from 'fs';
import * as path from 'path';

interface ManifestTemplate {
  manifestVersion: number;
  planSummary: string;
  createdAt: string;
  checkpoints: Array<{
    id: string;
    type: 'structural' | 'behavioral';
    description: string;
    target: string;
    verify: {
      kind: string;
      [key: string]: string;
    };
    dependsOn: string[];
  }>;
}

function generateTemplate(featureName: string, outputDir: string): void {
  const manifest: ManifestTemplate = {
    manifestVersion: 1,
    planSummary: `Implementation plan for: ${featureName}`,
    createdAt: new Date().toISOString(),
    checkpoints: [
      // Structural checkpoints
      {
        id: 'CP-001',
        type: 'structural',
        description: `Core module file created for ${featureName}`,
        target: `src/core/${featureName.replace(/\s+/g, '-').toLowerCase()}.ts`,
        verify: { kind: 'fileExists' },
        dependsOn: [],
      },
      {
        id: 'CP-002',
        type: 'structural',
        description: `Main class/function exported from core module`,
        target: `src/core/${featureName.replace(/\s+/g, '-').toLowerCase()}.ts`,
        verify: { 
          kind: 'exportExists',
          exportName: featureName.replace(/\s+/g, '').charAt(0).toUpperCase() + featureName.replace(/\s+/g, '').slice(1),
        },
        dependsOn: ['CP-001'],
      },
      {
        id: 'CP-003',
        type: 'structural',
        description: `Test file created for ${featureName}`,
        target: `tests/${featureName.replace(/\s+/g, '-').toLowerCase()}.test.ts`,
        verify: { kind: 'fileExists' },
        dependsOn: ['CP-001'],
      },
      // Behavioral checkpoints
      {
        id: 'CP-004',
        type: 'behavioral',
        description: `Main function handles error cases gracefully`,
        target: `src/core/${featureName.replace(/\s+/g, '-').toLowerCase()}.ts`,
        verify: { 
          kind: 'handlesError',
          methodName: featureName.replace(/\s+/g, '').charAt(0).toLowerCase() + featureName.replace(/\s+/g, '').slice(1),
          details: 'Should handle empty/missing input and network errors',
        },
        dependsOn: ['CP-002'],
      },
      {
        id: 'CP-005',
        type: 'behavioral',
        description: `Input validation implemented`,
        target: `src/core/${featureName.replace(/\s+/g, '-').toLowerCase()}.ts`,
        verify: { 
          kind: 'validatesInput',
          methodName: featureName.replace(/\s+/g, '').charAt(0).toLowerCase() + featureName.replace(/\s+/g, '').slice(1),
        },
        dependsOn: ['CP-002'],
      },
    ],
  };

  // Create output directory
  const manifestsDir = path.join(outputDir, 'plan-manifests');
  if (!fs.existsSync(manifestsDir)) {
    fs.mkdirSync(manifestsDir, { recursive: true });
  }

  // Write manifest
  const manifestPath = path.join(manifestsDir, `${featureName.replace(/\s+/g, '-').toLowerCase()}-manifest.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`✅ Plan manifest template generated: ${manifestPath}`);
  console.log(`\nTotal checkpoints: ${manifest.checkpoints.length}`);
  console.log(`  Structural: ${manifest.checkpoints.filter(c => c.type === 'structural').length}`);
  console.log(`  Behavioral: ${manifest.checkpoints.filter(c => c.type === 'behavioral').length}`);
}

// Parse arguments
const featureName = process.argv.find(a => a.startsWith('--name='))?.split('=')[1];
const outputDir = process.argv.find(a => a.startsWith('--out='))?.split('=')[1] || process.cwd();

if (!featureName) {
  console.error('❌ Usage: ts-node generate-manifest.ts --name=<feature-name> --out=<output-dir>');
  console.error('   --name: Name of the feature (e.g., "user-profile")');
  console.error('   --out: Output directory for plan-manifests/ folder');
  process.exit(1);
}

generateTemplate(featureName, outputDir);
