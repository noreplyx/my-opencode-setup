import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSecurityConfiguration } from "../scripts/validate-security-config.mjs";
import { validateMssqlTlsConnectionString } from "../tools/mssql-tls.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("security-sensitive dependencies and configuration are pinned and hardened", async () => {
  assert.deepEqual(await validateSecurityConfiguration(root), []);
});

test("SearXNG derived image uses a Podman-compatible build reference", async () => {
  const compose = await readFile(path.join(root, "mcp/searxng/docker-compose.yml"), "utf8");
  const dockerfile = await readFile(path.join(root, "mcp/searxng/Dockerfile"), "utf8");
  assert.match(compose, /core:\n\s+build:/);
  assert.doesNotMatch(compose, /core:\n\s+image:/);
  assert.match(dockerfile, /^FROM docker\.io\/searxng\/searxng@sha256:44076b281d6c6ad9e258b213b832aa1d77a728ec0b8319d21d3e271f12bf1746$/m);
  assert.doesNotMatch(`${compose}\n${dockerfile}`, /:[^/\s@]+@sha256:/);
  assert.doesNotMatch(compose, /container_name:/);
});

test("verifier Podman permissions stay project-scoped", async () => {
  const verifier = await readFile(path.join(root, "agent/verifier.md"), "utf8");
  const composePrefix = "podman-compose -p searxng-verification-* -f mcp/searxng/docker-compose.yml";
  for (const operation of ["config", "build core", "up -d", "ps", "exec *", "restart"]) {
    assert.ok(verifier.includes(`${composePrefix} ${operation}`));
  }
  assert.ok(verifier.includes(`${composePrefix} down --volumes --remove-orphans`));
  assert.match(verifier, /"\*": deny/);
  assert.match(verifier, /"podman system \*": deny/);
  assert.match(verifier, /edit: deny/);
  assert.match(verifier, /secret-output prohibition|secret files/);
});

test("authorized OSV verification requests machine-readable output", async () => {
  const verifier = await readFile(path.join(root, "agent/verifier.md"), "utf8");
  const scanner = await readFile(path.join(root, "agent/code-security-scanner.md"), "utf8");
  const wrapper = await readFile(path.join(root, "skills/osv-scanner/scripts/osv-scanner-wrapper.sh"), "utf8");
  const invocation = "source /home/tanutchakorn/.config/opencode/skills/osv-scanner/scripts/osv-scanner-wrapper.sh && osv-scanner-docker scan source -r --format json --output-file /src/.scans/final-osv-results.json /src";
  assert.ok(verifier.includes(`"${invocation}": allow`));
  assert.ok(scanner.includes(`"${invocation}": allow`));
  for (const permissions of [verifier, scanner]) {
    assert.match(permissions, /"\*": deny/);
    assert.doesNotMatch(permissions, /"osv-scanner-docker \*": allow/);
    assert.doesNotMatch(permissions, /"source (?![^"]*&&)[^"]+": allow/);
  }
  assert.match(verifier, /secret-output prohibition|secret files/);
  assert.match(scanner, /secret|credentials/);
  assert.match(wrapper, /podman run --rm/);
  assert.match(wrapper, /ghcr\.io\/google\/osv-scanner@sha256:[a-f0-9]{64}/);
});

test("MSSQL TLS validation rejects explicit Encrypt=false", () => {
  validateMssqlTlsConnectionString("Server=db;Encrypt=true");
  assert.throws(
    () => validateMssqlTlsConnectionString("Server=db;Encrypt=false"),
    /Encrypt=false is not allowed/,
  );
  assert.throws(() => validateMssqlTlsConnectionString("Server=db"), /require TLS/);
  assert.throws(
    () => validateMssqlTlsConnectionString("Server=db;Encrypt=true;TrustServerCertificate=true"),
    /certificate verification/,
  );
  assert.throws(
    () => validateMssqlTlsConnectionString("Server=db;Encrypt=false;Encrypt=true"),
    /certificate verification|Encrypt=false/,
  );
});
