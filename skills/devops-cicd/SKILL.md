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

### 2. Containerization

#### Docker Best Practices
- **Multi-stage Builds**: Separate build-time dependencies from runtime to minimize image size.
- **Minimal Base Images**: Use distroless or Alpine-based images for production.
- **Single Process Per Container**: Run one service per container for scalability and observability.
- **Health Checks**: Define HEALTHCHECK instructions for container orchestration.
- **.dockerignore**: Exclude unnecessary files (node_modules, .git, build artifacts) from the build context.
- **Non-Root User**: Run containers as a non-root user for security.
- **Immutable Tags**: Use versioned or commit-SHA tags, never `:latest` in production.

#### Docker Compose (Local Development)
- Use `docker-compose.yml` for local development environments.
- Mount source code as volumes for hot-reloading.
- Define service dependencies with `depends_on` and health checks.
- Use `.env` files for environment-specific configuration.

### 3. Deployment Strategies

#### Common Strategies
| Strategy | Use Case | Risk |
|----------|----------|------|
| **Rolling Update** | Zero-downtime updates | Slow rollback |
| **Blue/Green** | Instant rollback, production testing | Double infrastructure cost |
| **Canary** | Gradual rollout, reduced blast radius | Complex traffic routing |
| **Feature Flags** | Decoupled release from deploy | Flag management overhead |

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

### 5. Monitoring & Observability

#### Pillars of Observability
1. **Logs**: Structured, centralized logging (ELK, Loki, CloudWatch)
2. **Metrics**: Time-series data on system health (Prometheus, Datadog, CloudWatch)
3. **Traces**: Distributed tracing for request flow across services (Jaeger, OpenTelemetry, X-Ray)

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

### 7. Environment Management

- Maintain parity between environments (dev, staging, production) as much as possible.
- Use ephemeral environments for feature branch testing (Preview Deployments).
- Database seeding and sanitization for non-production environments.
- Environment-specific configuration via environment variables, not code changes.

## Workflow
When applying the DevOps & CI/CD skill:
1. **Analyze**: Review the current CI/CD and infrastructure setup.
2. **Identify**: Point out gaps, risks, or anti-patterns (e.g., "No security scanning in the pipeline", "Using :latest tag").
3. **Propose**: Suggest improvements following the principles above.
4. **Explain**: Describe the benefits of the proposed changes in terms of reliability, security, or developer productivity.
