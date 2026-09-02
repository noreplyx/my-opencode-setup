import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");

const IMAGE_DIGEST = /^docker\.io\/[^/:\s]+\/[^@\s:]+@sha256:[a-f0-9]{64}$/;
const SEARXNG_BASE_IMAGE = "docker.io/searxng/searxng@sha256:44076b281d6c6ad9e258b213b832aa1d77a728ec0b8319d21d3e271f12bf1746";

export async function validateSecurityConfiguration(root) {
  const errors = [];
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  if (packageJson.devDependencies?.["@playwright/cli"] !== "0.1.19") {
    errors.push("@playwright/cli must be pinned to 0.1.19");
  }

  const composeSource = await readFile(path.join(root, "mcp/searxng/docker-compose.yml"), "utf8");
  const dockerfileSource = await readFile(path.join(root, "mcp/searxng/Dockerfile"), "utf8");
  const compose = yaml.load(composeSource);
  if (!compose?.services?.core?.build || compose.services.core.build.dockerfile !== "Dockerfile") {
    errors.push("SearXNG core must use the local derived-image Dockerfile build");
  }
  if (/\$\{\s*SEARXNG_SECRET\b/.test(composeSource)) {
    errors.push("SearXNG secret must not be interpolated by Compose");
  }
  const coreEnvironment = compose?.services?.core?.environment;
  if (!Array.isArray(coreEnvironment) || !coreEnvironment.includes("SEARXNG_SECRET")) {
    errors.push("SearXNG secret must use Compose environment pass-through");
  }
  if (!compose?.services?.core?.ports?.includes("127.0.0.1:8080:8080")) {
    errors.push("SearXNG must bind port 8080 to localhost only");
  }
  if (!compose?.services?.core?.volumes?.includes("./core-config/:/etc/searxng/:ro,Z")) {
    errors.push("SearXNG core configuration mount must be read-only");
  }
  const envPath = path.join(root, "mcp/searxng/.env");
  const envSource = await readFile(envPath, "utf8");
  if (envSource.trim() && ((await stat(envPath)).mode & 0o777) !== 0o600) {
    errors.push("Populated SearXNG .env must have mode 0600");
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

  const mssqlTls = await readFile(path.join(root, "tools/mssql-tls.mjs"), "utf8");
  if (!mssqlTls.includes('encryptValues.includes("false")') || !mssqlTls.includes("TrustServerCertificate=true is not allowed")) {
    errors.push("MSSQL TLS validation must enforce encryption and certificate verification");
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const errors = await validateSecurityConfiguration(root);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("security configuration validation passed");
  }
}
