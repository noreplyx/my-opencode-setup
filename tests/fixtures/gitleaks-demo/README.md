# gitleaks-demo — Stage 5 git-history secret fixture

A deliberately leaky, **synthetic** demo project used to validate the
code-orchestrator Stage 5 gitleaks leg: the pinned `gitleaks` container must
produce at least one `Leaks[]` finding against this directory's **git
history**.

The e2e gate pre-seeds this directory as a git repository (git init + commit,
idempotent) so the synthetic secret lives in history — the surface gitleaks
scans. The `.gitignore` here excludes `.scans/` so re-runs never commit scan
artifacts.

| File | Expected detection | Tool(s) |
|------|--------------------|---------|
| `config/credentials.txt` | GitHub-PAT-shaped secret pattern (committed to history) | Gitleaks |

**Safety notes**

- The "secret" is the literal string `ghp_` + 36 `A` characters — not a real
  credential and not rotatable.
- Nothing here should ever be executed, deployed, or copied into real code.
- Whole-repo self-scans of this config repo exclude this fixture directory
  via the root `.gitleaks.toml` `[[allowlists]]` path entry — it does not
  live in this directory, so the `--live:e2e` gate, which scans this
  directory directly, still asserts the seeded secret fires; see the root
  README, "Security operation notes".
- Scan artifacts written while scanning this fixture land in `.scans/`. The
  repository `.gitignore` deliberately excludes `.scans/`, so these outputs
  are **local-only regeneration evidence**: they are produced by running the
  sanctioned Stage 5 gitleaks scan against this directory and must never be
  committed. A fresh clone therefore contains no `.scans/` directory here;
  no test reads or requires it, and re-creating it is a manual/verifier step,
  not a checkout step.
