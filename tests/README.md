# System Tests

Tests for the orchestration system scripts and agents.

## Running Tests

```bash
chmod +x tests/run-tests.sh
./tests/run-tests.sh

# With verbose output (shows test details)
./tests/run-tests.sh --verbose
```

## Test Files

| File | Tests |
|------|-------|
| `pipeline-init.test.ts` | Pre-flight checks, journal parsing, similarity matching, context generation |
| `audit-log.test.ts` | SHA-256 hash chain integrity, YAML serialization/deserialization, tamper detection |
| `validate-output-contract.test.ts` | Agent output schema validation, YAML frontmatter parsing, type checking |
| `validate-context.test.ts` | Context file schema validation (agent-context.md) |
| `shared-utils.test.ts` | Logger, file I/O utilities, pattern matching, directory walking |
| `pipeline-teardown.test.ts` | Retrospective calculation, journal entry formatting, lesson extraction |

## Coverage Targets

- Core orchestration scripts (pipeline-init, pipeline-teardown, audit-log): 90%+ function coverage
- Validation scripts (validate-output-contract, validate-context): 85%+ function coverage
- Shared utilities (Logger, file I/O): 95%+ function coverage

## Adding New Tests

1. Create `<name>.test.ts` in this directory
2. Follow the pattern in existing test files:
   - Use `test()` and `assert()` helper functions (no test framework)
   - Use only Node.js built-in modules (fs, path, child_process, crypto)
   - Clean up temp directories after tests
   - Use `process.exit(1)` on failure
3. Tests auto-discovered by `run-tests.sh`
