import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");

const IMAGE_DIGEST = /^docker\.io\/[^/:\s]+\/[^@\s:]+@sha256:[a-f0-9]{64}$/;
const SEARXNG_BASE_IMAGE = "docker.io/searxng/searxng@sha256:44076b281d6c6ad9e258b213b832aa1d77a728ec0b8319d21d3e271f12bf1746";
export const LOOPBACK_PUBLISH = /^127\.0\.0\.1:8080:8080(\/tcp)?$/;
const SEARXNG_CONFIG_MOUNT = "/etc/searxng";

export const SECRET_INTERPOLATION_RE = /\$\{?\s*SEARXNG_SECRET\b/;
export const SETTINGS_PORT_RE = /^\s+port:\s*8080\s*(#.*)?$/m;
export const SETTINGS_BIND_RE = /^\s+bind_address:\s*"::"/m;
export const SETTINGS_8888_RE = /^\s+port:\s*8888/m;
const SERVER_BLOCK_RE = /^server:\n[\s\S]*?(?=^[a-zA-Z_][\w-]*:)/m;

export function extractServerBlock(source) {
  return source.match(SERVER_BLOCK_RE)?.[0] ?? "";
}

export function volumeMountTarget(entry) {
  if (typeof entry === "string") {
    const parts = entry.split(":");
    return (parts.length === 1 ? parts[0] : parts[1]) ?? "";
  }
  if (entry && typeof entry === "object") return entry.target ?? "";
  return "";
}

export function collidesWithSearxngConfigMount(entry) {
  const raw = volumeMountTarget(entry);
  const target = raw ? path.posix.normalize(raw) : "";
  if (!target) return false;
  return target === "/" || target === SEARXNG_CONFIG_MOUNT
    || target.startsWith(`${SEARXNG_CONFIG_MOUNT}/`)
    || SEARXNG_CONFIG_MOUNT.startsWith(`${target}/`);
}

export function volumeMountIsReadOnly(entry) {
  if (typeof entry === "string") return (entry.split(":")[2]?.split(",") ?? []).includes("ro");
  if (entry && typeof entry === "object") return entry.read_only === true;
  return false;
}

async function readSourceFile(root, relativePath, errors) {
  try {
    return await readFile(path.join(root, relativePath), "utf8");
  } catch {
    errors.push(`${relativePath} must be readable`);
    return null;
  }
}

export async function validateSecurityConfiguration(root) {
  const errors = [];
  let packageJson;
  try {
    packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  } catch {
    errors.push("package.json must be present and parse as JSON");
    return errors;
  }
  if (packageJson.devDependencies?.["@playwright/cli"] !== "0.1.19") {
    errors.push("@playwright/cli must be pinned to 0.1.19");
  }

  const composeSource = await readSourceFile(root, "mcp/searxng/docker-compose.yml", errors);
  const dockerfileSource = await readSourceFile(root, "mcp/searxng/Dockerfile", errors);
  if (composeSource === null || dockerfileSource === null) return errors;
  let compose;
  try {
    compose = yaml.load(composeSource);
  } catch {
    errors.push("docker-compose.yml must parse as a duplicate-free YAML mapping");
    return errors;
  }
  if (!compose?.services?.core?.build || compose.services.core.build.dockerfile !== "Dockerfile") {
    errors.push("SearXNG core must use the local derived-image Dockerfile build");
  }
  if (SECRET_INTERPOLATION_RE.test(composeSource)) {
    errors.push("SearXNG secret must not be interpolated by Compose");
  }
  const coreEnvironment = compose?.services?.core?.environment;
  if (!Array.isArray(coreEnvironment) || !coreEnvironment.includes("SEARXNG_SECRET")) {
    errors.push("SearXNG secret must use Compose environment pass-through");
  }
  const corePorts = compose?.services?.core?.ports;
  if (!Array.isArray(corePorts) || corePorts.length !== 1 || !LOOPBACK_PUBLISH.test(String(corePorts[0] ?? ""))) {
    errors.push("SearXNG must bind port 8080 to localhost only via a single loopback publish and expose no other port mapping");
  }
  if (compose?.services?.core?.network_mode !== undefined) {
    errors.push("SearXNG core must not set network_mode; host networking bypasses the loopback publish boundary");
  }
  const coreHealthcheckTest = compose?.services?.core?.healthcheck?.test;
  if (
    !Array.isArray(coreHealthcheckTest) ||
    coreHealthcheckTest[0] !== "CMD" ||
    !coreHealthcheckTest.includes("python3") ||
    !coreHealthcheckTest.some((arg) => typeof arg === "string" && arg.includes("127.0.0.1:8080"))
  ) {
    errors.push("SearXNG core must define an exec-CMD python3 healthcheck probing the literal loopback 127.0.0.1:8080 endpoint");
  }
  const settingsSource = await readSourceFile(root, "mcp/searxng/core-config/settings.yml", errors);
  if (settingsSource !== null) {
    if ((settingsSource.match(/^server:/gm) ?? []).length !== 1) {
      errors.push("SearXNG settings.yml must contain exactly one top-level server block; duplicate keys are resolved last-wins by the runtime loader");
    }
    const serverBlock = extractServerBlock(settingsSource);
    if (!serverBlock) {
      errors.push("SearXNG settings.yml must define a top-level server block");
    } else {
      const PORT_CONTRACT_ERROR = "SearXNG settings.yml server.port must be 8080 to match the granian/compose port contract";
      const BIND_CONTRACT_ERROR = 'SearXNG settings.yml server.bind_address must be "::" to match the granian host contract';
      // Text-form regexes are deliberately stricter than the semantic check
      // below; both must pass: the semantic layer self-skips when server:
      // parses to a non-object and accepts textual variants (e.g. 8_080).
      if (!SETTINGS_PORT_RE.test(serverBlock)) {
        errors.push(PORT_CONTRACT_ERROR);
      }
      if (!SETTINGS_BIND_RE.test(serverBlock)) {
        errors.push(BIND_CONTRACT_ERROR);
      }
      if (SETTINGS_8888_RE.test(serverBlock)) {
        errors.push("SearXNG settings.yml server.port must not use the upstream 8888 default");
      }
      let serverConfig;
      try {
        serverConfig = yaml.load(serverBlock)?.server;
      } catch {
        errors.push("SearXNG settings.yml server block must parse as a single duplicate-free YAML mapping");
      }
      if (serverConfig && typeof serverConfig === "object" && !Array.isArray(serverConfig)) {
        if (serverConfig.port !== 8080 && !errors.includes(PORT_CONTRACT_ERROR)) {
          errors.push(PORT_CONTRACT_ERROR);
        }
        if (serverConfig.bind_address !== "::" && !errors.includes(BIND_CONTRACT_ERROR)) {
          errors.push(BIND_CONTRACT_ERROR);
        }
      }
    }
  }
  const coreVolumes = compose?.services?.core?.volumes;
  // The exact-literal mount text is deliberately stricter than the semantic
  // ro/collision loop below; both must pass. Long-form bind mounts with
  // equivalent semantics are rejected on purpose for greppability.
  if (!Array.isArray(coreVolumes) || !coreVolumes.includes("./core-config/:/etc/searxng/:ro,Z")) {
    errors.push("SearXNG core config mount must be exactly './core-config/:/etc/searxng/:ro,Z'");
  }
  for (const volumeEntry of Array.isArray(coreVolumes) ? coreVolumes : []) {
    if (collidesWithSearxngConfigMount(volumeEntry) && !volumeMountIsReadOnly(volumeEntry)) {
      errors.push("Every SearXNG volume mount colliding with /etc/searxng must be read-only");
    }
  }
  const envPath = path.join(root, "mcp/searxng/.env");
  try {
    const envSource = await readFile(envPath, "utf8");
    if (envSource.trim() && ((await stat(envPath)).mode & 0o777) !== 0o600) {
      errors.push("Populated SearXNG .env must have mode 0600");
    }
  } catch (error) {
    // An absent .env is the documented bootstrap-from-absent-state lifecycle
    // (README constrains only populated .env files), so ENOENT skips the mode check.
    if (error?.code !== "ENOENT") {
      errors.push("SearXNG .env must be readable to verify its file mode");
    }
  }
  for (const service of ["core", "valkey"]) {
    const image = compose?.services?.[service]?.image;
    if (service === "core" && image === undefined) continue;
    if (typeof image !== "string" || !IMAGE_DIGEST.test(image) || /latest/i.test(image)) {
      errors.push(`${service} image must use an immutable digest reference without a tag`);
    }
  }
  const fromImage = dockerfileSource.match(/^FROM\s+(\S+)/m)?.[1];
  if (fromImage !== SEARXNG_BASE_IMAGE || /latest/i.test(fromImage ?? "")) {
    errors.push("SearXNG Dockerfile base image must use the approved immutable digest reference");
  }

  const mssqlTls = await readSourceFile(root, "tools/mssql-tls.mjs", errors);
  if (mssqlTls !== null && (!mssqlTls.includes('encryptValues.includes("false")') || !mssqlTls.includes("TrustServerCertificate=true is not allowed"))) {
    errors.push("MSSQL TLS validation must enforce encryption and certificate verification");
  }
  return errors;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const errors = await validateSecurityConfiguration(root);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("security configuration validation passed");
  }
}
