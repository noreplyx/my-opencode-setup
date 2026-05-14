#!/usr/bin/env ts-node
/**
 * Dockerfile Scaffolder
 * 
 * Usage: ts-node scaffold-docker.ts [--dir=<project-dir>] [--type=node|python|go|static] [--port=3000]
 * 
 * Generates production-ready Dockerfile, .dockerignore, and docker-compose.yml
 */

import * as fs from 'fs';
import * as path from 'path';

const DOCKERFILES: Record<string, string> = {
  node: `# Multi-stage build for Node.js
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS production
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
USER appuser
EXPOSE PORT_PLACEHOLDER
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD wget --no-verbose --tries=1 --spider http://localhost:PORT_PLACEHOLDER/health || exit 1
CMD ["node", "dist/server.js"]
`,
  python: `FROM python:3.12-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

FROM python:3.12-slim
RUN addgroup --system appgroup && adduser --system --group appuser
WORKDIR /app
COPY --from=builder /app /app
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
USER appuser
EXPOSE PORT_PLACEHOLDER
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:PORT_PLACEHOLDER/health')" || exit 1
CMD ["python", "app.py"]
`,
  go: `FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/server .

FROM scratch
COPY --from=builder /app/server /server
EXPOSE PORT_PLACEHOLDER
CMD ["/server"]
`,
  static: `FROM nginx:alpine
COPY nginx.conf /etc/nginx/nginx.conf
COPY . /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`,
};

function createDockerfile(rootDir: string, type: string, port: string): void {
  const template = DOCKERFILES[type] || DOCKERFILES.node;
  const content = template.replace(/PORT_PLACEHOLDER/g, port);
  const dockerfilePath = path.join(rootDir, 'Dockerfile');
  fs.writeFileSync(dockerfilePath, content, 'utf-8');
  console.log(`✅ Created Dockerfile (${type}, port ${port})`);
}

function createDockerignore(rootDir: string): void {
  const content = `node_modules
.git
.gitignore
*.md
.env
.env.*
coverage
tests
Dockerfile
docker-compose*.yml
`;
  const dockerignorePath = path.join(rootDir, '.dockerignore');
  fs.writeFileSync(dockerignorePath, content, 'utf-8');
  console.log('✅ Created .dockerignore');
}

function createDockerCompose(rootDir: string, port: string): void {
  const content = `version: "3.9"
services:
  app:
    build:
      context: .
      target: builder
    ports:
      - "${port}:${port}"
    volumes:
      - .:/app
      - /app/node_modules
    environment:
      - NODE_ENV=development
    env_file:
      - .env

  # Uncomment for PostgreSQL:
  # db:
  #   image: postgres:16-alpine
  #   ports:
  #     - "5432:5432"
  #   environment:
  #     POSTGRES_USER: user
  #     POSTGRES_PASSWORD: pass
  #     POSTGRES_DB: myapp
  #   volumes:
  #     - pgdata:/var/lib/postgresql/data
  #   healthcheck:
  #     test: ["CMD-SHELL", "pg_isready -U user -d myapp"]
  #     interval: 10s
  #     timeout: 5s
  #     retries: 5
  #
  # Uncomment for Redis:
  # redis:
  #   image: redis:7-alpine
  #   ports:
  #     - "6379:6379"
  #   healthcheck:
  #     test: ["CMD", "redis-cli", "ping"]
  #     interval: 10s
  #     timeout: 3s
  #     retries: 5

# volumes:
#   pgdata:
`;
  const composePath = path.join(rootDir, 'docker-compose.yml');
  fs.writeFileSync(composePath, content, 'utf-8');
  console.log('✅ Created docker-compose.yml');
}

async function main(): Promise<void> {
  const rootDir = process.argv.find(a => a.startsWith('--dir='))?.split('=')[1] || process.cwd();
  const type = process.argv.find(a => a.startsWith('--type='))?.split('=')[1] || 'node';
  const port = process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || '3000';
  
  console.log('🏗️  Scaffolding Docker configuration\n');
  
  if (!DOCKERFILES[type]) {
    console.error(`❌ Unknown type: ${type}. Available: ${Object.keys(DOCKERFILES).join(', ')}`);
    process.exit(1);
  }
  
  createDockerfile(rootDir, type, port);
  createDockerignore(rootDir);
  createDockerCompose(rootDir, port);
  
  console.log('\n✅ Docker scaffolding complete!');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
