import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { escapeRegExp, handoffSchemaVersion, isCompletionReady, validateBrainstormHandoff, validateHandoffFlow, validatePrompt, validateRepository } from "../scripts/validate-delegation-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("all delegation prompts carry the canonical contract", async () => {
  assert.deepStrictEqual(await validateRepository(root), []);
});

test("recorded handoff propagates the contract through every supported path", async () => {
  const fixture = JSON.parse(await readFile(path.join(root, "tests/fixtures/delegation-flow.json"), "utf8"));
  assert.deepStrictEqual(validateHandoffFlow(fixture.endToEndHandoff), []);
});

test("completion requires passing verification and evidence for every criterion", async () => {
  const fixture = JSON.parse(await readFile(path.join(root, "tests/fixtures/delegation-flow.json"), "utf8"));
  assert.equal(isCompletionReady(fixture.success, fixture.expectedCriteria), true);
  assert.equal(isCompletionReady(fixture.failed, fixture.expectedCriteria), false);
  assert.equal(isCompletionReady(fixture.missingEvidence, fixture.expectedCriteria), false);
  assert.equal(isCompletionReady(fixture.notVerifiable, fixture.expectedCriteria), false);
});

test("completion rejects omitted, duplicate, or unexpected criteria", () => {
  const expected = [{ id: "AC-1" }, { id: "AC-2" }];
  const evidence = { status: "pass", evidence: "verified" };
  assert.equal(isCompletionReady({ verdict: "pass", criteria: [{ id: "AC-1", ...evidence }] }, expected), false);
  assert.equal(isCompletionReady({ verdict: "pass", criteria: [{ id: "AC-1", ...evidence }, { id: "AC-1", ...evidence }] }, expected), false);
  assert.equal(isCompletionReady({ verdict: "pass", criteria: [{ id: "AC-1", ...evidence }, { id: "AC-3", ...evidence }] }, expected), false);
});

test("brainstorm fixture retains all options with comparison", async () => {
  const fixture = JSON.parse(await readFile(path.join(root, "tests/fixtures/delegation-flow.json"), "utf8"));
  assert.deepStrictEqual(validateBrainstormHandoff(fixture.brainstormHandoff), []);
});

test("brainstorm validation enforces full fields, recommendation, and rejection reasons", () => {
  const base = {
    optionsCatalog: [
      { title: "A", whatItDoes: "Does A.", summary: "ok", pros: "p", cons: "c", effortRisk: "low" },
      { title: "B", whatItDoes: "Does B.", summary: "ok", pros: "p", cons: "c", effortRisk: "high", rejected: true, rejectedIndex: 1, rejectionReason: "cost" },
      { title: "C", whatItDoes: "Does C.", summary: "ok", pros: "p", cons: "c", effortRisk: "low", rejected: true, rejectedIndex: 2, rejectionReason: "deferred" },
    ],
    comparison: "A vs B",
    recommendation: "Recommend A",
  };
  assert.deepStrictEqual(validateBrainstormHandoff(base), []);
  assert.ok(validateBrainstormHandoff({ ...base, recommendation: "" }).some((m) => m.includes("recommendation required")));
  assert.ok(validateBrainstormHandoff({ ...base, comparison: "" }).some((m) => m.includes("comparison required")));
  const missingField = structuredClone(base);
  delete missingField.optionsCatalog[0].effortRisk;
  assert.ok(validateBrainstormHandoff(missingField).some((m) => m.includes("option 0: missing effortRisk")));
  const missingWhatItDoes = structuredClone(base);
  delete missingWhatItDoes.optionsCatalog[0].whatItDoes;
  assert.ok(validateBrainstormHandoff(missingWhatItDoes).some((m) => m.includes("option 0: missing whatItDoes")));
  assert.ok(validateBrainstormHandoff({ ...base, comparison: "x".repeat(8001) }).some((m) => m.includes("comparison exceeds 8000")));
  assert.ok(validateBrainstormHandoff({ ...base, recommendation: "x".repeat(8001) }).some((m) => m.includes("recommendation exceeds 8000")));
  const badPointer = structuredClone(base);
  badPointer.optionsCatalog[1].rejectedIndex = 9;
  assert.ok(validateBrainstormHandoff(badPointer).some((m) => m.includes("rejectedIndex")));
  assert.ok(validateBrainstormHandoff({ ...base, recommendation: undefined }).some((m) => m.includes("recommendation required")));
  assert.ok(validateBrainstormHandoff({ ...base, recommendation: "   " }).some((m) => m.includes("recommendation required")));
  assert.ok(validateBrainstormHandoff({ optionsCatalog: [{ title: "A", whatItDoes: "Does A.", summary: "ok", pros: "p", cons: "c", effortRisk: "low" }] }).length > 0);
});

test("brainstorm summary enforces the 150/151-word boundary", () => {
  const words = (n) => Array(n).fill("word").join(" ");
  const one = { title: "A", whatItDoes: "Does A.", summary: words(150), pros: "p", cons: "c", effortRisk: "low" };
  const over = { title: "A", whatItDoes: "Does A.", summary: words(151), pros: "p", cons: "c", effortRisk: "low" };
  const mk = (opt) => ({ optionsCatalog: [opt], comparison: "c", recommendation: "r" });
  assert.deepStrictEqual(validateBrainstormHandoff(mk(one)), []);
  assert.ok(validateBrainstormHandoff(mk(over)).some((m) => m.includes("exceeds ~150 words")));
});

test("handoff schema version is wired to the validator", () => {
  assert.equal(handoffSchemaVersion({}), "v1");
  assert.equal(handoffSchemaVersion({ schemaVersion: "v1" }), "v1");
  const base = { optionsCatalog: [{ title: "A", whatItDoes: "Does A.", summary: "ok", pros: "p", cons: "c", effortRisk: "low" }], comparison: "c", recommendation: "r" };
  assert.deepStrictEqual(validateBrainstormHandoff({ ...base, schemaVersion: "v1" }), []);
  assert.ok(validateBrainstormHandoff({ ...base, schemaVersion: "v9" }).some((m) => m.includes("unsupported handoff schema version")));
});

test("orchestrator re-delegate guardrail is enforced up to three re-delegations", () => {
  assert.ok(validatePrompt("code-orchestrator", "no guardrails here").includes("re-delegate guardrail"));
  assert.ok(!validatePrompt("code-orchestrator", "re-delegate when stuck").includes("re-delegate guardrail"));
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const fixture = { contract: null, plannerResult: {}, handoffs: [] };
    assert.ok(validateHandoffFlow(fixture).length > 0, `attempt ${attempt} must fail without full handoffs`);
  }
});

test("escapeRegExp handles all regex metacharacters", () => {
  assert.equal(escapeRegExp("a+b(c)"), "a\\+b\\(c\\)");
  assert.ok(new RegExp(`^${escapeRegExp("Risks/ambiguities[0]")}$`).test("Risks/ambiguities[0]"));
});
