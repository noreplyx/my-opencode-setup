import { unlinkSync, existsSync, readFileSync, readdirSync, statSync } from "fs";
import { resolve } from "path";
import { createInterface } from "readline";
import type { PlanData } from "./types.ts";

function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(prompt, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes");
    });
  });
}

function showHelp(): void {
  const help = `
Usage: bun scripts/delete-plan.ts [options] <plan.json>

Delete a plan JSON file from disk.

Options:
  <plan.json>          Path to the plan file to delete
  --list [dir]         List plan files in the given directory (default: plans/) before deleting
  --yes, -y            Skip confirmation prompt
  --help, -h           Show this help message

Examples:
  bun scripts/delete-plan.ts plan.json
  bun scripts/delete-plan.ts plans/2026-07-28-add-auth.json
  bun scripts/delete-plan.ts --list plans/
  bun scripts/delete-plan.ts --list plans/ plan.json
  bun scripts/delete-plan.ts -y plan.json
`;
  console.log(help);
}

if (import.meta.main) {
  (async () => {
    const args = process.argv.slice(2);

    if (args.includes("--help") || args.includes("-h")) {
      showHelp();
      process.exit(0);
    }

    const yes = args.includes("--yes") || args.includes("-y");
    const listMode = args.includes("--list");
    const nonFlagArgs = args.filter(a => !a.startsWith("--") && a !== "-y");

    let listDir = "plans";
    if (listMode) {
      const listIdx = args.indexOf("--list");
      listDir = listIdx + 1 < args.length && !args[listIdx + 1].startsWith("--") && args[listIdx + 1] !== "-y"
        ? args[listIdx + 1]
        : "plans";
      if (!existsSync(listDir)) {
        console.log(`No plans directory found at "${listDir}".`);
        if (nonFlagArgs.length === 0) process.exit(0);
      } else {
        const files = readdirSync(listDir).filter(f => f.endsWith(".json")).sort();
        if (files.length === 0) {
          console.log(`No plan files found in "${listDir}".`);
        } else {
          console.log(`Plan files in "${listDir}/":\n`);
          for (const file of files) {
            try {
              const data: PlanData = JSON.parse(readFileSync(resolve(listDir, file), "utf-8"));
              const p = data.plan;
              const totalACs = p.checkpoints.reduce((s, c) => s + c.acceptance_criteria.length, 0);
              const passedACs = p.checkpoints.reduce((s, c) => s + c.acceptance_criteria.filter(a => a.status === "passed").length, 0);
              console.log(`  ${file}`);
              console.log(`    Title: ${p.title}`);
              console.log(`    Description: ${p.description}`);
              console.log(`    Checkpoints: ${p.checkpoints.length} | ACs: ${passedACs}/${totalACs} passed`);
              console.log(`    Version: ${p.version || "N/A"} | Updated: ${p.updated_at || "N/A"}`);
              console.log();
            } catch {
              console.log(`  ${file}  (unreadable or invalid JSON)`);
              console.log();
            }
          }
        }
      }
    }

    if (listMode && (nonFlagArgs.length === 0 || (nonFlagArgs.length === 1 && nonFlagArgs[0] === listDir))) {
      process.exit(0);
    }

    const planPath = nonFlagArgs[nonFlagArgs.length - 1];
    if (!planPath) {
      console.error("Error: no plan file specified. See --help for usage.");
      process.exit(1);
    }

    const resolvedPath = resolve(planPath);

    if (!existsSync(resolvedPath)) {
      console.error(`Error: plan file not found: "${resolvedPath}"`);
      process.exit(1);
    }

    if (statSync(resolvedPath).isDirectory()) {
      console.error(`Error: "${resolvedPath}" is a directory, not a plan file`);
      process.exit(1);
    }

    let planInfo = "";
    try {
      const data: PlanData = JSON.parse(readFileSync(resolvedPath, "utf-8"));
      planInfo = `"${data.plan.title}" (${data.plan.checkpoints.length} checkpoints)`;
    } catch {
      planInfo = "(unreadable or invalid JSON)";
    }

    if (!yes) {
      console.log(`About to delete: ${resolvedPath}`);
      console.log(`  Plan: ${planInfo}`);
      const ok = await confirm("Are you sure? (y/N): ");
      if (!ok) {
        console.log("Deletion cancelled.");
        process.exit(0);
      }
    }

    unlinkSync(resolvedPath);
    console.log(`Deleted: ${resolvedPath}`);
  })();
}
