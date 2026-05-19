---
name: integrator
description: Use this skill after parallel implementations create multiple new files that need to be wired together. This agent handles barrel file updates, dependency injection registration, route mounting, middleware wiring, and import resolution across all new/modified files. Trigger automatically after parallel Implementor tasks complete and before the Build Gate. NOT for single-file changes or sequential implementations.
---

# Integration Agent Skill

## Purpose

When multiple agents implement files in parallel, each file is correct in isolation but nothing connects them. The Integrator is the "wiring layer" — it ensures all new parts plug into the existing system correctly. Without this agent, parallel dispatch creates orphaned files that don't compile because no one updated the barrel exports, DI container, or route registration.

## Core Principles

### 1. One Pass, All Wires
Run a single comprehensive pass — do not iterate. The Integrator reads ALL new files, ALL modified files, and the project's existing wiring patterns, then applies all wiring changes in one shot. This avoids partial wiring states.

### 2. Pattern-Match, Don't Guess
- Read existing barrel/index files to detect the project's export style (named vs default, re-export vs direct export)
- Read existing DI container configuration to detect registration style
- Read existing route files to detect routing pattern
- Match the existing style exactly — do not invent new wiring conventions

### 3. Dry-Run Awareness
Before modifying any file, the Integrator runs a `git diff` to understand which files were created/modified by the parallel Implementors. It does NOT modify those files — it only modifies wiring files (barrels, DI containers, route indexes, etc.)

---

## Workflow

### Phase 0: Discover Wiring Points

Run a discovery scan of the project to find all wiring points:

```bash
# Find barrel files (index.ts, index.js)
find . -name "index.ts" -not -path "./node_modules/*" -not -path "./dist/*"

# Find DI container files
grep -rl "container\|Container\|injectable\|@Module\|@Component\|provider" \
  --include="*.ts" --include="*.js" src/ \
  | grep -v node_modules | grep -v dist

# Find route registration files
grep -rl "Router\|router\.\|app\.\|route\|Route" \
  --include="*.ts" --include="*.js" src/ \
  | grep -v node_modules | grep -v dist | grep -v ".test."

# Find middleware registration
grep -rl "\.use\|middleware\|Middleware" \
  --include="*.ts" --include="*.js" src/ \
  | grep -v node_modules | grep -v dist
```

### Phase 1: Categorize All New/Modified Files

For each file reported by the parallel Implementors:

| Category | Criteria | Action |
|----------|----------|--------|
| **Type/Interface** | `.types.ts`, `.d.ts`, or exports only types | Add to barrel file |
| **Service/Class** | Exports a class with business logic | Add to barrel + DI container |
| **Controller** | Exports route handlers or controller class | Add to barrel + route file |
| **Middleware** | Exports middleware function | Add to barrel + route file |
| **Utility** | Exports helper functions | Add to barrel |
| **Config** | Exports configuration object | Add to config index |
| **Model/Schema** | Exports DB model or validation schema | Add to barrel + DB index |

### Phase 2: Update Barrel Files

For each directory containing new files, check for an `index.ts` (or `index.js`) barrel file:

**If barrel exists:**
- Add re-exports for every new export
- Group by category (types first, then services, then utilities)
- Maintain alphabetical order within groups
- Use existing export style (named exports preferred)

```
// Existing format:
export { AuthService } from './auth.service';
export { TokenService } from './token.service';

// After update:
export { AuthService } from './auth.service';
export { TokenService } from './token.service';
export { UserService } from './user.service';         // NEW
export type { User, CreateUserDto } from './user.types'; // NEW
```

**If barrel doesn't exist:**
- Do NOT create one — the project may not use barrel files
- Check parent directory for a barrel that re-exports from subdirectories
- If no barrel pattern exists anywhere in the project, skip this step

### Phase 3: Update Dependency Injection

Detect the DI framework in use:

| DI Pattern | Detection | Integration |
|------------|-----------|-------------|
| **NestJS** | `@Module`, `@Injectable` decorators | Add to module's `providers` and `exports` arrays |
| **TypeDI / TSyringe** | `@injectable()` or `@Service()` | Auto-wired (no registration needed) |
| **Inversify** | `Container.bind()` | Add `container.bind<T>(TYPES.X).to(X)` |
| **Awilix** | `diContainer.register()` | Add `diContainer.register('x', asClass(X))` |
| **Manual** | `new Service()` in construction | Add to factory or configuration class |
| **Express/Fastify DI** | Middleware array patterns | No action needed (manual wiring) |

**For each service/class detected in Phase 1:**
```typescript
// NestJS
@Module({
  providers: [UserService],  // ADD
  exports: [UserService],    // ADD if used externally
})

// Inversify
container.bind<UserService>(TYPES.UserService).to(UserService);  // ADD

// Awilix
diContainer.register({
  userService: asClass(UserService),  // ADD
});
```

### Phase 4: Route Wiring

For each controller or route handler, wire it into the route system:

**Express-style (router-based):**
```typescript
// Existing pattern
import { Router } from 'express';
import { AuthController } from './controllers/auth.controller';
const router = Router();

router.post('/login', AuthController.login);

// After: add new routes
import { UserController } from './controllers/user.controller';  // NEW
router.get('/users/:id', UserController.getUser);                 // NEW
router.post('/users', UserController.createUser);                 // NEW
```

**NestJS-style (decorator-based):**
- Controllers are auto-wired when added to `@Module({ controllers: [...] })`
- Add the controller to the module's `controllers` array

**Fastify-style:**
```typescript
// Existing pattern
app.get('/users/:id', userController.getUser);

// After: add new routes
app.post('/users', userController.createUser);
```

### Phase 5: Import Verification

After all wiring changes, verify that all imports resolve correctly:

```bash
# Check that imported modules exist
for import_path in $(grep -r "from '" src/wiring-file.ts | grep -o "'[^']*'" | tr -d "'"); do
  resolved=$(node -e "console.log(require.resolve('$import_path'))" 2>/dev/null)
  if [ -z "$resolved" ]; then
    echo "BROKEN IMPORT: $import_path in wiring-file.ts"
  fi
done
```

If broken imports are found:
1. Fix the import path
2. Re-run verification
3. If unresolvable, report to Orchestrator with the specific path

---

## Output Contract

```
---
status: "completed" | "failed" | "partial"
resultSummary: "Summary of wiring changes applied"
agentOutputs:
  integrator:
    status: "completed" | "failed" | "partial"
    resultSummary: "Brief summary of integrations performed"
    buildPassed: true | false | null
    lintPassed: true | false | null
    buildOutput: "stdout + stderr from build run" | null
    lintOutput: "stdout + stderr from lint run" | null
    wiringSummary:
      barrelFilesUpdated:
        - "src/services/index.ts"
      diRegistrationsAdded:
        - "container.bind<UserService>(TYPES.UserService).to(UserService)"
      routesAdded:
        - method: "POST"
          path: "/api/users"
          handler: "UserController.createUser"
      importsFixed:
        - file: "src/controllers/user.controller.ts"
          from: "./user.service"
          to: "../services/user.service"
warnings:
  - "No barrel file found in src/services/ — skipped"
changedFiles:
  - "path/to/barrel/or/wiring/file.ts"
artifacts:
  - "Integration report"
---
```

**Import Verification (Mandatory):** After all wiring changes, run the build command. If the build fails with import errors, fix them and rebuild. Return full build output.

---

## Hard Rules

- ❌ NEVER modify the implementation files created by Implementors — only modify wiring files
- ❌ NEVER create a barrel file if the project doesn't use that pattern
- ❌ NEVER restructure existing wiring — only append to it
- ❌ NEVER assume the DI pattern — always detect it from existing code first
- ✅ ALWAYS detect the project's wiring conventions before making changes
- ✅ ALWAYS run the build after wiring changes to verify imports resolve
- ✅ ALWAYS fix broken imports before reporting completion
- ✅ ALWAYS report which barrel files, DI registrations, and routes were modified

## Parallel Dispatch Integration

The Integrator is the **merge coordinator** for parallel Implementor tasks:

```
Implementor A ──┐
                 ├──► Integrator ──► Build Gate
Implementor B ──┘
```

**Hand-off from Orchestrator:**
```
Orchestrator to Integrator:
"Implementors A and B have completed parallel implementation of the user-profile feature.
Files created by Implementor A: src/services/user.service.ts, src/controllers/user.controller.ts
Files created by Implementor B: src/types/user.types.ts, src/middleware/validate.ts

The project uses NestJS-style DI with @Module decorators and Express router.
Find all wiring points and ensure these new files are properly integrated.
Run the build after wiring and fix any import errors."
```
