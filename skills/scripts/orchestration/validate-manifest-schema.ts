#!/usr/bin/env node
/**
 * Plan Manifest Schema Validator
 *
 * Validates a plan-manifest.json against the JSON Schema at
 * plan-manifests/plan-manifest.schema.json. Uses ONLY Node.js built-in
 * modules — no external dependencies.
 *
 * Usage:
 *   ts-node skills/scripts/orchestration/validate-manifest-schema.ts \
 *     --manifest=plan-manifests/<feature>/v1-manifest.json \
 *     [--schema=plan-manifests/plan-manifest.schema.json]
 *
 * Exit codes:
 *   0 = valid
 *   1 = invalid (schema violations found)
 *   2 = config/parsing error (file not found, bad JSON, missing args)
 *
 * Output: JSON to stdout
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Types ──────────────────────────────────────────────────────────

interface ValidationOutput {
  valid: boolean;
  manifestPath: string;
  errors: string[];
  warnings: string[];
  checkpointsValidated: number;
  contractRulesValidated: number;
  securityConsiderationsValidated: number;
}

interface CLIOptions {
  manifest: string;
  schema: string;
}

// ── Constants ──────────────────────────────────────────────────────

const VALID_CHECKPOINT_TYPES = ['structural', 'behavioral', 'meta', 'acceptance'] as const;

const VALID_VERIFY_KINDS = [
  'fileExists',
  'fileNotExists',
  'exportExists',
  'classExists',
  'functionExists',
  'methodExists',
  'typeExists',
  'routeExists',
  'handlesError',
  'validatesInput',
  'logsAtLevel',
  'hasMiddleware',
  'selfReviewCheckpoint',
  'acceptanceCriteria',
] as const;

const VALID_CONTRACT_RULE_TYPES = [
  'import_restriction',
  'import_required',
  'library_restriction',
  'method_must_exist',
  'pattern_must_exist',
  'pattern_forbidden',
  'naming_convention',
] as const;

const VALID_SEVERITIES = ['blocking', 'warning'] as const;

const VALID_EXPECTED_RESULTS = ['no_matches', 'matches_found'] as const;

const VALID_EFFORTS = ['small', 'medium', 'large', 'x-large'] as const;

const VALID_RISK_LEVELS = ['low', 'medium', 'high'] as const;

const VALID_HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;

const VALID_VERIFY_METHODS = ['grep', 'read', 'reason'] as const;

const VALID_LOG_LEVELS = ['info', 'warn', 'error', 'debug'] as const;

const VALID_SECURITY_SCAN_TYPES = ['npm audit', 'semgrep-sast', 'secrets', 'dependency-scan', 'dast', 'container-scan'] as const;

const VALID_SEC_RISK_LEVELS = ['standard', 'sensitive', 'infrastructure'] as const;

const CP_ID_REGEX = /^CP-\d{3}$/;
const CR_ID_REGEX = /^CR-\d{3}$/;
const SEC_CP_ID_REGEX = /^CP-SEC-\d{3}$/;

// ── CLI Argument Parsing ───────────────────────────────────────────

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    manifest: '',
    schema: '',
  };

  for (const arg of args) {
    if (arg.startsWith('--manifest=')) {
      options.manifest = arg.slice('--manifest='.length);
    } else if (arg.startsWith('--schema=')) {
      options.schema = arg.slice('--schema='.length);
    } else {
      console.error(`Unknown argument: "${arg}"`);
      console.error('Usage: ts-node validate-manifest-schema.ts --manifest=<path> [--schema=<path>]');
      process.exit(2);
    }
  }

  if (!options.manifest) {
    console.error('Missing required argument: --manifest=<path>');
    process.exit(2);
  }

  return options;
}

// ── Validation Helpers ─────────────────────────────────────────────

function isString(val: unknown): val is string {
  return typeof val === 'string';
}

function isNonEmptyString(val: unknown): val is string {
  return typeof val === 'string' && val.length > 0;
}

function isInteger(val: unknown): val is number {
  return typeof val === 'number' && Number.isInteger(val);
}

function isValidEnum<T extends string>(val: unknown, validValues: readonly T[]): val is T {
  return typeof val === 'string' && (validValues as readonly string[]).includes(val);
}

function addError(errors: string[], message: string): void {
  errors.push(message);
}

function addWarning(warnings: string[], message: string): void {
  warnings.push(message);
}

// ── Top-Level Validation ───────────────────────────────────────────

function validateTopLevel(manifest: Record<string, unknown>, errors: string[], warnings: string[]): void {
  const requiredFields = ['manifestVersion', 'planSummary', 'createdAt', 'checkpoints'];

  for (const field of requiredFields) {
    if (manifest[field] === undefined || manifest[field] === null) {
      addError(errors, `Missing required top-level field: "${field}"`);
    }
  }

  // manifestVersion must be integer >= 1
  if (manifest.manifestVersion !== undefined && manifest.manifestVersion !== null) {
    if (!isInteger(manifest.manifestVersion)) {
      addError(errors, `"manifestVersion" must be an integer, got ${typeof manifest.manifestVersion}`);
    } else if (manifest.manifestVersion < 1) {
      addError(errors, `"manifestVersion" must be >= 1, got ${manifest.manifestVersion}`);
    }
  }

  // planSummary must be non-empty string
  if (manifest.planSummary !== undefined && manifest.planSummary !== null) {
    if (!isNonEmptyString(manifest.planSummary)) {
      addError(errors, `"planSummary" must be a non-empty string, got ${typeof manifest.planSummary}`);
    }
  }

  // createdAt must be non-empty string
  if (manifest.createdAt !== undefined && manifest.createdAt !== null) {
    if (!isNonEmptyString(manifest.createdAt)) {
      addError(errors, `"createdAt" must be a non-empty string, got ${typeof manifest.createdAt}`);
    }
  }

  // feature must be non-empty string (if present)
  if (manifest.feature !== undefined && manifest.feature !== null) {
    if (!isNonEmptyString(manifest.feature)) {
      addError(errors, `"feature" must be a non-empty string, got ${typeof manifest.feature}`);
    }
  }

  // phases must be integer >= 1 (if present)
  if (manifest.phases !== undefined && manifest.phases !== null) {
    if (!isInteger(manifest.phases)) {
      addError(errors, `"phases" must be an integer, got ${typeof manifest.phases}`);
    } else if (manifest.phases < 1) {
      addError(errors, `"phases" must be >= 1, got ${manifest.phases}`);
    }
  }

  // estimatedEffort must be one of small/medium/large/x-large (if present)
  if (manifest.estimatedEffort !== undefined && manifest.estimatedEffort !== null) {
    if (!isValidEnum(manifest.estimatedEffort, VALID_EFFORTS)) {
      addError(errors, `"estimatedEffort" must be one of ${VALID_EFFORTS.join(', ')}, got "${manifest.estimatedEffort}"`);
    }
  }

  // riskLevel must be one of low/medium/high (if present)
  if (manifest.riskLevel !== undefined && manifest.riskLevel !== null) {
    if (!isValidEnum(manifest.riskLevel, VALID_RISK_LEVELS)) {
      addError(errors, `"riskLevel" must be one of ${VALID_RISK_LEVELS.join(', ')}, got "${manifest.riskLevel}"`);
    }
  }

  // checkpoints must be a non-empty array
  if (manifest.checkpoints !== undefined && manifest.checkpoints !== null) {
    if (!Array.isArray(manifest.checkpoints)) {
      addError(errors, `"checkpoints" must be an array, got ${typeof manifest.checkpoints}`);
    } else if (manifest.checkpoints.length === 0) {
      addError(errors, '"checkpoints" must be a non-empty array');
    }
  }
}

// ── Checkpoint Validation ──────────────────────────────────────────

function validateCheckpoint(
  cp: Record<string, unknown>,
  index: number,
  errors: string[],
  warnings: string[],
): void {
  const prefix = `checkpoints[${index}]`;

  // Required fields: id, type, description, target, verify
  const cpRequiredFields = ['id', 'type', 'description', 'target', 'verify'];
  for (const field of cpRequiredFields) {
    if (cp[field] === undefined || cp[field] === null) {
      addError(errors, `${prefix}: missing required field "${field}"`);
    }
  }

  // id must match ^CP-\d{3}$
  if (cp.id !== undefined && cp.id !== null) {
    if (!isString(cp.id) || !CP_ID_REGEX.test(cp.id)) {
      addError(errors, `${prefix}: "id" must match pattern ^CP-\\d{3}$, got "${String(cp.id)}"`);
    }
  }

  // type must be one of structural/behavioral/meta/acceptance
  if (cp.type !== undefined && cp.type !== null) {
    if (!isValidEnum(cp.type, VALID_CHECKPOINT_TYPES)) {
      addError(errors, `${prefix}: "type" must be one of ${VALID_CHECKPOINT_TYPES.join(', ')}, got "${String(cp.type)}"`);
    }
  }

  // description must be non-empty string
  if (cp.description !== undefined && cp.description !== null) {
    if (!isNonEmptyString(cp.description)) {
      addError(errors, `${prefix}: "description" must be a non-empty string`);
    }
  }

  // target must be non-empty string
  if (cp.target !== undefined && cp.target !== null) {
    if (!isNonEmptyString(cp.target)) {
      addError(errors, `${prefix}: "target" must be a non-empty string`);
    }
  }

  // Validate verify object
  if (cp.verify !== undefined && cp.verify !== null && typeof cp.verify === 'object' && !Array.isArray(cp.verify)) {
    validateVerify(cp.verify as Record<string, unknown>, prefix, errors, warnings);
  } else if (cp.verify !== undefined && cp.verify !== null) {
    addError(errors, `${prefix}: "verify" must be an object`);
  }
}

function validateVerify(
  verify: Record<string, unknown>,
  prefix: string,
  errors: string[],
  warnings: string[],
): void {
  // verify must have kind field
  if (verify.kind === undefined || verify.kind === null) {
    addError(errors, `${prefix}.verify: missing required field "kind"`);
    return;
  }

  // verify.kind must be one of the 14 valid enum values
  if (!isValidEnum(verify.kind, VALID_VERIFY_KINDS)) {
    addError(errors, `${prefix}.verify: "kind" must be one of ${VALID_VERIFY_KINDS.join(', ')}, got "${String(verify.kind)}"`);
    return;
  }

  const kind = verify.kind;

  // Conditional checks based on verify.kind
  switch (kind) {
    case 'exportExists':
      if (!isNonEmptyString(verify.exportName)) {
        addError(errors, `${prefix}.verify: "exportName" is required when kind is "exportExists"`);
      }
      break;

    case 'classExists':
      if (!isNonEmptyString(verify.className)) {
        addError(errors, `${prefix}.verify: "className" is required when kind is "classExists"`);
      }
      break;

    case 'functionExists':
      if (!isNonEmptyString(verify.functionName)) {
        addError(errors, `${prefix}.verify: "functionName" is required when kind is "functionExists"`);
      }
      break;

    case 'methodExists':
      if (!isNonEmptyString(verify.className)) {
        addError(errors, `${prefix}.verify: "className" is required when kind is "methodExists"`);
      }
      if (!isNonEmptyString(verify.methodName)) {
        addError(errors, `${prefix}.verify: "methodName" is required when kind is "methodExists"`);
      }
      break;

    case 'typeExists':
      if (!isNonEmptyString(verify.typeName)) {
        addError(errors, `${prefix}.verify: "typeName" is required when kind is "typeExists"`);
      }
      break;

    case 'routeExists':
      if (!isNonEmptyString(verify.routePath)) {
        addError(errors, `${prefix}.verify: "routePath" is required when kind is "routeExists"`);
      }
      if (!isValidEnum(verify.method, VALID_HTTP_METHODS)) {
        addError(errors, `${prefix}.verify: "method" (${VALID_HTTP_METHODS.join(', ')}) is required when kind is "routeExists"`);
      }
      break;

    case 'handlesError':
      if (!isNonEmptyString(verify.methodName)) {
        addError(errors, `${prefix}.verify: "methodName" is required when kind is "handlesError"`);
      }
      if (!isNonEmptyString(verify.details)) {
        addError(errors, `${prefix}.verify: "details" is required when kind is "handlesError"`);
      }
      break;

    case 'validatesInput':
      if (!isNonEmptyString(verify.methodName)) {
        addError(errors, `${prefix}.verify: "methodName" is required when kind is "validatesInput"`);
      }
      break;

    case 'logsAtLevel':
      if (!isValidEnum(verify.level, VALID_LOG_LEVELS)) {
        addError(errors, `${prefix}.verify: "level" (${VALID_LOG_LEVELS.join(', ')}) is required when kind is "logsAtLevel"`);
      }
      break;

    case 'hasMiddleware':
      if (!isNonEmptyString(verify.middlewareName)) {
        addError(errors, `${prefix}.verify: "middlewareName" is required when kind is "hasMiddleware"`);
      }
      if (!isNonEmptyString(verify.routePath)) {
        addError(errors, `${prefix}.verify: "routePath" is required when kind is "hasMiddleware"`);
      }
      if (!isValidEnum(verify.method, VALID_HTTP_METHODS)) {
        addError(errors, `${prefix}.verify: "method" (${VALID_HTTP_METHODS.join(', ')}) is required when kind is "hasMiddleware"`);
      }
      break;

    case 'selfReviewCheckpoint':
      if (!isNonEmptyString(verify.prompt)) {
        addError(errors, `${prefix}.verify: "prompt" is required when kind is "selfReviewCheckpoint"`);
      }
      if (!isValidEnum(verify.verifyMethod, VALID_VERIFY_METHODS)) {
        addError(errors, `${prefix}.verify: "verifyMethod" (${VALID_VERIFY_METHODS.join(', ')}) is required when kind is "selfReviewCheckpoint"`);
      }
      break;

    case 'acceptanceCriteria':
      if (!isNonEmptyString(verify.given)) {
        addError(errors, `${prefix}.verify: "given" is required when kind is "acceptanceCriteria"`);
      }
      if (!isNonEmptyString(verify.when)) {
        addError(errors, `${prefix}.verify: "when" is required when kind is "acceptanceCriteria"`);
      }
      if (!isNonEmptyString(verify.then)) {
        addError(errors, `${prefix}.verify: "then" is required when kind is "acceptanceCriteria"`);
      }
      if (!isNonEmptyString(verify.testCommand)) {
        addError(errors, `${prefix}.verify: "testCommand" is required when kind is "acceptanceCriteria"`);
      }
      break;

    // fileExists and fileNotExists require no additional fields
    case 'fileExists':
    case 'fileNotExists':
      break;
  }
}

// ── Contract Rules Validation ──────────────────────────────────────

function validateContractRule(
  cr: Record<string, unknown>,
  index: number,
  errors: string[],
  warnings: string[],
): void {
  const prefix = `contractRules[${index}]`;

  // Required fields: id, type, severity, description, rule, expectedResult
  const crRequiredFields = ['id', 'type', 'severity', 'description', 'rule', 'expectedResult'];
  for (const field of crRequiredFields) {
    if (cr[field] === undefined || cr[field] === null) {
      addError(errors, `${prefix}: missing required field "${field}"`);
    }
  }

  // id must match ^CR-\d{3}$
  if (cr.id !== undefined && cr.id !== null) {
    if (!isString(cr.id) || !CR_ID_REGEX.test(cr.id)) {
      addError(errors, `${prefix}: "id" must match pattern ^CR-\\d{3}$, got "${String(cr.id)}"`);
    }
  }

  // type must be valid enum value
  if (cr.type !== undefined && cr.type !== null) {
    if (!isValidEnum(cr.type, VALID_CONTRACT_RULE_TYPES)) {
      addError(errors, `${prefix}: "type" must be one of ${VALID_CONTRACT_RULE_TYPES.join(', ')}, got "${String(cr.type)}"`);
    }
  }

  // severity must be "blocking" or "warning"
  if (cr.severity !== undefined && cr.severity !== null) {
    if (!isValidEnum(cr.severity, VALID_SEVERITIES)) {
      addError(errors, `${prefix}: "severity" must be one of ${VALID_SEVERITIES.join(', ')}, got "${String(cr.severity)}"`);
    }
  }

  // description must be non-empty string
  if (cr.description !== undefined && cr.description !== null) {
    if (!isNonEmptyString(cr.description)) {
      addError(errors, `${prefix}: "description" must be a non-empty string`);
    }
  }

  // rule must be non-empty string
  if (cr.rule !== undefined && cr.rule !== null) {
    if (!isNonEmptyString(cr.rule)) {
      addError(errors, `${prefix}: "rule" must be a non-empty string`);
    }
  }

  // expectedResult must be "no_matches" or "matches_found"
  if (cr.expectedResult !== undefined && cr.expectedResult !== null) {
    if (!isValidEnum(cr.expectedResult, VALID_EXPECTED_RESULTS)) {
      addError(errors, `${prefix}: "expectedResult" must be one of ${VALID_EXPECTED_RESULTS.join(', ')}, got "${String(cr.expectedResult)}"`);
    }
  }
}

// ── Changes Validation ─────────────────────────────────────────────

function validateChange(
  change: Record<string, unknown>,
  index: number,
  errors: string[],
  warnings: string[],
): void {
  const prefix = `changes[${index}]`;

  // Required fields: from, to, description
  const requiredFields = ['from', 'to', 'description'];
  for (const field of requiredFields) {
    if (change[field] === undefined || change[field] === null) {
      addError(errors, `${prefix}: missing required field "${field}"`);
    }
  }

  // from must match ^CP-\d{3}$
  if (change.from !== undefined && change.from !== null) {
    if (!isString(change.from) || !CP_ID_REGEX.test(change.from)) {
      addError(errors, `${prefix}: "from" must match pattern ^CP-\\d{3}$, got "${String(change.from)}"`);
    }
  }

  // to must match ^CP-\d{3}$
  if (change.to !== undefined && change.to !== null) {
    if (!isString(change.to) || !CP_ID_REGEX.test(change.to)) {
      addError(errors, `${prefix}: "to" must match pattern ^CP-\\d{3}$, got "${String(change.to)}"`);
    }
  }

  // description must be non-empty string
  if (change.description !== undefined && change.description !== null) {
    if (!isNonEmptyString(change.description)) {
      addError(errors, `${prefix}: "description" must be a non-empty string`);
    }
  }
}

// ── Security Considerations Validation ──────────────────────────────

export function validateSecurityConsiderations(
  manifest: Record<string, unknown>,
  errors: string[],
  warnings: string[],
): number {
  const sc = manifest.securityConsiderations;

  // Optional — skip if absent
  if (sc === undefined || sc === null) {
    return 0;
  }

  if (typeof sc !== 'object' || Array.isArray(sc)) {
    addError(errors, '"securityConsiderations" must be an object');
    return 0;
  }

  const sec = sc as Record<string, unknown>;
  const prefix = 'securityConsiderations';

  // 1. Validate required fields: riskLevel, authRequired, inputValidationRequired, requiredScans
  const requiredFields = ['riskLevel', 'authRequired', 'inputValidationRequired', 'requiredScans'];
  for (const field of requiredFields) {
    if (sec[field] === undefined || sec[field] === null) {
      addError(errors, `${prefix}: missing required field "${field}"`);
    }
  }

  // 2. Validate riskLevel — must be one of standard/sensitive/infrastructure
  if (sec.riskLevel !== undefined && sec.riskLevel !== null) {
    if (!isValidEnum(sec.riskLevel, VALID_SEC_RISK_LEVELS)) {
      addError(errors, `${prefix}.riskLevel: must be one of ${VALID_SEC_RISK_LEVELS.join(', ')}, got "${String(sec.riskLevel)}"`);
    }
  }

  // 3. Validate boolean fields (when present)
  const booleanFields = ['authRequired', 'inputValidationRequired', 'piiHandlingRequired', 'encryptionRequired', 'auditLoggingRequired', 'rateLimitingRequired'];
  for (const field of booleanFields) {
    if (sec[field] !== undefined && sec[field] !== null) {
      if (typeof sec[field] !== 'boolean') {
        addError(errors, `${prefix}.${field}: must be a boolean, got ${typeof sec[field]}`);
      }
    }
  }

  // 4. Validate summary — non-empty string when present
  if (sec.summary !== undefined && sec.summary !== null) {
    if (!isNonEmptyString(sec.summary)) {
      addError(errors, `${prefix}.summary: must be a non-empty string`);
    }
  }

  // 5. Validate requiredScans — array of strings from allowed enum
  if (sec.requiredScans !== undefined && sec.requiredScans !== null) {
    if (!Array.isArray(sec.requiredScans)) {
      addError(errors, `${prefix}.requiredScans: must be an array`);
    } else {
      if (sec.requiredScans.length === 0) {
        addWarning(warnings, `${prefix}.requiredScans: should contain at least one scan type`);
      }
      for (let i = 0; i < sec.requiredScans.length; i++) {
        const scan = sec.requiredScans[i];
        if (!isValidEnum(scan, VALID_SECURITY_SCAN_TYPES)) {
          addError(errors, `${prefix}.requiredScans[${i}]: must be one of ${VALID_SECURITY_SCAN_TYPES.join(', ')}, got "${String(scan)}"`);
        }
      }
    }
  }

  // 6. Validate securityCheckpoints if present
  if (sec.securityCheckpoints !== undefined && sec.securityCheckpoints !== null) {
    if (!Array.isArray(sec.securityCheckpoints)) {
      addError(errors, `${prefix}.securityCheckpoints: must be an array`);
    } else {
      for (let i = 0; i < sec.securityCheckpoints.length; i++) {
        const cp = sec.securityCheckpoints[i];
        if (typeof cp !== 'object' || cp === null || Array.isArray(cp)) {
          addError(errors, `${prefix}.securityCheckpoints[${i}]: must be an object`);
          continue;
        }
        const scp = cp as Record<string, unknown>;
        const cpPrefix = `${prefix}.securityCheckpoints[${i}]`;

        // Required fields: id, description, target, verify
        const cpRequired = ['id', 'description', 'target', 'verify'];
        for (const f of cpRequired) {
          if (scp[f] === undefined || scp[f] === null) {
            addError(errors, `${cpPrefix}: missing required field "${f}"`);
          }
        }

        // id must match ^CP-SEC-\d{3}$
        if (scp.id !== undefined && scp.id !== null) {
          if (!isString(scp.id) || !SEC_CP_ID_REGEX.test(scp.id)) {
            addError(errors, `${cpPrefix}: "id" must match pattern ^CP-SEC-\\d{3}$, got "${String(scp.id)}"`);
          }
        }

        // description must be non-empty string
        if (scp.description !== undefined && scp.description !== null) {
          if (!isNonEmptyString(scp.description)) {
            addError(errors, `${cpPrefix}: "description" must be a non-empty string`);
          }
        }

        // target must be non-empty string
        if (scp.target !== undefined && scp.target !== null) {
          if (!isNonEmptyString(scp.target)) {
            addError(errors, `${cpPrefix}: "target" must be a non-empty string`);
          }
        }

        // validate verify object
        if (scp.verify !== undefined && scp.verify !== null) {
          if (typeof scp.verify !== 'object' || Array.isArray(scp.verify)) {
            addError(errors, `${cpPrefix}.verify: must be an object`);
          } else {
            const verify = scp.verify as Record<string, unknown>;
            if (verify.kind === undefined || verify.kind === null) {
              addError(errors, `${cpPrefix}.verify: missing required field "kind"`);
            } else {
              const VALID_SEC_VERIFY_KINDS = [
                'exportExists', 'classExists', 'functionExists', 'methodExists',
                'handlesError', 'validatesInput', 'logsAtLevel', 'hasMiddleware',
              ] as const;
              if (!isValidEnum(verify.kind, VALID_SEC_VERIFY_KINDS)) {
                addError(errors, `${cpPrefix}.verify: "kind" must be one of ${VALID_SEC_VERIFY_KINDS.join(', ')}, got "${String(verify.kind)}"`);
              }
            }
          }
        }
      }
    }
  }

  // 7. Validate circuitBreakerThreshold if present
  if (sec.circuitBreakerThreshold !== undefined && sec.circuitBreakerThreshold !== null) {
    if (typeof sec.circuitBreakerThreshold !== 'object' || Array.isArray(sec.circuitBreakerThreshold)) {
      addError(errors, `${prefix}.circuitBreakerThreshold: must be an object`);
    } else {
      const cbt = sec.circuitBreakerThreshold as Record<string, unknown>;
      const cbtPrefix = `${prefix}.circuitBreakerThreshold`;

      // Required fields: supplyChainThreshold, securityScanRetries
      const cbtRequired = ['supplyChainThreshold', 'securityScanRetries'];
      for (const f of cbtRequired) {
        if (cbt[f] === undefined || cbt[f] === null) {
          addError(errors, `${cbtPrefix}: missing required field "${f}"`);
        }
      }

      // supplyChainThreshold must be integer 1-5
      if (cbt.supplyChainThreshold !== undefined && cbt.supplyChainThreshold !== null) {
        if (!isInteger(cbt.supplyChainThreshold)) {
          addError(errors, `${cbtPrefix}.supplyChainThreshold: must be an integer, got ${typeof cbt.supplyChainThreshold}`);
        } else if (cbt.supplyChainThreshold < 1 || cbt.supplyChainThreshold > 5) {
          addError(errors, `${cbtPrefix}.supplyChainThreshold: must be between 1 and 5, got ${cbt.supplyChainThreshold}`);
        }
      }

      // securityScanRetries must be integer 1-5
      if (cbt.securityScanRetries !== undefined && cbt.securityScanRetries !== null) {
        if (!isInteger(cbt.securityScanRetries)) {
          addError(errors, `${cbtPrefix}.securityScanRetries: must be an integer, got ${typeof cbt.securityScanRetries}`);
        } else if (cbt.securityScanRetries < 1 || cbt.securityScanRetries > 5) {
          addError(errors, `${cbtPrefix}.securityScanRetries: must be between 1 and 5, got ${cbt.securityScanRetries}`);
        }
      }
    }
  }

  return 1;
}

// ── Main Validation ────────────────────────────────────────────────

function validateManifest(
  manifest: Record<string, unknown>,
  manifestPath: string,
  errors: string[],
  warnings: string[],
): { checkpointsValidated: number; contractRulesValidated: number; securityConsiderationsValidated: number } {
  // 1. Top-level field validation
  validateTopLevel(manifest, errors, warnings);

  // 2. Checkpoints validation
  let checkpointsValidated = 0;
  const checkpoints = manifest.checkpoints;
  if (Array.isArray(checkpoints)) {
    for (let i = 0; i < checkpoints.length; i++) {
      const cp = checkpoints[i];
      if (typeof cp === 'object' && cp !== null && !Array.isArray(cp)) {
        validateCheckpoint(cp as Record<string, unknown>, i, errors, warnings);
        checkpointsValidated++;
      } else {
        addError(errors, `checkpoints[${i}]: must be an object`);
      }
    }
  }

  // 3. Contract rules validation
  let contractRulesValidated = 0;
  const contractRules = manifest.contractRules;
  if (contractRules !== undefined && contractRules !== null) {
    if (!Array.isArray(contractRules)) {
      addError(errors, '"contractRules" must be an array');
    } else {
      for (let i = 0; i < contractRules.length; i++) {
        const cr = contractRules[i];
        if (typeof cr === 'object' && cr !== null && !Array.isArray(cr)) {
          validateContractRule(cr as Record<string, unknown>, i, errors, warnings);
          contractRulesValidated++;
        } else {
          addError(errors, `contractRules[${i}]: must be an object`);
        }
      }
    }
  }

  // 4. Changes validation
  const changes = manifest.changes;
  if (changes !== undefined && changes !== null) {
    if (!Array.isArray(changes)) {
      addError(errors, '"changes" must be an array');
    } else {
      for (let i = 0; i < changes.length; i++) {
        const change = changes[i];
        if (typeof change === 'object' && change !== null && !Array.isArray(change)) {
          validateChange(change as Record<string, unknown>, i, errors, warnings);
        } else {
          addError(errors, `changes[${i}]: must be an object`);
        }
      }
    }
  }

  // 5. Security considerations validation
  const securityConsiderationsValidated = validateSecurityConsiderations(manifest, errors, warnings);

  return { checkpointsValidated, contractRulesValidated, securityConsiderationsValidated };
}

// ── CLI Entry Point ────────────────────────────────────────────────

function main(): void {
  const options = parseArgs();

  // Resolve paths
  const manifestPath = path.resolve(options.manifest);
  let schemaPath: string;

  if (options.schema) {
    schemaPath = path.resolve(options.schema);
  } else {
    // Default: look for plan-manifests/plan-manifest.schema.json relative to workspace
    // Walk up from the script location or use cwd
    const cwd = process.cwd();
    schemaPath = path.resolve(cwd, 'plan-manifests/plan-manifest.schema.json');
  }

  // Validate manifest file exists
  if (!fs.existsSync(manifestPath)) {
    const output: ValidationOutput = {
      valid: false,
      manifestPath: options.manifest,
      errors: [`Manifest file not found: ${manifestPath}`],
      warnings: [],
      checkpointsValidated: 0,
      contractRulesValidated: 0,
      securityConsiderationsValidated: 0,
    };
    console.log(JSON.stringify(output, null, 2));
    process.exit(2);
  }

  // Validate schema file exists
  if (!fs.existsSync(schemaPath)) {
    const output: ValidationOutput = {
      valid: false,
      manifestPath: options.manifest,
      errors: [`Schema file not found: ${schemaPath}`],
      warnings: [],
      checkpointsValidated: 0,
      contractRulesValidated: 0,
      securityConsiderationsValidated: 0,
    };
    console.log(JSON.stringify(output, null, 2));
    process.exit(2);
  }

  // Read and parse manifest
  let manifest: Record<string, unknown>;
  try {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    manifest = JSON.parse(content);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const output: ValidationOutput = {
      valid: false,
      manifestPath: options.manifest,
      errors: [`Failed to parse manifest: ${errorMessage}`],
      warnings: [],
      checkpointsValidated: 0,
      contractRulesValidated: 0,
      securityConsiderationsValidated: 0,
    };
    console.log(JSON.stringify(output, null, 2));
    process.exit(2);
  }

  // Read and parse schema (validates it's valid JSON too)
  try {
    const content = fs.readFileSync(schemaPath, 'utf-8');
    JSON.parse(content); // We parse it to validate it's valid JSON, but we don't use ajv
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const output: ValidationOutput = {
      valid: false,
      manifestPath: options.manifest,
      errors: [`Failed to parse schema: ${errorMessage}`],
      warnings: [],
      checkpointsValidated: 0,
      contractRulesValidated: 0,
      securityConsiderationsValidated: 0,
    };
    console.log(JSON.stringify(output, null, 2));
    process.exit(2);
  }

  // Run validation
  const errors: string[] = [];
  const warnings: string[] = [];

  const { checkpointsValidated, contractRulesValidated, securityConsiderationsValidated } = validateManifest(
    manifest,
    options.manifest,
    errors,
    warnings,
  );

  const output: ValidationOutput = {
    valid: errors.length === 0,
    manifestPath: options.manifest,
    errors,
    warnings,
    checkpointsValidated,
    contractRulesValidated,
    securityConsiderationsValidated,
  };

  console.log(JSON.stringify(output, null, 2));
  process.exit(errors.length === 0 ? 0 : 1);
}

// ── Execute ────────────────────────────────────────────────────────

if (require.main === module) {
  main();
}