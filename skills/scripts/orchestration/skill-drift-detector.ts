#!/usr/bin/env node
/**
 * Skill Drift Detector
 *
 * Detects when skills have drifted from their locked hashes by
 * re-computing SHA-256 hashes of each skill's SKILL.md file and
 * comparing against the locked hashes in skills-lock.json.
 *
 * Usage:
 *   [noderuntime] skill-drift-detector.ts --check
 *   [noderuntime] skill-drift-detector.ts --report
 *   [noderuntime] skill-drift-detector.ts --update-lock
 *   [noderuntime] skill-drift-detector.ts --check-skill=<skill-name>
 *
 * Exit codes:
 *   0 = all clean (no drift)
 *   1 = error or warnings
 *   2 = drift detected
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ── Constants ──────────────────────────────────────────────────────

const SKILLS_LOCK_FILE = 'skills-lock.json';
const SKILLS_DIR = 'skills';
const WORKSPACE_ROOT = process.cwd();

// ── Types ──────────────────────────────────────────────────────────

interface Args {
  check?: boolean;
  report?: boolean;
  updateLock?: boolean;
  checkSkill?: string;
}

interface SkillLockEntry {
  source?: string;
  sourceType?: string;
  skillPath: string;
  computedHash: string;
}

interface SkillsLock {
  version?: number;
  skills: Record<string, SkillLockEntry>;
}

interface DriftResult {
  skillName: string;
  skillPath: string;
  lockedHash: string;
  computedHash: string;
  drifted: boolean;
  fileExists: boolean;
  error?: string;
}

// ── Helpers ────────────────────────────────────────────────────────

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  const args: Args = {};
  for (const a of raw) {
    if (a === '--check') { args.check = true; continue; }
    if (a === '--report') { args.report = true; continue; }
    if (a === '--update-lock') { args.updateLock = true; continue; }
    if (a.startsWith('--check-skill=')) { args.checkSkill = a.split('=')[1]; continue; }
  }
  return args;
}

function computeSha256(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
  } catch {
    return null;
  }
}

function readSkillsLock(): SkillsLock | null {
  const lockPath = path.join(WORKSPACE_ROOT, SKILLS_LOCK_FILE);
  if (!fs.existsSync(lockPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as SkillsLock;
  } catch {
    return null;
  }
}

function writeSkillsLock(lock: SkillsLock): boolean {
  const lockPath = path.join(WORKSPACE_ROOT, SKILLS_LOCK_FILE);
  try {
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf-8');
    return true;
  } catch (e) {
    console.error(`Error writing ${SKILLS_LOCK_FILE}: ${(e as Error).message}`);
    return false;
  }
}

function resolveSkillPath(skillPath: string): string {
  // skillPath could be relative like "skills/accessibility/SKILL.md"
  // Or absolute already
  if (path.isAbsolute(skillPath)) return skillPath;
  return path.join(WORKSPACE_ROOT, skillPath);
}

// ── Check ──────────────────────────────────────────────────────────

function checkSingleSkill(
  skillName: string,
  entry: SkillLockEntry,
): DriftResult {
  const fullPath = resolveSkillPath(entry.skillPath);
  const fileExists = fs.existsSync(fullPath);

  if (!fileExists) {
    return {
      skillName,
      skillPath: entry.skillPath,
      lockedHash: entry.computedHash,
      computedHash: '',
      drifted: true,
      fileExists: false,
      error: 'File not found',
    };
  }

  const computedHash = computeSha256(fullPath);
  if (!computedHash) {
    return {
      skillName,
      skillPath: entry.skillPath,
      lockedHash: entry.computedHash,
      computedHash: '',
      drifted: true,
      fileExists: true,
      error: 'Could not compute hash',
    };
  }

  const drifted = computedHash !== entry.computedHash;

  return {
    skillName,
    skillPath: entry.skillPath,
    lockedHash: entry.computedHash,
    computedHash,
    drifted,
    fileExists: true,
  };
}

function checkAllSkills(): DriftResult[] {
  const lock = readSkillsLock();
  if (!lock) {
    console.error(`Error: ${SKILLS_LOCK_FILE} not found or invalid`);
    process.exit(1);
  }

  const results: DriftResult[] = [];
  for (const [skillName, entry] of Object.entries(lock.skills)) {
    results.push(checkSingleSkill(skillName, entry));
  }

  return results;
}

// ── Commands ───────────────────────────────────────────────────────

function cmdCheck(args: Args): void {
  let results: DriftResult[];

  if (args.checkSkill) {
    const lock = readSkillsLock();
    if (!lock) {
      console.error(`Error: ${SKILLS_LOCK_FILE} not found or invalid`);
      process.exit(1);
    }
    const entry = lock.skills[args.checkSkill];
    if (!entry) {
      console.error(`Error: Skill "${args.checkSkill}" not found in ${SKILLS_LOCK_FILE}`);
      process.exit(1);
    }
    results = [checkSingleSkill(args.checkSkill, entry)];
  } else {
    results = checkAllSkills();
  }

  const drifted = results.filter(r => r.drifted);
  const warnings = results.filter(r => r.error && !r.drifted);

  if (drifted.length > 0) {
    console.log(JSON.stringify({
      check: true,
      totalSkills: results.length,
      drifted: drifted.length,
      warnings: warnings.length,
      clean: results.length - drifted.length - warnings.length,
      driftedSkills: drifted.map(r => ({
        skillName: r.skillName,
        lockedHash: r.lockedHash,
        computedHash: r.computedHash,
        error: r.error || null,
      })),
    }, null, 2));
    process.exit(2); // Drift detected
  }

  if (warnings.length > 0) {
    console.log(JSON.stringify({
      check: true,
      totalSkills: results.length,
      drifted: 0,
      warnings: warnings.length,
      clean: results.length - warnings.length,
      warnings: warnings.map(r => ({
        skillName: r.skillName,
        error: r.error,
      })),
    }, null, 2));
    process.exit(1); // Warnings
  }

  console.log(JSON.stringify({
    check: true,
    totalSkills: results.length,
    drifted: 0,
    warnings: 0,
    clean: results.length,
    message: 'All skills match their locked hashes',
  }, null, 2));
  process.exit(0);
}

function cmdReport(): void {
  const results = checkAllSkills();

  const tableData = results.map(r => ({
    skill: r.skillName,
    path: r.skillPath,
    fileExists: r.fileExists,
    lockedHash: r.lockedHash.substring(0, 12) + '...',
    computedHash: r.computedHash ? r.computedHash.substring(0, 12) + '...' : 'N/A',
    match: r.drifted ? '❌ DRIFTED' : r.error ? '⚠ ERROR' : '✅ OK',
    error: r.error || null,
  }));

  const driftedCount = results.filter(r => r.drifted).length;
  const warningCount = results.filter(r => r.error && !r.drifted).length;
  const cleanCount = results.length - driftedCount - warningCount;

  const output = {
    report: true,
    timestamp: new Date().toISOString(),
    totalSkills: results.length,
    drifted: driftedCount,
    warnings: warningCount,
    clean: cleanCount,
    skills: tableData,
  };

  console.log(JSON.stringify(output, null, 2));

  if (driftedCount > 0) process.exit(2);
  if (warningCount > 0) process.exit(1);
  process.exit(0);
}

function cmdUpdateLock(): void {
  const lock = readSkillsLock();
  if (!lock) {
    console.error(`Error: ${SKILLS_LOCK_FILE} not found or invalid`);
    process.exit(1);
  }

  const updated: string[] = [];
  const failed: Array<{ skillName: string; error: string }> = [];
  const unchanged: string[] = [];

  for (const [skillName, entry] of Object.entries(lock.skills)) {
    const fullPath = resolveSkillPath(entry.skillPath);
    if (!fs.existsSync(fullPath)) {
      failed.push({ skillName, error: `File not found: ${entry.skillPath}` });
      continue;
    }

    const newHash = computeSha256(fullPath);
    if (!newHash) {
      failed.push({ skillName, error: 'Could not compute hash' });
      continue;
    }

    if (entry.computedHash === newHash) {
      unchanged.push(skillName);
    } else {
      const oldHash = entry.computedHash;
      entry.computedHash = newHash;
      updated.push(skillName);
      console.log(`[update-lock] ${skillName}: ${oldHash.substring(0, 12)}... -> ${newHash.substring(0, 12)}...`);
    }
  }

  if (failed.length > 0) {
    for (const f of failed) {
      console.error(`[update-lock] Failed: ${f.skillName} — ${f.error}`);
    }
  }

  lock.version = (lock.version || 1) + 1;

  if (!writeSkillsLock(lock)) {
    process.exit(1);
  }

  console.log(JSON.stringify({
    updateLock: true,
    updated: updated.length,
    unchanged: unchanged.length,
    failed: failed.length,
    updatedSkills: updated,
    failedSkills: failed.map(f => f.skillName),
  }, null, 2));

  if (failed.length > 0) process.exit(1);
  process.exit(0);
}

// ── Usage ──────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`
Skill Drift Detector — Detect when skills have drifted from their locked hashes

Usage:
  [noderuntime] skill-drift-detector.ts --check
  [noderuntime] skill-drift-detector.ts --report
  [noderuntime] skill-drift-detector.ts --update-lock
  [noderuntime] skill-drift-detector.ts --check-skill=<skill-name>

Modes:
  --check              Check all skills, exit 2 if any drifted, 1 if warnings, 0 if clean
  --report             Print detailed report of all skills with hash status
  --update-lock        Update skills-lock.json with current hashes (use with caution)
  --check-skill=<name> Check only a specific skill

Exit codes:
  0 = all clean (no drift)
  1 = error or warnings (missing files, etc.)
  2 = drift detected
`);
}

// ── Main ───────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs();

  if (process.argv.length <= 2) {
    printUsage();
    process.exit(0);
  }

  // Count how many action flags were set (at most 1)
  const actionCount = [args.check, args.report, args.updateLock].filter(Boolean).length;
  if (actionCount > 1) {
    console.error('Error: Only one action flag allowed (--check, --report, or --update-lock)');
    process.exit(1);
  }

  if (args.check) {
    cmdCheck(args);
    return;
  }

  if (args.report) {
    cmdReport();
    return;
  }

  if (args.updateLock) {
    cmdUpdateLock();
    return;
  }

  if (args.checkSkill && !args.check) {
    // --check-skill without --check: treat as check mode for that one skill
    args.check = true;
    cmdCheck(args);
    return;
  }

  printUsage();
}

if (require.main === module) {
  main();
}
