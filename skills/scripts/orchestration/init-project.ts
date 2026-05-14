#!/usr/bin/env ts-node
/**
 * Project Initialization Script (for Orchestration)
 * 
 * Usage: ts-node init-project.ts --name=<project-name> --dir=<output-dir> [--type=lib|app|monorepo]
 * 
 * Scaffolds a new project with proper structure for AI agent development.
 * Creates folder structure, config files, and boilerplate.
 */

import * as fs from 'fs';
import * as path from 'path';

interface ProjectConfig {
  name: string;
  dir: string;
  type: 'lib' | 'app' | 'monorepo';
}

function parseArgs(): ProjectConfig {
  const args = process.argv.slice(2);
  const name = args.find(a => a.startsWith('--name='))?.split('=')[1];
  const dir = args.find(a => a.startsWith('--dir='))?.split('=')[1] || process.cwd();
  const type = (args.find(a => a.startsWith('--type='))?.split('=')[1] || 'lib') as 'lib' | 'app' | 'monorepo';
  
  if (!name) {
    console.error('❌ Usage: ts-node init-project.ts --name=<project-name> --dir=<output-dir> [--type=lib|app|monorepo]');
    process.exit(1);
  }
  
  return { name, dir: path.resolve(dir, name), type };
}

const FOLDER_STRUCTURES: Record<string, string[]> = {
  lib: [
    'src/core/entities',
    'src/core/use-cases',
    'src/core/ports',
    'src/adapters/controllers',
    'src/adapters/repositories',
    'src/adapters/gateways',
    'src/infrastructure/database',
    'src/infrastructure/config',
    'tests/unit',
    'tests/integration',
  ],
  app: [
    'src/pages',
    'src/components/common',
    'src/components/features',
    'src/hooks',
    'src/services',
    'src/utils',
    'src/styles',
    'src/types',
    'public',
    'tests',
  ],
  monorepo: [
    'packages/core/src',
    'packages/core/tests',
    'packages/server/src',
    'packages/server/tests',
    'packages/web/src',
    'packages/web/tests',
    'tools/scripts',
    'docs',
  ],
};

function scaffold(config: ProjectConfig): void {
  const { name, dir, type } = config;
  
  console.log(`🏗️  Scaffolding project: ${name}`);
  console.log(`   Directory: ${dir}`);
  console.log(`   Type: ${type}\n`);
  
  // Create directories
  const folders = FOLDER_STRUCTURES[type];
  for (const folder of folders) {
    const fullPath = path.join(dir, folder);
    fs.mkdirSync(fullPath, { recursive: true });
    console.log(`  📁 Created: ${folder}`);
  }
  
  // Create package.json
  const packageJson: any = {
    name,
    version: '0.1.0',
    private: true,
    scripts: {
      build: 'tsc',
      test: 'vitest run',
      'test:watch': 'vitest',
      lint: 'eslint src/',
      'lint:fix': 'eslint src/ --fix',
      format: 'prettier --write src/',
      typecheck: 'tsc --noEmit',
    },
    devDependencies: {
      typescript: '^5.4.0',
      vitest: '^1.6.0',
      eslint: '^8.57.0',
      prettier: '^3.2.0',
      '@types/node': '^20.11.0',
    },
  };
  
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(packageJson, null, 2));
  console.log('  📝 Created: package.json');
  
  // Create tsconfig.json
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'commonjs',
      lib: ['ES2022'],
      outDir: './dist',
      rootDir: './src',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      declaration: true,
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist', 'tests'],
  };
  
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
  console.log('  📝 Created: tsconfig.json');
  
  // Create .gitignore
  const gitignore = `node_modules/
dist/
build/
.env
.env.local
*.log
coverage/
.DS_Store
`;
  fs.writeFileSync(path.join(dir, '.gitignore'), gitignore);
  console.log('  📝 Created: .gitignore');
  
  // Create .env.example
  const envExample = `# Application
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug

# Database
DATABASE_URL=postgres://user:pass@localhost:5432/myapp

# Redis
REDIS_URL=redis://localhost:6379
`;
  fs.writeFileSync(path.join(dir, '.env.example'), envExample, 'utf-8');
  console.log('  📝 Created: .env.example');
  
  // Create vitest.config.ts
  const vitestConfig = `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
    },
  },
});
`;
  fs.writeFileSync(path.join(dir, 'vitest.config.ts'), vitestConfig, 'utf-8');
  console.log('  📝 Created: vitest.config.ts');
  
  // Create .prettierrc
  const prettierrc = `{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
`;
  fs.writeFileSync(path.join(dir, '.prettierrc'), prettierrc, 'utf-8');
  console.log('  📝 Created: .prettierrc');
  
  // Create index.ts placeholder
  const indexTs = `/**
 * ${name}
 * 
 * TODO: Add project description
 */

export const VERSION = '0.1.0';
`;
  const srcDir = type === 'monorepo' ? path.join(dir, 'packages', 'core', 'src') : path.join(dir, 'src');
  fs.writeFileSync(path.join(srcDir, 'index.ts'), indexTs, 'utf-8');
  console.log('  📝 Created: src/index.ts');
  
  console.log(`\n✅ Project "${name}" scaffolded successfully!`);
  console.log(`\nNext steps:`);
  console.log(`  cd ${name}`);
  console.log(`  npm install`);
  console.log(`  npm run build`);
}

const config = parseArgs();
scaffold(config);
