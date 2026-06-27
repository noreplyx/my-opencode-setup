import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  ALLOWED_VERDICTS,
  extractAllowedVerdictsFromTaxonomy,
  validateAgentFile,
  readText,
  TAXONOMY_PATH,
} from './validate-verdict-taxonomy';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'verdict-taxonomy-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const taxonomyContent = readText(TAXONOMY_PATH);

describe('Taxonomy parsing', () => {
  test('extracts all expected verdicts from the real taxonomy file', () => {
    const found = extractAllowedVerdictsFromTaxonomy(taxonomyContent);
    for (const v of ALLOWED_VERDICTS) {
      expect(found.has(v)).toBe(true);
    }
  });
});

describe('Valid reviewer agents', () => {
  function writeAgentFile(name: string, body: string): string {
    const path = join(tempDir, name);
    writeFileSync(path, body, 'utf-8');
    return path;
  }

  test('passes a valid reviewer agent with all allowed verdicts', () => {
    const path = writeAgentFile(
      'valid-security.md',
      `---
description: Reviews code for security issues.
mode: subagent
---

# Security Reviewer

**Output format:**
- Verdict: one of \`pass\`, \`pass-with-concerns\`, \`reject\`, or \`not-applicable\` (see \`VERDICT-TAXONOMY.md\`).
`
    );
    const errors = validateAgentFile(path, 'VERDICT-TAXONOMY.md');
    expect(errors).toEqual([]);
  });

  test('passes a reviewer agent whose description contains a colon', () => {
    const path = writeAgentFile(
      'colon-description.md',
      `---
description: "Reviews code: security, performance, and more."
mode: subagent
---

# Some Reviewer

**Output format:**
- Verdict: one of \`pass\`, \`pass-with-concerns\`, \`reject\`, or \`not-applicable\` (see \`VERDICT-TAXONOMY.md\`).
`
    );
    const errors = validateAgentFile(path, 'VERDICT-TAXONOMY.md');
    expect(errors).toEqual([]);
  });
});

describe('Invalid reviewer agents', () => {
  function writeAgentFile(name: string, body: string): string {
    const path = join(tempDir, name);
    writeFileSync(path, body, 'utf-8');
    return path;
  }

  test('fails on old verdict term "block"', () => {
    const path = writeAgentFile(
      'old-block.md',
      `---
description: Reviews code for security issues.
mode: subagent
---

# Security Reviewer

**Output format:**
- Verdict: \`pass\`, \`pass-with-concerns\`, or \`block\`.
`
    );
    const errors = validateAgentFile(path, 'VERDICT-TAXONOMY.md');
    expect(errors.some(e => e.message.includes('Old verdict term "block"'))).toBe(true);
  });

  test('fails on old verdict term "approve"', () => {
    const path = writeAgentFile(
      'old-approve.md',
      `---
description: Reviews implementation plans.
mode: subagent
---

# Engineer Reviewer

**Output format:**
- Verdict: \`approve\`, \`approve-with-concerns\`, or \`request-changes\`.
`
    );
    const errors = validateAgentFile(path, 'VERDICT-TAXONOMY.md');
    expect(errors.some(e => e.message.includes('Old verdict term "approve"'))).toBe(true);
    expect(errors.some(e => e.message.includes('Old verdict term "approve-with-concerns"'))).toBe(true);
    expect(errors.some(e => e.message.includes('Old verdict term "request-changes"'))).toBe(true);
  });

  test('fails on invalid verdict value', () => {
    const path = writeAgentFile(
      'invalid-value.md',
      `---
description: Reviews code for security issues.
mode: subagent
---

# Security Reviewer

**Output format:**
- Verdict: \`pass\`, \`fail\`, or \`reject\` (see \`VERDICT-TAXONOMY.md\`).
`
    );
    const errors = validateAgentFile(path, 'VERDICT-TAXONOMY.md');
    expect(errors.some(e => e.message.includes('Unexpected verdict value "fail"'))).toBe(true);
  });

  test('fails when reviewer agent is missing a Verdict line', () => {
    const path = writeAgentFile(
      'missing-verdict.md',
      `---
description: Reviews code for security issues.
mode: subagent
---

# Security Reviewer

**Output format:**
- Findings list.
`
    );
    const errors = validateAgentFile(path, 'VERDICT-TAXONOMY.md');
    expect(errors.some(e => e.message.includes('missing a top-level "- Verdict:" line'))).toBe(true);
  });

  test('fails when Verdict line does not reference the taxonomy file', () => {
    const path = writeAgentFile(
      'missing-ref.md',
      `---
description: Reviews code for security issues.
mode: subagent
---

# Security Reviewer

**Output format:**
- Verdict: one of \`pass\`, \`pass-with-concerns\`, \`reject\`, or \`not-applicable\`.
`
    );
    const errors = validateAgentFile(path, 'VERDICT-TAXONOMY.md');
    expect(errors.some(e => e.message.includes('should reference the taxonomy file'))).toBe(true);
  });

  test('reports an error for malformed YAML front matter', () => {
    const path = writeAgentFile(
      'bad-yaml.md',
      `---
description: "unclosed quote
mode: subagent
---

# Security Reviewer

**Output format:**
- Verdict: one of \`pass\`, \`pass-with-concerns\`, \`reject\`, or \`not-applicable\` (see \`VERDICT-TAXONOMY.md\`).
`
    );
    const errors = validateAgentFile(path, 'VERDICT-TAXONOMY.md');
    expect(errors.some(e => e.message.includes('Failed to parse YAML front matter'))).toBe(true);
  });
});

describe('Non-reviewer agents', () => {
  function writeAgentFile(name: string, body: string): string {
    const path = join(tempDir, name);
    writeFileSync(path, body, 'utf-8');
    return path;
  }

  test('does not require a Verdict line for non-reviewer agents', () => {
    const path = writeAgentFile(
      'orchestrator-like.md',
      `---
description: Coordinates subagents.
mode: primary
---

# Orchestrator

No verdicts here.
`
    );
    const errors = validateAgentFile(path, 'VERDICT-TAXONOMY.md');
    expect(errors).toEqual([]);
  });
});
