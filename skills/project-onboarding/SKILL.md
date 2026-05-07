---
name: project-onboarding
description: |
  Use this comprehensive onboarding skill when the user asks to be onboarded, 
  wants help understanding the project architecture, requests a getting-started 
  guide, or needs a project overview. It provides a 5-phase pipeline to detect, 
  map, document, set up, and report on any Node.js/TypeScript project in the workspace.
  Trigger keywords: "onboard me", "help me understand", "show me the architecture",
  "getting started", "project overview", "explain the project", "how does this work".
---

# Project Onboarding Skill

Load this skill when the user expresses intent to:
- Understand the project structure and architecture
- Get a guided tour of the codebase
- Set up the project for local development
- Generate documentation files (ARCHITECTURE.md, GLOSSARY.md, SETUP.md, WALKTHROUGH.md)

## 5-Phase Onboarding Pipeline

### Phase 1: Project Detection

**Goal**: Identify what type of project this is, its tech stack, and available configuration.

**Actions (auto-run, no prompts):**

1. Read `package.json`:
   - Extract `name`, `version`, `description`, `engines.node`
   - Categorize `dependencies` and `devDependencies` by purpose:
     - Frameworks: react, next, vue, express, fastify, nest
     - Databases: prisma, typeorm, mongoose, pg, redis
     - Testing: jest, vitest, playwright, cypress
     - Linting: eslint, prettier
     - Build: typescript, webpack, vite, esbuild
   - Extract `scripts` for later use in SETUP.md

2. Read `tsconfig.json` (if exists):
   - Detect TypeScript usage, module system, target, strict mode
   - Note the `outDir` and `rootDir`

3. Read `docker-compose.yml` (if exists):
   - List services (postgres, redis, mongo, nginx)
   - Note exposed ports and volume mounts

4. Read `.nvmrc` or `.node-version` (if exists):
   - Extract the required Node.js version

5. Read `.env.example` (if exists):
   - List required environment variables and their descriptions

6. Read `Makefile` or `justfile` (if exists):
   - Extract custom build/deploy commands

**Output**: A structured "Project Profile" dict with all detected information.

---

### Phase 2: Codebase Mapping

**Goal**: Explore the full directory structure, find entry points, trace data flow, and map dependencies.

**Delegation to Finder Agent:**

Delegate to the Finder agent with ALL of the following enhanced prompt templates:

#### Prompt A: findEntryPoints
Send to Finder:
```
Please locate all application entry point files in the project at [project-root].
Search for patterns: **/main.ts, **/index.ts, **/app.ts, **/server.ts, **/main.js, **/index.js
For each file found, report:
- Full relative path
- Brief purpose (is it a server entry, a library entry, a CLI entry?)
---
Use the Onboarding Protocol section of your instructions.
```

#### Prompt B: traceDataFlow
Send to Finder (after getting entry points):
```
For the project at [project-root], trace the data flow for key operations:
1. Read the main entry point file(s) identified earlier
2. Find HTTP handler definitions (route registrations, controller methods)
3. Trace each handler → find which service/module it calls
4. From each service → find which repository/data-access module it calls
5. Report the full chain: Route → Controller → Service → Repository
---
Use the Onboarding Protocol section of your instructions.
```

#### Prompt C: mapDependencies
Send to Finder:
```
For the project at [project-root], build a dependency map:
1. Read the main entry point file(s)
2. Parse import/require statements
3. For each imported module, recursively trace its imports (depth max 3)
4. Report a dependency graph showing which modules depend on which
---
Use the Onboarding Protocol section of your instructions.
```

#### Prompt D: describeConventions
Send to Finder:
```
For the project at [project-root], detect coding conventions:
1. File naming: PascalCase (UserService.ts) or camelCase (userService.ts)?
2. Folder structure: feature-based (users/, orders/) or layer-based (controllers/, services/)?
3. Error handling: custom error classes, error middleware, result types?
4. Testing patterns: unit test naming, test file location, mocking approach?
5. Export patterns: named exports, default exports, barrel files?
---
Use the Onboarding Protocol section of your instructions.
```

**Collect All Finder Output**: Wait for Finder to complete all 4 prompts before proceeding. Store the results for use in Phase 3.

---

### Phase 3: Script Generation

**Goal**: Generate the 4 documentation files (ARCHITECTURE.md, GLOSSARY.md, SETUP.md, WALKTHROUGH.md).

**Action (auto-run, no prompts):**

Run the onboard-project.js script with all information gathered from Phases 1 and 2.

**Command:**
```bash
node "skills/project-onboarding/scripts/onboard-project.js" \
  --dir "[project-root]" \
  --output "[project-root]"
```

**Data Injection**: The script will independently scan the project, but if Finder's Phase 2 output is available, pass it via:
- Write a temp JSON file at `.onboarding-cache.json` in the project root containing Phase 1 + Phase 2 findings
- The script checks for this file and uses it to enrich the generated docs

**Expected Output Files (all in project root):**
| File            | Description                                                                         |
| --------------- | ----------------------------------------------------------------------------------- |
| `ARCHITECTURE.md` | Project overview, tech stack, directory tree, Mermaid diagram, key files, data flow |
| `GLOSSARY.md`     | Domain terms, technical abbreviations                                               |
| `SETUP.md`        | Prerequisites, installation, environment config, commands                           |
| `WALKTHROUGH.md`  | File reading order, entry point explanation, request tracing guide                  |

---

### Phase 4: Setup — Interactive Setup Steps

**Goal**: Help the user get the project running locally. Each step REQUIRES user confirmation.

**Step 4.1 — Check Node.js Version**
Action: Run `node --version` and compare against `engines.node` from package.json
If mismatch: Warn the user but do not block
Auto-run (no prompt needed for this check)

**Step 4.2 — Prompt: Install Dependencies**
Ask the user: "Would you like to run `npm install` to install project dependencies?"
If yes → Run `npm install` in the project root
If no → Skip (note in report)

**Step 4.3 — Prompt: Create .env File**
Check if `.env` exists. If not, and `.env.example` exists:
Ask the user: "A .env.example file was found. Would you like to copy it to .env?"
If yes → Copy `.env.example` to `.env`
If no → Skip (note in report)

**Step 4.4 — Prompt: Verify Build**
Ask the user: "Would you like to run the build command to verify everything compiles?"
If yes → Detect the build command (npm run build, npm run compile, tsc, etc.) and run it
If no → Skip (note in report)

**IMPORTANT**: All prompts use the `prompts` npm package. The Orchestrator should delegate this phase 
back to the user (via the Orchestrator's own question mechanism) by describing what the script would do 
and asking for confirmation, OR run the script with the appropriate flags.

---

### Phase 5: Report

**Goal**: Present all generated documentation to the user in a clear, organized summary.

**Action (auto-run):**

Present a structured report to the user:

```
## ✅ Onboarding Complete: [project-name]

### Generated Documentation

| Document           | Description                                                 | Location          |
| ------------------ | ----------------------------------------------------------- | ----------------- |
| 📐 ARCHITECTURE.md | Tech stack, directory tree, architecture diagram, data flow | ./ARCHITECTURE.md |
| 📖 GLOSSARY.md     | Domain terms, abbreviations, acronyms                       | ./GLOSSARY.md     |
| 🔧 SETUP.md        | Prerequisites, installation, configuration, commands        | ./SETUP.md        |
| 🚶 WALKTHROUGH.md  | File reading order, entry point guide, request tracing      | ./WALKTHROUGH.md  |

### Tech Stack Summary
- **Runtime**: [Node.js vXX]
- **Language**: [TypeScript/JavaScript]
- **Framework**: [framework names]
- **Database**: [database + ORM]
- **Testing**: [test frameworks]
- **Build**: [build tools]

### Key Files
- Entry point: [path]
- Config: [path]
- [3-5 most important files]

### Next Steps
1. Read WALKTHROUGH.md for a guided tour
2. Follow SETUP.md to get the project running
3. Refer to ARCHITECTURE.md for deeper understanding
4. Use GLOSSARY.md when you encounter unfamiliar terms
```

**Read and present file contents**: Use the `read` tool to show excerpts from each generated doc,
highlighting the most useful sections (tech stack table, architecture diagram, directory tree).
