---
name: sbom-generation
description: "Use when the user asks to generate a Software Bill of Materials (SBOM), produce a CycloneDX JSON inventory of a project's dependencies, run trivy in SBOM mode, or export a dependency list in cyclonedx-json format. Reuses the existing trivy wrapper via a Podman container (docker.io/aquasec/trivy@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969) with zero local installation. This is a STANDALONE opt-in skill, NOT a Stage 5 loop member."
---
# SBOM Generation Skill (Podman) — Trivy CycloneDX

## Purpose

Generate a **Software Bill of Materials (SBOM)** — a structured inventory of a
project's third-party dependencies — in **CycloneDX JSON** format using
[Trivy](https://trivy.dev). **All via a Podman container** with zero local
installation. This skill **reuses the existing Trivy scanner wrapper** and its
pinned image (`docker.io/aquasec/trivy@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969`) — there is **no separate wrapper file and no new image pin** for SBOM.

SBOM is a **standalone opt-in capability**, NOT a Stage 5 loop member: SBOM is
artifact *generation*, not a pass/fail finding, so it does not fit the loop's
finding-gate semantics. It is invoked on demand to produce `sbom.cdx.json`
under the project's `.scans/` directory.

## Quick Reference

| Operation | Command |
|-----------|---------|
| **Generate CycloneDX SBOM** | `source skills/trivy-scanner/scripts/trivy-scanner-wrapper.sh && trivy-docker fs --format cyclonedx-json --output /src/.scans/sbom.cdx.json /src` |
| **Shell wrapper** | Source `scripts/trivy-scanner-wrapper.sh` then run `trivy-docker ...` |

## Quick Start

Source the existing Trivy wrapper, then run the exact CycloneDX invocation:

```bash
source skills/trivy-scanner/scripts/trivy-scanner-wrapper.sh
trivy-docker fs --format cyclonedx-json --output /src/.scans/sbom.cdx.json /src
```

The `sbom.cdx.json` artifact is written under `/src/.scans/` on the host. On
the first run Trivy downloads its vulnerability database into the persistent
`trivy-cache` named volume (the wrapper creates it if missing); subsequent
runs reuse the cache and the wrapper's `TRIVY_TIMEOUT` (default `10m`)
bounds the whole operation.

## What the wrapper provides automatically

Because this skill reuses the existing `trivy-scanner` wrapper, you get, for
free:

- the digest-pinned `docker.io/aquasec/trivy@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969` image, run `--rm` with a `:Z` SELinux mount and `--workdir /src`;
- the `trivy-cache` named volume (created if missing) and `TRIVY_TIMEOUT` default (`10m`);
- the wrapper's `--skip-dirs /src/.scans` injection on `fs` scans, so the SBOM artifact is **never re-scanned** as an input on subsequent runs;
- the wrapper's `/src/.scans/` output guard on `--output`, so the `sbom.cdx.json` path is enforced under `.scans/`.

## Hard Rules

- [x] **Reuse the existing trivy wrapper** — no new wrapper file, no new image pin
- [x] **Always use the exact invocation**: `trivy-docker fs --format cyclonedx-json --output /src/.scans/sbom.cdx.json /src`
- [x] **Write under `/src/.scans/`** so the SBOM persists on the host
- [x] **Read-only operation** — SBOM generation only reads the project; never modifies source
- [x] **Standalone opt-in** — NOT a Stage 5 loop leg; SBOM is artifact generation, not a finding

## Key References

| Topic | Location |
|-------|----------|
| Trivy SBOM | https://trivy.dev/latest/docs/sbom/ |
| CycloneDX spec | https://cyclonedx.org/ |
| Trivy skill | `skills/trivy-scanner/SKILL.md` |
| Trivy wrapper | `skills/trivy-scanner/scripts/trivy-scanner-wrapper.sh` |

## Tips & Best Practices

1. **SBOM is generation, not a gate**: produce `sbom.cdx.json` on demand; it is not a Stage 5 loop finding
2. **Keep the artifact gitignored**: `.scans/` is ignored in this repo and should be in any target project
3. **Reuse the cache**: keeping the `trivy-cache` volume avoids re-paying the DB download
4. **Pair with scanning**: the same Trivy image that scans for vulnerabilities can emit the SBOM in one pass
