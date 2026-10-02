import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_LOOP_BUDGET,
  FINDING_CATEGORIES,
  LEDGER_STATES,
  NOT_VERIFIABLE_CAUSES,
  REQUIRED_FINDING_FIELDS,
  SEVERITIES,
  baselineMatch,
  classifyNotVerifiable,
  fingerprint,
  isConverging,
  mergeFindings,
  normalizeFindings,
  openCriticalMajorCounts,
  openCriticalMajorCountsDetailed,
  pruneBaseline,
  severityRank,
  shouldEscalate,
  updateLedger,
  validateFinding,
} from "../scripts/review-ledger.mjs";

const backticked = (text) => [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const REVIEWERS = [
  "agent/code-reviewer.md",
  "agent/security-reviewer.md",
  "agent/performance-reviewer.md",
  "agent/best-practices-reviewer.md",
  "agent/reliability-reviewer.md",
  "agent/test-correctness-reviewer.md",
];

async function bodyOf(relativePath) {
  const doc = await readFile(path.join(root, relativePath), "utf8");
  const frontmatter = doc.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(frontmatter, `${relativePath}: missing frontmatter`);
  return doc.slice(frontmatter[0].length);
}

let fixtureCache;
async function fixture() {
  if (!fixtureCache) {
    fixtureCache = JSON.parse(
      await readFile(path.join(root, "tests/fixtures/review-ledger-findings.json"), "utf8"),
    );
  }
  return fixtureCache;
}

// AC-12 — schema doc + module constants.
test("AC-12 finding schema declares eight fields, the closed enum, formula, grammar, anchors, and incident marker", async () => {
  const schema = await readFile(path.join(root, "agent/finding-schema.md"), "utf8");
  assert.equal(REQUIRED_FINDING_FIELDS.length, 8, "eight required fields");
  for (const field of REQUIRED_FINDING_FIELDS) {
    assert.ok(schema.includes(`\`${field}\``), `schema must name field ${field}`);
  }
  assert.equal(FINDING_CATEGORIES.length, 8, "closed eight-value enum");
  // C7: schema↔module exact set-equality for the category enum and anchor set,
  // not just "the string appears somewhere".
  const schemaBackticked = new Set(backticked(schema));
  const schemaCategories = [...schemaBackticked].filter((token) => FINDING_CATEGORIES.includes(token));
  assert.deepEqual(
    [...schemaCategories].sort(),
    [...FINDING_CATEGORIES].sort(),
    "schema's backticked category tokens must exactly equal the closed enum",
  );
  // G10a: the closed-enum block must carry no backticked lowercase-hyphen token
  // that is outside FINDING_CATEGORIES (intersection-only checks miss a
  // stray/typo'd enum value).
  const enumBlock = schema.slice(
    schema.indexOf("`security`"),
    schema.indexOf("## `root_cause_key`"),
  );
  assert.ok(enumBlock.includes(FINDING_CATEGORIES[0]), "schema must contain the closed-enum block");
  const enumTokens = backticked(enumBlock).filter((token) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(token));
  for (const token of enumTokens) {
    assert.ok(FINDING_CATEGORIES.includes(token), `enum block token \`${token}\` is outside FINDING_CATEGORIES`);
  }
  assert.equal(enumTokens.length, FINDING_CATEGORIES.length, "the enum block must list exactly eight tokens");
  const schemaAnchors = [
    ...new Set([...schema.matchAll(/\*\*(Critical|Major|Minor|Nit)\*\*/g)].map((match) => match[1])),
  ];
  assert.deepEqual(
    [...schemaAnchors].sort(),
    [...SEVERITIES].sort(),
    "schema's severity anchors must exactly equal the severity set",
  );
  assert.match(schema, /category\/rule_id\/file#symbol/, "fingerprint formula must be stated");
  assert.match(schema, /\^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$/, "root_cause_key grammar must be stated");
  // C8: anchored anchor phrase instead of the bare /tests?/.
  assert.match(schema, /guaranteed\s+main-path crash/, "Critical severity anchor must be stated");
  assert.match(schema, /auto-downgraded to `Nit`/, "evidence-else-Nit rule must be stated");
  assert.match(schema, /`incident: true`/, "incident marker must be stated");
  assert.match(schema, /scripts\/review-ledger\.mjs/, "schema must name the arbiter module");
});

// AC-13 — reviewers + scanner reference the schema, emit a fenced JSON block, closed enum.
test("AC-13 six reviewers and the scanner carry the schema, enum, and a fenced JSON block", async () => {
  const docs = [...REVIEWERS, "agent/code-security-scanner.md"];
  for (const relativePath of docs) {
    const body = relativePath.endsWith("code-security-scanner.md")
      ? await readFile(path.join(root, relativePath), "utf8")
      : await bodyOf(relativePath);
    assert.match(body, /agent\/finding-schema\.md/, `${relativePath}: must reference the schema`);
    assert.match(body, /scripts\/review-ledger\.mjs/, `${relativePath}: must name the arbiter`);
    assert.match(body, /```json\n/, `${relativePath}: must emit a fenced JSON block`);
    assert.match(body, /category\/rule_id\/file#symbol/, `${relativePath}: must state the fingerprint formula`);
    for (const category of FINDING_CATEGORIES) {
      assert.ok(body.includes(category), `${relativePath}: must state closed enum value ${category}`);
    }
  }
});

test("AC-13 the shared finding-schema bullet is byte-identical across the six reviewers", async () => {
  const rawBullets = [];
  for (const relativePath of REVIEWERS) {
    const body = await bodyOf(relativePath);
    // I10c: bound the capture at the bullet's own closing code fence rather
    // than `$`, so trailing content cannot be folded into the compared bytes.
    const match = body.match(/- \*\*Finding schema \(mandatory\)\.\*\*[\s\S]*?\n```\n/);
    assert.ok(match, `${relativePath}: missing Finding schema bullet`);
    assert.match(match[0], /```json\n[\s\S]*\n```/, `${relativePath}: bullet must keep the fenced JSON example`);
    // C7: compare the raw match[0] without whitespace normalization, so a
    // whitespace-only divergence cannot hide behind normalization.
    rawBullets.push(match[0]);
  }
  const [first, ...rest] = rawBullets;
  for (const bullet of rest) {
    assert.equal(first, bullet, "the Finding schema bullet must be byte-identical across reviewers");
  }
  // C7: bullet↔module parity — the shared bullet's category tokens exactly
  // equal the module's closed enum, and the JSON example carries `incident`.
  const bullet = first;
  const bulletCategories = [...new Set(backticked(bullet))].filter((token) => FINDING_CATEGORIES.includes(token));
  assert.deepEqual(
    [...bulletCategories].sort(),
    [...FINDING_CATEGORIES].sort(),
    "the shared bullet's closed enum must exactly equal FINDING_CATEGORIES",
  );
  assert.match(bullet, /"incident":/, "the shared bullet JSON example must carry the incident field");
  assert.match(bullet, /incident path/i, "the shared bullet must state the secret incident path");
  // H1/K3: the shared suppression clause scopes the severity floor to baseline
  // suppression (not the accepted ledger state) and carries the approved_by
  // requirement, so a reviewer cannot suppress a Critical/Major or an unapproved
  // baseline entry before it reaches the arbiter.
  assert.match(
    bullet,
    /never for a `Critical`\/`Major` finding \(baseline suppression only, not the Stage-6-approved `accepted` ledger state\) or an entry without an `approved_by`, an entry whose `severity` mismatches the finding \(`severity-mismatch`\), an entry whose own `severity` is missing\/malformed \(`invalid-entry`\), or an entry whose expiry is missing\/malformed \(fails closed\)/,
    "the shared bullet must scope the suppression severity floor, require an approver, and carry the severity-mismatch, invalid-entry, and fail-closed expiry lift reasons",
  );
  assert.match(bullet, /severity-mismatch/, "the shared bullet must name severity-mismatch as a lift reason");
  assert.match(bullet, /`invalid-entry`/, "the shared bullet must name invalid-entry as a lift reason");
  assert.match(bullet, /missing\/malformed/, "the shared bullet must name the fail-closed malformed expiry");
  // All six JSON examples are byte-identical too (no per-reviewer drift).
  const examples = rawBullets.map((b) => b.match(/```json\n([\s\S]*?)\n```/)[1]);
  for (const example of examples) assert.equal(example, examples[0], "the shared JSON example must be byte-identical");
});

// AC-14 — fingerprint purity, line exclusion, normalization.
test("AC-14 fingerprint is pure, deterministic, excludes line, and normalizes", () => {
  const base = {
    category: "security",
    rule_id: "SEC-1",
    file: "./src/a.ts",
    symbol: "findUser",
  };
  assert.equal(fingerprint(base), "security/SEC-1/src/a.ts#findUser");
  assert.equal(fingerprint({ ...base, line: 1 }), fingerprint({ ...base, line: 999 }));
  assert.equal(fingerprint({ ...base, file: "\\src\\a.ts" }), "security/SEC-1/src/a.ts#findUser");
  assert.equal(fingerprint({ ...base, file: "/src/a.ts" }), "security/SEC-1/src/a.ts#findUser");
  assert.equal(fingerprint({ ...base, symbol: "" }), "security/SEC-1/src/a.ts#-");
  assert.equal(fingerprint(base), fingerprint(base), "deterministic");
  // A8: a `#` in the file or a `/` in rule_id/symbol cannot collide with the
  // structural delimiters.
  assert.equal(fingerprint({ ...base, file: "src/a#b.ts" }), "security/SEC-1/src/a%23b.ts#findUser");
  assert.notEqual(
    fingerprint({ ...base, rule_id: "SEC/1" }),
    fingerprint({ ...base, rule_id: "SEC", symbol: "1" }),
    "a slash in rule_id must not be able to forge a symbol boundary",
  );
  assert.notEqual(
    fingerprint({ ...base, category: "sec/urity" }),
    fingerprint({ ...base, category: "sec", rule_id: "urity/SEC-1" }),
    "a slash in category must not collide across components",
  );
});

// AC-15 — merge keyed on fingerprint only.
test("AC-15 merge keys on fingerprint: duplicates collapse, same-line categories stay separate", async () => {
  const data = await fixture();
  const dup = mergeFindings(data.duplicateAcrossAgents);
  assert.equal(dup.length, 1, "same fingerprint across two agents collapses to one");
  assert.equal(dup[0].severity, "Major");
  assert.deepEqual(dup[0].sources, ["code-security-scanner", "security-reviewer"]);

  const sameLine = mergeFindings(data.sameLineDifferentCategories);
  assert.equal(sameLine.length, 2, "same line in different categories stays two findings");
  const keys = sameLine.map((finding) => finding.fingerprint).sort();
  assert.deepEqual(keys, ["performance/PERF-2/src/b.ts#run", "security/SEC-2/src/b.ts#run"]);
});

// AC-16 — one rubric; normalization before max-severity collapse.
test("AC-16 normalization precedes max-severity collapse and one rubric governs", async () => {
  const data = await fixture();
  const collapsed = mergeFindings(data.severityCollapse);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].severity, "Critical", "max normalized severity wins");

  // A no-evidence Critical must normalize to Nit *before* the collapse, so a
  // Major with evidence beats it (never the other way around).
  const noEvidenceCritical = {
    rule_id: "X-1",
    category: "security",
    file: "src/z.ts",
    line: 1,
    symbol: "run",
    cwe: "",
    root_cause_key: "no-proof",
    fingerprint: "security/X-1/src/z.ts#run",
    severity: "Critical",
    evidence: "",
    agent: "security-reviewer",
  };
  const merged = mergeFindings([
    { ...noEvidenceCritical, severity: "Major", evidence: "code citation src/z.ts:1" },
    noEvidenceCritical,
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].severity, "Major");
  assert.equal(SEVERITIES.length, 4);
  assert.deepEqual([...SEVERITIES].sort((a, b) => severityRank(b) - severityRank(a)), ["Critical", "Major", "Minor", "Nit"]);
});

// AC-17 — ledger states and monotonic counts.
test("AC-17 ledger tracks states, per-round counts, and non-increasing open Critical/Major", async () => {
  const data = await fixture();
  assert.deepEqual([...LEDGER_STATES], ["open", "fixed", "regressed", "recurring", "accepted"]);

  let { ledger } = updateLedger({ version: 1, entries: {} }, data.rounds.round1, "r1", "all");
  assert.equal(ledger.entries["security/SEC-1/src/a.ts#findUser"].state, "open");
  const r1 = openCriticalMajorCounts(ledger);
  assert.deepEqual([r1.Critical, r1.Major, r1.total], [0, 1, 1]);

  ({ ledger } = updateLedger(ledger, data.rounds.round2, "r2", "all"));
  assert.equal(ledger.entries["security/SEC-1/src/a.ts#findUser"].state, "recurring");
  assert.equal(ledger.entries["style/STYLE-1/src/f.ts#-"].state, "open");
  assert.equal(ledger.round, 2);
  const r2 = openCriticalMajorCounts(ledger);

  ({ ledger } = updateLedger(ledger, data.rounds.round3, "r3", "all"));
  assert.equal(ledger.entries["security/SEC-1/src/a.ts#findUser"].state, "fixed");
  assert.equal(ledger.entries["style/STYLE-1/src/f.ts#-"].state, "recurring");
  const r3 = openCriticalMajorCounts(ledger);
  assert.deepEqual([r3.Critical, r3.Major, r3.total], [0, 0, 0]);

  // C1: a previously-fixed fingerprint reappearing is `regressed` and counts
  // as open again.
  ({ ledger } = updateLedger(ledger, data.rounds.round4, "r4", "all"));
  assert.equal(ledger.entries["security/SEC-1/src/a.ts#findUser"].state, "regressed");
  const r4 = openCriticalMajorCounts(ledger);
  assert.deepEqual([r4.Critical, r4.Major, r4.total], [0, 1, 1]);

  // F5: exercise the Critical branch of openCriticalMajorCounts and assert it
  // round over round (every other ledger assertion here is Critical: 0, so the
  // Critical increment would otherwise be dead at test time).
  let { ledger: criticalLedger } = updateLedger({ version: 1, entries: {} }, data.critical.round1, "c1", "all");
  assert.deepEqual(openCriticalMajorCounts(criticalLedger), { Critical: 1, Major: 0, total: 1 });
  ({ ledger: criticalLedger } = updateLedger(criticalLedger, data.critical.round2, "c2", "all"));
  assert.deepEqual(openCriticalMajorCounts(criticalLedger), { Critical: 1, Major: 0, total: 1 }, "a held Critical count stays open");
  assert.equal(isConverging([openCriticalMajorCounts(updateLedger({ version: 1, entries: {} }, data.critical.round1, "c1", "all").ledger), openCriticalMajorCounts(criticalLedger)]), false, "a held Critical count diverges");

  // C3: round-to-round monotonicity on the converging rounds, not just an
  // endpoint comparison (the round-4 regression is exercised separately).
  assert.ok(r2.total <= r1.total && r3.total <= r2.total, "open Critical/Major must be non-increasing round over round");
  assert.equal(isConverging([r1, r2, r3, r4]), false, "a regression round must register as divergence");
});

// G10d — an `accepted` re-report stays accepted and out of open counts.
test("AC-17 an accepted entry that is re-reported stays accepted and never counts as open", async () => {
  const data = await fixture();
  const acceptedFinding = {
    rule_id: "REL-9",
    category: "reliability",
    file: "src/h.ts",
    line: 1,
    symbol: "save",
    cwe: "",
    root_cause_key: "accepted-risk",
    fingerprint: "reliability/REL-9/src/h.ts#save",
    severity: "Major",
    evidence: "code citation src/h.ts:1",
  };
  const { ledger } = updateLedger(data.accepted.ledger, [acceptedFinding], "r2", {
    reportedCategories: ["reliability"],
  });
  assert.equal(ledger.entries["reliability/REL-9/src/h.ts#save"].state, "accepted");
  assert.deepEqual(openCriticalMajorCounts(ledger), { Critical: 0, Major: 0, total: 0 });
});

// C1 (continued) — an `accepted` entry stays accepted when absent and is
// excluded from open counts.
test("AC-17 accepted risk stays accepted when absent and never counts as open", async () => {
  const data = await fixture();
  const { ledger } = updateLedger(data.accepted.ledger, data.accepted.round, "r2", "all");
  assert.equal(ledger.entries["reliability/REL-9/src/h.ts#save"].state, "accepted");
  assert.deepEqual(openCriticalMajorCounts(ledger), { Critical: 0, Major: 0, total: 0 });
});

// A6/C1 — a tiered re-verify reports only the touched categories; fingerprints
// in un-run categories keep their prior state instead of being marked fixed.
test("A6 a partial-lens round only fixes fingerprints in reported categories", async () => {
  const data = await fixture();
  // Round 2 opens a security and a style finding.
  let { ledger } = updateLedger({ version: 1, entries: {} }, data.rounds.round2, "r2", "all");
  assert.equal(ledger.entries["security/SEC-1/src/a.ts#findUser"].state, "open");
  assert.equal(ledger.entries["style/STYLE-1/src/f.ts#-"].state, "open");

  // A partial round that reports only style must fix the style finding and
  // leave the (un-run) security finding open.
  ({ ledger } = updateLedger(ledger, [], "r3", { reportedCategories: ["style"] }));
  assert.equal(ledger.entries["style/STYLE-1/src/f.ts#-"].state, "fixed");
  assert.equal(ledger.entries["security/SEC-1/src/a.ts#findUser"].state, "open", "un-run category retains its prior state");
  assert.deepEqual(openCriticalMajorCounts(ledger), { Critical: 0, Major: 1, total: 1 });
});

// F1/F2 — a recognized scope fixes only its own categories; an unrecognized
// scope fails closed (marks nothing fixed) instead of being read as "all".
test("F1/F2 a malformed ledger scope fails closed and a Set scope is honored", async () => {
  const data = await fixture();
  const seed = () =>
    updateLedger({ version: 1, entries: {} }, data.rounds.round2, "r2", "all").ledger;

  // Recognized array scope: only the listed category transitions to fixed.
  let { ledger } = updateLedger(seed(), [], "r3", ["style"]);
  assert.equal(ledger.entries["style/STYLE-1/src/f.ts#-"].state, "fixed");
  assert.equal(ledger.entries["security/SEC-1/src/a.ts#findUser"].state, "open");

  // F2: a JS `Set` scope is honored (the comment promised Set support).
  ({ ledger } = updateLedger(seed(), [], "r3", new Set(["style"])));
  assert.equal(ledger.entries["style/STYLE-1/src/f.ts#-"].state, "fixed");
  assert.equal(ledger.entries["security/SEC-1/src/a.ts#findUser"].state, "open");

  // F1: a supplied-but-unrecognized scope fails closed — nothing is marked
  // fixed, so a typo'd key cannot re-open false convergence — and it is
  // surfaced as a warning rather than failing silently.
  const malformed = updateLedger(seed(), [], "r3", { lenses: ["style"] });
  assert.equal(malformed.ledger.entries["style/STYLE-1/src/f.ts#-"].state, "open", "malformed scope must not mark style fixed");
  assert.equal(malformed.ledger.entries["security/SEC-1/src/a.ts#findUser"].state, "open", "malformed scope must not mark security fixed");
  assert.deepEqual(openCriticalMajorCounts(malformed.ledger), { Critical: 0, Major: 1, total: 1 });
  assert.equal(malformed.warnings.length, 1, "a malformed scope must surface a warning");
  assert.match(malformed.warnings[0], /unrecognized ledger scope/, "the warning must name the malformed scope");

  // H4: an omitted scope fails closed too — nothing transitions to `fixed` —
  // and is surfaced as a warning, so a missing scope cannot re-open false
  // convergence by being read as "all categories reported".
  const omitted = updateLedger(seed(), [], "r3");
  assert.equal(omitted.ledger.entries["style/STYLE-1/src/f.ts#-"].state, "open", "omitted scope must not mark style fixed");
  assert.equal(omitted.ledger.entries["security/SEC-1/src/a.ts#findUser"].state, "open", "omitted scope must not mark security fixed");
  assert.deepEqual(openCriticalMajorCounts(omitted.ledger), { Critical: 0, Major: 1, total: 1 });
  assert.equal(omitted.warnings.length, 1, "an omitted scope must surface a warning");
  assert.match(omitted.warnings[0], /scope omitted: nothing marked fixed/, "the omitted-scope warning text must be pinned");

  // The legacy full-lens caller opts in explicitly with the `"all"` sentinel.
  ({ ledger } = updateLedger(seed(), [], "r3", "all"));
  assert.equal(ledger.entries["style/STYLE-1/src/f.ts#-"].state, "fixed");
  assert.equal(ledger.entries["security/SEC-1/src/a.ts#findUser"].state, "fixed");
});

// A17/J3 — pruneBaseline drops only genuinely-expired entries, keeps every
// other entry (including invalid-expiry ones) for repair, preserves the full
// `{version, entries}` wrapper, and surfaces warnings for what it retained.
test("A17/J3 pruneBaseline drops only expired entries and preserves the wrapper", () => {
  const document = {
    version: 1,
    entries: {
      "dependency/OSV-1/src/g.ts#-": {
        fingerprint: "dependency/OSV-1/src/g.ts#-",
        severity: "Minor",
        expires: "2999-01-01T00:00:00.000Z",
      },
      "dependency/OSV-2/src/g.ts#-": {
        fingerprint: "dependency/OSV-2/src/g.ts#-",
        severity: "Minor",
        expires: "2020-01-01T00:00:00.000Z",
      },
      "dependency/OSV-3/src/g.ts#-": {
        fingerprint: "dependency/OSV-3/src/g.ts#-",
        severity: "Minor",
      },
    },
  };
  const pruned = pruneBaseline(document.entries, "2026-01-01T00:00:00.000Z");
  assert.equal(pruned.version, 1, "the wrapper version must survive a write-back");
  assert.deepEqual(
    Object.keys(pruned.entries).sort(),
    ["dependency/OSV-1/src/g.ts#-", "dependency/OSV-3/src/g.ts#-"],
    "only the genuinely-expired entry is dropped; the missing-expiry entry is kept",
  );
  assert.equal(pruned.warnings.length, 1, "the retained invalid-expiry entry must surface a warning");
  assert.match(pruned.warnings[0], /missing\/malformed expiry/, "the warning must name the invalid expiry");
  assert.match(pruned.warnings[0], /dependency\/OSV-3\/src\/g\.ts#-/, "the warning must name the retained entry");

  // J3: passing the whole document yields the same wrapper-preserving object.
  const fromDocument = pruneBaseline(document, "2026-01-01T00:00:00.000Z");
  assert.equal(fromDocument.version, 1);
  assert.deepEqual(Object.keys(fromDocument.entries).sort(), ["dependency/OSV-1/src/g.ts#-", "dependency/OSV-3/src/g.ts#-"]);

  // J2/K10: non-object entries are retained (not silently erased) with a warning.
  const mixed = pruneBaseline({ version: 1, entries: { bad: null, "dependency/OSV-3/src/g.ts#-": { severity: "Minor" } } }, "2026-01-01T00:00:00.000Z");
  assert.equal(mixed.entries.bad, null, "a non-object entry must survive for repair");
  assert.ok(mixed.entries["dependency/OSV-3/src/g.ts#-"], "the object entry must survive");
  assert.equal(mixed.warnings.length, 2, "retaining a non-object entry must warn exactly once alongside the invalid-expiry warning");

  // K10: a non-map/non-list input never throws and fails closed to an empty
  // wrapper with a warning.
  const nonMap = pruneBaseline("not-a-baseline", "2026-01-01T00:00:00.000Z");
  assert.deepEqual(nonMap, { version: 1, entries: {}, warnings: ["baseline: entries is not a map or list; nothing to prune"] });
});

// AC-18 — baseline schema and suppression.
test("AC-18 baseline is schema-valid, suppresses on match, and lifts on touch/expiry", async () => {
  const baselineDoc = JSON.parse(await readFile(path.join(root, "docs/review-baseline.json"), "utf8"));
  assert.equal(baselineDoc.version, 1);
  assert.deepEqual(baselineDoc.entries, {});

  const data = await fixture();
  const hit = baselineMatch(data.baseline.hit.finding, data.baseline.hit.baseline, data.baseline.hit.now);
  assert.equal(hit.matched, true);
  const touched = baselineMatch(data.baseline.touched.finding, data.baseline.touched.baseline, data.baseline.touched.now);
  assert.equal(touched.matched, false);
  assert.equal(touched.reason, "touched-file");
  const expired = baselineMatch(data.baseline.expired.finding, data.baseline.expired.baseline, data.baseline.expired.now);
  assert.equal(expired.matched, false);
  assert.equal(expired.reason, "expired");
  const missing = baselineMatch(data.baseline.hit.finding, { version: 1, entries: {} }, "2026-01-01T00:00:00.000Z");
  assert.equal(missing.matched, false);

  // A1: a baselined secret/incident finding is never suppressed (incident-path
  // bypass guard).
  const secretBaseline = {
    version: 1,
    entries: {
      "secret/GITLEAKS-1/src/e.ts#-": {
        fingerprint: "secret/GITLEAKS-1/src/e.ts#-",
        severity: "Minor",
        expires: "2999-01-01T00:00:00.000Z",
        touched: false,
      },
    },
  };
  const secretFinding = { ...data.secret, severity: "Minor" };
  const suppressedSecret = baselineMatch(secretFinding, secretBaseline, "2026-01-01T00:00:00.000Z");
  assert.equal(suppressedSecret.matched, false, "a baselined incident secret must stay unsuppressed");
  assert.equal(suppressedSecret.reason, "non-suppressible");

  // A1/A3: the severity floor — a baselined Critical/Major is never suppressed.
  const criticalFinding = { ...data.baseline.hit.finding, severity: "Critical" };
  const criticalBaseline = {
    version: 1,
    entries: {
      [`${fingerprint(criticalFinding)}`]: {
        fingerprint: fingerprint(criticalFinding),
        severity: "Critical",
        expires: "2999-01-01T00:00:00.000Z",
        touched: false,
      },
    },
  };
  const suppressedCritical = baselineMatch(criticalFinding, criticalBaseline, "2026-01-01T00:00:00.000Z");
  assert.equal(suppressedCritical.matched, false, "a baselined Critical must stay unsuppressed");
  assert.equal(suppressedCritical.reason, "non-suppressible");

  // A2: an entry missing `expires` fails closed rather than suppressing forever.
  const noExpiry = {
    version: 1,
    entries: {
      "dependency/OSV-1/src/g.ts#-": {
        fingerprint: "dependency/OSV-1/src/g.ts#-",
        severity: "Minor",
        touched: false,
      },
    },
  };
  const missingExpiry = baselineMatch(data.baseline.hit.finding, noExpiry, "2026-01-01T00:00:00.000Z");
  assert.equal(missingExpiry.matched, false, "an entry without expires must not match");
  assert.equal(missingExpiry.reason, "invalid-expiry");

  // A2: even a lexicographically-safe but malformed date must fail closed.
  const badExpiry = {
    version: 1,
    entries: {
      "dependency/OSV-1/src/g.ts#-": {
        fingerprint: "dependency/OSV-1/src/g.ts#-",
        severity: "Minor",
        expires: "2026-9-1",
        touched: false,
      },
    },
  };
  assert.equal(baselineMatch(data.baseline.hit.finding, badExpiry, "2026-01-01T00:00:00.000Z").reason, "invalid-expiry");

  // A2: an omitted/malformed `now` also fails closed.
  assert.equal(baselineMatch(data.baseline.hit.finding, data.baseline.hit.baseline, undefined).matched, false, "missing now must not suppress");

  // C5: now === expires is still valid (not yet expired).
  const atExpiry = baselineMatch(data.baseline.hit.finding, data.baseline.hit.baseline, data.baseline.hit.baseline.entries["dependency/OSV-1/src/g.ts#-"].expires);
  assert.equal(atExpiry.matched, true, "now === expires must still match");

  // C5/A9: a touched_files array lifts suppression and entries are normalized.
  const touchedList = {
    version: 1,
    entries: {
      "dependency/OSV-1/src/g.ts#-": {
        fingerprint: "dependency/OSV-1/src/g.ts#-",
        severity: "Minor",
        expires: "2999-01-01T00:00:00.000Z",
        touched_files: ["./src/g.ts"],
      },
    },
  };
  const touchedByList = baselineMatch(data.baseline.hit.finding, touchedList, "2026-01-01T00:00:00.000Z");
  assert.equal(touchedByList.matched, false);
  assert.equal(touchedByList.reason, "touched-file");

  // G7: an accepted entry with no approver must not suppress.
  const unapproved = {
    version: 1,
    entries: {
      "dependency/OSV-1/src/g.ts#-": {
        fingerprint: "dependency/OSV-1/src/g.ts#-",
        severity: "Minor",
        expires: "2999-01-01T00:00:00.000Z",
        touched: false,
        approved_by: "   ",
      },
    },
  };
  const noApprover = baselineMatch(data.baseline.hit.finding, unapproved, "2026-01-01T00:00:00.000Z");
  assert.equal(noApprover.matched, false, "an entry without an approver must not suppress");
  assert.equal(noApprover.reason, "unapproved-entry");

  // G10c: a severity-mismatched entry must not suppress.
  const severityMismatch = {
    version: 1,
    entries: {
      "dependency/OSV-1/src/g.ts#-": {
        fingerprint: "dependency/OSV-1/src/g.ts#-",
        severity: "Nit",
        expires: "2999-01-01T00:00:00.000Z",
        touched: false,
        approved_by: "user",
      },
    },
  };
  const mismatched = baselineMatch(data.baseline.hit.finding, severityMismatch, "2026-01-01T00:00:00.000Z");
  assert.equal(mismatched.matched, false);
  assert.equal(mismatched.reason, "severity-mismatch");

  // Q2: the full set of arbiter lift reasons must be restated normatively in
  // the schema baseline section, the scanner caveat, and the delegation
  // contract — including `invalid-entry`, the entry-own-severity case.
  const liftReasons = ["touched-file", "expired", "invalid-expiry", "unapproved-entry", "invalid-entry", "severity-mismatch"];
  const schema = await readFile(path.join(root, "agent/finding-schema.md"), "utf8");
  const scanner = await readFile(path.join(root, "agent/code-security-scanner.md"), "utf8");
  const contract = await readFile(path.join(root, "agent/delegation-contract.md"), "utf8");
  for (const [label, doc] of [["schema", schema], ["scanner", scanner], ["contract", contract]]) {
    for (const reason of liftReasons) {
      assert.ok(doc.includes(reason), `${label} must restate lift reason ${reason}`);
    }
  }
});

// F6 — the keyed fingerprint shape is probed directly, not only scanned.
test("F6 baselineMatch probes the fingerprint key before falling back to the scan", () => {
  const finding = {
    rule_id: "OSV-1",
    category: "dependency",
    file: "src/g.ts",
    line: 4,
    symbol: "",
    cwe: "CWE-1104",
    root_cause_key: "outdated-dependency",
    fingerprint: "dependency/OSV-1/src/g.ts#-",
    severity: "Minor",
    evidence: "osv-scanner scan source -r",
  };
  const now = "2026-01-01T00:00:00.000Z";
  // A keyed object whose entry has no `fingerprint` field: only the keyed
  // lookup can find it (the linear fallback would reject it).
  const keyedByKey = {
    version: 1,
    entries: {
      "dependency/OSV-1/src/g.ts#-": {
        severity: "Minor",
        expires: "2999-01-01T00:00:00.000Z",
        touched: false,
        approved_by: "user",
      },
    },
  };
  assert.equal(baselineMatch(finding, keyedByKey, now).matched, true, "the keyed entry must be found via entries[key]");
  // A mismatched key on an object-shaped baseline is definitive (no scan): the
  // key miss reports no entry.
  const otherKey = {
    version: 1,
    entries: { "dependency/OSV-9/src/g.ts#-": { severity: "Minor", expires: "2999-01-01T00:00:00.000Z", approved_by: "user" } },
  };
  assert.equal(baselineMatch(finding, otherKey, now).reason, "no-baseline-entry");
});

// AC-19 — scanner per-leg mode/digest + once-per-run history scanners.
test("AC-19 scanner declares per-leg mode and rule_pack_digest with history scanners once per run", async () => {
  const scanner = await readFile(path.join(root, "agent/code-security-scanner.md"), "utf8");
  assert.match(scanner, /mode: full\|delta/, "scanner must declare the mode field");
  assert.match(scanner, /rule_pack_digest/, "scanner must declare the digest field");
  assert.match(scanner, /history and whole-repo legs run \*\*once per run\*\*/, "history scanners run once per run");
  assert.match(scanner, /full OSV\/Semgrep/, "OSV/Semgrep full scans run once per run");
  // B2: the stateless scanner is explicitly handed the run's mode + identity.
  assert.match(scanner, /stateless across delegations/, "scanner must state it is stateless across delegations");
  assert.match(scanner, /passes this run's\s+`mode`/, "scanner must receive the run mode explicitly");
  // B5: the JSON example's incident is a placeholder, never hardcoded false.
  assert.match(scanner, /"incident":\s*"<true for category: secret, else false>"/, "incident must be a placeholder");
  assert.doesNotMatch(scanner, /"incident":false/, "the scanner example must not hardcode incident:false");
  const orchestrator = await readFile(path.join(root, "agent/code-orchestrator.md"), "utf8");
  assert.match(orchestrator, /stateless\s+across\s+delegations/, "orchestrator must pass the mode to the stateless scanner");
  assert.match(orchestrator, /explicitly pass it this run's scan mode/, "orchestrator must pass the scan mode explicitly");
  const data = await fixture();
  // C6: assert the scanner-shaped secret actually passes validation and keeps
  // its incident marker through normalization/merge — not a tautology.
  assert.deepEqual(validateFinding(data.secret), [], "scanner-shaped secret must pass validation");
  const { valid } = normalizeFindings([data.secret]);
  assert.equal(valid.length, 1);
  assert.equal(valid[0].incident, true, "scanner-shaped secret must retain incident after normalization");
});

// AC-20 — proof required; no evidence → Nit.
test("AC-20 every finding needs proof and no evidence auto-downgrades to Nit", async () => {
  const data = await fixture();
  const { valid, invalid } = normalizeFindings([data.noEvidence]);
  assert.equal(invalid.length, 0, "a schema-valid no-evidence finding is normalized, not dropped");
  const [normalized] = valid;
  assert.equal(normalized.severity, "Nit");
  assert.equal(normalized.evidence_present, false);
  const schema = await readFile(path.join(root, "agent/finding-schema.md"), "utf8");
  assert.match(schema, /no evidence is auto-downgraded to `Nit`/);
  for (const relativePath of REVIEWERS) {
    assert.match(await bodyOf(relativePath), /no evidence auto-downgrades to \*\*Nit\*\*/, `${relativePath}: must state evidence-else-Nit`);
  }
});

// C2 — validateFinding negative paths and normalizeFindings surfacing.
test("C2 validateFinding rejects malformed findings and normalizeFindings surfaces them", () => {
  const base = {
    rule_id: "SEC-9",
    category: "security",
    file: "src/k.ts",
    line: 1,
    symbol: "",
    cwe: "",
    root_cause_key: "bad-shape",
    fingerprint: "security/SEC-9/src/k.ts#-",
    severity: "Major",
  };
  // The baseline shape is valid, so every case below isolates one fault.
  assert.deepEqual(validateFinding(base), []);
  const cases = [
    [null, /object/],
    [[], /object/],
    [{ ...base, category: "mystery" }, /invalid category/],
    [{ ...base, severity: "Blocker" }, /invalid severity/],
    [{ ...base, root_cause_key: "Bad Slug" }, /root_cause_key/],
    [{ ...base, line: 0 }, /invalid line/],
    [{ ...base, line: 1.5 }, /invalid line/],
    [{ ...base, fingerprint: "security/SEC-9/other.ts#-" }, /canonical formula/],
    [{ ...base, severity: undefined }, /invalid severity/],
    // G10b: non-string symbol/cwe are rejected (they are string-typed fields).
    [{ ...base, symbol: 7 }, /invalid symbol/],
    [{ ...base, cwe: ["CWE-89"] }, /invalid cwe/],
  ];
  for (const [finding, pattern] of cases) {
    const errors = validateFinding(finding);
    assert.ok(errors.length > 0, `expected errors for ${JSON.stringify(finding)}`);
    assert.ok(errors.some((error) => pattern.test(error)), `expected ${pattern} in ${errors.join("; ")}`);
  }
  // A4: normalizeFindings never silently drops an invalid finding.
  const { valid, invalid } = normalizeFindings([base, { ...base, severity: "Blocker" }]);
  assert.equal(valid.length, 1);
  assert.equal(invalid.length, 1);
  assert.ok(invalid[0].errors.some((error) => error.includes("invalid severity")));
  // A4: mergeFindings surfaces the invalid finding as a visible Major.
  const merged = mergeFindings([base, { ...base, severity: "Blocker" }]);
  assert.equal(merged.length, 2, "the malformed finding must not vanish");
  const malformed = merged.find((finding) => finding.rule_id.startsWith("malformed-"));
  assert.ok(malformed, "malformed finding must be surfaced with a distinct rule_id");
  assert.equal(malformed.severity, "Major");
  assert.match(malformed.evidence, /malformed finding — needs review/);

  // A13: missing vs empty produce distinct messages, and the exact message
  // list is pinned so the assertion cannot pass vacuously.
  const missingRuleId = { ...base, rule_id: undefined, fingerprint: "security//src/k.ts#-" };
  assert.deepEqual(validateFinding(missingRuleId), ["missing required field: rule_id"]);
  const emptyFile = { ...base, file: "", fingerprint: "security/SEC-9/#-" };
  assert.deepEqual(validateFinding(emptyFile), ["empty required field: file"]);
  const missingBoth = { ...base, rule_id: undefined, file: "" };
  assert.deepEqual(validateFinding(missingBoth), [
    "missing required field: rule_id",
    "empty required field: file",
    "fingerprint does not match the canonical formula",
  ]);

  // G10b: a null entry in the array is surfaced, never silently dropped.
  const surfaced = normalizeFindings([null]);
  assert.equal(surfaced.valid.length, 0);
  assert.equal(surfaced.invalid.length, 1);
  assert.equal(mergeFindings([null]).length, 1, "a null finding must surface as a synthetic Major");
  // G8: validation errors reference the field name and kind without echoing a
  // free-text value into the synthetic finding's evidence.
  const secretValue = "Super Secret Token Value";
  const leaked = mergeFindings([{ ...base, root_cause_key: secretValue }]);
  assert.ok(
    leaked.every((finding) => !String(finding.evidence).includes(secretValue)),
    "validation evidence must not echo raw field values",
  );
  assert.match(validateFinding({ ...base, category: "mystery" })[0], /invalid category/);
});

// P3/P5 — invalid findings stay individually visible and are redacted.
test("P3/P5 normalizeFindings keeps distinct invalid entries visible and redacts raw values", () => {
  const base = {
    rule_id: "SEC-9",
    category: "security",
    file: "src/k.ts",
    line: 1,
    symbol: "",
    cwe: "",
    root_cause_key: "bad-shape",
    fingerprint: "security/SEC-9/src/k.ts#-",
    severity: "Major",
    evidence: "code citation src/k.ts:1",
  };
  // Two non-object invalid findings once collapsed to one `malformed-unknown`
  // fingerprint; each must now stay individually visible (P3).
  const surfaced = mergeFindings([null, { ...base, severity: "Blocker" }]);
  const malformed = surfaced.filter((finding) => finding.rule_id.startsWith("malformed-"));
  assert.equal(malformed.length, 2, "two distinct invalid entries must surface as two findings");
  assert.equal(new Set(malformed.map((finding) => finding.fingerprint)).size, 2, "their fingerprints must differ");
  assert.ok(malformed.some((finding) => finding.rule_id === "malformed-unknown-1"));
  assert.ok(malformed.some((finding) => finding.rule_id.endsWith("-2")));

  // P5: `invalid[].finding` is a redacted projection — no `evidence`/free-text
  // value can leak if a caller logs it verbatim.
  const secret = "Super Secret Token Value";
  const { invalid } = normalizeFindings([{ ...base, root_cause_key: secret, evidence: secret, cwe: secret }]);
  assert.equal(invalid.length, 1);
  assert.ok(!("evidence" in invalid[0].finding), "the projection must drop evidence");
  assert.ok(!JSON.stringify(invalid[0]).includes(secret), "the projection must not echo raw free-text values");
  // The projection still round-trips through malformedFinding with the same
  // identity-bearing fields.
  const [projected] = mergeFindings([{ ...base, root_cause_key: secret, evidence: secret }]);
  assert.match(projected.rule_id, /^malformed-SEC-9-1$/, "the projection keeps the usable rule_id");
});

// P7 — a skipped (non-object) ledger entry fails a convergence comparison
// closed so a corrupt ledger cannot read as converged.
test("P7 isConverging fails closed when a compared ledger reports a skipped entry", () => {
  const converging = [
    { Critical: 0, Major: 1 },
    { Critical: 0, Major: 0 },
  ];
  assert.equal(isConverging(converging), true, "the baseline counts converge");
  const skipped = {
    version: 1,
    entries: {
      // `real` is an open Major so the skipped ledger, absent the guard, would
      // read as CONVERGING: counts[0] = {Critical: 0, Major: 1} and
      // lastTotal 0 < priorTotal 1 → true. The asserted `false` therefore
      // uniquely pins the skipped-entry guard; delete it and this test fails.
      real: { state: "open", severity: "Major" },
      corrupt: null,
    },
  };
  assert.equal(isConverging([skipped, { Critical: 0, Major: 0 }]), false, "a skipped entry fails closed to non-converging");
});

// P9a/P10c — the orchestrator treats a skipped non-object ledger entry as a
// blocking escalation, and names both the scope and skipped warnings.
test("P9a/P10c orchestrator treats skipped ledger entries as a blocking escalation", async () => {
  const orchestrator = await readFile(path.join(root, "agent/code-orchestrator.md"), "utf8");
  const flat = orchestrator.replace(/\s+/g, " ");
  assert.match(flat, /warnings.*malformed or omitted scope, or a skipped non-object ledger entry/, "the warning parenthetical must list the scope and skip warnings");
  assert.match(flat, /log the `skipped` count and inspect the ledger's non-object entries/, "the skipped guidance must name the count and the non-object entries");
  assert.match(flat, /treat any `skipped` entry as a blocking escalation/, "a skipped entry must be a blocking escalation");
});

// P11a — a numeric-string round is honored, not rejected.
test("P11a updateLedger accepts a numeric-string round", () => {
  const { ledger } = updateLedger({ version: 1, round: "4", entries: {} }, [], "r5", "all");
  assert.equal(ledger.round, 5, "a numeric-string prior round must be honored and incremented");
});

// AC-21 — tiered reverify (routing test + prompt).
test("AC-21 re-verification is tiered by touched category versus large/security-sensitive diffs", async () => {
  const orchestrator = await readFile(path.join(root, "agent/code-orchestrator.md"), "utf8");
  assert.match(orchestrator, /re-verify in \*\*tiers\*\*/, "orchestrator must state tiered reverify");
  assert.match(orchestrator, /touched-category lenses/, "ordinary fix scopes to touched-category lenses");
  assert.match(orchestrator, /large or security-sensitive diff[\s\S]*all five lenses \*\*and\*\* the\s+scanner/, "large/security-sensitive diff runs all lenses plus scanner");
});

// AC-22 — critical secret incident path, never coder loop.
test("AC-22 critical secret routes to the incident path and is never a coder fix", async () => {
  const data = await fixture();
  const [merged] = mergeFindings([data.secret]);
  assert.equal(merged.category, "secret");
  assert.equal(merged.severity, "Critical");
  assert.equal(merged.incident, true, "merged secret retains incident marker");

  const valid = {
    rule_id: "GITLEAKS-9",
    category: "secret",
    file: "src/e.ts",
    line: 1,
    symbol: "",
    cwe: "CWE-798",
    root_cause_key: "hardcoded-token",
    fingerprint: "secret/GITLEAKS-9/src/e.ts#-",
    severity: "Critical",
  };
  assert.ok(validateFinding(valid).some((error) => error.includes("incident")), "secret without incident is invalid");
  assert.deepEqual(validateFinding({ ...valid, incident: true }), []);

  // A5: a secret at any severity (not only Critical) requires the marker, and
  // a no-evidence secret is never downgraded out of the incident path.
  for (const severity of ["Major", "Minor", "Nit"]) {
    const secretAtSeverity = { ...valid, severity };
    assert.ok(
      validateFinding(secretAtSeverity).some((error) => error.includes("incident")),
      `a ${severity} secret without incident is invalid`,
    );
  }
  const noEvidenceSecret = { ...valid, incident: true, evidence: "" };
  const { valid: secretValid } = normalizeFindings([noEvidenceSecret]);
  assert.equal(secretValid[0].severity, "Critical", "a no-evidence secret must not be downgraded to Nit");
  assert.equal(secretValid[0].incident, true);

  // G1: a secret finding that omits `incident` is invalid, but the surfaced
  // synthetic Major must still carry `incident === true` so it cannot slip into
  // the coder path as an ordinary Major.
  const { incident: _omitted, ...secretWithoutIncident } = { ...valid };
  const [surfacedSecret] = mergeFindings([secretWithoutIncident]);
  assert.equal(surfacedSecret.category, "secret");
  assert.equal(surfacedSecret.incident, true, "a malformed secret must keep incident: true after normalization");

  for (const relativePath of ["agent/code-orchestrator.md", "agent/code-security-scanner.md", "agent/delegation-contract.md"]) {
    const body = await readFile(path.join(root, relativePath), "utf8");
    assert.match(body, /incident path/, `${relativePath}: must state the incident path`);
    assert.match(body, /never[\s\S]{0,40}(coder|fix loop)/i, `${relativePath}: must exclude the coder loop`);
    // H2: any severity routes to the incident path — a Major/Minor secret must
    // not slip into the coder loop. The floor is never a "Critical" qualifier.
    assert.equal(
      /Critical secret finding/.test(body),
      false,
      `${relativePath}: incident-path prose must not be Critical-scoped`,
    );
  }
  const orchestrator = await readFile(path.join(root, "agent/code-orchestrator.md"), "utf8");
  const flatOrchestrator = orchestrator.replace(/\s+/g, " ");
  assert.match(
    flatOrchestrator,
    /A secret finding \(`category: secret`, `incident: true`, \*\*any severity\*\*\)/,
    "orchestrator incident path must be any-severity, not Critical-scoped",
  );
});

// AC-23 — not-verifiable bijection and coverage/mutation.
test("AC-23 not-verifiable causes map bijectively to routes and name coverage/mutation", async () => {
  const data = await fixture();
  // I10b: the fixture cause list is live, not dead weight.
  assert.deepEqual(
    [...data.notVerifiableCauses].sort(),
    [...NOT_VERIFIABLE_CAUSES].sort(),
    "the fixture cause list must match the module's closed cause enum",
  );
  const routes = new Map();
  for (const cause of NOT_VERIFIABLE_CAUSES) {
    const route = classifyNotVerifiable(cause);
    assert.ok(route, `cause ${cause} must have a route`);
    routes.set(cause, route);
    assert.equal(typeof route.route, "string");
    assert.equal(typeof route.owner, "string");
  }
  assert.deepEqual(routes.get("no-tooling"), { route: "add-tooling", owner: "coder" });
  assert.deepEqual(routes.get("ambiguous"), { route: "redefine", owner: "planner" });
  assert.equal(routes.get("external").route, routes.get("manual").route, "external and manual share user sign-off");
  assert.equal(classifyNotVerifiable("mystery"), null, "unknown causes fail closed");

  const verifier = await readFile(path.join(root, "agent/verifier.md"), "utf8");
  assert.match(verifier, /no-tooling.*add-tooling/, "verifier must route no-tooling to add-tooling");
  assert.match(verifier, /coverage-delta or mutation/, "verifier must add coverage-delta/mutation where tooling exists");

  // I7: the contract's cause→route prose is asserted against the module's
  // classifyNotVerifiable table, not just a generic phrase, so a drifted route
  // cannot hide behind matching wording.
  const contract = await readFile(path.join(root, "agent/delegation-contract.md"), "utf8");
  const cflat = contract.replace(/\s+/g, " ");
  const ownerPhrase = { coder: "the `coder`", planner: "the `code-planner`" };
  for (const cause of NOT_VERIFIABLE_CAUSES) {
    const { route, owner } = classifyNotVerifiable(cause);
    assert.ok(cflat.includes(`\`${cause}\``), `contract must name cause ${cause}`);
    if (owner === "user") {
      assert.ok(cflat.includes("user sign-off"), `contract must route ${cause} to user sign-off (${route})`);
    } else {
      assert.ok(cflat.includes(route), `contract must route ${cause} to ${route}`);
      assert.ok(
        cflat.includes(ownerPhrase[owner]),
        `contract must route ${cause} to ${ownerPhrase[owner]} (${route})`,
      );
    }
  }
  // K8: bind each user-owned cause to its route per-cause, not only via the
  // global "user sign-off" phrase, so a dropped/renamed cause cannot hide.
  for (const cause of ["external", "manual"]) {
    assert.equal(classifyNotVerifiable(cause).route, "user-signoff", `${cause} must route to user-signoff`);
    assert.match(
      cflat,
      new RegExp(`\`${cause}\` → user sign-off`),
      `contract must bind ${cause} to user sign-off`,
    );
  }
  assert.match(cflat, /`ambiguous` → redefine with the `code-planner`/, "contract must route ambiguous to a planner redefine");
});

// AC-24 — divergence escalation, loop budget, separate churn counters.
test("AC-24 divergence escalates, budget counts agent calls + scanner minutes, churn is separate", async () => {
  // K10: fail-safe boundary inputs never throw and fail closed.
  assert.equal(isConverging("not-an-array"), false, "a malformed (non-array) history fails closed to non-converging");
  assert.equal(isConverging([{ Critical: 0, Major: 1 }]), true, "a single round (<2) cannot diverge");
  assert.deepEqual(openCriticalMajorCounts(undefined), { Critical: 0, Major: 0, total: 0 });
  assert.equal(normalizeFindings("not-an-array").valid.length, 0, "non-array findings fail closed to no valid entries");
  assert.equal(normalizeFindings(null).invalid.length, 0, "non-array findings surface no invalid entries either");

  // KD-9: strictly-decreasing counts converge; non-decreasing after 2 rounds
  // diverges (not just rising).
  assert.equal(isConverging([{ Critical: 0, Major: 1 }, { Critical: 0, Major: 1 }, { Critical: 0, Major: 0 }]), true);
  assert.equal(isConverging([{ Critical: 0, Major: 1 }, { Critical: 1, Major: 1 }]), false, "a rising count diverges");
  // C4: untested non-decreasing branch.
  assert.equal(isConverging([{ Critical: 0, Major: 1 }, { Critical: 0, Major: 2 }]), false, "a non-decreasing count diverges");
  // C4: an actual updateLedger result feeds isConverging.
  const data = await fixture();
  const l1 = updateLedger({ version: 1, entries: {} }, data.rounds.round1, "r1", "all").ledger;
  const l2 = updateLedger(l1, data.rounds.round1, "r2", "all").ledger;
  assert.equal(isConverging([l1, l2]), false, "a held (non-decreasing) ledger count diverges");
  assert.equal(isConverging([l1, l1, updateLedger(l1, data.rounds.round3, "r3", "all").ledger]), true, "a strictly decreasing ledger series converges");

  // A7/H5/K2: typed budget = agent calls + scanner minutes, calibrated to the
  // ≤2 outer-pass cap given one agent-call per subagent delegation (~9 per
  // pass: scanner + five reviewers + code-reviewer + coder + verifier) and
  // scanner minutes summed from the five scan legs' own durations. The
  // agent-call cap is strictly ABOVE the nominal two-pass total so it acts as an
  // independent overflow backstop rather than firing at the same instant as the
  // pass cap (K2).
  assert.equal(DEFAULT_LOOP_BUDGET.maxOuterPasses, 2);
  const NOMINAL_CALLS_PER_PASS = 9;
  assert.ok(
    DEFAULT_LOOP_BUDGET.agentCalls > NOMINAL_CALLS_PER_PASS * DEFAULT_LOOP_BUDGET.maxOuterPasses,
    "agentCalls must sit strictly above the nominal per-pass delegation count × the ≤2-pass cap, not equal it",
  );
  assert.equal(DEFAULT_LOOP_BUDGET.agentCalls, 19);
  assert.ok(DEFAULT_LOOP_BUDGET.scannerMinutes >= DEFAULT_LOOP_BUDGET.maxOuterPasses, "scannerMinutes must cover the ≤2-pass cap");
  assert.equal(DEFAULT_LOOP_BUDGET.scannerMinutes, 30);
  assert.equal(shouldEscalate({ passes: 2 }), true, "the default ≤2 outer-pass cap escalates");
  assert.equal(shouldEscalate({ passes: 1 }), false, "below the cap does not escalate");
  // K2: at one pass, the two-pass delegation count is NOT yet an overflow; the
  // backstop fires only once the counters pass the nominal two-pass total.
  assert.equal(shouldEscalate({ passes: 1, spent: { agentCalls: NOMINAL_CALLS_PER_PASS * DEFAULT_LOOP_BUDGET.maxOuterPasses } }), false, "the nominal two-pass delegation count is not yet an overflow");
  assert.equal(shouldEscalate({ passes: 1, spent: { agentCalls: 14 } }), false, "14 calls (the old nominal count) no longer trips the backstop");
  assert.equal(shouldEscalate({ passes: 1, spent: { agentCalls: 19 } }), true, "agent-call budget exhausts independently above the nominal two-pass total");
  // K1: an unmeasured counter falls back to 0, never to the pass count (which
  // would trip the budget a pass early).
  assert.equal(shouldEscalate({ passes: 1 }), false, "an unreported spend counter must not be read as one pass of spend");
  assert.equal(shouldEscalate({ passes: 1, spent: { scannerMinutes: 30 } }), true, "scanner-minute budget exhausts independently");
  assert.equal(shouldEscalate({ passes: 1, budget: { maxOuterPasses: 5, agentCalls: 99, scannerMinutes: 99 }, spent: { agentCalls: 2, scannerMinutes: 2 } }), false);
  assert.equal(shouldEscalate({ passes: 1, nonConvergentRounds: 2, divergenceThreshold: 2 }), true);
  assert.equal(shouldEscalate({ passes: 1, nonConvergentRounds: 1, divergenceThreshold: 2 }), false);
  assert.equal(shouldEscalate({ passes: 0, regressionRounds: 2, maxRegressions: 2 }), true, "two regressions escalate");
  assert.equal(shouldEscalate({ passes: 0, designConflictReissues: 2, maxDesignConflictReissues: 2 }), true, "repeated conflicts escalate");
  // G5: a null/malformed budget or spent object must not throw; it normalizes
  // to the default budget and zero spend.
  assert.equal(shouldEscalate({ passes: 1, budget: null, spent: null }), false, "null budget/spent normalizes, never throws");
  assert.equal(shouldEscalate({ passes: 1, budget: "bogus", spent: 7 }), false, "non-object malformed budget/spent normalizes");
  // I10a: a held nonzero count is non-decreasing, so it does not converge.
  assert.equal(isConverging([{ Critical: 0, Major: 0 }, { Critical: 0, Major: 0 }]), false, "a held zero count is non-decreasing and diverges");
  // I10a: a missing count field still fails closed rather than being read as 0.
  assert.equal(isConverging([{ Critical: 0 }, { Critical: 0 }]), false, "a missing Major count fails closed to non-converging");

  const orchestrator = await readFile(path.join(root, "agent/code-orchestrator.md"), "utf8");
  assert.match(orchestrator, /agent calls \+ scanner minutes/, "loop budget must sum agent calls and scanner minutes");
  assert.match(orchestrator, /Separate churn counters/);
  assert.match(orchestrator, /never sum them/, "churn counters must never be summed");
  assert.match(orchestrator, /does not strictly decrease/, "orchestrator must state the KD-9 non-decreasing rule");
  // F4: the typed budget is wired end-to-end — counters and the accumulated
  // state object are defined, and shouldEscalate gates the next pass.
  assert.match(orchestrator, /spent\.agentCalls/, "orchestrator must define the agentCalls counter");
  assert.match(orchestrator, /spent\.scannerMinutes/, "orchestrator must define the scannerMinutes counter");
  assert.match(orchestrator, /nonConvergentRounds/, "orchestrator must define the accumulated state object");
  assert.match(orchestrator, /shouldEscalate\(state\)/, "orchestrator must call shouldEscalate(state) before looping");
  assert.match(orchestrator, /advisory only — enforced by the loop, not a runtime/, "orchestrator must state shouldEscalate is enforced by the loop, not a runtime");
  // H5/I1: the scanner returns per-leg timing so scannerMinutes is measured,
  // and the verifier returns the frozen raw payload alongside the digest.
  const scanner = await readFile(path.join(root, "agent/code-security-scanner.md"), "utf8");
  assert.match(scanner, /started_at[\s\S]{0,80}finished_at/, "scanner must report per-leg start/stop so scannerMinutes is measured");
  assert.match(scanner, /duration/i, "scanner must report a per-leg duration");
  assert.match(scanner, /scannerMinutes/, "scanner must name the scannerMinutes accumulator");
  const verifier = await readFile(path.join(root, "agent/verifier.md"), "utf8");
  assert.match(verifier, /frozen raw payload/, "verifier must return the frozen raw payload alongside the digest");
  assert.match(verifier, /git status --porcelain[\s\S]{0,80}git diff HEAD/, "the frozen payload must be the porcelain listing plus the diff");
  // I2: the regression and design-conflict counters have stated increment rules.
  assert.match(orchestrator, /regressionRounds[\s\S]{0,200}regressed/, "orchestrator must state the regressionRounds increment rule");
  assert.match(orchestrator, /designConflictReissues[\s\S]{0,200}re-issue/i, "orchestrator must state the designConflictReissues increment rule");
  // I4: the pruned baseline write-back is assigned to a write-capable leg.
  assert.match(orchestrator, /pruneBaseline[\s\S]{0,400}coder/, "orchestrator must assign the pruned-baseline write-back to the coder");
  // B7: loop-budget defaults are single-sourced and aligned across spec,
  // orchestrator, and module (all ≤2 outer passes).
  assert.match(orchestrator, /outer-pass cap is \*\*2\*\*/, "orchestrator must state the ≤2 outer-pass cap");
  const spec = await readFile(path.join(root, "docs/ai-agent-pipeline.md"), "utf8");
  assert.match(spec, /DEFAULT_LOOP_BUDGET/, "spec must name the single-sourced budget constant");
  assert.match(spec, /≤ 2[\s\S]{0,20}outer-pass cap/, "spec must state the ≤2 outer-pass cap aligned with the module");
  assert.match(spec, /shouldEscalate\(state\)/, "spec must name the shouldEscalate gate");
  assert.match(spec, /advisory only[\s\S]{0,40}enforced by the loop, not a runtime/, "spec must state the budget check is enforced by the loop, not a runtime");
});

// AC-25 — freeze-diff to all reviewers + cheap-first ordering.
test("AC-25 reviewed_sha is frozen for all reviewers and verifier ordering is cheap-first", async () => {
  for (const relativePath of REVIEWERS) {
    const body = await bodyOf(relativePath);
    assert.match(body, /reviewed_sha/, `${relativePath}: must receive the frozen SHA`);
    assert.match(body, /git rev-parse HEAD/, `${relativePath}: must receive HEAD as auxiliary`);
    // F3: the freeze check must use tools the reviewer actually has — the
    // content comparison via `git status --porcelain -uall` + `git diff HEAD`
    // plus every untracked file's content, not a hashing utility the allowlist
    // excludes. J1: the payload must include untracked content, and `-uall`
    // stops `--porcelain` from collapsing a new directory to one path.
    assert.match(
      body,
      /compar\w+ the byte output of `git status --porcelain -uall` plus `git diff HEAD` plus every untracked file's content/,
      `${relativePath}: freeze check must compare the untracked-covering git output, not a hash`,
    );
    // I1: the comparison anchor is a returned value (the frozen raw payload),
    // not a procedure the reviewer cannot perform.
    assert.match(body, /frozen raw payload the orchestrator passes/, `${relativePath}: must byte-compare against the frozen raw payload`);
    assert.match(body, /`git status --porcelain -uall` plus `git diff HEAD`/, `${relativePath}: must name the untracked-covering frozen payload bytes`);
    assert.match(body, /every untracked file's content/, `${relativePath}: the frozen payload must cover untracked-file content (J1)`);
    assert.doesNotMatch(body, /`git status --porcelain` plus `git diff HEAD`/, `${relativePath}: the freeze must not fall back to the untracked-blind porcelain listing`);
  }
  const verifier = await readFile(path.join(root, "agent/verifier.md"), "utf8");
  assert.match(verifier, /reviewed_sha/, "verifier must return reviewed_sha");
  const testIdx = verifier.indexOf("Order the cheap legs");
  assert.ok(testIdx >= 0, "verifier must state cheap-first ordering");
  const ordering = verifier.slice(testIdx, testIdx + 200);
  assert.match(ordering, /test, then lint, then format-check, then typecheck/);

  const orchestrator = await readFile(path.join(root, "agent/code-orchestrator.md"), "utf8");
  assert.match(orchestrator, /freeze\*\*/);
  // B4: the freeze must be a content digest of the uncommitted artifact, with
  // HEAD kept as auxiliary — `rev-parse HEAD` alone is vacuous while Stage 5
  // edits are uncommitted.
  // J1: the digest and payload must include untracked-file content and use
  // `git status --porcelain -uall` so a new directory is not collapsed to one
  // path and an untracked Stage 5 artifact cannot move post-freeze unseen.
  assert.match(orchestrator, /reviewed_sha` = content digest of `git status --porcelain -uall` plus `git diff HEAD`\s+plus every untracked file's content/);
  assert.match(orchestrator, /auxiliary `git rev-parse HEAD`/);
  // K7: the orchestrator's freeze prose pins the read-only hash-object forms and
  // denies the write-capable `-w`, matching the verifier-side precedence test.
  const flatOrchestratorFreeze = orchestrator.replace(/\s+/g, " ");
  assert.match(
    flatOrchestratorFreeze,
    /read-only `git hash-object --stdin` \(or `--stdin --no-filters`\)/,
    "orchestrator must pin the read-only hash-object forms",
  );
  assert.match(
    flatOrchestratorFreeze,
    /never the write-capable `-w` form/,
    "orchestrator must deny the write-capable -w form",
  );
});

// AC-26 — spec + contract updated; AC-11 amended; no renumbering.
test("AC-26 spec and contract are updated with AC-11 amended in place and no renumbering", async () => {
  const spec = await readFile(path.join(root, "docs/ai-agent-pipeline.md"), "utf8");
  assert.match(spec, /AC-11 \(amended in place\)/);
  assert.match(spec, /AC-12 finding schema normative/);
  assert.match(spec, /AC-28 no secret material introduced/);
  assert.match(spec, /freezes `reviewed_sha`/);
  assert.match(spec, /fingerprint` only, normalized/);
  assert.match(spec, /agent calls \+ scanner minutes/);
  assert.match(spec, /secret-incident halt/);
  assert.match(spec, /AC-01\.\.AC-28 stable/);
  assert.match(spec, /amend(ed)? \*\*in place\*\* under the same ID/);

  const ids = new Set([...spec.matchAll(/AC-(\d{2})/g)].map((match) => Number(match[1])));
  for (let n = 1; n <= 28; n += 1) {
    assert.ok(ids.has(n), `AC-${String(n).padStart(2, "0")} must survive in the spec`);
  }
  assert.ok(!ids.has(29) && !ids.has(0), "only AC-01..AC-28 exist — no renumbering or drift");
  // C8: the highest ID really is 28 (no drift upward).
  assert.equal(Math.max(...ids), 28, "AC-28 must be the highest criterion ID");
  const contract = await readFile(path.join(root, "agent/delegation-contract.md"), "utf8");
  assert.match(contract, /agent\/finding-schema\.md/);
  assert.match(contract, /docs\/review-baseline\.json/);
  assert.match(contract, /"version": 1/);
  assert.match(contract, /incident path/);
  assert.match(contract, /not-verifiable.*classified/s);
  // C8: anchor the seven contract fields to the contract's field list (the
  // block right after the intro), not just "the word appears somewhere".
  const contractFieldsSection = contract.slice(
    contract.indexOf("- **Goal**"),
    contract.indexOf("- **Risks/ambiguities**") + "- **Risks/ambiguities**".length,
  );
  for (const field of ["Goal", "Scope", "Constraints", "Inputs", "Expected output", "Completion criteria", "Risks/ambiguities"]) {
    assert.ok(contractFieldsSection.includes(`- **${field}**`), `contract field list must keep - **${field}**`);
  }
  assert.match(contract, /## Deferred roadmap and non-goals/);
});

// M9 — branch coverage for scope alias, prune array source, evidence arrays,
// the severity floor, nextState fallback, and warnings.
test("M9 reportedCategoryScope honors the categories alias and pruneBaseline handles array sources", async () => {
  const data = await fixture();
  const seed = () =>
    updateLedger({ version: 1, entries: {} }, data.rounds.round2, "r2", "all").ledger;

  // The `{categories: [...]}` alias is a recognized scope (only style fixes).
  const aliased = updateLedger(seed(), [], "r3", { categories: ["style"] });
  assert.equal(aliased.ledger.entries["style/STYLE-1/src/f.ts#-"].state, "fixed");
  assert.equal(aliased.ledger.entries["security/SEC-1/src/a.ts#findUser"].state, "open");
  assert.equal(aliased.warnings.length, 0, "the categories alias is recognized, not warned");

  const now = "2026-01-01T00:00:00.000Z";
  // Array source: expired drops, invalid expiry retains, non-object gets a
  // generated key and a warning.
  const prunedArray = pruneBaseline(
    [
      { fingerprint: "dependency/OSV-1/src/g.ts#-", severity: "Minor", expires: "2020-01-01T00:00:00.000Z" },
      { fingerprint: "dependency/OSV-2/src/g.ts#-", severity: "Minor" },
      "junk",
    ],
    now,
  );
  assert.deepEqual(
    Object.keys(prunedArray.entries).sort(),
    ["dependency/OSV-2/src/g.ts#-", "invalid-entry-1"],
    "the expired entry drops; the invalid-expiry and non-object entries are retained",
  );
  assert.equal(prunedArray.entries["invalid-entry-1"], "junk", "the non-object entry keeps its value under a generated key");
  assert.equal(prunedArray.warnings.length, 2, "one invalid-expiry warning plus one non-object warning");
  assert.ok(prunedArray.warnings.some((warning) => /missing\/malformed expiry/.test(warning)));
  assert.ok(prunedArray.warnings.some((warning) => /non-object entry/.test(warning)));

  // Exact warning count for the mixed object case.
  const mixed = pruneBaseline(
    { version: 1, entries: { bad: null, "dependency/OSV-3/src/g.ts#-": { severity: "Minor" } } },
    now,
  );
  assert.equal(mixed.warnings.length, 2, "the mixed case emits exactly two warnings");
});

test("M9 hasEvidence handles array-valued evidence and the Major severity floor holds", async () => {
  const base = {
    rule_id: "SEC-8",
    category: "security",
    file: "src/n.ts",
    line: 1,
    symbol: "",
    cwe: "",
    root_cause_key: "no-proof",
    fingerprint: "security/SEC-8/src/n.ts#-",
    severity: "Major",
  };
  const arrayEvidence = mergeFindings([{ ...base, evidence: ["code citation src/n.ts:1"] }]);
  assert.equal(arrayEvidence[0].severity, "Major", "a non-empty array evidence keeps the severity");
  const emptyArrayEvidence = mergeFindings([{ ...base, evidence: [""] }]);
  assert.equal(emptyArrayEvidence[0].severity, "Nit", "an empty array evidence auto-downgrades to Nit");

  // The severity floor covers Major too, not only Critical.
  const now = "2026-01-01T00:00:00.000Z";
  const majorFinding = { ...base, severity: "Major" };
  const majorBaseline = {
    version: 1,
    entries: {
      "security/SEC-8/src/n.ts#-": {
        fingerprint: "security/SEC-8/src/n.ts#-",
        severity: "Major",
        expires: "2999-01-01T00:00:00.000Z",
        touched: false,
        approved_by: "user",
      },
    },
  };
  const flooredMajor = baselineMatch(majorFinding, majorBaseline, now);
  assert.equal(flooredMajor.matched, false, "a baselined Major must stay unsuppressed");
  assert.equal(flooredMajor.reason, "non-suppressible");
});

test("M9 nextState falls back to open for an unknown prior state", async () => {
  const data = await fixture();
  const finding = { ...data.rounds.round1[0] };
  const seeded = {
    version: 1,
    round: 1,
    entries: {
      [finding.fingerprint]: { state: "bogus", category: finding.category, fingerprint: finding.fingerprint },
    },
  };
  const { ledger } = updateLedger(seeded, [finding], "r2", "all");
  assert.equal(ledger.entries[finding.fingerprint].state, "open", "an unknown prior state falls back to open");
});

// M3/M4/M5/M6/M8/M10/M11 — reliability and safety of the arbiter helpers.
test("M3/M4/M5/M6/M8/M10/M11 arbiter hardens against polling, NaN, and malformed entries", async () => {
  const data = await fixture();
  const now = "2026-01-01T00:00:00.000Z";

  // M3: a `__proto__` fingerprint key survives as an own data property and does
  // not pollute the prototype.
  const protoSource = JSON.parse('{"__proto__":{"state":"open","category":"security","fingerprint":"__proto__"}}');
  const cloned = updateLedger({ version: 1, entries: protoSource }, [], "r1", "all").ledger;
  assert.ok(Object.prototype.hasOwnProperty.call(cloned.entries, "__proto__"), "the __proto__ key must survive");
  assert.equal(Object.getPrototypeOf(cloned.entries), Object.prototype, "the entries prototype must stay clean");
  const prunedProto = pruneBaseline(protoSource, now);
  assert.ok(Object.prototype.hasOwnProperty.call(prunedProto.entries, "__proto__"), "pruneBaseline must not drop a __proto__ key");
  assert.equal(Object.getPrototypeOf(prunedProto.entries), Object.prototype);

  // M11: cloneLedger preserves ledger top-level fields beyond version/round/entries.
  const withExtra = { version: 1, round: 0, entries: {}, note: "keep-me" };
  assert.equal(updateLedger(withExtra, [], "r1", "all").ledger.note, "keep-me", "unknown top-level fields survive a clone");

  // M4: a missing/non-string entry severity fails closed.
  const key = "dependency/OSV-1/src/g.ts#-";
  const noSeverity = baselineMatch(
    data.baseline.hit.finding,
    { version: 1, entries: { [key]: { fingerprint: key, expires: "2999-01-01T00:00:00.000Z", touched: false, approved_by: "user" } } },
    now,
  );
  assert.equal(noSeverity.matched, false, "an entry without severity must not suppress");
  assert.equal(noSeverity.reason, "invalid-entry");

  // M5: a non-object ledger entry is skipped, not dereferenced, and the
  // skipped count surfaces it so a corrupt entry cannot silently lower the
  // open count. The legacy shape stays unchanged for existing callers.
  assert.deepEqual(
    openCriticalMajorCounts({
      entries: {
        nul: null,
        prim: "not-an-object",
        major: { state: "open", severity: "Major" },
        critical: { state: "open", severity: "Critical" },
      },
    }),
    { Critical: 1, Major: 1, total: 2 },
    "non-object entries are skipped without throwing",
  );
  assert.deepEqual(
    openCriticalMajorCountsDetailed({
      entries: {
        nul: null,
        prim: "not-an-object",
        major: { state: "open", severity: "Major" },
        critical: { state: "open", severity: "Critical" },
      },
    }),
    { Critical: 1, Major: 1, total: 2, skipped: 2 },
    "the skipped count surfaces the two non-object entries",
  );

  // M6: NaN/non-numeric counters are treated as unmeasured (0), not as spend.
  assert.equal(shouldEscalate({ passes: 1, spent: { agentCalls: NaN } }), false, "NaN agentCalls must not trip the budget");
  assert.equal(shouldEscalate({ passes: 1, spent: { scannerMinutes: NaN } }), false, "NaN scannerMinutes must not trip the budget");
  assert.equal(shouldEscalate({ passes: 1, spent: { agentCalls: "many" } }), false, "non-numeric agentCalls must not trip the budget");
  // Q3: an explicit null (or other non-object) state must fail closed to "do
  // not escalate" instead of throwing at destructuring.
  assert.equal(shouldEscalate(null), false, "an explicit null state must not throw");
  assert.equal(shouldEscalate([]), false, "an array state fails closed without throwing");
  assert.equal(shouldEscalate("bogus"), false, "a primitive state fails closed without throwing");

  // M8: an object-shaped key miss is definitive — a value carrying the
  // fingerprint under a foreign key is not scanned.
  const foreignKey = {
    version: 1,
    entries: {
      "wrong-key": {
        fingerprint: key,
        severity: "Minor",
        expires: "2999-01-01T00:00:00.000Z",
        touched: false,
        approved_by: "user",
      },
    },
  };
  assert.equal(baselineMatch(data.baseline.hit.finding, foreignKey, now).reason, "no-baseline-entry");

  // M10: `incident: true` on a non-secret finding is invalid.
  const nonSecretIncident = {
    rule_id: "SEC-3",
    category: "security",
    file: "src/p.ts",
    line: 1,
    symbol: "",
    cwe: "",
    root_cause_key: "incident-abuse",
    fingerprint: "security/SEC-3/src/p.ts#-",
    severity: "Major",
    evidence: "code citation src/p.ts:1",
    incident: true,
  };
  assert.ok(
    validateFinding(nonSecretIncident).some((error) => error.includes("incident: true is only valid for a secret")),
    "a non-secret incident claim must be rejected",
  );
});

// N1 — a non-array findings payload fails closed: prior states survive and a
// warning is surfaced, never a false convergence.
test("N1 updateLedger fails closed on a non-array findings payload", async () => {
  const data = await fixture();
  const seed = updateLedger({ version: 1, entries: {} }, data.rounds.round2, "r2", "all").ledger;
  const result = updateLedger(seed, "not-an-array", "r3", "all");
  assert.equal(result.ledger.entries["style/STYLE-1/src/f.ts#-"].state, "open", "a prior open entry must stay open");
  assert.equal(result.ledger.entries["security/SEC-1/src/a.ts#findUser"].state, "open", "a prior open entry must stay open");
  assert.deepEqual(openCriticalMajorCounts(result.ledger), { Critical: 0, Major: 1, total: 1 }, "the open Major must not be falsely resolved");
  // P6: a failed update must not advance the round counter — otherwise a
  // rejected payload silently consumes loop budget across retries.
  assert.equal(result.ledger.round, seed.round, "a non-array payload must not advance the round counter");
  assert.equal(result.warnings.length, 1, "a non-array payload must surface a warning");
  assert.match(result.warnings[0], /not an array; nothing marked fixed/, "the warning must state nothing was marked fixed");
});

// N2 — a non-object ledger entry routed through updateLedger is skipped with a
// warning instead of throwing in strict mode, and its value survives.
test("N2 updateLedger skips a null/primitive entry and warns instead of throwing", () => {
  const seed = {
    version: 1,
    round: 1,
    entries: {
      nul: null,
      prim: "junk",
      real: { state: "open", category: "style", severity: "Minor", fingerprint: "style/X/src/f.ts#-" },
    },
  };
  const { ledger, warnings } = updateLedger(seed, [], "r2", { reportedCategories: ["style"] });
  assert.equal(ledger.entries.nul, null, "a null entry must survive untouched");
  assert.equal(ledger.entries.prim, "junk", "a primitive entry must survive untouched");
  assert.equal(ledger.entries.real.state, "fixed", "the object entry still transitions normally");
  assert.equal(warnings.length, 2, "each skipped non-object entry must warn");
  assert.ok(warnings.every((warning) => /skipped non-object entry/.test(warning)), "the warning must name the skipped entry");
});

// N2b — a non-numeric ledger `round` is coerced to 0 rather than concatenated.
test("N2b updateLedger coerces a non-numeric round instead of concatenating", () => {
  const { ledger } = updateLedger({ version: 1, round: "oops", entries: {} }, [], "r1", "all");
  assert.equal(ledger.round, 1, "a non-numeric round must be coerced to 0 then incremented");
});

// M2 — classifyNotVerifiable fails closed for inherited property names.
test("M2 classifyNotVerifiable fails closed for inherited key names", () => {
  for (const inherited of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    assert.equal(classifyNotVerifiable(inherited), null, `inherited name ${inherited} must not return a bogus route`);
  }
});

// M3 — a missing/unparseable fenced block: the orchestrator surfaces a
// synthetic Major and refuses to treat the absence as zero findings. The two
// stable substrings are asserted after whitespace flattening, rather than via a
// fixed character-distance window that can silently drift out of range (P10b).
test("M3 an absent or unparseable fenced JSON block is surfaced as a synthetic Major", async () => {
  for (const relativePath of ["agent/code-orchestrator.md", "agent/code-security-scanner.md"]) {
    const body = await readFile(path.join(root, relativePath), "utf8");
    const flat = body.replace(/\s+/g, " ");
    assert.match(flat, /absent or unparseable (fenced `json` block|block)/, `${relativePath}: must name the absent/unparseable block rule`);
    assert.match(flat, /malformed finding — needs review/, `${relativePath}: must surface the synthetic Major label`);
    assert.match(flat, /never treated as zero findings/, `${relativePath}: must refuse to treat a missing block as zero findings`);
  }
});

// N3b — the schema says evidence is mandatory in practice, not a validation failure.
test("N3b the schema states evidence auto-downgrades rather than rejecting", async () => {
  const schema = await readFile(path.join(root, "agent/finding-schema.md"), "utf8");
  const flat = schema.replace(/\s+/g, " ");
  assert.match(flat, /`evidence` is mandatory in practice/, "the schema must state evidence is mandatory in practice");
  assert.match(flat, /never a validation failure/, "the schema must state a missing evidence is not a validation failure");
});

// N4b — the spec header admits the test-time arbiter under `scripts/**`.
test("N4b the spec header admits the test-time arbiter and no application-runtime change", async () => {
  const spec = await readFile(path.join(root, "docs/ai-agent-pipeline.md"), "utf8");
  assert.match(spec, /No application-runtime changes/, "the header must state no application-runtime changes");
  assert.match(spec, /test-time arbiter module under `scripts\/\*\*`/, "the header must admit the scripts arbiter");
  assert.doesNotMatch(spec, /Review-only; no runtime\/code changes/, "the stale review-only header must be gone");
});

