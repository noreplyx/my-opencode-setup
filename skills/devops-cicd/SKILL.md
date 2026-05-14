---
name: devops-cicd
description: Use this skill when planning or implementing DevOps pipelines, CI/CD workflows, containerization, deployment strategies, and infrastructure-as-code to ensure reliable, scalable, and secure software delivery.
---

# DevOps & CI/CD Philosophy

This skill ensures that all DevOps, CI/CD, and infrastructure practices adhere to industry standards for reliability, scalability, security, and maintainability.

## References

Detailed content is organized into reference files for progressive loading:

| File | Content |
|------|---------|
| `references/ci-cd-and-containerization.md` | CI/CD pipeline design, containerization, database migrations |
| `references/deployment-and-infrastructure.md` | Deployment strategies, IaC (Terraform), environment management, GitOps |
| `references/monitoring-and-security.md` | Monitoring, security scanning, cost optimization, incident response |

## Core Principles (Summary)

### 1. CI/CD Pipeline
- **Stages**: Lint → TypeCheck → Unit Tests → Build → Integration Tests → Security Scan → Publish → Deploy
- **Fail fast** — early jobs catch issues before expensive ones run
- **Idempotent** — same result regardless of when run
- **Caching** — dependencies and Docker layers cached between runs

### 2. Containerization
- Multi-stage builds to minimize image size
- Minimal base images (Alpine, distroless)
- Single process per container
- HEALTHCHECK instruction for orchestration
- Non-root user for security
- Immutable tags (commit SHA, never `:latest`)

### 3. Deployment Strategies
| Strategy | Use Case | Risk |
|----------|----------|------|
| **Rolling** | Zero-downtime updates | Slow rollback |
| **Blue/Green** | Instant rollback | Double cost |
| **Canary** | Gradual rollout | Complex routing |
| **Feature Flags** | Decouple release from deploy | Flag management overhead |

### 4. Infrastructure as Code
- Declarative over imperative
- Version-controlled infrastructure
- Immutable infrastructure (replace, don't modify)
- Configuration drift detection

### 5. Security in the Pipeline
- Dependency scanning (npm audit, Snyk, Trivy)
- SAST (SonarQube, Semgrep, CodeQL)
- DAST (OWASP ZAP)
- Container scanning before deployment
- SBOM generation for audit compliance

### 6. Observability
- **3 Pillars**: Logs (structured), Metrics (Prometheus), Traces (Jaeger/OpenTelemetry)
- Health check endpoints (liveness + readiness)
- SLO-based alerting (alert on symptoms, not causes)

### 7. Cost Optimization
- Right-sizing instances based on profiling
- Spot instances for fault-tolerant workloads
- Auto-scaling based on CPU/memory utilization
- Delete unused resources (unattached volumes, stale EIPs)

### 8. Incident Response
| Severity | Response | Description |
|----------|----------|-------------|
| P0 | Immediate | Complete outage, data loss |
| P1 | 15 min | Major feature degradation |
| P2 | 1 hour | Partial degradation |
| P3 | 24 hours | Non-critical bug |

### 9. GitOps
- Git as single source of truth
- Automated reconciliation (ArgoCD, Flux)
- Pull-based deployments
- Drift detection and sync status visibility

## Workflow

When applying the DevOps & CI/CD skill:

1. **Analyze** — Review current CI/CD, Dockerfiles, deployment manifests, IaC, monitoring, and security scanning
2. **Identify** — Point out specific gaps, risks, or anti-patterns
3. **Propose** — Follow the principles above; provide concrete YAML/config/code snippets
4. **Explain** — Describe benefits in terms of reliability, security, productivity, or cost

## Tooling

This skill ships with automated check and scaffolding scripts:

| Script | Purpose | Usage |
|--------|---------|-------|
| `check-devops.ts` | Checks Dockerfile quality, CI/CD, env management, K8s configs | `ts-node <skills-dir>/scripts/devops-cicd/check-devops.ts --dir=<project-dir>` |
| `scaffold-docker.ts` | Generates Dockerfile, .dockerignore, docker-compose.yml | `ts-node <skills-dir>/scripts/devops-cicd/scaffold-docker.ts --dir=<project-dir> --type=node\|python\|go\|static [--port=3000]` |

```bash
# Run checks after setting up DevOps config
ts-node skills/scripts/devops-cicd/check-devops.ts --dir=./

# Scaffold Docker setup
ts-node skills/scripts/devops-cicd/scaffold-docker.ts --dir=./ --type=node --port=3000
```

> **For detailed patterns and code examples**, see the reference files:
> - `references/ci-cd-and-containerization.md` — Pipeline designs, Docker, migrations
> - `references/deployment-and-infrastructure.md` — Deployment, Terraform, GitOps
> - `references/monitoring-and-security.md` — Observability, security, cost, incident response
