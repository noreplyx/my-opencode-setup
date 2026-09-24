import assert from "node:assert/strict";
import { before, test } from "node:test";
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
const countWords = (group) => group.replace("**TL;DR:**", "").trim().split(/\s+/).filter(Boolean).length;
const countLines = (group) => group.split("\n").length;
const stripFences = (text) => {
  const lines = text.split("\n");
  const kept = [];
  let fence = 0;
  for (const line of lines) {
    const m = line.match(/^\s*(`{3,}|~{3,})/);
    if (m) {
      const n = m[1].length;
      if (fence === 0) fence = n;
      else if (n >= fence) fence = 0;
      continue;
    }
    if (fence === 0) kept.push(line);
  }
  assert.equal(fence, 0, "unclosed fence: stripped text ends inside a fenced block");
  return kept.join("\n");
};

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

let cachedBody;
let cachedSection;
let cachedProse;
let cachedReadme;
let cachedReadmeSection;

before(async () => {
  cachedBody = await bodyOf("agent/code-orchestrator.md");
  cachedSection = formatSection(cachedBody);
  cachedProse = stripFences(cachedSection);
  cachedReadme = await readFile(path.join(root, "README.md"), "utf8");
  cachedReadmeSection = readmeFormatSection(cachedReadme);
});

test("orchestrator body contains the User-facing communication format section in place", async () => {
  const body = cachedBody;
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
  const section = cachedSection;
  const prose = cachedProse;
  const labels = ["**Overview:**", "**Non-technical:**", "**Technical:**", "**Summary:**", "**Terms explained:**"];
  const positions = labels.map((label) => {
    const count = prose.split(label).length - 1;
    assert.equal(count, 1, `label ${label} must appear exactly once in the section prose (outside fenced examples)`);
    return prose.indexOf(label);
  });
  for (let i = 1; i < 4; i++) {
    assert.ok(positions[i - 1] < positions[i], `label ${labels[i]} must follow ${labels[i - 1]}`);
  }
  const templateD = section.slice(section.indexOf("Template D — Dual Catalog message"));
  for (const label of labels.slice(0, 4)) {
    assert.ok(templateD.includes(label), `Template D fenced example must emit literal ${label}`);
  }
  assert.match(prose, w("all four parts, in this order"));
  assert.match(prose, w("These four parts are required in every message"));
  assert.match(prose, w("each used exactly once"));
});

test("section defines the optional dynamic topic parts convention", async () => {
  const section = cachedSection;
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
  const body = cachedBody;
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
  const section = cachedSection;
  for (const phrase of stale) {
    assert.ok(!wi(phrase).test(section), `stale mandate "${phrase}" must not appear in the format section`);
  }
  const readme = cachedReadmeSection;
  for (const phrase of stale) {
    assert.ok(!wi(phrase).test(readme), `stale mandate "${phrase}" must not appear in the README format subsection`);
  }
});

test("section defines the conditional Terms explained part with fixed label, slot, and content rules", async () => {
  const section = cachedSection;
  const prose = cachedProse;
  assert.match(prose, w("Every message that uses a domain term or abbreviation a non-specialist reader would not know"));
  assert.match(prose, w("pipeline vocabulary such as `verifier`, `DoD`, or `checkpoint`"));
  assert.match(prose, w("engineering vocabulary such as `lockfile`, `CVE`, or `regex`"));
  assert.match(prose, w("must add a **Terms explained:** part"));
  assert.match(prose, w("It is a fixed part, not a dynamic part"));
  assert.match(prose, w("it appears at most once, after every dynamic part and immediately before the Summary part, which stays last"));
  assert.match(prose, w("explain each such term on its own line, in plain language for the same reader as the Non-technical part"));
  assert.match(prose, w("covering every term the message uses, including one used only in a dynamic part"));
  assert.match(prose, w("never introduce terms the message does not use"));
  assert.match(prose, w("the part is correctly absent"));
  assert.match(prose, w("never add it mechanically"));
  assert.match(prose, w("never omit it when a term needs explanation"));
  assert.match(prose, w("plus, when its rule applies, the fixed Terms explained label, used once and never otherwise, or a dynamic part in that slot"));
  const dynamicIntro = prose.indexOf("When the message's topic calls for more");
  const termsRule = prose.indexOf("Every message that uses a domain term or abbreviation");
  const proportionality = prose.indexOf("Readability formatting style guide");
  assert.ok(
    dynamicIntro >= 0 && dynamicIntro < termsRule && termsRule < proportionality,
    "terminology paragraph must sit between the dynamic-parts paragraph and the readability guide",
  );
});

test("README mirrors the terminology rule without drift", async () => {
  const readme = cachedReadmeSection;
  assert.match(readme, w("uses domain terms or abbreviations a non-specialist reader would not know"));
  assert.match(readme, w("the orchestrator adds a Terms explained part"));
  assert.match(readme, w("after any optional topic-labeled parts and immediately before the Summary part"));
  assert.match(readme, w("explaining each such term on its own line in plain language"));
  assert.match(readme, w("no labeled parts beyond the four required parts, the Terms explained part when its rule applies, and these optional ones"));
});

test("README documents the user-facing communication format", async () => {
  const readme = cachedReadme;
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

test("orchestrator format section mandates the per-finding header and its three fields", async () => {
  const section = cachedSection;
  assert.match(section, w("**Finding <N> — <Title> (`<name>`):**"));
  assert.match(section, w("sequential integer starting at 1"));
  assert.match(section, w("unique within the message"));
  assert.match(section, w("short human-readable phrase"));
  assert.match(section, w("stable identifier"));
  assert.match(section, w("once-per-message part invariant"));
});

test("README mirrors the per-finding header without drift", async () => {
  const readme = cachedReadmeSection;
  assert.match(readme, w("**Finding <N> — <Title> (`<name>`):**"));
  assert.match(readme, w("sequential number"));
  assert.match(readme, w("short title"));
  assert.match(readme, w("stable name"));
  assert.match(readme, w("each unique within the message"));
});

test("Stage 1 renderer presents all options verbatim in fixed order with guardrail", async () => {
  const body = cachedBody;
  assert.match(body, w("present all options with their catalog details"));
  assert.match(body, w("(Title, What-it-does, Summary, Pros, Cons, Effort/risk)"));
  assert.match(body, w("Option 2 missing What-it-does"));
  assert.match(body, w("verbatim pass-through"));
  assert.match(body, w("no summarize"));
  assert.match(body, w("fixed order"));
  const options = body.indexOf("Options, then Comparison, then Recommendation");
  assert.ok(options >= 0, "fixed order must list Options, then Comparison, then Recommendation");
  assert.match(body, w("re-delegate"));
  assert.match(body, w("never drop"));
  assert.match(body, w("Page i/N"));
});

test("R-TL-1..R-TL-6 rules exist outside fences with corrected order", async () => {
  const section = cachedSection;
  const prose = cachedProse;
  assert.match(prose, w("R-TL-1 — Lead-in"));
  assert.match(prose, w("R-TL-2 — Budget"));
  assert.match(prose, w("R-TL-3 — Content"));
  assert.match(prose, w("R-TL-4 — Consistency"));
  assert.match(prose, w("R-TL-5 — Required on decision-bearing messages"));
  assert.match(prose, w("R-TL-6 — Order: receipt line plus its Overview sentence(s) first"));
  assert.ok(!w("then remaining Overview sentences").test(prose), "stale R-TL-6 order must not remain");
});

test("H-01..H-08 checklist exists outside fences with spacing and merge guards", async () => {
  const section = cachedSection;
  const prose = cachedProse;
  for (const id of ["H-01", "H-02", "H-03", "H-04", "H-05", "H-06", "H-07", "H-08"]) {
    assert.ok(prose.includes(id), `${id} must appear outside fences`);
  }
  assert.match(prose, w("keep the four bold labels in order on their own lines"));
  assert.match(prose, w("exactly one blank line of inter-block spacing"));
  assert.match(prose, w("no blank lines between items of the same tight list"));
  assert.match(prose, w("more than 2 items as bullets with bold lead-ins"));
  assert.match(prose, w("comparisons, options, verdicts, and criterion status as tables"));
  assert.match(prose, w("bold for labels, lead-ins, finding headers, and option titles only"));
  assert.match(prose, w("paths, commands, IDs, and criterion IDs in inline code"));
  assert.match(prose, w("keep Overview to one or two sentences plus the TL;DR group"));
  assert.match(prose, w("merging only while the merged paragraph stays at most 3 lines"));
  assert.match(prose, w("never load-bearing, never in labels or verbatim"));
  assert.match(prose, w("maximum of one emoji per part and maximum of one Mermaid per message"));
});

test("R-TL-2 counting rule is defined once with word and line boundaries", async () => {
  const section = cachedSection;
  const prose = cachedProse;
  assert.match(prose, w("at most 60 words and at most 3 hard"));
  assert.match(prose, w("whitespace-delimited tokens excluding the"));
  assert.match(prose, w("newline-delimited lines of the group"));
  // Helper self-checks: pin the local counting semantics above, not doc content.
  assert.equal(countWords("**TL;DR:** verdict action pointer"), 3);
  assert.equal(countWords("**TL;DR:**  verdict   action\npointer"), 3);
  assert.equal(countLines("a\nb\nc"), 3);
  assert.equal(countLines("a\nb\nc\nd"), 4);
});

test("README mirrors the TL;DR and hierarchy rules with parity", async () => {
  const readme = cachedReadmeSection;
  assert.match(readme, w("receipt line plus its Overview sentence(s), then one"));
  assert.match(readme, w("restating only body content with the body governing"));
  assert.match(readme, w("H-01..H-08"));
  assert.match(readme, w("Summary last and verbatim fences byte-for-byte"));
  assert.match(readme, w("non-load-bearing"));
  assert.match(readme, w("≤60 words"));
  assert.match(readme, w("≤3 hard lines"));
});

test("uncovered branches R-TL-4, R-TL-5, H-07, H-08, and collapsible fallback exist outside fences", async () => {
  const section = cachedSection;
  const prose = cachedProse;
  assert.match(prose, w("R-TL-4 — Consistency"));
  assert.match(prose, w("on conflict the body governs"));
  assert.match(prose, w("R-TL-5 — Required on decision-bearing messages"));
  assert.match(prose, w("never added mechanically"));
  assert.match(prose, w("otherwise keeping two short paragraphs"));
  assert.match(prose, w("maximum of one emoji per part and maximum of one Mermaid per message"));
  assert.match(prose, w("Only `<details>`/`<summary>` are permitted"));
  assert.match(prose, w("with no attributes except `open` on `<details>`"));
  assert.match(prose, w("no other tags or attributes"));
  assert.match(prose, w("catalog entries never wrap a fence"));
  assert.match(prose, w("never alter verbatim fence contents byte-for-byte"));
  assert.match(prose, w("plain-GFM order as fallback"));
});

test("stripFences supports backtick and tilde fences with leading whitespace and rejects unclosed fences", async () => {
  const sample = "keep\n  ```text\nsecret\n  ```\nkeep2\n   ~~~text\nsecret2\n   ~~~\nkeep3";
  assert.equal(stripFences(sample), "keep\nkeep2\nkeep3");
  assert.throws(() => stripFences("keep\n```text\nunclosed"), /unclosed fence/);
});
