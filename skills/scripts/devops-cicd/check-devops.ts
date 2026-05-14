#!/usr/bin/env ts-node
/**
 * DevOps/CI/CD Checker
 * 
 * Usage: ts-node check-devops.ts [--dir=<project-dir>] [--verbose]
 * 
 * Checks project for DevOps best practices:
 * - Dockerfile presence and quality (multi-stage, non-root user)
 * - CI/CD pipeline configuration
 * - Health check endpoints
 * - Environment variable management
 * - .dockerignore presence
 * - Deployment configuration
 */

import * as fs from 'fs';
import * as path from 'path';

interface DevOpsCheck {
  name: string;
  category: 'containerization' | 'ci-cd' | 'deployment' | 'config';
  status: 'pass' | 'fail' | 'warn';
  details: string;
  recommendation?: string;
}

function checkDevOps(rootDir: string): DevOpsCheck[] {
  const checks: DevOpsCheck[] = [];
  
  // 1. Dockerfile check
  const dockerfilePath = path.join(rootDir, 'Dockerfile');
  const hasDockerfile = fs.existsSync(dockerfilePath);
  
  checks.push({
    name: 'Dockerfile Present',
    category: 'containerization',
    status: hasDockerfile ? 'pass' : 'warn',
    details: hasDockerfile ? 'Dockerfile found' : 'No Dockerfile found',
    recommendation: !hasDockerfile ? 'Add a Dockerfile for containerized deployments.' : undefined,
  });
  
  if (hasDockerfile) {
    const dockerContent = fs.readFileSync(dockerfilePath, 'utf-8');
    
    // Multi-stage build check
    const hasMultiStage = dockerContent.includes('FROM') && dockerContent.includes('AS ');
    checks.push({
      name: 'Multi-Stage Build',
      category: 'containerization',
      status: hasMultiStage ? 'pass' : 'warn',
      details: hasMultiStage ? 'Multi-stage build detected' : 'Dockerfile does not use multi-stage builds',
      recommendation: !hasMultiStage ? 'Use multi-stage Dockerfile to separate build and runtime dependencies, reducing image size.' : undefined,
    });
    
    // Non-root user check
    const hasNonRoot = dockerContent.includes('USER ');
    checks.push({
      name: 'Non-Root User',
      category: 'containerization',
      status: hasNonRoot ? 'pass' : 'warn',
      details: hasNonRoot ? 'Non-root user configured in Dockerfile' : 'Dockerfile does not switch to non-root user',
      recommendation: !hasNonRoot ? 'Add USER directive to run as non-root user for security.' : undefined,
    });
    
    // Health check
    const hasHealthCheck = dockerContent.includes('HEALTHCHECK');
    checks.push({
      name: 'HEALTHCHECK Instruction',
      category: 'containerization',
      status: hasHealthCheck ? 'pass' : 'warn',
      details: hasHealthCheck ? 'HEALTHCHECK instruction detected' : 'No HEALTHCHECK instruction in Dockerfile',
      recommendation: !hasHealthCheck ? 'Add HEALTHCHECK instruction for container orchestration.' : undefined,
    });
    
    // Distroless/alpine base image
    const hasMinimalBase = /FROM.*(?:alpine|distroless|scratch)/i.test(dockerContent);
    checks.push({
      name: 'Minimal Base Image',
      category: 'containerization',
      status: hasMinimalBase ? 'pass' : 'warn',
      details: hasMinimalBase ? 'Uses minimal base image (alpine/distroless)' : 'Dockerfile may use a full-sized base image',
      recommendation: !hasMinimalBase ? 'Consider using Alpine or distroless base images for smaller, more secure containers.' : undefined,
    });
  }
  
  // 2. .dockerignore
  const hasDockerignore = fs.existsSync(path.join(rootDir, '.dockerignore'));
  checks.push({
    name: '.dockerignore Present',
    category: 'containerization',
    status: hasDockerignore ? 'pass' : 'warn',
    details: hasDockerignore ? '.dockerignore found' : 'No .dockerignore file',
    recommendation: !hasDockerignore ? 'Add .dockerignore to exclude node_modules, .git, and other unnecessary files from build context.' : undefined,
  });
  
  // 3. CI/CD check
  const ghActionsDir = path.join(rootDir, '.github', 'workflows');
  const hasGithubActions = fs.existsSync(ghActionsDir);
  checks.push({
    name: 'CI/CD Pipeline (GitHub Actions)',
    category: 'ci-cd',
    status: hasGithubActions ? 'pass' : 'warn',
    details: hasGithubActions 
      ? `Found ${fs.readdirSync(ghActionsDir).length} workflow files`
      : 'No GitHub Actions workflow found',
    recommendation: !hasGithubActions ? 'Add CI/CD pipeline with lint, test, build, and deploy stages.' : undefined,
  });
  
  // 4. Docker Compose for local dev
  const dockerComposeFiles = ['docker-compose.yml', 'docker-compose.yaml', 'docker-compose.local.yml'];
  const hasDockerCompose = dockerComposeFiles.some(f => fs.existsSync(path.join(rootDir, f)));
  checks.push({
    name: 'Docker Compose (Local Dev)',
    category: 'deployment',
    status: hasDockerCompose ? 'pass' : 'warn',
    details: hasDockerCompose ? 'Docker Compose file found' : 'No Docker Compose file for local development',
    recommendation: !hasDockerCompose ? 'Add docker-compose.yml for local development with dependent services (DB, cache).' : undefined,
  });
  
  // 5. .env management
  const hasEnvExample = fs.existsSync(path.join(rootDir, '.env.example'));
  checks.push({
    name: 'Environment Variable Template',
    category: 'config',
    status: hasEnvExample ? 'pass' : 'fail',
    details: hasEnvExample ? '.env.example found' : 'No .env.example file for environment documentation',
    recommendation: !hasEnvExample ? 'Create .env.example documenting all required environment variables with placeholder values.' : undefined,
  });
  
  // 6. Kubernetes manifests
  const k8sDir = path.join(rootDir, 'k8s') || path.join(rootDir, 'kubernetes');
  const hasK8s = fs.existsSync(path.join(rootDir, 'k8s')) || fs.existsSync(path.join(rootDir, 'kubernetes'));
  checks.push({
    name: 'Kubernetes Manifests',
    category: 'deployment',
    status: hasK8s ? 'pass' : 'warn',
    details: hasK8s ? 'Kubernetes manifests directory found' : 'No Kubernetes manifests found',
    recommendation: !hasK8s ? 'For production deployments, add Kubernetes manifests (deployment, service, configmap, secrets).' : undefined,
  });
  
  return checks;
}

async function main(): Promise<void> {
  const rootDir = process.argv.find(a => a.startsWith('--dir='))?.split('=')[1] || process.cwd();
  const verbose = process.argv.includes('--verbose');
  
  console.log(`🔧 Running DevOps/CICD Check on: ${rootDir}\n`);
  
  const checks = checkDevOps(rootDir);
  
  const passed = checks.filter(c => c.status === 'pass').length;
  const failed = checks.filter(c => c.status === 'fail').length;
  const warnings = checks.filter(c => c.status === 'warn').length;
  
  console.log(`## DevOps Readiness Report\n`);
  console.log(`**${passed}** passed | **${failed}** failed | **${warnings}** warnings\n`);
  
  const categories = [...new Set(checks.map(c => c.category))];
  for (const category of ['containerization', 'ci-cd', 'deployment', 'config']) {
    const catChecks = checks.filter(c => c.category === category);
    if (catChecks.length === 0) continue;
    
    const categoryName = category.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    console.log(`### ${categoryName}\n`);
    
    for (const check of catChecks) {
      const icon = check.status === 'pass' ? '✅' : check.status === 'fail' ? '❌' : '⚠️';
      console.log(`${icon} **${check.name}**: ${check.details}`);
      if (check.status !== 'pass' && check.recommendation && verbose) {
        console.log(`   💡 ${check.recommendation}`);
      }
    }
    console.log();
  }
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
