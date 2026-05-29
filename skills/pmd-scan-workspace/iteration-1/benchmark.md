# PMD Scan Skill - Iteration 1 Benchmark

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| **Pass Rate** | 100.0% (19/19) | 94.7% (18/19) | **+5.3%** |
| **Evals** | 3/3 passed | 3/3 passed | — |

## Per-Eval Breakdown

### eval-0: java-code-quality-scan
| Assertion | With Skill | Without Skill |
|-----------|------------|---------------|
| Uses podman | ✅ | ✅ |
| Passes -d /src | ✅ | ✅ |
| Uses -R rulesets/java/quickstart.xml | ✅ | ✅ |
| Generates text + XML reports | ✅ | ✅ |
| Report files exist | ✅ | ✅ |
| Violations detected | ✅ | ✅ |

**Result**: Both agents produced equivalent results (11 violations, exit code 4).

### eval-1: cpd-duplicate-code-detection
| Assertion | With Skill | Without Skill |
|-----------|------------|---------------|
| Uses podman | ✅ | ✅ |
| Passes --minimum-tokens 50 | ✅ | ✅ |
| Uses PMD 7.x --dir flag | ✅ | ✅ |
| CPD report generated | ✅ | ✅ |
| Cross-file duplicates detected | ✅ | ✅ |
| 2+ duplication groups | ✅ | ✅ |

**Result**: Both agents detected 2 duplication groups between UserService and ProfileService.

### eval-2: custom-ruleset-scan
| Assertion | With Skill | Without Skill |
|-----------|------------|---------------|
| Uses podman | ✅ | ✅ |
| Mounts input to /src | ✅ | ✅ |
| Uses custom ruleset path | ✅ | ✅ |
| Generates SARIF report | ✅ | ✅ |
| SARIF file non-empty | ✅ | ✅ |
| Error-prone & code-style violations | ✅ | ✅ |
| Detects PMD 7.x path changes | ✅ | ❌ |

**Result**: With-skill agent correctly adapted legacy ruleset paths to PMD 7.x format. Baseline missed this.

## Observations

1. **PMD 7.x Compatibility**: The container runs PMD 7.25.0 which uses different flags (--dir vs --files, --report-file vs --file) and different ruleset paths (category/java/errorprone.xml vs rulesets/java/errorprone.xml). The skill needed updates after testing to document these changes.

2. **The skill provided clear command templates** that reduced exploration time. The with-skill agent had structured reference material to draw from.

3. **The custom ruleset detection edge case** was the one assertion that differentiated the two configurations.
