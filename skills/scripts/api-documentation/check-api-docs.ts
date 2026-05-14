#!/usr/bin/env ts-node
/**
 * API Documentation Checker
 * 
 * Usage: ts-node check-api-docs.ts [--dir=<project-dir>] [--spec=<openapi-file>] [--verbose]
 * 
 * Checks OpenAPI/Swagger specifications for:
 * - Missing operationId on endpoints
 * - Missing request/response examples
 * - Missing error response schemas (4xx/5xx)
 * - Missing security scheme definitions
 * - Missing endpoint descriptions
 * - Missing version info
 */

import * as fs from 'fs';
import * as path from 'path';

interface OpenAPIIssue {
  path: string;
  method?: string;
  severity: 'error' | 'warning';
  rule: string;
  description: string;
}

function findSpecFiles(rootDir: string): string[] {
  const results: string[] = [];
  const candidates = ['openapi.yaml', 'openapi.yml', 'openapi.json', 'swagger.yaml', 'swagger.yml', 'swagger.json'];
  
  for (const candidate of candidates) {
    const full = path.join(rootDir, candidate);
    if (fs.existsSync(full)) results.push(full);
  }
  
  // Also search recursively
  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') walk(full);
      } else if (entry.isFile() && /^openapi|^swagger/.test(entry.name)) {
        if (!results.includes(full)) results.push(full);
      }
    }
  }
  walk(rootDir);
  
  return results;
}

function loadSpec(filePath: string): any {
  const content = fs.readFileSync(filePath, 'utf-8');
  if (filePath.endsWith('.json')) {
    return JSON.parse(content);
  }
  // Basic YAML-like parsing for simple cases
  // In production, use js-yaml library
  try {
    return JSON.parse(content);
  } catch {
    // Return parsed content structure
    return parseSimpleYaml(content);
  }
}

function parseSimpleYaml(content: string): any {
  const result: any = {};
  const lines = content.split('\n');
  let currentPath = result;
  const pathStack: any[] = [result];
  const indentStack: number[] = [0];
  
  for (const line of lines) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    
    const indent = line.search(/\S/);
    const trimmed = line.trim();
    
    while (indentStack.length > 0 && indent <= indentStack[indentStack.length - 1]) {
      pathStack.pop();
      indentStack.pop();
    }
    
    if (trimmed.endsWith(':')) {
      const key = trimmed.slice(0, -1);
      const newObj: any = {};
      pathStack[pathStack.length - 1][key] = newObj;
      pathStack.push(newObj);
      indentStack.push(indent);
    } else if (trimmed.includes(': ')) {
      const colonIdx = trimmed.indexOf(': ');
      const key = trimmed.substring(0, colonIdx);
      const value = trimmed.substring(colonIdx + 2);
      pathStack[pathStack.length - 1][key] = value;
    }
  }
  
  return result;
}

function analyzeSpec(spec: any, filePath: string): OpenAPIIssue[] {
  const issues: OpenAPIIssue[] = [];
  const relativePath = path.relative(process.cwd(), filePath);
  
  // Check info section
  if (!spec.info) {
    issues.push({ path: relativePath, severity: 'error', rule: 'info-required', description: 'Missing "info" section with API metadata' });
  } else {
    if (!spec.info.title) issues.push({ path: relativePath, severity: 'error', rule: 'info-title', description: 'Missing API title in info section' });
    if (!spec.info.version) issues.push({ path: relativePath, severity: 'error', rule: 'info-version', description: 'Missing API version in info section. Use semantic versioning (e.g., 1.0.0).' });
    if (!spec.info.description) issues.push({ path: relativePath, severity: 'warning', rule: 'info-description', description: 'Missing API description in info section' });
  }
  
  // Check servers section
  if (!spec.servers || spec.servers.length === 0) {
    issues.push({ path: relativePath, severity: 'warning', rule: 'servers-required', description: 'Missing "servers" section with base URLs' });
  }
  
  // Check paths
  if (!spec.paths || Object.keys(spec.paths).length === 0) {
    issues.push({ path: relativePath, severity: 'error', rule: 'paths-required', description: 'No API paths defined' });
    return issues;
  }
  
  for (const [pathUrl, pathItem] of Object.entries(spec.paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    
    const methods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];
    for (const method of methods) {
      const operation = (pathItem as any)[method];
      if (!operation) continue;
      
      // Check operationId
      if (!operation.operationId) {
        issues.push({
          path: relativePath,
          method: `${method.toUpperCase()} ${pathUrl}`,
          severity: 'warning',
          rule: 'operation-id',
          description: `Missing operationId for ${method.toUpperCase()} ${pathUrl}. Used for client SDK generation.`,
        });
      }
      
      // Check summary/description
      if (!operation.summary) {
        issues.push({
          path: relativePath,
          method: `${method.toUpperCase()} ${pathUrl}`,
          severity: 'warning',
          rule: 'operation-summary',
          description: `Missing summary for ${method.toUpperCase()} ${pathUrl}`,
        });
      }
      
      // Check responses
      if (!operation.responses) {
        issues.push({
          path: relativePath,
          method: `${method.toUpperCase()} ${pathUrl}`,
          severity: 'error',
          rule: 'responses-required',
          description: `Missing responses for ${method.toUpperCase()} ${pathUrl}`,
        });
      } else {
        // Check for error responses
        const hasErrorResponse = Object.keys(operation.responses).some((code: string) => {
          const numCode = parseInt(code);
          return numCode >= 400;
        });
        
        if (!hasErrorResponse) {
          issues.push({
            path: relativePath,
            method: `${method.toUpperCase()} ${pathUrl}`,
            severity: 'warning',
            rule: 'error-responses',
            description: `No error responses documented for ${method.toUpperCase()} ${pathUrl}. Add at least 4xx/5xx responses.`,
          });
        }
        
        // Check for response examples
        for (const [statusCode, response] of Object.entries(operation.responses)) {
          if (statusCode === '204' || statusCode === 'default') continue;
          const resp = response as any;
          if (resp.content) {
            for (const [contentType, mediaType] of Object.entries(resp.content)) {
              const mt = mediaType as any;
              if (!mt.example && (!mt.examples || Object.keys(mt.examples).length === 0)) {
                issues.push({
                  path: relativePath,
                  method: `${method.toUpperCase()} ${pathUrl}`,
                  severity: 'warning',
                  rule: 'response-examples',
                  description: `No response example for ${method.toUpperCase()} ${pathUrl} (${statusCode})`,
                });
              }
            }
          }
        }
      }
      
      // Check request body examples
      if (operation.requestBody && operation.requestBody.content) {
        for (const [contentType, mediaType] of Object.entries(operation.requestBody.content)) {
          const mt = mediaType as any;
          if (!mt.example && (!mt.examples || Object.keys(mt.examples).length === 0)) {
            issues.push({
              path: relativePath,
              method: `${method.toUpperCase()} ${pathUrl}`,
              severity: 'warning',
              rule: 'request-examples',
              description: `No request body example for ${method.toUpperCase()} ${pathUrl}`,
            });
          }
        }
      }
    }
  }
  
  // Check security schemes
  if (!spec.components || !spec.components.securitySchemes) {
    issues.push({
      path: relativePath,
      severity: 'warning',
      rule: 'security-schemes',
      description: 'No security schemes defined in components/securitySchemes',
    });
  }
  
  return issues;
}

async function main(): Promise<void> {
  const rootDir = process.argv.find(a => a.startsWith('--dir='))?.split('=')[1] || process.cwd();
  const specPath = process.argv.find(a => a.startsWith('--spec='))?.split('=')[1];
  
  console.log(`📖 Running API Documentation Check on: ${rootDir}\n`);
  
  let specFiles: string[];
  if (specPath) {
    specFiles = [path.resolve(rootDir, specPath)];
  } else {
    specFiles = findSpecFiles(rootDir);
  }
  
  if (specFiles.length === 0) {
    console.log('No OpenAPI/Swagger specification files found.');
    process.exit(0);
  }
  
  console.log(`Found ${specFiles.length} API specification file(s):`);
  specFiles.forEach(f => console.log(`  - ${path.relative(rootDir, f)}`));
  console.log();
  
  let allIssues: OpenAPIIssue[] = [];
  
  for (const file of specFiles) {
    try {
      const spec = loadSpec(file);
      const issues = analyzeSpec(spec, file);
      allIssues = allIssues.concat(issues);
    } catch (err) {
      console.error(`❌ Error parsing ${path.relative(rootDir, file)}: ${(err as Error).message}`);
    }
  }
  
  const errors = allIssues.filter(i => i.severity === 'error').length;
  const warnings = allIssues.filter(i => i.severity === 'warning').length;
  
  console.log(`## API Documentation Report\n`);
  console.log(`**${errors}** errors | **${warnings}** warnings\n`);
  
  if (allIssues.length === 0) {
    console.log('✅ No issues found! API documentation is complete.');
    process.exit(0);
  }
  
  // Group by file
  const byFile = new Map<string, OpenAPIIssue[]>();
  for (const issue of allIssues) {
    if (!byFile.has(issue.path)) byFile.set(issue.path, []);
    byFile.get(issue.path)!.push(issue);
  }
  
  for (const [filePath, issues] of byFile) {
    console.log(`### ${filePath}\n`);
    console.log(`| Method | Severity | Rule | Description |`);
    console.log(`|--------|----------|------|-------------|`);
    for (const issue of issues) {
      const icon = issue.severity === 'error' ? '🔴' : '🟡';
      const method = issue.method || '-';
      console.log(`| ${method} | ${icon} ${issue.severity} | ${issue.rule} | ${issue.description} |`);
    }
    console.log();
  }
  
  process.exit(errors > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
