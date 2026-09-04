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
// Wrap- and case-robust negation matcher for stale mandates: a forbidden
// phrase must be caught even when it wraps across lines or starts a sentence
// (folds the code-review Minor-1 finding into v4).
const wi = (phrase) => new RegExp(w(phrase).source, "i");
const atLineStart = (phrase) => new RegExp("^" + w(phrase).source, "m");

async function bodyOf(relativePath) {
  const doc = await readFile(path.join(root, relativePath), "utf8");
  const frontmatter = doc.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(frontmatter, `${relativePath}: missing frontmatter`);
  return doc.slice(frontmatter[0].length);
}

const formatSection = (body) => {
  const start = body.indexOf("## User-facing communication format");
  assert.ok(start >= 0, "missing User-facing communication format section");
  const end = body.indexOf("## Canonical handoff contract");
  assert.ok(end > start, "format section must precede the canonical handoff contract section");
  return body.slice(start, end);
};

const readmeFormatSection = (readme) => {
  const start = readme.indexOf("### User-facing communication format");
  assert.ok(start >= 0, "missing README format subsection");
  const end = readme.indexOf("\n## ", start);
  return readme.slice(start, end === -1 ? readme.length : end);
};

test("orchestrator body contains the User-facing communication format section in place", async () => {
  const body = await bodyOf("agent/code-orchestrator.md");
  assert.match(body, atLineStart("## User-facing communication format"));
  const checkpoints = body.indexOf("## Human checkpoints are blocking");
  const format = body.indexOf("## User-facing communication format");
  const handoff = body.indexOf("## Canonical handoff contract");
  assert.ok(checkpoints >= 0, "missing Human checkpoints section");
  assert.ok(handoff >= 0, "missing Canonical handoff contract section");
  assert.ok(
    checkpoints < format && format < handoff,
    "format section must sit between the checkpoints and canonical handoff contract sections",
  );
});

test("section mandates the four required parts and the fixed terminology label, each exactly once, in order", async () => {
  const section = formatSection(await bodyOf("agent/code-orchestrator.md"));
  const labels = ["**Overview:**", "**Non-technical:**", "**Technical:**", "**Summary:**", "**Terms explained:**"];
  const positions = labels.map((label) => {
    const count = section.split(label).length - 1;
    assert.equal(count, 1, `label ${label} must appear exactly once in the section`);
    return section.indexOf(label);
  });
  for (let i = 1; i < 4; i++) {
    assert.ok(positions[i - 1] < positions[i], `label ${labels[i]} must follow ${labels[i - 1]}`);
  }
  assert.match(section, w("all four parts, in this order"));
  assert.match(section, w("These four parts are required in every message"));
  assert.match(section, w("each used exactly once"));
});

test("section defines the optional dynamic topic parts convention", async () => {
  const section = formatSection(await bodyOf("agent/code-orchestrator.md"));
  assert.match(section, w("zero or more dynamic topic parts"));
  assert.match(section, w("with a bold label ending in a colon"));
  assert.match(section, w("Dynamic parts may appear only between the Technical part and the Summary part"));
  assert.match(section, w("in any order among themselves"));
  assert.match(section, w("is always the last part of the message, so every checkpoint still closes with its question"));
  assert.match(section, w("The message consists of nothing outside its parts"));
  assert.match(section, w("Dynamic parts are optional by design: never add one mechanically"));
  assert.match(section, w("never treat its omission as a format violation"));
  assert.match(section, w("the never-omit rule below applies to the four required parts"));
});

test("section enumerates message coverage and the proportionality rule", async () => {
  const body = await bodyOf("agent/code-orchestrator.md");
  assert.match(body, w("Every message you send to the user — each blocking checkpoint issued via the `question` tool"));
  assert.match(body, w("the Stage 1 decision/requirements presentation"));
  assert.match(body, w("the Stage 5 step 7 escalation, and the Stage 6 sign-off and final report"));
  assert.match(body, w("one sentence each is enough for a short quick-confirm checkpoint"));
  assert.match(body, w("Never omit a part to save space"));
  assert.match(body, w("close with the exact question the user must answer, phrased as specified for that checkpoint"));
});

test("format section and README carry no stale count or misclassification mandate", async () => {
  const stale = [
    "five parts",
    "five required",
    "exactly five",
    "one dynamic part",
    "single dynamic",
    "only four parts",
    "four parts only",
    "at most one",
    "once — or a dynamic part",
    "required parts and these optional ones",
    "five fixed labels",
    "is a dynamic part",
  ];
  const section = formatSection(await bodyOf("agent/code-orchestrator.md"));
  for (const phrase of stale) {
    assert.ok(!wi(phrase).test(section), `stale mandate "${phrase}" must not appear in the format section`);
  }
  const readme = readmeFormatSection(await readFile(path.join(root, "README.md"), "utf8"));
  for (const phrase of stale) {
    assert.ok(!wi(phrase).test(readme), `stale mandate "${phrase}" must not appear in the README format subsection`);
  }
});

test("section defines the conditional Terms explained part with fixed label, slot, and content rules", async () => {
  const section = formatSection(await bodyOf("agent/code-orchestrator.md"));
  assert.match(section, w("Every message that uses a domain term or abbreviation a non-specialist reader would not know"));
  assert.match(section, w("pipeline vocabulary such as `verifier`, `DoD`, or `checkpoint`"));
  assert.match(section, w("engineering vocabulary such as `lockfile`, `CVE`, or `regex`"));
  assert.match(section, w("must add a **Terms explained:** part"));
  assert.match(section, w("It is a fixed part, not a dynamic part"));
  assert.match(section, w("it appears at most once, after every dynamic part and immediately before the Summary part, which stays last"));
  assert.match(section, w("explain each such term on its own line, in plain language for the same reader as the Non-technical part"));
  assert.match(section, w("covering every term the message uses, including one used only in a dynamic part"));
  assert.match(section, w("never introduce terms the message does not use"));
  assert.match(section, w("the part is correctly absent"));
  assert.match(section, w("never add it mechanically"));
  assert.match(section, w("never omit it when a term needs explanation"));
  assert.match(section, w("plus, when its rule applies, the fixed Terms explained label, used once and never otherwise, or a dynamic part in that slot"));
  const dynamicIntro = section.indexOf("When the message's topic calls for more");
  const termsRule = section.indexOf("Every message that uses a domain term or abbreviation");
  const proportionality = section.indexOf("Keep the parts proportional");
  assert.ok(
    dynamicIntro >= 0 && dynamicIntro < termsRule && termsRule < proportionality,
    "terminology paragraph must sit between the dynamic-parts and proportionality paragraphs",
  );
});

test("README mirrors the terminology rule without drift", async () => {
  const readme = readmeFormatSection(await readFile(path.join(root, "README.md"), "utf8"));
  assert.match(readme, w("uses domain terms or abbreviations a non-specialist reader would not know"));
  assert.match(readme, w("the orchestrator adds a Terms explained part"));
  assert.match(readme, w("after any optional topic-labeled parts and immediately before the Summary part"));
  assert.match(readme, w("explaining each such term on its own line in plain language"));
  assert.match(readme, w("no labeled parts beyond the four required parts, the Terms explained part when its rule applies, and these optional ones"));
});

test("README documents the user-facing communication format", async () => {
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  assert.match(readme, atLineStart("### User-facing communication format"));
  assert.match(readme, w("four parts in order"));
  assert.match(readme, w("verifier verdicts"));
  assert.match(readme, w("zero or more optional topic-labeled parts"));
  assert.match(readme, w("between the Technical and Summary parts"));
  assert.match(readme, w("Summary part always stays last"));
  assert.match(readme, w("a required part is never omitted"));
  const delegation = readme.indexOf("### Delegation contract and completion gate");
  const format = readme.indexOf("### User-facing communication format");
  assert.ok(delegation >= 0, "missing delegation contract subsection");
  assert.ok(delegation < format, "format subsection must follow the delegation contract subsection");
  const nextTopLevel = readme.indexOf("\n## ", delegation);
  assert.ok(nextTopLevel >= 0 && format < nextTopLevel, "format subsection must stay within the Agents section");
});
