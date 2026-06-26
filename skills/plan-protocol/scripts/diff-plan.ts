import { readFileSync } from "fs";
import { resolve } from "path";
import { validatePlan } from "./validate-plan.ts";
import type { Plan, PlanData } from "./types.ts";

function showHelp(): void {
  const help = `
Usage: bun scripts/diff-plan.ts [options] <plan-a.json> <plan-b.json>

Compare two plan versions and show what changed.

Options:
  --summary     Show concise summary only (added/removed/modified counts + progress)
  --help, -h    Show this help message

Output shows:
  - Added checkpoints (present in B but not A)
  - Removed checkpoints (present in A but not B)
  - Modified checkpoints (title, description, dependencies, ACs, SCs, AC status)
  - Progress summary (overall AC pass rate change)
`;
  console.log(help);
}

export function diffPlans(planA: Plan, planB: Plan, summary = false): string {
  const lines: string[] = [];
  if (!summary) {
    lines.push(`# Plan Diff`);
    lines.push("");
    lines.push(`Comparing "${planA.title}" vs "${planB.title}"`);
    lines.push("");
  }

  const metaChanges: string[] = [];
  if (planA.title !== planB.title) metaChanges.push(`  - title: "${planA.title}" → "${planB.title}"`);
  if (planA.description !== planB.description) metaChanges.push(`  - description: "${planA.description}" → "${planB.description}"`);
  if (planA.overview !== planB.overview) metaChanges.push(`  - overview changed`);
  if (planA.version !== planB.version) metaChanges.push(`  - version: "${planA.version || "N/A"}" → "${planB.version || "N/A"}"`);
  if (planA.created_at !== planB.created_at) metaChanges.push(`  - created_at: "${planA.created_at || "N/A"}" → "${planB.created_at || "N/A"}"`);
  if (planA.updated_at !== planB.updated_at) metaChanges.push(`  - updated_at: "${planA.updated_at || "N/A"}" → "${planB.updated_at || "N/A"}"`);
  if (metaChanges.length > 0) {
    if (!summary) {
      lines.push("### Plan Metadata 🔄");
      for (const c of metaChanges) lines.push(c);
      lines.push("");
    }
  }

  const mapA = new Map(planA.checkpoints.map(c => [c.id, c]));
  const mapB = new Map(planB.checkpoints.map(c => [c.id, c]));

  const allIds = new Set([...mapA.keys(), ...mapB.keys()]);

  let added = 0, removed = 0, modified = 0;

  for (const id of [...allIds].sort()) {
    const cpA = mapA.get(id);
    const cpB = mapB.get(id);
    if (!cpA) {
      added++;
      if (!summary) {
        lines.push(`### [${id}] ➕ ADDED in B`);
        lines.push(`**Title:** ${cpB!.title}`);
        lines.push(`**Description:** ${cpB!.description}`);
        lines.push("");
      }
      continue;
    }
    if (!cpB) {
      removed++;
      if (!summary) {
        lines.push(`### [${id}] ➖ REMOVED in B`);
        lines.push(`**Title:** ${cpA.title}`);
        lines.push(`**Description:** ${cpA.description}`);
        lines.push("");
      }
      continue;
    }
    const changes: string[] = [];
    if (cpA.title !== cpB.title) changes.push(`  - title: "${cpA.title}" → "${cpB.title}"`);
    if (cpA.description !== cpB.description) changes.push(`  - description changed`);
    const depsChanged = JSON.stringify(cpA.dependencies) !== JSON.stringify(cpB.dependencies);
    if (depsChanged) changes.push(`  - dependencies: [${cpA.dependencies.join(", ")}] → [${cpB.dependencies.join(", ")}]`);

    const scMapA = new Map((cpA.security_concerns || []).map(s => [s.id, s]));
    const scMapB = new Map((cpB.security_concerns || []).map(s => [s.id, s]));
    const allScIds = new Set([...scMapA.keys(), ...scMapB.keys()]);
    for (const scId of allScIds) {
      const scA = scMapA.get(scId);
      const scB = scMapB.get(scId);
      if (!scA) { changes.push(`  - SC ${scId}: added`); continue; }
      if (!scB) { changes.push(`  - SC ${scId}: removed`); continue; }
      if (scA.description !== scB.description) changes.push(`  - SC ${scId}: description changed`);
      if (scA.severity !== scB.severity) changes.push(`  - SC ${scId}: severity "${scA.severity}" → "${scB.severity}"`);
      if (scA.mitigation !== scB.mitigation) changes.push(`  - SC ${scId}: mitigation changed`);
    }

    const acMapA = new Map(cpA.acceptance_criteria.map(a => [a.id, a]));
    const acMapB = new Map(cpB.acceptance_criteria.map(a => [a.id, a]));
    const allAcIds = new Set([...acMapA.keys(), ...acMapB.keys()]);
    for (const acId of allAcIds) {
      const acA = acMapA.get(acId);
      const acB = acMapB.get(acId);
      if (!acA) { changes.push(`  - AC ${acId}: added`); continue; }
      if (!acB) { changes.push(`  - AC ${acId}: removed`); continue; }
      if (acA.description !== acB.description) changes.push(`  - AC ${acId}: description changed`);
      if (acA.verification_method !== acB.verification_method) changes.push(`  - AC ${acId}: verification changed`);
      if (acA.status !== acB.status) changes.push(`  - AC ${acId}: status "${acA.status || "pending"}" → "${acB.status || "pending"}"`);

      const acScMapA = new Map((acA.security_concerns || []).map(s => [s.id, s]));
      const acScMapB = new Map((acB.security_concerns || []).map(s => [s.id, s]));
      const allAcScIds = new Set([...acScMapA.keys(), ...acScMapB.keys()]);
      for (const scId of allAcScIds) {
        const scA = acScMapA.get(scId);
        const scB = acScMapB.get(scId);
        if (!scA) { changes.push(`  - ${acId} SC ${scId}: added`); continue; }
        if (!scB) { changes.push(`  - ${acId} SC ${scId}: removed`); continue; }
        if (scA.description !== scB.description) changes.push(`  - ${acId} SC ${scId}: description changed`);
        if (scA.severity !== scB.severity) changes.push(`  - ${acId} SC ${scId}: severity "${scA.severity}" → "${scB.severity}"`);
        if (scA.mitigation !== scB.mitigation) changes.push(`  - ${acId} SC ${scId}: mitigation changed`);
      }
    }
    if (changes.length > 0) {
      modified++;
      if (!summary) {
        lines.push(`### [${id}] ${cpA.title} 🔄`);
        for (const c of changes) lines.push(c);
      }
    }
    if (!summary) lines.push("");
  }

  if (summary) {
    lines.push(`**Checkpoints:** ${added} added, ${removed} removed, ${modified} modified`);
  }

  const totalA = planA.checkpoints.reduce((s, c) => s + c.acceptance_criteria.filter(a => a.status === "passed").length, 0);
  const totalACsA = planA.checkpoints.reduce((s, c) => s + c.acceptance_criteria.length, 0);
  const totalB = planB.checkpoints.reduce((s, c) => s + c.acceptance_criteria.filter(a => a.status === "passed").length, 0);
  const totalACsB = planB.checkpoints.reduce((s, c) => s + c.acceptance_criteria.length, 0);
  lines.push(`**Summary:** ${totalA}/${totalACsA} → ${totalB}/${totalACsB} ACs passed`);
  return lines.join("\n");
}

if (import.meta.main) {
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  showHelp();
  process.exit(0);
}

const summary = args.includes("--summary");
const nonFlagArgs = args.filter(a => !a.startsWith("--"));

if (nonFlagArgs.length < 2) {
  console.error("Error: requires two plan file paths. See --help for usage.");
  process.exit(1);
}

const pathA = resolve(nonFlagArgs[0]);
const pathB = resolve(nonFlagArgs[1]);

let dataA: PlanData;
let dataB: PlanData;
try {
  dataA = JSON.parse(readFileSync(pathA, "utf-8"));
  dataB = JSON.parse(readFileSync(pathB, "utf-8"));
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`Error reading plan files: ${msg}`);
  process.exit(1);
}

const errorsA = validatePlan(dataA);
const errorsB = validatePlan(dataB);
if (errorsA.length > 0 || errorsB.length > 0) {
  console.error("One or both plans failed validation — cannot diff:");
  for (const err of [...errorsA, ...errorsB]) {
    console.error(`  ${err.path}: ${err.msg}`);
  }
  process.exit(1);
}

console.log(diffPlans(dataA.plan, dataB.plan, summary));
}
