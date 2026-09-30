import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUPPORTED_DELEGATION_PATHS } from "../scripts/validate-delegation-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_MAX = 64;
const ENCODED_TRAVERSAL_RE = /%(2e|2f|5c)/i;
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const NOTE_NAME_RE = /^(\d{4}-\d{2}-\d{2})-(.+)-(plan|decision|adr-(\d+))\.md$/;
const MERMAID_ALLOW = ["flowchart", "sequenceDiagram", "classDiagram", "stateDiagram-v2", "erDiagram", "gantt"];
const TLDR_HEAD_RE = /^##\s+TL;DR\s*:?\s*$/im;

function isCalendarDate(value) {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function hasTraversalOrEncoding(value) {
  return value.includes("..") || value.includes("/") || value.includes("\\") || ENCODED_TRAVERSAL_RE.test(value);
}

function isAbsoluteOrUrl(value) {
  return value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:/.test(value) || SCHEME_RE.test(value) || value.startsWith("file://");
}

function validateDelegation({ month, date, slug, filenameSlug }) {
  for (const value of [month, date, slug]) {
    if (hasTraversalOrEncoding(value) || isAbsoluteOrUrl(value)) return `rejected traversal: ${value}`;
  }
  if (!MONTH_RE.test(month)) return `rejected month: ${month}`;
  if (!DATE_RE.test(date) || !isCalendarDate(date)) return `rejected date: ${date}`;
  if (date.slice(0, 7) !== month) return `date/month mismatch: ${date} vs ${month}`;
  if (!SLUG_RE.test(slug) || slug.length > SLUG_MAX) return `rejected slug: ${slug}`;
  if (filenameSlug !== undefined && slug !== filenameSlug) return `slug/filename mismatch: ${slug} vs ${filenameSlug}`;
  return null;
}

function mermaidFirstToken(body) {
  const lines = body.trim().split("\n");
  const first = lines.length && lines[0].trim() ? lines[0].trim() : "";
  const parts = first.split(/\s+/).filter(Boolean);
  return parts.length ? parts[0].replace(/;$/, "") : "";
}

function mermaidAllowed(body) {
  return MERMAID_ALLOW.includes(mermaidFirstToken(body));
}

function extractTldrSection(text) {
  const match = text.match(/^##\s+TL;DR\s*:?\s*$\n([\s\S]*?)(?=^##\s|\Z)/im);
  return match ? match[1] : null;
}

function tldrViolations(section) {
  const problems = [];
  const bullets = section.split("\n").filter((line) => /^\s*-\s+\S/.test(line));
  const words = section.split(/\s+/).filter(Boolean).length;
  if (bullets.length > 5) problems.push(`bullets: ${bullets.length}`);
  if (words > 60) problems.push(`words: ${words}`);
  return problems;
}

function parseSingleLineFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return null;
  const fields = {};
  const badLines = [];
  for (const line of match[1].split("\n")) {
    if (/^\s*(---|\.\.\.)\s*$/.test(line)) continue;
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) {
      badLines.push(line);
      continue;
    }
    fields[kv[1]] = kv[2].trim();
  }
  return { fields, badLines };
}

function resolveTarget(target, noteDir, files) {
  let t = target.trim().replace(/^<|>$/g, "");
  if (t.startsWith("http://") || t.startsWith("https://") || t.startsWith("#")) return "external";
  if (ENCODED_TRAVERSAL_RE.test(t)) return null;
  t = t.split("#")[0].split("?")[0].trim();
  if (!t || t.startsWith("/") || t.startsWith("file://") || t.startsWith("C:") || t.startsWith("\\") || t.split("/").includes("..")) return null;
  const candidates = t.endsWith(".svg") || t.endsWith(".canvas") || t.endsWith(".md")
    ? [`${noteDir}/${t}`, `docs/${t}`]
    : [`${noteDir}/${t}`, `${noteDir}/${t}.md`, `docs/${t}`, `docs/${t}.md`];
  return candidates.find((c) => files.has(c)) ?? null;
}

function bucketOf(key) {
  const match = key.match(/^docs\/(\d{4}-\d{2})\//);
  return match ? match[1] : null;
}

function pickFirstFreeAdr(taken, proposed) {
  let candidate = proposed;
  while (taken.has(candidate)) candidate += 1;
  return { nnn: candidate, collision: candidate !== proposed };
}

function exclusiveCreate(files, name, content) {
  if (files.has(name)) return { created: false, reason: "exists" };
  files.set(name, content);
  return { created: true };
}

test("doc-writer delegation is allowlisted on the orchestrator with docs-only scope", async () => {
  const doc = await read("agent/code-orchestrator.md");
  assert.match(doc, /doc-writer: allow/);
  assert.ok(!SUPPORTED_DELEGATION_PATHS.includes("doc-writer"), "doc-writer stays outside the code-handoff flow paths");
  const writer = await read("agent/doc-writer.md");
  assert.ok(writer.includes("ONLY inside `docs/`"));
  assert.match(writer, /skipped: out-of-scope/);
});

test("doc-writer validates month/date/slug and refuses traversal", async () => {
  const writer = await read("agent/doc-writer.md");
  assert.match(writer, /\^\\d\{4\}-\(0\[1-9\]\|1\[0-2\]\)\$/);
  assert.match(writer, /\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/);
  assert.match(writer, /\^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$/);
  assert.match(writer, /write nothing/);
  assert.match(writer, /at most 64 chars/);
  assert.match(writer, /fromisoformat/);
  assert.match(writer, /%2e/i);
  assert.match(writer, /filename slug/);

  const valid = { month: "2026-09", date: "2026-09-29", slug: "monthly-vault", filenameSlug: "monthly-vault" };
  assert.equal(validateDelegation(valid), null);
  assert.equal(validateDelegation({ ...valid, slug: "a", filenameSlug: "a" }), null);
  assert.equal(validateDelegation({ ...valid, slug: "x".repeat(64), filenameSlug: "x".repeat(64) }), null);

  const rejections = [
    [{ ...valid, month: "2026-13" }, "month=2026-13"],
    [{ ...valid, month: "2026-00" }, "month=2026-00"],
    [{ ...valid, month: "26-09" }, "short month"],
    [{ ...valid, slug: "../x", filenameSlug: undefined }, "slug=../x traversal"],
    [{ ...valid, slug: "a/b", filenameSlug: undefined }, "slug with slash"],
    [{ ...valid, slug: "UPPER", filenameSlug: undefined }, "slug uppercase"],
    [{ ...valid, slug: "", filenameSlug: undefined }, "empty slug"],
    [{ ...valid, slug: "x".repeat(65), filenameSlug: undefined }, "65-char slug over cap"],
    [{ ...valid, slug: "%2e%2e", filenameSlug: undefined }, "encoded traversal slug"],
    [{ ...valid, date: "2026-09-31" }, "date=2026-09-31 impossible day"],
    [{ ...valid, date: "2026-02-31" }, "date=2026-02-31 impossible day"],
    [{ ...valid, date: "2026-02-29" }, "date=2026-02-29 non-leap year"],
    [{ ...valid, date: "2026-13-01" }, "month 13 in date"],
    [{ ...valid, month: "2026-09", date: "2026-10-01" }, "date/month mismatch"],
    [{ ...valid, month: "../2026-09" }, "traversal month"],
    [{ ...valid, date: "2026-09-29%2f", filenameSlug: undefined }, "encoded date"],
    [{ ...valid, filenameSlug: "other-slug" }, "slug vs filename mismatch"],
  ];
  for (const [input, label] of rejections) {
    assert.notEqual(validateDelegation(input), null, `must reject ${label}`);
  }
});

test("doc-writer documents ordered idempotent Stage 6 with exclusive ADR create", async () => {
  const writer = await read("agent/doc-writer.md");
  assert.match(writer, /ADR exclusive-create first/);
  assert.match(writer, /retry.*3 times/s);
  assert.match(writer, /upsert/);
  assert.ok(writer.includes("rewrite every"));
  assert.match(writer, /never overwrite/);
  assert.match(writer, /first free NNN/);

  assert.deepStrictEqual(pickFirstFreeAdr(new Set(), 2), { nnn: 2, collision: false });
  assert.deepStrictEqual(pickFirstFreeAdr(new Set([2]), 2), { nnn: 3, collision: true });
  assert.deepStrictEqual(pickFirstFreeAdr(new Set([4, 5, 6]), 4), { nnn: 7, collision: true });

  const files = new Map();
  assert.deepStrictEqual(exclusiveCreate(files, "docs/2026-09/2026-09-29-x-adr-002.md", "v1"), { created: true });
  assert.deepStrictEqual(exclusiveCreate(files, "docs/2026-09/2026-09-29-x-adr-002.md", "v2"), { created: false, reason: "exists" });
  assert.equal(files.get("docs/2026-09/2026-09-29-x-adr-002.md"), "v1");

  let attempts = 0;
  let taken = new Set([7]);
  let result = null;
  while (attempts < 3) {
    attempts += 1;
    const pick = pickFirstFreeAdr(taken, 7);
    if (!taken.has(pick.nnn)) {
      result = pick;
      break;
    }
    taken.add(pick.nnn + 1);
  }
  assert.deepStrictEqual(result, { nnn: 8, collision: true });
  assert.ok(attempts <= 3, "retry budget holds");
});

test("vault validator frontmatter parses single-line keys and reports bad lines", async () => {
  const check = await read("docs/Validators/check.sh");
  assert.match(check, /def parse_frontmatter/);
  assert.match(check, /missing frontmatter block/);
  assert.match(check, /bad frontmatter line/);
  assert.match(check, /single-line/);

  const good = parseSingleLineFrontmatter('---\ntitle: "T"\ndate: "2026-09-29"\ntype: plan\n---\nbody\n');
  assert.deepStrictEqual(good.badLines, []);
  assert.equal(good.fields.title, '"T"');
  assert.equal(good.fields.date, '"2026-09-29"');
  assert.equal(parseSingleLineFrontmatter("no frontmatter here"), null);
  const broken = parseSingleLineFrontmatter("---\ntitle: ok\n  - stray continuation\n---\n");
  assert.ok(broken.badLines.includes("  - stray continuation"), "continuation lines are reported, not silently parsed");
  const writer = await read("agent/doc-writer.md");
  assert.match(writer, /single-line/);
});

test("vault validator resolves note-relative links and svg embeds", async () => {
  const check = await read("docs/Validators/check.sh");
  assert.match(check, /def resolve\(target, note\)/);
  assert.match(check, /note\.parent \/ t/);
  assert.match(check, /svg_embeds\.add\(r\)/);
  assert.match(check, /MONTH_GLOB/);
  assert.match(check, /\*-hub\.md/);
  assert.match(check, /%\(2e\|2f\|5c\)/i);

  const files = new Set([
    "docs/2026-09/2026-09-29-a-plan.md",
    "docs/2026-09/2026-09-hub.md",
    "docs/2026-09/assets/pic.svg",
    "docs/Home.md",
  ]);
  assert.equal(resolveTarget("2026-09-hub", "docs/2026-09", files), "docs/2026-09/2026-09-hub.md");
  assert.equal(resolveTarget("assets/pic.svg", "docs/2026-09", files), "docs/2026-09/assets/pic.svg");
  assert.equal(resolveTarget("https://example.com/x.svg", "docs/2026-09", files), "external");
  assert.equal(resolveTarget("[[2026-09/2026-09-29-a-plan]]", "docs/2026-09", files), null);
  assert.equal(resolveTarget("../outside", "docs/2026-09", files), null);
  assert.equal(resolveTarget("%2e%2e/outside", "docs/2026-09", files), null);
  assert.equal(resolveTarget("%2Fabs", "docs/2026-09", files), null);
  assert.equal(resolveTarget("missing-note", "docs/2026-09", files), null);
  assert.equal(resolveTarget("missing.svg", "docs/2026-09", files), null);
  assert.equal(resolveTarget("/abs/path", "docs/2026-09", files), null);
});

test("vault validator enforces canvas edges, triple status, TL;DR, and rollover", async () => {
  const check = await read("docs/Validators/check.sh");
  assert.match(check, /unknown fromNode/);
  assert.match(check, /unknown toNode/);
  assert.match(check, /non-numeric x\/y/);
  assert.match(check, /triple status agreement/);
  assert.match(check, /duplicate ADR number/);
  assert.match(check, /TL;DR exceeds 60 words/);
  assert.match(check, /disagrees with month folder/);
  assert.match(check, /cross-month link/);

  const nodeIds = ["a", "b"];
  const edges = [{ id: "e1", fromNode: "a", toNode: "b" }, { id: "e2", fromNode: "a", toNode: " ghost " }];
  const badEdges = edges.filter((e) => !nodeIds.includes(e.fromNode) || !nodeIds.includes(e.toNode.trim()));
  assert.equal(badEdges.length, 1);
  assert.equal(badEdges[0].id, "e2");

  const nonNumeric = [{ id: "n1", x: "left", y: 3 }, { id: "n2", x: 1, y: 2 }].filter(
    (n) => ("x" in n || "y" in n) && (typeof n.x !== "number" || typeof n.y !== "number"),
  );
  assert.equal(nonNumeric.length, 1);

  const adrOwners = new Map([["2", new Set(["docs/2026-09/a-adr-002.md", "docs/2026-09/b-adr-002.md"])], ["3", new Set(["docs/2026-09/c-adr-003.md"])]]);
  const duplicates = [...adrOwners.entries()].filter(([, keys]) => keys.size > 1);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0][0], "2");

  const sixBullets = Array(6).fill("- point").join("\n");
  assert.ok(tldrViolations(sixBullets).some((p) => p.startsWith("bullets:")));
  const sixtyOneWords = Array(61).fill("word").join(" ");
  assert.ok(tldrViolations(sixtyOneWords).some((p) => p.startsWith("words:")));
  const fiveBulletsSixtyWords = Array(5).fill(Array(12).fill("word").join(" ")).join("\n");
  assert.deepStrictEqual(tldrViolations(fiveBulletsSixtyWords), []);
  assert.deepStrictEqual(tldrViolations(Array(5).fill("- ok").join("\n")), []);

  const inlinks = new Map([["docs/2026-09/2026-09-hub.md", 3]]);
  const entrypoints = new Set(["docs/Home.md", "docs/2026-09/2026-09-hub.md"]);
  const orphanKey = "docs/2026-09/2026-09-29-lonely-plan.md";
  assert.ok(!entrypoints.has(orphanKey) && (inlinks.get(orphanKey) ?? 0) === 0);

  assert.equal(bucketOf("docs/2026-09/note.md"), "2026-09");
  assert.notEqual(bucketOf("docs/2026-10/note.md"), bucketOf("docs/2026-09/note.md"));
});

test("vault validator rejects impossible calendar dates and slug/filename drift", async () => {
  const check = await read("docs/Validators/check.sh");
  assert.match(check, /fromisoformat/);
  assert.match(check, /is not a calendar date/);
  assert.match(check, /mismatches filename slug/);

  assert.equal(isCalendarDate("2026-09-29"), true);
  assert.equal(isCalendarDate("2026-02-28"), true);
  assert.equal(isCalendarDate("2024-02-29"), true);
  for (const bad of ["2026-09-31", "2026-02-31", "2026-02-30", "2026-02-29", "2026-13-01", "2026-00-10", "not-a-date"]) {
    assert.equal(isCalendarDate(bad), false, `${bad} is not a real date`);
  }

  const nameMatch = "2026-09-29-monthly-vault-plan.md".match(NOTE_NAME_RE);
  assert.ok(nameMatch);
  assert.equal(nameMatch[2], "monthly-vault");
  assert.equal(validateDelegation({ month: "2026-09", date: "2026-09-29", slug: "monthly-vault", filenameSlug: nameMatch[2] }), null);
  assert.notEqual(validateDelegation({ month: "2026-09", date: "2026-09-29", slug: "renamed", filenameSlug: nameMatch[2] }), null);

  const writer = await read("agent/doc-writer.md");
  assert.match(writer, /real calendar date/);
  assert.match(writer, /mismatch fails closed/);
});

test("vault validator matches mermaid allowlist by exact token and TL;DR header loosely", async () => {
  const check = await read("docs/Validators/check.sh");
  assert.ok(!check.includes("startswith(ALLOW)"), "prefix match must not govern the allowlist");
  assert.match(check, /not in ALLOW/);
  assert.match(check, /TL;DR\\s\*:\?/);
  assert.match(check, /re\.I/);

  assert.equal(mermaidAllowed("flowchart TD\n  A --> B"), true);
  assert.equal(mermaidAllowed("sequenceDiagram\n  A->>B: hi"), true);
  assert.equal(mermaidAllowed("gantt\n  title T"), true);
  assert.equal(mermaidAllowed("flowcharted nonsense\n  A --> B"), false);
  assert.equal(mermaidAllowed("flowchartTD\n  A --> B"), false);
  assert.equal(mermaidAllowed(""), false);

  for (const header of ["## TL;DR", "## TL;DR:", "## tl;dr", "## Tl;DR:"]) {
    assert.ok(TLDR_HEAD_RE.test(`${header}\n- a\n`), `header accepted: ${header}`);
    assert.ok(extractTldrSection(`${header}\n- a\n\n## Next\n`)?.includes("- a"));
  }
});
