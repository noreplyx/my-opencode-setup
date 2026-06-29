import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import Ajv from "ajv";
import type { SecurityConcern, AcceptanceCriterion, Checkpoint, Plan, PlanData } from "./types.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function showHelp(): void {
  const help = `
Usage: bun scripts/validate-plan.ts [--help] [--strict] <plan.json>

Validate a plan JSON against the plan-protocol schema and integrity rules.

Checks:
  - Schema conformance (all required fields, types, patterns, enums)
  - Checkpoint ID uniqueness (no duplicate CP IDs)
  - Dependency reference integrity (all deps point to existing checkpoints)
  - Circular dependency detection (no cycles)
  - Dependency ordering (checkpoints must be ordered so deps appear before their dependents)
  - AC ID uniqueness (no duplicate AC IDs across all checkpoints)
  - SC ID uniqueness (no duplicate SC IDs across all checkpoints and ACs)

With --strict:
  - Subjective language detection in AC descriptions ("looks good", "should work", etc.)
  - Verification method must be a concrete command (not generic placeholder text)
  - Mitigation must be non-empty and actionable
  - AC description must not be a generic placeholder
  - Checkpoint description must not be a generic placeholder

Exit code 0 = valid, exit code 1 = invalid.
`;
  console.log(help);
}

interface ValidationError {
  path: string;
  msg: string;
}

const schemaPath = resolve(__dirname, "..", "references", "plan-protocol-schema.json");
const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));

const ajv = new Ajv({ strict: true });
const validateSchema = ajv.compile(schema);

function addError(errors: ValidationError[], path: string, msg: string): void {
  errors.push({ path, msg });
}

function validateGraph(errors: ValidationError[], plan: Plan): void {
  const checkpoints = plan.checkpoints;
  const cpIds = new Set<string>();

  for (const cp of checkpoints) {
    if (cpIds.has(cp.id)) {
      addError(errors, `plan.checkpoints`, `duplicate checkpoint ID "${cp.id}"`);
    }
    cpIds.add(cp.id);
  }

  const graph = new Map<string, Set<string>>();
  const orderIndex = new Map<string, number>();
  for (let i = 0; i < checkpoints.length; i++) {
    const cp = checkpoints[i];
    orderIndex.set(cp.id, i);
    const deps = cp.dependencies || [];
    for (const dep of deps) {
      if (!cpIds.has(dep)) {
        addError(errors, `plan.checkpoints`, `checkpoint "${cp.id}" depends on "${dep}" which does not exist`);
      } else {
        const depIdx = orderIndex.get(dep) ?? i;
        if (depIdx >= i) {
          addError(errors, `plan.checkpoints`, `checkpoint "${cp.id}" (index ${i}) depends on "${dep}" (index ${depIdx}) which appears later in the checkpoints array (dependency ordering violation)`);
        }
      }
    }
    graph.set(cp.id, new Set(deps));
  }

  const visited = new Set<string>();
  const recStack = new Set<string>();
  const parent = new Map<string, string | null>();

  function dfs(node: string): boolean {
    visited.add(node);
    recStack.add(node);
    for (const neighbor of graph.get(node) || []) {
      if (!cpIds.has(neighbor)) continue;
      if (!visited.has(neighbor)) {
        parent.set(neighbor, node);
        if (dfs(neighbor)) return true;
      } else if (recStack.has(neighbor)) {
        const cyclePath: string[] = [];
        let current: string | null | undefined = node;
        while (current && current !== neighbor) {
          cyclePath.unshift(current);
          current = parent.get(current);
        }
        cyclePath.unshift(neighbor);
        cyclePath.push(neighbor);
        addError(errors, "plan.checkpoints", `circular dependency detected: ${cyclePath.join(" → ")}`);
        return true;
      }
    }
    recStack.delete(node);
    return false;
  }

  for (const cp of checkpoints) {
    if (!visited.has(cp.id)) {
      parent.set(cp.id, null);
      dfs(cp.id);
    }
  }

  const acIds = new Set<string>();
  for (const cp of checkpoints) {
    for (const ac of cp.acceptance_criteria || []) {
      if (acIds.has(ac.id)) {
        addError(errors, "plan.checkpoints", `duplicate acceptance criterion ID "${ac.id}" across checkpoints`);
      }
      acIds.add(ac.id);
    }
  }

  const scIds = new Set<string>();
  for (const cp of checkpoints) {
    for (const sc of cp.security_concerns || []) {
      if (scIds.has(sc.id)) {
        addError(errors, "plan.checkpoints", `duplicate security concern ID "${sc.id}" across checkpoints`);
      }
      scIds.add(sc.id);
    }
    for (const ac of cp.acceptance_criteria || []) {
      for (const sc of ac.security_concerns || []) {
        if (scIds.has(sc.id)) {
          addError(errors, "plan.checkpoints", `duplicate security concern ID "${sc.id}" across checkpoints`);
        }
        scIds.add(sc.id);
      }
    }
  }
}

const SUBJECTIVE_PATTERNS = [
  /\blooks?\s+(good|fine|ok|correct|right)\b/i,
  /\bshould\s+work\b/i,
  /\bseems?\s+(correct|right|fine)\b/i,
  /\bappears?\s+(correct|right|fine)\b/i,
  /\bprobably\s+(works?|fine|ok)\b/i,
];

const PLACEHOLDER_PATTERNS = [
  /^verifiable condition/i,
  /^description of what/i,
  /^how to verify/i,
  /^security risk or concern/i,
  /^recommended action/i,
];

function validateSemantic(errors: ValidationError[], plan: Plan): void {
  for (const cp of plan.checkpoints) {
    if (PLACEHOLDER_PATTERNS.some(p => p.test(cp.description))) {
      addError(errors, `plan.checkpoints.${cp.id}.description`, `checkpoint description is a generic placeholder: "${cp.description}"`);
    }
    for (const ac of cp.acceptance_criteria) {
      if (PLACEHOLDER_PATTERNS.some(p => p.test(ac.description))) {
        addError(errors, `plan.checkpoints.${cp.id}.acceptance_criteria.${ac.id}.description`, `AC description is a generic placeholder: "${ac.description}"`);
      }
      if (SUBJECTIVE_PATTERNS.some(p => p.test(ac.description))) {
        addError(errors, `plan.checkpoints.${cp.id}.acceptance_criteria.${ac.id}.description`, `AC description contains subjective language: "${ac.description}"`);
      }
      if (PLACEHOLDER_PATTERNS.some(p => p.test(ac.verification_method))) {
        addError(errors, `plan.checkpoints.${cp.id}.acceptance_criteria.${ac.id}.verification_method`, `verification method is a generic placeholder: "${ac.verification_method}"`);
      }
      if (ac.verification_method.length < 10) {
        addError(errors, `plan.checkpoints.${cp.id}.acceptance_criteria.${ac.id}.verification_method`, `verification method is too short (${ac.verification_method.length} chars), must be a concrete command`);
      }
    }
    for (const sc of cp.security_concerns || []) {
      if (PLACEHOLDER_PATTERNS.some(p => p.test(sc.description))) {
        addError(errors, `plan.checkpoints.${cp.id}.security_concerns.${sc.id}.description`, `security concern description is a generic placeholder: "${sc.description}"`);
      }
      if (PLACEHOLDER_PATTERNS.some(p => p.test(sc.mitigation))) {
        addError(errors, `plan.checkpoints.${cp.id}.security_concerns.${sc.id}.mitigation`, `mitigation is a generic placeholder: "${sc.mitigation}"`);
      }
      if (sc.mitigation.length < 10) {
        addError(errors, `plan.checkpoints.${cp.id}.security_concerns.${sc.id}.mitigation`, `mitigation is too short (${sc.mitigation.length} chars), must be an actionable recommendation`);
      }
    }
    for (const ac of cp.acceptance_criteria) {
      for (const sc of ac.security_concerns || []) {
        if (PLACEHOLDER_PATTERNS.some(p => p.test(sc.description))) {
          addError(errors, `plan.checkpoints.${cp.id}.acceptance_criteria.${ac.id}.security_concerns.${sc.id}.description`, `security concern description is a generic placeholder: "${sc.description}"`);
        }
        if (PLACEHOLDER_PATTERNS.some(p => p.test(sc.mitigation))) {
          addError(errors, `plan.checkpoints.${cp.id}.acceptance_criteria.${ac.id}.security_concerns.${sc.id}.mitigation`, `mitigation is a generic placeholder: "${sc.mitigation}"`);
        }
        if (sc.mitigation.length < 10) {
          addError(errors, `plan.checkpoints.${cp.id}.acceptance_criteria.${ac.id}.security_concerns.${sc.id}.mitigation`, `mitigation is too short (${sc.mitigation.length} chars), must be an actionable recommendation`);
        }
      }
    }
  }
}

export function validatePlan(data: unknown, strict = false): ValidationError[] {
  const errors: ValidationError[] = [];

  const valid = validateSchema(data);
  if (!valid && validateSchema.errors) {
    for (const err of validateSchema.errors) {
      addError(errors, err.instancePath || "/", `${err.message}${err.params ? " (" + JSON.stringify(err.params) + ")" : ""}`);
    }
  }

  const planData = data as PlanData | null;
  if (planData && planData.plan && planData.plan.checkpoints) {
    validateGraph(errors, planData.plan);
    if (strict) {
      validateSemantic(errors, planData.plan);
    }
  }

  return errors;
}

// CLI entry point
const entryScript = process.argv[1] || '';
if (entryScript.endsWith('validate-plan.ts') || entryScript.endsWith('validate-plan')) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    showHelp();
    process.exit(0);
  }
  const strict = args.includes("--strict");
  const nonFlagArgs = args.filter(a => !a.startsWith("--"));
  const dataPath = resolve(nonFlagArgs[0] || "output.json");
  const data = JSON.parse(readFileSync(dataPath, "utf-8"));
  const errors = validatePlan(data, strict);

  if (errors.length > 0) {
    console.error("Validation failed:");
    for (const err of errors) {
      console.error(`  ${err.path}: ${err.msg}`);
    }
    process.exit(1);
  }
  console.log("Validation passed");
}

