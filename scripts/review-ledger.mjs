// Pure, dependency-free arbiter for the review-stage finding schema and ledger.
// Zero I/O, zero third-party deps; every function is deterministic and takes
// its own time input so callers can reproduce a run byte-for-byte.
//
// Canonical order (KD-5): schema-validate -> normalize severity -> group by
// fingerprint -> collapse at max severity -> ledger state.

export const FINDING_CATEGORIES = Object.freeze([
  "security",
  "performance",
  "best-practices",
  "reliability",
  "test-correctness",
  "dependency",
  "secret",
  "style",
]);

export const REQUIRED_FINDING_FIELDS = Object.freeze([
  "rule_id",
  "category",
  "file",
  "line",
  "symbol",
  "cwe",
  "root_cause_key",
  "fingerprint",
]);

// Required string fields that must be non-empty. `symbol` and `cwe` may be
// empty; `line` is the integer field validated separately. Derived from the
// single REQUIRED_FINDING_FIELDS list so the two never drift.
const REQUIRED_NONEMPTY_STRING_FIELDS = Object.freeze(
  REQUIRED_FINDING_FIELDS.filter((field) => field !== "symbol" && field !== "cwe" && field !== "line"),
);

export const SEVERITIES = Object.freeze(["Critical", "Major", "Minor", "Nit"]);

export const LEDGER_STATES = Object.freeze([
  "open",
  "fixed",
  "regressed",
  "recurring",
  "accepted",
]);

// A ledger state that still represents an unresolved finding: every state
// except `fixed` and `accepted`. Derived from LEDGER_STATES so this list can
// never drift from the closed enum (P8), and hoisted to module scope so the
// counting loop does not re-allocate it per entry. Module-private (never
// exported), so no `Object.freeze` is needed here; freezing a `Set` would be
// ineffective anyway because `.add()` still mutates it (Q7).
const OPEN_LEDGER_STATES = new Set(
  LEDGER_STATES.filter((state) => state !== "fixed" && state !== "accepted"),
);

export const NOT_VERIFIABLE_CAUSES = Object.freeze([
  "no-tooling",
  "external",
  "manual",
  "ambiguous",
]);

export const ROOT_CAUSE_KEY_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const SEVERITY_RANK = Object.freeze({ Critical: 4, Major: 3, Minor: 2, Nit: 1 });

const NOT_VERIFIABLE_ROUTES = Object.freeze({
  "no-tooling": Object.freeze({ route: "add-tooling", owner: "coder" }),
  external: Object.freeze({ route: "user-signoff", owner: "user" }),
  manual: Object.freeze({ route: "user-signoff", owner: "user" }),
  ambiguous: Object.freeze({ route: "redefine", owner: "planner" }),
});

export function severityRank(severity) {
  return SEVERITY_RANK[severity] ?? 0;
}

export function normalizeFile(file) {
  if (typeof file !== "string") return "";
  return file
    .replace(/\\/g, "/")
    .replace(/^(?:\.\/)+/, "")
    .replace(/^\/+/, "");
}

function sourcesOf(finding) {
  const raw = [
    ...(Array.isArray(finding?.sources) ? finding.sources : []),
    ...(typeof finding?.agent === "string" ? [finding.agent] : []),
  ];
  return [...new Set(raw.filter((source) => typeof source === "string" && source.trim()))].sort();
}

export function hasEvidence(finding) {
  const evidence = finding?.evidence;
  if (Array.isArray(evidence)) return evidence.some((entry) => typeof entry === "string" && entry.trim());
  return typeof evidence === "string" && evidence.trim() !== "";
}

// Percent-encode only the structural delimiters each component must not
// contain, so the common case (`security/SEC-1/src/a.ts#findUser`) is
// unchanged while a `file`/`rule_id` carrying `/` or `#` cannot collide with
// or steer onto another finding's fingerprint (KD-1).
function encodeFingerprintComponent(value, { allowSlash = false } = {}) {
  let encoded = String(value).replace(/%/g, "%25").replace(/#/g, "%23");
  if (!allowSlash) encoded = encoded.replace(/\//g, "%2F");
  return encoded;
}

export function fingerprint(finding) {
  const category = encodeFingerprintComponent(finding?.category ?? "");
  const ruleId = encodeFingerprintComponent(finding?.rule_id ?? "");
  // `file` legitimately contains `/` (it is a path); escape only `#` so the
  // `file#symbol` boundary stays unambiguous.
  const file = encodeFingerprintComponent(normalizeFile(finding?.file), { allowSlash: true });
  const symbol =
    typeof finding?.symbol === "string" && finding.symbol.trim() !== ""
      ? encodeFingerprintComponent(finding.symbol)
      : "-";
  return `${category}/${ruleId}/${file}#${symbol}`;
}

export function validateFinding(finding) {
  if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
    return ["finding must be an object"];
  }
  const errors = new Set();
  for (const field of REQUIRED_FINDING_FIELDS) {
    const value = finding[field];
    if (value === undefined || value === null) {
      errors.add(`missing required field: ${field}`);
    }
  }
  // `symbol` and `cwe` may be empty (symbol normalizes to `-`); `line` is the
  // integer field validated below. Every other identity-bearing string field
  // must be present and non-empty. The set derives from REQUIRED_FINDING_FIELDS
  // so the two lists cannot drift.
  for (const field of REQUIRED_NONEMPTY_STRING_FIELDS) {
    const value = finding[field];
    if (value === undefined || value === null) continue; // already reported missing
    if (typeof value !== "string" || value.trim() === "") {
      errors.add(`empty required field: ${field}`);
    }
  }
  if (finding.symbol !== null && finding.symbol !== undefined && typeof finding.symbol !== "string") {
    errors.add("invalid symbol (must be a string)");
  }
  if (finding.cwe !== null && finding.cwe !== undefined && typeof finding.cwe !== "string") {
    errors.add("invalid cwe (must be a string)");
  }
  if (!FINDING_CATEGORIES.includes(finding.category)) {
    errors.add("invalid category (not in the closed enum)");
  }
  // Severity is required: a missing value fails the closed-set check.
  if (!SEVERITIES.includes(finding.severity)) {
    errors.add("invalid severity (not in the closed set)");
  }
  if (
    typeof finding.root_cause_key === "string" &&
    !ROOT_CAUSE_KEY_PATTERN.test(finding.root_cause_key)
  ) {
    errors.add("invalid root_cause_key (must match the slug grammar)");
  }
  if (finding.line !== null && finding.line !== undefined) {
    if (!Number.isInteger(finding.line) || finding.line < 1) {
      errors.add("invalid line (must be an integer >= 1)");
    }
  }
  if (finding.fingerprint !== undefined && finding.fingerprint !== null && finding.fingerprint !== fingerprint(finding)) {
    errors.add("fingerprint does not match the canonical formula");
  }
  // Any secret finding, at any severity, must carry the incident marker so the
  // orchestrator routes it to the incident path instead of the coder fix loop
  // (KD-10). Requiring it only for Critical secrets let a Major/Minor secret
  // slip into the coder loop.
  if (finding.category === "secret" && finding.incident !== true) {
    errors.add("secret finding must set incident: true");
  }
  // `incident: true` is reserved for secrets: a non-secret cannot claim the
  // un-downgradable incident path to escape evidence-else-Nit.
  if (finding.category !== "secret" && finding.incident === true) {
    errors.add("incident: true is only valid for a secret finding");
  }
  return [...errors];
}

function normalizeSeverity(finding) {
  const evidence = hasEvidence(finding);
  // A secret or incident finding is never downgraded: it must stay blocking
  // and take the incident path regardless of evidence (KD-10). `category ===
  // "secret"` already implies `incident` for every schema-valid finding
  // (validateFinding enforces it), and a synthetic malformed finding carries
  // `incident: false`, so the former `|| finding.incident === true` disjunct was
  // redundant (P11b).
  const incident = finding.category === "secret";
  const severity = evidence || incident ? finding.severity : "Nit";
  return {
    ...finding,
    file: normalizeFile(finding.file),
    severity,
    incident,
    evidence_present: evidence,
    fingerprint: fingerprint(finding),
  };
}

// Redacted projection of a schema-invalid finding for surfacing/logging: it
// carries only the fingerprint-bearing identity fields (`category`, `rule_id`,
// `file`, `symbol`) plus `line` metadata and the validation errors, and drops
// the free-text/evidence fields (`evidence`, `cwe`, `root_cause_key`, and any
// other value). The source may carry a secret in `evidence` or another
// free-text field, so `invalid[].finding` is the safe subset to log (P5). Note
// the identity fields themselves are retained verbatim — this projection
// redacts free-text fields, it does not sanitize the values it keeps.
// `malformedFinding` reads only these fields, so the projection round-trips
// through it unchanged.
const INVALID_IDENTITY_FIELDS = Object.freeze(["category", "rule_id", "file", "symbol", "line"]);

function invalidProjection(finding, errors) {
  const base = finding && typeof finding === "object" && !Array.isArray(finding) ? finding : {};
  const projection = {};
  for (const field of INVALID_IDENTITY_FIELDS) {
    const value = base[field];
    if (value === undefined || value === null) continue;
    projection[field] = value;
  }
  return { finding: projection, errors };
}

// Splits findings into schema-valid (normalized) and schema-invalid entries.
// Invalid findings are never silently dropped: the caller surfaces them so the
// orchestrator can treat them as a blocking/escalation event (KD-5). Each
// invalid entry is a redacted projection, not the raw source object (P5).
export function normalizeFindings(findings) {
  if (!Array.isArray(findings)) return { valid: [], invalid: [] };
  const valid = [];
  const invalid = [];
  for (const finding of findings) {
    const errors = validateFinding(finding);
    if (errors.length === 0) {
      valid.push(normalizeSeverity(finding));
    } else {
      invalid.push(invalidProjection(finding, errors));
    }
  }
  return { valid, invalid };
}

// Turns a schema-invalid finding into a visible synthetic Major finding so a
// malformed Critical cannot silently vanish (KD-5). The synthetic carries the
// validation errors as its evidence and a `malformed-` rule id so it can never
// collide with a real rule's fingerprint. `ordinal` (the invalid entry's
// 1-based position) is appended to the rule id so two invalid entries that both
// lack a usable `rule_id` surface as distinct fingerprints (`malformed-unknown-1`,
// `-2`) instead of collapsing into one and hiding the other (P3).
function malformedFinding(finding, errors, ordinal) {
  const base = finding && typeof finding === "object" && !Array.isArray(finding) ? finding : {};
  const category = FINDING_CATEGORIES.includes(base.category) ? base.category : "best-practices";
  const ruleId = typeof base.rule_id === "string" && base.rule_id ? base.rule_id : "unknown";
  return {
    ...base,
    rule_id: `malformed-${ruleId}-${ordinal}`,
    category,
    file: normalizeFile(base.file),
    symbol: typeof base.symbol === "string" ? base.symbol : "",
    cwe: typeof base.cwe === "string" ? base.cwe : "",
    root_cause_key: base.root_cause_key,
    severity: "Major",
    incident: false,
    evidence: `malformed finding — needs review: ${errors.join("; ")}`,
    sources: ["review-ledger"],
  };
}

// Merge keyed on fingerprint only. Same-line findings in different categories
// stay separate because category is part of the fingerprint; exact duplicates
// across agents collapse to one entry at the maximum normalized severity.
export function mergeFindings(findings) {
  const { valid, invalid } = normalizeFindings(findings);
  const malformed = invalid.map(({ finding, errors }, index) =>
    normalizeSeverity(malformedFinding(finding, errors, index + 1)),
  );
  const groups = new Map();
  for (const finding of [...valid, ...malformed]) {
    const key = finding.fingerprint;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...finding, sources: sourcesOf(finding) });
      continue;
    }
    const severity =
      severityRank(finding.severity) > severityRank(existing.severity)
        ? finding.severity
        : existing.severity;
    const existingHasEvidence = hasEvidence(existing);
    const findingHasEvidence = hasEvidence(finding);
    // Prefer the evidence-bearing duplicate's `evidence` and recompute
    // `evidence_present` so a max-severity entry never loses its proof.
    const evidence = findingHasEvidence && !existingHasEvidence
      ? finding.evidence
      : existingHasEvidence
        ? existing.evidence
        : finding.evidence;
    groups.set(key, {
      ...existing,
      severity,
      sources: [...new Set([...existing.sources, ...sourcesOf(finding)])].sort(),
      evidence,
      evidence_present: existingHasEvidence || findingHasEvidence,
      incident: existing.incident === true || finding.incident === true,
    });
  }
  return [...groups.values()].sort((a, b) => (a.fingerprint === b.fingerprint ? 0 : a.fingerprint < b.fingerprint ? -1 : 1));
}

// Assign through `Object.defineProperty` so a fingerprint of `__proto__`
// becomes an own data property instead of silently rewriting the object's
// prototype (prototype-pollution guard). `constructor`/`prototype` are also
// safe as own properties, but defining every key uniformly keeps this the
// single write path.
function safeSet(map, key, value) {
  Object.defineProperty(map, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

function cloneLedger(ledger) {
  const entries = {};
  for (const [key, value] of Object.entries(ledger?.entries ?? {})) {
    if (!value || typeof value !== "object") {
      safeSet(entries, key, value);
      continue;
    }
    // Copy nested arrays so the clone never aliases the source ledger.
    safeSet(entries, key, {
      ...value,
      sources: Array.isArray(value.sources) ? [...value.sources] : value.sources,
      touched_files: Array.isArray(value.touched_files) ? [...value.touched_files] : value.touched_files,
    });
  }
  // Spread the source first so top-level fields other than the three known
  // ones survive a clone (M11) instead of being silently dropped.
  return {
    ...ledger,
    version: ledger?.version ?? 1,
    round: ledger?.round ?? 0,
    entries,
  };
}

function nextState(previous) {
  if (!previous) return "open";
  if (previous.state === "accepted") return "accepted";
  if (previous.state === "open" || previous.state === "recurring") return "recurring";
  if (previous.state === "regressed" || previous.state === "fixed") return "regressed";
  return "open";
}

// Accepts the ledger's round scope as a Set/array of reported categories, an
// object carrying `reportedCategories`/`categories`, or the explicit sentinel
// `"all"`. The returned object carries the reported Set (or `null` for the
// `"all"` sentinel) plus a `warning` naming any malformed scope. An omitted
// scope (`undefined`/`null`) returns `UNRECOGNIZED_SCOPE` so the Stage 5 path
// fails closed (marks nothing `fixed`) instead of silently treating omission as
// "all categories reported" (F1/F2); the legacy full-lens caller must now opt in
// with `"all"`.
const UNRECOGNIZED_SCOPE = Symbol("unrecognized-scope");

function reportedCategoryScope(scope) {
  if (scope === "all") return { reported: null, warning: null };
  if (scope === undefined || scope === null) {
    return { reported: UNRECOGNIZED_SCOPE, warning: "scope omitted: nothing marked fixed" };
  }
  if (scope instanceof Set) return { reported: scope, warning: null };
  const list = Array.isArray(scope)
    ? scope
    : Array.isArray(scope.reportedCategories)
      ? scope.reportedCategories
      : Array.isArray(scope.categories)
        ? scope.categories
        : null;
  if (!list) {
    let shape;
    try {
      shape = JSON.stringify(scope);
    } catch {
      shape = String(scope);
    }
    return { reported: UNRECOGNIZED_SCOPE, warning: `unrecognized ledger scope: ${shape}` };
  }
  return { reported: new Set(list), warning: null };
}

// Advances the ledger one round. `now` is stamped onto entries verbatim;
// transitions do not read it. `scope` names the categories/lenses that
// actually reported this round: only fingerprints in a reported category may
// transition to `fixed`, so a tiered re-verify that skips a category cannot
// falsely mark its still-open findings resolved (A6). The explicit sentinel
// `"all"` opts into "every category reported"; an omitted or malformed scope
// fails closed (marks nothing `fixed`) and is surfaced as `warnings` so the
// orchestrator can log a bad scope instead of silently treating it as "all"
// (F1/F2). Returns `{ ledger, warnings }`.
export function updateLedger(ledger, findings, now, scope) {
  const next = cloneLedger(ledger);
  // A non-array payload is a caller error, not "zero findings": fail closed so
  // every prior state survives instead of resolving the whole ledger to fixed.
  // The round counter is not advanced either, so a failed update cannot silently
  // consume loop budget (P6).
  if (!Array.isArray(findings)) {
    return { ledger: next, warnings: ["findings is not an array; nothing marked fixed"] };
  }
  // `Number(next.round)` accepts a numeric string as well as a number; a
  // genuinely non-numeric round still coerces to 0 then increments (P11a).
  const priorRound = Number(next.round);
  const round = (Number.isFinite(priorRound) ? priorRound : 0) + 1;
  next.round = round;
  const merged = mergeFindings(findings);
  const seen = new Set();
  for (const finding of merged) {
    const key = finding.fingerprint;
    seen.add(key);
    const previous = next.entries[key];
    safeSet(next.entries, key, {
      fingerprint: key,
      category: finding.category,
      rule_id: finding.rule_id,
      file: finding.file,
      symbol: finding.symbol,
      line: finding.line,
      severity: finding.severity,
      state: nextState(previous),
      first_seen_round: previous?.first_seen_round ?? round,
      last_seen_round: round,
      sources: finding.sources,
      timestamp: now,
    });
  }
  const { reported, warning } = reportedCategoryScope(scope);
  const warnings = warning ? [warning] : [];
  // An omitted or unrecognizable scope fails closed: no fingerprint may be
  // marked `fixed`, so a malformed scope guard can never re-open false
  // convergence (F1/F2).
  if (reported === UNRECOGNIZED_SCOPE) return { ledger: next, warnings };
  for (const [key, entry] of Object.entries(next.entries)) {
    if (seen.has(key)) continue;
    // A non-object entry (e.g. a `null` seeded from a durable baseline) has no
    // state to read or assign: skip it rather than throwing in strict mode, and
    // surface the skipped key so a corrupt entry is visible, not silently
    // resolved.
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      warnings.push(`ledger: skipped non-object entry ${key}; state left unchanged`);
      continue;
    }
    // Absent this round means it was resolved; accepted risk stays accepted.
    if (entry.state === "accepted") continue;
    // A fingerprint in a category that did not report this round keeps its
    // prior state rather than being falsely marked fixed.
    if (reported && !reported.has(entry.category)) continue;
    entry.state = "fixed";
  }
  return { ledger: next, warnings };
}

// Counts entries that represent open Critical/Major findings. A non-object
// entry (e.g. a `null` seeded from a durable baseline) has no state/severity:
// counting it as open would throw, but silently ignoring it could hide a real
// Critical and lower the count — so the detailed form reports a `skipped` count
// the orchestrator can log/escalate, while the legacy count shape is unchanged.
export function openCriticalMajorCountsDetailed(ledger) {
  const counts = { Critical: 0, Major: 0, total: 0, skipped: 0 };
  for (const entry of Object.values(ledger?.entries ?? {})) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      counts.skipped += 1;
      continue;
    }
    if (!OPEN_LEDGER_STATES.has(entry.state)) continue;
    if (entry.severity === "Critical") counts.Critical += 1;
    else if (entry.severity === "Major") counts.Major += 1;
    else continue;
    counts.total += 1;
  }
  return counts;
}

export function openCriticalMajorCounts(ledger) {
  const { Critical, Major, total } = openCriticalMajorCountsDetailed(ledger);
  return { Critical, Major, total };
}

// `history` is a list of ledgers or a list of count objects. KD-9 divergence:
// open Critical/Major that is **non-decreasing** across the last two rounds
// (i.e. not strictly decreasing) is divergence; so is any rise. Missing count
// fields fail closed to non-converging. A malformed (non-array) history fails
// closed too, and any compared ledger whose entries include a non-object
// (`skipped`) entry also fails closed: a corrupt entry could hide a real
// Critical, so it must not read as converged (P2/P7).
export function isConverging(history) {
  // A malformed (non-array) history fails closed: it is a caller error, not a
  // converged series (P2). Fewer than two rounds, by contrast, is genuinely
  // insufficient data — divergence cannot be observed yet, so it reads as not
  // yet divergent rather than as a failure. Callers must therefore NOT treat a
  // single-round `isConverging(...) === true` as "converged": it only means
  // "insufficient data". Loop termination must combine it with
  // `openCriticalMajorCounts(ledger).total === 0` (Q5).
  if (!Array.isArray(history)) return false;
  if (history.length < 2) return true;
  // Compute the detailed count once per ledger-shaped item so the `skipped`
  // check and the comparison share one pass over the entries (P7/P8).
  const detailed = history.map((item) =>
    item && typeof item === "object" && item.entries ? openCriticalMajorCountsDetailed(item) : null,
  );
  const counts = detailed.map((count, index) =>
    count ?? (history[index] && typeof history[index] === "object" ? history[index] : {}),
  );
  // A skipped count means a non-object ledger entry escaped state/severity
  // inspection: treat the comparison as non-converging rather than trusting a
  // count that may be artificially low.
  if (detailed.some((count) => count?.skipped > 0)) return false;
  for (let i = 1; i < counts.length; i += 1) {
    if ((counts[i].Critical ?? NaN) > (counts[i - 1].Critical ?? NaN)) return false;
    if ((counts[i].Major ?? NaN) > (counts[i - 1].Major ?? NaN)) return false;
  }
  const last = counts[counts.length - 1];
  const prior = counts[counts.length - 2];
  const lastTotal = (last.Critical ?? NaN) + (last.Major ?? NaN);
  const priorTotal = (prior.Critical ?? NaN) + (prior.Major ?? NaN);
  if (Number.isNaN(lastTotal) || Number.isNaN(priorTotal)) return false;
  return lastTotal < priorTotal;
}

// Loop budget = agent calls + scanner minutes (KD-9), calibrated to the ≤2
// outer-pass cap. `agentCalls` counts one per subagent delegation: each outer
// pass delegates ~9 (scanner, five reviewers, code-reviewer, plus at least one
// coder and one verifier), so the two-pass nominal total is 9 delegations × 2
// outer passes = 18 calls. The budget is set one above that nominal total (19)
// so `agentCalls >= budget` cannot fire at the same instant as the pass cap; it
// is a genuine overflow backstop for extra inner coder/verifier delegations, not
// a restatement of the pass count. `scannerMinutes` is the sum of the five scan
// legs' own durations; ~15 minutes per pass × 2 passes ≈ 30 minutes. Divergence
// escalates after two non-converging rounds, any finding regresses twice, or
// design-conflict re-issues repeat. Finding churn and design-conflict churn are
// tracked separately and never summed.
export const DEFAULT_LOOP_BUDGET = Object.freeze({
  maxOuterPasses: 2,
  agentCalls: 19,
  scannerMinutes: 30,
});

export function shouldEscalate(state = {}) {
  // Coerce a non-object state (an explicit `null`, array, or primitive) to an
  // empty object before destructuring so it fails closed to "not escalating"
  // rather than throwing, matching the existing `budget`/`spent` hardening (Q3).
  const s = state && typeof state === "object" && !Array.isArray(state) ? state : {};
  const {
    passes = 0,
    nonConvergentRounds = 0,
    divergenceThreshold = 2,
    regressionRounds = 0,
    maxRegressions = 2,
    designConflictReissues = 0,
    maxDesignConflictReissues = 2,
  } = s;
  // A malformed `budget`/`spent` (null or a non-object) is treated as the
  // default budget / zero spend rather than throwing (G5).
  const budget =
    s.budget && typeof s.budget === "object" ? s.budget : DEFAULT_LOOP_BUDGET;
  const spent = s.spent && typeof s.spent === "object" ? s.spent : {};
  // An unmeasured counter is unknown, not equal to the pass count: defaulting to
  // `passes` conflated a delegation count / a minute sum with a number of passes
  // and made the budget fire one pass early. Fall back to 0 (no measured spend)
  // so the budget only exhausts on the counters the caller actually reports.
  // `?? 0` does not absorb a `NaN` counter; a non-finite count is unmeasured
  // spend, so fall back to 0 rather than letting a `>=` against NaN read false.
  const agentCalls = Number.isFinite(spent.agentCalls) ? spent.agentCalls : 0;
  const scannerMinutes = Number.isFinite(spent.scannerMinutes) ? spent.scannerMinutes : 0;
  const budgetExhausted =
    passes >= (budget.maxOuterPasses ?? DEFAULT_LOOP_BUDGET.maxOuterPasses) ||
    agentCalls >= (budget.agentCalls ?? DEFAULT_LOOP_BUDGET.agentCalls) ||
    scannerMinutes >= (budget.scannerMinutes ?? DEFAULT_LOOP_BUDGET.scannerMinutes);
  return (
    budgetExhausted ||
    nonConvergentRounds >= divergenceThreshold ||
    regressionRounds >= maxRegressions ||
    designConflictReissues >= maxDesignConflictReissues
  );
}

const SEVERITY_FLOOR = Object.freeze(["Critical", "Major"]);
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/;

function parsedTimestamp(value) {
  if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value)) return NaN;
  return Date.parse(value);
}

// `null` when the entry is still valid; otherwise the non-suppressible reason.
function expiryReason(entry, now) {
  const reference = parsedTimestamp(now);
  const expiry = parsedTimestamp(entry?.expires);
  if (Number.isNaN(reference) || Number.isNaN(expiry)) return "invalid-expiry";
  if (expiry < reference) return "expired";
  return null;
}

function entryTouchesFile(entry, finding) {
  if (entry.touched === true) return true;
  if (!Array.isArray(entry.touched_files)) return false;
  const target = normalizeFile(finding?.file);
  return entry.touched_files.some(
    (file) => typeof file === "string" && normalizeFile(file) === target,
  );
}

// Baseline entries suppress accepted risk until the file is touched or the
// entry expires. `now` is an ISO timestamp; `touched` may be carried on the
// entry (set by the caller when the matching file changed). A live secret or
// incident finding is never suppressed (KD-10), nor is any Critical/Major
// finding (severity floor); a missing/invalid expiry fails closed.
export function baselineMatch(finding, baseline, now) {
  if (finding?.category === "secret" || finding?.incident === true) {
    return { matched: false, entry: null, reason: "non-suppressible" };
  }
  if (SEVERITY_FLOOR.includes(finding?.severity)) {
    return { matched: false, entry: null, reason: "non-suppressible" };
  }
  const entries = baseline?.entries;
  const key = fingerprint(finding);
  const objectShaped = !Array.isArray(entries) && Boolean(entries) && typeof entries === "object";
  // Keyed lookup first: an object baseline is keyed by fingerprint (schema), so
  // a key miss is definitive — do not walk every value O(B). The linear scan is
  // reserved for the array shape, the only shape that can carry an entry under
  // a key other than its fingerprint.
  const keyed = objectShaped ? entries[key] : undefined;
  let candidates;
  if (keyed && typeof keyed === "object") {
    candidates = [keyed];
  } else if (objectShaped) {
    return { matched: false, entry: null, reason: "no-baseline-entry" };
  } else {
    const list = Array.isArray(entries) ? entries : [];
    candidates = list.filter((candidate) => {
      if (!candidate || typeof candidate !== "object") return false;
      if (typeof candidate.fingerprint === "string") return candidate.fingerprint === key;
      return fingerprint(candidate) === key;
    });
  }
  if (candidates.length === 0) return { matched: false, entry: null, reason: "no-baseline-entry" };
  // Deterministic duplicate choice: a touched entry wins (so the touch lifts
  // suppression), then an unexpired entry, then the first.
  const entry =
    candidates.find((candidate) => entryTouchesFile(candidate, finding)) ??
    candidates.find((candidate) => expiryReason(candidate, now) === null) ??
    candidates[0];
  if (entryTouchesFile(entry, finding)) {
    return { matched: false, entry, reason: "touched-file" };
  }
  const expiry = expiryReason(entry, now);
  if (expiry) return { matched: false, entry, reason: expiry };
  // An accepted-risk entry must name a non-empty approver; an unattributed
  // suppression is rejected (G7).
  if (typeof entry.approved_by !== "string" || entry.approved_by.trim() === "") {
    return { matched: false, entry, reason: "unapproved-entry" };
  }
  // A missing/malformed entry `severity` is not a verified accepted risk: fail
  // closed (invalid-entry) rather than matching any finding's severity.
  if (typeof entry.severity !== "string" || entry.severity.trim() === "") {
    return { matched: false, entry, reason: "invalid-entry" };
  }
  if (finding?.severity && entry.severity !== finding.severity) {
    return { matched: false, entry, reason: "severity-mismatch" };
  }
  return { matched: true, entry, reason: "accepted-baseline" };
}

// Drops only genuinely expired baseline entries and keeps everything else —
// including entries whose expiry is missing/malformed (kept for repair, never
// silently erased) and non-object entries — so a hand-authored entry with a
// typo'd/absent `expires` is not deleted with no warning. Returns the full
// `{version, entries}` document so the wrapper shape survives a write-back, plus
// `warnings` naming each invalid-expiry entry that was retained. `now` is an ISO
// timestamp.
export function pruneBaseline(baseline, now) {
  const isDocument =
    baseline &&
    typeof baseline === "object" &&
    !Array.isArray(baseline) &&
    ("entries" in baseline || "version" in baseline);
  const source = isDocument ? baseline.entries ?? {} : baseline;
  const keptEntries = {};
  const warnings = [];
  // A running counter makes the keyless fallback O(1) per entry instead of
  // materializing the whole key array via `Object.keys(...).length` (O(B²)).
  let keylessCount = 0;
  const retain = (key, entry) => {
    const keyed =
      typeof key === "string" && key.trim() !== "" ? key : null;
    const resolved =
      keyed ??
      (entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.fingerprint === "string"
        ? entry.fingerprint
        : `invalid-entry-${(keylessCount += 1)}`);
    safeSet(keptEntries, resolved, entry);
    return resolved;
  };
  const retainValid = (key, entry, label) => {
    const reason = expiryReason(entry, now);
    if (reason === "expired") return; // genuinely dead → drop
    const resolved = retain(key, entry);
    // Missing/malformed expiry is retained, never erased, and surfaced so the
    // orchestrator can log/escalate it instead of silently destroying the entry.
    if (reason === "invalid-expiry") {
      warnings.push(`baseline: retained ${label ?? resolved} with a missing/malformed expiry (fails closed; needs repair)`);
    }
  };
  if (Array.isArray(source)) {
    for (const entry of source) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        retain(null, entry);
        warnings.push("baseline: retained non-object entry for repair");
        continue;
      }
      retainValid(null, entry, typeof entry.fingerprint === "string" ? entry.fingerprint : fingerprint(entry));
    }
  } else if (source && typeof source === "object") {
    for (const [key, entry] of Object.entries(source)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        retain(key, entry);
        warnings.push(`baseline: retained non-object entry ${key} for repair`);
        continue;
      }
      retainValid(key, entry);
    }
  } else {
    warnings.push("baseline: entries is not a map or list; nothing to prune");
  }
  return { version: isDocument ? baseline.version ?? 1 : 1, entries: keptEntries, warnings };
}

// Each not-verifiable cause has exactly one route. `null` for unknown causes so
// callers fail closed instead of guessing an owner.
export function classifyNotVerifiable(cause) {
  // `Object.hasOwn` keeps an inherited name (`constructor`, `toString`,
  // `__proto__`) from walking the prototype chain and returning a bogus truthy
  // route; an unknown cause still fails closed to null.
  if (!Object.hasOwn(NOT_VERIFIABLE_ROUTES, cause)) return null;
  const route = NOT_VERIFIABLE_ROUTES[cause];
  return route ? { ...route } : null;
}
