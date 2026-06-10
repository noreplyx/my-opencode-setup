#!/usr/bin/env node
/**
 * Security Pre-Screening Script
 *
 * Performs a security pre-screening before PlanDescriber creates a plan.
 * Classifies a feature's risk level (standard / sensitive / infrastructure)
 * and produces security considerations that get injected into the plan manifest.
 *
 * TWO MODES:
 *   Mode 1 — Explicit flags: analyze --description text for security keywords
 *   Mode 2 — Source detection: scan source files in --detect-from-source for patterns
 *
 * Usage:
 *   ts-node skills/scripts/orchestration/security-prescreen.ts \
 *     --feature=<name> \
 *     --description="User profile management with PII" \
 *     [--files="src/api/user.ts,src/models/user.ts"] \
 *     [--has-auth=false] \
 *     [--detect-from-source=<dir>]
 *
 * Exit codes:
 *   0 = Success
 *   2 = Error (missing args, invalid directory, etc.)
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Types ───────────────────────────────────────────────────────────────────

type RiskLevel = 'standard' | 'sensitive' | 'infrastructure';

type PlanManifestRiskLevel = 'low' | 'medium' | 'high';

interface SecurityCheckpoint {
  id: string;
  description: string;
  target: string;
  verify: {
    kind: string;
    methodName: string;
    details?: string;
    className?: string;
  };
}

interface CircuitBreakerThreshold {
  supplyChainThreshold: number;
  securityScanRetries: number;
}

interface SecurityConsiderations {
  riskLevel: RiskLevel;
  authRequired: boolean;
  inputValidationRequired: boolean;
  piiHandlingRequired: boolean;
  encryptionRequired: boolean;
  auditLoggingRequired: boolean;
  rateLimitingRequired: boolean;
  securityCheckpoints: SecurityCheckpoint[];
  requiredScans: string[];
  circuitBreakerThreshold: CircuitBreakerThreshold;
  summary: string;
}

interface EvidenceEntry {
  claim: string;
  source: string;
  method: string;
  command: string;
  excerpt: string;
  result: string;
}

interface PrescreenOutput {
  valid: boolean;
  feature: string;
  riskLevel: RiskLevel;
  mappedRiskLevel: PlanManifestRiskLevel;
  securityConsiderations: SecurityConsiderations;
  evidence: EvidenceEntry[];
  errors: string[];
  warnings: string[];
}

interface KeywordMatch {
  keyword: string;
  context: string;
  level: RiskLevel;
}

interface SourceScanResult {
  file: string;
  matches: KeywordMatch[];
}

// ── Constants ───────────────────────────────────────────────────────────────

const SENSITIVE_KEYWORDS: string[] = [
  'auth', 'password', 'login', 'user', 'profile', 'email',
  'pii', 'session', 'token', 'oauth', 'jwt', 'cookie',
  'personal', 'data', 'database', 'sql', 'privacy', 'gdpr', 'ccpa',
];

const INFRASTRUCTURE_KEYWORDS: string[] = [
  'payment', 'billing', 'credit', 'card', 'admin', 'privilege',
  'role', 'secret', 'api key', 'api_key', 'apikey',
  'certificate', 'encryption', 'encrypt', 'ssh', 'firewall',
  'network', 'deployment', 'config', 'environment variable',
  'ci/cd', 'cicd', 'infrastructure',
];

const PII_KEYWORDS: string[] = [
  'pii', 'email', 'phone', 'address', 'ssn', 'social security',
  'credit card', 'credit_card', 'bank', 'personal data',
  'personal information', 'profile', 'user data',
];

const ENCRYPTION_KEYWORDS: string[] = [
  'encryption', 'encrypt', 'decrypt', 'cipher', 'tls',
  'ssl', 'certificate', 'hsm', 'key management',
];

const SCAN_EXTENSIONS: string[] = ['.ts', '.js', '.py', '.java', '.json', '.yaml', '.yml'];

const EXCLUDED_DIRECTORIES: string[] = ['node_modules', '.git', 'dist', 'build', '.next', '.nuxt'];

const RISK_LEVEL_TO_MANIFEST: Record<RiskLevel, PlanManifestRiskLevel> = {
  standard: 'low',
  sensitive: 'medium',
  infrastructure: 'high',
};

const CHECKPOINT_COUNTERS: Record<string, { checkpoint: number; evidence: number }> = {
  password: { checkpoint: 0, evidence: 0 },
  auth: { checkpoint: 0, evidence: 0 },
  login: { checkpoint: 0, evidence: 0 },
  pii: { checkpoint: 0, evidence: 0 },
  email: { checkpoint: 0, evidence: 0 },
  payment: { checkpoint: 0, evidence: 0 },
  admin: { checkpoint: 0, evidence: 0 },
  encryption: { checkpoint: 0, evidence: 0 },
  database: { checkpoint: 0, evidence: 0 },
  token: { checkpoint: 0, evidence: 0 },
  session: { checkpoint: 0, evidence: 0 },
  role: { checkpoint: 0, evidence: 0 },
  privilege: { checkpoint: 0, evidence: 0 },
  profile: { checkpoint: 0, evidence: 0 },
  user: { checkpoint: 0, evidence: 0 },
};

// ── Risk Configurations ─────────────────────────────────────────────────────

function getRiskConfig(riskLevel: RiskLevel, piiDetected: boolean, encryptionDetected: boolean): Omit<SecurityConsiderations, 'riskLevel' | 'summary'> {
  switch (riskLevel) {
    case 'standard':
      return {
        authRequired: false,
        inputValidationRequired: false,
        piiHandlingRequired: false,
        encryptionRequired: false,
        auditLoggingRequired: false,
        rateLimitingRequired: false,
        securityCheckpoints: [],
        requiredScans: ['npm audit'],
        circuitBreakerThreshold: { supplyChainThreshold: 3, securityScanRetries: 1 },
      };
    case 'sensitive':
      return {
        authRequired: true,
        inputValidationRequired: true,
        piiHandlingRequired: piiDetected,
        encryptionRequired: false,
        auditLoggingRequired: true,
        rateLimitingRequired: false,
        securityCheckpoints: [],
        requiredScans: ['npm audit', 'semgrep-sast', 'secrets', 'dependency-scan'],
        circuitBreakerThreshold: { supplyChainThreshold: 2, securityScanRetries: 2 },
      };
    case 'infrastructure':
      return {
        authRequired: true,
        inputValidationRequired: true,
        piiHandlingRequired: true,
        encryptionRequired: encryptionDetected,
        auditLoggingRequired: true,
        rateLimitingRequired: true,
        securityCheckpoints: [],
        requiredScans: ['npm audit', 'semgrep-sast', 'secrets', 'dependency-scan', 'dast', 'container-scan'],
        circuitBreakerThreshold: { supplyChainThreshold: 1, securityScanRetries: 3 },
      };
  }
}

// ── Argument Parsing ────────────────────────────────────────────────────────

function parseArgs(): Record<string, string> {
  const args = process.argv.slice(2);
  const result: Record<string, string> = {};

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showUsageAndExit(0);
  }

  for (const arg of args) {
    if (arg.startsWith('--') && arg.includes('=')) {
      const eqIdx = arg.indexOf('=');
      const key = arg.substring(2, eqIdx);
      const value = arg.substring(eqIdx + 1);
      result[key] = value;
    } else if (arg.startsWith('--')) {
      // Boolean flag
      const key = arg.substring(2);
      result[key] = 'true';
    }
  }

  return result;
}

function showUsageAndExit(exitCode: number): void {
  const usage = `
Security Pre-Screening — Classify feature risk level for plan manifest injection

Usage:
  ts-node skills/scripts/orchestration/security-prescreen.ts \\
    --feature=<name> \\
    --description="User profile management with PII" \\
    [--files="src/api/user.ts,src/models/user.ts"] \\
    [--has-auth=false] \\
    [--detect-from-source=<dir>]

Options:
  --feature               Feature name (required for Mode 1)
  --description           Feature description text (required for Mode 1)
  --files                 Comma-separated list of relevant files (optional)
  --has-auth              Whether feature involves authentication (optional, default: auto-detect)
  --detect-from-source    Scan a source directory for security patterns (Mode 2)

Exit codes:
  0 = Success (JSON output to stdout)
  2 = Error (missing args, invalid directory, etc.)
  `.trim();
  console.log(usage);
  process.exit(exitCode);
}

// ── Keyword Detection ───────────────────────────────────────────────────────

function detectKeywordsInText(text: string): { matches: KeywordMatch[]; level: RiskLevel; piiDetected: boolean; encryptionDetected: boolean } {
  const lowerText = text.toLowerCase();
  const matches: KeywordMatch[] = [];
  let hasSensitive = false;
  let hasInfrastructure = false;
  let piiDetected = false;
  let encryptionDetected = false;

  for (const keyword of SENSITIVE_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      matches.push({ keyword, context: text, level: 'sensitive' });
      hasSensitive = true;
      if (PII_KEYWORDS.includes(keyword)) {
        piiDetected = true;
      }
    }
  }

  for (const keyword of INFRASTRUCTURE_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      matches.push({ keyword, context: text, level: 'infrastructure' });
      hasInfrastructure = true;
      if (ENCRYPTION_KEYWORDS.includes(keyword)) {
        encryptionDetected = true;
      }
      if (PII_KEYWORDS.includes(keyword)) {
        piiDetected = true;
      }
    }
  }

  let level: RiskLevel;
  if (hasInfrastructure) {
    level = 'infrastructure';
  } else if (hasSensitive) {
    level = 'sensitive';
  } else {
    level = 'standard';
  }

  return { matches, level, piiDetected, encryptionDetected };
}

function detectKeywordsInSourceFile(filePath: string, content: string): KeywordMatch[] {
  const matches: KeywordMatch[] = [];
  const fileName = path.basename(filePath);
  const lowerContent = content.toLowerCase();
  const lines = content.split('\n');
  const CHARS_AROUND = 80;

  for (const keyword of SENSITIVE_KEYWORDS) {
    const idx = lowerContent.indexOf(keyword);
    if (idx !== -1) {
      const lineIdx = findLineForIndex(content, idx);
      const line = lines[lineIdx] || '';
      const context = extractContext(line, keyword);
      matches.push({ keyword, context: `${fileName}:${lineIdx + 1} ${context}`, level: 'sensitive' });
    }
  }

  for (const keyword of INFRASTRUCTURE_KEYWORDS) {
    const idx = lowerContent.indexOf(keyword);
    if (idx !== -1) {
      const lineIdx = findLineForIndex(content, idx);
      const line = lines[lineIdx] || '';
      const context = extractContext(line, keyword);
      matches.push({ keyword, context: `${fileName}:${lineIdx + 1} ${context}`, level: 'infrastructure' });
    }
  }

  return matches;
}

function findLineForIndex(content: string, index: number): number {
  const sub = content.substring(0, index);
  return sub.split('\n').length - 1;
}

function extractContext(line: string, keyword: string): string {
  const lowerLine = line.toLowerCase();
  const idx = lowerLine.indexOf(keyword);
  if (idx === -1) return line.trim().substring(0, 120);
  const start = Math.max(0, idx - 40);
  const end = Math.min(line.length, idx + keyword.length + 40);
  const context = line.substring(start, end).trim();
  return context.length <= 120 ? context : context.substring(0, 120) + '...';
}

function isExcludedDir(dir: string): boolean {
  const baseName = path.basename(dir);
  return EXCLUDED_DIRECTORIES.includes(baseName);
}

function isScannableFile(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return SCAN_EXTENSIONS.includes(ext);
}

function scanSourceDirectory(dirPath: string): SourceScanResult[] {
  const results: SourceScanResult[] = [];

  if (!fs.existsSync(dirPath)) {
    return results;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (!isExcludedDir(entry.name)) {
        try {
          const subResults = scanSourceDirectory(fullPath);
          results.push(...subResults);
        } catch {
          // Skip directories that can't be read
        }
      }
    } else if (entry.isFile() && isScannableFile(entry.name)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const matches = detectKeywordsInSourceFile(fullPath, content);
        if (matches.length > 0) {
          results.push({ file: fullPath, matches });
        }
      } catch {
        console.error(`Warning: Could not read file ${fullPath}, skipping`);
      }
    }
  }

  return results;
}

// ── Checkpoint Generation ───────────────────────────────────────────────────

const checkpointIdCounter: Record<string, number> = {};

function generateCheckpointId(): string {
  const prefix = 'CP-SEC';
  if (!checkpointIdCounter[prefix]) {
    checkpointIdCounter[prefix] = 1;
  } else {
    checkpointIdCounter[prefix]++;
  }
  const num = checkpointIdCounter[prefix];
  return `${prefix}-${String(num).padStart(3, '0')}`;
}

function generateCheckpoints(
  riskLevel: RiskLevel,
  matches: KeywordMatch[],
  files: string[],
): SecurityCheckpoint[] {
  const checkpoints: SecurityCheckpoint[] = [];
  const target = files.length > 0 ? files[0] : 'src/services/';

  if (riskLevel === 'standard') {
    return [];
  }

  const matchedKeywords = new Set(matches.map(m => m.keyword));

  if (matchedKeywords.has('auth') || matchedKeywords.has('password') || matchedKeywords.has('login') ||
      matchedKeywords.has('token') || matchedKeywords.has('oauth') || matchedKeywords.has('jwt') ||
      matchedKeywords.has('session')) {
    checkpoints.push({
      id: generateCheckpointId(),
      description: 'Validate authentication enforcement and token handling',
      target,
      verify: { kind: 'hasMiddleware', methodName: 'authenticate' },
    });
  }

  if (matchedKeywords.has('user') || matchedKeywords.has('profile') || matchedKeywords.has('email') ||
      matchedKeywords.has('pii') || matchedKeywords.has('personal') || matchedKeywords.has('privacy') ||
      matchedKeywords.has('gdpr') || matchedKeywords.has('ccpa') || matchedKeywords.has('data')) {
    checkpoints.push({
      id: generateCheckpointId(),
      description: 'Validate input sanitization for user data fields',
      target: files.length > 1 ? files[1] : target,
      verify: { kind: 'validatesInput', methodName: 'processUserData' },
    });
    checkpoints.push({
      id: generateCheckpointId(),
      description: 'Verify PII handling complies with privacy requirements',
      target,
      verify: { kind: 'validatesInput', methodName: 'handlePiiData' },
    });
  }

  if (matchedKeywords.has('database') || matchedKeywords.has('sql')) {
    checkpoints.push({
      id: generateCheckpointId(),
      description: 'Verify parameterized queries and SQL injection prevention',
      target,
      verify: { kind: 'validatesInput', methodName: 'executeQuery' },
    });
  }

  if (riskLevel === 'infrastructure') {
    if (matchedKeywords.has('payment') || matchedKeywords.has('billing') || matchedKeywords.has('credit')) {
      checkpoints.push({
        id: generateCheckpointId(),
        description: 'Validate PCI DSS compliance for payment data handling',
        target,
        verify: { kind: 'validatesInput', methodName: 'processPayment' },
      });
    }

    if (matchedKeywords.has('admin') || matchedKeywords.has('privilege') || matchedKeywords.has('role')) {
      checkpoints.push({
        id: generateCheckpointId(),
        description: 'Verify role-based access control and privilege escalation prevention',
        target,
        verify: { kind: 'hasMiddleware', methodName: 'authorize' },
      });
    }

    if (matchedKeywords.has('encryption') || matchedKeywords.has('secret') || matchedKeywords.has('certificate')) {
      checkpoints.push({
        id: generateCheckpointId(),
        description: 'Verify encryption implementation and secret management',
        target,
        verify: { kind: 'handlesError', methodName: 'encryptData', details: 'Encryption failure handling' },
      });
    }

    if (matchedKeywords.has('config') || matchedKeywords.has('deployment') || matchedKeywords.has('ci/cd') || matchedKeywords.has('cicd') || matchedKeywords.has('infrastructure')) {
      checkpoints.push({
        id: generateCheckpointId(),
        description: 'Verify secure configuration and deployment practices',
        target,
        verify: { kind: 'handlesError', methodName: 'loadConfig', details: 'Configuration validation' },
      });
    }
  }

  // Ensure at least 2 checkpoints for sensitive, 3 for infrastructure
  if (riskLevel === 'sensitive' && checkpoints.length < 2) {
    checkpoints.push({
      id: generateCheckpointId(),
      description: 'Validate audit logging for security-relevant operations',
      target,
      verify: { kind: 'logsAtLevel', methodName: 'logSecurityEvent' },
    });
  }

  if (riskLevel === 'infrastructure' && checkpoints.length < 3) {
    checkpoints.push({
      id: generateCheckpointId(),
      description: 'Verify rate limiting on security-critical endpoints',
      target,
      verify: { kind: 'hasMiddleware', methodName: 'rateLimit' },
    });
    checkpoints.push({
      id: generateCheckpointId(),
      description: 'Validate error message sanitization prevents information leakage',
      target,
      verify: { kind: 'handlesError', methodName: 'handleError', details: 'Error response sanitization' },
    });
  }

  return checkpoints;
}

// ── Evidence Generation ─────────────────────────────────────────────────────

function generateEvidence(
  mode: 'description' | 'source',
  feature: string,
  description: string,
  dirPath: string | null,
  matches: KeywordMatch[],
  riskLevel: RiskLevel,
  scanResults: SourceScanResult[],
): EvidenceEntry[] {
  const evidence: EvidenceEntry[] = [];
  const commandBase = `security-prescreen.ts --feature=${feature}`;

  if (mode === 'description') {
    const matchedKeywords = matches.map(m => m.keyword);
    const uniqueKeywords = [...new Set(matchedKeywords)];

    evidence.push({
      claim: `Feature description contains ${riskLevel}-level security keywords`,
      source: '--description flag',
      method: 'analysis',
      command: `${commandBase} --description="${description.substring(0, 50)}..."`,
      excerpt: `Keywords matched: ${uniqueKeywords.join(', ')}`,
      result: uniqueKeywords.length > 0 ? 'found' : 'none_found',
    });

    evidence.push({
      claim: `Feature description classified as risk level: ${riskLevel}`,
      source: '--description flag',
      method: 'classification',
      command: `${commandBase} --description="${description.substring(0, 50)}..."`,
      excerpt: `Classification result: ${riskLevel} (mapped to plan manifest: ${RISK_LEVEL_TO_MANIFEST[riskLevel]})`,
      result: 'classified',
    });

    // Third evidence if there are specific PII or infrastructure keywords
    if (matches.some(m => PII_KEYWORDS.includes(m.keyword))) {
      const piiKeywords = matches.filter(m => PII_KEYWORDS.includes(m.keyword)).map(m => m.keyword);
      evidence.push({
        claim: 'Feature description contains PII-related keywords',
        source: '--description flag',
        method: 'analysis',
        command: `${commandBase} --description="${description.substring(0, 50)}..."`,
        excerpt: `PII Keywords matched: ${[...new Set(piiKeywords)].join(', ')}`,
        result: 'found',
      });
    }
  } else if (mode === 'source') {
    const totalFilesWithMatches = scanResults.length;
    const totalMatches = scanResults.reduce((sum, r) => sum + r.matches.length, 0);
    const uniqueKeywords = [...new Set(scanResults.flatMap(r => r.matches.map(m => m.keyword)))];

    evidence.push({
      claim: `Source scan found ${totalMatches} security pattern matches across ${totalFilesWithMatches} files`,
      source: dirPath || 'unknown',
      method: 'scan',
      command: `${commandBase} --detect-from-source=${dirPath}`,
      excerpt: `Files matched: ${totalFilesWithMatches}, Total matches: ${totalMatches}, Keywords: ${uniqueKeywords.join(', ')}`,
      result: totalMatches > 0 ? 'found' : 'none_found',
    });

    evidence.push({
      claim: `Source scan classified risk level as: ${riskLevel}`,
      source: dirPath || 'unknown',
      method: 'classification',
      command: `${commandBase} --detect-from-source=${dirPath}`,
      excerpt: `Classification result: ${riskLevel} (mapped to plan manifest: ${RISK_LEVEL_TO_MANIFEST[riskLevel]})`,
      result: 'classified',
    });

    // Third evidence with top matches
    if (scanResults.length > 0 && scanResults[0].matches.length > 0) {
      const topMatch = scanResults[0].matches[0];
      evidence.push({
        claim: `Security pattern detected: "${topMatch.keyword}" in ${path.basename(scanResults[0].file)}`,
        source: scanResults[0].file,
        method: 'scan',
        command: `${commandBase} --detect-from-source=${dirPath}`,
        excerpt: topMatch.context.substring(0, 100),
        result: 'found',
      });
    }
  }

  return evidence;
}

// ── Summary Generation ──────────────────────────────────────────────────────

function generateSummary(riskLevel: RiskLevel, piiDetected: boolean, encryptionDetected: boolean, hasAuth: boolean): string {
  const parts: string[] = [];

  switch (riskLevel) {
    case 'standard':
      parts.push('Feature has no sensitive data, authentication, or PII requirements');
      break;
    case 'sensitive':
      parts.push('Feature handles user');
      if (piiDetected) {
        parts.push('PII data');
      } else {
        parts.push('sensitive data');
      }
      parts.push('requiring auth, input validation');
      if (piiDetected) {
        parts.push(', PII handling');
      }
      parts.push('and audit logging');
      break;
    case 'infrastructure':
      parts.push('Feature involves infrastructure');
      if (piiDetected) {
        parts.push('or PII data');
      }
      parts.push('requiring auth, input validation, audit logging');
      if (encryptionDetected) {
        parts.push(', encryption');
      }
      parts.push(', and rate limiting');
      break;
  }

  return parts.join(' ');
}

// ── Main Classification Logic ───────────────────────────────────────────────

function performPrescreening(
  feature: string,
  description: string,
  files: string[],
  hasAuthFlag: boolean | null,
  dirPath: string | null,
): PrescreenOutput {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!feature) {
    errors.push('Missing required argument: --feature');
  }

  let mode: 'description' | 'source';
  let matches: KeywordMatch[] = [];
  let riskLevel: RiskLevel = 'standard';
  let piiDetected = false;
  let encryptionDetected = false;
  let scanResults: SourceScanResult[] = [];
  const evidence: EvidenceEntry[] = [];

  if (dirPath) {
    mode = 'source';
    if (!fs.existsSync(dirPath)) {
      errors.push(`Directory not found: ${dirPath}`);
    } else if (!fs.statSync(dirPath).isDirectory()) {
      errors.push(`Path is not a directory: ${dirPath}`);
    } else {
      try {
        scanResults = scanSourceDirectory(dirPath);
        const allMatches = scanResults.flatMap(r => r.matches);
        matches = allMatches;

        const hasInfrastructure = allMatches.some(m => m.level === 'infrastructure');
        const hasSensitive = allMatches.some(m => m.level === 'sensitive');

        if (hasInfrastructure) {
          riskLevel = 'infrastructure';
        } else if (hasSensitive) {
          riskLevel = 'sensitive';
        } else {
          riskLevel = 'standard';
        }

        piiDetected = allMatches.some(m => PII_KEYWORDS.includes(m.keyword));
        encryptionDetected = allMatches.some(m => ENCRYPTION_KEYWORDS.includes(m.keyword));
      } catch (err) {
        errors.push(`Error scanning source directory: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } else if (description) {
    mode = 'description';
    const detection = detectKeywordsInText(description);
    matches = detection.matches;
    riskLevel = detection.level;
    piiDetected = detection.piiDetected;
    encryptionDetected = detection.encryptionDetected;

    // Override with explicit --has-auth if provided
    if (hasAuthFlag === true && riskLevel === 'standard') {
      riskLevel = 'sensitive';
    }
  } else {
    mode = 'description';
    warnings.push('No --description or --detect-from-source provided. Defaulting to standard risk.');
  }

  // Build security considerations
  const config = getRiskConfig(riskLevel, piiDetected, encryptionDetected);
  const checkpoints = generateCheckpoints(riskLevel, matches, files);
  const summary = generateSummary(riskLevel, piiDetected, encryptionDetected, hasAuthFlag === true);

  // Move generated checkpoints into config
  config.securityCheckpoints = checkpoints;

  // Generate evidence
  const ev = generateEvidence(mode, feature, description, dirPath, matches, riskLevel, scanResults);
  evidence.push(...ev);

  // Add warning if classification was based on source scan but nothing found
  if (mode === 'source' && matches.length === 0 && dirPath && fs.existsSync(dirPath)) {
    warnings.push('Source scan completed but no security keywords found in scanned files');
  }

  return {
    valid: errors.length === 0,
    feature,
    riskLevel,
    mappedRiskLevel: RISK_LEVEL_TO_MANIFEST[riskLevel],
    securityConsiderations: {
      riskLevel,
      ...config,
      summary,
    },
    evidence,
    errors,
    warnings,
  };
}

// ── CLI Entry Point ─────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs();

  const feature = args['feature'] || '';
  const description = args['description'] || '';
  const filesStr = args['files'] || '';
  const hasAuthStr = args['has-auth'] || null;
  const detectFromSource = args['detect-from-source'] || null;

  const files: string[] = filesStr
    ? filesStr.split(',').map(f => f.trim()).filter(Boolean)
    : [];

  const hasAuthFlag: boolean | null =
    hasAuthStr === 'true' ? true :
    hasAuthStr === 'false' ? false :
    null;

  if (detectFromSource) {
    // Mode 2: Source detection — feature is still required
    if (!feature) {
      console.error('Error: --feature is required');
      process.exit(2);
    }
  } else {
    // Mode 1: Explicit flags — require both --feature and --description
    if (!feature) {
      console.error('Error: --feature is required');
      process.exit(2);
    }
    if (!description) {
      console.error('Error: --description is required (or use --detect-from-source for source scanning mode)');
      process.exit(2);
    }
  }

  const result = performPrescreening(
    feature,
    description,
    files,
    hasAuthFlag,
    detectFromSource,
  );

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.valid ? 0 : 2);
}

// ── Exported API ────────────────────────────────────────────────────────────

export { performPrescreening };
export type {
  RiskLevel,
  PlanManifestRiskLevel,
  SecurityCheckpoint,
  CircuitBreakerThreshold,
  SecurityConsiderations,
  EvidenceEntry,
  PrescreenOutput,
  KeywordMatch,
  SourceScanResult,
};

if (require.main === module) {
  main();
}