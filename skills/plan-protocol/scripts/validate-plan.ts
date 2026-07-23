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
  - Edge case coverage check (flags checkpoints with only happy-path ACs)
  - Severity consistency check (flags similar security concerns with inconsistent severity levels)
  - Verification method feasibility check (flags vague or impractical verification methods)
  - Non-functional requirements coverage check (flags missing NFR ACs for domain keywords)

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
      } else if (dep === cp.id) {
        addError(errors, `plan.checkpoints`, `checkpoint "${cp.id}" depends on itself (self-dependency)`);
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

const EDGE_CASE_KEYWORDS = [
  /\berror\b/i,
  /\binvalid\b/i,
  /\bfailure\b/i,
  /\bempty\b/i,
  /\bnull\b/i,
  /\bboundary\b/i,
  /\bedge\b/i,
  /\btimeout\b/i,
  /\brace\b/i,
  /\bconcurrent\b/i,
  /\blimit\b/i,
  /\boverflow\b/i,
  /\bexception\b/i,
  /\bmalformed\b/i,
  /\bcorrupt\b/i,
  /\bmissing\b/i,
  /\bunauthorized\b/i,
  /\bforbidden\b/i,
  /\bnot found\b/i,
  /\b404\b/i,
  /\b400\b/i,
  /\b500\b/i,
  /\brate limit\b/i,
];

const VAGUE_VERIFICATION_PATTERNS = [
  /\bmanual inspection\b/i,
  /\bvisual check\b/i,
  /\bask the team\b/i,
  /\bcode review\b(?!\s+(with|for)\b)/i,
  /\bdiscuss with\b/i,
  /\btalk to\b/i,
  /\bverify manually\b/i,
  /\bcheck manually\b/i,
  /\beyeball\b/i,
  /\blook at\b/i,
  /\breview the code\b(?!\s+(with|for)\b)/i,
];

const IMPRACTICAL_VERIFICATION_PATTERNS = [
  /\bdeploy to production\b/i,
  /\bask the customer\b/i,
  /\bwait and see\b/i,
  /\bmonitor in prod\b/i,
  /\bcheck after release\b/i,
];

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "as", "is", "was", "are", "be", "been",
  "it", "its", "this", "that", "these", "those", "not", "no", "if",
  "will", "can", "may", "should", "must", "has", "have", "had", "do",
  "does", "did", "would", "could", "might", "shall", "about", "into",
  "through", "during", "before", "after", "above", "below", "between",
  "out", "off", "over", "under", "again", "further", "then", "once",
  "here", "there", "when", "where", "why", "how", "all", "each", "every",
  "both", "few", "more", "most", "other", "some", "such", "only", "own",
  "same", "so", "than", "too", "very", "just", "also", "any", "new",
]);

const SEVERITY_MAP: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const DOMAIN_NFR_MAP: Array<{ domainKeywords: RegExp[]; nfrKeywords: RegExp[]; nfrName: string }> = [
  {
    domainKeywords: [/\bapi\b/i, /\bendpoint\b/i, /\broute\b/i, /\brequest\b/i, /\bresponse\b/i, /\bhttp\b/i],
    nfrKeywords: [/\bperformance\b/i, /\blatency\b/i, /\bresponse time\b/i, /\bthroughput\b/i, /\bload\b/i, /\bbenchmark\b/i, /\bms\b/i, /\bsecond\b/i],
    nfrName: "performance/load",
  },
  {
    domainKeywords: [/\bdatabase\b/i, /\bdb\b/i, /\bquery\b/i, /\bstore\b/i, /\bpersist\b/i, /\bcache\b/i],
    nfrKeywords: [/\bdata integrity\b/i, /\bperformance\b/i, /\blatency\b/i, /\bresponse time\b/i, /\bthroughput\b/i, /\bconsistent\b/i, /\bdurable\b/i],
    nfrName: "data integrity/performance",
  },
  {
    domainKeywords: [/\bnetwork\b/i, /\bremote\b/i, /\bservice\b/i, /\bintegration\b/i, /\bexternal\b/i],
    nfrKeywords: [/\bresilien(t|ce)\b/i, /\btimeout\b/i, /\bretry\b/i, /\bfallback\b/i, /\bcircuit break\b/i, /\bgraceful\b/i, /\bdegradation\b/i],
    nfrName: "resilience/timeout",
  },
  {
    domainKeywords: [/\bstate\b/i, /\bsession\b/i, /\bcontext\b/i, /\bconfig\b/i, /\bsetting\b/i],
    nfrKeywords: [/\blog\b/i, /\bmonitor\b/i, /\bmetric\b/i, /\btrace\b/i, /\bobservability\b/i, /\balert\b/i, /\bdashboard\b/i],
    nfrName: "observability/logging",
  },
  {
    domainKeywords: [/\blogin\b/i, /\bauth\b/i, /\btoken\b/i, /\bpassword\b/i, /\bpermission\b/i],
    nfrKeywords: [/\brate limit\b/i, /\baudit\b/i, /\bthrottle\b/i, /\babuse\b/i, /\bspam\b/i],
    nfrName: "rate-limiting/audit",
  },
];

function checkEdgeCaseCoverage(errors: ValidationError[], plan: Plan): void {
  for (const cp of plan.checkpoints) {
    const acs = cp.acceptance_criteria;
    if (acs.length === 0) continue;

    const hasEdgeCase = acs.some(ac =>
      EDGE_CASE_KEYWORDS.some(kw => kw.test(ac.description))
    );

    if (acs.length === 1 && !hasEdgeCase) {
      addError(
        errors,
        `plan.checkpoints.${cp.id}`,
        `checkpoint "${cp.id}" has only 1 AC and it does not cover edge cases (no edge case keywords found). Single-AC checkpoints should cover both happy path and edge cases.`
      );
    } else if (acs.length >= 2 && !hasEdgeCase) {
      addError(
        errors,
        `plan.checkpoints.${cp.id}`,
        `checkpoint "${cp.id}" has ${acs.length} ACs but none cover edge cases. Consider adding ACs for: error, invalid, failure, empty, null, boundary, timeout, etc.`
      );
    }
  }
}

function checkSeverityConsistency(errors: ValidationError[], plan: Plan): void {
  const allSCs: { id: string; description: string; severity: string; path: string }[] = [];

  for (const cp of plan.checkpoints) {
    for (const sc of cp.security_concerns || []) {
      allSCs.push({
        id: sc.id,
        description: sc.description,
        severity: sc.severity,
        path: `plan.checkpoints.${cp.id}.security_concerns.${sc.id}`,
      });
    }
    for (const ac of cp.acceptance_criteria) {
      for (const sc of ac.security_concerns || []) {
        allSCs.push({
          id: sc.id,
          description: sc.description,
          severity: sc.severity,
          path: `plan.checkpoints.${cp.id}.acceptance_criteria.${ac.id}.security_concerns.${sc.id}`,
        });
      }
    }
  }

  // Group SCs by keyword similarity: split into words, remove stop words, find groups sharing 2+ significant words
  const scWordSets = allSCs.map(sc => {
    const words = sc.description
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));
    return { ...sc, words: new Set(words) };
  });

  const groups: typeof scWordSets[] = [];

  for (let i = 0; i < scWordSets.length; i++) {
    let added = false;
    for (const group of groups) {
      // Check if this SC shares 2+ significant words with any SC already in the group
      for (const member of group) {
        let sharedCount = 0;
        for (const w of scWordSets[i].words) {
          if (member.words.has(w)) sharedCount++;
        }
        if (sharedCount >= 2) {
          group.push(scWordSets[i]);
          added = true;
          break;
        }
      }
      if (added) break;
    }
    if (!added) {
      groups.push([scWordSets[i]]);
    }
  }

  for (const group of groups) {
    if (group.length < 2) continue;
    const severities = group.map(sc => SEVERITY_MAP[sc.severity] ?? 0);
    const min = Math.min(...severities);
    const max = Math.max(...severities);
    if (max - min >= 2) {
      const scList = group.map(sc => `"${sc.id}" (${sc.severity})`).join(", ");
      addError(
        errors,
        `plan`,
        `security concerns with similar descriptions have inconsistent severity levels: ${scList}. Max-min gap is ${max - min} levels.`
      );
    }
  }
}

function checkVerificationFeasibility(errors: ValidationError[], plan: Plan): void {
  for (const cp of plan.checkpoints) {
    for (const ac of cp.acceptance_criteria) {
      const vm = ac.verification_method;

      for (const pattern of VAGUE_VERIFICATION_PATTERNS) {
        if (pattern.test(vm)) {
          addError(
            errors,
            `plan.checkpoints.${cp.id}.acceptance_criteria.${ac.id}.verification_method`,
            `verification method is vague: "${vm}". Replace with a concrete command (e.g., a script, test, or CLI invocation).`
          );
          break;
        }
      }

      for (const pattern of IMPRACTICAL_VERIFICATION_PATTERNS) {
        if (pattern.test(vm)) {
          addError(
            errors,
            `plan.checkpoints.${cp.id}.acceptance_criteria.${ac.id}.verification_method`,
            `verification method is impractical: "${vm}". Replace with a concrete, verifiable command.`
          );
          break;
        }
      }
    }
  }
}

function checkNfrCoverage(errors: ValidationError[], plan: Plan): void {
  for (const cp of plan.checkpoints) {
    const acDescriptions = cp.acceptance_criteria.map(ac => ac.description);

    for (const domain of DOMAIN_NFR_MAP) {
      const hasDomainKeyword = acDescriptions.some(desc =>
        domain.domainKeywords.some(kw => kw.test(desc))
      );
      if (!hasDomainKeyword) continue;

      const hasNfrKeyword = acDescriptions.some(desc =>
        domain.nfrKeywords.some(kw => kw.test(desc))
      );
      if (!hasNfrKeyword) {
        addError(
          errors,
          `plan.checkpoints.${cp.id}`,
          `checkpoint "${cp.id}" contains domain keywords suggesting ${domain.nfrName} NFRs should be covered, but no AC addresses them. Consider adding an AC for ${domain.nfrName}.`
        );
      }
    }
  }
}

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

  // New strict checks
  checkEdgeCaseCoverage(errors, plan);
  checkSeverityConsistency(errors, plan);
  checkVerificationFeasibility(errors, plan);
  checkNfrCoverage(errors, plan);
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

