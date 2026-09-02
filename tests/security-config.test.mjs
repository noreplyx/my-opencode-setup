import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { validateSecurityConfiguration, LOOPBACK_PUBLISH, collidesWithSearxngConfigMount, volumeMountIsReadOnly, volumeMountTarget, extractServerBlock, SETTINGS_PORT_RE, SETTINGS_BIND_RE, SETTINGS_8888_RE, SECRET_INTERPOLATION_RE } from "../scripts/validate-security-config.mjs";
import { validateMssqlTlsConnectionString } from "../tools/mssql-tls.mjs";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");

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

test("SearXNG core healthcheck and settings.yml server port contract are explicit", async () => {
  const compose = await readFile(path.join(root, "mcp/searxng/docker-compose.yml"), "utf8");
  assert.match(compose, /healthcheck:/);
  assert.match(compose, /test:\s*\[[^\]]*127\.0\.0\.1:8080[^\]]*\]/);
  const settings = await readFile(path.join(root, "mcp/searxng/core-config/settings.yml"), "utf8");
  const serverBlock = extractServerBlock(settings);
  assert.ok(serverBlock, "settings.yml must define a top-level server block");
  assert.match(serverBlock, SETTINGS_PORT_RE);
  assert.match(serverBlock, SETTINGS_BIND_RE);
  assert.doesNotMatch(serverBlock, SETTINGS_8888_RE);
});

test("SearXNG exposure boundary is exclusive: single loopback publish and no host networking", async () => {
  const compose = yaml.load(await readFile(path.join(root, "mcp/searxng/docker-compose.yml"), "utf8"));
  assert.equal(compose.services.core.network_mode, undefined);
  assert.ok(Array.isArray(compose.services.core.ports));
  assert.equal(compose.services.core.ports.length, 1);
  assert.match(compose.services.core.ports[0], LOOPBACK_PUBLISH);
});

test("SearXNG volume mounts colliding with /etc/searxng are all read-only", async () => {
  const compose = yaml.load(await readFile(path.join(root, "mcp/searxng/docker-compose.yml"), "utf8"));
  const configMounts = compose.services.core.volumes.filter(collidesWithSearxngConfigMount);
  assert.ok(configMounts.length > 0, "compose must mount the hardened core-config at /etc/searxng");
  for (const mount of configMounts) {
    assert.ok(volumeMountIsReadOnly(mount), "every /etc/searxng-colliding mount must carry ro");
  }
});

test("SearXNG healthcheck is a literal python3 exec-CMD probe of the loopback endpoint", async () => {
  const compose = yaml.load(await readFile(path.join(root, "mcp/searxng/docker-compose.yml"), "utf8"));
  const healthcheckTest = compose.services.core.healthcheck.test;
  assert.ok(Array.isArray(healthcheckTest), "healthcheck test must use exec array form");
  assert.equal(healthcheckTest[0], "CMD");
  assert.ok(healthcheckTest.includes("python3"));
  assert.ok(healthcheckTest.some((arg) => typeof arg === "string" && arg.includes("127.0.0.1:8080")));
});

test("SearXNG settings.yml resolves to exactly one semantic server block on the port contract", async () => {
  const settings = await readFile(path.join(root, "mcp/searxng/core-config/settings.yml"), "utf8");
  assert.equal((settings.match(/^server:/gm) ?? []).length, 1, "duplicate top-level server keys are last-wins for the runtime loader");
  const serverBlock = extractServerBlock(settings);
  assert.ok(serverBlock, "settings.yml must define a top-level server block");
  const server = yaml.load(serverBlock).server;
  assert.equal(server.port, 8080);
  assert.equal(server.bind_address, "::");
});

test("SearXNG compose source contains no secret interpolation in braced or short form", async () => {
  const compose = await readFile(path.join(root, "mcp/searxng/docker-compose.yml"), "utf8");
  assert.doesNotMatch(compose, SECRET_INTERPOLATION_RE);
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

test("collidesWithSearxngConfigMount matches path segments, not string prefixes", () => {
  const cases = [
    ["evil:/etc/searxng:rw", true],
    ["evil:/etc/searxng/:rw", true],
    ["evil:/etc//searxng:rw", true],
    ["evil:/:/rw", true],
    ["evil:/etc:rw", true],
    ["evil:/etc/searxng/settings.yml:rw", true],
    ["evil:/etc/searxng.d:rw", false],
    ["evil:/etc/searxng-shared:rw", false],
    ["evil:/srv/data:rw", false],
    ["anon", false],
    ["", false],
    [{ type: "bind", source: "evil", target: "/etc/searxng/sub", read_only: false }, true],
    [{ type: "bind", source: "evil", target: "/etc/searxng.d", read_only: false }, false],
    [{ type: "bind", source: "evil", target: "/", read_only: true }, true],
  ];
  for (const [entry, expected] of cases) {
    assert.equal(collidesWithSearxngConfigMount(entry), expected, `collision verdict for ${JSON.stringify(entry)}`);
  }
});

test("volumeMountTarget extracts short-form and long-form mount targets", () => {
  assert.equal(volumeMountTarget("./src:/etc/searxng:ro,Z"), "/etc/searxng");
  assert.equal(volumeMountTarget("anon"), "anon");
  assert.equal(volumeMountTarget({ type: "bind", source: "core-data", target: "/var/cache/searxng/" }), "/var/cache/searxng/");
  assert.equal(volumeMountTarget(null), "");
});

test("volumeMountIsReadOnly honors short-form modes and long-form read_only", () => {
  const cases = [
    ["./core-config/:/etc/searxng/:ro,Z", true],
    ["evil:/etc/searxng:rw", false],
    ["evil:/etc/searxng:z", false],
    ["two:parts", false],
    [{ target: "/etc/searxng", read_only: true }, true],
    [{ target: "/etc/searxng", read_only: false }, false],
    ["", false],
  ];
  for (const [entry, expected] of cases) {
    assert.equal(volumeMountIsReadOnly(entry), expected, `read-only verdict for ${JSON.stringify(entry)}`);
  }
});

test("LOOPBACK_PUBLISH accepts only single loopback 8080 mappings", () => {
  const cases = [
    ["127.0.0.1:8080:8080", true],
    ["127.0.0.1:8080:8080/tcp", true],
    ["8080:8080", false],
    ["0.0.0.0:8080:8080", false],
    ["8080", false],
    ["127.0.0.1:8080:8080/udp", false],
    ["127.0.0.1:9090:8080", false],
  ];
  for (const [entry, expected] of cases) {
    assert.equal(LOOPBACK_PUBLISH.test(entry), expected, `loopback verdict for ${JSON.stringify(entry)}`);
  }
});
