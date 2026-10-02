// Shared check-only lint/format allow surface for coder + verifier.
// Single source so the two suites cannot drift.
export const LINT_ALLOWS = [
  "./node_modules/.bin/eslint*",
  "./node_modules/.bin/biome check*",
  "./node_modules/.bin/biome lint*",
  "./node_modules/.bin/biome format*",
  "./node_modules/.bin/biome ci*",
  "./node_modules/.bin/prettier --check*",
  "npx --no-install eslint*",
  "npx --no-install biome*",
  "npx --no-install prettier --check*",
  "pnpm exec eslint*",
  "pnpm exec biome*",
  "pnpm exec prettier --check*",
  "yarn eslint*",
  "yarn biome*",
  "yarn prettier --check*",
  "bunx --no-install eslint*",
  "bunx --no-install biome*",
  "bunx --no-install prettier --check*",
];

// Explicit mutating-flag denies that must come after every allow.
// Runner-scoped forms are longer (more specific) than their allows so
// most-specific-wins resolves mutating invocations to deny.
export const LINT_MUTATE_DENIES = [
  "./node_modules/.bin/biome* --write*",
  "./node_modules/.bin/biome* --fix*",
  "./node_modules/.bin/eslint* --fix*",
  "./node_modules/.bin/prettier* --write*",
  "npx --no-install biome* --write*",
  "npx --no-install biome* --fix*",
  "npx --no-install eslint* --fix*",
  "npx --no-install prettier* --write*",
  "pnpm exec biome* --write*",
  "pnpm exec biome* --fix*",
  "pnpm exec eslint* --fix*",
  "pnpm exec prettier* --write*",
  "yarn biome* --write*",
  "yarn biome* --fix*",
  "yarn eslint* --fix*",
  "yarn prettier* --write*",
  "bunx --no-install biome* --write*",
  "bunx --no-install biome* --fix*",
  "bunx --no-install eslint* --fix*",
  "bunx --no-install prettier* --write*",
  "*biome* --write*",
  "*biome* --fix*",
  "*eslint* --fix*",
  "*prettier* --write*",
  "* --fix*",
  "* --write*",
];

// Commands that must never be allowed (even though they match a broad allow
// prefix, the deny tail must win). Used for precedence assertions.
export const MUST_DENY_PAYLOADS = [
  "biome check --write .",
  "biome format --write .",
  "biome lint --write .",
  "eslint . --fix",
  "prettier --write .",
  "npx --no-install biome format --write .",
  "npx --no-install eslint . --fix",
  "pnpm exec biome check --write .",
  "pnpm exec eslint . --fix",
  "yarn biome format --write .",
  "yarn eslint . --fix",
  "yarn prettier --write .",
  "bunx --no-install biome format --write .",
  "./node_modules/.bin/biome format --write .",
  "./node_modules/.bin/eslint . --fix",
];

// Returns true if a glob-pattern `pat` (with `*` wildcards) matches `cmd`.
// This helper MODELS the engine's prefix-glob semantics for tests; it is not
// the engine. The load-bearing property asserted with it is "no allow pattern
// matches a `-w` form" (P1) — a true return here must never be read as proof
// that an invocation is safe beyond what that assertion checks. Minimal
// matcher mirroring opencode's prefix-glob semantics for tests. The
// command is split on the bare `--` argument separator and each part is tested
// against the full-string anchored pattern, so a grant cannot be smuggled past
// the separator (the `--stdin`/`--write` long flags are untouched; only the
// standalone separator token splits). Testing the whole command as well keeps
// the matcher faithful for patterns that legitimately span the separator.
function anchoredRegex(pat) {
  return new RegExp(
    "^" + pat.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$",
  );
}

export function globMatches(pat, cmd) {
  const rx = anchoredRegex(pat);
  const text = String(cmd);
  if (rx.test(text)) return true;
  const parts = text.split(/(?:^|\s)--(?=\s|$)/).map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 && parts.some((part) => rx.test(part));
}

// Specificity heuristic: longer non-wildcard prefix wins; ties broken by
// later index (deny tail listed after allows).
export function winningRule(cmd, keys, rules) {
  let best = null;
  let bestScore = -1;
  let bestIdx = -1;
  keys.forEach((k, i) => {
    if (!globMatches(k, cmd)) return;
    const score = k.replaceAll("*", "").length;
    if (score > bestScore || (score === bestScore && i > bestIdx)) {
      best = k;
      bestScore = score;
      bestIdx = i;
    }
  });
  return best ? { key: best, verdict: rules[best] } : null;
}
