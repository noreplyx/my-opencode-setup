import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";

function showHelp(): void {
  const help = `
Usage: bun scripts/init-plan.ts [options]

Initialize a plan workspace with a plans/ directory and optional .planrc config.

Options:
  --dir <path>           Target directory (default: current directory)
  --author <name>        Default author name for .planrc
  --tags <tag1,tag2>     Default tags for .planrc
  --strict               Enable strict mode by default in .planrc
  --help, -h             Show this help message
`;
  console.log(help);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    showHelp();
    process.exit(0);
  }

  const dirIdx = args.indexOf("--dir");
  const targetDir = dirIdx !== -1 && dirIdx + 1 < args.length
    ? resolve(args[dirIdx + 1])
    : resolve(".");

  const authorIdx = args.indexOf("--author");
  const author = authorIdx !== -1 && authorIdx + 1 < args.length ? args[authorIdx + 1] : undefined;

  const tagsIdx = args.indexOf("--tags");
  const tags = tagsIdx !== -1 && tagsIdx + 1 < args.length
    ? args[tagsIdx + 1].split(",").map(t => t.trim()).filter(Boolean)
    : undefined;

  const strictMode = args.includes("--strict");

  const plansDir = resolve(targetDir, "plans");
  if (!existsSync(plansDir)) {
    mkdirSync(plansDir, { recursive: true });
    console.log(`Created plans/ directory at ${plansDir}`);
  } else {
    console.log(`plans/ directory already exists at ${plansDir}`);
  }

  const planrcPath = resolve(targetDir, ".planrc");
  if (!existsSync(planrcPath)) {
    const planrc: Record<string, unknown> = {};
    if (author) planrc.default_author = author;
    if (tags) planrc.default_tags = tags;
    if (strictMode) planrc.strict_mode = true;
    if (Object.keys(planrc).length > 0) {
      writeFileSync(planrcPath, JSON.stringify(planrc, null, 2) + "\n", "utf-8");
      console.log(`Created .planrc at ${planrcPath}`);
    } else {
      console.log("No configuration provided; skipping .planrc creation.");
    }
  } else {
    console.log(`.planrc already exists at ${planrcPath}`);
  }
}
