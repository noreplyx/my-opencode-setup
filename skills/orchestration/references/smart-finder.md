# Smart Finder

## Proactive Hazard Detection

Finder flags during exploration:

- **Dead code**: unused exports, uncalled functions, orphaned modules.
- **Deprecated APIs**: usage of deprecated libraries, methods, patterns.
- **Security anti-patterns**: `eval()`, `innerHTML`, hardcoded secrets.
- **Missing error handling**: functions that can throw but aren't wrapped.
- **Type safety issues**: `any` types, missing null checks, implicit any.

## Structured Knowledge Graph Output

Finder returns:

```yaml
knowledgeGraph:
  entities:
    - name: "UserService"
      type: "class"
      file: "src/services/user.ts"
      exports: ["UserService", "createUser", "getUser"]
  relationships:
    - from: "UserController"
      to: "UserService"
      type: "imports"
      details: "UserController imports and calls UserService methods"
  entryPoints:
    - path: "src/index.ts"
      type: "server"
  dataFlows:
    - route: "POST /api/users"
      chain: "UserController.createUser → UserService.createUser → UserModel.save"
  hazards:
    - file: "src/services/user.ts"
      line: 42
      type: "security"
      severity: "medium"
      description: "User input passed directly to database query without sanitization"
```

## Context-Aware Depth

- **Unfamiliar** (no git history, low test coverage): 3+ levels deep.
- **Well-known** (frequently committed, high test coverage): 1 level.
- **Signal**: git log frequency + test file existence + last modified date.

## Familiarity Scoring

| Score | Meaning | Depth |
|---|---|---|
| 1-4 | Unknown (<5 commits, no tests) | Deep (3+ levels) |
| 5-7 | Moderate (5-20 commits, some tests) | Moderate (2 levels) |
| 8-10 | Well-known (20+ commits, test suite) | Shallow (1 level) |

Computed by `computeFamiliarityScore()` in `pipeline-init.ts` based on git commit frequency + test file presence.