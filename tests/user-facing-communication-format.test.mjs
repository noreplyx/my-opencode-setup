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
const countWords = (group) => group.replace("**TL;DR:**", "").replace(/^>\s?/gm, "").trim().split(/\s+/).filter(Boolean).length;
const countBullets = (group) => group.split("\n").filter((line) => /^\s*(>\s*)?-\s+/.test(line)).length;
const countComparisonChars = (text) =>
  text.replace(/\[(SEV|STATUS|EVIDENCE|EFFORT|RISK): [^\]]*\]/g, "").length;
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
  assert.match(section, w("**Finding <N> — <Title> (`<name>`)** [SEV: <x>] [STATUS: <y>]"));
  assert.ok(!w("(`<name>`):**").test(cachedProse), "stale trailing-colon header form must not remain in the section prose");
  assert.match(section, w("sequential integer starting at 1"));
  assert.match(section, w("unique within the message"));
  assert.match(section, w("short human-readable phrase"));
  assert.match(section, w("stable identifier"));
  assert.match(section, w("once-per-message part invariant"));
});

test("README mirrors the per-finding header without drift", async () => {
  const readme = cachedReadmeSection;
  assert.match(readme, w("**Finding <N> — <Title> (`<name>`)** [SEV:"));
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

test("R-TL-2 counting rule is defined once with word and bullet boundaries", async () => {
  const section = cachedSection;
  const prose = cachedProse;
  assert.match(prose, w("at most 5 bullets AND at most 60 words"));
  assert.match(prose, w("whitespace-delimited tokens excluding the"));
  assert.match(prose, w("count bullets as"));
  assert.match(prose, w("`> -`-led quoted lines of the group"));
  assert.ok(!w("at most 3 hard").test(prose), "stale R-TL-2 line budget must not remain");
  assert.ok(!w("newline-delimited lines of the group").test(prose), "stale R-TL-2 line-counting definition must not remain");
  // Helper self-checks: pin the local counting semantics above, not doc content.
  assert.equal(countWords("**TL;DR:** verdict action pointer"), 3);
  assert.equal(countWords("**TL;DR:**  verdict   action\npointer"), 3);
  assert.equal(countWords("> **TL;DR:**\n> - Verdict: ready\n> - Action: approve"), 6);
  assert.equal(countBullets("**TL;DR:**\n- verdict\n- action\n- pointer"), 3);
  assert.equal(countBullets("**TL;DR:**\n- verdict\n- action\n- pointer\n- extra"), 4);
  assert.equal(countBullets("**TL;DR:**\n  - indented verdict"), 1);
  assert.equal(countBullets("> **TL;DR:**\n> - Verdict: ready\n> - Action: approve"), 2);
  assert.equal(countBullets("**TL;DR:**\nverdict action pointer"), 0);
  // Badge/tag exclusion procedure: strip the five closed-set tokens before measuring.
  assert.equal(countComparisonChars("[SEV: Major] fixed"), " fixed".length);
  assert.equal(countComparisonChars("[BOGUS: x] fixed"), "[BOGUS: x] fixed".length);
  assert.equal(countComparisonChars("a [EVIDENCE: standard] b"), "a  b".length);
});

test("README mirrors the TL;DR and hierarchy rules with parity", async () => {
  const readme = cachedReadmeSection;
  assert.match(readme, w("receipt line plus its Overview sentence(s), then one"));
  assert.match(readme, w("restating only body content with the body governing"));
  assert.match(readme, w("H-01..H-08"));
  assert.match(readme, w("Summary last and verbatim fences byte-for-byte"));
  assert.match(readme, w("non-load-bearing"));
  assert.match(readme, w("at most 5 bullets AND at most 60 words"));
  assert.ok(!w("3 hard lines").test(readme), "stale README TL;DR line budget must not remain");
  assert.ok(!w("at most 3 hard").test(readme), "stale README TL;DR line budget must not remain");
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

test("VIS-01..VIS-11 rules exist outside fences and fenced examples stay fenced", async () => {
  const section = cachedSection;
  const prose = cachedProse;
  for (const id of ["VIS-01", "VIS-02", "VIS-03", "VIS-04", "VIS-05", "VIS-06", "VIS-07", "VIS-08", "VIS-09", "VIS-10", "VIS-11"]) {
    assert.ok(prose.includes(id), `${id} must appear outside fences`);
  }
  assert.match(prose, w("plain renderer-agnostic GFM only"));
  assert.match(prose, w("never touch fence interior"));
  assert.match(prose, w("VIS-09 byte-for-byte governs"));
});

test("option headers carry no finding badges with ungraded fallback", async () => {
  const prose = cachedProse;
  assert.match(prose, w("finding badges never apply to options"));
  assert.match(prose, w("Signal: ungraded"));
  assert.match(prose, w("never invent one"));
  assert.match(prose, w("[EFFORT: low|medium|high]"));
  assert.match(prose, w("[RISK: low|medium|high]"));
  assert.ok(!w("**Option <N> — <Title>** [SEV:").test(prose), "options must not carry SEV badges in prose");
});

test("TL;DR canonical shape is blockquote-wrapping-bullets with > - counting", async () => {
  const prose = cachedProse;
  const section = cachedSection;
  assert.match(prose, w("followed by quoted bullets"));
  assert.match(prose, w("`> -`"));
  assert.match(prose, w("single canonical shape"));
  assert.match(prose, w("never a new top-level part and never before the receipt line"));
  assert.match(prose, w("excluding the `**TL;DR:**` lead-in and `>` quote markers"));
  const fenced = section;
  assert.ok(fenced.includes("> **TL;DR:**"), "fenced examples must show the blockquote TL;DR shape");
  assert.ok(fenced.includes("> - Verdict:"), "fenced examples must show quoted TL;DR bullets");
  assert.ok(!w("**TL;DR:** verdict + action + pointer (inside Overview").test(prose), "stale plain TL;DR shape must not remain in prose");
});

test("VIS-05 applies outside fences only and examples keep blank lines", async () => {
  const prose = cachedProse;
  const section = cachedSection;
  assert.match(prose, w("applies only outside fenced verbatim blocks"));
  assert.match(prose, w("never reflow, add, or remove whitespace inside a fence"));
  const fenceBlocks = section.match(/```markdown[\s\S]*?```/g) ?? [];
  assert.ok(fenceBlocks.length > 0, "expected fenced examples");
  for (const block of fenceBlocks.slice(0, 3)) {
    assert.ok(block.includes("\n\n"), "fenced example must keep blank lines between blocks");
  }
});

test("VIS-06 scopes to prose lists with fixed-shape exemptions", async () => {
  const prose = cachedProse;
  assert.match(prose, w("scopes to prose lists only"));
  assert.match(prose, w("exempts the mini-TOC link bullets"));
  assert.match(prose, w("headline table-equal bullet fallback"));
  assert.match(prose, w("`What happened` / `What next` card groups"));
});

test("VIS-07 normalizes cells, pins Title equality, and falls back to bullets", async () => {
  const prose = cachedProse;
  assert.match(prose, w("collapsing interior CRs/newlines to"));
  assert.match(prose, w("stripping or escaping `[]()` link markup"));
  assert.match(prose, w("Title cells equal to their card Title byte-for-byte"));
  assert.match(prose, w("row count checked after normalization"));
  assert.match(prose, w("falling back to equal-content bullets when a row still cannot fit a table"));
  assert.match(prose, w("bare URLs stay non-linked plain text"));
  assert.match(prose, w("Derived table views obey the secret-hygiene no-repeat rule"));
});

test("VIS-08 defines iff boundaries, slugify, dedupe, and 5-cap pagination precedence", async () => {
  const prose = cachedProse;
  assert.match(prose, w("if and only if the message has 3 or more findings or 2 or more catalogs"));
  assert.match(prose, w("lowercasing, stripping inline code/emoji/punctuation"));
  assert.match(prose, w("replacing spaces with hyphens"));
  assert.match(prose, w("deduping repeats with `-2`/`-3` suffixes"));
  assert.match(prose, w("at most 5 bullets"));
  assert.match(prose, w("first 5 plus a `…continued (N/M)` pointer"));
  assert.match(prose, w("never drop a card, field, or failure line"));
  assert.match(prose, w("Derived TOC views obey the secret-hygiene no-repeat rule"));
});

test("VIS-03 branches, VIS precedence, badge exemption, and vis10/vis11 checklist", async () => {
  const prose = cachedProse;
  const section = cachedSection;
  assert.match(prose, w("[EVIDENCE: low|standard|high]"));
  assert.match(prose, w("`low` for quick-confirm checkpoints"));
  assert.match(prose, w("`standard` for non-final checkpoints and escalations"));
  assert.match(prose, w("`high` for the final report and residual-risk acceptances"));
  assert.match(prose, w("A single-entry catalog may"));
  assert.match(prose, w("VIS-01..VIS-11 govern and the example is illustrative only"));
  assert.match(prose, w("excluding badge/tag tokens"));
  for (const slug of ["vis10-", "vis11-"]) {
    assert.ok(section.includes(slug), `${slug} checklist slug must exist (VIS-10/VIS-11 intentional coverage)`);
  }
});

test("option headers use the canonical no-trailing-colon shape", async () => {
  const prose = cachedProse;
  assert.match(prose, w("canonical shape — no trailing colon"));
  assert.ok(!w("**Option <N> — <Title>:**").test(prose), "stale trailing-colon option shape must not remain in prose");
});

test("VIS-01 envelope parent and TOC exclusion pins hold", async () => {
  const prose = cachedProse;
  assert.match(prose, w("requires its parent `##` group"));
  assert.match(prose, w("degrades to a plain bold lead-in"));
  assert.match(prose, w("excluded from the mini-TOC"));
});

test("VIS-04 Decision callout is capped, single-line, and quotes the Summary question", async () => {
  const prose = cachedProse;
  assert.match(prose, w("one line, at most 25 words"));
  assert.match(prose, w("quoting the same pending question"));
  assert.match(prose, w("on conflict the body governs"));
});

test("VIS-07/VIS-08 derived views escape markup, pin schemes, and guard secrets", async () => {
  const prose = cachedProse;
  assert.match(prose, w("never emit raw HTML"));
  assert.match(prose, w("rendered in code spans"));
  assert.match(prose, w("never emit `javascript:`/`data:` schemes"));
  assert.match(prose, w("strip backtick chars but keep the inner code content"));
  assert.match(prose, w("dedupe suffixes never carry secret material"));
  assert.match(prose, w("Title escaping under this rule does not count as inequality"));
  assert.match(prose, w("5 content + 1 pointer = 6 lines max"));
  assert.match(prose, w("closed sets only"));
  assert.match(prose, w("non-conforming badge"));
});
