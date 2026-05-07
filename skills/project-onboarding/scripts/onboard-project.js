#!/usr/bin/env node

/**
 * Project Onboarding Script
 * 
 * Scans a Node.js/TypeScript project and generates:
 * - ARCHITECTURE.md  — Tech stack, directory tree, architecture diagram, data flow
 * - GLOSSARY.md      — Domain terms and abbreviations
 * - SETUP.md         — Prerequisites, installation, env config, commands
 * - WALKTHROUGH.md   — File reading order, entry point guide, request tracing
 * 
 * Usage:
 *   node onboard-project.js --dir /path/to/project [--output /path/to/output] [--yes]
 * 
 * Options:
 *   --dir     Path to the project root (required)
 *   --output  Path to write output files (default: same as --dir)
 *   --yes     Auto-accept file overwrites without prompting
 *   --help    Show this help message
 */

const fs = require('fs');
const path = require('path');

// ─── CLI Argument Parsing ───────────────────────────────────────────────

function parseArgs() {
  const args = { dir: null, output: null, yes: false };

  for (let i = 2; i < process.argv.length; i++) {
    switch (process.argv[i]) {
      case '--dir':
        args.dir = path.resolve(process.argv[++i]);
        break;
      case '--output':
        args.output = path.resolve(process.argv[++i]);
        break;
      case '--yes':
        args.yes = true;
        break;
      case '--help':
        printUsage();
        process.exit(0);
    }
  }

  if (!args.dir) {
    console.error('Error: --dir is required');
    printUsage();
    process.exit(1);
  }

  if (!args.output) {
    args.output = args.dir;
  }

  return args;
}

function printUsage() {
  console.log(`
Usage: node onboard-project.js --dir /path/to/project [options]

Options:
  --dir PATH     Path to the project root (required)
  --output PATH  Path to write output files (default: same as --dir)
  --yes          Auto-accept file overwrites without prompting
  --help         Show this help message
`);
}

// ─── Project Scan ───────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.cache',
  'coverage', '__pycache__', '.venv', '.svn',
]);

const SKIP_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.DS_Store',
]);

const TECH_CATEGORIES = {
  framework: ['react', 'next', 'vue', 'angular', 'express', 'fastify', 'nest', 'hono', 'nuxt', 'svelte'],
  database: ['prisma', 'typeorm', 'mongoose', 'pg', 'mysql2', 'redis', 'ioredis', 'drizzle', 'knex'],
  testing: ['jest', 'vitest', 'mocha', 'playwright', 'cypress', 'supertest', 'ava', 'tap'],
  linting: ['eslint', 'prettier', 'oxlint', 'biome', 'stylelint'],
  build: ['typescript', 'webpack', 'vite', 'esbuild', 'rollup', 'tsup', 'parcel'],
};

function scanProject(projectDir) {
  const profile = {
    name: 'Unknown Project',
    version: '0.0.0',
    description: '',
    techStack: { runtime: 'Node.js', language: 'JavaScript', framework: [], database: [], testing: [], linting: [], build: [] },
    nodeVersion: null,
    scripts: {},
    dependencies: {},
    devDependencies: {},
    hasTypeScript: false,
    tsconfig: null,
    dockerCompose: null,
    envExample: null,
    dirTree: '',
    entryPoints: [],
    configFiles: [],
    hasReadme: false,
    readmeContent: '',
  };

  // Read package.json
  const pkgPath = path.join(projectDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      profile.name = pkg.name || profile.name;
      profile.version = pkg.version || profile.version;
      profile.description = pkg.description || '';
      profile.scripts = pkg.scripts || {};
      profile.dependencies = pkg.dependencies || {};
      profile.devDependencies = pkg.devDependencies || {};
      profile.nodeVersion = pkg.engines?.node || null;

      // Categorize tech stack
      const allDeps = { ...profile.dependencies, ...profile.devDependencies };
      for (const [category, keywords] of Object.entries(TECH_CATEGORIES)) {
        profile.techStack[category] = keywords.filter(k => allDeps[k]);
      }

      // Detect language
      if (allDeps.typescript || fs.existsSync(path.join(projectDir, 'tsconfig.json'))) {
        profile.techStack.language = 'TypeScript';
        profile.hasTypeScript = true;
      }
    } catch (err) {
      console.warn(`Warning: Could not parse package.json: ${err.message}`);
    }
  }

  // Read tsconfig.json
  const tsconfigPath = path.join(projectDir, 'tsconfig.json');
  if (fs.existsSync(tsconfigPath)) {
    try {
      profile.tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'));
      profile.hasTypeScript = true;
      profile.techStack.language = 'TypeScript';
    } catch (err) {
      console.warn(`Warning: Could not parse tsconfig.json: ${err.message}`);
    }
  }

  // Read docker-compose.yml
  for (const name of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
    const dcPath = path.join(projectDir, name);
    if (fs.existsSync(dcPath)) {
      try {
        profile.dockerCompose = fs.readFileSync(dcPath, 'utf-8');
      } catch (err) {
        console.warn(`Warning: Could not read ${name}: ${err.message}`);
      }
      break;
    }
  }

  // Read .env.example
  const envPath = path.join(projectDir, '.env.example');
  if (fs.existsSync(envPath)) {
    try {
      profile.envExample = fs.readFileSync(envPath, 'utf-8');
    } catch (err) {
      console.warn(`Warning: Could not read .env.example: ${err.message}`);
    }
  }

  // Read README.md
  for (const name of ['README.md', 'README', 'Readme.md']) {
    const readmePath = path.join(projectDir, name);
    if (fs.existsSync(readmePath)) {
      try {
        profile.readmeContent = fs.readFileSync(readmePath, 'utf-8');
        profile.hasReadme = true;
      } catch (err) {
        console.warn(`Warning: Could not read ${name}: ${err.message}`);
      }
      break;
    }
  }

  // Build directory tree
  profile.dirTree = buildDirectoryTree(projectDir, projectDir, 0, 3);

  // Find entry points
  profile.entryPoints = findEntryPoints(projectDir);

  // Find config files
  profile.configFiles = findConfigFiles(projectDir);

  return profile;
}

function buildDirectoryTree(rootDir, currentDir, depth, maxDepth) {
  if (depth > maxDepth) return '';

  const indent = '  '.repeat(depth);
  const relativePath = path.relative(rootDir, currentDir) || '.';
  let tree = '';

  try {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
      .filter(entry => {
        if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) return false;
        if (!entry.isDirectory() && SKIP_FILES.has(entry.name)) return false;
        return true;
      })
      .sort((a, b) => {
        // Directories first, then alphabetical
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        tree += `${indent}${entry.name}/\n`;
        tree += buildDirectoryTree(rootDir, fullPath, depth + 1, maxDepth);
      } else {
        tree += `${indent}${entry.name}\n`;
      }
    }
  } catch (err) {
    tree += `${indent}[Error reading directory: ${err.message}]\n`;
  }

  return tree;
}

function findEntryPoints(rootDir) {
  const patterns = ['main.ts', 'index.ts', 'app.ts', 'server.ts', 'main.js', 'index.js', 'app.js'];
  const entryPoints = [];

  function walk(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) {
            walk(path.join(dir, entry.name));
          }
        } else if (patterns.includes(entry.name)) {
          const fullPath = path.join(dir, entry.name);
          entryPoints.push(path.relative(rootDir, fullPath));
        }
      }
    } catch (err) {
      // Skip directories we can't read
    }
  }

  walk(rootDir);
  return [...new Set(entryPoints)].sort();
}

function findConfigFiles(rootDir) {
  const configPatterns = [
    '.env.example', '.env', '.nvmrc', '.node-version',
    '.eslintrc.js', '.eslintrc.json', '.eslintrc',
    '.prettierrc', '.prettierrc.js', '.prettierrc.json',
    'jest.config.js', 'jest.config.ts', 'vitest.config.ts', 'vitest.config.js',
    'tsconfig.json', 'docker-compose.yml', 'docker-compose.yaml',
    'Dockerfile', '.dockerignore',
    'Makefile', 'justfile',
    'webpack.config.js', 'vite.config.ts', 'vite.config.js',
  ];

  return configPatterns
    .filter(name => fs.existsSync(path.join(rootDir, name)))
    .sort();
}

// ─── Mermaid Diagram Generation ─────────────────────────────────────────

function generateMermaidDiagram(profile) {
  const edges = [];
  const nodes = new Set();

  // Client -> Entry
  if (profile.entryPoints.length > 0) {
    edges.push('  Client -->|HTTP| EntryPoint');
    nodes.add('  EntryPoint["App Entry"]');
  }

  // Entry -> Framework/Service
  const framework = profile.techStack.framework[0];
  if (framework) {
    nodes.add(`  Service["${framework.charAt(0).toUpperCase() + framework.slice(1)} Service"]`);
    edges.push('  EntryPoint --> Service');
  }

  // Service -> Database
  if (profile.techStack.database.length > 0) {
    const db = profile.techStack.database[0];
    nodes.add(`  DB[("${db.charAt(0).toUpperCase() + db.slice(1)}")]`);
    edges.push('  Service --> DB');
  }

  // Service -> Cache
  if (profile.techStack.database.some(d => d === 'redis' || d === 'ioredis')) {
    nodes.add('  Cache[("Redis Cache")]');
    edges.push('  Service -.-> Cache');
  }

  const diagram = [
    '```mermaid',
    'graph TD',
    ...nodes,
    '',
    ...edges,
    '```',
  ].join('\n');

  return diagram;
}

// ─── Document Generators ────────────────────────────────────────────────

function generateArchitectureMd(profile) {
  const dbList = profile.techStack.database.length > 0 ? profile.techStack.database.join(', ') : 'None';
  const testList = profile.techStack.testing.length > 0 ? profile.techStack.testing.join(', ') : 'None';
  const lintList = profile.techStack.linting.length > 0 ? profile.techStack.linting.join(', ') : 'None';
  const buildList = profile.techStack.build.length > 0 ? profile.techStack.build.join(', ') : 'None';
  const frameworkList = profile.techStack.framework.length > 0 ? profile.techStack.framework.join(', ') : 'None';

  const keyFiles = [];
  if (profile.entryPoints.length > 0) {
    keyFiles.push(...profile.entryPoints.slice(0, 3).map(f => `| \`${f}\` | Application entry point |`));
  }
  if (profile.configFiles.length > 0) {
    keyFiles.push(`| \`${profile.configFiles[0]}\` | Project configuration |`);
  }

  const mermaidDiagram = generateMermaidDiagram(profile);

  return `# Architecture Overview

## Project: ${profile.name}
${profile.description ? `> ${profile.description}` : ''}

## Tech Stack

| Category     | Technology                     |
|--------------|--------------------------------|
| Runtime      | ${profile.techStack.runtime} ${profile.nodeVersion ? `v${profile.nodeVersion}` : ''} |
| Language     | ${profile.techStack.language}  |
| Framework    | ${frameworkList}               |
| Database     | ${dbList}                      |
| Testing      | ${testList}                    |
| Linting      | ${lintList}                    |
| Build        | ${buildList}                   |

## Directory Structure

\`\`\`
${profile.name}/
${profile.dirTree}
\`\`\`

## Architecture Diagram

${mermaidDiagram}

## Key Files

| File                             | Purpose                          |
|----------------------------------|----------------------------------|
${keyFiles.length > 0 ? keyFiles.join('\n') : '| _No key files detected_ | _Run the project scan again_ |'}

${profile.entryPoints.length > 0 ? `## Entry Points

The following entry point files were found:

${profile.entryPoints.map(f => `- \`${f}\``).join('\n')}
` : ''}

## Data Flow

The typical request flow in this project follows this pattern:

\`\`\`
HTTP Request
    │
    ▼
[Entry Point] → [Controller/Handler] → [Service/Use Case] → [Repository/Data Access]
    │                                                              │
    ▼                                                              ▼
[Response] ← [Controller/Handler] ← [Service/Use Case] ← [Database/External API]
\`\`\`

## Configuration Files

${profile.configFiles.length > 0 ? profile.configFiles.map(f => `- \`${f}\``).join('\n') : 'No configuration files detected.'}

---

*Generated by OpenCode Project Onboarding System*
`;
}

function generateGlossaryMd(profile) {
  const terms = [];

  // Extract from tech stack
  const techTerms = {
    ORM: 'Object-Relational Mapping — technique for converting data between incompatible type systems',
    JWT: 'JSON Web Token — compact URL-safe token format used for authentication',
    REST: 'Representational State Transfer — architectural style for API design',
    API: 'Application Programming Interface — set of rules for software communication',
    SDK: 'Software Development Kit — collection of tools for building software',
    CLI: 'Command Line Interface — text-based interface for interacting with software',
    CI: 'Continuous Integration — practice of automatically building and testing code changes',
    CD: 'Continuous Delivery/Deployment — practice of automatically deploying code changes',
  };

  // Add tech terms that are relevant to detected stack
  if (profile.techStack.database.length > 0) terms.push({ term: 'ORM', definition: techTerms.ORM });
  if (profile.hasTypeScript) {
    terms.push({ term: 'TypeScript', definition: 'Typed superset of JavaScript that compiles to plain JavaScript' });
  }

  // Extract from package name
  const nameParts = profile.name.replace(/[_-]/g, ' ').split(' ');
  for (const part of nameParts) {
    const upper = part.toUpperCase();
    if (upper.length >= 2 && upper.length <= 5 && techTerms[upper]) {
      terms.push({ term: upper, definition: techTerms[upper] });
    }
  }

  // Add generic terms
  terms.push({ term: 'SPA', definition: 'Single Page Application — web app that loads a single HTML page' });
  terms.push({ term: 'SSR', definition: 'Server Side Rendering — rendering web pages on the server instead of the browser' });

  // Deduplicate
  const seen = new Set();
  const uniqueTerms = terms.filter(t => {
    const key = t.term;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return `# Glossary

This glossary defines common terms and abbreviations used in this project.

| Term          | Definition                                                                          |
|---------------|-------------------------------------------------------------------------------------|
${uniqueTerms.map(t => `| **${t.term}** | ${t.definition} |`).join('\n')}

---

## Project-Specific Terms

${profile.description ? `- **${profile.name}**: ${profile.description}` : ''}
${profile.techStack.framework.length > 0 ? `- **${profile.techStack.framework[0].charAt(0).toUpperCase() + profile.techStack.framework[0].slice(1)}**: The web framework used in this project` : ''}
${profile.techStack.database.length > 0 ? profile.techStack.database.map(d => `- **${d.charAt(0).toUpperCase() + d.slice(1)}**: Database technology used in this project`).join('\n') : ''}

---

*Generated by OpenCode Project Onboarding System*
`;
}

function generateSetupMd(profile) {
  const nodeReq = profile.nodeVersion ? `>= ${profile.nodeVersion}` : '>= 18.0.0';
  const hasTypeScript = profile.hasTypeScript;

  const scriptRows = Object.entries(profile.scripts)
    .filter(([name]) => !name.startsWith('pre') && !name.startsWith('post'))
    .slice(0, 10)
    .map(([name, cmd]) => `| \`npm run ${name}\` | ${cmd} |`)
    .join('\n');

  return `# Setup Guide

## Prerequisites

- **Node.js** ${nodeReq}
- **npm** >= 9.0.0 (comes with Node.js)
${profile.dockerCompose ? '- **Docker** (optional, for local database/ services)' : ''}

## Quick Start

### 1. Install Dependencies

\`\`\`bash
npm install
\`\`\`

${profile.envExample ? `### 2. Configure Environment

Copy the example environment file and fill in the values:

\`\`\`bash
cp .env.example .env
\`\`\`

Then edit \`.env\` with your local configuration.
` : ''}

${profile.dockerCompose ? `### ${profile.envExample ? '3' : '2'}. Start Required Services

If the project requires a database or other services:

\`\`\`bash
docker compose up -d
\`\`\`
` : ''}

### ${profile.envExample ? profile.dockerCompose ? '4' : '3' : profile.dockerCompose ? '3' : '2'}. Run the Project

Start the development server:

\`\`\`bash
npm run dev
\`\`\`

${hasTypeScript ? `### Build for Production

\`\`\`bash
npm run build
\`\`\`
` : ''}

## Available Commands

| Command              | Description                                               |
|----------------------|-----------------------------------------------------------|
${scriptRows || '| _(No scripts detected in package.json)_ | |'}

## Project Files

- **Entry point**: ${profile.entryPoints[0] || 'Not detected'}
${profile.configFiles.length > 0 ? `- **Configuration**: ${profile.configFiles.slice(0, 5).join(', ')}` : ''}

## Troubleshooting

\`\`\`bash
# Clear npm cache if install fails
npm cache clean --force

# Remove node_modules and reinstall
rm -rf node_modules && npm install

# Check Node.js version
node --version
\`\`\`

---

*Generated by OpenCode Project Onboarding System*
`;
}

function generateWalkthroughMd(profile) {
  return `# Walkthrough Guide

## Suggested Reading Order

To understand this project efficiently, read the files in this order:

${profile.entryPoints.length > 0 ? `### 1. Start with Entry Points

Begin by understanding how the application starts:

${profile.entryPoints.map((f, i) => `${i + 1}. \`${f}\` — The main entry point`).join('\n')}
` : ''}

### 2. Configuration

Review how the project is configured:
${profile.configFiles.slice(0, 5).map(f => `- \`${f}\``).join('\n') || '- No configuration files detected'}

### 3. Core Logic

After understanding the entry points, explore the core application code:
- Look in \`src/\` or \`lib/\` directories for the main business logic
- Services/Use Cases contain the core business rules
- Controllers/Handlers manage HTTP requests and responses

### 4. Data Layer

- Repository files manage database access
- Entity/Model files define data structures
- Migration files track database schema changes

## Entry Point Analysis

${profile.entryPoints.length > 0 ? `The main entry point \`${profile.entryPoints[0]}\` is where the application starts. It typically:

1. Loads environment configuration
2. Sets up middleware and plugins
3. Registers routes and handlers
4. Connects to databases and services
5. Starts the HTTP server

To understand the full request lifecycle, trace a request from this entry point through the system.` : 'No entry points detected. The project may use a different structure.'}

## Follow a Request

When a request arrives, here is the typical path it follows through the system:

\`\`\`
1. HTTP Request arrives
2. Router matches the URL to a route handler
3. Middleware processes the request (auth, logging, validation)
4. Controller/Handler extracts parameters and calls the service
5. Service executes business logic (validations, calculations)
6. Service calls repository/data layer to persist or retrieve data
7. Response is built and returned through the chain
\`\`\`

## Development Conventions

This project follows standard Node.js/TypeScript conventions:

- **Naming**: camelCase for variables/functions, PascalCase for classes/types
- **Imports**: ES module imports (\`import\` / \`export\`)
- **Error Handling**: Async/await with try/catch
- **Testing**: Tests located near source files or in a \`tests/\` directory

## Getting Help

- Read the project README for additional documentation
- Check inline code comments for implementation details
- Use the Glossary (GLOSSARY.md) for unfamiliar terms

---

*Generated by OpenCode Project Onboarding System*
`;
}

// ─── Doc Writing ────────────────────────────────────────────────────────

async function writeDocs(outputDir, docs) {
  const results = [];

  for (const [name, content] of Object.entries(docs)) {
    const filePath = path.join(outputDir, `${name}.md`);

    // Check if file exists
    if (fs.existsSync(filePath)) {
      try {
        const prompts = require('prompts');
        const response = await prompts({
          type: 'confirm',
          name: 'overwrite',
          message: `"${name}.md" already exists. Overwrite?`,
          initial: false,
        });
        if (!response.overwrite) {
          console.log(`⏭️  Skipped ${name}.md`);
          results.push({ name, status: 'skipped', path: filePath });
          continue;
        }
      } catch (err) {
        // If prompts fails (e.g., non-interactive), fall back to overwriting
        console.log(`Note: ${name}.md exists, overwriting (non-interactive mode)`);
      }
    }

    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`✅ Created ${name}.md`);
    results.push({ name, status: 'created', path: filePath });
  }

  return results;
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  console.log(`\n🔍 Scanning project: ${args.dir}\n`);

  const profile = scanProject(args.dir);

  console.log(`📦 Project: ${profile.name}`);
  console.log(`📝 Language: ${profile.techStack.language}`);
  console.log(`📁 Files found: ${profile.entryPoints.length} entry points, ${profile.configFiles.length} config files\n`);

  // Generate docs
  console.log('📄 Generating documentation...\n');

  const docs = {
    ARCHITECTURE: generateArchitectureMd(profile),
    GLOSSARY: generateGlossaryMd(profile),
    SETUP: generateSetupMd(profile),
    WALKTHROUGH: generateWalkthroughMd(profile),
  };

  // Write files
  const results = await writeDocs(args.output, docs);

  console.log(`\n✅ Onboarding documentation generated in: ${args.output}\n`);

  for (const r of results) {
    console.log(`   ${r.status === 'created' ? '✅' : '⏭️ '} ${r.name}.md -> ${r.path}`);
  }

  console.log('');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
