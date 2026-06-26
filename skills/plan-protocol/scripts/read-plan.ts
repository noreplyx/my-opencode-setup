import { readFileSync } from "fs";
import { resolve } from "path";
import { validatePlan } from "./validate-plan.ts";
import type { SecurityConcern, AcceptanceCriterion, Checkpoint, Plan, PlanData } from "./types.ts";

function icon(emoji: string, text: string, noEmoji: boolean): string {
  return noEmoji ? text : emoji;
}

export function renderCheckpoint(cp: Checkpoint, noEmoji = false): string {
  const lines: string[] = [];
  const acCount = cp.acceptance_criteria.length;
  const scCount = (cp.security_concerns || []).length + cp.acceptance_criteria.reduce((sum, ac) => sum + (ac.security_concerns || []).length, 0);
  const passedACs = cp.acceptance_criteria.filter(ac => ac.status === "passed").length;
  const statusTag = passedACs === acCount ? icon("✅", "[done]", noEmoji) : icon("⬜", "[pending]", noEmoji);
  lines.push(`### [${cp.id}] ${cp.title} ${statusTag} (${passedACs}/${acCount} ACs, ${scCount} SCs)`);
  lines.push("");
  lines.push(`**Description:** ${cp.description}`);
  lines.push("");
  const deps = cp.dependencies.length > 0 ? cp.dependencies.join(", ") : "None";
  lines.push(`**Dependencies:** ${deps}`);
  const blockers = cp.blockers || [];
  if (blockers.length > 0) {
    lines.push("");
    lines.push(`**Blockers:**`);
    for (const b of blockers) {
      const resolved = b.resolved ? " (resolved)" : "";
      lines.push(`- ${icon("🚫", "[BLOCKED]", noEmoji)} ${b.reason}${resolved}`);
    }
  }
  lines.push("");
  lines.push("**Acceptance Criteria:**");
  for (const ac of cp.acceptance_criteria) {
    const statusIcon = ac.status === "passed" ? icon("✅", "[PASS]", noEmoji) : ac.status === "failed" ? icon("❌", "[FAIL]", noEmoji) : ac.status === "blocked" ? icon("🚫", "[BLOCKED]", noEmoji) : icon("⬜", "[ ]", noEmoji);
    const statusSuffix = ac.status && ac.status !== "pending" ? ` [${ac.status}]` : "";
    lines.push(`- ${statusIcon} [${ac.id}] ${ac.description}${statusSuffix} — *Verify: ${ac.verification_method}*`);
  }
  const cpScs = cp.security_concerns || [];
  if (cpScs.length > 0) {
    lines.push("");
    lines.push("**Security Concerns:**");
    for (const sc of cpScs) {
      lines.push(`- [${sc.id}] [${sc.severity}] ${sc.description}`);
      lines.push(`  - **Mitigation:** ${sc.mitigation}`);
    }
  }
  for (const ac of cp.acceptance_criteria) {
    const acScs = ac.security_concerns || [];
    if (acScs.length > 0) {
      lines.push("");
      lines.push(`**Security Concerns (${ac.id}):**`);
      for (const sc of acScs) {
        lines.push(`- [${sc.id}] [${sc.severity}] ${sc.description}`);
        lines.push(`  - **Mitigation:** ${sc.mitigation}`);
      }
    }
  }
  return lines.join("\n");
}

function countSeverities(plan: Plan): { critical: number; high: number; medium: number; low: number } {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const cp of plan.checkpoints) {
    for (const sc of cp.security_concerns || []) {
      if (sc.severity in counts) counts[sc.severity as keyof typeof counts]++;
    }
    for (const ac of cp.acceptance_criteria) {
      for (const sc of ac.security_concerns || []) {
        if (sc.severity in counts) counts[sc.severity as keyof typeof counts]++;
      }
    }
  }
  return counts;
}

export interface AnalysisResult {
  executionOrder: string;
  criticalPath: string;
  parallelGroups: string[];
  severityCounts: { critical: number; high: number; medium: number; low: number };
  criticalHighSCs: { id: string; description: string; severity: string; parent: string }[];
}

export function analyzePlan(plan: Plan): AnalysisResult {
  const checkpoints = plan.checkpoints;
  const cpMap = new Map<string, typeof checkpoints[0]>();
  for (const cp of checkpoints) cpMap.set(cp.id, cp);

  // Topological sort (already ordered by dependency, but compute groups)
  const visited = new Set<string>();
  const levels: string[][] = [];
  const levelMap = new Map<string, number>();

  function getLevel(id: string): number {
    if (levelMap.has(id)) return levelMap.get(id)!;
    if (visited.has(id)) return 0;
    visited.add(id);
    const cp = cpMap.get(id);
    if (!cp || cp.dependencies.length === 0) {
      levelMap.set(id, 0);
      return 0;
    }
    const depLevels = cp.dependencies.map(d => getLevel(d));
    const level = Math.max(...depLevels) + 1;
    levelMap.set(id, level);
    return level;
  }

  for (const cp of checkpoints) getLevel(cp.id);

  const maxLevel = Math.max(...Array.from(levelMap.values()));
  for (let l = 0; l <= maxLevel; l++) levels.push([]);
  for (const cp of checkpoints) {
    const l = levelMap.get(cp.id) ?? 0;
    levels[l].push(cp.id);
  }

  // Build execution order string
  const orderParts: string[] = [];
  for (const group of levels) {
    if (group.length === 1) {
      orderParts.push(group[0]);
    } else {
      orderParts.push(`[${group.join(", ")}] (parallel)`);
    }
  }
  const executionOrder = orderParts.join(" → ");

  // Critical path: longest chain through sequential deps
  const longestPath = new Map<string, { length: number; path: string[] }>();
  function getLongestPath(id: string): { length: number; path: string[] } {
    if (longestPath.has(id)) return longestPath.get(id)!;
    const cp = cpMap.get(id);
    if (!cp || cp.dependencies.length === 0) {
      const result = { length: 1, path: [id] };
      longestPath.set(id, result);
      return result;
    }
    let best = { length: 0, path: [] as string[] };
    for (const dep of cp.dependencies) {
      const sub = getLongestPath(dep);
      if (sub.length > best.length) best = sub;
    }
    const result = { length: best.length + 1, path: [...best.path, id] };
    longestPath.set(id, result);
    return result;
  }

  let criticalPathResult = { length: 0, path: [] as string[] };
  for (const cp of checkpoints) {
    const r = getLongestPath(cp.id);
    if (r.length > criticalPathResult.length) criticalPathResult = r;
  }
  const criticalPath = criticalPathResult.path.join(" → ") + ` (${criticalPathResult.length} steps)`;

  // Parallel groups
  const parallelGroups: string[] = [];
  for (const group of levels) {
    if (group.length > 1) {
      parallelGroups.push(`${group.join(", ")} (all depend on ${checkpoints.find(c => c.id === group[0])?.dependencies.join(", ") || "root"})`);
    }
  }

  // Security context
  const sev = countSeverities(plan);
  const criticalHighSCs: AnalysisResult["criticalHighSCs"] = [];
  for (const cp of checkpoints) {
    for (const sc of cp.security_concerns || []) {
      if (sc.severity === "critical" || sc.severity === "high") {
        criticalHighSCs.push({ id: sc.id, description: sc.description, severity: sc.severity, parent: cp.id });
      }
    }
    for (const ac of cp.acceptance_criteria) {
      for (const sc of ac.security_concerns || []) {
        if (sc.severity === "critical" || sc.severity === "high") {
          criticalHighSCs.push({ id: sc.id, description: sc.description, severity: sc.severity, parent: `${cp.id}/${ac.id}` });
        }
      }
    }
  }

  return { executionOrder, criticalPath, parallelGroups, severityCounts: sev, criticalHighSCs };
}

export function renderAnalysis(plan: Plan, noEmoji = false): string {
  const analysis = analyzePlan(plan);
  const lines: string[] = [];
  lines.push(`## Plan Analysis: ${plan.title}`);
  lines.push("");
  lines.push(`**Execution Order:** ${analysis.executionOrder}`);
  lines.push(`**Critical Path:** ${analysis.criticalPath}`);
  if (analysis.parallelGroups.length > 0) {
    for (const g of analysis.parallelGroups) {
      lines.push(`**Parallelizable Group:** ${g}`);
    }
  }
  lines.push("");
  lines.push("**Security Context:**");
  lines.push(`- Critical SCs: ${analysis.severityCounts.critical}`);
  lines.push(`- High SCs: ${analysis.severityCounts.high}`);
  lines.push(`- Medium SCs: ${analysis.severityCounts.medium}`);
  lines.push(`- Low SCs: ${analysis.severityCounts.low}`);
  if (analysis.criticalHighSCs.length > 0) {
    lines.push("");
    lines.push("**Critical/High Security Concerns:**");
    for (const sc of analysis.criticalHighSCs) {
      lines.push(`- [${sc.id}] [${sc.severity}] ${sc.description} (${sc.parent})`);
    }
  }
  lines.push("");
  lines.push("**Progress:**");
  let totalACs = 0;
  let passedACs = 0;
  let failedACs = 0;
  let blockedACs = 0;
  for (const cp of plan.checkpoints) {
    const total = cp.acceptance_criteria.length;
    const passed = cp.acceptance_criteria.filter(ac => ac.status === "passed").length;
    const failed = cp.acceptance_criteria.filter(ac => ac.status === "failed").length;
    const blocked = cp.acceptance_criteria.filter(ac => ac.status === "blocked").length;
    totalACs += total;
    passedACs += passed;
    failedACs += failed;
    blockedACs += blocked;
    const statusIcon = passed === total ? icon("✅", "[done]", noEmoji) : failed > 0 ? icon("❌", "[fail]", noEmoji) : blocked > 0 ? icon("🚫", "[BLOCKED]", noEmoji) : icon("⬜", "[pending]", noEmoji);
    const blockers = (cp.blockers || []).length > 0 ? ` ${icon("🚫", "[BLOCKED]", noEmoji)} ${cp.blockers!.length} blocker(s)` : "";
    lines.push(`- ${statusIcon} ${cp.id}: ${passed}/${total} ACs passed${blockers}`);
  }
  lines.push("");
  lines.push(`**Overall:** ${passedACs}/${totalACs} ACs passed, ${failedACs} failed, ${blockedACs} blocked`);
  const allBlockers: string[] = [];
  for (const cp of plan.checkpoints) {
    for (const b of cp.blockers || []) {
      allBlockers.push(`${cp.id}: ${b.reason}`);
    }
  }
  if (allBlockers.length > 0) {
    lines.push("");
    lines.push("**Blockers:**");
    for (const b of allBlockers) {
      lines.push(`- ${icon("🚫", "[BLOCKED]", noEmoji)} ${b}`);
    }
  } else {
    lines.push("**Blockers:** None");
  }
  return lines.join("\n");
}

export function renderSummary(plan: Plan): string {
  const checkpoints = plan.checkpoints;
  let totalACs = 0;
  let totalSCs = 0;
  for (const cp of checkpoints) {
    totalACs += cp.acceptance_criteria.length;
    totalSCs += (cp.security_concerns || []).length;
    for (const ac of cp.acceptance_criteria) {
      totalSCs += (ac.security_concerns || []).length;
    }
  }
  const sev = countSeverities(plan);
  const lines: string[] = [];
  lines.push("---");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- **Total Checkpoints:** ${checkpoints.length}`);
  lines.push(`- **Total Acceptance Criteria:** ${totalACs}`);
  lines.push(`- **Total Security Concerns:** ${totalSCs}`);
  lines.push(`- **Critical Concerns:** ${sev.critical}`);
  lines.push(`- **High Concerns:** ${sev.high}`);
  lines.push(`- **Medium Concerns:** ${sev.medium}`);
  lines.push(`- **Low Concerns:** ${sev.low}`);
  return lines.join("\n");
}

export function renderPlan(plan: Plan, noEmoji = false): string {
  const output: string[] = [];
  output.push(`# Plan: ${plan.title}`);
  output.push("");
  output.push(`**Description:** ${plan.description}`);
  output.push("");
  output.push(`**Overview:** ${plan.overview}`);
  output.push("");
  output.push("---");
  output.push("");
  output.push("## Checkpoints");
  output.push("");

  for (let i = 0; i < plan.checkpoints.length; i++) {
    if (i > 0) {
      output.push("");
      output.push("---");
    }
    output.push("");
    output.push(renderCheckpoint(plan.checkpoints[i], noEmoji));
  }

  output.push("");
  output.push(renderSummary(plan));
  return output.join("\n");
}



function renderSchemaDocs(): string {
  const lines: string[] = [];
  lines.push("# Plan Protocol Schema Reference");
  lines.push("");
  lines.push("The plan protocol defines a structured JSON format for describing multi-checkpoint implementation plans with acceptance criteria, security concerns, dependency graphs, and progress tracking.");
  lines.push("");
  lines.push("## Root Structure");
  lines.push("");
  lines.push("```");
  lines.push("plan/");
  lines.push("  title          (string, required)  — Short, descriptive title of the plan");
  lines.push("  description    (string, required)  — One-sentence summary of what the plan achieves");
  lines.push("  overview       (string, required)  — Detailed overview of context, goals, and constraints");
  lines.push("  version        (string, optional)  — Semantic version (e.g., '1.0.0')");
  lines.push("  created_at     (string, optional)  — ISO 8601 creation timestamp");
  lines.push("  updated_at     (string, optional)  — ISO 8601 last-modified timestamp");
  lines.push("  checkpoints[]  (array, required)   — Ordered list of implementation checkpoints (min 1)");
  lines.push("```");
  lines.push("");
  lines.push("## Checkpoint (CP-*)");
  lines.push("");
  lines.push("Each checkpoint is a single implementation step. It must be independently verifiable, ordered by dependency, and sized for one focused work session.");
  lines.push("");
  lines.push("```");
  lines.push("checkpoint/");
  lines.push("  id                  (string, required)  — Unique ID matching pattern ^CP-\\d+$ (e.g., CP-01)");
  lines.push("  title               (string, required)  — Short name for the checkpoint");
  lines.push("  description         (string, required)  — Detailed description of what this step entails");
  lines.push("  dependencies[]      (array, required)   — IDs of checkpoints that must be completed first");
  lines.push("  acceptance_criteria (array, required)   — Verifiable conditions for completion (min 1)");
  lines.push("  security_concerns[] (array, optional)   — Architectural/design-level security risks");
  lines.push("  blockers[]          (array, optional)   — Reasons this checkpoint is blocked");
  lines.push("```");
  lines.push("");
  lines.push("### Dependencies");
  lines.push("");
  lines.push("- Each dependency must reference an existing checkpoint ID (pattern ^CP-\\d+$)");
  lines.push("- Dependencies must appear earlier in the checkpoints array (ordering constraint)");
  lines.push("- No circular dependencies allowed (e.g., CP-02 → CP-03 → CP-02)");
  lines.push("- Use `[]` for checkpoints with no dependencies (do not omit the field)");
  lines.push("");
  lines.push("## Acceptance Criterion (AC-*-*)");
  lines.push("");
  lines.push("Each criterion is a single verifiable condition. All criteria must be met for the checkpoint to be considered complete.");
  lines.push("");
  lines.push("```");
  lines.push("acceptance_criterion/");
  lines.push("  id                  (string, required)  — Unique ID matching ^AC-\\d+-\\d+$ (e.g., AC-01-01)");
  lines.push("  description         (string, required)  — Verifiable condition (must be objective, not subjective)");
  lines.push("  verification_method (string, required)  — How to verify (test command, code review, manual inspection)");
  lines.push("  security_concerns[] (array, optional)   — Implementation-level security risks for this criterion");
  lines.push("  status              (enum, optional)    — pending | passed | failed | blocked (default: pending)");
  lines.push("```");
  lines.push("");
  lines.push("### Status Tracking");
  lines.push("");
  lines.push("- `pending` — Not yet verified (default)");
  lines.push("- `passed` — Verification succeeded");
  lines.push("- `failed` — Verification failed");
  lines.push("- `blocked` — Cannot be verified due to external blocker");
  lines.push("- A checkpoint is complete only when ALL its ACs are `passed`");
  lines.push("");
  lines.push("## Security Concern (SC-*)");
  lines.push("");
  lines.push("Security concerns can appear at two levels: checkpoint-level (architectural risks) and AC-level (implementation risks).");
  lines.push("");
  lines.push("```");
  lines.push("security_concern/");
  lines.push("  id          (string, required)  — Unique ID matching ^SC-\\d+(-\\d+)?$ (e.g., SC-01, SC-01-01)");
  lines.push("  description (string, required)  — Description of the security risk");
  lines.push("  severity    (enum, required)    — critical | high | medium | low");
  lines.push("  mitigation  (string, required)  — Recommended action to address or reduce the risk");
  lines.push("```");
  lines.push("");
  lines.push("### Severity Levels");
  lines.push("");
  lines.push("- `critical` — Must be addressed before implementation can proceed");
  lines.push("- `high` — Must be addressed during implementation");
  lines.push("- `medium` — Should be addressed but does not block");
  lines.push("- `low` — Nice to have; address if time permits");
  lines.push("");
  lines.push("## Blocker");
  lines.push("");
  lines.push("Blockers represent external reasons a checkpoint cannot proceed.");
  lines.push("");
  lines.push("```");
  lines.push("blocker/");
  lines.push("  reason      (string, required)  — Description of why this checkpoint is blocked");
  lines.push("  created_at  (string, optional)  — ISO 8601 timestamp when the blocker was added");
  lines.push("  resolved    (boolean, optional) — Whether this blocker has been resolved (default: false)");
  lines.push("```");
  lines.push("");
  lines.push("## ID Naming Conventions");
  lines.push("");
  lines.push("| Prefix | Pattern | Example | Scope |");
  lines.push("|--------|---------|---------|-------|");
  lines.push("| CP | ^CP-\\d+$ | CP-01, CP-02 | Unique across all checkpoints |");
  lines.push("| AC | ^AC-\\d+-\\d+$ | AC-01-01, AC-02-03 | Unique across all checkpoints |");
  lines.push("| SC | ^SC-\\d+(-\\d+)?$ | SC-01, SC-01-01 | Unique across all checkpoints and ACs |");
  lines.push("");
  lines.push("## Validation Rules");
  lines.push("");
  lines.push("1. **Schema conformance** — All required fields, types, patterns, and enum values (via AJV)");
  lines.push("2. **ID uniqueness** — No duplicate CP, AC, or SC IDs");
  lines.push("3. **Dependency integrity** — All dependency references must point to existing checkpoints");
  lines.push("4. **Dependency ordering** — Dependencies must appear earlier in the array");
  lines.push("5. **No circular dependencies** — No cycles in the dependency graph");
  lines.push("6. **Min 1 AC per checkpoint** — Every checkpoint must have at least one acceptance criterion");
  lines.push("7. **Verification method required** — Every AC must have a concrete verification method");
  lines.push("");
  lines.push("## CLI Tools");
  lines.push("");
  lines.push("| Tool | Command | Purpose |");
  lines.push("|------|---------|---------|");
  lines.push("| Create | `bun run create -- <title> <desc> <overview> <path> [N]` | Scaffold a plan skeleton |");
  lines.push("| Render | `bun run read -- <plan.json>` | Display plan as Markdown |");
  lines.push("| Validate | `bun run validate -- <plan.json>` | Check schema + integrity |");
  lines.push("| Validate (strict) | `bun run validate -- --strict <plan.json>` | + semantic quality checks |");
  lines.push("| Understand | `bun run read -- --understand <plan.json>` | Analyze execution order, critical path, security, progress |");
  lines.push("| Update | `bun run update -- <plan.json> <cmd> [args]` | Modify plan in-place |");
  lines.push("| Diff | `bun run diff -- <a.json> <b.json>` | Compare two plan versions |");
  lines.push("| Schema | `bun run read -- --schema` | Display this schema reference |");
  lines.push("");
  return lines.join("\n");
}

function showReadHelp(): void {
  const help = `
Usage: bun scripts/read-plan.ts [options] [plan.json]

Render a plan JSON as human-readable Markdown, or analyze its structure.

Options:
  plan.json              Path to plan JSON file (default: plan.json)
  --summary <plan.json>  Show concise analysis (execution order, critical path, progress)
  --analyze <plan.json>  Same as --summary
  --understand <plan.json>  Analyze plan structure (execution order, critical path, security, progress)
  --json <plan.json>     Output analysis as structured JSON (for programmatic consumption)
  --schema               Display the plan protocol schema reference (field descriptions, relationships, constraints)
  --no-emoji             Use text labels instead of emoji icons
  --force                Render even if validation fails (for debugging malformed plans)
  --help, -h             Show this help message

Examples:
  bun scripts/read-plan.ts plan.json
  bun scripts/read-plan.ts --summary plan.json
  bun scripts/read-plan.ts --understand plan.json
  bun scripts/read-plan.ts --json plan.json > analysis.json
  bun scripts/read-plan.ts --schema
  bun scripts/read-plan.ts --force plan.json
`;
  console.log(help);
}

const scriptPath = process.argv[1] || "";
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    showReadHelp();
    process.exit(0);
  }
  if (args.includes("--schema")) {
    console.log(renderSchemaDocs());
    process.exit(0);
  }
  const summaryMode = args.includes("--summary") || args.includes("--analyze");
  const understandMode = args.includes("--understand");
  const jsonMode = args.includes("--json");
  const noEmoji = args.includes("--no-emoji");
  const force = args.includes("--force");
  let dataPath: string;
  if (summaryMode || understandMode || jsonMode) {
    const flag = summaryMode
      ? args.find(a => a === "--summary" || a === "--analyze")!
      : understandMode
        ? "--understand"
        : "--json";
    const flagIdx = args.indexOf(flag);
    if (flagIdx + 1 >= args.length || args[flagIdx + 1].startsWith("--")) {
      console.error(`Error: ${flag} requires a plan file path`);
      process.exit(1);
    }
    dataPath = resolve(args[flagIdx + 1]);
  } else {
    dataPath = resolve(args[0] || "plan.json");
  }
  let data: PlanData;
  try {
    data = JSON.parse(readFileSync(dataPath, "utf-8"));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Error reading "${dataPath}": ${msg}`);
    process.exit(1);
  }

  const errors = validatePlan(data);
  if (errors.length > 0) {
    if (force) {
      console.error("Warning: plan validation failed — rendering with --force:");
      for (const err of errors) {
        console.error(`  ${err.path}: ${err.msg}`);
      }
    } else {
      console.error("Plan validation failed — cannot render. Use --force to render anyway:");
      for (const err of errors) {
        console.error(`  ${err.path}: ${err.msg}`);
      }
      process.exit(1);
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify(analyzePlan(data.plan), null, 2));
  } else if (summaryMode || understandMode) {
    console.log(renderAnalysis(data.plan, noEmoji));
  } else {
    console.log(renderPlan(data.plan, noEmoji));
  }
}

