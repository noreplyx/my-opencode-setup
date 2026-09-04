import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const CONTRACT_FIELDS = [
  "Goal",
  "Scope",
  "Constraints",
  "Inputs",
  "Expected output",
  "Completion criteria",
  "Risks/ambiguities",
];

export const SUPPORTED_DELEGATION_PATHS = [
  "brainstormer", "code-planner", "coder", "verifier",
  "code-reviewer", "security-reviewer", "performance-reviewer",
  "best-practices-reviewer", "code-security-scanner",
];

export function validatePlannerResult(result) {
  const errors = [];
  if (!result || !["low", "medium", "high"].includes(result.risk)) errors.push("risk");
  if (typeof result?.auto_approve !== "boolean") errors.push("auto_approve");
  if (result?.auto_approve === true && result.risk !== "low") errors.push("auto_approve requires low risk");
  return errors;
}

export function validateHandoffFlow(flow) {
  const errors = [];
  const contract = flow?.contract;
  if (!contract || CONTRACT_FIELDS.some((field) => typeof contract[field] !== "string" || !contract[field].trim())) errors.push("flow contract is incomplete");
  errors.push(...validatePlannerResult(flow?.plannerResult).map((item) => `planner result missing ${item}`));
  const handoffs = flow?.handoffs;
  if (!Array.isArray(handoffs) || handoffs.length !== SUPPORTED_DELEGATION_PATHS.length) {
    errors.push("flow does not include every supported delegation path");
    return errors;
  }
  for (const name of SUPPORTED_DELEGATION_PATHS) {
    const handoff = handoffs.find((item) => item?.name === name);
    if (!handoff) errors.push(`flow missing ${name}`);
    else if (JSON.stringify(handoff.contract) !== JSON.stringify(contract)) errors.push(`${name}: contract was not propagated`);
  }
  return errors;
}

export function isCompletionReady(report, expectedCriteria = report?.expectedCriteria) {
  if (report?.verdict !== "pass") return false;
  const criteria = report.criteria;
  if (!Array.isArray(expectedCriteria) || expectedCriteria.length === 0 || !Array.isArray(criteria)) return false;

  const expectedIds = expectedCriteria.map((criterion) => criterion?.id);
  const actualIds = criteria.map((criterion) => criterion?.id);
  if (expectedIds.some((id) => typeof id !== "string" || !id.trim())) return false;
  if (new Set(expectedIds).size !== expectedIds.length || new Set(actualIds).size !== actualIds.length) return false;
  if (criteria.length !== expectedCriteria.length || actualIds.some((id) => !expectedIds.includes(id))) return false;

  return expectedCriteria.every((expected) => {
    if (expected?.mandatory === false) return true;
    const criterion = criteria.find((item) => item.id === expected.id);
    return criterion?.status === "pass" && typeof criterion.evidence === "string" && criterion.evidence.trim();
  });
}

export function validatePrompt(name, source) {
  const missing = CONTRACT_FIELDS.filter((field) => !source.includes(field));
  if (name === "code-planner" && !/stable ID|stable IDs/.test(source)) missing.push("stable criterion IDs");
  if (name === "coder" && !/Criterion mapping/.test(source)) missing.push("criterion mapping");
  if (name === "verifier" && !/not-verifiable/.test(source)) missing.push("not-verifiable verdict");
  return missing;
}

export async function validateRepository(root) {
  const files = Object.fromEntries([
    ["contract", "agent/delegation-contract.md"],
    ["orchestrator", "agent/code-orchestrator.md"],
    ...SUPPORTED_DELEGATION_PATHS.map((name) => [name, `agent/${name}.md`]),
  ]);
  const errors = [];
  for (const [name, relativePath] of Object.entries(files)) {
    const source = await readFile(path.join(root, relativePath), "utf8");
    errors.push(...validatePrompt(name, source).map((item) => `${relativePath}: missing ${item}`));
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const errors = await validateRepository(root);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("delegation contract validation passed");
  }
}
