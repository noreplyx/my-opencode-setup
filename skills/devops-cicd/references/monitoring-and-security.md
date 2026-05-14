---
name: monitoring-and-security
description: Monitoring and observability (Prometheus, structured logging, alerting), security scanning (SAST, DAST, container scanning, SBOM, Dependabot), cost optimization practices, and incident response with severity matrix and runbook templates.
---

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
