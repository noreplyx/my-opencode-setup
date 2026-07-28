import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { validatePlan } from "./validate-plan.ts";
import type { Blocker, Checkpoint, Plan, PlanData } from "./types.ts";

function showHelp(): void {
  const help = `
Usage: bun scripts/update-plan.ts [--dry-run] [--strict] <plan.json> <command> [args...]

Commands:
  add-cp <title> [description] [--after CP-ID] [--ac "desc::verify"]... [--no-sc] [--tags "t1,t2"] [--effort XS|S|M|L|XL]
    Add a new checkpoint after the given CP-ID (or at end if omitted).
    Dependencies default to the previous checkpoint.
    --ac can be specified multiple times; format: "description::verification_method"
    or just "description" (uses default verification method).

  remove-cp <CP-ID>
    Remove a checkpoint and all its ACs/SCs. Fails if other checkpoints depend on it.

  reorder <CP-ID> <new-index>
    Move a checkpoint to a new position (0-based). Updates dependencies.

  set-status <CP-ID> <AC-ID> <status>
    Set an acceptance criterion status: pending|passed|failed|blocked|skipped

  add-ac <CP-ID> <description> [--verify "method"]
    Add a new acceptance criterion to a checkpoint.

  remove-ac <CP-ID> <AC-ID>
    Remove an acceptance criterion from a checkpoint.

  add-sc <CP-ID> <description> <severity> <mitigation>
    Add a checkpoint-level security concern.

  add-sc <CP-ID> <AC-ID> <description> <severity> <mitigation>
    Add an AC-level security concern.

  remove-sc <CP-ID> <SC-ID>
    Remove a checkpoint-level security concern.

  remove-sc <CP-ID> <AC-ID> <SC-ID>
    Remove an AC-level security concern.

  add-blocker <CP-ID> <reason>
    Add a blocker to a checkpoint.

  remove-blocker <CP-ID> <index>
    Remove a blocker by index (0-based).

  resolve-blocker <CP-ID> <index>
    Mark a blocker as resolved (without removing it).

  add-tags <CP-ID> <tag1,tag2,...>
    Add tags to a checkpoint.

  remove-tags <CP-ID> <tag1,tag2,...>
    Remove specific tags from a checkpoint.

  set-effort <CP-ID> <XS|S|M|L|XL>
    Set the effort estimate for a checkpoint.

  set-title <new-title>
    Update the plan title.

  set-description <new-description>
    Update the plan description.

  set-overview <new-overview>
    Update the plan overview.

Options:
  --dry-run  Preview changes without writing to the file
  --strict   Enable strict semantic validation (placeholder/subjective language checks)
  --help, -h  Show this help message
`;
  console.log(help);
}

if (import.meta.main) {
let strictMode = false;
let dryRun = false;
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h") || args.length < 2) {
  showHelp();
  process.exit(0);
}

strictMode = args.includes("--strict");
dryRun = args.includes("--dry-run");
const knownFlags = new Set(["--strict", "--dry-run", "--help", "-h"]);
const nonFlagArgs = args.filter(a => !knownFlags.has(a));

const planPath = resolve(nonFlagArgs[0]);
const command = nonFlagArgs[1];
const commandArgs = nonFlagArgs.slice(2);

let data: PlanData;
try {
  data = JSON.parse(readFileSync(planPath, "utf-8"));
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`Error reading "${planPath}": ${msg}`);
  process.exit(1);
}

const plan = data.plan;

function bumpVersion(plan: Plan): void {
  const current = plan.version || "0.0.0";
  const parts = current.split(".").map(Number);
  if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    parts[2] += 1;
    plan.version = parts.join(".");
  } else {
    plan.version = "1.0.0";
  }
  plan.updated_at = new Date().toISOString();
}

function save(): void {
  bumpVersion(plan);
  const errors = validatePlan(data, strictMode);
  if (errors.length > 0) {
    console.error("Warning: resulting plan failed validation:");
    for (const err of errors) {
      console.error(`  ${err.path}: ${err.msg}`);
    }
  }
  if (dryRun) {
    console.log(`[DRY RUN] Would write to ${planPath}:`);
    console.log(JSON.stringify(data, null, 2));
  } else {
    writeFileSync(planPath, JSON.stringify(data, null, 2), "utf-8");
    console.log(`Updated ${planPath}`);
  }
}

switch (command) {
  case "add-cp": {
    const title = commandArgs[0];
    if (!title) { console.error("Error: add-cp requires a title"); process.exit(1); }
    const knownCpFlags = new Set(["--ac", "--after", "--no-sc", "--tags", "--effort"]);
    const nonFlagArgs = commandArgs.slice(1).filter(a => !knownCpFlags.has(a));
    const description = nonFlagArgs[0] || `Implement and verify "${title}"`;
    const afterIdx = commandArgs.indexOf("--after");
    const noSc = commandArgs.includes("--no-sc");
    const tagsIdx = commandArgs.indexOf("--tags");
    const effortIdx = commandArgs.indexOf("--effort");
    const tags = tagsIdx !== -1 && tagsIdx + 1 < commandArgs.length
      ? commandArgs[tagsIdx + 1].split(",").map(t => t.trim()).filter(Boolean)
      : undefined;
    const effort = effortIdx !== -1 && effortIdx + 1 < commandArgs.length
      ? commandArgs[effortIdx + 1].toLowerCase()
      : undefined;
    if (effort && !["xs", "s", "m", "l", "xl"].includes(effort)) {
      console.error(`Error: invalid effort value "${effort}". Must be one of: xs, s, m, l, xl`);
      process.exit(1);
    }
    const acFlags: { desc: string; verify: string }[] = [];
    for (let i = 0; i < commandArgs.length; i++) {
      if (commandArgs[i] === "--ac" && i + 1 < commandArgs.length) {
        const parts = commandArgs[i + 1].split("::");
        acFlags.push({ desc: parts[0], verify: parts[1] || `Run tests for ${title.toLowerCase().replace(/\s+/g, "-")}; assert expected behavior` });
      }
    }
    let insertIndex = plan.checkpoints.length;
    let prevId: string | null = null;
    if (afterIdx !== -1 && afterIdx + 1 < commandArgs.length) {
      const afterId = commandArgs[afterIdx + 1];
      const found = plan.checkpoints.findIndex(c => c.id === afterId);
      if (found === -1) { console.error(`Error: checkpoint "${afterId}" not found`); process.exit(1); }
      insertIndex = found + 1;
      prevId = afterId;
    } else if (plan.checkpoints.length > 0) {
      prevId = plan.checkpoints[plan.checkpoints.length - 1].id;
    }
    const maxNum = plan.checkpoints.reduce((max, cp) => {
      const match = cp.id.match(/^CP-(\d+)$/);
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, 0);
    const num = String(maxNum + 1).padStart(2, "0");
    const titleLower = title.toLowerCase().replace(/\s+/g, "-");
    const acceptance_criteria = acFlags.length > 0
      ? acFlags.map((ac, i) => ({
          id: `AC-${num}-${String(i + 1).padStart(2, "0")}`,
          description: ac.desc,
          verification_method: ac.verify,
          status: "pending" as const
        }))
      : [
          {
            id: `AC-${num}-01`,
            description: `${title} core functionality works correctly with valid inputs`,
            verification_method: `Run unit tests for ${titleLower}; assert all pass with expected outputs`,
            status: "pending" as const
          },
          {
            id: `AC-${num}-02`,
            description: `${title} returns appropriate error responses for invalid inputs`,
            verification_method: `Run integration tests for ${titleLower} with invalid inputs; assert 4xx/5xx responses`,
            status: "pending" as const
          }
        ];
    const newCp: Checkpoint = {
      id: `CP-${num}`,
      title,
      description,
      dependencies: prevId ? [prevId] : [],
      acceptance_criteria,
    };
    if (!noSc) {
      newCp.security_concerns = [
        {
          id: `SC-${num}`,
          description: `${title} may expose sensitive data or allow unauthorized access if access controls are missing`,
          severity: "medium",
          mitigation: `Add input validation, authentication checks, and data sanitization to ${titleLower}`
        }
      ];
    }
    if (tags && tags.length > 0) newCp.tags = tags;
    if (effort) newCp.effort = effort as "xs" | "s" | "m" | "l" | "xl";
    plan.checkpoints.splice(insertIndex, 0, newCp);
    save();
    break;
  }

  case "remove-cp": {
    const cpId = commandArgs[0];
    if (!cpId) { console.error("Error: remove-cp requires a CP-ID"); process.exit(1); }
    const idx = plan.checkpoints.findIndex(c => c.id === cpId);
    if (idx === -1) { console.error(`Error: checkpoint "${cpId}" not found`); process.exit(1); }
    const dependents = plan.checkpoints.filter(c => c.dependencies.includes(cpId));
    if (dependents.length > 0) {
      console.error(`Error: cannot remove "${cpId}" — depends on by: ${dependents.map(c => c.id).join(", ")}`);
      process.exit(1);
    }
    plan.checkpoints.splice(idx, 1);
    save();
    break;
  }

  case "reorder": {
    const cpId = commandArgs[0];
    const newIndex = parseInt(commandArgs[1], 10);
    if (!cpId || isNaN(newIndex)) { console.error("Error: reorder requires CP-ID and new-index"); process.exit(1); }
    const currentIdx = plan.checkpoints.findIndex(c => c.id === cpId);
    if (currentIdx === -1) { console.error(`Error: checkpoint "${cpId}" not found`); process.exit(1); }
    if (newIndex < 0 || newIndex >= plan.checkpoints.length) {
      console.error(`Error: new-index must be between 0 and ${plan.checkpoints.length - 1}`);
      process.exit(1);
    }
    const [cp] = plan.checkpoints.splice(currentIdx, 1);
    plan.checkpoints.splice(newIndex, 0, cp);
    const orderIndex = new Map(plan.checkpoints.map((c, i) => [c.id, i]));
    const violations: string[] = [];
    for (const c of plan.checkpoints) {
      for (const dep of c.dependencies) {
        const depIdx = orderIndex.get(dep);
        const cpIdx = orderIndex.get(c.id);
        if (depIdx !== undefined && cpIdx !== undefined && depIdx >= cpIdx) {
          violations.push(`  ${c.id} depends on ${dep}, but ${c.id} is at index ${cpIdx} and ${dep} is at index ${depIdx}`);
        }
      }
    }
    if (violations.length > 0) {
      console.error("Error: reorder would break dependency ordering (dependencies must appear before their dependents):");
      for (const v of violations) console.error(v);
      process.exit(1);
    }
    save();
    break;
  }

  case "set-status": {
    const cpId = commandArgs[0];
    const acId = commandArgs[1];
    const status = commandArgs[2];
    if (!cpId || !acId || !status) { console.error("Error: set-status requires CP-ID, AC-ID, and status"); process.exit(1); }
    if (!["pending", "passed", "failed", "blocked", "skipped"].includes(status)) {
      console.error("Error: status must be one of: pending, passed, failed, blocked, skipped");
      process.exit(1);
    }
    const cp = plan.checkpoints.find(c => c.id === cpId);
    if (!cp) { console.error(`Error: checkpoint "${cpId}" not found`); process.exit(1); }
    const ac = cp.acceptance_criteria.find(a => a.id === acId);
    if (!ac) { console.error(`Error: acceptance criterion "${acId}" not found in "${cpId}"`); process.exit(1); }
    ac.status = status as "pending" | "passed" | "failed" | "blocked" | "skipped";
    save();
    break;
  }

  case "add-blocker": {
    const cpId = commandArgs[0];
    const reason = commandArgs.slice(1).join(" ");
    if (!cpId || !reason) { console.error("Error: add-blocker requires CP-ID and reason"); process.exit(1); }
    const cp = plan.checkpoints.find(c => c.id === cpId);
    if (!cp) { console.error(`Error: checkpoint "${cpId}" not found`); process.exit(1); }
    if (!cp.blockers) cp.blockers = [];
    const blocker: Blocker = { reason, created_at: new Date().toISOString(), resolved: false };
    cp.blockers.push(blocker);
    save();
    break;
  }

  case "remove-blocker": {
    const cpId = commandArgs[0];
    const index = parseInt(commandArgs[1], 10);
    if (!cpId || isNaN(index)) { console.error("Error: remove-blocker requires CP-ID and index"); process.exit(1); }
    const cp = plan.checkpoints.find(c => c.id === cpId);
    if (!cp) { console.error(`Error: checkpoint "${cpId}" not found`); process.exit(1); }
    if (!cp.blockers || index < 0 || index >= cp.blockers.length) {
      console.error(`Error: blocker index ${index} out of range (0-${(cp.blockers || []).length - 1})`);
      process.exit(1);
    }
    cp.blockers.splice(index, 1);
    if (cp.blockers.length === 0) delete cp.blockers;
    save();
    break;
  }

  case "add-ac": {
    const cpId = commandArgs[0];
    const desc = commandArgs.slice(1).filter(a => a !== "--verify")[0];
    const verifyIdx = commandArgs.indexOf("--verify");
    const verify = verifyIdx !== -1 && verifyIdx + 1 < commandArgs.length ? commandArgs[verifyIdx + 1] : `Run tests; assert expected behavior`;
    if (!cpId || !desc) { console.error("Error: add-ac requires CP-ID and description"); process.exit(1); }
    const cp = plan.checkpoints.find(c => c.id === cpId);
    if (!cp) { console.error(`Error: checkpoint "${cpId}" not found`); process.exit(1); }
    const maxAcNum = cp.acceptance_criteria.reduce((max, ac) => {
      const match = ac.id.match(/^AC-\d+-(\d+)$/);
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, 0);
    const cpNum = cp.id.match(/^CP-(\d+)$/)?.[1] || "00";
    const acNum = String(maxAcNum + 1).padStart(2, "0");
    cp.acceptance_criteria.push({
      id: `AC-${cpNum}-${acNum}`,
      description: desc,
      verification_method: verify,
      status: "pending"
    });
    save();
    break;
  }

  case "remove-ac": {
    const cpId = commandArgs[0];
    const acId = commandArgs[1];
    if (!cpId || !acId) { console.error("Error: remove-ac requires CP-ID and AC-ID"); process.exit(1); }
    const cp = plan.checkpoints.find(c => c.id === cpId);
    if (!cp) { console.error(`Error: checkpoint "${cpId}" not found`); process.exit(1); }
    const acIdx = cp.acceptance_criteria.findIndex(a => a.id === acId);
    if (acIdx === -1) { console.error(`Error: AC "${acId}" not found in "${cpId}"`); process.exit(1); }
    cp.acceptance_criteria.splice(acIdx, 1);
    save();
    break;
  }

  case "add-sc": {
    const cpId = commandArgs[0];
    const cp = plan.checkpoints.find(c => c.id === cpId);
    if (!cp) { console.error(`Error: checkpoint "${cpId}" not found`); process.exit(1); }
    // Check if targeting an AC: 4th arg exists and matches AC pattern
    const potentialAcId = commandArgs[1];
    const isAcSc = potentialAcId && /^AC-\d+-\d+$/.test(potentialAcId) && cp.acceptance_criteria.some(a => a.id === potentialAcId);
    if (isAcSc) {
      const acId = potentialAcId;
      const description = commandArgs[2];
      const severity = commandArgs[3];
      const mitigation = commandArgs.slice(4).join(" ");
      if (!description || !severity || !mitigation) { console.error("Error: add-sc for AC requires CP-ID, AC-ID, description, severity, and mitigation"); process.exit(1); }
      if (!["critical", "high", "medium", "low"].includes(severity)) { console.error("Error: severity must be critical, high, medium, or low"); process.exit(1); }
      const ac = cp.acceptance_criteria.find(a => a.id === acId)!;
      if (!ac.security_concerns) ac.security_concerns = [];
      const maxScNum = [...(cp.security_concerns || []), ...cp.acceptance_criteria.flatMap(a => a.security_concerns || [])].reduce((max, sc) => {
        const match = sc.id.match(/^SC-(\d+)(?:-\d+)?$/);
        return match ? Math.max(max, parseInt(match[1], 10)) : max;
      }, 0);
      const scNum = String(maxScNum + 1).padStart(2, "0");
      ac.security_concerns.push({
        id: `SC-${scNum}`,
        description,
        severity: severity as "critical" | "high" | "medium" | "low",
        mitigation
      });
    } else {
      const description = commandArgs[1];
      const severity = commandArgs[2];
      const mitigation = commandArgs.slice(3).join(" ");
      if (!description || !severity || !mitigation) { console.error("Error: add-sc requires CP-ID, description, severity, and mitigation"); process.exit(1); }
      if (!["critical", "high", "medium", "low"].includes(severity)) { console.error("Error: severity must be critical, high, medium, or low"); process.exit(1); }
      if (!cp.security_concerns) cp.security_concerns = [];
      const maxScNum = [...(cp.security_concerns || []), ...cp.acceptance_criteria.flatMap(a => a.security_concerns || [])].reduce((max, sc) => {
        const match = sc.id.match(/^SC-(\d+)(?:-\d+)?$/);
        return match ? Math.max(max, parseInt(match[1], 10)) : max;
      }, 0);
      const scNum = String(maxScNum + 1).padStart(2, "0");
      cp.security_concerns.push({
        id: `SC-${scNum}`,
        description,
        severity: severity as "critical" | "high" | "medium" | "low",
        mitigation
      });
    }
    save();
    break;
  }

  case "remove-sc": {
    const cpId = commandArgs[0];
    const cp = plan.checkpoints.find(c => c.id === cpId);
    if (!cp) { console.error(`Error: checkpoint "${cpId}" not found`); process.exit(1); }
    // Check if targeting an AC-level SC: 2nd arg matches AC pattern
    const potentialAcId = commandArgs[1];
    const isAcSc = potentialAcId && /^AC-\d+-\d+$/.test(potentialAcId) && cp.acceptance_criteria.some(a => a.id === potentialAcId);
    if (isAcSc) {
      const acId = potentialAcId;
      const scId = commandArgs[2];
      if (!scId) { console.error("Error: remove-sc for AC requires CP-ID, AC-ID, and SC-ID"); process.exit(1); }
      const ac = cp.acceptance_criteria.find(a => a.id === acId);
      if (!ac) { console.error(`Error: AC "${acId}" not found in "${cpId}"`); process.exit(1); }
      if (!ac.security_concerns) { console.error(`Error: no security concerns on AC "${acId}"`); process.exit(1); }
      const scIdx = ac.security_concerns.findIndex(s => s.id === scId);
      if (scIdx === -1) { console.error(`Error: SC "${scId}" not found on AC "${acId}"`); process.exit(1); }
      ac.security_concerns.splice(scIdx, 1);
      if (ac.security_concerns.length === 0) delete ac.security_concerns;
    } else {
      const scId = commandArgs[1];
      if (!scId) { console.error("Error: remove-sc requires CP-ID and SC-ID"); process.exit(1); }
      if (!cp.security_concerns) { console.error(`Error: no security concerns on checkpoint "${cpId}"`); process.exit(1); }
      const scIdx = cp.security_concerns.findIndex(s => s.id === scId);
      if (scIdx === -1) { console.error(`Error: SC "${scId}" not found on "${cpId}"`); process.exit(1); }
      cp.security_concerns.splice(scIdx, 1);
      if (cp.security_concerns.length === 0) delete cp.security_concerns;
    }
    save();
    break;
  }

  case "resolve-blocker": {
    const cpId = commandArgs[0];
    const index = parseInt(commandArgs[1], 10);
    if (!cpId || isNaN(index)) { console.error("Error: resolve-blocker requires CP-ID and index"); process.exit(1); }
    const cp = plan.checkpoints.find(c => c.id === cpId);
    if (!cp) { console.error(`Error: checkpoint "${cpId}" not found`); process.exit(1); }
    if (!cp.blockers || index < 0 || index >= cp.blockers.length) {
      console.error(`Error: blocker index ${index} out of range (0-${(cp.blockers || []).length - 1})`);
      process.exit(1);
    }
    cp.blockers[index].resolved = true;
    save();
    break;
  }

  case "add-tags": {
    const cpId = commandArgs[0];
    const tagsToAdd = commandArgs.slice(1).join(",").split(",").map(t => t.trim()).filter(Boolean);
    if (!cpId || tagsToAdd.length === 0) { console.error("Error: add-tags requires CP-ID and tags"); process.exit(1); }
    const cp = plan.checkpoints.find(c => c.id === cpId);
    if (!cp) { console.error(`Error: checkpoint "${cpId}" not found`); process.exit(1); }
    if (!cp.tags) cp.tags = [];
    for (const tag of tagsToAdd) {
      if (!cp.tags.includes(tag)) cp.tags.push(tag);
    }
    save();
    break;
  }

  case "remove-tags": {
    const cpId = commandArgs[0];
    const tagsToRemove = commandArgs.slice(1).join(",").split(",").map(t => t.trim()).filter(Boolean);
    if (!cpId || tagsToRemove.length === 0) { console.error("Error: remove-tags requires CP-ID and tags"); process.exit(1); }
    const cp = plan.checkpoints.find(c => c.id === cpId);
    if (!cp) { console.error(`Error: checkpoint "${cpId}" not found`); process.exit(1); }
    if (!cp.tags) { console.error(`Error: checkpoint "${cpId}" has no tags`); process.exit(1); }
    cp.tags = cp.tags.filter(t => !tagsToRemove.includes(t));
    if (cp.tags.length === 0) delete cp.tags;
    save();
    break;
  }

  case "set-effort": {
    const cpId = commandArgs[0];
    const effort = commandArgs[1]?.toLowerCase();
    if (!cpId || !effort) { console.error("Error: set-effort requires CP-ID and effort value"); process.exit(1); }
    if (!["xs", "s", "m", "l", "xl"].includes(effort)) {
      console.error(`Error: effort must be one of: xs, s, m, l, xl`);
      process.exit(1);
    }
    const cp = plan.checkpoints.find(c => c.id === cpId);
    if (!cp) { console.error(`Error: checkpoint "${cpId}" not found`); process.exit(1); }
    cp.effort = effort as "xs" | "s" | "m" | "l" | "xl";
    save();
    break;
  }

  case "set-title": {
    plan.title = commandArgs.join(" ");
    save();
    break;
  }

  case "set-description": {
    plan.description = commandArgs.join(" ");
    save();
    break;
  }

  case "set-overview": {
    plan.overview = commandArgs.join(" ");
    save();
    break;
  }

  default:
    console.error(`Unknown command: "${command}". See --help for usage.`);
    process.exit(1);
}
}
