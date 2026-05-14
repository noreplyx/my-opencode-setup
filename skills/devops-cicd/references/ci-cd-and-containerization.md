---
name: ci-cd-and-containerization
description: CI/CD pipeline design, containerization best practices, multi-stage Dockerfiles, Docker Compose, and database migration strategies in CI/CD.
---

### 1. CI/CD Pipeline Design

#### Pipeline Stages
A well-structured CI/CD pipeline should include these stages in order:
1. **Lint & Format**: Enforce code style and catch basic issues (eslint, prettier, ruff, etc.)
2. **Type Checking**: Verify type safety (TypeScript, mypy, etc.)
3. **Unit Tests**: Fast, isolated tests for individual modules
4. **Build**: Compile/bundle the application
5. **Integration Tests**: Test interactions between components
6. **Security Scan**: SAST/DAST scanning, dependency vulnerability checks
7. **Artifact Publishing**: Build and push Docker images, npm packages, etc.
8. **Deploy**: Deploy to target environment (staging → production)

#### Pipeline Best Practices
- **Fail Fast**: Fail early in the pipeline to provide rapid feedback.
- **Idempotency**: Pipeline runs should produce the same result regardless of when they run.
- **Deterministic Builds**: Use lock files (package-lock.json, yarn.lock, Poetry.lock) and pinned base images.
- **Caching**: Cache dependencies (node_modules, pip cache, Docker layers) between runs to speed up pipelines.
- **Secrets Management**: Never hardcode secrets in pipeline definitions. Use secret stores (GitHub Actions secrets, GitLab CI variables, Vault, etc.).

#### Pipeline Examples

**GitHub Actions — Full Pipeline:**
```yaml
name: CI/CD Pipeline
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck

  test:
    needs: lint-and-typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm test -- --coverage

  build-and-scan:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - name: Build Docker image
        run: docker build -t ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }} .
      - name: Scan with Trivy
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
          format: sarif
          output: trivy-results.sarif
      - name: Push image
        run: |
          echo "${{ secrets.GITHUB_TOKEN }}" | docker login ${{ env.REGISTRY }} -u ${{ github.actor }} --password-stdin
          docker push ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}

  deploy-staging:
    needs: build-and-scan
    if: github.ref == 'refs/heads/develop'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to staging
        run: |
          kubectl set image deployment/myapp myapp=${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }} \
            --kubeconfig=${{ secrets.KUBECONFIG_STAGING }}
```

**GitLab CI — Full Pipeline:**
```yaml
stages:
  - lint
  - test
  - build
  - scan
  - deploy

variables:
  DOCKER_IMAGE: $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA

lint:
  stage: lint
  image: node:20
  script:
    - npm ci
    - npm run lint
    - npm run typecheck

test:
  stage: test
  image: node:20
  script:
    - npm ci
    - npm test -- --coverage

build:
  stage: build
  image: docker:24
  services:
    - docker:24-dind
  script:
    - docker build -t $DOCKER_IMAGE .
    - docker push $DOCKER_IMAGE

scan:
  stage: scan
  image: docker:24
  services:
    - docker:24-dind
  script:
    - docker pull $DOCKER_IMAGE
    - docker run --rm -v /var/run/docker.sock:/var/run/docker.sock
        aquasec/trivy image --severity HIGH,CRITICAL --exit-code 1 $DOCKER_IMAGE

deploy-staging:
  stage: deploy
  script:
    - kubectl set image deployment/myapp myapp=$DOCKER_IMAGE
  only:
    - develop
```

### 2. Containerization

#### Docker Best Practices
- **Multi-stage Builds**: Separate build-time dependencies from runtime to minimize image size.
- **Minimal Base Images**: Use distroless or Alpine-based images for production.
- **Single Process Per Container**: Run one service per container for scalability and observability.
- **Health Checks**: Define HEALTHCHECK instructions for container orchestration.
- **.dockerignore**: Exclude unnecessary files (node_modules, .git, build artifacts) from the build context.
- **Non-Root User**: Run containers as a non-root user for security.
- **Immutable Tags**: Use versioned or commit-SHA tags, never `:latest` in production.

#### Multi-stage Dockerfile Example
```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS production
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1
CMD ["node", "dist/server.js"]
```

#### .dockerignore Example
```
node_modules
.git
.gitignore
*.md
dist
.env
.env.*
coverage
tests
Dockerfile
docker-compose*.yml
```

#### Docker Compose (Local Development)
- Use `docker-compose.yml` for local development environments.
- Mount source code as volumes for hot-reloading.
- Define service dependencies with `depends_on` and health checks.
- Use `.env` files for environment-specific configuration.

```yaml
version: "3.9"
services:
  app:
    build:
      context: .
      target: builder
    ports:
      - "3000:3000"
    volumes:
      - .:/app
      - /app/node_modules
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgres://user:pass@db:5432/myapp
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: myapp
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user -d myapp"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
```

### 8. Database Migration in CI/CD

#### When to Run Migrations
- **Pre-deploy (recommended)**: Run migrations as a separate step before deploying new application code. This ensures the database schema is ready before the new code starts.
- **Post-deploy**: Run migrations after the new code is deployed (suits blue/green with backward-compatible changes).
- **Never in the same transaction as the deploy**: Keep migration and deploy as separate, observable steps.

#### Pipeline Migration Stage Example
```yaml
# GitHub Actions example
migrate-db:
  needs: build-and-scan
  if: github.ref == 'refs/heads/main'
  runs-on: ubuntu-latest
  environment: production
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 20
    - run: npm ci
    - name: Run database migrations
      run: npm run db:migrate:up
      env:
        DATABASE_URL: ${{ secrets.DATABASE_URL }}
    - name: Verify migration
      run: npm run db:verify
```

#### Rollback Strategy
- Every migration must have a corresponding down-migration.
- Rollbacks should be tested in staging before production.
- Never automate rollbacks — they require human judgment and approval.
- Keep migrations small and backward-compatible for at least one release cycle.
- Use migration versioning (timestamps or sequential numbers) to track order.

```
migrations/
├── V001__create_users_table.sql
├── V002__add_email_index.sql
├── V003__add_profile_table.sql
└── V004__add_role_column_to_users.sql
```
