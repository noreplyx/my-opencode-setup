# secure-scan-demo — Stage 5 scanner-suite fixture

A deliberately vulnerable, **synthetic** demo project used to validate the
code-orchestrator Stage 5 multi-scanner security suite (AC-18): the pinned
`osv-scanner`, `semgrep`, and `trivy` containers must each produce at least
one finding against this directory, mapped into the Critical/Major/Minor/Nit
taxonomy.

| File | Expected detection | Tool(s) |
|------|--------------------|---------|
| `package-lock.json` | `minimist` 1.2.0 (GHSA-vh95-rmgr-6w4m / CVE-2021-44906 prototype pollution) | OSV-Scanner, Trivy (vuln) |
| `app/server.py` | `subprocess` with `shell=True`, `eval()` of untrusted input, `os.system()` concat | Semgrep |
| `Dockerfile` | unpinned `:latest` base, root user, exposed port 22, missing `HEALTHCHECK`, `apt-get` without `--no-install-recommends` (fires DS-0001/0002/0004/0026/0029; the `curl … \| bash` line is decorative for SAST only) | Trivy (misconfig) |
| `config/settings.yaml` | GitHub-PAT-shaped secret pattern | Trivy (secret) |

**Safety notes**

- The "secret" is the literal string `ghp_` + 36 `A` characters — not a real
  credential and not rotatable.
- The installer URL uses `example.invalid` (RFC 2606); it is never fetched.
- Nothing here should ever be executed, deployed, or copied into real code.
- Whole-repo self-scans of this config repo exclude this fixture directory
  via the root ignore files (`.semgrepignore`, `trivy.yaml` + `.trivyignore.yaml`,
  `osv-scanner.self-scan.toml`) — none of them live in this directory, so the
  `--live:e2e` gate, which scans this directory directly, still asserts every
  seeded bug above; see the root README, "Security operation notes".
- Scan artifacts written while scanning this fixture land in `.scans/`. The
  repository `.gitignore` deliberately excludes `.scans/`, so these outputs
  are **local-only regeneration evidence**: they are produced by running the
  sanctioned Stage 5 scans (`osv-scanner-docker`, `semgrep-docker`,
  `trivy-docker` against this directory) and must never be committed — the
  raw Trivy artifact embeds the fixture's synthetic secret context lines,
  exactly like a real target's would. A fresh clone therefore contains no
  `.scans/` directory here; no test reads or requires it, and re-creating it
  is a manual/verifier step, not a checkout step.
