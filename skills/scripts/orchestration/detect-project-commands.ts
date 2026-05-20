#!/usr/bin/env ts-node
/**
 * detect-project-commands.ts
 *
 * Cross-architecture build command detector.
 * Auto-discovers the correct build, lint, test, and type-check commands
 * for any project by reading config files.
 *
 * Usage:
 *   ts-node detect-project-commands.ts [--dir=<path>] [--format=yaml] [--brief] [--verify] [--cache]
 *
 * Options:
 *   --dir=<path>     Project directory to analyze (default: cwd)
 *   --format=yaml    Output in YAML instead of JSON (default: json)
 *   --brief          Only output commands, omit details (default: false)
 *   --verify         Verify commands actually exist on disk (default: false)
 *   --cache          Cache results to .opencode/.command-cache.json (default: false)
 *
 * Output (JSON to stdout):
 *   {
 *     "projectType": "web-app-backend",
 *     "build": { "command": "npm run build", "exists": true, "source": "package.json scripts.build" },
 *     "lint": { ... },
 *     "test": { ... },
 *     "typeCheck": { ... },
 *     "incrementalBuild": { ... },
 *     "projectFramework": { ... }
 *   }
 *
 * Exit code: 0 = success, 1 = error
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// ── Types ──────────────────────────────────────────────────────────

type ProjectType = 'web-app-backend' | 'web-app-frontend' | 'library' | 'cli-tool' | 'monorepo-package' | 'unknown';

interface CommandInfo {
  command: string;
  exists: boolean;
  source: string;
}

interface IncrementalBuildInfo extends CommandInfo {
  incrementalFlag: string | null;
  supportsIncremental: boolean;
}

interface ProjectFramework {
  name: string;
  version: string | null;
  detectedBy: string;
}

interface DetectionResult {
  projectType: ProjectType;
  build: CommandInfo;
  lint: CommandInfo;
  test: CommandInfo;
  typeCheck: CommandInfo;
  incrementalBuild: IncrementalBuildInfo;
  projectFramework: ProjectFramework | null;
  projectInfo: {
    hasPackageJson: boolean;
    hasTsConfig: boolean;
    dependencies: number;
    devDependencies: number;
  };
}

interface Options {
  dir: string;
  format: 'json' | 'yaml';
  brief: boolean;
  verify: boolean;
  cache: boolean;
}

// ── CLI Parsing ────────────────────────────────────────────────────

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = {
    dir: process.cwd(),
    format: 'json',
    brief: false,
    verify: false,
    cache: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--dir=')) {
      options.dir = path.resolve(arg.slice(6));
    } else if (arg === '--format=yaml') {
      options.format = 'yaml';
    } else if (arg === '--brief') {
      options.brief = true;
    } else if (arg === '--verify') {
      options.verify = true;
    } else if (arg === '--cache') {
      options.cache = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
detect-project-commands.ts — Cross-architecture build command detector

Usage:
  ts-node detect-project-commands.ts [options]

Options:
  --dir=<path>     Project directory to analyze (default: cwd)
  --format=yaml    Output in YAML instead of JSON (default: json)
  --brief          Only output commands, omit details (default: false)
  --verify         Verify commands actually exist on disk (default: false)
  --cache          Cache results to .opencode/.command-cache.json (default: false)
  --help, -h       Show this help message

Output:
  JSON (or YAML) with detected build, lint, test, and type-check commands.
  Exit code: 0 = success, 1 = error
`);
}

// ── Utility Functions ──────────────────────────────────────────────

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function commandExists(command: string): boolean {
  try {
    // Check if the command is a relative path to node_modules
    if (command.startsWith('./') || command.startsWith('.\\')) {
      return fileExists(path.resolve(command));
    }
    // Extract the base command (before first space or arg)
    const baseCmd = command.split(/\s+/)[0];
    if (!baseCmd) return false;

    // Handle npx commands: "npx tsc" — check if the tool exists
    if (baseCmd === 'npx' || baseCmd === 'npm') {
      const tool = command.split(/\s+/)[1];
      if (!tool) return false;
      // Check if it's in node_modules/.bin
      const binDir = path.join(process.cwd(), 'node_modules', '.bin');
      const toolPath = path.join(binDir, tool);
      if (fileExists(toolPath)) return true;
      // Check via which
      try {
        execSync(`which ${tool} 2>/dev/null`, { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    }

    // Standard command check via which
    try {
      execSync(`which ${baseCmd} 2>/dev/null`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

function indentYaml(value: unknown, depth: number = 0): string {
  const pad = '  '.repeat(depth);
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' || typeof value === 'string') {
    if (typeof value === 'string' && (value.includes(':') || value.includes('#') || value.includes('\n'))) {
      return `"${value}"`;
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return '\n' + value.map(v => `${pad}- ${indentYaml(v, depth + 1)}`).join('\n');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return '\n' + entries.map(([k, v]) => `${pad}${k}: ${indentYaml(v, depth + 1)}`).join('\n');
  }
  return String(value);
}

// ── Detection Logic ────────────────────────────────────────────────

function detectProjectType(dirPath: string, pkg: Record<string, unknown> | null): ProjectType {
  if (!pkg) return 'unknown';

  const hasBuildScript = typeof pkg.scripts === 'object' && pkg.scripts !== null &&
    typeof (pkg.scripts as Record<string, string>).build === 'string';
  const deps = { ...(pkg.dependencies as Record<string, string> || {}), ...(pkg.devDependencies as Record<string, string> || {}) };

  // Monorepo detection
  if (pkg.workspaces || Array.isArray(pkg.workspaces)) {
    // Check if a monorepo has individual package manifests
    const hasPackages = Array.isArray(pkg.workspaces) && pkg.workspaces.length > 0;
    if (hasPackages || pkg.private === true) return 'monorepo-package';
  }

  // CLI tool detection (prioritized: has bin entry, or specific deps)
  if (pkg.bin || deps['commander'] || deps['yargs'] || deps['oclif'] || deps['meow']) {
    // But if it also has express/next/react, it's probably a web app with CLI helpers
    if (!deps['express'] && !deps['next'] && !deps['react'] && !deps['@remix-run/node']) {
      return 'cli-tool';
    }
  }

  // Frontend detection
  if (deps['next'] || deps['react'] || deps['vue'] || deps['@angular/core'] ||
      deps['svelte'] || deps['remix'] || deps['gatsby'] || deps['nuxt'] ||
      deps['@remix-run/react']) {
    // If it also has backend deps, could be fullstack — lean frontend if next/vite is primary
    if (deps['express'] || deps['fastify'] || deps['koa'] || deps['hono']) {
      // Has both frontend and backend — check what the build script suggests
      const scripts = pkg.scripts as Record<string, string> || {};
      if (scripts.build && scripts.build.includes('next')) return 'web-app-frontend';
      if (scripts.build && scripts.build.includes('vite build')) return 'web-app-frontend';
      // Default to backend for API-first projects
      if (deps['express'] || deps['fastify']) return 'web-app-backend';
    }
    return 'web-app-frontend';
  }

  // Backend detection
  if (deps['express'] || deps['fastify'] || deps['koa'] || deps['hono'] ||
      deps['@hapi/hapi'] || deps['nestjs'] || deps['@nestjs/core'] ||
      deps['socket.io']) {
    return 'web-app-backend';
  }

  // Library detection
  if (hasBuildScript || deps['typescript']) {
    const hasLibraryPatterns = deps['rollup'] || deps['microbundle'] ||
      deps['tsdx'] || deps['tsup'] || deps['esbuild'] ||
      pkg.main || pkg.module || pkg.types || pkg.exports;
    if (hasLibraryPatterns) return 'library';
  }

  // Fallback: has build script but no clear framework
  if (hasBuildScript) return 'library';

  return 'unknown';
}

function detectFramework(dirPath: string, pkg: Record<string, unknown> | null): ProjectFramework | null {
  if (!pkg) return null;

  const deps: Record<string, string> = {
    ...(pkg.dependencies as Record<string, string> || {}),
    ...(pkg.devDependencies as Record<string, string> || {}),
  };

  const frameworks: Array<{ name: string; packages: string[]; detectBy: string }> = [
    { name: 'Next.js', packages: ['next'], detectBy: 'next in dependencies' },
    { name: 'React', packages: ['react'], detectBy: 'react in dependencies' },
    { name: 'Vue.js', packages: ['vue'], detectBy: 'vue in dependencies' },
    { name: 'Angular', packages: ['@angular/core'], detectBy: '@angular/core in dependencies' },
    { name: 'Svelte', packages: ['svelte'], detectBy: 'svelte in dependencies' },
    { name: 'Express', packages: ['express'], detectBy: 'express in dependencies' },
    { name: 'Fastify', packages: ['fastify'], detectBy: 'fastify in dependencies' },
    { name: 'NestJS', packages: ['@nestjs/core', 'nestjs'], detectBy: '@nestjs/core in dependencies' },
    { name: 'Next.js (fullstack)', packages: ['next', 'express'], detectBy: 'next + express in dependencies' },
    { name: 'Remix', packages: ['@remix-run/node', '@remix-run/react'], detectBy: '@remix-run/* in dependencies' },
    { name: 'Gatsby', packages: ['gatsby'], detectBy: 'gatsby in dependencies' },
    { name: 'Nuxt', packages: ['nuxt'], detectBy: 'nuxt in dependencies' },
    { name: 'Hono', packages: ['hono'], detectBy: 'hono in dependencies' },
    { name: 'Koa', packages: ['koa'], detectBy: 'koa in dependencies' },
    { name: 'Hapi', packages: ['@hapi/hapi'], detectBy: '@hapi/hapi in dependencies' },
    { name: 'Socket.IO', packages: ['socket.io'], detectBy: 'socket.io in dependencies' },
    { name: 'TypeScript library', packages: ['typescript'], detectBy: 'typescript in devDependencies' },
  ];

  for (const fw of frameworks) {
    const found = fw.packages.every(pkgName => deps[pkgName] !== undefined);
    if (found) {
      const version = deps[fw.packages[0]] || null;
      return { name: fw.name, version, detectedBy: fw.detectBy };
    }
  }

  return null;
}

function detectBuildCommand(dirPath: string, pkg: Record<string, unknown> | null): CommandInfo {
  // 1. Check package.json scripts.build
  if (pkg && pkg.scripts) {
    const scripts = pkg.scripts as Record<string, string>;
    if (scripts.build) {
      return {
        command: `npm run build`,
        exists: true,
        source: 'package.json scripts.build',
      };
    }
  }

  // 2. Check for build config files
  const buildConfigs: Array<{ file: string; command: string; label: string }> = [
    { file: 'Makefile', command: 'make', label: 'Makefile' },
    { file: 'webpack.config.js', command: 'npx webpack --mode production', label: 'webpack.config.js' },
    { file: 'webpack.config.ts', command: 'npx webpack --mode production', label: 'webpack.config.ts' },
    { file: 'vite.config.ts', command: 'npx vite build', label: 'vite.config.ts' },
    { file: 'vite.config.js', command: 'npx vite build', label: 'vite.config.js' },
    { file: 'next.config.js', command: 'npx next build', label: 'next.config.js' },
    { file: 'next.config.mjs', command: 'npx next build', label: 'next.config.mjs' },
    { file: 'rollup.config.js', command: 'npx rollup -c', label: 'rollup.config.js' },
    { file: 'rollup.config.ts', command: 'npx rollup -c', label: 'rollup.config.ts' },
    { file: 'esbuild.config.js', command: 'node esbuild.config.js', label: 'esbuild.config.js' },
    { file: 'angular.json', command: 'npx ng build', label: 'angular.json' },
    { file: 'vue.config.js', command: 'npx vue-cli-service build', label: 'vue.config.js' },
    { file: 'nuxt.config.ts', command: 'npx nuxt build', label: 'nuxt.config.ts' },
    { file: 'nuxt.config.js', command: 'npx nuxt build', label: 'nuxt.config.js' },
    { file: 'svelte.config.js', command: 'npx svelte-kit build', label: 'svelte.config.js' },
    { file: 'tsup.config.ts', command: 'npx tsup', label: 'tsup.config.ts' },
    { file: 'tsup.config.js', command: 'npx tsup', label: 'tsup.config.js' },
    { file: '.turbo/config.json', command: 'npx turbo run build', label: 'turbo config' },
    { file: 'lerna.json', command: 'npx lerna run build', label: 'lerna.json' },
    { file: 'nx.json', command: 'npx nx run-many --target=build', label: 'nx.json' },
  ];

  for (const cfg of buildConfigs) {
    if (fileExists(path.join(dirPath, cfg.file))) {
      return {
        command: cfg.command,
        exists: true,
        source: cfg.label,
      };
    }
  }

  // 3. Check tsconfig.json with noEmit:false or noEmit not set
  const tsconfigPath = path.join(dirPath, 'tsconfig.json');
  if (fileExists(tsconfigPath)) {
    const tsconfig = readJsonFile(tsconfigPath);
    if (tsconfig) {
      const noEmit = (tsconfig.compilerOptions as Record<string, unknown> | undefined)?.noEmit;
      if (noEmit === false || noEmit === undefined) {
        // Only if tsc is available
        if (commandExists('tsc') || fileExists(path.join(dirPath, 'node_modules', '.bin', 'tsc'))) {
          return {
            command: 'npx tsc',
            exists: true,
            source: 'tsconfig.json (noEmit: false or unset)',
          };
        }
      }
    }
  }

  // 4. Check for .cargo/config.toml (Rust projects)
  if (fileExists(path.join(dirPath, 'Cargo.toml'))) {
    return {
      command: 'cargo build',
      exists: commandExists('cargo'),
      source: 'Cargo.toml',
    };
  }

  // 5. Check for pyproject.toml (Python)
  if (fileExists(path.join(dirPath, 'pyproject.toml'))) {
    return {
      command: 'pip install -e .',
      exists: commandExists('pip'),
      source: 'pyproject.toml',
    };
  }

  return {
    command: '',
    exists: false,
    source: 'not detected',
  };
}

function detectLintCommand(dirPath: string, pkg: Record<string, unknown> | null): CommandInfo {
  // 1. Check package.json scripts.lint
  if (pkg && pkg.scripts) {
    const scripts = pkg.scripts as Record<string, string>;
    if (scripts.lint) {
      return {
        command: `npm run lint`,
        exists: true,
        source: 'package.json scripts.lint',
      };
    }
  }

  // 2. Check lint config files
  const lintConfigs: Array<{ check: boolean; command: string; label: string }> = [
    {
      check: fileExists(path.join(dirPath, '.eslintrc.js')) ||
             fileExists(path.join(dirPath, '.eslintrc.cjs')) ||
             fileExists(path.join(dirPath, '.eslintrc.yaml')) ||
             fileExists(path.join(dirPath, '.eslintrc.yml')) ||
             fileExists(path.join(dirPath, '.eslintrc.json')) ||
             fileExists(path.join(dirPath, 'eslint.config.js')) ||
             fileExists(path.join(dirPath, 'eslint.config.mjs')),
      command: 'npx eslint .',
      label: 'eslint config file',
    },
    {
      check: fileExists(path.join(dirPath, '.prettierrc')) ||
             fileExists(path.join(dirPath, '.prettierrc.js')) ||
             fileExists(path.join(dirPath, '.prettierrc.json')) ||
             fileExists(path.join(dirPath, '.prettierrc.yaml')) ||
             fileExists(path.join(dirPath, 'prettier.config.js')),
      command: 'npx prettier --check .',
      label: 'prettier config file',
    },
    {
      check: fileExists(path.join(dirPath, '.stylelintrc.js')) ||
             fileExists(path.join(dirPath, '.stylelintrc.json')),
      command: 'npx stylelint "**/*.css"',
      label: 'stylelint config file',
    },
    {
      check: fileExists(path.join(dirPath, '.rubocop.yml')),
      command: 'rubocop',
      label: 'rubocop config (.rubocop.yml)',
    },
    {
      check: fileExists(path.join(dirPath, 'pylintrc')) ||
             fileExists(path.join(dirPath, '.pylintrc')),
      command: 'pylint .',
      label: 'pylint config',
    },
    {
      check: fileExists(path.join(dirPath, '.golangci.yml')) ||
             fileExists(path.join(dirPath, '.golangci.yaml')),
      command: 'golangci-lint run',
      label: 'golangci config',
    },
  ];

  for (const cfg of lintConfigs) {
    if (cfg.check) {
      return {
        command: cfg.command,
        exists: commandExists(cfg.command.split(/\s+/)[0]) ||
                (cfg.command.startsWith('npx') && fileExists(path.join(dirPath, 'node_modules', '.bin', cfg.command.split(/\s+/)[1]))),
        source: cfg.label,
      };
    }
  }

  // 3. Check for eslint in package.json
  if (pkg) {
    const deps = { ...(pkg.dependencies as Record<string, string> || {}), ...(pkg.devDependencies as Record<string, string> || {}) };
    if (deps['eslint']) {
      return {
        command: 'npx eslint .',
        exists: true,
        source: 'eslint in dependencies',
      };
    }
    if (deps['prettier']) {
      return {
        command: 'npx prettier --check .',
        exists: true,
        source: 'prettier in dependencies',
      };
    }
  }

  // 4. Fallback: tsc --noEmit for TypeScript projects
  if (fileExists(path.join(dirPath, 'tsconfig.json'))) {
    return {
      command: 'npx tsc --noEmit',
      exists: true,
      source: 'tsconfig.json (tsc --noEmit fallback)',
    };
  }

  return {
    command: '',
    exists: false,
    source: 'not detected',
  };
}

function detectTestCommand(dirPath: string, pkg: Record<string, unknown> | null): CommandInfo {
  // 1. Check package.json scripts.test
  if (pkg && pkg.scripts) {
    const scripts = pkg.scripts as Record<string, string>;
    if (scripts.test) {
      return {
        command: `npm test`,
        exists: true,
        source: 'package.json scripts.test',
      };
    }
  }

  // 2. Check test config files
  const testConfigs: Array<{ check: boolean; command: string; label: string }> = [
    {
      check: fileExists(path.join(dirPath, 'jest.config.js')) ||
             fileExists(path.join(dirPath, 'jest.config.ts')) ||
             fileExists(path.join(dirPath, 'jest.config.mjs')) ||
             fileExists(path.join(dirPath, 'jest.config.cjs')) ||
             fileExists(path.join(dirPath, 'jest.config.json')),
      command: 'npx jest',
      label: 'jest.config',
    },
    {
      check: fileExists(path.join(dirPath, 'vitest.config.ts')) ||
             fileExists(path.join(dirPath, 'vitest.config.js')),
      command: 'npx vitest run',
      label: 'vitest.config',
    },
    {
      check: fileExists(path.join(dirPath, '.mocharc.js')) ||
             fileExists(path.join(dirPath, '.mocharc.json')) ||
             fileExists(path.join(dirPath, '.mocharc.yaml')) ||
             fileExists(path.join(dirPath, '.mocharc.yml')),
      command: 'npx mocha',
      label: '.mocharc config',
    },
    {
      check: fileExists(path.join(dirPath, 'ava.config.js')) ||
             fileExists(path.join(dirPath, 'ava.config.cjs')),
      command: 'npx ava',
      label: 'ava.config',
    },
    {
      check: fileExists(path.join(dirPath, 'tape.config.js')),
      command: 'npx tape "test/**/*.js"',
      label: 'tape config',
    },
    {
      check: fileExists(path.join(dirPath, 'cypress.config.ts')) ||
             fileExists(path.join(dirPath, 'cypress.config.js')) ||
             fileExists(path.join(dirPath, 'cypress.json')),
      command: 'npx cypress run',
      label: 'cypress config',
    },
    {
      check: fileExists(path.join(dirPath, 'playwright.config.ts')) ||
             fileExists(path.join(dirPath, 'playwright.config.js')),
      command: 'npx playwright test',
      label: 'playwright.config',
    },
    {
      check: fileExists(path.join(dirPath, 'karma.conf.js')),
      command: 'npx karma start --single-run',
      label: 'karma.conf.js',
    },
    {
      check: fileExists(path.join(dirPath, 'pytest.ini')) ||
             fileExists(path.join(dirPath, 'pyproject.toml')) &&
             (() => {
               const content = readJsonFile(path.join(dirPath, 'pyproject.toml'));
               return content && 'tool' in (content as Record<string, unknown>) &&
                      'pytest' in ((content as Record<string, unknown>).tool as Record<string, unknown> || {});
             })(),
      command: 'python -m pytest',
      label: 'pytest config',
    },
    {
      check: fileExists(path.join(dirPath, 'go.mod')),
      command: 'go test ./...',
      label: 'go.mod',
    },
    {
      check: fileExists(path.join(dirPath, 'Cargo.toml')),
      command: 'cargo test',
      label: 'Cargo.toml',
    },
  ];

  for (const cfg of testConfigs) {
    if (cfg.check) {
      const baseCmd = cfg.command.split(/\s+/)[0];
      return {
        command: cfg.command,
        exists: commandExists(baseCmd) ||
                (cfg.command.startsWith('npx') && fileExists(path.join(dirPath, 'node_modules', '.bin', cfg.command.split(/\s+/)[1]))),
        source: cfg.label,
      };
    }
  }

  // 3. Check for test framework in dependencies
  if (pkg) {
    const deps = { ...(pkg.dependencies as Record<string, string> || {}), ...(pkg.devDependencies as Record<string, string> || {}) };
    if (deps['jest']) {
      return { command: 'npx jest', exists: true, source: 'jest in dependencies' };
    }
    if (deps['vitest']) {
      return { command: 'npx vitest run', exists: true, source: 'vitest in dependencies' };
    }
    if (deps['mocha']) {
      return { command: 'npx mocha', exists: true, source: 'mocha in dependencies' };
    }
    if (deps['ava']) {
      return { command: 'npx ava', exists: true, source: 'ava in dependencies' };
    }
    if (deps['cypress']) {
      return { command: 'npx cypress run', exists: true, source: 'cypress in dependencies' };
    }
    if (deps['@playwright/test']) {
      return { command: 'npx playwright test', exists: true, source: '@playwright/test in dependencies' };
    }
  }

  return {
    command: '',
    exists: false,
    source: 'not detected',
  };
}

function detectTypeCheckCommand(dirPath: string, pkg: Record<string, unknown> | null): CommandInfo {
  // 1. Check for tsconfig.json
  const tsconfigPath = path.join(dirPath, 'tsconfig.json');
  if (!fileExists(tsconfigPath)) {
    // Check for Flow
    if (fileExists(path.join(dirPath, '.flowconfig'))) {
      return {
        command: 'npx flow check',
        exists: true,
        source: '.flowconfig',
      };
    }
    // Check for Pyright/Pyre (Python type checking)
    if (fileExists(path.join(dirPath, 'pyproject.toml')) || fileExists(path.join(dirPath, 'setup.py'))) {
      if (fileExists(path.join(dirPath, 'mypy.ini')) || fileExists(path.join(dirPath, '.mypy.ini'))) {
        return {
          command: 'mypy .',
          exists: commandExists('mypy'),
          source: 'mypy config',
        };
      }
      return {
        command: '',
        exists: false,
        source: 'no type checker detected for Python project',
      };
    }
    return {
      command: '',
      exists: false,
      source: 'no tsconfig.json found (not a TypeScript project)',
    };
  }

  const tsconfig = readJsonFile(tsconfigPath);
  const noEmit = tsconfig && (tsconfig.compilerOptions as Record<string, unknown> | undefined)?.noEmit;

  const tscBin = path.join(dirPath, 'node_modules', '.bin', 'tsc');
  const tscExists = commandExists('tsc') || fileExists(tscBin);

  if (noEmit === true) {
    return {
      command: 'npx tsc',
      exists: tscExists,
      source: 'tsconfig.json (noEmit: true — direct type check)',
    };
  }

  if (noEmit === false || noEmit === undefined) {
    // tsc compiles AND type-checks by default — use --noEmit for pure type-checking
    return {
      command: 'npx tsc --noEmit',
      exists: tscExists,
      source: 'tsconfig.json (tsc --noEmit for pure type-check)',
    };
  }

  return {
    command: '',
    exists: tscExists,
    source: 'tsconfig.json found but noEmit is ambiguous',
  };
}

function detectIncrementalBuild(dirPath: string, pkg: Record<string, unknown> | null, buildCmd: CommandInfo): IncrementalBuildInfo {
  // Default: build command may already support incremental
  const result: IncrementalBuildInfo = {
    command: buildCmd.command,
    exists: buildCmd.exists,
    source: buildCmd.source,
    incrementalFlag: null,
    supportsIncremental: false,
  };

  // Check for TypeScript incremental
  if (fileExists(path.join(dirPath, 'tsconfig.json'))) {
    const tsconfig = readJsonFile(path.join(dirPath, 'tsconfig.json'));
    if (tsconfig) {
      const compilerOptions = tsconfig.compilerOptions as Record<string, unknown> | undefined;
      if (compilerOptions?.incremental === true) {
        result.incrementalFlag = 'tsc --incremental';
        result.supportsIncremental = true;
        result.source = 'tsconfig.json compilerOptions.incremental: true';
        result.command = 'npx tsc --incremental';
        return result;
      }
    }
  }

  // Check for webpack watch mode / caching
  if (fileExists(path.join(dirPath, 'webpack.config.js')) || fileExists(path.join(dirPath, 'webpack.config.ts'))) {
    result.incrementalFlag = 'webpack --watch';
    result.supportsIncremental = true;
    result.source = 'webpack.config — supports watch mode';
    return result;
  }

  // Check for Vite (always incremental/snappy)
  if (fileExists(path.join(dirPath, 'vite.config.ts')) || fileExists(path.join(dirPath, 'vite.config.js'))) {
    result.incrementalFlag = null; // Vite is inherently incremental
    result.supportsIncremental = true;
    result.source = 'vite.config — inherently incremental';
    return result;
  }

  // Check for Next.js (incremental by design)
  if (fileExists(path.join(dirPath, 'next.config.js')) || fileExists(path.join(dirPath, 'next.config.mjs'))) {
    result.supportsIncremental = true;
    result.source = 'next.config — Next.js uses incremental compilation';
    return result;
  }

  // Check for Turbo repo
  if (fileExists(path.join(dirPath, 'turbo.json'))) {
    result.incrementalFlag = 'turbo --cache-dir';
    result.supportsIncremental = true;
    result.source = 'turbo.json — Turborepo caching';
    return result;
  }

  // Check for Nx
  if (fileExists(path.join(dirPath, 'nx.json'))) {
    result.supportsIncremental = true;
    result.source = 'nx.json — Nx computation caching';
    return result;
  }

  return result;
}

// ── Caching ────────────────────────────────────────────────────────

interface CacheEntry {
  hash: string;
  result: DetectionResult;
  timestamp: string;
}

function computeDirHash(dirPath: string): string {
  // Compute a lightweight hash of key config files
  const hashInput: string[] = [];
  const filesToHash = [
    'package.json',
    'tsconfig.json',
    'webpack.config.js',
    'vite.config.ts',
    'next.config.js',
    'Makefile',
    'Cargo.toml',
    'pyproject.toml',
    'go.mod',
  ];

  for (const file of filesToHash) {
    const fullPath = path.join(dirPath, file);
    if (fileExists(fullPath)) {
      try {
        const stat = fs.statSync(fullPath);
        hashInput.push(`${file}:${stat.mtimeMs}:${stat.size}`);
      } catch {
        hashInput.push(`${file}:unreadable`);
      }
    }
  }

  return hashInput.join('|');
}

function getCachePath(dirPath: string): string {
  const opencodeDir = path.join(dirPath, '.opencode');
  return path.join(opencodeDir, '.command-cache.json');
}

function readCache(dirPath: string, dirHash: string): DetectionResult | null {
  try {
    const cachePath = getCachePath(dirPath);
    if (!fileExists(cachePath)) return null;
    const raw = fs.readFileSync(cachePath, 'utf-8');
    const cache: CacheEntry = JSON.parse(raw);
    if (cache.hash === dirHash) {
      return cache.result;
    }
    return null;
  } catch {
    return null;
  }
}

function writeCache(dirPath: string, dirHash: string, result: DetectionResult): void {
  try {
    const cachePath = getCachePath(dirPath);
    const cacheDir = path.dirname(cachePath);
    if (!fileExists(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    const entry: CacheEntry = {
      hash: dirHash,
      result,
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(cachePath, JSON.stringify(entry, null, 2), 'utf-8');
  } catch {
    // Cache write failure is non-fatal
  }
}

// ── Main Entry Point ───────────────────────────────────────────────

function detect(dirPath: string, useCache: boolean): DetectionResult {
  // Resolve the directory
  const resolvedPath = path.resolve(dirPath);

  // Directory existence check
  if (!fileExists(resolvedPath)) {
    process.stderr.write(`Error: Directory not found: ${resolvedPath}\n`);
    process.exit(1);
  }

  // Ensure it's a directory
  try {
    if (!fs.statSync(resolvedPath).isDirectory()) {
      process.stderr.write(`Error: Not a directory: ${resolvedPath}\n`);
      process.exit(1);
    }
  } catch {
    process.stderr.write(`Error: Cannot access: ${resolvedPath}\n`);
    process.exit(1);
  }

  // Cache check
  if (useCache) {
    const dirHash = computeDirHash(resolvedPath);
    const cached = readCache(resolvedPath, dirHash);
    if (cached) return cached;
  }

  // Read package.json
  const pkg = readJsonFile(path.join(resolvedPath, 'package.json'));

  // Detect project type
  const projectType = detectProjectType(resolvedPath, pkg);

  // Detect commands
  const build = detectBuildCommand(resolvedPath, pkg);
  const lint = detectLintCommand(resolvedPath, pkg);
  const test = detectTestCommand(resolvedPath, pkg);
  const typeCheck = detectTypeCheckCommand(resolvedPath, pkg);
  const incrementalBuild = detectIncrementalBuild(resolvedPath, pkg, build);

  // Detect framework
  const projectFramework = detectFramework(resolvedPath, pkg);

  // Project info summary
  const projectInfo = {
    hasPackageJson: pkg !== null,
    hasTsConfig: fileExists(path.join(resolvedPath, 'tsconfig.json')),
    dependencies: pkg ? Object.keys(pkg.dependencies as Record<string, string> || {}).length : 0,
    devDependencies: pkg ? Object.keys(pkg.devDependencies as Record<string, string> || {}).length : 0,
  };

  const result: DetectionResult = {
    projectType,
    build,
    lint,
    test,
    typeCheck,
    incrementalBuild,
    projectFramework,
    projectInfo,
  };

  // Write to cache if requested
  if (useCache) {
    const dirHash = computeDirHash(resolvedPath);
    writeCache(resolvedPath, dirHash, result);
  }

  return result;
}

function verifyCommands(result: DetectionResult, dirPath: string): DetectionResult {
  const verified = JSON.parse(JSON.stringify(result)) as DetectionResult;

  for (const key of ['build', 'lint', 'test', 'typeCheck', 'incrementalBuild'] as const) {
    const cmd = verified[key];
    if (cmd && cmd.command) {
      cmd.exists = commandExists(cmd.command) || doesNpxToolExist(cmd.command, dirPath);
    }
  }

  return verified;
}

function doesNpxToolExist(fullCommand: string, dirPath: string): boolean {
  if (!fullCommand.startsWith('npx ')) return false;
  const tool = fullCommand.split(/\s+/)[1];
  if (!tool) return false;
  return fileExists(path.join(dirPath, 'node_modules', '.bin', tool));
}

function formatOutput(result: DetectionResult, format: 'json' | 'yaml', brief: boolean): string {
  if (brief) {
    // Brief mode: only output the commands
    const briefResult: Record<string, string | null> = {};
    for (const key of ['build', 'lint', 'test', 'typeCheck'] as const) {
      const cmd = result[key];
      briefResult[key] = cmd && cmd.command ? cmd.command : null;
    }
    briefResult['projectType'] = result.projectType;
    if (format === 'yaml') {
      return Object.entries(briefResult).map(([k, v]) => `${k}: ${v ?? 'null'}`).join('\n');
    }
    return JSON.stringify(briefResult, null, 2);
  }

  if (format === 'yaml') {
    return `projectType: ${result.projectType}
build:
  command: ${result.build.command || '""'}
  exists: ${result.build.exists}
  source: "${result.build.source}"
lint:
  command: ${result.lint.command || '""'}
  exists: ${result.lint.exists}
  source: "${result.lint.source}"
test:
  command: ${result.test.command || '""'}
  exists: ${result.test.exists}
  source: "${result.test.source}"
typeCheck:
  command: ${result.typeCheck.command || '""'}
  exists: ${result.typeCheck.exists}
  source: "${result.typeCheck.source}"
incrementalBuild:
  command: ${result.incrementalBuild.command || '""'}
  exists: ${result.incrementalBuild.exists}
  source: "${result.incrementalBuild.source}"
  incrementalFlag: ${result.incrementalBuild.incrementalFlag || 'null'}
  supportsIncremental: ${result.incrementalBuild.supportsIncremental}
projectFramework:
  name: ${result.projectFramework?.name || 'null'}
  version: ${result.projectFramework?.version || 'null'}
  detectedBy: "${result.projectFramework?.detectedBy || 'null'}"
projectInfo:
  hasPackageJson: ${result.projectInfo.hasPackageJson}
  hasTsConfig: ${result.projectInfo.hasTsConfig}
  dependencies: ${result.projectInfo.dependencies}
  devDependencies: ${result.projectInfo.devDependencies}`;
  }

  return JSON.stringify(result, null, 2);
}

// ── Entry Point ────────────────────────────────────────────────────

function main(): void {
  const options = parseArgs();

  try {
    let result = detect(options.dir, options.cache);

    if (options.verify) {
      result = verifyCommands(result, options.dir);
    }

    const output = formatOutput(result, options.format, options.brief);
    console.log(output);
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error detecting project commands: ${message}\n`);
    process.exit(1);
  }
}

main();
