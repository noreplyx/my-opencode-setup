import { writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { validatePlan } from "./validate-plan.ts";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function showHelp(): void {
  const help = `
Usage: bun scripts/create-plan.ts [options] <title> <description> <overview> [output-path] [checkpoints...]

Create a plan JSON scaffold.

Options:
  <title>             Plan title (required)
  <description>       One-sentence summary (required)
  <overview>          Detailed overview (required)
  [output-path]       Output file path (default: plan.json, or auto-generated with --name)
  [checkpoints...]    Descriptions for each checkpoint in order.
                      Special format: "Title::Description" for custom titles.
                      Use "~" to indicate no dependency on previous checkpoint (parallelizable).
  --name <name>       Auto-generate path as plans/{date}-{slug}.json (slugified from <name>).
                      Overrides [output-path] if both are provided.
  --ac "desc::verify"  Custom acceptance criteria for the last checkpoint (repeatable).
                       Format: "description::verification_method" or just "description".
                       If omitted, 2 default ACs are generated per checkpoint.
  --tags "tag1,tag2"   Comma-separated tags for all checkpoints (e.g., "frontend,api").
  --effort XS|S|M|L|XL Estimated effort size for all checkpoints.
  --no-sc              Omit default security concerns from all checkpoints.

  --help, -h          Show this help message

The script creates a linear dependency chain by default (each checkpoint depends on the previous).
Prefix a checkpoint description with "~" to make it independent (no dependency on the prior one).

Examples:
  bun scripts/create-plan.ts "My API" "Build an API" "Full plan" plan.json 5
  bun scripts/create-plan.ts "My API" "Build" "Plan" plan.json "Setup" "~Auth" "Core"
  bun scripts/create-plan.ts "My API" "Build" "Plan" plan.json "Login" --ac "Returns JWT::curl POST /login; assert 200 with token" --ac "Rejects bad password::curl POST /login with wrong password; assert 401"
  bun scripts/create-plan.ts "My API" "Build an API" "Full plan" --name "Add Auth"
`;
  console.log(help);
}

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  showHelp();
  process.exit(0);
}

const TITLES = [
  "Foundation / Setup",
  "Core Implementation",
  "Authentication & Authorization",
  "API Endpoints",
  "UI / Frontend",
  "Integration & Polish",
  "Testing & Validation",
  "Documentation & Deployment",
  "Security Hardening",
  "Performance Optimization",
  "Monitoring & Observability",
  "Release & Rollout",
];

const FALLBACK_AREAS = [
  "Infrastructure",
  "Business Logic",
  "Data Layer",
  "Configuration",
  "Pipeline",
  "Compliance",
];

const SEVERITIES = ["medium", "high", "critical", "medium", "low"];

interface CheckpointInput {
  title: string;
  description: string;
  dependsOnPrev: boolean;
  customACs?: { desc: string; verify: string }[];
  tags?: string[];
  effort?: "xs" | "s" | "m" | "l" | "xl";
}

function parseCheckpointArgs(arg: string): CheckpointInput {
  const dependsOnPrev = !arg.startsWith("~");
  const cleaned = arg.startsWith("~") ? arg.slice(1) : arg;
  const parts = cleaned.split("::");
  const title = parts[0] || "";
  const description = parts[1] || `Implement and verify ${title}`;
  return { title, description, dependsOnPrev };
}

let title: string;
let description: string;
let overview: string;
let outPath: string;
let checkpointInputs: string[];
let customACs: { desc: string; verify: string }[] = [];

// Extract --ac, --name, --tags, --effort, --no-sc flags before parsing other args
let nameFlag: string | undefined;
let noScFlag = false;
let effortFlag: "xs" | "s" | "m" | "l" | "xl" | undefined;
let tagsFlag: string[] = [];
const acFlags: { desc: string; verify: string }[] = [];
const filteredArgs: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--ac" && i + 1 < args.length) {
    const parts = args[i + 1].split("::");
    acFlags.push({ desc: parts[0], verify: parts[1] || `Run tests; assert expected behavior` });
    i++;
  } else if (args[i] === "--name" && i + 1 < args.length) {
    nameFlag = args[i + 1];
    i++;
  } else if (args[i] === "--tags" && i + 1 < args.length) {
    tagsFlag = args[i + 1].split(",").map(t => t.trim()).filter(Boolean);
    i++;
  } else if (args[i] === "--effort" && i + 1 < args.length) {
    const val = args[i + 1].toLowerCase();
    if (["xs", "s", "m", "l", "xl"].includes(val)) {
      effortFlag = val as "xs" | "s" | "m" | "l" | "xl";
    } else {
      console.error(`Error: invalid effort value "${val}". Must be one of: xs, s, m, l, xl`);
      process.exit(1);
    }
    i++;
  } else if (args[i] === "--no-sc") {
    noScFlag = true;
  } else {
    filteredArgs.push(args[i]);
  }
}

if (filteredArgs.length >= 4 && !isNaN(Number(filteredArgs[3]))) {
  title = filteredArgs[0];
  description = filteredArgs[1];
  overview = filteredArgs[2];
  outPath = "plan.json";
  const count = parseInt(filteredArgs[3], 10);
  checkpointInputs = [];
  for (let i = 0; i < count; i++) {
    if (filteredArgs.length > 4 + i) {
      checkpointInputs.push(filteredArgs[4 + i]);
    }
  }
  if (checkpointInputs.length === 0) {
    checkpointInputs = new Array(count).fill("");
  }
} else if (filteredArgs.length >= 4) {
  title = filteredArgs[0];
  description = filteredArgs[1];
  overview = filteredArgs[2];
  outPath = filteredArgs[3];
  checkpointInputs = filteredArgs.slice(4);
} else if (filteredArgs.length >= 3 && nameFlag) {
  title = filteredArgs[0];
  description = filteredArgs[1];
  overview = filteredArgs[2];
  const date = new Date().toISOString().slice(0, 10);
  const slug = slugify(nameFlag);
  outPath = `plans/${date}-${slug}.json`;
  checkpointInputs = filteredArgs.slice(3);
} else {
  console.error("Error: insufficient arguments. See --help for usage.");
  process.exit(1);
}

if (!checkpointInputs || checkpointInputs.length === 0) {
  checkpointInputs = ["", "", ""];
}

// Assign custom ACs to the last checkpoint
if (acFlags.length > 0 && checkpointInputs.length > 0) {
  customACs = acFlags;
}

function buildCheckpoint(index: number, prevId: string | null, input: CheckpointInput, customACs?: { desc: string; verify: string }[], noSc = false) {
  const num = String(index + 1).padStart(2, "0");
  const deps = input.dependsOnPrev && prevId ? [prevId] : [];
  const title = input.title
    || TITLES[index]
    || `Phase ${num} - ${FALLBACK_AREAS[(index - TITLES.length) % FALLBACK_AREAS.length]}`;
  const titleLower = title.toLowerCase().replace(/\s+/g, "-");
  const acceptance_criteria = customACs && customACs.length > 0
    ? customACs.map((ac, i) => ({
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
  const cp: Record<string, unknown> = {
    id: `CP-${num}`,
    title,
    description: input.description || `Implement and verify "${title}"`,
    dependencies: deps,
    acceptance_criteria,
  };
  if (!noSc) {
    cp.security_concerns = [
      {
        id: `SC-${num}`,
        description: `${title} may expose sensitive data or allow unauthorized access if access controls are missing`,
        severity: SEVERITIES[index % SEVERITIES.length],
        mitigation: `Add input validation, authentication checks, and data sanitization to ${titleLower}`
      }
    ];
  }
  if (input.tags && input.tags.length > 0) {
    cp.tags = input.tags;
  }
  if (input.effort) {
    cp.effort = input.effort;
  }
  return cp as { id: string; title: string; description: string; dependencies: string[]; acceptance_criteria: unknown[]; security_concerns?: unknown[]; tags?: string[]; effort?: string };
}

export function createPlanFile(
  planTitle: string,
  planDesc: string,
  planOverview: string,
  outputPath: string,
  inputs: CheckpointInput[] = [],
  customACs?: { desc: string; verify: string }[],
  noSc = false
): boolean {
  const checkpoints: unknown[] = [];
  let prevId: string | null = null;
  for (let i = 0; i < inputs.length; i++) {
    const inp = inputs[i];
    const acs = (i === inputs.length - 1) ? customACs : undefined;
    const cp = buildCheckpoint(i, prevId, inp, acs, noSc);
    checkpoints.push(cp);
    if (inp.dependsOnPrev) {
      prevId = cp.id;
    }
  }

  const template = {
    plan: {
      title: planTitle,
      description: planDesc,
      overview: planOverview,
      version: "1.0.0",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      checkpoints
    }
  };

  const output = JSON.stringify(template, null, 2);
  const dir = outputPath.includes("/") ? outputPath.slice(0, outputPath.lastIndexOf("/")) : ".";
  if (dir !== "." && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(outputPath, output, "utf-8");
  console.log(`Plan scaffold written to ${outputPath}`);

  const errors = validatePlan(template, true);
  if (errors.length > 0) {
    console.error("Warning: generated plan failed strict validation:");
    for (const err of errors) {
      console.error(`  ${err.path}: ${err.msg}`);
    }
    return false;
  }
  console.log("Generated plan passed strict validation.");
  return true;
}

if (import.meta.main) {
  const parsed = checkpointInputs.map(parseCheckpointArgs).map(inp => ({
    ...inp,
    tags: inp.tags && inp.tags.length > 0 ? inp.tags : tagsFlag.length > 0 ? tagsFlag : undefined,
    effort: inp.effort || effortFlag,
  }));
  const ok = createPlanFile(title, description, overview, outPath, parsed, customACs, noScFlag);
  process.exit(ok ? 0 : 1);
}
