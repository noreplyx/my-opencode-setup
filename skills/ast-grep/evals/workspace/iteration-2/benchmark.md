# ast-grep Skill -- Iteration 2 Final Benchmark

## Overview

| Metric | With Skill | Without Skill | Delta |
|--------|-----------|---------------|-------|
| Pass Rate (mean) | **100.0%** | 89.3% | **+10.7%** |
| Pass Rate (min) | 100.0% | 50.0% | +50.0% |
| Time (mean) | 0.5s | 0.5s | 0.0s |
| Tokens (mean) | 1200 | 800 | +400 |

## Per-Eval Results

| Eval | Name | With Skill | Without Skill |
|------|------|:----------:|:-------------:|
| 1 | find-console-calls | [x] 4/4 (100%) | [x] 4/4 (100%) |
| 2 | create-rule-subscribe | [x] 4/4 (100%) | [x] 4/4 (100%) |
| 3 | rewrite-console-to-logger | [x] 4/4 (100%) | [x] 4/4 (100%) |
| 4 | find-arrow-implicit-return | [x] 4/4 (100%) | [x] 4/4 (100%) |
| 5 | json-import-search | [x] 4/4 (100%) | [!] 3/4 (75%) |
| 6 | stdin-pipe-search | [x] 5/5 (100%) | [x] 5/5 (100%) |
| 7 | **kind-vs-pattern-arrow** | [x] **4/4 (100%)** | [!] **2/4 (50%)** |

## Key Insights

- **Eval 7 gap (50%):** Without the skill, the model chose pattern over kind for finding ALL arrow functions -- the wrong choice. With the skill's explicit kind-vs-pattern guidance, it correctly used `kind: arrow_function`.
- **100% across all 7 evals** with the skill -- the improved Three-Question Framework and Chapter 2 cheat sheet provide the right decision tree.
- **Eval 5 gap persists:** Meta-variable explanation depth is thinner without the skill.
- **SKILL.md at 446 lines**: Under the 500-line recommendation, with categorized gotchas for faster scanning.
