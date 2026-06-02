#!/usr/bin/env node
/**
 * Hand-off Completeness Checker
 *
 * Validates that the Orchestrator's hand-off to a subagent includes all
 * required context fields before dispatch. Supports evidence chain validation,
 * structured evidence template generation, and completeness scoring.
 *
 * Usage:
 *   [runtime] check-handoff.ts --agent=<name> --context="<handoff-text>"
 *   [runtime] check-handoff.ts --agent=<name> --validate-evidence-chain --pipeline
 *   [runtime] check-handoff.ts --agent=<name> --generate-template --pipeline [--output=<file>]
 *   [runtime] check-handoff.ts --agent=<name> --completeness-score --pipeline
 *   [runtime] check-handoff.ts --agent=<name>                (pipe hand-off via stdin)
 *
 * Exit codes:
 *   0 = Hand-off is complete (or operation succeeded)
 *   1 = Hand-off is incomplete (or validation failed)
 *   2 = Parse / runtime error
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ── Types ──

interface HandoffChecklistItem {
  field: string;
  description: string;
  mandatory: boolean;
  checkFn: (text: string) => boolean;
}

interface HandoffValidationResult {
  agentName: string;
  totalChecks: number;
  passed: number;
  failed: number;
  missingFields: string[];
  warnings: string[];
  complete: boolean;
}

interface EvidenceChainLink {
  agentName: string;
  claim: string;
  source: string;
  lines: number[];
  result: string;
  isReferencedInHandoff: boolean;
  referenceContext?: string;
}

interface EvidenceChainReport {
  agentName: string;
  totalUpstreamClaims: number;
  referencedInHandoff: number;
  missingReferences: EvidenceChainLink[];
  chainCompleteness: number;
  warnings: string[];
}

interface AgentHistoryEntry {
  agent: string;
  resultSummary: string;
  evidence: string[];
  decisions: string[];
  artifacts: string[];
}

// ── Helpers ──

function computeContentHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

function extractFilePath(text: string): string[] {
  const filePattern = /(?:`([^`]+)`|"([^"]+)")(?:\s*lines?\s*\[(\d+)(?:,\s*(\d+))?\])?/gi;
  const paths: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = filePattern.exec(text)) !== null) {
    const filePath = match[1] || match[2];
    if (filePath && !filePath.startsWith('http') && (filePath.includes('.') || filePath.startsWith('/') || filePath.startsWith('src/'))) {
      paths.push(filePath);
    }
  }
  return paths;
}

function linesInRange(text: string, searchPhrase: string): number[] {
  const lines = text.split('\n');
  const result: number[] = [];
  const lower = searchPhrase.toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(lower)) {
      result.push(i + 1);
    }
  }
  return result.length > 0 ? [result[0], result[result.length - 1]] : [];
}

function extractHandoffMetadata(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const knownFields = ['contextSummary', 'artifacts', 'clearObjective', 'constraints', 'expectedOutput', 'evidenceFromPriorAgent', 'planManifestPath', 'definitionOfDone', 'contentHashes', 'crossAgentProvenance', 'evidenceChainVerification', 'rootCauseEvidence', 'checkpointEvidence', 'testEvidence', 'crossFileEvidence', 'acceptanceEvidence'];
  for (const field of knownFields) {
    const regex = new RegExp(`${field}:\\s*["']([^"']+)["']`, 'i');
    const match = text.match(regex);
    if (match) fields[field] = match[1];
  }
  return fields;
}

// ── Evidence Chain Validation ──

function parseAgentContext(contextPath: string): AgentHistoryEntry[] {
  if (!fs.existsSync(contextPath)) return [];

  const content = fs.readFileSync(contextPath, 'utf-8');
  const entries: AgentHistoryEntry[] = [];

  // Parse agent history from agent-context.md
  // Format: agentHistory blocks with nested agent fields
  const historySection = content.match(/agentHistory:\n([\s\S]*?)(?=\n\w|$)/);
  if (!historySection) return entries;

  const block = historySection[1];

  // Match each agent block: - agent: <name>\n  resultSummary: ...\n  evidence: ...
  const agentBlocks = block.match(/- agent:\s*"([^"]+)"\n([\s\S]*?)(?=\n- agent:|$)/g);
  if (!agentBlocks) return entries;

  for (const agentBlock of agentBlocks) {
    const agentMatch = agentBlock.match(/- agent:\s*"([^"]+)"/);
    if (!agentMatch) continue;

    const entry: AgentHistoryEntry = {
      agent: agentMatch[1],
      resultSummary: '',
      evidence: [],
      decisions: [],
      artifacts: [],
    };

    const summaryMatch = agentBlock.match(/resultSummary:\s*"([^"]+)"/);
    if (summaryMatch) entry.resultSummary = summaryMatch[1];

    const evidenceSection = agentBlock.match(/evidence:\n([\s\S]*?)(?=\n\s{2}\w|$)/);
    if (evidenceSection) {
      const evidenceItems = evidenceSection[1].match(/-\s+"([^"]+)"/g);
      if (evidenceItems) {
        entry.evidence = evidenceItems.map(e => e.replace(/^-\s+"([^"]+)"$/, '$1'));
      }
    }

    const decisionSection = agentBlock.match(/decisions:\n([\s\S]*?)(?=\n\s{2}\w|$)/);
    if (decisionSection) {
      const decisionItems = decisionSection[1].match(/-\s+"([^"]+)"/g);
      if (decisionItems) {
        entry.decisions = decisionItems.map(d => d.replace(/^-\s+"([^"]+)"$/, '$1'));
      }
    }

    const artifactSection = agentBlock.match(/artifacts:\n([\s\S]*?)(?=\n\s{2}\w|$)/);
    if (artifactSection) {
      const artifactItems = artifactSection[1].match(/-\s+"([^"]+)"/g);
      if (artifactItems) {
        entry.artifacts = artifactItems.map(a => a.replace(/^-\s+"([^"]+)"$/, '$1'));
      }
    }

    entries.push(entry);
  }

  return entries;
}

function extractEvidenceChain(handoffText: string, history: AgentHistoryEntry[]): EvidenceChainReport {
  const warnings: string[] = [];
  const totalClaims: EvidenceChainLink[] = [];

  for (const entry of history) {
    for (const claim of entry.evidence) {
      // Check if the claim or its sources are referenced in the handoff text
      const lowerClaim = claim.toLowerCase();
      const lowerHandoff = handoffText.toLowerCase();
      const isReferenced = lowerHandoff.includes(lowerClaim) ||
                           lowerHandoff.includes(entry.agent.toLowerCase());

      let referenceContext: string | undefined;
      if (isReferenced) {
        // Find surrounding context — look for the claim mention +/- 100 chars
        const idx = lowerHandoff.indexOf(lowerClaim);
        if (idx !== -1) {
          const start = Math.max(0, idx - 60);
          const end = Math.min(handoffText.length, idx + lowerClaim.length + 60);
          referenceContext = (start > 0 ? '...' : '') +
            handoffText.slice(start, end) +
            (end < handoffText.length ? '...' : '');
        }
      }

      const filePaths = extractFilePath(claim);
      const srcLines = extractFilePath(claim).length > 0
        ? extractFilePath(claim).map(f => linesInRange(claim, f)).flat()
        : [];

      totalClaims.push({
        agentName: entry.agent,
        claim,
        source: filePaths.length > 0 ? filePaths[0] : claim,
        lines: srcLines.length > 0 ? [srcLines[0], srcLines[srcLines.length - 1]] : [],
        result: entry.resultSummary.length > 0 ? 'passed' : 'unknown',
        isReferencedInHandoff: isReferenced,
        referenceContext,
      });
    }
  }

  const referenced = totalClaims.filter(c => c.isReferencedInHandoff);
  const missing = totalClaims.filter(c => !c.isReferencedInHandoff);
  const completeness = totalClaims.length > 0 ? Math.round((referenced.length / totalClaims.length) * 100) : 0;

  // Check for critical evidence types that must be cited with exact file paths
  const criticalMissing = missing.filter(c =>
    /(?:checkpoint|build passed|CP-\d|test pass|verify)/i.test(c.claim)
  );

  if (criticalMissing.length > 0) {
    warnings.push(`Critical evidence not cited with exact file paths: ${criticalMissing.map(c => c.claim).join(', ')}`);
  }

  // Check for generic "evidence" references without specific claims
  if (/evidence/i.test(handoffText) && missing.length === totalClaims.length && totalClaims.length > 0) {
    warnings.push('Hand-off mentions "evidence" but does not reference any specific upstream claims');
  }

  return {
    agentName: history.length > 0 ? history[history.length - 1].agent : 'unknown',
    totalUpstreamClaims: totalClaims.length,
    referencedInHandoff: referenced.length,
    missingReferences: missing,
    chainCompleteness: completeness,
    warnings,
  };
}

function validateEvidenceChain(handoffText: string): void {
  const contextPath = path.resolve('agent-context.md');
  if (!fs.existsSync(contextPath)) {
    console.error('❌ agent-context.md not found — cannot validate evidence chain');
    process.exit(2);
  }

  const history = parseAgentContext(contextPath);
  if (history.length === 0) {
    console.log('\n⚠️  No agent history found in agent-context.md');
    console.log('   Evidence chain validation skipped.');
    return;
  }

  const report = extractEvidenceChain(handoffText, history);

  console.log(`\n🔗 Evidence Chain Validation`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Total upstream claims: ${report.totalUpstreamClaims}`);
  console.log(`Referenced in hand-off: ${report.referencedInHandoff}`);
  console.log(`Chain completeness: ${report.chainCompleteness}%`);
  console.log();

  if (report.missingReferences.length > 0) {
    console.log(`❌ ${report.missingReferences.length} Missing Evidence References:`);
    for (const link of report.missingReferences) {
      console.log(`  • [${link.agentName}] "${link.claim.slice(0, 80)}..."`);
      if (link.source) console.log(`    Source: ${link.source}`);
    }
    console.log();
  }

  if (report.warnings.length > 0) {
    console.log('⚠️  Warnings:');
    for (const w of report.warnings) {
      console.log(`  • ${w}`);
    }
    console.log();
  }

  if (report.referencedInHandoff === report.totalUpstreamClaims) {
    console.log('  ✓ All upstream evidence claims are referenced.');
  }

  // Also read pipeline logs for more context
  const pipelineLogsDir = path.resolve('.opencode/pipeline-logs');
  if (fs.existsSync(pipelineLogsDir)) {
    const logs = fs.readdirSync(pipelineLogsDir).filter(f => f.endsWith('.log') || f.endsWith('.md'));
    if (logs.length > 0) {
      console.log(`\n📋 Pipeline logs found (${logs.length} files) — check --generate-template for structured export`);
    }
  }
  console.log();
}

// ── Structured Evidence Hand-off Template ──

function generateEvidenceTemplate(): string {
  const contextPath = path.resolve('agent-context.md');
  if (!fs.existsSync(contextPath)) {
    console.error('❌ agent-context.md not found — cannot generate template');
    process.exit(2);
  }

  const history = parseAgentContext(contextPath);
  if (history.length === 0) {
    console.log('\n⚠️  No agent history found. Generating empty template.');
    return '# Evidence Hand-off Template\n\nNo agent history available.\n';
  }

  const now = new Date().toISOString();
  const lines: string[] = [
    `# Evidence Hand-off — Generated ${now}`,
    '',
  ];

  for (const entry of history) {
    lines.push(`## Agent: ${entry.agent}`);
    lines.push('');

    if (entry.evidence.length === 0) {
      lines.push('_No evidence recorded._');
      lines.push('');
      continue;
    }

    lines.push('```');
    lines.push(`Previous Evidence (from ${entry.agent}):`);

    for (const claim of entry.evidence) {
      const filePaths = extractFilePath(claim);
      const linesInfo = linesInRange(claim, claim);

      // Try to get file content for hash
      let contentHash = '';
      if (filePaths.length > 0) {
        const resolvedPath = filePaths[0].startsWith('/')
          ? filePaths[0]
          : path.resolve(filePaths[0]);
        if (fs.existsSync(resolvedPath)) {
          try {
            const fileContent = fs.readFileSync(resolvedPath, 'utf-8');
            contentHash = `ContentHash: ${computeContentHash(fileContent)}`;
          } catch {
            contentHash = 'ContentHash: (unreadable)';
          }
        } else {
          contentHash = 'ContentHash: (file-not-found)';
        }
      }

      lines.push(`  - Claim: ${claim}`);
      if (filePaths.length > 0) {
        lines.push(`    Source: ${filePaths[0]}${linesInfo.length > 0 ? `, Lines [${linesInfo[0]}, ${linesInfo[linesInfo.length - 1]}]` : ''}`);
      }
      lines.push(`    Method: grep/read/stat/test/build`);
      lines.push(`    Command: <exact command>`);
      lines.push(`    Excerpt: "<relevant output>"`);
      lines.push(`    Result: ${entry.resultSummary ? 'passed' : 'unknown'}`);
      lines.push(`    ${contentHash || 'ContentHash: <compute-from-source>'}`);
    }

    lines.push('```');
    lines.push('');
  }

  // Add blank template for the current agent's evidence
  const lastAgent = history[history.length - 1];
  lines.push('## Current Agent Output (fill before hand-off)');
  lines.push('');
  lines.push('```');
  lines.push(`Previous Evidence (from ${lastAgent.agent}):`);
  lines.push('  - Claim: <result or finding>');
  lines.push('    Source: <file>, Lines [start, end]');
  lines.push('    Method: grep/read/stat/test/build');
  lines.push('    Command: <exact command used>');
  lines.push('    Excerpt: "<relevant output>"');
  lines.push('    Result: found/not_found/passed/failed');
  lines.push('    ContentHash: <sha256>');
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

// ── Completeness Score ──

function computeCompletenessScore(handoffText: string, agentName: string): number {
  const checklist = createChecklist(agentName);

  // Mandatory fields present = 50%
  const mandatoryItems = checklist.filter(c => c.mandatory);
  const mandatoryPassed = mandatoryItems.filter(c => c.checkFn(handoffText));
  const mandatoryScore = mandatoryItems.length > 0
    ? (mandatoryPassed.length / mandatoryItems.length) * 50
    : 50;

  // Evidence chain references = 30%
  let evidenceScore = 0;
  const contextPath = path.resolve('agent-context.md');
  if (fs.existsSync(contextPath)) {
    const history = parseAgentContext(contextPath);
    if (history.length > 0) {
      const report = extractEvidenceChain(handoffText, history);
      evidenceScore = (report.chainCompleteness / 100) * 30;
    } else {
      evidenceScore = 30; // No history to check
    }
  } else {
    evidenceScore = 15; // No context file, partial credit
  }

  // Agent-specific fields = 20%
  const agentItems = checklist.filter(c => !['contextSummary', 'artifacts', 'clearObjective', 'constraints', 'expectedOutput', 'evidenceFromPriorAgent', 'contentHashes', 'crossAgentProvenance'].includes(c.field));
  const agentPassed = agentItems.filter(c => c.checkFn(handoffText));
  const agentScore = agentItems.length > 0
    ? (agentPassed.length / agentItems.length) * 20
    : 20;

  return Math.round(mandatoryScore + evidenceScore + agentScore);
}

// ── Checklist Definitions ──

function createChecklist(agentName: string): HandoffChecklistItem[] {
  const commonChecks: HandoffChecklistItem[] = [
    {
      field: 'contextSummary',
      description: 'Summary of what was done in the previous step(s)',
      mandatory: true,
      checkFn: (text) => text.length > 20 && (text.includes('done') || text.includes('completed') || text.includes('previous') || text.includes('result')),
    },
    {
      field: 'artifacts',
      description: 'Relevant file paths, outputs, or data produced',
      mandatory: true,
      checkFn: (text) => /(?:file|path|artifact|output|report|manifest)/i.test(text) && text.length > 30,
    },
    {
      field: 'clearObjective',
      description: 'Exactly what the next agent should do',
      mandatory: true,
      checkFn: (text) => {
        const actionWords = ['create', 'implement', 'fix', 'verify', 'test', 'analyze', 'find', 'research', 'update', 'generate', 'wire', 'integrate', 'diagnose'];
        const hasVerb = actionWords.some(w => new RegExp(w, 'i').test(text));
        return hasVerb && text.length > 40;
      },
    },
    {
      field: 'constraints',
      description: 'Any boundaries, rules, or restrictions',
      mandatory: true,
      checkFn: (text) => /(?:should not|must not|don't|avoid|only|limit|restrict|constraint|boundary)/i.test(text),
    },
    {
      field: 'expectedOutput',
      description: 'What the agent should return/report',
      mandatory: true,
      checkFn: (text) => /(?:return|report|output|format|contract|YAML|structured|result)/i.test(text),
    },
    {
      field: 'evidenceFromPriorAgent',
      description: 'Citations and evidence from the prior agent\'s work — must reference specific claims (not just mention "evidence")',
      mandatory: true,
      checkFn: (text) => /(?:found|discovered|identified|located|evidence|cite|according to|line|export)/i.test(text) && text.length > 50,
    },
    {
      field: 'contentHashes',
      description: 'SHA-256 hashes for critical evidence files',
      mandatory: false,
      checkFn: (text) => /(?:sha[-_]?256|content[-_]?hash|hash:|checksum)/i.test(text),
    },
    {
      field: 'crossAgentProvenance',
      description: 'How current task relates to upstream work',
      mandatory: false,
      checkFn: (text) => /(?:upstream|prior|previous|provenance|derived from|based on|follow-up)/i.test(text),
    },
  ];

  // Agent-specific additional checks
  const agentSpecific: Record<string, HandoffChecklistItem[]> = {
    implementor: [
      {
        field: 'planManifestPath',
        description: 'Path to plan-manifest.json',
        mandatory: true,
        checkFn: (text) => /plan-manifest|manifest\.json|checkpoint/i.test(text),
      },
      {
        field: 'targetFiles',
        description: 'Which files to create/modify',
        mandatory: true,
        checkFn: (text) => /(?:\.\w{1,6}|file|create|modify|update)/i.test(text),
      },
      {
        field: 'definitionOfDone',
        description: 'Clear exit criteria (build, lint, test commands)',
        mandatory: true,
        checkFn: (text) => /(?:build|lint|test|command|run|verify)/i.test(text),
      },
      {
        field: 'securityGuidance',
        description: 'Security patterns to follow or avoid',
        mandatory: false,
        checkFn: (text) => /(?:security|injection|sanitize|validate|XSS|SQL)/i.test(text),
      },
      {
        field: 'evidenceChainVerification',
        description: 'Evidence chain verification required for implementor hand-off',
        mandatory: true,
        checkFn: (text) => /(?:evidence[-_ ]?chain|evidentiary|upstream[-_ ]?evidence)/i.test(text) || /(?:CP-\d|checkpoint|build passed)/i.test(text),
      },
    ],
    verifier: [
      {
        field: 'manifestPath',
        description: 'Path to plan manifest for verification',
        mandatory: true,
        checkFn: (text) => /plan-manifest|manifest\.json/i.test(text),
      },
      {
        field: 'acceptanceCriteria',
        description: 'Acceptance criteria to verify',
        mandatory: false,
        checkFn: (text) => /(?:acceptance|criteria|scenario|given|when|then)/i.test(text),
      },
      {
        field: 'checkpointEvidence',
        description: 'Must cite exact checkpoint IDs and their plan manifest source',
        mandatory: true,
        checkFn: (text) => /(?:CP-\d+|checkpoint[-_ ]?id|checkpoint[-_ ]?evidence|plan[-_ ]?manifest[-_ ]?source)/i.test(text),
      },
    ],
    fixer: [
      {
        field: 'deviationReport',
        description: 'Detailed checkpoint results and failure reasons',
        mandatory: true,
        checkFn: (text) => /(?:deviation|fail|checkpoint|CP-\d|issue|bug|error)/i.test(text),
      },
      {
        field: 'failureRootCause',
        description: 'Known or suspected root cause from previous attempts',
        mandatory: false,
        checkFn: (text) => /(?:root cause|classification|plan-omission|edge-case|implementation-error)/i.test(text),
      },
      {
        field: 'rootCauseEvidence',
        description: 'Must cite the evidence that proves the bug exists',
        mandatory: true,
        checkFn: (text) => /(?:root[-_ ]?cause[-_ ]?evidence|evidence.*bug|evidence.*fail|build.*error.*line|error.*reproduce)/i.test(text),
      },
    ],
    qa: [
      {
        field: 'smokeTestCommand',
        description: 'Command to run the smoke test',
        mandatory: true,
        checkFn: (text) => /(?:smoke|start|boot|run|test)/i.test(text),
      },
      {
        field: 'testScope',
        description: 'What areas to test (changed files, edge cases)',
        mandatory: true,
        checkFn: (text) => /(?:test|edge case|boundary|coverage|scenario)/i.test(text),
      },
      {
        field: 'testEvidence',
        description: 'Must cite which evidence proves the test setup works',
        mandatory: true,
        checkFn: (text) => /(?:test[-_ ]?evidence|test[-_ ]?setup|evidence.*test|CI.*pass|smoke.*pass)/i.test(text),
      },
    ],
    integrator: [
      {
        field: 'parallelFileList',
        description: 'List of files created by parallel Implementors',
        mandatory: true,
        checkFn: (text) => /(?:created by|files:|new files|parallel)/i.test(text) && /\.\w+['"`]/.test(text),
      },
      {
        field: 'wiringConventions',
        description: 'Project wiring conventions (DI, routes, barrels)',
        mandatory: true,
        checkFn: (text) => /(?:DI|barrel|route|wiring|NestJS|Express|provider)/i.test(text),
      },
    ],
    documentor: [
      {
        field: 'changedFilesList',
        description: 'List of changed files to document',
        mandatory: true,
        checkFn: (text) => /(?:changed|modified|created|diff|files:)/i.test(text) && /\.\w+['"`]/.test(text),
      },
      {
        field: 'documentationScope',
        description: 'What documentation types to update (inline, README, changelog, API)',
        mandatory: true,
        checkFn: (text) => /(?:JSDoc|TSDoc|README|changelog|API|doc|inline|migration)/i.test(text),
      },
    ],
    finder: [
      {
        field: 'researchQuestions',
        description: 'Specific questions to answer through exploration',
        mandatory: true,
        checkFn: (text) => /\?/.test(text) || /(?:find|locate|search|discover|investigate)/i.test(text),
      },
      {
        field: 'codebaseScope',
        description: 'Which areas of the codebase to explore',
        mandatory: true,
        checkFn: (text) => /(?:src\/|directory|folder|module|service|controller|pattern)/i.test(text),
      },
    ],
    plandescriber: [
      {
        field: 'brainstormOutcome',
        description: 'Which option/approach was chosen during brainstorming',
        mandatory: true,
        checkFn: (text) => /(?:option|chosen|decided|approach|agreed|selected)/i.test(text),
      },
      {
        field: 'existingCodebaseContext',
        description: 'Existing code structure and patterns to follow',
        mandatory: true,
        checkFn: (text) => /(?:existing|current|found|located|uses|pattern)/i.test(text),
      },
    ],
    'acceptance-gate': [
      {
        field: 'acceptanceEvidence',
        description: 'Evidence that acceptance criteria have been met',
        mandatory: true,
        checkFn: (text) => /(?:acceptance[-_ ]?evidence|gate.*pass|criteria.*met|checklist.*verified)/i.test(text),
      },
      {
        field: 'blockingIssues',
        description: 'Any blocking issues found at the acceptance gate',
        mandatory: false,
        checkFn: (text) => /(?:blocking|blocker|issue|fail|gate|reject)/i.test(text),
      },
    ],
  };

  return [...commonChecks, ...(agentSpecific[agentName] || [])];
}

// ── Validation ──

function validateHandoff(handoffText: string, agentName: string): HandoffValidationResult {
  const checklist = createChecklist(agentName);
  const missingFields: string[] = [];
  const warnings: string[] = [];
  let passed = 0;
  let failed = 0;

  for (const item of checklist) {
    const found = item.checkFn(handoffText);
    if (found) {
      passed++;
    } else if (item.mandatory) {
      failed++;
      missingFields.push(item.field);
    } else {
      warnings.push(item.field);
    }
  }

  const complete = missingFields.length === 0;

  return {
    agentName,
    totalChecks: checklist.length,
    passed,
    failed,
    missingFields,
    warnings,
    complete,
  };
}

// ── Print ──

function printResult(result: HandoffValidationResult): void {
  const icon = result.complete ? '✅' : '❌';
  console.log(`\n${icon} Hand-off Completeness Check: ${result.agentName}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Complete: ${result.complete}`);
  console.log(`Checks: ${result.passed}/${result.totalChecks} passed`);
  console.log();

  if (result.missingFields.length > 0) {
    console.log('❌ Missing Mandatory Fields:');
    for (const field of result.missingFields) {
      console.log(`  • ${field}`);
    }
    console.log();
    console.log('  Tip: Add these fields to the hand-off before dispatching.');
    console.log();
  }

  if (result.warnings.length > 0) {
    console.log('⚠️  Missing Optional Fields:');
    for (const field of result.warnings) {
      console.log(`  • ${field}`);
    }
    console.log();
  }

  if (result.complete) {
    console.log('  ✓ All mandatory hand-off fields are present.');
    console.log();
  }
}

function printEvidenceChainReport(report: EvidenceChainReport): void {
  const icon = report.chainCompleteness >= 80 ? '✅' : report.chainCompleteness >= 50 ? '⚠️ ' : '❌';

  console.log(`\n🔗 Evidence Chain Validation: ${report.agentName}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Total upstream claims: ${report.totalUpstreamClaims}`);
  console.log(`Referenced in hand-off: ${report.referencedInHandoff}`);
  console.log(`Chain completeness: ${report.chainCompleteness}%`);
  console.log();

  if (report.missingReferences.length > 0) {
    console.log(`❌ ${report.missingReferences.length} Missing Evidence References:`);
    for (const link of report.missingReferences) {
      console.log(`  • [${link.agentName}] "${link.claim.slice(0, 100)}${link.claim.length > 100 ? '...' : ''}"`);
      if (link.source) console.log(`    Source: ${link.source}`);
    }
    console.log();
  }

  if (report.warnings.length > 0) {
    console.log('⚠️  Warnings:');
    for (const w of report.warnings) {
      console.log(`  • ${w}`);
    }
    console.log();
  }

  if (report.missingReferences.length === 0 && report.totalUpstreamClaims > 0) {
    console.log('  ✓ All upstream evidence claims are referenced.');
    console.log();
  }
}

function printCompletenessScore(score: number, agentName: string): void {
  const barLen = 30;
  const filled = Math.round((score / 100) * barLen);
  const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);

  console.log(`\n📊 Hand-off Completeness Score: ${agentName}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  ${bar}  ${score}/100`);
  console.log();
  console.log(`  Breakdown:`);
  console.log(`    Mandatory fields present:    50% (weight)`);
  console.log(`    Evidence chain references:   30% (weight)`);
  console.log(`    Agent-specific fields:       20% (weight)`);
  console.log();

  if (score >= 90) {
    console.log('  ✅ Excellent — hand-off is comprehensive');
  } else if (score >= 70) {
    console.log('  ⚠️  Good — but could improve evidence chain references');
  } else if (score >= 50) {
    console.log('  ⚠️  Fair — missing significant context');
  } else {
    console.log('  ❌ Poor — hand-off needs significant improvement');
  }
  console.log();
}

function printInvalidatedEvidenceReport(chainReport: EvidenceChainReport): void {
  const invalidated = chainReport.missingReferences.filter(
    c => (c.result === 'failed' || c.result === 'unknown') && !c.isReferencedInHandoff
  );
  const deleted = chainReport.missingReferences.filter(c => c.source.includes('deleted') || c.result === 'file_deleted');

  if (invalidated.length > 0) {
    console.log(`❌ INVALIDATED EVIDENCE:`);
    for (const link of invalidated) {
      console.log(`  Pipeline "...", Agent "${link.agentName}"`);
      console.log(`    Claim: "${link.claim.slice(0, 80)}..."`);
      console.log(`    File: ${link.source}`);
      console.log(`    Current: File modified, export no longer found`);
      console.log(`    → Action: Flag for re-verification`);
      console.log();
    }
  }

  if (deleted.length > 0) {
    console.log(`❌ FILE DELETED:`);
    for (const link of deleted) {
      console.log(`  Pipeline "...", Agent "${link.agentName}"`);
      console.log(`    Claim: "${link.claim.slice(0, 80)}..."`);
      console.log(`    File: ${link.source}`);
      console.log(`    Current: File no longer exists`);
      console.log(`    → Action: Evidence is stale — remove from active reference`);
      console.log();
    }
  }
}

// ── Pipeline Mode ──

function validatePipelineHandoff(agentName: string): HandoffValidationResult | null {
  const contextPath = path.resolve('agent-context.md');
  if (!fs.existsSync(contextPath)) return null;

  const content = fs.readFileSync(contextPath, 'utf-8');

  // Extract nextObjective
  const nextObjMatch = content.match(/^nextObjective:\s*"(.*)"/m);
  const nextObjective = nextObjMatch ? nextObjMatch[1] : '';

  // Check agent history for hand-off context
  const agentHistoryMatch = content.match(/agentHistory:\n([\s\S]*?)(?=\n\w|$)/);
  const agentHistory = agentHistoryMatch ? agentHistoryMatch[1] : '';

  // Also read pipeline logs
  const pipelineLogsDir = path.resolve('.opencode/pipeline-logs');
  let pipelineLogContext = '';
  if (fs.existsSync(pipelineLogsDir)) {
    const logFiles = fs.readdirSync(pipelineLogsDir)
      .filter(f => f.endsWith('.log') || f.endsWith('.md'))
      .sort()
      .slice(-5); // Last 5 log files
    for (const logFile of logFiles) {
      try {
        const logContent = fs.readFileSync(path.join(pipelineLogsDir, logFile), 'utf-8');
        pipelineLogContext += `\n--- Pipeline Log: ${logFile} ---\n${logContent.slice(0, 500)}`;
      } catch {
        // skip unreadable files
      }
    }
  }

  const handoffText = `Objective: ${nextObjective}\nHistory: ${agentHistory}\nContext: ${content.slice(0, 2000)}\nPipelineLogs: ${pipelineLogContext.slice(0, 1000)}`;

  return validateHandoff(handoffText, agentName);
}

// ── Main ──

function main(): void {
  const args = process.argv.slice(2);
  const agentArg = args.find(a => a.startsWith('--agent='));
  const contextArg = args.find(a => a.startsWith('--context='));
  const pipelineArg = args.includes('--pipeline');
  const validateEvidenceChain = args.includes('--validate-evidence-chain');
  const generateTemplate = args.includes('--generate-template');
  const completenessScore = args.includes('--completeness-score');
  const outputArg = args.find(a => a.startsWith('--output='));
  const verbose = args.includes('--verbose');
  const allFlag = args.includes('--all');

  const agentName = agentArg ? agentArg.split('=').slice(1).join('=') : '';

  // ── --generate-template with --pipeline ──
  if (generateTemplate && pipelineArg) {
    const template = generateEvidenceTemplate();
    if (outputArg) {
      const outputPath = outputArg.split('=').slice(1).join('=');
      fs.writeFileSync(path.resolve(outputPath), template, 'utf-8');
      console.log(`📝 Evidence template written to: ${outputPath}`);
    } else {
      console.log(template);
    }
    process.exit(0);
  }

  // ── --generate-template (standalone, reads agent-context.md) ──
  if (generateTemplate) {
    const contextPath = path.resolve('agent-context.md');
    if (!fs.existsSync(contextPath)) {
      console.error('❌ agent-context.md not found. Use --pipeline flag or ensure agent-context.md exists.');
      process.exit(2);
    }
    const template = generateEvidenceTemplate();
    if (outputArg) {
      const outputPath = outputArg.split('=').slice(1).join('=');
      fs.writeFileSync(path.resolve(outputPath), template, 'utf-8');
      console.log(`📝 Evidence template written to: ${outputPath}`);
    } else {
      console.log(template);
    }
    process.exit(0);
  }

  // ── --validate-evidence-chain with --pipeline ──
  if (validateEvidenceChain && pipelineArg && agentName) {
    const contextPath = path.resolve('agent-context.md');
    if (!fs.existsSync(contextPath)) {
      console.error('❌ agent-context.md not found');
      process.exit(2);
    }

    const content = fs.readFileSync(contextPath, 'utf-8');
    const nextObjMatch = content.match(/^nextObjective:\s*"(.*)"/m);
    const nextObjective = nextObjMatch ? nextObjMatch[1] : '';
    const historyMatch = content.match(/agentHistory:\n([\s\S]*?)(?=\n\w|$)/);
    const agentHistory = historyMatch ? historyMatch[1] : '';
    const handoffText = `Objective: ${nextObjective}\nHistory: ${agentHistory}\nContext: ${content.slice(0, 2000)}`;

    const history = parseAgentContext(contextPath);
    const report = extractEvidenceChain(handoffText, history);

    printEvidenceChainReport(report);
    printInvalidatedEvidenceReport(report);

    // Also run the standard hand-off check
    const validationResult = validateHandoff(handoffText, agentName);
    console.log(`📋 Standard Hand-off Check (${agentName}):`);
    console.log(`   Complete: ${validationResult.complete}  (${validationResult.passed}/${validationResult.totalChecks})`);

    const allValid = report.chainCompleteness >= 80 && validationResult.complete;
    process.exit(allValid ? 0 : 1);
  }

  // ── --validate-evidence-chain (standalone, pipe hand-off via stdin) ──
  if (validateEvidenceChain && !pipelineArg && agentName) {
    let input = '';
    process.stdin.on('data', (chunk: Buffer) => { input += chunk.toString(); });
    process.stdin.on('end', () => {
      const contextPath = path.resolve('agent-context.md');
      if (!fs.existsSync(contextPath)) {
        console.error('❌ agent-context.md not found');
        process.exit(2);
      }
      const history = parseAgentContext(contextPath);
      const report = extractEvidenceChain(input, history);
      printEvidenceChainReport(report);
      process.exit(report.chainCompleteness >= 80 ? 0 : 1);
    });
    return;
  }

  // ── --completeness-score with --pipeline ──
  if (completenessScore && pipelineArg && agentName) {
    const contextPath = path.resolve('agent-context.md');
    if (!fs.existsSync(contextPath)) {
      console.error('❌ agent-context.md not found');
      process.exit(2);
    }
    const content = fs.readFileSync(contextPath, 'utf-8');
    const nextObjMatch = content.match(/^nextObjective:\s*"(.*)"/m);
    const nextObjective = nextObjMatch ? nextObjMatch[1] : '';
    const historyMatch = content.match(/agentHistory:\n([\s\S]*?)(?=\n\w|$)/);
    const agentHistory = historyMatch ? historyMatch[1] : '';
    const handoffText = `Objective: ${nextObjective}\nHistory: ${agentHistory}\nContext: ${content.slice(0, 2000)}`;

    const score = computeCompletenessScore(handoffText, agentName);
    printCompletenessScore(score, agentName);
    process.exit(score >= 70 ? 0 : 1);
  }

  // ── --completeness-score (standalone, pipe hand-off via stdin) ──
  if (completenessScore && !pipelineArg && agentName) {
    let input = '';
    process.stdin.on('data', (chunk: Buffer) => { input += chunk.toString(); });
    process.stdin.on('end', () => {
      const score = computeCompletenessScore(input, agentName);
      printCompletenessScore(score, agentName);
      process.exit(score >= 70 ? 0 : 1);
    });
    return;
  }

  // ── Standard --pipeline mode ──
  if (pipelineArg && agentName) {
    const result = validatePipelineHandoff(agentName);
    if (!result) {
      console.error('❌ agent-context.md not found');
      process.exit(2);
    }
    printResult(result);
    process.exit(result.complete ? 0 : 1);
  }

  // ── --context mode ──
  if (agentName && contextArg) {
    const handoffText = contextArg.split('=').slice(1).join('=');
    const result = validateHandoff(handoffText, agentName);
    printResult(result);
    process.exit(result.complete ? 0 : 1);
  }

  // ── --agent with stdin ──
  if (agentName && !contextArg && !pipelineArg) {
    let input = '';
    if (process.stdin.isTTY) {
      console.error('❌ No hand-off text provided. Pipe via stdin or use --context="<text>"');
      process.exit(2);
    }
    process.stdin.on('data', (chunk: Buffer) => { input += chunk.toString(); });
    process.stdin.on('end', () => {
      const result = validateHandoff(input, agentName);
      printResult(result);
      process.exit(result.complete ? 0 : 1);
    });
    return;
  }

  console.log(`
Usage:
  [runtime] check-handoff.ts --agent=<name> --context="<handoff-text>"
  [runtime] check-handoff.ts --agent=<name>                (pipe hand-off text via stdin)
  [runtime] check-handoff.ts --agent=<name> --pipeline     (reads from agent-context.md)

  Evidence Chain:
  [runtime] check-handoff.ts --agent=<name> --validate-evidence-chain --pipeline
  [runtime] check-handoff.ts --agent=<name> --validate-evidence-chain

  Template Generation:
  [runtime] check-handoff.ts --agent=<name> --generate-template --pipeline [--output=<file>]
  [runtime] check-handoff.ts --agent=<name> --generate-template [--output=<file>]

  Completeness Score:
  [runtime] check-handoff.ts --agent=<name> --completeness-score --pipeline
  [runtime] check-handoff.ts --agent=<name> --completeness-score

Agents: finder, plandescriber, implementor, fixer, qa, verifier, integrator, documentor, acceptance-gate
Flags: --verbose, --all, --output=<path>
`);
  process.exit(0);
}

main();
