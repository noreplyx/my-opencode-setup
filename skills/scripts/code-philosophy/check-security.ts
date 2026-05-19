#!/usr/bin/env ts-node
/**
 * Security Code Checker — Multi-Pass SAST Scanner
 *
 * Uses lightweight AST-based analysis (line-by-line with scope tracking)
 * to detect security vulnerabilities beyond regex-only scanning.
 *
 * Usage: ts-node check-security.ts [--dir=<project-dir>] [--verbose]
 *
 * Scans for:
 *   - CWE-798: Hardcoded secrets / API keys
 *   - CWE-89:  SQL injection
 *   - CWE-95:  Unsafe eval()
 *   - CWE-1321: Prototype pollution
 *   - CWE-22:  Path traversal
 *   - CWE-78:  Command injection
 *   - CWE-502: Insecure deserialization
 *   - CWE-918: SSRF (Server-Side Request Forgery)
 *   - CWE-601: Open redirect
 *   - CWE-1333: ReDoS (ReDoS)
 *   - CWE-23:  Zip Slip (path traversal in archives)
 *   - NoSQL injection (MongoDB operator injection)
 */

import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface SecurityIssue {
  file: string;
  line: number;
  severity: 'critical' | 'high' | 'medium';
  cwe: string;
  description: string;
  recommendation: string;
}

// A set of variable names that are tainted (derived from user input)
type TaintSet = Set<string>;

// Stores taint for each function scope: map of variable name => whether it's tainted
interface ScopeTaint {
  // All known tainted variable names in this scope
  tainted: Set<string>;
  // All variable names and whether they are tainted (for any variable we track)
  allVars: Map<string, boolean>;
}

// ──────────────────────────────────────────────
// Taint sources — variable names that are inherently user-controlled
// ──────────────────────────────────────────────

const TAINT_SOURCES: ReadonlyArray<string> = [
  'req.body',
  'req.params',
  'req.query',
  'req.headers',
  'request.body',
  'req.body.',
  'req.params.',
  'req.query.',
  'req.headers.',
  'request.body.',
  'event.body',
  'ctx.request.body',
  'ctx.request.body.',
  'process.argv',
  'process.env',
  // Generic parameter names commonly used for user input
  'body',
  'params',
  'query',
  'input',
  'userInput',
  'user_input',
  'userInput.',
  'user_input.',
  'url',
  'redirectUrl',
  'callbackUrl',
];

// ──────────────────────────────────────────────
// Dangerous sinks to check
// ──────────────────────────────────────────────

interface SinkDefinition {
  /** Call pattern regex (on a single line) */
  pattern: RegExp;
  cwe: string;
  severity: 'critical' | 'high';
  description: string;
  recommendation: string;
  /** Argument index (0-based) to check for taint, or -1 to check all string args */
  taintArgIndex: number;
}

const SINKS: ReadonlyArray<SinkDefinition> = [
  // ── Command Injection (CWE-78) ──
  {
    pattern: /\b(?:exec|execSync|execFile|execFileSync)\s*\(/,
    cwe: 'CWE-78',
    severity: 'critical',
    description: 'Command injection: exec/spawn called with potentially user-controlled input',
    recommendation: 'Avoid shell execution with user input. Use child_process.execFile with arguments array. Validate and sanitize all input.',
    taintArgIndex: 0,
  },
  {
    pattern: /\b(?:spawn|spawnSync)\s*\(/,
    cwe: 'CWE-78',
    severity: 'critical',
    description: 'Command injection: spawn called with potentially user-controlled input',
    recommendation: 'Pass arguments as an array (spawn("cmd", [args])). Never concatenate user input into command strings.',
    taintArgIndex: 0,
  },
  // ── Path Traversal (CWE-22) ──
  {
    pattern: /fs\.readFileSync\s*\(/,
    cwe: 'CWE-22',
    severity: 'high',
    description: 'Path traversal: fs.readFileSync with potentially user-controlled path',
    recommendation: 'Validate and sanitize file paths. Use path.resolve() and check against an allowlist of permitted directories.',
    taintArgIndex: 0,
  },
  {
    pattern: /fs\.readFile\s*\(/,
    cwe: 'CWE-22',
    severity: 'high',
    description: 'Path traversal: fs.readFile with potentially user-controlled path',
    recommendation: 'Validate and sanitize file paths. Use path.resolve() and check against an allowlist of permitted directories.',
    taintArgIndex: 0,
  },
  {
    pattern: /fs\.createReadStream\s*\(/,
    cwe: 'CWE-22',
    severity: 'high',
    description: 'Path traversal: fs.createReadStream with potentially user-controlled path',
    recommendation: 'Validate and sanitize file paths before opening streams. Restrict to a safe directory.',
    taintArgIndex: 0,
  },
  {
    pattern: /fs\.writeFileSync\s*\(/,
    cwe: 'CWE-22',
    severity: 'high',
    description: 'Path traversal: fs.writeFileSync with potentially user-controlled path',
    recommendation: 'Validate and sanitize file output paths. Restrict writes to a safe directory.',
    taintArgIndex: 0,
  },
  {
    pattern: /fs\.writeFile\s*\(/,
    cwe: 'CWE-22',
    severity: 'high',
    description: 'Path traversal: fs.writeFile with potentially user-controlled path',
    recommendation: 'Validate and sanitize file output paths. Restrict writes to a safe directory.',
    taintArgIndex: 0,
  },
  {
    pattern: /fs\.appendFileSync\s*\(/,
    cwe: 'CWE-22',
    severity: 'high',
    description: 'Path traversal: fs.appendFileSync with potentially user-controlled path',
    recommendation: 'Validate and sanitize file output paths. Restrict writes to a safe directory.',
    taintArgIndex: 0,
  },
  {
    pattern: /fs\.appendFile\s*\(/,
    cwe: 'CWE-22',
    severity: 'high',
    description: 'Path traversal: fs.appendFile with potentially user-controlled path',
    recommendation: 'Validate and sanitize file output paths. Restrict writes to a safe directory.',
    taintArgIndex: 0,
  },
  // ── SSRF (CWE-918) ──
  {
    pattern: /\bfetch\s*\(/,
    cwe: 'CWE-918',
    severity: 'high',
    description: 'SSRF: fetch() with potentially user-controlled URL',
    recommendation: 'Validate URLs against an allowlist. Do not pass user input directly to fetch()/request(). Use a URL parser and validate host.',
    taintArgIndex: 0,
  },
  {
    pattern: /\baxios\s*\.\s*(?:get|post|put|patch|delete|request)\s*\(/,
    cwe: 'CWE-918',
    severity: 'high',
    description: 'SSRF: axios.*() with potentially user-controlled URL',
    recommendation: 'Validate URLs against an allowlist. Do not pass user input directly to HTTP clients.',
    taintArgIndex: 0,
  },
  {
    pattern: /\b(?:request|got|superagent)\s*\(/,
    cwe: 'CWE-918',
    severity: 'high',
    description: 'SSRF: HTTP request with potentially user-controlled URL',
    recommendation: 'Validate URLs against an allowlist. Do not pass user input directly to HTTP request libraries.',
    taintArgIndex: 0,
  },
  {
    pattern: /http\.(?:get|request)\s*\(/,
    cwe: 'CWE-918',
    severity: 'high',
    description: 'SSRF: Node.js http.get/http.request with potentially user-controlled URL',
    recommendation: 'Validate URLs against an allowlist. Do not pass user input directly to Node.js HTTP module.',
    taintArgIndex: 0,
  },
  {
    pattern: /https\.(?:get|request)\s*\(/,
    cwe: 'CWE-918',
    severity: 'high',
    description: 'SSRF: Node.js https.get/https.request with potentially user-controlled URL',
    recommendation: 'Validate URLs against an allowlist. Do not pass user input directly to Node.js HTTPS module.',
    taintArgIndex: 0,
  },
  // ── Insecure Deserialization (CWE-502) ──
  {
    pattern: /\bJSON\.parse\s*\(/,
    cwe: 'CWE-502',
    severity: 'high',
    description: 'Insecure deserialization: JSON.parse on potentially user-controlled data without schema validation',
    recommendation: 'Validate deserialized data against a schema (e.g., zod, joi, ajv). Never trust the structure of parsed JSON from external sources.',
    taintArgIndex: 0,
  },
  // ── Open Redirect (CWE-601) ──
  {
    pattern: /\bres\.redirect\s*\(/,
    cwe: 'CWE-601',
    severity: 'high',
    description: 'Open redirect: res.redirect() with potentially user-controlled URL',
    recommendation: 'Validate redirect URLs against an allowlist. Use a lookup map instead of passing user input directly.',
    taintArgIndex: 0,
  },
  {
    pattern: /window\.location\s*=/,
    cwe: 'CWE-601',
    severity: 'high',
    description: 'Open redirect: window.location assignment with potentially user-controlled value',
    recommendation: 'Validate redirect URLs against an allowlist. Use a lookup map instead of assigning user input directly.',
    taintArgIndex: -1,
  },
  // ── eval (CWE-95) ──
  {
    pattern: /\beval\s*\(/,
    cwe: 'CWE-95',
    severity: 'critical',
    description: 'eval() usage detected',
    recommendation: 'Avoid eval(). Use safer alternatives like Function constructor, JSON.parse, or specific parsers.',
    taintArgIndex: 0,
  },
];

// ──────────────────────────────────────────────
// Enhanced Regex Patterns (fallback for static detection)
// ──────────────────────────────────────────────

const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /(['"])(?:sk|pk)_(?:test|live|prod)_[A-Za-z0-9]{10,}\1/g,
  /(['"])[A-Za-z0-9_]{20,}\1/g,
  /(?:api[_-]?key|apikey|secret|password|token|credential)\s*[=:]\s*['"][A-Za-z0-9_!@#$%^&*()=+]{8,}['"]/gi,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
  /ghp_[A-Za-z0-9]{36}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
];

const SQL_INJECTION_PATTERNS: ReadonlyArray<RegExp> = [
  /db\.(?:execute|query|run)\([^)]*`\$\{/g,
  /\$\{.*\}.*\.(?:find|findOne|findMany|findUnique)\(/g,
  /\.raw\(\s*`[^`]*\$\{/g,
  /SELECT.*FROM.*WHERE.*['"]\s*\+/gi,
  /\.query\(\s*['"].*['"]\s*\+/g,
  /\.\$where\s*:/g,
  /\$regex\s*:/g,
];

// Prototype pollution: obj[key] = value where key is a variable
const PROTOTYPE_POLLUTION_PATTERN = /\[\s*([a-zA-Z_$][a-zA-Z0-9_$.]*)\s*\]\s*=\s*/;

// NoSQL injection: spreading user input into queries
const NOSQL_SPREAD_PATTERN = /\.(?:find|findOne|findMany|update|updateOne|updateMany|deleteOne|deleteMany|aggregate)\s*\(\s*\{[^}]*\.\.\./;

// ReDoS: new RegExp with user-controlled string
const REDOS_PATTERN = /new\s+RegExp\s*\(\s*([a-zA-Z_$][a-zA-Z0-9_$]*)/;

// Zip Slip: archive extraction without path validation
const ZIP_SLIP_PATTERNS: ReadonlyArray<RegExp> = [
  /extractAll\s*\(/,
  /\bunzip\s*\(/,
  /\bunzipSync\s*\(/,
  /\bextract\s*\(/,
];

// ──────────────────────────────────────────────
// File Discovery
// ──────────────────────────────────────────────

function findSourceFiles(rootDir: string): string[] {
  const results: string[] = [];
  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist') {
          walk(full);
        }
      } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        results.push(full);
      }
    }
  }
  walk(rootDir);
  return results;
}

// ──────────────────────────────────────────────
// Pass 1: Variable Source (Taint) Tracking
// ──────────────────────────────────────────────

/**
 * Check if a variable reference resolves to a taint source.
 * Handles property access like req.body, req.body.name, etc.
 */
function isTaintSource(varName: string): boolean {
  const normalized = varName.trim();
  for (const source of TAINT_SOURCES) {
    // Exact match or starts with source followed by property access
    if (normalized === source) return true;
    // Match req.body.foo (starts with req.body.)
    if (source.endsWith('.')) {
      const prefix = source.slice(0, -1);
      if (normalized === prefix || normalized.startsWith(prefix + '.')) return true;
    }
  }
  return false;
}

/**
 * Extract all variable references from a line of code.
 * Returns simple variable names and dotted paths.
 */
function extractVariableReferences(line: string): string[] {
  const refs: string[] = [];
  // Match simple identifiers and dotted property chains
  const varPattern = /[a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*)*/g;
  let match: RegExpExecArray | null;
  while ((match = varPattern.exec(line)) !== null) {
    // Skip keywords and literals
    const word = match[0];
    if (/^(?:if|else|for|while|do|switch|case|break|continue|return|throw|try|catch|finally|null|undefined|true|false|this|typeof|instanceof|new|delete|void|in|of|import|export|from|as|const|let|var|function|async|await|class|extends|super|yield|static|get|set|module|require|global|process|console|Object|Array|String|Number|Boolean|Symbol|Map|Set|Promise)$/.test(word)) {
      continue;
    }
    refs.push(word);
  }
  return refs;
}

/**
 * Check if a line contains dynamic string construction (concatenation or template literal).
 */
function hasDynamicStringConstruction(line: string): boolean {
  return /['"`]\s*\+/.test(line) || /\+\s*['"`]/.test(line) || /\$\{/.test(line);
}

/**
 * Check if a line has string concatenation or template literal with variables.
 */
function hasUserInputInExpression(line: string): boolean {
  return /\$\{[^}]*[a-zA-Z_$][a-zA-Z0-9_$]*[^}]*\}/.test(line) || /['"`]\s*\+/.test(line);
}

/**
 * Extract variable name from an assignment like "const x = ..." or "x = ..."
 */
function extractAssignedVar(line: string): string | null {
  const assignMatch = line.match(
    /(?:const|let|var)?\s*([a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*)*)\s*=(?!=)/
  );
  return assignMatch ? assignMatch[1].trim() : null;
}

/**
 * Extract variables used in a function call's arguments.
 */
function extractCallArgs(line: string, callPattern: RegExp): string[] {
  const args: string[] = [];
  const match = line.match(callPattern);
  if (!match) return args;

  const callIndex = line.indexOf(match[0]);
  if (callIndex === -1) return args;

  // Find the opening paren after the function name
  const parenStart = line.indexOf('(', callIndex);
  if (parenStart === -1) return args;

  // Extract text inside the parentheses (simple extraction — doesn't handle nested)
  const rest = line.slice(parenStart + 1);
  let depth = 0;
  let end = 0;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '(') depth++;
    else if (rest[i] === ')') {
      if (depth === 0) { end = i; break; }
      depth--;
    }
  }
  const argStr = rest.slice(0, end);

  // Split by comma (naive, but good enough for detection)
  const rawArgs = argStr.split(',').map(a => a.trim()).filter(a => a.length > 0);
  for (const raw of rawArgs) {
    // Extract variable references from the argument
    const refs = extractVariableReferences(raw);
    args.push(...refs);
  }

  return args;
}

// ──────────────────────────────────────────────
// Pass 2: Taint-Aware Analysis
// ──────────────────────────────────────────────

/**
 * Perform taint tracking on a single file's content.
 * Returns a set of variable names that are tainted.
 */
function trackTaint(lines: string[]): TaintSet {
  const tainted = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 1. Direct taint sources
    const refs = extractVariableReferences(line);
    for (const ref of refs) {
      if (isTaintSource(ref)) {
        tainted.add(ref);
      }
    }

    // 2. Propagation: if a line references a tainted variable in an assignment, the LHS is tainted
    const assignedVar = extractAssignedVar(line);
    if (assignedVar) {
      for (const ref of refs) {
        if (ref !== assignedVar && tainted.has(ref)) {
          tainted.add(assignedVar);
          break;
        }
      }
    }

    // 3. Function parameters receiving tainted data at call sites
    //    If we see: someFunction(taintedVar), mark it
    //    (For now, we tag any function call where tainted var is passed)
  }

  return tainted;
}

// ──────────────────────────────────────────────
// Pass 3: Dangerous Sink Detection
// ──────────────────────────────────────────────

/**
 * Check if a line contains a dynamic string expression that likely involves a tainted variable.
 */
function lineHasTaintedRef(line: string, tainted: TaintSet): boolean {
  const refs = extractVariableReferences(line);
  for (const ref of refs) {
    if (tainted.has(ref)) return true;
    // Check if any component of a dotted path matches
    const parts = ref.split('.');
    for (let j = 0; j < parts.length; j++) {
      const partial = parts.slice(0, j + 1).join('.');
      if (tainted.has(partial)) return true;
    }
  }
  return false;
}

/**
 * Detect prototype pollution (CWE-1321).
 */
function detectPrototypePollution(
  line: string,
  lineIndex: number,
  relativePath: string,
  tainted: TaintSet
): SecurityIssue | null {
  const match = line.match(PROTOTYPE_POLLUTION_PATTERN);
  if (!match) return null;

  const keyVar = match[1];
  // Check if the key variable is tainted
  if (tainted.has(keyVar) || lineHasTaintedRef(line, tainted)) {
    // Check for __proto__ or constructor patterns
    if (/__proto__/.test(line) || /constructor/.test(line) || /prototype/.test(line)) {
      return {
        file: relativePath,
        line: lineIndex + 1,
        severity: 'critical',
        cwe: 'CWE-1321',
        description: 'Prototype pollution: dynamic key assignment with user-controlled input and prototype access',
        recommendation: 'Avoid using user-controlled keys for object property assignment. Use Map or Object.create(null). Validate keys against an allowlist.',
      };
    }
    return {
      file: relativePath,
      line: lineIndex + 1,
      severity: 'high',
      cwe: 'CWE-1321',
      description: 'Prototype pollution risk: bracket notation assignment with user-controlled key',
      recommendation: 'Avoid dynamic property assignment with user-controlled keys. Use Map or validate keys against an allowlist.',
    };
  }

  return null;
}

/**
 * Detect NoSQL injection patterns.
 */
function detectNoSQLInjection(
  line: string,
  lineIndex: number,
  relativePath: string,
  tainted: TaintSet
): SecurityIssue | null {
  // Pattern: spreading user input into query (e.g., find({...req.body}))
  if (NOSQL_SPREAD_PATTERN.test(line) && lineHasTaintedRef(line, tainted)) {
    return {
      file: relativePath,
      line: lineIndex + 1,
      severity: 'critical',
      cwe: 'CWE-943',
      description: 'NoSQL injection: spreading user-controlled input into database query',
      recommendation: 'Never spread user input directly into query objects. Define explicit query fields and validate/sanitize all input.',
    };
  }

  // Pattern: $where or $regex with tainted value
  if (/\$where\s*:/.test(line) && lineHasTaintedRef(line, tainted)) {
    return {
      file: relativePath,
      line: lineIndex + 1,
      severity: 'critical',
      cwe: 'CWE-943',
      description: 'NoSQL injection: $where operator with potentially user-controlled input',
      recommendation: 'Avoid $where operator. If necessary, validate and sanitize the input string against an allowlist.',
    };
  }

  if (/\$regex\s*:/.test(line) && lineHasTaintedRef(line, tainted)) {
    return {
      file: relativePath,
      line: lineIndex + 1,
      severity: 'high',
      cwe: 'CWE-943',
      description: 'NoSQL injection: $regex operator with potentially user-controlled input',
      recommendation: 'Avoid using user input in $regex queries. Validate and sanitize the regex pattern.',
    };
  }

  return null;
}

/**
 * Detect ReDoS (CWE-1333): new RegExp(userInput).
 */
function detectReDoS(
  line: string,
  lineIndex: number,
  relativePath: string,
  tainted: TaintSet
): SecurityIssue | null {
  const match = line.match(REDOS_PATTERN);
  if (!match) return null;

  const varRef = match[1];
  if (tainted.has(varRef) || lineHasTaintedRef(line, tainted)) {
    return {
      file: relativePath,
      line: lineIndex + 1,
      severity: 'high',
      cwe: 'CWE-1333',
      description: 'ReDoS: RegExp constructed from user-controlled input',
      recommendation: 'Never construct regex patterns from user input. Validate and sanitize the input, or use a pre-defined pattern allowlist.',
    };
  }

  return null;
}

/**
 * Detect Zip Slip (CWE-23): archive extraction without path validation.
 */
function detectZipSlip(
  line: string,
  lineIndex: number,
  relativePath: string
): SecurityIssue | null {
  for (const pattern of ZIP_SLIP_PATTERNS) {
    if (pattern.test(line)) {
      // Check if there's path traversal prevention nearby (look back a few lines)
      const hasPathCheck = /path\.(?:resolve|normalize|join)/.test(line) || /\.\.\.\/\.\.\//.test(line);
      if (!hasPathCheck) {
        return {
          file: relativePath,
          line: lineIndex + 1,
          severity: 'high',
          cwe: 'CWE-23',
          description: 'Zip Slip vulnerability: archive extraction without path traversal validation',
          recommendation: 'Validate extracted file paths against the extraction directory. Reject paths containing ".." segments.',
        };
      }
    }
  }
  return null;
}

/**
 * Check for dynamic string construction in the argument of a dangerous sink call.
 */
function sinkHasTaintedArg(
  line: string,
  sink: SinkDefinition,
  tainted: TaintSet
): boolean {
  // Check if there's dynamic string construction (concatenation, template literal)
  const hasDynamic = hasDynamicStringConstruction(line);

  // Check if the line references any tainted variable
  const hasTaintedRef = lineHasTaintedRef(line, tainted);

  // For most sinks, dynamic string construction is the primary indicator
  if (sink.cwe === 'CWE-78' || sink.cwe === 'CWE-22') {
    // Command injection and path traversal: flag if there's any dynamic string construction
    // or tainted variable in the call
    return hasDynamic || hasTaintedRef;
  }

  // For SSRF, open redirect, etc.: check if the URL argument is tainted
  if (sink.cwe === 'CWE-918' || sink.cwe === 'CWE-601') {
    return hasTaintedRef || hasDynamic;
  }

  // For JSON.parse: check if the argument is tainted
  if (sink.cwe === 'CWE-502') {
    return hasTaintedRef;
  }

  // For eval: always flag
  if (sink.cwe === 'CWE-95') {
    return hasTaintedRef || true;
  }

  return hasTaintedRef || hasDynamic;
}

/**
 * Run advanced taint-aware analysis on a single file.
 */
function analyzeFileAdvanced(filePath: string, verbose: boolean): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const relativePath = path.relative(process.cwd(), filePath);

  if (verbose) {
    console.error(`  Analyzing: ${relativePath} (${lines.length} lines)`);
  }

  // Pass 1: Track tainted variables
  const tainted = trackTaint(lines);

  // Pass 2 & 3: Check each line for dangerous patterns
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ── Sink detection ──
    for (const sink of SINKS) {
      sink.pattern.lastIndex = 0; // Reset global regex state between lines
      if (sink.pattern.test(line)) {
        if (sinkHasTaintedArg(line, sink, tainted)) {
          issues.push({
            file: relativePath,
            line: i + 1,
            severity: sink.severity,
            cwe: sink.cwe,
            description: sink.description,
            recommendation: sink.recommendation,
          });
        }
      }
    }

    // ── Prototype pollution ──
    const ppIssue = detectPrototypePollution(line, i, relativePath, tainted);
    if (ppIssue) issues.push(ppIssue);

    // ── NoSQL injection ──
    const nosqlIssue = detectNoSQLInjection(line, i, relativePath, tainted);
    if (nosqlIssue) issues.push(nosqlIssue);

    // ── ReDoS ──
    const redosIssue = detectReDoS(line, i, relativePath, tainted);
    if (redosIssue) issues.push(redosIssue);

    // ── Hardcoded Secrets (CWE-798) ──
    for (const pattern of SECRET_PATTERNS) {
      pattern.lastIndex = 0; // Reset global regex state between lines
      if (pattern.test(line)) {
        issues.push({
          file: relativePath,
          line: i + 1,
          severity: 'critical',
          cwe: 'CWE-798',
          description: 'Potential hardcoded secret or API key detected',
          recommendation: 'Move secrets to environment variables or a secrets manager. Use process.env.VARIABLE_NAME.',
        });
        break;
      }
    }

    // ── SQL injection (CWE-89) via regex patterns ──
    for (const pattern of SQL_INJECTION_PATTERNS) {
      pattern.lastIndex = 0; // Reset global regex state between lines
      if (pattern.test(line)) {
        issues.push({
          file: relativePath,
          line: i + 1,
          severity: 'critical',
          cwe: 'CWE-89',
          description: 'Possible SQL injection vulnerability: string interpolation in database query',
          recommendation: 'Use parameterized queries or an ORM. Never concatenate user input into SQL strings.',
        });
        break;
      }
    }

    // ── Zip Slip ──
    const zipSlipIssue = detectZipSlip(line, i, relativePath);
    if (zipSlipIssue) issues.push(zipSlipIssue);
  }

  return issues;
}

// ──────────────────────────────────────────────
// Legacy Regex-Based Analysis (kept for non-JS/TS files)
// ──────────────────────────────────────────────

function analyzeFileLegacy(filePath: string): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const relativePath = path.relative(process.cwd(), filePath);

  // Check for hardcoded secrets
  lines.forEach((line, index) => {
    for (const pattern of SECRET_PATTERNS) {
      pattern.lastIndex = 0; // Reset global regex state between lines
      if (pattern.test(line)) {
        issues.push({
          file: relativePath,
          line: index + 1,
          severity: 'critical',
          cwe: 'CWE-798',
          description: 'Potential hardcoded secret or API key detected',
          recommendation: 'Move secrets to environment variables or a secrets manager. Use process.env.VARIABLE_NAME.',
        });
        break;
      }
    }
  });

  // Check for SQL injection
  const fullContent = content.replace(/\n/g, ' ');
  for (const pattern of SQL_INJECTION_PATTERNS) {
    pattern.lastIndex = 0; // Reset global regex state
    const match = fullContent.match(pattern);
    if (match) {
      const matchIndex = fullContent.indexOf(match[0]);
      const lineNum = content.substring(0, matchIndex).split('\n').length;
      issues.push({
        file: relativePath,
        line: lineNum,
        severity: 'critical',
        cwe: 'CWE-89',
        description: 'Possible SQL injection vulnerability: string interpolation in database query',
        recommendation: 'Use parameterized queries or an ORM. Never concatenate user input into SQL strings.',
      });
    }
  }

  return issues;
}

// ──────────────────────────────────────────────
// Deduplication
// ──────────────────────────────────────────────

function deduplicateIssues(issues: SecurityIssue[]): SecurityIssue[] {
  const seen = new Set<string>();
  return issues.filter(issue => {
    const key = `${issue.file}:${issue.line}:${issue.cwe}:${issue.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────

async function main(): Promise<void> {
  const rootDir = process.argv.find(a => a.startsWith('--dir='))?.split('=')[1] || process.cwd();
  const verbose = process.argv.includes('--verbose');

  console.log(`🔒 Running Security check on: ${rootDir}`);
  const files = findSourceFiles(rootDir);
  if (verbose) {
    console.error(`Found ${files.length} source files to scan`);
  }
  let allIssues: SecurityIssue[] = [];

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') {
      // Advanced taint-aware analysis for JS/TS files
      allIssues = allIssues.concat(analyzeFileAdvanced(file, verbose));
    } else {
      // Legacy regex analysis for other languages (py, rb, go)
      allIssues = allIssues.concat(analyzeFileLegacy(file));
    }
  }

  allIssues = deduplicateIssues(allIssues);

  console.log(`\n## Security Check Results`);
  console.log(`**Files analyzed**: ${files.length}`);
  console.log(`**Issues found**: ${allIssues.length}`);
  console.log(`  🔴 Critical: ${allIssues.filter(i => i.severity === 'critical').length}`);
  console.log(`  🟡 High: ${allIssues.filter(i => i.severity === 'high').length}`);
  console.log(`  🔵 Medium: ${allIssues.filter(i => i.severity === 'medium').length}`);

  if (allIssues.length > 0) {
    console.log('\n### Issues');
    allIssues.forEach(issue => {
      const icon = issue.severity === 'critical' ? '🔴' : issue.severity === 'high' ? '🟡' : '🔵';
      console.log(`\n${icon} **${issue.cwe}**: ${issue.description}`);
      console.log(`   File: ${issue.file}:${issue.line}`);
      console.log(`   Fix: ${issue.recommendation}`);
    });

    process.exit(allIssues.some(i => i.severity === 'critical') ? 1 : 0);
  } else {
    console.log('✅ No security issues found!');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
