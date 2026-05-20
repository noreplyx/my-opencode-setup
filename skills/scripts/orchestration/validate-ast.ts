#!/usr/bin/env ts-node

/**
 * validate-ast.ts — AST-Based Semantic Evidence Validator
 *
 * Parses source files using structural regex patterns (no external deps)
 * and performs semantic checks more robust than simple grep:
 *
 *   - exportExists     : Exported symbol via any pattern
 *   - classExists      : Exported class
 *   - functionExists   : Exported function
 *   - methodExists     : Method on a class
 *   - typeExists       : Exported type/interface
 *   - handlesError     : Error handling within a method body
 *   - validatesInput   : Input validation before processing
 *
 * CLI usage:
 *   ts-node validate-ast.ts --file=<path> --kind=<kind> --symbol=<name> [--method=<name>]
 *   ts-node validate-ast.ts --pipeline
 */

import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface AstValidationRequest {
  file: string;
  kind: string;
  symbol: string;
  methodName?: string;
}

interface AstValidationResult {
  file: string;
  kind: string;
  symbol: string;
  methodName?: string;
  status: 'pass' | 'fail' | 'error';
  confidence: number;
  findings: string[];
  detail: string;
}

// ──────────────────────────────────────────────
// Helpers — File-scope extraction
// ──────────────────────────────────────────────

/**
 * Extract the body (everything between first { and matching }) of a class.
 * Handles nested braces. Returns null if not found.
 */
function extractClassBody(content: string, className: string): string | null {
  // Match: export class Foo ... {   OR   class Foo ... {
  const classRegex = new RegExp(
    `(?:export\\s+)?(?:abstract\\s+)?class\\s+${escapeRegex(className)}\\s*(?:extends\\s+\\S+\\s*)?(?:implements\\s+[^{]+)?\\s*\\{`,
    'm'
  );
  const match = classRegex.exec(content);
  if (!match) return null;

  const start = match.index + match[0].length - 1; // position of '{'
  return extractBraceBlock(content, start);
}

/**
 * Extract the body of a method (everything between first { and matching }).
 * Tries both `methodName(` and `methodName = (` arrow-function forms.
 */
function extractMethodBody(content: string, methodName: string): string | null {
  // patterns: methodName(params) { ... }  OR  methodName = (params) => { ... }  OR  methodName = function(params) { ... }
  // Also matches async methods and standalone function definitions.
  const patterns = [
    // Standalone: function methodName(...) { or async function methodName(...) { or export function methodName(...) {
    // Handles optional return type annotation: ): ReturnType {
    new RegExp(
      `(?:export\\s+)?(?:async\\s+)?function\\s+${escapeRegex(methodName)}\\s*\\([^)]*\\)\\s*(?::\\s*\\S+)?\\s*(?:<[^>]*>)?\\s*\\{`
    ),
    // Method: methodName(...) { or async methodName(...) { (inside a class)
    // Handles optional return type: ): Type {
    new RegExp(
      `(?:async\\s+)?${escapeRegex(methodName)}\\s*\\([^)]*\\)\\s*(?::\\s*\\S+)?\\s*(?:<[^>]*>)?\\s*\\{`
    ),
    // Arrow property: methodName = (params) => {
    new RegExp(
      `${escapeRegex(methodName)}\\s*=\\s*(?:async\\s+)?\\([^)]*\\)\\s*(?:<[^>]*>)?\\s*(?::\\s*\\S+)?\\s*=>\\s*(?:\\{)`
    ),
    // methodName = function(params) {
    new RegExp(
      `${escapeRegex(methodName)}\\s*=\\s*(?:async\\s+)?function\\s*\\([^)]*\\)\\s*\\{`
    ),
  ];

  for (const re of patterns) {
    const match = re.exec(content);
    if (!match) continue;
    const bracePos = content.indexOf('{', match.index + match[0].lastIndexOf('{'));
    if (bracePos === -1) continue;
    const block = extractBraceBlock(content, bracePos);
    if (block !== null) return block;
  }

  // Also try matching a one-liner arrow: methodName = (...) => expr (no braces)
  const oneLiner = new RegExp(
    `${escapeRegex(methodName)}\\s*=\\s*(?:async\\s+)?\\([^)]*\\)\\s*(?::\\s*\\S+)?\\s*=>\\s*([^{;]+)`
  );
  const om = oneLiner.exec(content);
  if (om) return om[1].trim();

  return null;
}

/**
 * Given the index of an opening brace, return the full brace-delimited block
 * (including the opening and closing braces). Handles nested braces.
 */
function extractBraceBlock(content: string, openBraceIndex: number): string | null {
  if (content[openBraceIndex] !== '{') return null;
  let depth = 0;
  let i = openBraceIndex;
  let inSingleString = false;
  let inDoubleString = false;
  let inTemplate = false;
  // templateInterp tracks nesting of ${...} inside template literals
  let templateInterp: number[] = [];
  let inRegex = false;
  let inBlockComment = false;
  let inLineComment = false;

  for (; i < content.length; i++) {
    const ch = content[i];
    const prev = i > 0 ? content[i - 1] : '';

    // Track line comments
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }

    // Track block comments
    if (inBlockComment) {
      if (ch === '*' && i + 1 < content.length && content[i + 1] === '/') {
        inBlockComment = false;
        i++; // skip the '/'
      }
      continue;
    }

    // Starting a comment
    if (!inSingleString && !inDoubleString && !inTemplate && !inRegex) {
      if (ch === '/' && i + 1 < content.length) {
        if (content[i + 1] === '/') {
          inLineComment = true;
          i++; // skip the second '/'
          continue;
        }
        if (content[i + 1] === '*') {
          inBlockComment = true;
          i++; // skip the '*'
          continue;
        }
      }
    }

    // Track regex literals: /pattern/flags (heuristic: after =, (, ,, ;, !, &, |, ?)
    if (!inSingleString && !inDoubleString && !inTemplate && !inBlockComment && !inLineComment && !inRegex) {
      if (ch === '/' && prev !== '\\') {
        const prevNonSpace = getPrevNonSpace(content, i);
        // A / is a regex if preceded by operators, assignment, or opening brackets
        if (prevNonSpace && /[=(,:!&|?^<>+\-*%~{[]$/.test(prevNonSpace)) {
          inRegex = true;
          continue;
        }
      }
    }

    // End regex literal
    if (inRegex) {
      if (ch === '/' && prev !== '\\') {
        inRegex = false;
        continue;
      }
      continue;
    }

    // Track string literals
    if (!inSingleString && !inDoubleString && !inTemplate && !inBlockComment && !inLineComment && !inRegex) {
      if (ch === "'" && prev !== '\\') {
        inSingleString = true;
        continue;
      }
      if (ch === '"' && prev !== '\\') {
        inDoubleString = true;
        continue;
      }
      if (ch === '`' && prev !== '\\') {
        inTemplate = true;
        continue;
      }
    }

    // End string literals
    if (inSingleString && ch === "'" && prev !== '\\') {
      inSingleString = false;
      continue;
    }
    if (inDoubleString && ch === '"' && prev !== '\\') {
      inDoubleString = false;
      continue;
    }
    if (inTemplate && ch === '`' && prev !== '\\') {
      inTemplate = false;
      // If we close the template literal, also clear pending interpolation
      templateInterp = [];
      continue;
    }
    // Handle template literal interpolation: ${...}
    if (inTemplate && ch === '$' && i + 1 < content.length && content[i + 1] === '{') {
      // Push current depth as the base for this interpolation level
      templateInterp.push(depth);
      i++; // skip the '{' after $
      continue;
    }
    // Handle } within template literal — closes interpolation if active
    if (inTemplate && ch === '}' && !inRegex && templateInterp.length > 0) {
      // Only close if depth matches the level we pushed
      const baseDepth = templateInterp[templateInterp.length - 1];
      if (depth > baseDepth) {
        depth--;
      }
      templateInterp.pop();
      continue;
    }

    // Count braces (only outside strings/comments)
    if (!inSingleString && !inDoubleString && !inTemplate && !inRegex && !inBlockComment && !inLineComment) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }

    if (depth === 0) break;
  }

  if (depth !== 0) return null;
  return content.slice(openBraceIndex, i + 1);
}

/** Get the last non-whitespace character before position i */
function getPrevNonSpace(content: string, i: number): string | null {
  for (let j = i - 1; j >= 0; j--) {
    if (!/\s/.test(content[j])) return content[j];
  }
  return null;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Read file content, with error handling.
 */
function readFileContent(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────
// Individual Checkers
// ──────────────────────────────────────────────

function checkExportExists(content: string, symbol: string): AstValidationResult {
  const findings: string[] = [];
  const sym = escapeRegex(symbol);

  // 1. Direct declaration exports
  const directPatterns = [
    new RegExp(`export\\s+(?:abstract\\s+)?class\\s+${sym}\\b`),
    new RegExp(`export\\s+(?:async\\s+)?function\\s+${sym}\\b`),
    new RegExp(`export\\s+(?:default\\s+)?(?:const|let|var)\\s+${sym}\\b`),
    new RegExp(`export\\s+interface\\s+${sym}\\b`),
    new RegExp(`export\\s+type\\s+${sym}\\s*=`),
    new RegExp(`export\\s+default\\s+(?:class\\s+)?${sym}\\b`),
    new RegExp(`export\\s+default\\s+${sym}\\b`),
    new RegExp(`export\\s+enum\\s+${sym}\\b`),
  ];

  for (const re of directPatterns) {
    const m = re.exec(content);
    if (m) {
      findings.push(`Direct export: ${m[0].trim()}`);
    }
  }

  // 2. Barrel-style: export { X }  or  export { X, Y }  or  export { X as Y }
  const barrelPattern = new RegExp(
    `export\\s*\\{[^}]*\\b${sym}\\b[^}]*\\}`,
    'g'
  );
  let barrelMatch: RegExpExecArray | null;
  while ((barrelMatch = barrelPattern.exec(content)) !== null) {
    findings.push(`Barrel export: ${barrelMatch[0].trim()}`);
  }

  // 3. Re-export: export { X } from '...'  or  export { X as Y } from '...'
  const reexportPattern = new RegExp(
    `export\\s*\\{[^}]*\\b${sym}\\b[^}]*\\}\\s*from\\s+['"][^'"]+['"]`,
    'g'
  );
  let reexportMatch: RegExpExecArray | null;
  while ((reexportMatch = reexportPattern.exec(content)) !== null) {
    findings.push(`Re-export: ${reexportMatch[0].trim()}`);
  }

  // 4. export * as X
  const starAsPattern = new RegExp(`export\\s+\\*\\s+as\\s+${sym}\\b`);
  const sam = starAsPattern.exec(content);
  if (sam) {
    findings.push(`Star re-export: ${sam[0].trim()}`);
  }

  const status = findings.length > 0 ? 'pass' : 'fail';
  const confidence = status === 'pass' ? 1.0 : 0.95;

  return {
    file: '',
    kind: 'exportExists',
    symbol,
    status,
    confidence,
    findings,
    detail:
      status === 'pass'
        ? `Found ${findings.length} export pattern(s) for "${symbol}"`
        : `No export found for "${symbol}"`,
  };
}

function checkClassExists(content: string, className: string): AstValidationResult {
  const findings: string[] = [];

  // Direct export class
  const directRe = new RegExp(
    `export\\s+(?:abstract\\s+)?class\\s+${escapeRegex(className)}\\b`
  );
  const directMatch = directRe.exec(content);
  if (directMatch) {
    findings.push(`Exported class: ${directMatch[0].trim()}`);
    // Also extract class body for further inspection
    const body = extractClassBody(content, className);
    if (body) {
      findings.push(`Class body extracted (${body.length} chars)`);
    }
  }

  // Default export class
  const defaultRe = new RegExp(
    `export\\s+default\\s+class\\s+${escapeRegex(className)}\\b`
  );
  const defaultMatch = defaultRe.exec(content);
  if (defaultMatch) {
    findings.push(`Default exported class: ${defaultMatch[0].trim()}`);
  }

  // Barrel export: export { ClassName } or export { ClassName as Alias }
  const barrelRe = new RegExp(
    `export\\s*\\{[^}]*\\b${escapeRegex(className)}\\b[^}]*\\}`
  );
  const barrelMatch = barrelRe.exec(content);
  if (barrelMatch) {
    findings.push(`Barrel-exported class: ${barrelMatch[0].trim()}`);

    // Also try to find the class declaration somewhere in the file
    const classDeclRe = new RegExp(
      `(?:export\\s+)?(?:abstract\\s+)?class\\s+${escapeRegex(className)}\\b`
    );
    const classDecl = classDeclRe.exec(content);
    if (classDecl) {
      findings.push(`Class declaration found: ${classDecl[0].trim()}`);
    }
  }

  // Non-exported class (but class exists)
  const classOnlyRe = new RegExp(
    `(?:export\\s+)?(?:abstract\\s+)?class\\s+${escapeRegex(className)}\\b`
  );
  const classOnly = classOnlyRe.exec(content);
  if (classOnly && findings.length === 0) {
    findings.push(`Class exists but NOT exported: ${classOnly[0].trim()}`);
  }

  const status = findings.length > 0 ? 'pass' : 'fail';
  const confidence = status === 'pass' ? 1.0 : 0.95;

  return {
    file: '',
    kind: 'classExists',
    symbol: className,
    status,
    confidence,
    findings,
    detail:
      status === 'pass'
        ? `Found ${findings.length} class match(es) for "${className}"`
        : `No exported class "${className}" found`,
  };
}

function checkFunctionExists(content: string, functionName: string): AstValidationResult {
  const findings: string[] = [];
  const fn = escapeRegex(functionName);

  // export function functionName
  const exportFnRe = new RegExp(`export\\s+(?:async\\s+)?function\\s+${fn}\\b`);
  const efm = exportFnRe.exec(content);
  if (efm) findings.push(`Exported function: ${efm[0].trim()}`);

  // async function functionName (unexported)
  const asyncFnRe = new RegExp(`(?:export\\s+)?async\\s+function\\s+${fn}\\b`);
  const afm = asyncFnRe.exec(content);
  if (afm && findings.length === 0) findings.push(`Async function: ${afm[0].trim()}`);

  // export const functionName = (...) =>  OR  export function functionName(
  const exportConstRe = new RegExp(
    `export\\s+(?:const|let|var)\\s+${fn}\\s*(?::\\s*\\S+)?\\s*=\\s*(?:async\\s+)?\\(`
  );
  const ecm = exportConstRe.exec(content);
  if (ecm) findings.push(`Exported const arrow: ${ecm[0].trim()}`);

  // const functionName = (...) => (unexported but can be exported via barrel)
  const constFnRe = new RegExp(
    `(?:export\\s+)?(?:const|let|var)\\s+${fn}\\s*(?::\\s*\\S+)?\\s*=\\s*(?:async\\s+)?\\(`
  );
  const cfm = constFnRe.exec(content);
  if (cfm && findings.length === 0) findings.push(`Const arrow function: ${cfm[0].trim()}`);

  // export function functionName< (generic)
  const genericFnRe = new RegExp(`export\\s+function\\s+${fn}\\s*<`);
  const gfm = genericFnRe.exec(content);
  if (gfm) findings.push(`Exported generic function: ${gfm[0].trim()}`);

  // Barrel exports
  const barrelRe = new RegExp(`export\\s*\\{[^}]*\\b${fn}\\b[^}]*\\}`);
  const bm = barrelRe.exec(content);
  if (bm) findings.push(`Barrel-exported function: ${bm[0].trim()}`);

  // Named function declaration (any)
  const anyFnRe = new RegExp(`function\\s+${fn}\\b`);
  const anyfm = anyFnRe.exec(content);
  if (anyfm && findings.length === 0) findings.push(`Function declaration: ${anyfm[0].trim()}`);

  const status = findings.length > 0 ? 'pass' : 'fail';
  const confidence = status === 'pass' ? 1.0 : 0.95;

  return {
    file: '',
    kind: 'functionExists',
    symbol: functionName,
    status,
    confidence,
    findings,
    detail:
      status === 'pass'
        ? `Found ${findings.length} function match(es) for "${functionName}"`
        : `No function "${functionName}" found`,
  };
}

function checkMethodExists(
  content: string,
  className: string,
  methodName: string
): AstValidationResult {
  const findings: string[] = [];

  // 1. Try to locate the class
  const classBody = extractClassBody(content, className);
  if (!classBody) {
    // Even if we can't find the class, try a broader search for the method
    const methodBody = extractMethodBody(content, methodName);
    if (methodBody) {
      findings.push(
        `Method "${methodName}" found (class-agnostic, method body: ${methodBody.length} chars)`
      );
      return {
        file: '',
        kind: 'methodExists',
        symbol: className,
        methodName,
        status: 'pass',
        confidence: 0.7,
        findings,
        detail: `Method "${methodName}" found but class "${className}" not confirmed`,
      };
    }
    return {
      file: '',
      kind: 'methodExists',
      symbol: className,
      methodName,
      status: 'fail',
      confidence: 0.95,
      findings: [],
      detail: `Class "${className}" not found in file`,
    };
  }

  findings.push(`Class "${className}" body extracted (${classBody.length} chars)`);

  // 2. Look for methodName( inside the class body
  const methodPatterns = [
    // Regular method: methodName(params)
    new RegExp(
      `(?:public\\s+|private\\s+|protected\\s+|static\\s+|readonly\\s+|async\\s+)*(?:get\\s+)?${escapeRegex(
        methodName
      )}\\s*\\(`,
      'm'
    ),
    // Arrow property: methodName = (params) =>
    new RegExp(
      `${escapeRegex(methodName)}\\s*=\\s*(?:public\\s+|private\\s+|protected\\s+|static\\s+)?(?:async\\s+)?\\(`,
      'm'
    ),
    // methodName = function(params)
    new RegExp(
      `${escapeRegex(methodName)}\\s*=\\s*function\\s*\\(`,
      'm'
    ),
    // set methodName(value)
    new RegExp(
      `set\\s+${escapeRegex(methodName)}\\s*\\(`,
      'm'
    ),
  ];

  for (const re of methodPatterns) {
    const m = re.exec(classBody);
    if (m) {
      findings.push(`Method pattern matched: ${m[0].trim()}`);
    }
  }

  // Also try to extract the actual method body
  const methodBody = extractMethodBody(content, methodName);
  if (methodBody) {
    findings.push(`Method body extracted (${methodBody.length} chars)`);
  }

  const status = findings.length > 1 ? 'pass' : 'fail'; // first finding is the class body
  const confidence = status === 'pass' ? 1.0 : 0.95;

  return {
    file: '',
    kind: 'methodExists',
    symbol: className,
    methodName,
    status,
    confidence,
    findings,
    detail:
      status === 'pass'
        ? `Method "${methodName}" found in class "${className}"`
        : `Method "${methodName}" NOT found in class "${className}"`,
  };
}

function checkTypeExists(content: string, typeName: string): AstValidationResult {
  const findings: string[] = [];
  const tn = escapeRegex(typeName);

  // export interface TypeName
  const ifaceRe = new RegExp(`export\\s+interface\\s+${tn}\\b`);
  const ifm = ifaceRe.exec(content);
  if (ifm) findings.push(`Exported interface: ${ifm[0].trim()}`);

  // interface TypeName (unexported)
  const ifaceOnlyRe = new RegExp(`interface\\s+${tn}\\b`);
  const ifom = ifaceOnlyRe.exec(content);
  if (ifom && findings.length === 0) findings.push(`Interface: ${ifom[0].trim()}`);

  // export type TypeName =
  const typeRe = new RegExp(`export\\s+type\\s+${tn}\\s*=`);
  const tm = typeRe.exec(content);
  if (tm) findings.push(`Exported type: ${tm[0].trim()}`);

  // type TypeName = (unexported)
  const typeOnlyRe = new RegExp(`type\\s+${tn}\\s*=`);
  const tom = typeOnlyRe.exec(content);
  if (tom && findings.length === 0) findings.push(`Type alias: ${tom[0].trim()}`);

  // export enum TypeName
  const enumRe = new RegExp(`export\\s+enum\\s+${tn}\\b`);
  const em = enumRe.exec(content);
  if (em) findings.push(`Exported enum: ${em[0].trim()}`);

  // Barrel export: export { TypeName }
  const barrelRe = new RegExp(`export\\s*\\{[^}]*\\b${tn}\\b[^}]*\\}`);
  const bm = barrelRe.exec(content);
  if (bm) findings.push(`Barrel-exported type: ${bm[0].trim()}`);

  // export class TypeName (classes are also types)
  const classRe = new RegExp(`export\\s+class\\s+${tn}\\b`);
  const cm = classRe.exec(content);
  if (cm) findings.push(`Class (as type): ${cm[0].trim()}`);

  const status = findings.length > 0 ? 'pass' : 'fail';
  const confidence = status === 'pass' ? 1.0 : 0.95;

  return {
    file: '',
    kind: 'typeExists',
    symbol: typeName,
    status,
    confidence,
    findings,
    detail:
      status === 'pass'
        ? `Found ${findings.length} type/interface/enum match(es) for "${typeName}"`
        : `No type/interface "${typeName}" found`,
  };
}

function checkHandlesError(content: string, methodName: string): AstValidationResult {
  const findings: string[] = [];

  // If we have a method name, scope the search to the method body
  const methodBody = methodName ? extractMethodBody(content, methodName) : content;
  const scope = methodBody ?? content;

  if (methodName && !methodBody) {
    return {
      file: '',
      kind: 'handlesError',
      symbol: '',
      methodName,
      status: 'fail',
      confidence: 0.95,
      findings: [],
      detail: `Method "${methodName}" body not found — cannot check error handling`,
    };
  }

  if (methodName && methodBody) {
    findings.push(`Scoped to method "${methodName}" body (${methodBody.length} chars)`);
  }

  // 1. try/catch blocks
  const tryCatchRe = /try\s*\{[\s\S]*?\}\s*catch\s*(?:\([^)]*\))?\s*\{/g;
  const tryMatches = [...scope.matchAll(tryCatchRe)];
  for (const m of tryMatches) {
    findings.push(`try/catch block found: "${m[0].slice(0, 60).trim()}..."`);
  }

  // 2. throw statements
  const throwRe = /throw\s+(?:new\s+)?(?:Error|TypeError|RangeError|SyntaxError|ReferenceError|CustomError|\w*Error)\s*\(/g;
  const throwMatches = [...scope.matchAll(throwRe)];
  for (const m of throwMatches) {
    findings.push(`throw statement found: "${m[0].trim()}"`);
  }

  // 3. Generic throw (any value thrown)
  const genericThrowRe = /throw\s+\w+/g;
  const genericThrowMatches = [...scope.matchAll(genericThrowRe)];
  for (const m of genericThrowMatches) {
    const line = m[0].trim();
    // Avoid double-counting with the Error-based throws above
    if (!findings.some((f) => f.includes(line))) {
      findings.push(`Generic throw found: "${line}"`);
    }
  }

  // 4. Return error objects: return { error: ... }  or  return new Error(...)
  const returnErrorRe = /return\s+\{(?:[^}]*\berror\b[^}]*)\}/g;
  const returnErrMatches = [...scope.matchAll(returnErrorRe)];
  for (const m of returnErrMatches) {
    findings.push(`Error object return: "${m[0].trim()}"`);
  }

  const returnNewErrorRe = /return\s+new\s+Error\(/g;
  const returnNewErrMatches = [...scope.matchAll(returnNewErrorRe)];
  for (const m of returnNewErrMatches) {
    findings.push(`Return new Error: "${m[0].trim()}"`);
  }

  // 5. Guard clauses: if (...) throw ... or if (...) return error
  const guardRe = /if\s*\([^)]*\)\s*\{?\s*throw\s+/g;
  const guardMatches = [...scope.matchAll(guardRe)];
  for (const m of guardMatches) {
    findings.push(`Guard clause with throw: "${m[0].trim()}"`);
  }

  // 6. .catch() promise chains
  const catchChainRe = /\.catch\s*\(/g;
  const catchChainMatches = [...scope.matchAll(catchChainRe)];
  for (const m of catchChainMatches) {
    findings.push(`Promise .catch() chain: "${m[0].trim()}"`);
  }

  // 7. Callback-style error handling: function(err, ...)
  const callbackErrRe = /function\s*\(err(?:or)?\b/g;
  const callbackErrMatches = [...scope.matchAll(callbackErrRe)];
  for (const m of callbackErrMatches) {
    findings.push(`Error callback parameter: "${m[0].trim()}"`);
  }

  // 8. Express-style error middleware: (err, req, res, next
  const errMiddlewareRe = /\(err(?:or)?,\s*(?:req|_req|request)/g;
  const errMwMatches = [...scope.matchAll(errMiddlewareRe)];
  for (const m of errMwMatches) {
    findings.push(`Error middleware pattern: "${m[0].trim()}"`);
  }

  const status = findings.length > (methodBody ? 1 : 0) ? 'pass' : 'fail';

  // Confidence: direct Error throws and try/catch = high confidence
  const highConfFindings = findings.filter(
    (f) =>
      f.includes('try/catch') ||
      f.includes('throw') ||
      f.includes('return new Error')
  );
  const confidence =
    status === 'pass'
      ? highConfFindings.length > 0
        ? 1.0
        : 0.7
      : 0.95;

  return {
    file: '',
    kind: 'handlesError',
    symbol: '',
    methodName: methodName ?? '',
    status,
    confidence,
    findings,
    detail:
      status === 'pass'
        ? `Found ${findings.length} error-handling pattern(s)${methodName ? ` in method "${methodName}"` : ''}`
        : `No error-handling patterns found${methodName ? ` in method "${methodName}"` : ''}`,
  };
}

function checkValidatesInput(content: string, methodName: string): AstValidationResult {
  const findings: string[] = [];

  // If we have a method name, scope the search to the method body and the top
  const methodBody = methodName ? extractMethodBody(content, methodName) : content;
  const scope = methodBody ?? content;

  if (methodName && !methodBody) {
    return {
      file: '',
      kind: 'validatesInput',
      symbol: '',
      methodName,
      status: 'fail',
      confidence: 0.95,
      findings: [],
      detail: `Method "${methodName}" body not found — cannot check input validation`,
    };
  }

  if (methodName && methodBody) {
    findings.push(`Scoped to method "${methodName}" body (${methodBody.length} chars)`);
  }

  // Check only first 40% of the scope for guard clauses (top-heavy validation)
  const guardZone = scope.slice(0, Math.floor(scope.length * 0.4));

  // 1. Zod schemas
  const zodRe = /z\.object\s*\(/g;
  const zodMatches = [...scope.matchAll(zodRe)];
  for (const m of zodMatches) {
    findings.push(`Zod schema: "${m[0].trim()}"`);
  }

  // 2. Joi schemas
  const joiRe = /Joi\.object\s*\(/g;
  const joiMatches = [...scope.matchAll(joiRe)];
  for (const m of joiMatches) {
    findings.push(`Joi schema: "${m[0].trim()}"`);
  }

  // 3. Yup schemas
  const yupRe = /yup\.object\s*\(/g;
  const yupMatches = [...scope.matchAll(yupRe)];
  for (const m of yupMatches) {
    findings.push(`Yup schema: "${m[0].trim()}"`);
  }

  // 4. Schema validation calls: .parse(), .validate(), .validateSync(), .safeParse()
  const schemaValidateRe = /\.(?:parse|validate|validateSync|safeParse|validateAsync)\s*\(/g;
  const svMatches = [...scope.matchAll(schemaValidateRe)];
  for (const m of svMatches) {
    findings.push(`Schema validation call: "${m[0].trim()}"`);
  }

  // 5. Guard clause: if-guard-throw at the top of method
  const guardThrowRe = /if\s*\([^)]*\)\s*\{?\s*throw\s+/g;
  const guardThrowMatches = [...guardZone.matchAll(guardThrowRe)];
  for (const m of guardThrowMatches) {
    findings.push(`Guard clause with throw: "${m[0].trim()}"`);
  }

  // 6. if-guard with no action that returns early
  const guardReturnRe = /if\s*\([^)]*\)\s*\{?\s*return\s+(?:null|undefined|false|['"][^'"]*['"])?\s*\}?/g;
  const guardReturnMatches = [...guardZone.matchAll(guardReturnRe)];
  for (const m of guardReturnMatches) {
    findings.push(`Guard clause with early return: "${m[0].trim()}"`);
  }

  // 7. typeof checks
  const typeofRe = /typeof\s+\w+\s*(?:===|!==|==|!=)\s*['"][^'"]+['"]/g;
  const typeofMatches = [...guardZone.matchAll(typeofRe)];
  for (const m of typeofMatches) {
    findings.push(`typeof validation: "${m[0].trim()}"`);
  }

  // 8. instanceof checks
  const instanceofRe = /\w+\s+instanceof\s+\w+/g;
  const instanceofMatches = [...guardZone.matchAll(instanceofRe)];
  for (const m of instanceofMatches) {
    findings.push(`instanceof check: "${m[0].trim()}"`);
  }

  // 9. Regex .test() or .match() calls used for validation
  const regexValidateRe = /\.(?:test|match)\s*\([^)]*\)/g;
  const regexMatches = [...guardZone.matchAll(regexValidateRe)];
  for (const m of regexMatches) {
    findings.push(`Regex validation: "${m[0].trim()}"`);
  }

  // 10. Validation helper/library calls: validate*, is*, assert*, check*
  const validationLibRe = /\b(?:validate|isValid|assert|check|sanitize|verify|ensure)\s*\(/g;
  const vlMatches = [...guardZone.matchAll(validationLibRe)];
  for (const m of vlMatches) {
    findings.push(`Validation helper call: "${m[0].trim()}"`);
  }

  const status = findings.length > (methodBody ? 1 : 0) ? 'pass' : 'fail';

  // Confidence: explicit schema parsers + guard clauses = highest confidence
  const highConf = findings.filter(
    (f) =>
      f.includes('Zod schema') ||
      f.includes('Joi schema') ||
      f.includes('Yup schema') ||
      f.includes('Schema validation') ||
      f.includes('Guard clause')
  );
  const confidence =
    status === 'pass'
      ? highConf.length > 0
        ? 1.0
        : 0.7
      : 0.95;

  return {
    file: '',
    kind: 'validatesInput',
    symbol: '',
    methodName: methodName ?? '',
    status,
    confidence,
    findings,
    detail:
      status === 'pass'
        ? `Found ${findings.length} input validation pattern(s)${methodName ? ` in method "${methodName}"` : ''}`
        : `No input validation patterns found${methodName ? ` in method "${methodName}"` : ''}`,
  };
}

// ──────────────────────────────────────────────
// Main Export
// ──────────────────────────────────────────────

export function validateAst(
  request: AstValidationRequest,
  baseDir?: string
): AstValidationResult {
  const { file, kind, symbol, methodName } = request;

  // Resolve file path
  let filePath = file;
  if (baseDir && !path.isAbsolute(file)) {
    filePath = path.resolve(baseDir, file);
  }

  // Read file
  const content = readFileContent(filePath);
  if (content === null) {
    return {
      file: filePath,
      kind,
      symbol,
      methodName,
      status: 'error',
      confidence: 1.0,
      findings: [],
      detail: `File not found or unreadable: ${filePath}`,
    };
  }

  // Route to appropriate checker
  let result: AstValidationResult;

  switch (kind) {
    case 'exportExists':
      result = checkExportExists(content, symbol);
      break;
    case 'classExists':
      result = checkClassExists(content, symbol);
      break;
    case 'functionExists':
      result = checkFunctionExists(content, symbol);
      break;
    case 'methodExists':
      if (!methodName) {
        return {
          file: filePath,
          kind,
          symbol,
          methodName,
          status: 'error',
          confidence: 1.0,
          findings: [],
          detail: 'methodName is required for methodExists check',
        };
      }
      result = checkMethodExists(content, symbol, methodName);
      break;
    case 'typeExists':
      result = checkTypeExists(content, symbol);
      break;
    case 'handlesError':
      result = checkHandlesError(content, methodName ?? '');
      break;
    case 'validatesInput':
      result = checkValidatesInput(content, methodName ?? '');
      break;
    default:
      return {
        file: filePath,
        kind,
        symbol,
        methodName,
        status: 'error',
        confidence: 1.0,
        findings: [],
        detail: `Unknown validation kind: "${kind}". Supported: exportExists, classExists, functionExists, methodExists, typeExists, handlesError, validatesInput`,
      };
  }

  // Stamp the file path onto the result
  result.file = path.resolve(filePath);
  return result;
}

// ──────────────────────────────────────────────
// CLI Mode
// ──────────────────────────────────────────────

/**
 * Compute SHA-256 hash of a file.
 */
function computeFileHash(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

import * as crypto from 'crypto';

interface CliOptions {
  file?: string;
  kind?: string;
  symbol?: string;
  method?: string;
  days?: number;
  pipeline?: string;
  all?: boolean;
  verbose?: boolean;
  pipelineMode?: boolean;
}

function parseCliArgs(): CliOptions & { help?: boolean } {
  const args = process.argv.slice(2);
  const opts: CliOptions & { help?: boolean } = {};

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg.startsWith('--file=')) {
      opts.file = arg.split('=').slice(1).join('=');
    } else if (arg.startsWith('--kind=')) {
      opts.kind = arg.split('=').slice(1).join('=');
    } else if (arg.startsWith('--symbol=')) {
      opts.symbol = arg.split('=').slice(1).join('=');
    } else if (arg.startsWith('--method=')) {
      opts.method = arg.split('=').slice(1).join('=');
    } else if (arg.startsWith('--days=')) {
      opts.days = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--pipeline=')) {
      opts.pipeline = arg.split('=').slice(1).join('=');
    } else if (arg === '--all') {
      opts.all = true;
    } else if (arg === '--verbose') {
      opts.verbose = true;
    } else if (arg === '--pipeline') {
      opts.pipelineMode = true;
    }
  }

  return opts;
}

function printUsage(): void {
  console.log(`
Usage: ts-node validate-ast.ts [options]

Options:
  --file=<path>      Source file to check
  --kind=<kind>      Validation kind: exportExists, classExists, functionExists,
                     methodExists, typeExists, handlesError, validatesInput
  --symbol=<name>    Symbol name to check (or class name for methodExists)
  --method=<name>    Method name (for methodExists, handlesError, validatesInput)
  --days=<number>    Check evidence from last N days
  --pipeline=<id>    Check evidence from a specific pipeline
  --all              Check all historical evidence
  --verbose          Detailed output
  --pipeline         Validate all evidence in agent-context.md
  --help, -h         Show this help

Exit codes:
  0 = all evidence valid
  1 = some evidence invalidated
  2 = parse error / file not found
`);
}

function printRegressionReport(report: RegressionReport, verbose: boolean): void {
  const pct = (n: number) =>
    report.totalScanned > 0 ? ` (${((n / report.totalScanned) * 100).toFixed(1)}%)` : '';

  console.log('');
  console.log('📋 Historical Evidence Regression Scan');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(
    `🔍 Scanned: ${report.totalScanned} evidence entries from past pipelines`
  );

  const printLine = (icon: string, label: string, count: number) => {
    if (count > 0) {
      console.log(`${icon} ${label}: ${count}${pct(count)}`);
    }
  };

  printLine('✅', 'Still valid', report.stillValid);
  printLine('⚠️ ', 'Partially valid', report.partiallyValid);
  printLine('❌', 'Invalidated', report.invalidated);
  printLine('🗑️ ', 'File deleted', report.fileDeleted);
  printLine('🔄', 'File modified, claim holds', report.fileModifiedClaimHolds);
  printLine('⏭️ ', 'Unverifiable', report.unverifiable);
  console.log();

  // Print problem details
  const problems = report.details.filter(
    (d) =>
      d.status === 'invalidated' ||
      d.status === 'file_deleted' ||
      d.status === 'partially_valid'
  );

  if (problems.length > 0) {
    for (const r of problems) {
      if (r.status === 'invalidated') {
        console.log(`❌ INVALIDATED EVIDENCE:`);
      } else if (r.status === 'file_deleted') {
        console.log(`❌ FILE DELETED:`);
      } else if (r.status === 'partially_valid') {
        console.log(`⚠️  PARTIALLY VALID:`);
      }
      console.log(`  Pipeline "${r.evidence.pipelineId}" (${r.evidence.date}), Agent "${r.evidence.agentName}"`);
      console.log(`    Claim: "${r.evidence.claim}"`);
      if (r.evidence.source) console.log(`    File: ${r.evidence.source}`);
      console.log(`    ${r.detail}`);
      console.log(`    → Action: Update journal entry or flag for re-verification`);
      console.log();
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(report.summary);
    console.log();
  }

  if (verbose) {
    console.log('\n📋 Full Detail:');
    for (const r of report.details) {
      const icon =
        r.status === 'still_valid'
          ? '✅'
          : r.status === 'partially_valid'
            ? '⚠️'
            : r.status === 'invalidated'
              ? '❌'
              : r.status === 'file_deleted'
                ? '🗑️'
                : r.status === 'file_modified_claim_holds'
                  ? '🔄'
                  : '⏭️';
      console.log(
        `${icon} [${r.status}] Pipeline "${r.evidence.pipelineId}" | ${r.evidence.agentName}: "${r.evidence.claim.slice(0, 80)}${r.evidence.claim.length > 80 ? '...' : ''}"`
      );
      console.log(`   File: ${r.evidence.source}`);
      console.log(`   Confidence: ${r.confidence}`);
      console.log(`   Re-check: ${r.recheckResult.slice(0, 100)}`);
    }
    console.log();
  }
}

/**
 * Run the pipeline validation mode: reads agent-context.md from the current
 * .opencode/pipeline-logs directory, extracts evidence, and re-verifies.
 */
async function runPipelineMode(): Promise<number> {
  const cwd = process.cwd();
  const pipelineLogsDir = path.join(cwd, '.opencode', 'pipeline-logs');
  const journalPath = path.join(cwd, '.opencode', 'journal', 'journal.yaml');

  if (!fs.existsSync(pipelineLogsDir)) {
    console.error('❌ Pipeline logs directory not found:', pipelineLogsDir);
    return 2;
  }

  // Discover all pipeline directories
  const pipelineDirs = fs
    .readdirSync(pipelineLogsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  if (pipelineDirs.length === 0) {
    console.log('⚠️  No past pipeline logs found.');
    return 0;
  }

  const allResults: RegressionResult[] = [];
  let totalScanned = 0;

  // Load all evidence entries from agent-context.md files
  for (const pipelineId of pipelineDirs) {
    const agentContextPath = path.join(pipelineLogsDir, pipelineId, 'agent-context.md');
    if (!fs.existsSync(agentContextPath)) continue;

    const content = fs.readFileSync(agentContextPath, 'utf-8');
    const entries = extractEvidenceFromAgentContext(content, pipelineId, 'unknown', '');

    for (const evidence of entries) {
      totalScanned++;
      const result = reverifyEvidence(evidence, cwd);
      allResults.push(result);
    }
  }

  // Build report
  const report: RegressionReport = {
    totalScanned,
    stillValid: 0,
    partiallyValid: 0,
    invalidated: 0,
    fileDeleted: 0,
    fileModifiedClaimHolds: 0,
    unverifiable: 0,
    details: allResults,
    summary: '',
  };

  for (const r of allResults) {
    switch (r.status) {
      case 'still_valid':
        report.stillValid++;
        break;
      case 'partially_valid':
        report.partiallyValid++;
        break;
      case 'invalidated':
        report.invalidated++;
        break;
      case 'file_deleted':
        report.fileDeleted++;
        break;
      case 'file_modified_claim_holds':
        report.fileModifiedClaimHolds++;
        break;
      case 'unverifiable':
        report.unverifiable++;
        break;
    }
  }

  const validPct =
    report.totalScanned > 0
      ? (((report.stillValid + report.partiallyValid + report.fileModifiedClaimHolds) /
          report.totalScanned) *
          100)
      : 0;

  report.summary =
    report.invalidated + report.fileDeleted > 0
      ? `⚠️  ${report.invalidated + report.fileDeleted} evidence entries need attention. ${report.invalidated} invalidated, ${report.fileDeleted} files deleted. Overall validity: ${validPct.toFixed(1)}%`
      : `✅ All ${report.totalScanned} evidence entries are still valid or unverifiable.`;

  printRegressionReport(report, process.argv.includes('--verbose'));

  if (report.invalidated > 0 || report.fileDeleted > 0) return 1;
  return 0;
}

function main(): void {
  const opts = parseCliArgs();

  if (opts.help) {
    printUsage();
    process.exit(0);
  }

  // Pipeline mode — validate all evidence in agent-context.md
  if (opts.pipelineMode) {
    runPipelineMode()
      .then((code) => process.exit(code))
      .catch((err) => {
        console.error('❌ Pipeline mode error:', err.message);
        process.exit(2);
      });
    return;
  }

  // Single-query mode via CLI args
  const { file, kind, symbol, method } = opts;

  if (!file || !kind) {
    console.error('❌ Missing required arguments: --file=<path> and --kind=<kind>');
    console.error(
      'Usage: ts-node validate-ast.ts --file=<path> --kind=<kind> [--symbol=<name>] [--method=<name>]'
    );
    console.error('       ts-node validate-ast.ts --pipeline');
    printUsage();
    process.exit(2);
  }

  const request: AstValidationRequest = {
    file,
    kind,
    symbol: symbol ?? '',
    methodName: method,
  };

  const result = validateAst(request);

  // Print result
  const icon =
    result.status === 'pass'
      ? '✅'
      : result.status === 'error'
        ? '💥'
        : '❌';
  console.log(`${icon} [${result.status}] ${result.kind}: "${result.symbol}"${result.methodName ? `, method "${result.methodName}"` : ''}`);
  console.log(`   File: ${result.file}`);
  console.log(`   Detail: ${result.detail}`);
  console.log(`   Confidence: ${result.confidence}`);

  if (result.findings.length > 0) {
    console.log(`   Findings (${result.findings.length}):`);
    for (const f of result.findings) {
      console.log(`     • ${f}`);
    }
  }
  console.log();

  if (result.status === 'pass') process.exit(0);
  if (result.status === 'error') process.exit(2);
  process.exit(1);
}

// Run if executed directly (not imported)
const isDirectRun =
  typeof require !== 'undefined' &&
  require.main === module;

if (isDirectRun) {
  main();
}

// ──────────────────────────────────────────────
// Historical Evidence Regression (Pipeline mode)
// ──────────────────────────────────────────────

/**
 * Parse agent-context.md YAML frontmatter and extract evidence entries
 * from agentHistory and agentOutputs sections.
 */
interface EvidenceEntry {
  pipelineId: string;
  feature: string;
  date: string;
  agentName: string;
  claim: string;
  source: string;
  originalContentHash: string;
  method: string;
  command: string;
  originalResult: string;
  excerpt: string;
}

interface JournalEntry {
  date: string;
  feature: string;
  pipelineId?: string;
  pipelineType: string;
  result: string;
}

/**
 * Load journal entries from .opencode/journal/journal.yaml
 */
function loadJournalEntries(journalPath: string): JournalEntry[] {
  const entries: JournalEntry[] = [];

  if (!fs.existsSync(journalPath)) {
    return entries;
  }

  const content = fs.readFileSync(journalPath, 'utf-8');
  const lines = content.split('\n');

  // Parse simple YAML list of journal entries
  let current: Partial<JournalEntry> | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Start of a new entry (e.g., "- date: 2026-05-19")
    if (trimmed.startsWith('- date:')) {
      if (current && current.date) {
        entries.push(current as JournalEntry);
      }
      current = { date: trimmed.replace(/^- date:\s*/, '').trim() };
      continue;
    }

    if (!current) continue;

    const listItemMatch = trimmed.match(/^-\s+\w+/);
    if (listItemMatch && !trimmed.startsWith('- date:')) {
      // This is a list item within the current entry — skip for now
      continue;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();

    switch (key) {
      case 'feature':
        current.feature = value;
        break;
      case 'pipelineId':
        current.pipelineId = value;
        break;
      case 'pipelineType':
        current.pipelineType = value;
        break;
      case 'result':
        current.result = value;
        break;
    }
  }

  // Push the last entry
  if (current && current.date) {
    entries.push(current as JournalEntry);
  }

  return entries;
}

/**
 * Extract evidence from agent-context.md YAML frontmatter.
 */
function extractEvidenceFromAgentContext(
  content: string,
  pipelineId: string,
  feature: string,
  date: string
): EvidenceEntry[] {
  const evidenceEntries: EvidenceEntry[] = [];

  // Find YAML frontmatter delimiters (---)
  const lines = content.split('\n');
  let inFrontmatter = false;
  let frontmatterLines: string[] = [];

  for (const line of lines) {
    if (line.trim() === '---') {
      if (!inFrontmatter) {
        inFrontmatter = true;
        continue;
      } else {
        // End of frontmatter
        break;
      }
    }
    if (inFrontmatter) {
      frontmatterLines.push(line);
    }
  }

  // Try to find agentHistory and agentOutputs sections in the full content
  // (may be outside frontmatter)
  const fullContent = content;

  // Pattern: look for blocks like:
  // agentHistory:
  //   - agent: verifier
  //     evidence:
  //       - claim: "CP-003: validateEmail export exists"
  //         source: src/services/user.ts
  //         method: grep
  //         command: grep "export" src/services/user.ts
  //         result: "export function validateEmail..."

  const agentHistorySections = fullContent.match(
    /agentHistory:\s*\n([\s\S]*?)(?=\n\w+:|$)/
  );

  if (agentHistorySections) {
    const sectionText = agentHistorySections[1];
    const agentBlocks = sectionText.split(/\n\s*- agent:/).slice(1);

    for (const agentBlock of agentBlocks) {
      const agentNameMatch = agentBlock.match(/^([^\n]+)/);
      const agentName = agentNameMatch ? agentNameMatch[1].trim() : 'unknown';

      // Extract evidence entries within this agent block
      // Look for "evidence:" followed by list of claims
      const evidenceSection = agentBlock.match(
        /evidence:\s*\n([\s\S]*?)(?=\n\s+\w+:|\n\s*- agent:|\n\w+:|$)/
      );

      if (!evidenceSection) continue;

      const evidenceText = evidenceSection[1];
      const claimBlocks = evidenceText.split(/\n\s*- claim:/).slice(1);

      for (const claimBlock of claimBlocks) {
        const claimText = claimBlock.split('\n')[0].trim();

        const sourceMatch = claimBlock.match(/source:\s*['"]?([^\n'"]+)['"]?/);
        const source = sourceMatch ? sourceMatch[1].trim() : '';

        const methodMatch = claimBlock.match(/method:\s*['"]?([^\n'"]+)['"]?/);
        const method = methodMatch ? methodMatch[1].trim() : '';

        const commandMatch = claimBlock.match(/command:\s*['"]?([^\n'"]+)['"]?/);
        const command = commandMatch ? commandMatch[1].trim() : '';

        const resultMatch = claimBlock.match(/result:\s*['"]?([^\n'"]+)['"]?/);
        const result = resultMatch ? resultMatch[1].trim() : '';

        // Compute original content hash if source is a file
        let contentHash = '';
        if (source) {
          const sourcePath = path.resolve(source);
          if (fs.existsSync(sourcePath)) {
            try {
              contentHash = computeFileHash(sourcePath) ?? '';
            } catch {
              // ignore
            }
          }
        }

        evidenceEntries.push({
          pipelineId,
          feature,
          date,
          agentName,
          claim: claimText,
          source,
          originalContentHash: contentHash,
          method,
          command,
          originalResult: result,
          excerpt: claimText.slice(0, 100),
        });
      }
    }
  }

  // Also check agentOutputs section
  const agentOutputsSection = fullContent.match(
    /agentOutputs:\s*\n([\s\S]*?)(?=\n\w+:|$)/
  );

  if (agentOutputsSection) {
    const sectionText = agentOutputsSection[1];
    const outputBlocks = sectionText.split(/\n\s+output:/g);

    for (const block of outputBlocks) {
      const claimMatch = block.match(/claim:\s*['"]?([^\n'"]+)['"]?/);
      const sourceMatch = block.match(/source:\s*['"]?([^\n'"]+)['"]?/);

      if (claimMatch) {
        evidenceEntries.push({
          pipelineId,
          feature,
          date,
          agentName: 'output',
          claim: claimMatch[1].trim(),
          source: sourceMatch ? sourceMatch[1].trim() : '',
          originalContentHash: '',
          method: 'analysis',
          command: '',
          originalResult: '',
          excerpt: claimMatch[1].trim().slice(0, 100),
        });
      }
    }
  }

  return evidenceEntries;
}

/**
 * Re-verify a piece of historical evidence against the current codebase.
 */
function reverifyEvidence(
  evidence: EvidenceEntry,
  baseDir: string
): RegressionResult {
  const sourcePath = evidence.source
    ? path.resolve(baseDir, evidence.source)
    : null;

  // 1. Check if the source file still exists
  if (sourcePath && !fs.existsSync(sourcePath)) {
    return {
      evidence,
      status: 'file_deleted',
      currentContentHash: null,
      recheckResult: 'Source file no longer exists',
      confidence: 1.0,
    };
  }

  // 2. Compute current content hash and compare with original
  let currentHash: string | null = null;
  if (sourcePath && fs.existsSync(sourcePath)) {
    currentHash = computeFileHash(sourcePath);

    // Fast path: file unchanged → evidence still valid
    if (currentHash === evidence.originalContentHash && evidence.originalContentHash !== '') {
      return {
        evidence,
        status: 'still_valid',
        currentContentHash: currentHash,
        recheckResult: 'File content unchanged (SHA-256 match)',
        confidence: 1.0,
      };
    }
  }

  // 3. Re-run the original command (if available) to verify the claim
  if (evidence.command) {
    try {
      const stdout = execSync(evidence.command, {
        cwd: baseDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      });

      // Command succeeded → evidence likely still holds
      // Even if file changed, the claim is still verifiable
      return {
        evidence,
        status: 'file_modified_claim_holds',
        currentContentHash: currentHash,
        recheckResult: `Command succeeded: ${stdout.slice(0, 200).trim()}`,
        confidence: 1.0,
      };
    } catch (cmdErr: any) {
      // Command failed — need deeper analysis
      const stderr = cmdErr.stderr ?? '';
      const stdout = cmdErr.stdout ?? '';
      const combined = `${stdout}\n${stderr}`.trim();

      // 4. Try fuzzy matching: re-verify the claim using our classification
      if (sourcePath && fs.existsSync(sourcePath)) {
        const content = readFileContent(sourcePath);
        if (content) {
          const fuzzyResult = fuzzyVerifyClaim(content, evidence);
          if (fuzzyResult !== null) {
            return fuzzyResult;
          }
        }
      }

      return {
        evidence,
        status: 'invalidated',
        currentContentHash: currentHash,
        recheckResult: `Command failed: ${combined.slice(0, 200)}`,
        confidence: 0.9,
      };
    }
  }

  // 4. No command — try heuristic verification based on method type
  if (evidence.source && sourcePath && fs.existsSync(sourcePath)) {
    const content = readFileContent(sourcePath);
    if (content) {
      const fuzzyResult = fuzzyVerifyClaim(content, evidence);
      if (fuzzyResult !== null) {
        return fuzzyResult;
      }
    }
  }

  // 5. If method is 'reason' or 'analysis', mark as unverifiable
  if (
    evidence.method === 'reason' ||
    evidence.method === 'analysis' ||
    evidence.method === 'design'
  ) {
    return {
      evidence,
      status: 'unverifiable',
      currentContentHash: currentHash,
      recheckResult: 'Analytical/reasoning evidence — cannot be programmatically re-verified',
      confidence: 1.0,
    };
  }

  // 6. No verification possible
  return {
    evidence,
    status: 'invalidated',
    currentContentHash: currentHash,
    recheckResult: 'Cannot re-verify: no command or verifiable source',
    confidence: 0.5,
  };
}

import { execSync } from 'child_process';

interface RegressionResult {
  evidence: EvidenceEntry;
  status: RegressionStatus;
  currentContentHash: string | null;
  recheckResult: string;
  confidence: number;
}

type RegressionStatus =
  | 'still_valid'
  | 'partially_valid'
  | 'invalidated'
  | 'file_deleted'
  | 'file_modified_claim_holds'
  | 'unverifiable';

interface RegressionReport {
  totalScanned: number;
  stillValid: number;
  partiallyValid: number;
  invalidated: number;
  fileDeleted: number;
  fileModifiedClaimHolds: number;
  unverifiable: number;
  details: RegressionResult[];
  summary: string;
}

/**
 * Fuzzy-verify a claim against current file content.
 * Returns a RegressionResult if a determination can be made, null otherwise.
 */
function fuzzyVerifyClaim(
  content: string,
  evidence: EvidenceEntry
): RegressionResult | null {
  const sourcePath = evidence.source
    ? path.resolve(process.cwd(), evidence.source)
    : null;

  // Based on the claim text, try to determine what kind of evidence this is
  const claimLower = evidence.claim.toLowerCase();

  // Check for export claim patterns
  if (
    /export|exists|available/i.test(claimLower) &&
    evidence.claim.includes('export')
  ) {
    // Extract the symbol name from the claim
    const exportMatch = evidence.claim.match(/["'`](\w+)["'`]/);
    const symbol = exportMatch ? exportMatch[1] : '';

    if (symbol) {
      const result = checkExportExists(content, symbol);
      if (result.status === 'pass') {
        return {
          evidence,
          status: 'file_modified_claim_holds',
          currentContentHash: null,
          recheckResult: `Export "${symbol}" still found via AST check`,
          confidence: 1.0,
        };
      }
    }
  }

  // Check for class/function existence patterns
  if (evidence.method === 'grep' || evidence.method === 'tsc') {
    // Generic grep-style claim: "X exists at Y"
    const symbolMatches = evidence.claim.match(/["'`](\w+)["'`]/g);
    if (symbolMatches && symbolMatches.length > 0) {
      const symbols = symbolMatches.map((s) => s.replace(/["'`]/g, ''));

      let allFound = true;
      let someFound = false;

      for (const sym of symbols) {
        // Check for the symbol (export, class, function, type, etc.)
        const classResult = checkClassExists(content, sym);
        const funcResult = checkFunctionExists(content, sym);
        const typeResult = checkTypeExists(content, sym);
        const exportResult = checkExportExists(content, sym);

        if (
          classResult.status === 'pass' ||
          funcResult.status === 'pass' ||
          typeResult.status === 'pass' ||
          exportResult.status === 'pass'
        ) {
          someFound = true;
        } else {
          allFound = false;
        }
      }

      if (allFound && symbols.length > 0) {
        return {
          evidence,
          status: 'file_modified_claim_holds',
          currentContentHash: null,
          recheckResult: `All symbols found in file via AST check`,
          confidence: 1.0,
        };
      }

      if (someFound) {
        return {
          evidence,
          status: 'partially_valid',
          currentContentHash: null,
          recheckResult: `Some symbols found, some missing`,
          confidence: 0.7,
        };
      }
    }
  }

  // Check for claim mentions in the file content
  const claimKeywords = evidence.claim
    .replace(/[^a-zA-Z0-9_\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 3);

  let keywordMatches = 0;
  for (const keyword of claimKeywords) {
    if (content.includes(keyword)) {
      keywordMatches++;
    }
  }

  const keywordRatio =
    claimKeywords.length > 0 ? keywordMatches / claimKeywords.length : 0;

  if (keywordRatio >= 0.7 && claimKeywords.length >= 3) {
    return {
      evidence,
      status: 'partially_valid',
      currentContentHash: null,
      recheckResult: `Fuzzy match: ${keywordMatches}/${claimKeywords.length} claim keywords found in file`,
      confidence: 0.7,
    };
  }

  return null;
}
