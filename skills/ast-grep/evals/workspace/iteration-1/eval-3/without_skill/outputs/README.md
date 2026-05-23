# Eval Result: Replace `console.error(...)` with `this.logger.error(...)`

## Command Used
```bash
/home/oat/.bun/bin/ast-grep run \
  -p 'console.error($$$ARGS)' \
  -r 'this.logger.error($$$ARGS)' \
  -l ts \
  --update-all \
  skills/ast-grep/evals/files/search-sample.ts
```

## Result
Applied **1 change** successfully.

## Files
- `original.txt` — The source file before transformation
- `transformed.txt` — The source file after transformation
- `diff.patch` — Unified diff showing the single change
- `ast-grep-output.txt` — Raw stdout from the ast-grep CLI

## Summary
`console.error('Failed to load users:', err)` on line 34 was replaced with `this.logger.error('Failed to load users:', err)`.
