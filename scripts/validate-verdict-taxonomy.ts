#!/usr/bin/env bun
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as yaml from 'js-yaml';

export const ROOT = resolve(import.meta.dirname || '.', '..');
export const TAXONOMY_PATH = join(ROOT, 'VERDICT-TAXONOMY.md');
export const AGENTS_DIR = join(ROOT, 'agents');

export const ALLOWED_VERDICTS = new Set(['pass', 'pass-with-concerns', 'reject', 'not-applicable']);
export const OLD_VERDICTS = ['approve', 'approve-with-concerns', 'request-changes', 'block'];

export interface ValidationError {
  file: string;
  line: number;
  message: string;
}

export interface FrontMatter {
  description?: string;
  [key: string]: unknown;
}

export function readText(path: string): string {
  return readFileSync(path, 'utf-8');
}

export function parseFrontMatter(content: string): FrontMatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  return yaml.load(match[1]) as FrontMatter;
}

export function isReviewerAgent(path: string, content: string): boolean {
  const fm = parseFrontMatter(content);
  const description = String(fm.description || '').toLowerCase();
  return description.includes('reviews');
}

export function extractAllowedVerdictsFromTaxonomy(content: string): Set<string> {
  const found = new Set<string>();
  // Match verdict rows in the Allowed Verdicts table: | `pass` | ... |
  const rowRegex = /^\|\s*`([^`]+)`\s*\|/gm;
  let match: RegExpExecArray | null;
  while ((match = rowRegex.exec(content)) !== null) {
    const v = match[1].trim();
    if (ALLOWED_VERDICTS.has(v)) {
      found.add(v);
    }
  }
  return found;
}

export function validateAgentFile(path: string, taxonomyRef: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const content = readText(path);
  let isReviewer: boolean;
  try {
    isReviewer = isReviewerAgent(path, content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push({
      file: path,
      line: 0,
      message: `Failed to parse YAML front matter: ${message}`
    });
    isReviewer = false;
  }
  const lines = content.split(/\r?\n/);
  let hasVerdictLine = false;
  let verdictValues: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for top-level Verdict line
    const verdictMatch = line.match(/^\s*-\s*Verdict:\s*(.+)$/);
    if (verdictMatch) {
      const rest = verdictMatch[1];

      // Check for old top-level verdict terms inside backticks
      for (const old of OLD_VERDICTS) {
        if (rest.includes(`\`${old}\``)) {
          errors.push({
            file: path,
            line: lineNum,
            message: `Old verdict term "${old}" found in top-level Verdict line. Use the unified taxonomy: ${[...ALLOWED_VERDICTS].join(', ')}.`
          });
        }
      }
      hasVerdictLine = true;
      // Extract verdict values from the verdict portion only, before any reference clause like (see `...`) or (per `...`).
      const valuesPart = rest.split(/\s*\(see\s+|\s*\(per\s+/)[0];
      const values = [...valuesPart.matchAll(/`([^`]+)`/g)].map(m => m[1].trim());
      verdictValues = values;

      for (const v of values) {
        if (!ALLOWED_VERDICTS.has(v)) {
          errors.push({
            file: path,
            line: lineNum,
            message: `Unexpected verdict value "${v}". Allowed values: ${[...ALLOWED_VERDICTS].join(', ')}.`
          });
        }
      }

      if (!rest.includes(taxonomyRef)) {
        errors.push({
          file: path,
          line: lineNum,
          message: `Verdict line should reference the taxonomy file "${taxonomyRef}".`
        });
      }
    }
  }

  if (isReviewer) {
    if (!hasVerdictLine) {
      errors.push({
        file: path,
        line: 0,
        message: `Reviewer agent file is missing a top-level "- Verdict:" line. All reviewer agents must declare a verdict from the unified taxonomy.`
      });
    } else if (verdictValues.length === 0) {
      errors.push({
        file: path,
        line: 0,
        message: `Reviewer agent file has a Verdict line but no verdict values were extracted (expected values in backticks).`
      });
    }
  }

  return errors;
}

function main(): number {
  console.log('Validating verdict taxonomy...\n');

  // 1. Taxonomy file must exist
  let taxonomyContent: string;
  try {
    statSync(TAXONOMY_PATH);
    taxonomyContent = readText(TAXONOMY_PATH);
  } catch (err) {
    console.error(`ERROR: Taxonomy file not found at ${TAXONOMY_PATH}`);
    return 1;
  }

  // 2. Taxonomy must contain the expected verdicts
  const taxonomyVerdicts = extractAllowedVerdictsFromTaxonomy(taxonomyContent);
  const missingFromTaxonomy = [...ALLOWED_VERDICTS].filter(v => !taxonomyVerdicts.has(v));
  if (missingFromTaxonomy.length > 0) {
    console.error(`ERROR: Taxonomy file is missing expected verdicts: ${missingFromTaxonomy.join(', ')}`);
    return 1;
  }
  console.log(`Taxonomy file OK: ${TAXONOMY_PATH}`);
  console.log(`Allowed verdicts: ${[...ALLOWED_VERDICTS].join(', ')}\n`);

  // 3. Scan agent files
  const entries = readdirSync(AGENTS_DIR, { withFileTypes: true });
  const agentFiles = entries
    .filter(e => e.isFile() && e.name.endsWith('.md'))
    .map(e => join(AGENTS_DIR, e.name));

  let allErrors: ValidationError[] = [];
  const taxonomyRef = 'VERDICT-TAXONOMY.md';

  for (const file of agentFiles) {
    const errors = validateAgentFile(file, taxonomyRef);
    allErrors = allErrors.concat(errors);
    const rel = relative(ROOT, file);
    if (errors.length === 0) {
      console.log(`  OK   ${rel}`);
    } else {
      console.log(`  FAIL ${rel} (${errors.length} issue${errors.length === 1 ? '' : 's'})`);
    }
  }

  console.log('');

  // 4. Report errors
  if (allErrors.length > 0) {
    console.error(`Found ${allErrors.length} error${allErrors.length === 1 ? '' : 's'}:\n`);
    for (const err of allErrors) {
      const location = err.line > 0 ? `${err.file}:${err.line}` : err.file;
      console.error(`- ${location}\n  ${err.message}`);
    }
    console.error('\nVerdict taxonomy validation FAILED.');
    return 1;
  }

  console.log(`All ${agentFiles.length} agent files comply with the verdict taxonomy.`);
  console.log('Verdict taxonomy validation PASSED.');
  return 0;
}

if (import.meta.main) {
  process.exit(main());
}
