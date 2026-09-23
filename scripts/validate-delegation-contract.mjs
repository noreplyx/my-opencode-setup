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

export const HANDOFF_SCHEMA_VERSION = "v1";

export const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function fieldAnchored(source, field) {
  return new RegExp(`^[^\\n]*${escapeRegExp(field)}`, "m").test(source);
}
export const SUPPORTED_DELEGATION_PATHS = [
  "brainstormer", "code-planner", "coder", "verifier",
  "code-reviewer", "security-reviewer", "performance-reviewer",
  "best-practices-reviewer", "reliability-reviewer",
  "test-correctness-reviewer", "code-security-scanner", "vcs-committer",
  "gh-reviewer",
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

export function handoffSchemaVersion(handoff) {
  return handoff?.schemaVersion ?? HANDOFF_SCHEMA_VERSION;
}

export function validateBrainstormHandoff(handoff) {
  const errors = [];
  if (handoff?.schemaVersion !== undefined && handoff.schemaVersion !== HANDOFF_SCHEMA_VERSION) {
    errors.push(`unsupported handoff schema version: ${handoff.schemaVersion}`);
  }
  const catalog = handoff?.optionsCatalog;
  if (!Array.isArray(catalog) || catalog.length === 0) {
    errors.push("options catalog is missing or empty");
    return errors;
  }
  for (const [index, option] of catalog.entries()) {
    for (const field of ["title", "summary", "pros", "cons", "effortRisk", "whatItDoes"]) {
      if (typeof option?.[field] !== "string" || !option[field].trim()) errors.push(`option ${index}: missing ${field}`);
    }
    if (typeof option?.summary === "string" && option.summary.split(/\s+/).filter(Boolean).length > 150) errors.push(`option ${index}: summary exceeds ~150 words`);
    if (option?.rejected === true && (typeof option?.rejectedIndex !== "number" || !Number.isInteger(option.rejectedIndex) || option.rejectedIndex < 0 || option.rejectedIndex >= catalog.length || typeof option?.rejectionReason !== "string" || !option.rejectionReason.trim())) errors.push(`option ${index}: rejected entry must retain rejectedIndex pointer and rejectionReason`);
  }
  if (catalog.length >= 2 && (typeof handoff?.comparison !== "string" || !handoff.comparison.trim())) errors.push("comparison required when ≥2 options");
  // Recommendation is always required, even for a single option, so the
  // downstream planner receives a compatible decision shape.
  if (typeof handoff?.recommendation !== "string" || !handoff.recommendation.trim()) errors.push("recommendation required after comparison");
  if (typeof handoff?.comparison === "string" && handoff.comparison.length > 8000) errors.push("comparison exceeds 8000 characters");
  if (typeof handoff?.recommendation === "string" && handoff.recommendation.length > 8000) errors.push("recommendation exceeds 8000 characters");
  return errors;
}

export function validatePrompt(name, source) {
  const missing = CONTRACT_FIELDS.filter((field) => !fieldAnchored(source, field));
  if (name === "code-planner" && !/stable ID|stable IDs/.test(source)) missing.push("stable criterion IDs");
  if (name === "coder" && !/Criterion mapping/.test(source)) missing.push("criterion mapping");
  if (name === "verifier" && !/not-verifiable/.test(source)) missing.push("not-verifiable verdict");
  if (name === "brainstormer" && !/What-it-does/.test(source)) missing.push("what-it-does field");
  if (name === "brainstormer" && !/Options catalog/.test(source)) missing.push("options catalog schema");
  if (name === "brainstormer" && !/Comparison/.test(source)) missing.push("comparison artifact");
  if (name === "brainstormer" && !/Recommendation/.test(source)) missing.push("recommendation artifact");
  if (name === "brainstormer" && !/Effort\/risk/.test(source)) missing.push("effort-risk field");
  if (name === "brainstormer" && !/never drop/.test(source)) missing.push("paginate-never-drop rule");
  if ((name === "code-orchestrator" || name === "orchestrator") && !/Do not collapse options to titles/.test(source)) missing.push("present-all rule");
  if ((name === "code-orchestrator" || name === "orchestrator") && !/verbatim\s+pass-through/.test(source)) missing.push("verbatim pass-through renderer");
  if ((name === "code-orchestrator" || name === "orchestrator") && !/fixed order/.test(source)) missing.push("fixed presentation order");
  if ((name === "code-orchestrator" || name === "orchestrator") && !/re-delegate/.test(source)) missing.push("re-delegate guardrail");
  if (name === "gh-reviewer" && !/only against.*Inputs|scope-pin|refuse cross-repo/i.test(source)) missing.push("scope-pin rule");
  if ((name === "code-orchestrator" || name === "orchestrator") && !/never drop/.test(source)) missing.push("paginate-never-drop rule");
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
    let source;
    try {
      source = await readFile(path.join(root, relativePath), "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") errors.push(`${relativePath}: unreadable file`);
      else errors.push(`${relativePath}: unreadable file (${error?.code ?? error?.errno ?? "unknown error"})`);
      continue;
    }
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
