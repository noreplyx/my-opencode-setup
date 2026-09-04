import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const escaped = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Word-boundary-flexible anchor: phrases in these Markdown files wrap across
// lines, so match with \s+ between words instead of literal newlines.
const w = (phrase) => new RegExp(phrase.split(" ").map(escaped).join("\\s+"));
const atLineStart = (phrase) => new RegExp("^" + w(phrase).source, "m");

async function bodyOf(relativePath) {
  const doc = await readFile(path.join(root, relativePath), "utf8");
  const frontmatter = doc.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(frontmatter, `${relativePath}: missing frontmatter`);
  return doc.slice(frontmatter[0].length);
}

const EDITED_AGENTS = [
  "agent/code-reviewer.md",
  "agent/security-reviewer.md",
  "agent/coder.md",
  "agent/code-orchestrator.md",
];

test("DESIGN_CONFLICT token appears in the body of all four design-conflict agents", async () => {
  for (const relativePath of EDITED_AGENTS) {
    const body = await bodyOf(relativePath);
    assert.ok(body.includes("DESIGN_CONFLICT:"), `${relativePath}: body must mention the DESIGN_CONFLICT: marker`);
  }
});

test("both reviewers carry the identical Design-conflict flag bullet", async () => {
  const bullets = [];
  for (const relativePath of ["agent/code-reviewer.md", "agent/security-reviewer.md"]) {
    const body = await bodyOf(relativePath);
    const match = body.match(/- \*\*Design-conflict flag\.\*\*[\s\S]*?nowhere in your report\./);
    assert.ok(match, `${relativePath}: missing Design-conflict flag bullet`);
    assert.match(match[0], w("**Decision**, **Architecture**, or **Key decisions**"));
    assert.match(match[0], w("mark that finding `DESIGN_CONFLICT:` with one sentence naming the design clause it contradicts"));
    assert.match(match[0], w("Never mark implementation-level findings"));
    bullets.push(match[0].replace(/\s+/g, " ").trim());
  }
  assert.equal(bullets[0], bullets[1], "the Design-conflict flag bullet must be identical across reviewers");
});

test("coder handoff adds Design-conflict status while preserving the original fields", async () => {
  const body = await bodyOf("agent/coder.md");
  assert.match(body, w("Return: Contract confirmation; Changed areas; Criterion mapping (criterion ID, implementation, evidence, and status); Checks run (command and result); Design-conflict status; Remaining risks/ambiguities; and Requested next action."));
  assert.match(body, w("cannot be executed without contradicting the approved design document's **Decision**, **Architecture**, or **Key decisions**, mark that instruction `DESIGN_CONFLICT:` with a one-sentence reason"));
  assert.match(body, w("do not implement it silently and do not redesign it yourself"));
  assert.match(body, w("leave it unimplemented and report it as an unmet criterion and under Design-conflict status"));
  assert.match(body, w('If none of the instructions conflict with the design, state "none" for Design-conflict status'));
  assert.match(body, w("This is an implementation report, not verification."));
});

test("orchestrator contains the unnumbered Design-conflict routing block between step 8 and Stage 6", async () => {
  const body = await bodyOf("agent/code-orchestrator.md");
  const start = body.search(w("**Design-conflict routing (re-plan escape hatch).**"));
  assert.ok(start >= 0, "missing Design-conflict routing block header");
  const end = body.indexOf("**Stage 6", start);
  assert.ok(end > start, "routing block must precede Stage 6");
  assert.ok(body.search(atLineStart("8. Return to step 1")) < start, "routing block must follow step 8");
  const routing = body.slice(start, end);
  assert.match(routing, w("Findings that reveal a *design* flaw must not be dumped on the `coder` as fix instructions"));
  assert.match(routing, w("you are the only router — no subagent ever contacts the planner directly"));
  assert.match(routing, w("**Conflict-worthiness test.** A flag is valid only if fixing the finding would require changing the approved design document's **Decision**, **Architecture**, or **Key decisions**"));
  assert.match(routing, w("If a flag fails this test, strip it, route the finding to the `coder` as an ordinary fix instruction, and note the rejection in the loop status"));
  assert.match(routing, w("You may also raise a conflict yourself when a finding plainly contradicts the approved design even without a marker — name the contradicted clause in the re-issue"));
  assert.match(routing, w("**Coalesced re-issue.** Gather every valid conflict in the current outer-loop pass into **one** re-issue delegation to the `code-planner`"));
  assert.match(routing, w("include the full canonical contract, the currently approved design document, and the conflicting findings verbatim"));
  assert.match(routing, w("the original is `v1`; each re-issue increments to `v2`, `v3`, …"));
  assert.match(routing, w('superseded decisions are annotated "Superseded by vN:", never deleted'));
  assert.match(routing, w("**Criterion-ID governance.** The planner owns acceptance criteria: a revision must preserve every existing criterion ID"));
  assert.match(routing, w("items changed by the redesign are **amended in place under the same ID**"));
  assert.match(routing, w("only genuinely obsolete items are marked `withdrawn` with a reason"));
  assert.match(routing, w("new items get fresh IDs continuing the existing prefix and numbering — never renumber"));
  assert.match(routing, w("every `verifier` delegation receives that active checklist verbatim and checks it item-by-item as before"));
  assert.match(routing, w("**Re-approval (blocking checkpoint).** After a revision, re-run the **Stage 3 approval checkpoint** for it"));
  assert.match(routing, w("wait for explicit approval via the `question` tool"));
  assert.match(routing, w("This applies even when the change entered via the Stage 2.5 trivial quick-confirm with Stage 3 skipped — a design re-issue voids the triviality basis, so restore the full Stage 3 checkpoint"));
  assert.match(routing, w("**Resume.** After approval, delegate to the `coder` to implement the delta against the approved revision (Stage 4 semantics, active checklist verbatim), re-run Stage 4.5 verification, and re-enter the Stage 5 loop at step 1"));
  assert.match(routing, w("**Iteration-cap interaction.** Each design-conflict re-issue counts as one full outer-loop pass toward the step 7 cap — including conflicts you raise yourself"));
  assert.match(routing, w("escalate under step 7 with the conflict history instead of re-issuing again without a user decision"));
});

test("Stage 5 step numbering 1–8 and loop cross-references stay intact", async () => {
  const body = await bodyOf("agent/code-orchestrator.md");
  for (const anchor of [
    "1. **Security scans (once per outer-loop pass).**",
    "2. Delegate to the `security-reviewer` subagent",
    "3. If the **merged** security findings",
    "4. Delegate to the `code-reviewer` subagent",
    "5. If the review returns **any** comments or findings",
    "6. After each code-reviewer fix from step 5",
    "7. **Iteration cap / escalation.**",
    "8. Return to step 1 and repeat",
  ]) {
    assert.match(body, atLineStart(anchor), `missing Stage 5 step anchor: ${anchor}`);
  }
  assert.match(body, w("Track the number of full outer-loop passes (steps 1–6)"));
  assert.match(body, w("Stage 5 step 7 escalation, and Stage 6 final sign-off"));
});

test("routing consistency: review steps exclude conflict-worthy findings and pass the design doc", async () => {
  const body = await bodyOf("agent/code-orchestrator.md");
  assert.match(body, w("Pass the currently approved design document (latest revision) so findings can be checked against it and flagged."));
  assert.match(body, w("Include the currently approved design document (latest revision)."));
  assert.match(body, w("Findings flagged `DESIGN_CONFLICT:` that pass the conflict-worthiness test in **Design-conflict routing** (below) are **not** coder fix instructions — route them there."));
  assert.match(body, w("except findings flagged `DESIGN_CONFLICT:` that pass the conflict-worthiness test, which go to **Design-conflict routing** (below) instead of the coder"));
  assert.match(body, w("Likewise, if the `coder`'s handoff reports `DESIGN_CONFLICT:` on an instruction it received, route that instruction to **Design-conflict routing** (below)."));
  assert.match(body, w("or verification still fails, and each design-conflict re-issue counts as one such pass"));
  assert.match(body, w("present the current status, the remaining findings, and the design-conflict history (which findings were flagged, which design clauses they contradicted, and the re-issues and re-approvals so far), and ask how to proceed"));
  assert.match(body, w("always pass reviewer comments back to the coder as fix instructions, except `DESIGN_CONFLICT:` findings that pass the conflict-worthiness test, which follow the Stage 5 design-conflict routing."));
  const unconditional = (body.match(/back\s+to\s+the\s+coder/g) ?? []).length;
  assert.equal(unconditional, 1, "the only plain-text 'back to the coder' sentence must be the conditioned Guidance bullet");
});

test("design-conflict re-approval is a blocking human checkpoint", async () => {
  const body = await bodyOf("agent/code-orchestrator.md");
  assert.match(body, w("Stage 3 approval (including the Stage 5/6 design-conflict re-approval of a revised design), Stage 4.5/5 `not-verifiable` sign-offs"));
  assert.match(body, w("**must** be issued via the `question` tool, and the pipeline halts until the user answers"));
});

test("Stage 6 request-changes routes design-contradicting feedback through re-plan", async () => {
  const body = await bodyOf("agent/code-orchestrator.md");
  assert.match(body, w("If the user's feedback contradicts the approved design document, route it through Design-conflict routing first — the user's feedback is authoritative input to the planner's revision, and implementation proceeds via the re-approval checkpoint and the coder delta path — instead of passing it straight to the coder; feedback consistent with the design goes to the coder directly."));
  assert.match(body, w("then re-run the affected Stage 4.5 verification and Stage 5 loop semantics, and return to Stage 6. Repeat until the user approves."));
  assert.match(body, w("**Residual findings:** every remaining **Minor / Nit** finding"));
});

test("README documents the design re-issue escape hatch in the delegation contract section", async () => {
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  const start = readme.indexOf("### Delegation contract and completion gate");
  assert.ok(start >= 0, "delegation contract section must exist");
  const end = readme.indexOf("\n## ", start);
  const section = readme.slice(start, end === -1 ? readme.length : end);
  assert.match(section, w("If a review or implementation finding cannot be fixed without contradicting the approved design, the orchestrator routes it to the `code-planner` as a design re-issue (a versioned revision that preserves acceptance-criterion IDs) and re-runs the Stage 3 approval checkpoint before resuming implementation."));
});
