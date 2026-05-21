#!/usr/bin/env node
/**
 * Supply Chain Security Checker
 *
 * Usage: ts-node check-supply-chain.ts [--dir=<project-dir>] [--verbose]
 *
 * Checks for:
 * - Lockfile integrity
 * - Install script detection (HIGH severity - blocks pipeline)
 * - Typosquatting detection (MEDIUM severity)
 * - Package age check (new packages < 30 days, stale > 2 years)
 * - Deprecated package detection (MEDIUM severity)
 * - Dependency count analysis
 *
 * Exit codes:
 * - 0: Pass or warnings only
 * - 1: Install scripts detected (HIGH severity — block pipeline)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Packages known to be legitimate (should not be flagged by typosquatting)
const KNOWN_LEGITIMATE_PACKAGES: Set<string> = new Set([
  'node', 'acorn', 'yn', 'tap', 'ava', 'ws', 'pg', 'ini', 'ky',
  'd3', 'got', 'yup', 'morgan', 'mime', 'ora', 'del', 'cpy',
  'colors', 'semver', 'debug', 'which', 'arg',
]);

const TOP_200_PACKAGES: string[] = [
  'express', 'lodash', 'react', 'vue', 'axios', 'moment', 'chalk', 'cors',
  'dotenv', 'uuid', 'body-parser', 'typescript', 'eslint', 'prettier', 'jest',
  'webpack', 'babel', 'redis', 'mongoose', 'passport', 'jsonwebtoken', 'bcrypt',
  'socket.io', 'commander', 'winston', 'nodemailer', 'sharp', 'helmet', 'joi',
  'zod', 'date-fns', 'dayjs',
  'next', 'nuxt', 'gatsby', 'svelte', 'angular', 'ember', 'backbone',
  'underscore', 'ramda', 'rxjs', 'immer', 'redux', 'mobx', 'zustand',
  'styled-components', 'emotion', 'tailwindcss', 'bootstrap', 'jquery',
  'd3', 'chart.js', 'echarts', 'three', 'phaser', 'pixi.js',
  'cheerio', 'puppeteer', 'playwright', 'selenium-webdriver', 'cypress',
  'mocha', 'ava', 'tap', 'nyc', 'sinon', 'chai', 'enzyme', 'testing-library',
  'nodemon', 'ts-node', 'ts-loader', 'tslib', 'core-js', 'regenerator-runtime',
  'postcss', 'autoprefixer', 'sass', 'less', 'stylus',
  'webpack-cli', 'webpack-dev-server', 'webpack-merge', 'html-webpack-plugin',
  'mini-css-extract-plugin', 'css-loader', 'style-loader', 'file-loader',
  'url-loader', 'babel-loader', 'ts-loader', 'esbuild', 'rollup', 'parcel',
  'vite', 'vitest', 'playwright-test',
  'express-validator', 'express-session', 'cookie-parser', 'morgan',
  'compression', 'serve-static', 'connect-redis', 'express-rate-limit',
  'helmet-csp', 'csurf', 'cors-anywhere',
  'passport-local', 'passport-jwt', 'passport-oauth2', 'passport-google-oauth20',
  'passport-facebook', 'passport-github2',
  'sequelize', 'knex', 'prisma', 'typeorm', 'drizzle-orm', 'mikro-orm',
  'pg', 'mysql2', 'sqlite3', 'mongodb', 'ioredis', 'redis-commander',
  'amqplib', 'kafkajs', 'bull', 'bee-queue', 'agenda',
  'graphql', 'apollo-server', 'apollo-client', 'relay', 'urql',
  'express-graphql', 'graphql-tag', 'graphql-tools',
  'swagger-jsdoc', 'swagger-ui-express', 'openapi-types',
  'aws-sdk', '@aws-sdk/client-s3', '@google-cloud/storage', 'firebase-admin',
  'firebase', 'supabase', 'stripe', 'paypal-rest-sdk',
  'socket.io-client', 'ws', 'uWebSockets.js',
  'i18next', 'react-i18next', 'react-intl',
  'formik', 'react-hook-form', 'react-final-form', 'yup',
  'react-router', 'react-router-dom', 'react-query', '@tanstack/react-query',
  'react-helmet', 'react-helmet-async', 'react-portal',
  'redux-thunk', 'redux-saga', 'redux-observable', 'reselect',
  'immer', 'use-immer', 'react-redux', 'react-dnd',
  'material-ui', '@mui/material', '@mui/icons-material', '@emotion/react',
  '@emotion/styled', 'antd', '@ant-design/icons', 'semantic-ui-react',
  'chakra-ui', '@chakra-ui/react', 'radix-ui',
  'framer-motion', 'react-spring', 'gsap', 'animejs',
  'react-table', 'ag-grid-community', 'ag-grid-react',
  'react-select', 'react-dropzone', 'react-datepicker',
  'react-quill', 'draft-js', 'slate', 'tiptap',
  'react-toastify', 'notistack', 'sweetalert2',
  'react-virtualized', 'react-window', 'react-lazyload',
  'immer', 'use-sync-external-store', 'nanoid', 'clsx',
  'classnames', 'prop-types', 'react-is',
  'luxon', 'chrono-node', 'rrule', 'cron-parser',
  'lodash-es', 'hashids', 'cuid', 'ulid',
  'debug', 'log4js', 'pino', 'bunyan', 'signale',
  'ora', 'listr2', 'enquirer', 'prompts', 'inquirer',
  'config', 'convict', 'env-var', 'cross-env',
  'rimraf', 'fs-extra', 'globby', 'del', 'cpy',
  'minimist', 'yargs', 'meow', 'arg',
  'semver', 'compare-versions', 'update-notifier',
  'husky', 'lint-staged', 'commitlint', 'cz-conventional-changelog',
  'cross-spawn', 'execa', 'which', 'shelljs',
  'node-fetch', 'got', 'ky', 'undici',
  'js-yaml', 'toml', 'ini', 'dotenv-expand',
  'colors', 'colorette', 'kleur', 'picocolors',
  'mime', 'mime-types', 'content-type',
  'morgan', 'morgan-body', 'bytes', 'accepts',
  'zod', 'superstruct', 'io-ts', 'runtypes',
];

const DEPRECATED_PACKAGES: Record<string, string> = {
  'request': 'Use node-fetch, got, or axios instead',
  'left-pad': 'Use String.prototype.padStart()',
  'gulp-util': 'Use individual gulp plugins',
  'node-uuid': 'Use uuid package',
  'jade': 'Renamed to pug',
  'popper.js': 'Use @popperjs/core',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InstallScriptIssue {
  packageName: string;
  version: string;
  hasInstallScript: boolean;
}

interface TyposquattingIssue {
  packageName: string;
  similarTo: string;
  distance: number;
}

interface NewPackageIssue {
  packageName: string;
  publishedDate: string;
  daysAgo: number;
}

interface DeprecatedPackageIssue {
  packageName: string;
  replacement: string;
}

interface StalePackageIssue {
  packageName: string;
  lastUpdated: string;
}

interface Report {
  projectDir: string;
  directDeps: number;
  transitiveDeps: number;
  lockfilePresent: boolean;
  lockfileVersion: number | null;
  installScripts: InstallScriptIssue[];
  typosquatting: TyposquattingIssue[];
  newPackages: NewPackageIssue[];
  deprecated: DeprecatedPackageIssue[];
  stalePackages: StalePackageIssue[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function verboseLog(msg: string, verbose: boolean): void {
  if (verbose) console.error(`[verbose] ${msg}`);
}

/**
 * Compute Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

/**
 * Run `npm view` to get package metadata. Returns parsed JSON or null.
 */
function npmView(pkgName: string, verbose: boolean): Record<string, any> | null {
  try {
    const result = execSync(`npm view "${pkgName}" --json 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(result);
  } catch {
    verboseLog(`npm view failed for ${pkgName}`, verbose);
    return null;
  }
}

function padRight(s: string, len: number): string {
  if (s.length >= len) return s;
  return s + ' '.repeat(len - s.length);
}

// ---------------------------------------------------------------------------
// Core checks
// ---------------------------------------------------------------------------

/**
 * Validate that an npm integrity hash is correctly formatted using crypto.
 * Logs a warning for malformed hashes.
 */
function tryValidateIntegrityHash(integrity: string, pkgPath: string, warnings: string[]): void {
  // integrity format: <algorithm>-<base64hash>
  const parts = integrity.split('-');
  if (parts.length !== 2) {
    warnings.push(`Malformed integrity hash format for ${pkgPath}: ${integrity}`);
    return;
  }
  const algorithm = parts[0];
  // Validate the algorithm is a known hash algorithm
  const validAlgorithms = ['sha512', 'sha384', 'sha256', 'sha1', 'md5'];
  if (!validAlgorithms.includes(algorithm)) {
    warnings.push(`Unknown integrity hash algorithm for ${pkgPath}: ${algorithm}`);
    return;
  }
  // Verify the algorithm is supported by Node.js crypto
  if (!crypto.getHashes().includes(algorithm)) {
    warnings.push(`Crypto algorithm not supported for ${pkgPath}: ${algorithm}`);
  }
}

function checkLockfile(projectDir: string): { ok: boolean; version: number | null; warnings: string[] } {
  const warnings: string[] = [];
  const lockfilePath = path.join(projectDir, 'package-lock.json');
  const nodeModulesLockfilePath = path.join(projectDir, 'node_modules', '.package-lock.json');

  if (!fs.existsSync(lockfilePath)) {
    warnings.push('package-lock.json not found — supply chain integrity cannot be verified');
    return { ok: false, version: null, warnings };
  }

  let lockfileContent: string;
  try {
    lockfileContent = fs.readFileSync(lockfilePath, 'utf-8');
  } catch {
    warnings.push('package-lock.json exists but could not be read');
    return { ok: false, version: null, warnings };
  }

  if (lockfileContent.trim().length === 0) {
    warnings.push('package-lock.json is empty');
    return { ok: false, version: null, warnings };
  }

  let lockfile: Record<string, any>;
  try {
    lockfile = JSON.parse(lockfileContent);
  } catch {
    warnings.push('package-lock.json contains invalid JSON');
    return { ok: false, version: null, warnings };
  }

  const version = lockfile.lockfileVersion ?? null;
  if (version === null) {
    warnings.push('package-lock.json has no lockfileVersion field');
  } else if (version < 2) {
    warnings.push(`Lockfile version ${version} — v2 or v3 is recommended`);
  }

  // Compare integrity fields with node_modules/.package-lock.json if present
  if (fs.existsSync(nodeModulesLockfilePath)) {
    try {
      const nmLockfileContent = fs.readFileSync(nodeModulesLockfilePath, 'utf-8');
      const nmLockfile = JSON.parse(nmLockfileContent);
      const nmPackages = nmLockfile.packages || {};

      if (lockfile.packages) {
        for (const [pkgPath, pkgData] of Object.entries(lockfile.packages) as [string, any][]) {
          if (pkgPath === '') continue;
          const nmPkg = nmPackages[pkgPath];
          if (nmPkg && pkgData.integrity && nmPkg.integrity && pkgData.integrity !== nmPkg.integrity) {
            warnings.push(`Integrity mismatch for ${pkgPath}: ${pkgData.integrity} (lockfile) vs ${nmPkg.integrity} (node_modules)`);
          }
          // Verify integrity hash format using crypto
          if (nmPkg && nmPkg.integrity && typeof nmPkg.integrity === 'string') {
            tryValidateIntegrityHash(nmPkg.integrity, pkgPath, warnings);
          }
        }
      }
    } catch {
      verboseLog('Could not compare integrity with node_modules/.package-lock.json', false);
    }
  }

  return { ok: warnings.length === 0, version, warnings };
}

function checkInstallScripts(projectDir: string): { installScripts: InstallScriptIssue[]; warnings: string[] } {
  const installScripts: InstallScriptIssue[] = [];
  const warnings: string[] = [];
  const lockfilePath = path.join(projectDir, 'package-lock.json');

  if (!fs.existsSync(lockfilePath)) return { installScripts, warnings };

  let lockfile: Record<string, any>;
  try {
    lockfile = JSON.parse(fs.readFileSync(lockfilePath, 'utf-8'));
  } catch {
    return { installScripts, warnings };
  }

  const packages = lockfile.packages || {};
  for (const [pkgPath, pkgData] of Object.entries(packages) as [string, any][]) {
    if (pkgPath === '') continue;
    const hasInstallScript = pkgData.hasInstallScript === true;
    // Also check for explicit install script commands
    const hasScripts = pkgData.scripts && typeof pkgData.scripts === 'object' && Object.keys(pkgData.scripts).length > 0;
    if (hasInstallScript || hasScripts) {
      const pkgName = pkgPath.replace(/^node_modules\//, '');
      const version = pkgData.version || 'unknown';
      installScripts.push({
        packageName: pkgName,
        version,
        hasInstallScript: true,
      });
    }
  }

  verboseLog(`Found ${installScripts.length} packages with install scripts`, true);
  return { installScripts, warnings };
}

function checkTyposquatting(packageNames: string[]): TyposquattingIssue[] {
  const issues: TyposquattingIssue[] = [];
  const seen = new Set<string>();

  for (const pkg of packageNames) {
    // Skip known legitimate packages and exact matches
    if (KNOWN_LEGITIMATE_PACKAGES.has(pkg)) continue;
    if (TOP_200_PACKAGES.includes(pkg)) continue;

    // Skip very short names (3 chars or less) at distance 2 — too many false positives
    const minDistance = pkg.length <= 3 ? 1 : 1;

    for (const popular of TOP_200_PACKAGES) {
      if (popular === pkg) continue;
      // Also skip if popular is known-legitimate
      if (KNOWN_LEGITIMATE_PACKAGES.has(popular)) continue;
      const dist = levenshteinDistance(pkg, popular);
      if (dist >= minDistance && dist <= 2 && !seen.has(`${pkg}->${popular}`)) {
        issues.push({ packageName: pkg, similarTo: popular, distance: dist });
        seen.add(`${pkg}->${popular}`);
      }
    }
  }

  return issues;
}

function checkPackageAges(packageNames: string[], verbose: boolean): { newPackages: NewPackageIssue[]; stalePackages: StalePackageIssue[] } {
  const newPackages: NewPackageIssue[] = [];
  const stalePackages: StalePackageIssue[] = [];
  const now = Date.now();

  // Skip packages that are known to be non-npm packages or Node.js built-ins
  const skipPackages = new Set(['node', 'buffer', 'stream', 'util', 'path', 'fs', 'crypto', 'http', 'https', 'net', 'tls', 'os', 'child_process', 'events']);

  for (const pkg of packageNames) {
    if (skipPackages.has(pkg)) continue;
    const metadata = npmView(pkg, verbose);
    if (!metadata) continue;

    // Check last version publish time
    const time = metadata.time;
    if (time && typeof time === 'object') {
      // Find the most recent version publish time
      let latestTime: string | null = null;
      for (const [ver, t] of Object.entries(time) as [string, any][]) {
        if (ver === 'created' || ver === 'modified') continue;
        if (!latestTime || new Date(t).getTime() > new Date(latestTime).getTime()) {
          latestTime = t;
        }
      }

      if (latestTime) {
        const publishedMs = new Date(latestTime).getTime();
        const daysAgo = Math.floor((now - publishedMs) / (1000 * 60 * 60 * 24));

        if (daysAgo < 30) {
          newPackages.push({
            packageName: pkg,
            publishedDate: latestTime,
            daysAgo,
          });
        }

        if (daysAgo > 365 * 2) {
          stalePackages.push({
            packageName: pkg,
            lastUpdated: latestTime,
          });
        }
      }
    }
  }

  return { newPackages, stalePackages };
}

function checkDeprecatedPackages(packageNames: string[]): DeprecatedPackageIssue[] {
  const issues: DeprecatedPackageIssue[] = [];
  for (const pkg of packageNames) {
    if (DEPRECATED_PACKAGES[pkg]) {
      issues.push({ packageName: pkg, replacement: DEPRECATED_PACKAGES[pkg] });
    }
  }
  return issues;
}

function countDependencies(projectDir: string): { direct: number; transitive: number } {
  const packageJsonPath = path.join(projectDir, 'package.json');
  const lockfilePath = path.join(projectDir, 'package-lock.json');

  let direct = 0;
  let transitive = 0;

  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}), ...(pkg.peerDependencies || {}) };
      direct = Object.keys(deps).length;
    } catch { /* ignore */ }
  }

  if (fs.existsSync(lockfilePath)) {
    try {
      const lockfile = JSON.parse(fs.readFileSync(lockfilePath, 'utf-8'));
      const pkgs = lockfile.packages || {};
      transitive = Object.keys(pkgs).filter(k => k !== '').length;
    } catch { /* ignore */ }
  }

  // transitive = total - direct (rough estimate; total includes root + direct + transitive)
  // More accurate: transitive = total - 1 (root) - direct
  if (transitive > 0) {
    transitive = transitive - direct - 1;
    if (transitive < 0) transitive = 0;
  }

  return { direct, transitive };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const rootDir = args.find(a => a.startsWith('--dir='))?.split('=')[1] || process.cwd();
  const verbose = args.some(a => a === '--verbose');

  const resolvedDir = path.resolve(rootDir);
  verboseLog(`Scanning project: ${resolvedDir}`, verbose);

  // Validate the target directory exists
  if (!fs.existsSync(resolvedDir)) {
    console.error(`❌ Project directory does not exist: ${resolvedDir}`);
    process.exit(1);
  }

  // -- Gather data -----------------------------------------------------------

  // 1. Lockfile integrity
  verboseLog('Checking lockfile integrity...', verbose);
  const lockfileResult = checkLockfile(resolvedDir);
  if (lockfileResult.warnings.length > 0) {
    verboseLog(`Lockfile warnings: ${lockfileResult.warnings.join('; ')}`, verbose);
  }

  // 2. Install scripts
  verboseLog('Checking for install scripts...', verbose);
  const installScriptResult = checkInstallScripts(resolvedDir);

  // 3. Dependency counts
  verboseLog('Counting dependencies...', verbose);
  const depCounts = countDependencies(resolvedDir);

  // 4. Collect package names (from package.json dependencies + packages in lockfile)
  verboseLog('Collecting package names for analysis...', verbose);
  const allPackageNames: string[] = [];

  // Read package.json deps
  const packageJsonPath = path.join(resolvedDir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      for (const name of Object.keys(deps)) {
        // Strip scope for comparison, but keep it for display
        const simpleName = name.startsWith('@') ? name.split('/')[1] : name;
        allPackageNames.push(simpleName);
      }
    } catch { /* ignore */ }
  }

  // Also get package names from lockfile for typosquatting check
  const lockfilePath = path.join(resolvedDir, 'package-lock.json');
  if (fs.existsSync(lockfilePath)) {
    try {
      const lockfile = JSON.parse(fs.readFileSync(lockfilePath, 'utf-8'));
      const pkgs = lockfile.packages || {};
      for (const pkgPath of Object.keys(pkgs)) {
        if (pkgPath === '' || pkgPath === 'node_modules') continue;
        const name = pkgPath.replace(/^node_modules\//, '');
        // Remove scope prefix for comparison
        const simpleName = name.startsWith('@') ? name.split('/')[1] || name : name;
        // Split on / to handle nested scoped packages like @scope/name
        if (!simpleName.includes('/') && !allPackageNames.includes(simpleName)) {
          allPackageNames.push(simpleName);
        }
      }
    } catch { /* ignore */ }
  }

  // Deduplicate
  const uniqueNames = [...new Set(allPackageNames)];

  // 5. Typosquatting
  verboseLog('Checking for typosquatting...', verbose);
  const typosquattingIssues = checkTyposquatting(uniqueNames);

  // 6. Deprecated packages
  verboseLog('Checking for deprecated packages...', verbose);
  const deprecatedIssues = checkDeprecatedPackages(uniqueNames);

  // 7. Package age (only check direct deps to avoid rate limiting / slowness)
  verboseLog('Checking package ages...', verbose);
  const directDepNames: string[] = [];
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      for (const name of Object.keys(deps)) {
        const simpleName = name.startsWith('@') ? name.split('/')[1] : name;
        directDepNames.push(simpleName);
      }
    } catch { /* ignore */ }
  }
  const { newPackages, stalePackages } = checkPackageAges([...new Set(directDepNames)], verbose);

  // -- Build report ----------------------------------------------------------

  const report: Report = {
    projectDir: resolvedDir,
    directDeps: depCounts.direct,
    transitiveDeps: depCounts.transitive,
    lockfilePresent: fs.existsSync(lockfilePath),
    lockfileVersion: lockfileResult.version,
    installScripts: installScriptResult.installScripts,
    typosquatting: typosquattingIssues,
    newPackages,
    deprecated: deprecatedIssues,
    stalePackages,
    warnings: lockfileResult.warnings,
  };

  // -- Output ----------------------------------------------------------------

  const hasInstallScripts = report.installScripts.length > 0;
  const hasTyposquatting = report.typosquatting.length > 0;
  const hasNewPackages = report.newPackages.length > 0;
  const hasDeprecated = report.deprecated.length > 0;
  const hasStale = report.stalePackages.length > 0;
  const hasLockfileWarnings = report.warnings.length > 0;
  const highDepCount = report.transitiveDeps > 500;

  console.log('## Supply Chain Security Report');
  console.log('');
  console.log(`### Project: ${report.projectDir}`);
  console.log(`- Dependencies: ${report.directDeps} direct, ${report.transitiveDeps} transitive`);
  console.log(`- Lockfile: ${report.lockfilePresent ? '✅ Present' : '❌ Missing'}`);
  if (report.lockfileVersion !== null) {
    console.log(`- Lockfile version: v${report.lockfileVersion}`);
  }

  if (report.warnings.length > 0) {
    console.log('');
    console.log('### Lockfile Warnings');
    for (const w of report.warnings) {
      console.log(`- ⚠️ ${w}`);
    }
  }

  if (hasInstallScripts) {
    console.log('');
    console.log('### Install Scripts (HIGH)');
    console.log(`| ${padRight('Package', 30)} | ${padRight('Version', 15)} |`);
    console.log(`|${'-'.repeat(32)}|${'-'.repeat(17)}|`);
    for (const iss of report.installScripts) {
      console.log(`| ${padRight(iss.packageName, 30)} | ${padRight(iss.version, 15)} |`);
    }
  }

  if (hasTyposquatting) {
    console.log('');
    console.log('### Typosquatting Warnings (MEDIUM)');
    console.log(`| ${padRight('Package', 30)} | ${padRight('Similar To', 25)} | Distance |`);
    console.log(`|${'-'.repeat(32)}|${'-'.repeat(27)}|----------|`);
    for (const ts of report.typosquatting) {
      console.log(`| ${padRight(ts.packageName, 30)} | ${padRight(ts.similarTo, 25)} | ${ts.distance}        |`);
    }
  }

  if (hasNewPackages) {
    console.log('');
    console.log('### New Packages (< 30 days old) (MEDIUM)');
    console.log(`| ${padRight('Package', 30)} | ${padRight('Published', 25)} | Days Ago |`);
    console.log(`|${'-'.repeat(32)}|${'-'.repeat(27)}|----------|`);
    for (const np of report.newPackages) {
      console.log(`| ${padRight(np.packageName, 30)} | ${padRight(np.publishedDate, 25)} | ${String(np.daysAgo).padStart(8)} |`);
    }
  }

  if (hasDeprecated) {
    console.log('');
    console.log('### Deprecated Packages (MEDIUM)');
    console.log(`| ${padRight('Package', 20)} | Replacement`);
    console.log(`|${'-'.repeat(22)}|${'-'.repeat(40)}|`);
    for (const dp of report.deprecated) {
      console.log(`| ${padRight(dp.packageName, 20)} | ${dp.replacement}`);
    }
  }

  if (hasStale) {
    console.log('');
    console.log('### Stale Packages (> 2 years) (LOW)');
    console.log(`| ${padRight('Package', 30)} | Last Updated`);
    console.log(`|${'-'.repeat(32)}|${'-'.repeat(30)}|`);
    for (const sp of report.stalePackages) {
      console.log(`| ${padRight(sp.packageName, 30)} | ${sp.lastUpdated}`);
    }
  }

  if (highDepCount) {
    console.log('');
    console.log('### Dependency Count Warning');
    console.log(`⚠️ Transitive dependency count (${report.transitiveDeps}) exceeds 500 — high attack surface`);
  }

  // -- Verdict ---------------------------------------------------------------

  if (hasInstallScripts) {
    console.log('');
    console.log('❌ FAIL — Install scripts detected (review required)');
    process.exit(1);
  }

  if (hasTyposquatting || hasDeprecated || hasLockfileWarnings || highDepCount || hasNewPackages) {
    console.log('');
    console.log('⚠️ WARN — Issues found (non-blocking)');
    process.exit(0);
  }

  if (hasStale) {
    console.log('');
    console.log('⚠️ WARN — Stale packages found (non-blocking)');
    process.exit(0);
  }

  console.log('');
  console.log('✅ PASS — No supply chain issues found');
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
