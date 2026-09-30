import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  LINT_ALLOWS,
  LINT_MUTATE_DENIES,
  MUST_DENY_PAYLOADS,
  winningRule,
} from "./helpers/lint-allows.mjs";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const parseBashRules = (doc, name) => {
  const frontmatter = doc.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(frontmatter, `${name}: missing frontmatter`);
  const permission = yaml.load(frontmatter[1]).permission;
  assert.ok(permission && permission.bash, `${name}: missing permission.bash`);
  return permission.bash;
};

// Broad biome/eslint allows match `--write`/`--fix` suffixes at runtime, so
// safety rests on the explicit + generic deny tail winning by order/specificity.
// Prettier allows are `--check` scoped in the key itself.
const assertCheckOnlySurface = (rules, keys, name) => {
  for (const key of LINT_ALLOWS) {
    assert.equal(rules[key], "allow", `${name}: missing allow for ${key}`);
  }
  // No allow key may itself carry a mutating flag, except prettier --check scope.
  for (const key of keys) {
    if (rules[key] !== "allow") continue;
    const isLintKey =
      key.startsWith("./node_modules/.bin/biome") ||
      key.includes("eslint") ||
      key.includes("prettier") ||
      key.includes("biome");
    if (!isLintKey) continue;
    assert.ok(!key.includes("--fix"), `${name}: lint allow must not carry --fix: ${key}`);
    assert.ok(
      !key.includes("--write") || key.includes("--check"),
      `${name}: lint allow must not carry --write: ${key}`,
    );
  }
  // Explicit mutating-flag denies + generic tail must exist and come after every allow.
  for (const deny of LINT_MUTATE_DENIES) {
    assert.equal(rules[deny], "deny", `${name}: missing deny ${deny}`);
    for (const allow of LINT_ALLOWS) {
      assert.ok(
        keys.indexOf(deny) > keys.indexOf(allow),
        `${name}: ${deny} must come after ${allow}`,
      );
    }
  }
  // Simulate precedence: mutating payloads must resolve to deny.
  for (const payload of MUST_DENY_PAYLOADS) {
    const win = winningRule(payload, keys, rules);
    assert.ok(win, `${name}: no rule matches payload: ${payload}`);
    assert.equal(win.verdict, "deny", `${name}: payload must resolve to deny: ${payload} (won by ${win.key})`);
  }
};

test("verifier grants check-only biome/eslint/prettier across npm/pnpm/yarn/bun", async () => {
  const doc = await readFile(path.join(root, "agent/verifier.md"), "utf8");
  const rules = parseBashRules(doc, "verifier");
  const keys = Object.keys(rules);
  assert.equal(keys[0], "*");
  assert.equal(rules["*"], "deny");
  assertCheckOnlySurface(rules, keys, "verifier");
});

test("coder grants check-only lint/format without opening --fix/--write", async () => {
  const doc = await readFile(path.join(root, "agent/coder.md"), "utf8");
  const rules = parseBashRules(doc, "coder");
  const keys = Object.keys(rules);
  assert.equal(rules["*"], "deny");
  assertCheckOnlySurface(rules, keys, "coder");
  // Broad install/network denies that bound the new allows must still hold.
  assert.equal(rules["npx *"], "deny");
  assert.equal(rules["bunx *"], "deny");
  // Yarn parity with verifier: bare build/lint plus run-forms.
  assert.equal(rules["yarn build*"], "allow", "coder: missing yarn build parity");
  assert.equal(rules["yarn lint*"], "allow", "coder: missing yarn lint parity");
});

test("pipeline prose pins target-side biome/eslint/prettier detection and check-only gating", async () => {
  const verifier = await readFile(path.join(root, "agent/verifier.md"), "utf8");
  assert.match(verifier, /biome\.json/, "verifier must name biome.json detection");
  assert.match(verifier, /eslint\.config/, "verifier must name eslint flat-config detection");
  assert.match(verifier, /prettier --check/, "verifier must pin prettier --check");
  assert.match(verifier, /never `--write`/, "verifier must forbid prettier --write");
  assert.match(verifier, /never `--fix`/, "verifier must forbid eslint --fix");
  assert.match(verifier, /lint.*format.*fail.*is a `fail` verdict/s, "verifier must gate lint/format fail as fail");

  const coder = await readFile(path.join(root, "agent/coder.md"), "utf8");
  assert.match(coder, /biome\.json\(c\)/, "coder must honor the target biome config");
  assert.match(coder, /never `--fix`\/`--write`/, "coder must state check-only policy");

  const orchestrator = await readFile(path.join(root, "agent/code-orchestrator.md"), "utf8");
  assert.match(orchestrator, /format-check via `biome check\|ci`/, "orchestrator Stage 4.5 must name format-check");
  assert.match(orchestrator, /`biome check\|lint\|ci\|format`/, "orchestrator must include bare biome format read-only");
  assert.match(orchestrator, /`prettier --check`/, "orchestrator must name prettier --check");
  assert.match(orchestrator, /Conflicting Biome.*Prettier configs/, "orchestrator must remand formatter conflicts");

  const planner = await readFile(path.join(root, "agent/code-planner.md"), "utf8");
  assert.match(planner, /Lint\/format surface/, "planner must carry the lint/format surface section");
  assert.match(planner, /FMT-01/, "planner must template conditional FMT-01 DoD");
  assert.match(planner, /no `FMT-\*`.*no-tooling/s, "planner must skip FMT when no tooling");

  const reviewer = await readFile(path.join(root, "agent/code-reviewer.md"), "utf8");
  assert.match(reviewer, /biome\.json\(c\)/, "code-reviewer must cross-check lint configs");
  assert.match(reviewer, /You never run linters/, "code-reviewer must stay static-only");
  assert.match(reviewer, /Biome.*Prettier configs as a Minor conflict/s, "reviewer must flag formatter conflict");
  assert.match(verifier, /Conflicting formatters fail verification/, "verifier must fail on formatter conflict");
  assert.match(verifier, /formatter\.enabled: false/, "verifier must exempt Biome lint-only mode");
  assert.match(coder, /conflicting formatters/i, "coder must report formatter conflict");
});
