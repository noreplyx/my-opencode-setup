import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { validatePlan } from "./validate-plan.ts";
import type { Plan, PlanData } from "./types.ts";

function showHelp(): void {
  const help = `
Usage: bun scripts/merge-plan.ts [--dry-run] [--strict] --base <base.json> --source <source.json> --output <merged.json>

Merge changes from a source plan into a base plan.

Rules:
  - New checkpoints in source are appended to base
  - Modified checkpoints in source overwrite base (matched by CP ID)
  - AC status changes from source are preserved
  - Checkpoints only in base are kept unchanged

Options:
  --base <base.json>      Base plan file (receives changes)
  --source <source.json>  Source plan file (provides changes)
  --output <merged.json>  Output file for merged result
  --dry-run               Preview merge result without writing
  --strict                Enable strict validation
  --help, -h              Show this help message
`;
  console.log(help);
}

export function mergePlans(base: Plan, source: Plan): Plan {
  const merged: Plan = {
    title: source.title || base.title,
    description: source.description || base.description,
    overview: source.overview || base.overview,
    version: base.version,
    created_at: base.created_at,
    updated_at: new Date().toISOString(),
    checkpoints: [...base.checkpoints],
  };

  const baseMap = new Map(base.checkpoints.map(c => [c.id, c]));
  const sourceMap = new Map(source.checkpoints.map(c => [c.id, c]));

  for (const [id, sourceCp] of sourceMap) {
    if (baseMap.has(id)) {
      const idx = merged.checkpoints.findIndex(c => c.id === id);
      merged.checkpoints[idx] = sourceCp;
    } else {
      merged.checkpoints.push(sourceCp);
    }
  }

  return merged;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    showHelp();
    process.exit(0);
  }

  const dryRun = args.includes("--dry-run");
  const strict = args.includes("--strict");
  const baseIdx = args.indexOf("--base");
  const sourceIdx = args.indexOf("--source");
  const outputIdx = args.indexOf("--output");

  if (baseIdx === -1 || sourceIdx === -1 || outputIdx === -1) {
    console.error("Error: --base, --source, and --output are required. See --help for usage.");
    process.exit(1);
  }

  const basePath = resolve(args[baseIdx + 1]);
  const sourcePath = resolve(args[sourceIdx + 1]);
  const outputPath = resolve(args[outputIdx + 1]);

  let baseData: PlanData;
  let sourceData: PlanData;
  try {
    baseData = JSON.parse(readFileSync(basePath, "utf-8"));
    sourceData = JSON.parse(readFileSync(sourcePath, "utf-8"));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Error reading plan files: ${msg}`);
    process.exit(1);
  }

  const baseErrors = validatePlan(baseData);
  const sourceErrors = validatePlan(sourceData);
  if (baseErrors.length > 0 || sourceErrors.length > 0) {
    console.error("One or both plans failed validation — cannot merge:");
    for (const err of [...baseErrors, ...sourceErrors]) {
      console.error(`  ${err.path}: ${err.msg}`);
    }
    process.exit(1);
  }

  const merged = mergePlans(baseData.plan, sourceData.plan);
  const mergedData: PlanData = { plan: merged };

  const mergedErrors = validatePlan(mergedData, strict);
  if (mergedErrors.length > 0) {
    console.error("Warning: merged plan failed validation:");
    for (const err of mergedErrors) {
      console.error(`  ${err.path}: ${err.msg}`);
    }
  }

  if (dryRun) {
    console.log(`[DRY RUN] Would write to ${outputPath}:`);
    console.log(JSON.stringify(mergedData, null, 2));
  } else {
    writeFileSync(outputPath, JSON.stringify(mergedData, null, 2), "utf-8");
    console.log(`Merged plan written to ${outputPath}`);
  }
}
