import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const escaped = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const w = (phrase) => new RegExp(phrase.split(" ").map(escaped).join("\\s+"));

const stripFences = (text) => text.replace(/`{3,}[\s\S]*?`{3,}/g, "");

const paginateCatalog = (entryLines, perPage = 10) => {
  if (entryLines.length <= perPage) {
    return [{ heading: "**Task / Criterion details:**", lines: entryLines, marker: null }];
  }
  const totalPages = Math.ceil(entryLines.length / perPage);
  return Array.from({ length: totalPages }, (_, page) => {
    const lines = entryLines.slice(page * perPage, (page + 1) * perPage);
    if (page === 0) {
      return { heading: "**Task / Criterion details:**", lines, marker: `…continued (${page + 1}/${totalPages})` };
    }
    return { heading: "**Details continued:**", lines, marker: null };
  });
};

const bodyCache = new Map();

async function bodyOf(relativePath) {
  if (bodyCache.has(relativePath)) return bodyCache.get(relativePath);
  const doc = await readFile(path.join(root, relativePath), "utf8");
  const frontmatter = doc.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(frontmatter, `${relativePath}: missing frontmatter`);
  const body = doc.slice(frontmatter[0].length);
  bodyCache.set(relativePath, body);
  return body;
}

test("DC-01 Section A schema is normative", async () => {
  const body = await bodyOf("agent/code-orchestrator.md");
  assert.match(body, w("Section A — Task / Criterion details:"));
  assert.match(body, w("[Tn] ID — title:"));
  assert.match(body, w("what-it-checks; fail-means; why-matters"));
});

test("DC-02 Section B schema is normative", async () => {
  const body = await bodyOf("agent/code-orchestrator.md");
  assert.match(body, w("Section B — Code reference details:"));
  assert.match(body, w("[Cn] symbol (kind):"));
  assert.match(body, w("location; role; context"));
});

test("DC-03 anchor grammar plus citation outside fences only", async () => {
  const body = await bodyOf("agent/code-orchestrator.md");
  assert.match(body, w("in first-appearance order in the message"));
  assert.match(body, w("case-sensitive code-unit alphabetical order by symbol within the message"));
  assert.match(body, w("only in orchestrator prose outside fenced verbatim blocks"));
  assert.match(body, w("never inside a fenced code block"));
});

test("DC-04 dedup, ordering, and omission", async () => {
  const body = await bodyOf("agent/code-orchestrator.md");
  assert.match(body, w("list each distinct ID and each distinct symbol once per message"));
  assert.match(body, w("Order Section A entries by first appearance"));
  assert.match(body, w("case-sensitive code-unit alphabetical order by symbol"));
  assert.match(body, w("never emit an empty catalog"));
});

test("DC-05 placement preserves the Summary-last invariant", async () => {
  const body = await bodyOf("agent/code-orchestrator.md");
  const task = body.indexOf("Task / Criterion details:");
  const code = body.indexOf("Code reference details:");
  assert.ok(task >= 0 && code > task, "Task catalog must precede Code catalog");
  assert.match(body, w("Summary part, which stays last"));
  assert.match(body, w("Summary stays last"));
  const placement = body.indexOf("order is Technical, then Task / Criterion details,");
  assert.ok(placement >= 0, "validator must state the catalog placement order");
  const seq = ["Technical,", "Task / Criterion details,", "Code reference details,", "Terms explained", "Summary last"].map((s) => body.indexOf(s, placement));
  assert.ok(seq.every((pos) => pos >= 0), "placement sentence must list Technical, Task, Code, Terms, Summary in order");
  for (let i = 1; i < seq.length; i++) {
    assert.ok(seq[i - 1] < seq[i], "placement sentence order must be Technical, Task, Code, Terms, Summary");
  }
  const templateD = body.slice(body.indexOf("Template D — Dual Catalog message"), body.indexOf("## Canonical handoff contract"));
  const labels = ["**Technical:**", "**Task / Criterion details:**", "**Code reference details:**", "**Summary:**"].map((label) => templateD.indexOf(label));
  assert.ok(labels.every((pos) => pos >= 0), "Template D example must carry Technical, Task, Code, Summary in order");
  for (let i = 1; i < labels.length; i++) {
    assert.ok(labels[i - 1] < labels[i], "Template D order must be Technical, Task, Code, Summary last");
  }
});

test("DC-06 sample covers 3 IDs plus 5 symbols with anchors", async () => {
  const sample = await readFile(path.join(root, "tests/fixtures/dual-catalog-sample.md"), "utf8");
  for (const anchor of ["[T1]", "[T2]", "[T3]", "[C1]", "[C2]", "[C3]", "[C4]", "[C5]"]) {
    assert.ok(sample.includes(anchor), `sample must contain ${anchor}`);
  }
  for (const id of ["`GH-01`", "`GH-02`", "`GH-03`"]) {
    assert.ok(sample.includes(id), `sample must contain ${id}`);
  }
  for (const symbol of ["`LoginAttempt`", "`MAX_RETRIES`", "`AuthService`", "`retryLogin`", "`backoffMs`"]) {
    assert.ok(sample.includes(symbol), `sample must contain ${symbol}`);
  }
  const order = [
    "**Technical:**",
    "**Task / Criterion details:**",
    "**Code reference details:**",
    "**Terms explained:**",
    "**Summary:**",
  ].map((label) => sample.indexOf(label));
  assert.ok(order.every((pos) => pos >= 0), "sample must carry all parts in placement order");
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i - 1] < order[i], "sample placement must be Technical, Task, Code, Terms, Summary");
  }
  const sectionB = sample.slice(sample.indexOf("**Code reference details:**"), sample.indexOf("**Terms explained:**"));
  const symbols = [...sectionB.matchAll(/`([^`]+)` \((?:function|table|class|variable)\)/g)].map((m) => m[1]);
  const expectedOrder = ["AuthService", "LoginAttempt", "MAX_RETRIES", "backoffMs", "retryLogin"];
  assert.deepEqual(symbols, expectedOrder, "Section B must be case-sensitive code-unit alphabetical");
  assert.deepEqual([...expectedOrder].sort(), expectedOrder, "expected Section B order must itself be code-unit sorted");
  const anchors = [...sectionB.matchAll(/\[(C\d+)\]/g)].map((m) => m[1]);
  assert.deepEqual(anchors, ["C1", "C2", "C3", "C4", "C5"], "Section B anchors must renumber in sorted order");
  const fences = sample.match(/`{3,}[\s\S]*?`{3,}/g) ?? [];
  assert.ok(fences.length >= 1, "sample must carry at least one verbatim fence");
  for (const fence of fences) {
    assert.ok(!/\[T\d+\]|\[C\d+\]/.test(fence), "verbatim fence must carry no anchors");
  }
});

test("DC-07 length caps plus pagination plus split fallback labels", async () => {
  const body = await bodyOf("agent/code-orchestrator.md");
  assert.match(body, w("each one to two lines"));
  assert.match(body, w("at most 10 inline entries"));
  assert.match(body, w("…continued (N/M)"));
  assert.match(body, w("**Details continued:**"));
  assert.match(body, w("pagination only"));
  assert.match(body, w("keep the normal"));
  assert.match(body, w("with plain ID or symbol text"));
  assert.match(body, w("only one variant per condition"));
});

test("DC-08 unknown handling is honest", async () => {
  const body = await bodyOf("agent/code-orchestrator.md");
  assert.match(body, w("unknown — <what is missing>"));
  assert.match(body, w("never hallucinate"));
  const sample = await readFile(path.join(root, "tests/fixtures/dual-catalog-sample.md"), "utf8");
  assert.ok(sample.includes("unknown — confirm"), "sample must demonstrate an honest unknown entry");
  assert.ok(!/db\/schema\.ts:\d+.*backoffMs|backoffMs.*db\/schema\.ts:\d+/.test(sample), "unknown entry must not invent a location");
});

test("DC-09 secret hygiene forbids repeats", async () => {
  const body = await bodyOf("agent/code-orchestrator.md");
  assert.match(body, w("never repeat a live secret"));
  assert.match(body, w("[redacted: secret — see file:line + rule ID]"));
  const sample = await readFile(path.join(root, "tests/fixtures/dual-catalog-sample.md"), "utf8");
  assert.ok(sample.includes("[redacted: secret — see file:line + rule ID]"), "sample must demonstrate redaction");
  assert.ok(!/sk-[A-Za-z0-9]{8,}/.test(sample), "sample must carry no live-secret-shaped text");
  assert.ok(!/BEGIN [A-Z ]*PRIVATE KEY/.test(sample), "sample must carry no private-key block");
});

test("DC-10 verbatim plus dual explanation preserved", async () => {
  const body = await bodyOf("agent/code-orchestrator.md");
  assert.match(body, w("never alter verbatim fence contents byte-for-byte"));
  assert.match(body, w("every finding keeps both explanations"));
  assert.match(body, w("Template D — Dual Catalog message"));
  const sample = await readFile(path.join(root, "tests/fixtures/dual-catalog-sample.md"), "utf8");
  assert.ok(sample.includes("```text"), "sample must keep a verbatim fence");
  assert.ok(sample.includes("Finding — plain-language:"), "sample must keep the plain-language gloss");
  assert.ok(sample.includes("Finding — technical:"), "sample must keep the technical gloss");
});

test("DC-11 additive-only change keeps required labels and contract fields", async () => {
  const body = await bodyOf("agent/code-orchestrator.md");
  const prose = stripFences(body);
  for (const label of ["**Overview:**", "**Non-technical:**", "**Technical:**", "**Summary:**"]) {
    assert.ok(body.includes(label), `required label ${label} must remain`);
    const count = prose.split(label).length - 1;
    assert.equal(count, 1, `required label ${label} must be defined exactly once in prose outside fenced examples`);
  }
  const templateD = body.slice(body.indexOf("Template D — Dual Catalog message"));
  for (const label of ["**Overview:**", "**Non-technical:**", "**Technical:**", "**Summary:**"]) {
    assert.ok(templateD.includes(label), `Template D must emit literal ${label}`);
  }
  assert.ok(!/\[Overview part\]|\[Non-technical part\]|\[Technical part\]|\[Summary part\]/.test(templateD), "Template D must not use bracket placeholders");
  assert.match(body, w("Goal, Scope, Constraints, Inputs, Expected output, Completion criteria, and Risks/ambiguities"));
});

test("DC-12 omission and single-catalog branches", async () => {
  const body = await bodyOf("agent/code-orchestrator.md");
  assert.match(body, w("Omit Section A when no ID is cited"));
  assert.match(body, w("omit Section B when no symbol is cited"));
  assert.match(body, w("never emit an empty catalog"));
  const sample = await readFile(path.join(root, "tests/fixtures/dual-catalog-sample.md"), "utf8");
  assert.ok(sample.includes("**Task / Criterion details:**"), "sample citing IDs must carry Section A");
  assert.ok(sample.includes("**Code reference details:**"), "sample citing symbols must carry Section B");
  const idOnly = await readFile(path.join(root, "tests/fixtures/dual-catalog-id-only.md"), "utf8");
  assert.ok(idOnly.includes("**Task / Criterion details:**"), "ID-only fixture must carry Section A");
  assert.ok(!idOnly.includes("**Code reference details:**"), "ID-only fixture must omit Section B");
  const idSection = idOnly.slice(idOnly.indexOf("**Task / Criterion details:**"), idOnly.indexOf("**Summary:**"));
  const idEntries = [...idSection.matchAll(/^-\s\[T\d+\].*$/gm)].map((m) => m[0]);
  assert.equal(idEntries.length, 1, "ID-only Section A must list exactly the one cited ID");
  assert.ok(idEntries[0].includes("`GH-01`"), "ID-only entry must match the cited ID");
  assert.ok(!/\[C\d+\]/.test(stripFences(idOnly)), "ID-only fixture must cite no code anchors outside fences");
  const symbolOnly = await readFile(path.join(root, "tests/fixtures/dual-catalog-symbol-only.md"), "utf8");
  assert.ok(symbolOnly.includes("**Code reference details:**"), "symbol-only fixture must carry Section B");
  assert.ok(!symbolOnly.includes("**Task / Criterion details:**"), "symbol-only fixture must omit Section A");
  const codeSection = symbolOnly.slice(symbolOnly.indexOf("**Code reference details:**"), symbolOnly.indexOf("**Summary:**"));
  const codeEntries = [...codeSection.matchAll(/^-\s\[C\d+\].*$/gm)].map((m) => m[0]);
  assert.equal(codeEntries.length, 2, "symbol-only Section B must list exactly the cited symbols");
  assert.ok(!/\[T\d+\]/.test(stripFences(symbolOnly)), "symbol-only fixture must cite no task anchors outside fences");
});

test("DC-13 ten-entry boundary and paginated continuation", async () => {
  const body = await bodyOf("agent/code-orchestrator.md");
  assert.match(body, w("at most 10 inline entries"));
  assert.match(body, w("entry count (>10)"));
  assert.match(body, w("never a rendering report"));
  assert.match(body, w("client rendering report, never entry count"));
  assert.match(body, w("…continued (N/M)"));
  assert.match(body, w("pagination only"));
  assert.match(body, w("only one variant per condition"));
  const overflow = await readFile(path.join(root, "tests/fixtures/dual-catalog-overflow-11.md"), "utf8");
  const sectionA = overflow.slice(overflow.indexOf("**Task / Criterion details:**"), overflow.indexOf("**Summary:**"));
  assert.ok(sectionA.includes("**Task / Criterion details:**"), "overflow fixture must carry the normal Section A heading");
  const entryLines = [...sectionA.matchAll(/^-\s\[T\d+\].*$/gm)].map((m) => m[0]);
  assert.equal(entryLines.length, 11, "overflow fixture must carry exactly 11 Section A entries");
  const anchors = [...sectionA.matchAll(/\[(T\d+)\]/g)].map((m) => m[1]);
  assert.deepEqual(anchors, Array.from({ length: 11 }, (_, i) => `T${i + 1}`), "overflow anchors must run T1..T11 in order");
  const inline = paginateCatalog(entryLines.slice(0, 10));
  assert.equal(inline.length, 1, "10 entries must stay on one page");
  assert.equal(inline[0].lines.length, 10, "10 entries must stay inline");
  assert.equal(inline[0].marker, null, "10-entry catalog must not paginate");
  assert.equal(inline[0].heading, "**Task / Criterion details:**", "inline catalog keeps the normal heading");
  const pages = paginateCatalog(entryLines);
  assert.equal(pages.length, 2, "11 entries must overflow to two pages");
  assert.equal(pages[0].lines.length, 10, "overflow page one carries 10 entries");
  assert.equal(pages[0].marker, "…continued (1/2)", "overflow page one carries the continuation marker");
  assert.equal(pages[0].heading, "**Task / Criterion details:**", "overflow page one keeps the normal heading");
  assert.ok(!pages[0].lines.join("\n").includes("**Details continued:**"), "page one must not use the pagination label");
  assert.equal(pages[1].heading, "**Details continued:**", "overflow page restarts under Details continued");
  assert.equal(pages[1].lines.length, 1, "overflow page two carries the remaining entry");
  assert.ok(pages[1].lines[0].includes("[T11]"), "overflow page two continues the anchor sequence");
  assert.ok(!pages[1].lines.join("\n").includes("**Task / Criterion details:**"), "paginated continuation must not also carry the normal heading (one variant only)");
  assert.deepEqual([...pages[0].lines, ...pages[1].lines], entryLines, "paginated entries must keep stable order");
  const noBracket = pages[1].lines[0].replace(/\[T\d+\]\s/, "");
  const noBracketPage = `**Task / Criterion details:**\n\n${noBracket}`;
  assert.ok(noBracketPage.startsWith("**Task / Criterion details:**"), "no-bracket variant keeps the normal heading");
  assert.ok(!noBracketPage.includes("**Details continued:**"), "no-bracket variant must not use the pagination label (one variant only)");
  assert.ok(/^-\s`GH-11`/.test(noBracket), "no-bracket variant carries plain ID text derived from the fixture entry");
});
