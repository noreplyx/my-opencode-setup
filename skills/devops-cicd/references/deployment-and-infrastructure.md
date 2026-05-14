---
name: deployment-and-infrastructure
description: Deployment strategies (rolling, blue/green, canary), Infrastructure as Code with Terraform, environment management with ConfigMaps and Secrets, and GitOps workflow with ArgoCD and Flux.
---

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
