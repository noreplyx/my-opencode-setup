# Semgrep OWASP Top Ten Scan Summary

**Scan Date:** 2026-05-24  
**Project:** /home/oat/.config/opencode  
**Tool:** semgrep v1.163.0  
**Rule Set:** `p/owasp-top-ten` (Community rules, 544 rules loaded)

## Commands Run

1. `semgrep scan --config p/owasp-top-ten /home/oat/.config/opencode` — Terminal output
2. `semgrep scan --config p/owasp-top-ten --json /home/oat/.config/opencode` — JSON results

## Results

| Metric | Value |
|--------|-------|
| Rules executed | 248 |
| Targets scanned | 262 |
| Findings | **0** |
| Blocking findings | 0 |
| Parsed lines | ~100% |
| Files skipped (size >1MB) | 3 |
| Files skipped (.semgrepignore) | 3 |

## Notes

- No OWASP Top Ten vulnerabilities were detected in the scanned files.
- The project consists primarily of TypeScript skill definitions, documentation (Markdown), JSON config files, and Python orchestration scripts.
- 11 fixpoint timeouts occurred during taint analysis (non-blocking warnings) — primarily in TypeScript orchestration scripts and Python skill-creator scripts.

## Output Files

- `semgrep_owasp_scan_terminal_output.txt` — Full colorized terminal output
- `semgrep_owasp_scan_results.json` — Structured JSON results with per-file scan details
- `scan_summary.md` — This summary
