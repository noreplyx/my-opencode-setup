import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isCompletionReady, validateHandoffFlow, validateRepository } from "../scripts/validate-delegation-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("all delegation prompts carry the canonical contract", async () => {
  assert.deepEqual(await validateRepository(root), []);
});

test("recorded handoff propagates the contract through every supported path", async () => {
  const fixture = JSON.parse(await readFile(path.join(root, "tests/fixtures/delegation-flow.json"), "utf8"));
  assert.deepEqual(validateHandoffFlow(fixture.endToEndHandoff), []);
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
