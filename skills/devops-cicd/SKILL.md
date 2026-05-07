---
name: devops-cicd
description: Use this skill when planning or implementing DevOps pipelines, CI/CD workflows, containerization, deployment strategies, and infrastructure-as-code to ensure reliable, scalable, and secure software delivery.
---

# DevOps & CI/CD Philosophy

This skill ensures that all DevOps, CI/CD, and infrastructure practices adhere to industry standards for reliability, scalability, security, and maintainability.

## Core Principles

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

### 3. Deployment Strategies

#### Common Strategies
| Strategy | Use Case | Risk |
|----------|----------|------|
| **Rolling Update** | Zero-downtime updates | Slow rollback |
| **Blue/Green** | Instant rollback, production testing | Double infrastructure cost |
| **Canary** | Gradual rollout, reduced blast radius | Complex traffic routing |
| **Feature Flags** | Decoupled release from deploy | Flag management overhead |

#### Kubernetes — Blue/Green Deployment
```yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp-service
spec:
  selector:
    app: myapp
    version: active  # Switch label between blue/green
  ports:
    - port: 80
      targetPort: 3000
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-blue
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
      version: blue
  template:
    metadata:
      labels:
        app: myapp
        version: blue
        version-active: "true"  # Currently active
    spec:
      containers:
        - name: myapp
          image: myapp:v1.2.3
          ports:
            - containerPort: 3000
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-green
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
      version: green
  template:
    metadata:
      labels:
        app: myapp
        version: green
        version-active: "false"  # Standby
    spec:
      containers:
        - name: myapp
          image: myapp:v1.3.0
          ports:
            - containerPort: 3000
```

To switch traffic: `kubectl patch service myapp-service -p '{"spec":{"selector":{"version-active":"true"}}}'`

#### Kubernetes — Canary Deployment (using Service Mesh annotations or istio)
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-canary
spec:
  replicas: 1  # 25% of total (3 stable + 1 canary)
  selector:
    matchLabels:
      app: myapp
      track: canary
  template:
    metadata:
      labels:
        app: myapp
        track: canary
    spec:
      containers:
        - name: myapp
          image: myapp:v1.4.0-rc1
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  annotations:
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-weight: "25"  # 25% traffic
spec:
  rules:
    - http:
        paths:
          - backend:
              service:
                name: myapp-canary-svc
                port:
                  number: 80
```

#### Rollback Strategy
- Always maintain the ability to roll back to the previous version.
- Database migrations should be backward-compatible for at least one release cycle.
- Use database migration tools (Flyway, Alembic, Prisma Migrate) with up/down migrations.

### 4. Infrastructure as Code (IaC)

#### Principles
- **Declarative over Imperative**: Declare desired state rather than scripting steps.
- **Version-Controlled Infrastructure**: All infrastructure definitions should be in Git.
- **Immutable Infrastructure**: Replace rather than modify running infrastructure.
- **Configuration Drift Detection**: Regularly verify actual state matches declared state.

#### Recommended Tools
- **Terraform/OpenTofu**: Multi-cloud infrastructure provisioning.
- **AWS CDK / Pulumi**: Infrastructure as code using general-purpose languages.
- **Ansible**: Configuration management and application deployment.
- **Kubernetes Manifests / Helm**: Container orchestration definitions.

#### Terraform Examples

**S3 Bucket with versioning and encryption:**
```hcl
resource "aws_s3_bucket" "app_assets" {
  bucket = "myapp-assets-${var.environment}"
  force_destroy = var.environment == "production" ? false : true
}

resource "aws_s3_bucket_versioning" "app_assets" {
  bucket = aws_s3_bucket.app_assets.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "app_assets" {
  bucket = aws_s3_bucket.app_assets.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
```

**VPC with public/private subnets:**
```hcl
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags = { Name = "myapp-${var.environment}" }
}

resource "aws_subnet" "public" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true
  tags = { Name = "myapp-public-${count.index}" }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index + 10}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags = { Name = "myapp-private-${count.index}" }
}
```

**ECS Fargate service:**
```hcl
resource "aws_ecs_cluster" "main" {
  name = "myapp-cluster-${var.environment}"
}

resource "aws_ecs_task_definition" "app" {
  family                   = "myapp-${var.environment}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_execution.arn

  container_definitions = jsonencode([
    {
      name      = "myapp"
      image     = "${var.container_image}"
      essential = true
      portMappings = [
        { containerPort = 3000, protocol = "tcp" }
      ]
      environment = [
        { name = "NODE_ENV", value = var.environment }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "app" {
  name            = "myapp-${var.environment}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.environment == "production" ? 3 : 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.ecs_tasks.id]
  }
}
```

### 5. Monitoring & Observability

#### Pillars of Observability
1. **Logs**: Structured, centralized logging (ELK, Loki, CloudWatch)
2. **Metrics**: Time-series data on system health (Prometheus, Datadog, CloudWatch)
3. **Traces**: Distributed tracing for request flow across services (Jaeger, OpenTelemetry, X-Ray)

#### Prometheus Metrics Endpoint Example (Node.js with prom-client)
```typescript
import express from "express";
import promClient from "prom-client";

const app = express();
const register = new promClient.Registry();

promClient.collectDefaultMetrics({ register });

const httpRequestDuration = new promClient.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register],
});

app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer();
  res.on("finish", () => {
    end({ method: req.method, route: req.route?.path ?? "unknown", status: res.statusCode });
  });
  next();
});

app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.send(await register.metrics());
});
```

#### Structured Logging Configuration (Node.js with pino)
```typescript
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  formatters: {
    level(label) { return { severity: label.toUpperCase() }; },
  },
  serializers: {
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
    err: pino.stdSerializers.err,
  },
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "password", "token"],
    censor: "[REDACTED]",
  },
  transport:
    process.env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});
```

#### Alerting
- Define SLOs (Service Level Objectives) and alert on SLI (Service Level Indicator) burn rates.
- Use on-call rotation and escalation policies.
- Avoid alert fatigue: alert on symptoms (errors, latency) not causes (CPU high).

### 6. Security in the Pipeline

- **Dependency Scanning**: Regularly scan for known vulnerabilities (npm audit, Snyk, Dependabot, Trivy).
- **SAST (Static Analysis)**: Scan source code for security issues (SonarQube, Semgrep, CodeQL).
- **DAST (Dynamic Analysis)**: Scan running applications for vulnerabilities (OWASP ZAP, Burp Suite).
- **Container Scanning**: Scan images for vulnerabilities before deployment (Trivy, Clair, Snyk).
- **SBOM (Software Bill of Materials)**: Generate and maintain an SBOM for audit and compliance.

#### Trivy Scan Commands
```bash
# Scan a container image
trivy image --severity HIGH,CRITICAL --exit-code 1 myapp:v1.2.3

# Scan a filesystem
trivy fs --severity MEDIUM,HIGH,CRITICAL .

# Scan a git repository
trivy repo --severity HIGH,CRITICAL https://github.com/org/myapp.git

# Generate SBOM in SPDX format
trivy image --format spdx-json --output sbom.spdx.json myapp:v1.2.3

# Scan IaC files (Terraform, K8s, etc.)
trivy config --severity HIGH,CRITICAL ./infrastructure/
```

#### SBOM Generation (with syft)
```bash
# Generate SBOM for a container image
syft myapp:v1.2.3 -o cyclonedx-json=sbom.cyclonedx.json

# Generate SBOM for a project directory
syft dir:. -o spdx-json=sbom.spdx.json
```

#### Dependabot Configuration (.github/dependabot.yml)
```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "09:00"
      timezone: "Asia/Bangkok"
    open-pull-requests-limit: 10
    labels:
      - "dependencies"
      - "automerge"
    versioning-strategy: increase
    ignore:
      - dependency-name: "eslint"
        versions: [">=9.x"]

  - package-ecosystem: "docker"
    directory: "/"
    schedule:
      interval: "weekly"

  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

### 7. Environment Management

- Maintain parity between environments (dev, staging, production) as much as possible.
- Use ephemeral environments for feature branch testing (Preview Deployments).
- Database seeding and sanitization for non-production environments.
- Environment-specific configuration via environment variables, not code changes.

#### Environment-Specific Configuration

**`.env.example` file:**
```env
# Application
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug

# Database
DATABASE_URL=postgres://user:pass@localhost:5432/myapp
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10

# Redis
REDIS_URL=redis://localhost:6379

# External Services
API_BASE_URL=http://localhost:4000
AUTH0_DOMAIN=myapp-dev.auth0.com
AUTH0_AUDIENCE=https://api.dev.myapp.com

# Feature Flags
FEATURE_NEW_CHECKOUT=true
FEATURE_DARK_MODE=false
```

**Kubernetes ConfigMap (non-sensitive):**
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: myapp-config
  namespace: production
data:
  NODE_ENV: "production"
  PORT: "3000"
  LOG_LEVEL: "info"
  API_BASE_URL: "https://api.myapp.com"
  DATABASE_POOL_MIN: "5"
  DATABASE_POOL_MAX: "25"
  FEATURE_NEW_CHECKOUT: "true"
  FEATURE_DARK_MODE: "true"
```

**Kubernetes Secret (sensitive):**
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: myapp-secrets
  namespace: production
type: Opaque
stringData:
  DATABASE_URL: "postgres://user:${DB_PASSWORD}@prod-db.cluster-xxx.us-east-1.rds.amazonaws.com:5432/myapp"
  REDIS_URL: "redis://:${REDIS_PASSWORD}@prod-redis.cluster-xxx.us-east-1.amazonaws.com:6379"
  AUTH0_CLIENT_SECRET: "${AUTH0_SECRET}"
```

**Consuming in a pod:**
```yaml
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
        - name: myapp
          envFrom:
            - configMapRef:
                name: myapp-config
            - secretRef:
                name: myapp-secrets
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

### 9. Cost Optimization

#### Right-Sizing
- **Compute**: Select appropriate instance sizes based on application profiling (CPU vs. memory bound). Use tools like AWS Compute Optimizer.
- **Storage**: Use appropriate storage tiers (SSD for databases, standard for backups, Glacier for archives).
- **Reserved Instances / Savings Plans**: Commit to 1-3 year terms for stable workloads (up to 60% savings).

#### Spot Instances (AWS EC2 / EKS Fargate)
```hcl
# Terraform — EKS managed node group with spot instances
resource "aws_eks_node_group" "spot" {
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "myapp-spot"
  instance_types  = ["t3.medium", "t3a.medium", "m5.large"]
  capacity_type   = "SPOT"

  scaling_config {
    desired_size = 2
    min_size     = 1
    max_size     = 10
  }
}
```

#### Auto-Scaling Policies
```yaml
# Kubernetes Horizontal Pod Autoscaler
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: myapp-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: myapp
  minReplicas: 2
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

#### Additional Cost Practices
- Delete unused resources (unattached volumes, stale load balancers, orphaned EIPs).
- Use lifecycle policies to expire old S3 data and ECR images.
- Implement namespace/resource quotas in Kubernetes to prevent runaway resource consumption.
- Tag all resources with `Environment`, `Project`, `CostCenter` for chargeback tracking.

### 10. Incident Response

#### Alert Severity Definitions
| Severity | Label | Response Time | Description |
|----------|-------|---------------|-------------|
| **P0** | Critical | Immediate | Complete service outage, data loss, security breach |
| **P1** | High | 15 minutes | Major feature degradation affecting many users |
| **P2** | Medium | 1 hour | Partial degradation, single user impact |
| **P3** | Low | 24 hours | Non-critical bug, cosmetic issue |
| **P4** | Informational | Next sprint | Log noise, minor warnings |

#### Runbook Template
```markdown
# Incident Runbook: [Incident Name]

## Description
Brief description of what this runbook covers.

## Symptoms
- Symptom 1
- Symptom 2

## Severity
[P0/P1/P2/P3/P4]

## Initial Diagnosis
1. Check the dashboard: [link to dashboard]
2. Check logs: [link to log explorer with pre-built query]
3. Check recent deployments: `kubectl rollout history deployment/myapp`

## Resolution Steps
### Step 1: Immediate Mitigation
```bash
# Rollback to previous version
kubectl rollout undo deployment/myapp --to-revision=<N>
```

### Step 2: Root Cause Investigation
```bash
# Check pod status
kubectl get pods -n production | grep myapp

# Check pod logs
kubectl logs -n production deployment/myapp --tail=100
```

### Step 3: Permanent Fix
Describe the code/infrastructure change needed.

## Post-Mortem
- [ ] RCA documented
- [ ] Monitoring/alerting improved
- [ ] Playbook updated
- [ ] Blameless post-mortem conducted

## Escalation Contacts
- Primary On-Call: @slack-handle
- Secondary: @slack-handle
- Engineering Manager: @slack-handle
```

#### Escalation Paths
1. **Tier 1** — On-call engineer (auto-paged by PagerDuty/Opsgenie)
2. **Tier 2** — Senior engineer / team lead (escalated after 15 min no response for P0)
3. **Tier 3** — Engineering manager (escalated after 30 min for P0)
4. **Tier 4** — VP / Director (escalated after 1 hour for unresolved P0)

### 11. GitOps Workflow

#### Core Principles
- **Git as Single Source of Truth**: The Git repository contains the complete desired state of the system (application code + infrastructure config).
- **Automated Reconciliation**: A GitOps operator (ArgoCD, Flux) continuously ensures the live cluster state matches the Git repository state.
- **Pull-Based Deployments**: The operator pulls changes from Git and applies them to the cluster, rather than CI/CD pushing changes.
- **Observability**: Operators provide visibility into drift, sync status, and deployment history.

#### ArgoCD Application Example
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: myapp-production
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/org/myapp-gitops.git
    targetRevision: main
    path: kubernetes/overlays/production
  destination:
    server: https://kubernetes.default.svc
    namespace: production
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
      allowEmpty: false
    syncOptions:
      - CreateNamespace=true
      - ApplyOutOfSyncOnly=true
```

#### Flux (Kustomization) Example
```yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: myapp
  namespace: flux-system
spec:
  interval: 1m
  sourceRef:
    kind: GitRepository
    name: myapp-gitops
  path: ./kubernetes/overlays/production
  prune: true
  wait: true
  timeout: 5m
  postBuild:
    substitute:
      environment: "production"
      image_tag: "v1.2.3"
    substituteFrom:
      - kind: ConfigMap
        name: cluster-config
---
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: myapp-gitops
  namespace: flux-system
spec:
  interval: 1m
  url: https://github.com/org/myapp-gitops.git
  ref:
    branch: main
```

#### Repository Structure (GitOps)
```
myapp-gitops/
├── kubernetes/
│   ├── base/                          # Shared/base configurations
│   │   ├── kustomization.yaml
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   └── hpa.yaml
│   └── overlays/                      # Environment-specific overlays
│       ├── development/
│       │   ├── kustomization.yaml
│       │   ├── configmap-patch.yaml
│       │   └── replica-count.yaml
│       ├── staging/
│       │   ├── kustomization.yaml
│       │   └── ...patches
│       └── production/
│           ├── kustomization.yaml
│           └── ...patches
├── terraform/                         # Infrastructure definitions
└── docs/
    └── architecture.md
```

## Workflow
When applying the DevOps & CI/CD skill:
1. **Analyze**: Review the current CI/CD and infrastructure setup. Examine existing pipeline definitions, Dockerfiles, deployment manifests, IaC code, monitoring config, and security scanning setup. Identify what stages exist and what is missing.
2. **Identify**: Point out specific gaps, risks, or anti-patterns. Examples: "No security scanning in the pipeline", "Using :latest tag for production images", "No health checks in Dockerfile", "No database migration strategy", "Missing SLO definitions", "No cost tagging on cloud resources".
3. **Propose**: Suggest concrete improvements following the principles above. Provide code examples (YAML snippets, Dockerfile changes, Terraform HCL) that can be directly applied. Prioritize changes by impact (security fixes first, then reliability, then cost savings).
4. **Explain**: Describe the benefits of proposed changes in terms of reliability, security, developer productivity, or cost savings. Reference specific sections of this skill document to justify recommendations.
