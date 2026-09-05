import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");

const IMAGE_DIGEST = /^docker\.io\/[^/:\s]+\/[^@\s:]+@sha256:[a-f0-9]{64}$/;
const SEARXNG_BASE_IMAGE = "docker.io/searxng/searxng@sha256:44076b281d6c6ad9e258b213b832aa1d77a728ec0b8319d21d3e271f12bf1746";
export const LOOPBACK_PUBLISH = /^127\.0\.0\.1:8080:8080(\/tcp)?$/;
const SEARXNG_CONFIG_MOUNT = "/etc/searxng";

export const SECRET_INTERPOLATION_RE = /\$\{?\s*SEARXNG_SECRET\b/;
// Standalone opt-in skills that ship a wrapper but are NOT Stage 5 loop legs.
// listScanWrappers still enumerates them (so checkScanWrapper fail-closed-sweeps
// them), but the loop-legs SET-equality gate and the --live probe exclude them.
export const STANDALONE_WRAPPER_KEYS = [
  "skills/owasp-zap-scan/scripts/zap-scanner-wrapper.sh",
];
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

const PINNED_WRAPPER_IMAGE = /^(?:[\w-]+\.)*[\w-]+\/[\w.\-/]+@sha256:[a-f0-9]{64}$/;
// Standalone registry-reference literal in executable shell text: a
// dotted-host ref (`evil.example/tool...`) or an implicit-Docker-Hub
// `org/repo` ref carrying a tag or digest. Bounded by whitespace/quotes so
// bind-mount specs like `name:/root/.cache/tool:Z` cannot match mid-token.
const STRAY_IMAGE_REF_RE = /(?:^|(?<=[\s"']))(?:[\w-]+(?:\.[\w-]+)+\/\S+|[\w-]+\/[\w.-]+(?::[\w.-]+|@sha256:[a-f0-9]{64}))(?=$|[\s"'])/gm;

// Fail-closed per-wrapper contract: every skills/*/scripts/*-wrapper.sh must
// run disposable containers, pin its image by digest with no tag form (and
// never a `:tag@sha256:` mix), keep scanner output under /src/.scans/, and
// actually run the pinned image: the `${image}` variable (or the pinned
// digest literal) must appear in the `podman run` invocation and no other
// registry-reference literal may exist outside the `local image=` pin; the
// comment strip removes whole `#` lines only, so a stray reference in an
// inline `#` tail still fails closed, as does declaring a pin while running
// a tag.

// Extract the two script constants the live modes bind to: the pinned image
// reference from `local image="..."` and the `*-docker()` function name.
// Single source for the regex so validator modes and tests cannot drift.
export function extractWrapperPin(src) {
  return {
    image: src.match(/^\s*local\s+image="([^"]+)"/m)?.[1] ?? "",
    fn: src.match(/^([a-z][a-z0-9-]*-docker)\(\)\s*\{/m)?.[1] ?? "",
  };
}

export function checkScanWrapper(relPath, src) {
  const errors = [];
  // Comment lines never execute: strip them before ANY podman-run reasoning
  // so a doc comment containing a literal `podman run --rm <unpinned-ref>`
  // can neither satisfy the disposable-run check nor trip the per-block pin
  // check (carried Security Nit-2).
  const codeLines = src.split("\n").map((line) => (/^\s*#/.test(line) ? "" : line));
  if (!codeLines.some((line) => line.includes("podman run --rm"))) {
    errors.push(`${relPath} must run containers with 'podman run --rm' (disposable, no leftover state)`);
  }
  const pinnedRef = extractWrapperPin(src).image;
  if (!pinnedRef) {
    errors.push(`${relPath} must pin its image via 'local image="<ref>@sha256:<64hex>"'`);
  } else {
    const ref = pinnedRef;
    if (!/@sha256:[a-f0-9]{64}$/.test(ref)) {
      errors.push(`${relPath} image must be pinned by an immutable sha256 digest, not a floating tag: ${ref}`);
    }
    if (/:([\w][\w.-]*)@sha256:/.test(ref) || /:latest|:stable|:v\d/i.test(ref)) {
      errors.push(`${relPath} image must not mix a tag with a digest (no ':tag@sha256:' form): ${ref}`);
    }
    if (!PINNED_WRAPPER_IMAGE.test(ref)) {
      errors.push(`${relPath} image reference is not a well-formed digest-pinned registry path: ${ref}`);
    }
  }
  if (!src.includes("/src/.scans/")) {
    errors.push(`${relPath} must enforce the '/src/.scans/' output guard`);
  }
  // Every `podman run` — ANY form, with or without `--rm` (whose own
  // presence is asserted separately above) — must receive the pinned image.
  // Triggering only on `podman run --rm` let a second block like
  // `podman run busybox:latest echo hi` escape both this sweep and the STRAY
  // regex (no `--rm`, single token, no org/repo slash), so the trigger is the
  // bare command word. A line-initial trigger still missed compounds like
  // `X=1; podman run busybox echo hi` (carried Security Nit-2), so backslash
  // continuations are joined into logical lines FIRST (the real wrappers'
  // multi-line run blocks survive collection unchanged) and each logical line
  // is then split into `;`/`&&` segments before the trigger test.
  const logicalLines = [];
  let continuation = "";
  for (const line of codeLines) {
    if (line.trimEnd().endsWith("\\")) {
      continuation += `${line.trimEnd().slice(0, -1)} `;
      continue;
    }
    logicalLines.push(continuation + line);
    continuation = "";
  }
  if (continuation) logicalLines.push(continuation);
  for (const unit of logicalLines) {
    for (const segment of unit.split(/;|&&/)) {
      if (!/^podman run\b/.test(segment.trim())) continue;
      if (!segment.includes("${image}") && !(pinnedRef && segment.includes(pinnedRef))) {
        errors.push(`${relPath} must pass its pinned image to 'podman run' (the '\${image}' variable or the pinned digest literal), not a different image`);
      }
    }
  }
  const codeOnly = pinnedRef
    ? codeLines.join("\n").replace(/^[ \t]*local[ \t]+image="[^"]*"[ \t]*$/m, "").split(pinnedRef).join(" ")
    : codeLines.join("\n");
  for (const match of codeOnly.matchAll(STRAY_IMAGE_REF_RE)) {
    errors.push(`${relPath} references an image outside its 'local image=' pin: ${match[0].trim()}`);
  }
  return errors;
}

// Enumerate skills/<name>/scripts/<anything>-wrapper.sh via node fs only (no
// shell), sorted for deterministic reporting.
export async function listScanWrappers(root) {
  const relPaths = [];
  let skills;
  try {
    skills = await readdir(path.join(root, "skills"), { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return relPaths;
  }
  for (const skill of skills) {
    if (!skill.isDirectory()) continue;
    let scripts;
    try {
      scripts = await readdir(path.join(root, "skills", skill.name, "scripts"), { withFileTypes: true });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      continue;
    }
    for (const entry of scripts) {
      if (entry.isFile() && entry.name.endsWith("-wrapper.sh")) {
        relPaths.push(`skills/${skill.name}/scripts/${entry.name}`);
      }
    }
  }
  return relPaths.sort();
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

  // Fail-closed wrapper sweep: covers OSV today and any future scanner
  // wrapper tomorrow; finding zero wrappers is itself an error because the
  // sweep would otherwise silently no-op.
  const scanWrappers = await listScanWrappers(root);
  if (scanWrappers.length === 0) {
    errors.push("wrapper sweep found no skills/*/scripts/*-wrapper.sh files; a silently empty sweep is a failure");
  }
  for (const relPath of scanWrappers) {
    const src = await readSourceFile(root, relPath, errors);
    if (src !== null) errors.push(...checkScanWrapper(relPath, src));
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

// CLI-only live mode (never invoked from the default or test path): pulls (or
// reuses) each wrapper's pinned image and proves it starts and prints a
// version. The probe is driven through the wrapper function itself so it
// exercises the real `podman run --rm <ref> --version` path including the
// wrapper's entrypoint adaptation (the semgrep image ships no ENTRYPOINT, so
// a bare, un-prefixed `--version` would fail even for a valid pin) and its
// pull-if-missing logic, against a throwaway working directory. The wrapper
// path reaches `bash -c` as a positional argument ($1) rather than an
// interpolated literal, so a repo checked out under a path containing `'`
// cannot break the probe or inject shell.
async function runLiveValidation(root) {
  const run = promisify(execFile);
  try {
    await run("podman", ["--version"]);
  } catch {
    console.error("live validation unavailable: podman not installed");
    return 1;
  }
  const wrappers = (await listScanWrappers(root)).filter(
    (relPath) => !STANDALONE_WRAPPER_KEYS.includes(relPath),
  );
  if (wrappers.length === 0) {
    console.error("wrapper sweep found no skills/*/scripts/*-wrapper.sh files; nothing to live-validate");
    return 1;
  }
  const failures = [];
  for (const relPath of wrappers) {
    const src = await readFile(path.join(root, relPath), "utf8");
    const { image, fn } = extractWrapperPin(src);
    if (!image || !fn) {
      failures.push(`${relPath}: cannot extract the pinned image reference or *-docker function name for live validation`);
      continue;
    }
    let stdout = "";
    let stderr = "";
    try {
      // env inheritance is deliberate: a stray exported *_SCANNER_WORKDIR
      // cannot fake a pass here — the probe runs --version in a throwaway
      // cwd and checks only for a version string; the wrapper mounts only
      // that throwaway directory.
      const result = await run("bash", ["-c", `source "$1" && ${fn} --version`, "bash", path.join(root, relPath)], {
        cwd: await mkdtemp(path.join(os.tmpdir(), "security-live-validate-")),
        timeout: LIVE_SCAN_TIMEOUT_MS,
        maxBuffer: LIVE_SCAN_MAX_BUFFER_BYTES,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error) {
      const tail = String(error?.stderr || error?.message || "")
        .trim()
        .split("\n")
        .slice(-2)
        .join("; ");
      failures.push(`${relPath}: ${image} failed pull/startup: ${tail}`);
      continue;
    }
    // Require a real digit-dot version number: a `version`-word-only match
    // passed even on stderr like "version check failed".
    if (!/\d+\.\d+/.test(`${stdout}\n${stderr}`)) {
      failures.push(`${relPath}: ${image} started but printed no version number (version mismatch)`);
      continue;
    }
    const printed = `${stdout}\n${stderr}`.trim().split("\n").slice(0, 2).join(" | ");
    console.log(`live ok: ${relPath} -> ${image} -> ${fn} --version: ${printed}`);
  }
  if (failures.length) {
    console.error(failures.join("\n"));
    return 1;
  }
  console.log("live security-scan validation passed");
  return 0;
}

// Live-mode ceilings, shared by --live and --live-e2e (previously duplicated
// magic numbers): the first pass pays image pulls plus Trivy's ~60 MB vuln-DB
// and Semgrep's ruleset downloads, so 15 minutes and a 16 MB output buffer
// bound the probe without clipping a legitimately slow cold run.
const LIVE_SCAN_TIMEOUT_MS = 900000;
const LIVE_SCAN_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

// Deeper, still-CLI-only live mode (--live-e2e): the fixture-backed
// regression gate for C1/M1-class breakage. The fast `--version` probe above
// cannot catch a wrapper whose real scan invocation is rejected by the CLI
// (wrong flag position, duplicated non-repeatable flag, ...), so this runs
// each of the five EXACT authorized scan invocations against its fixture and
// asserts every leg writes a fresh, valid artifact that contains its required
// finding class. Invocations and wrapper paths are derived from SCAN_TOOL_KEYS,
// the single-source table that byte-matches the scanner agent's allow-keys
// (pinned by tests/security-config.test.mjs); only the wrapper path crosses
// into bash as a positional argument. Heavy (five container scans; first pass
// pays the vuln-DB/ruleset downloads) — hence a separate opt-in command, never
// part of `npm test` or the plain `--live` path.
const LIVE_E2E_FIXTURE = "tests/fixtures/secure-scan-demo";
const LIVE_E2E_GITLEAKS_FIXTURE = "tests/fixtures/gitleaks-demo";
const LIVE_E2E_REQUIRED_FILES = ["package-lock.json", "Dockerfile", "app/server.py", "config/settings.yaml", "app/App.java"];
const LIVE_E2E_GITLEAKS_REQUIRED_FILES = ["README.md", "config/credentials.txt", ".gitignore"];

function osvAdvisoryCount(report) {
  let total = 0;
  for (const result of Array.isArray(report?.results) ? report.results : []) {
    total += Array.isArray(result?.vulnerabilities) ? result.vulnerabilities.length : 0;
    for (const pkg of Array.isArray(result?.packages) ? result.packages : []) {
      total += Array.isArray(pkg?.vulnerabilities) ? pkg.vulnerabilities.length : 0;
    }
  }
  return total;
}

// DO NOT EDIT THESE STRINGS: byte-matched by tests/security-config.test.mjs
// against the scanner agent's (and the verifier's mirrored) permission
// allow-keys. This table is the single source for the wrapper paths and the
// exact authorized scan invocations: the tests' SCAN_TOOLS table and the
// LIVE_E2E_LEGS below both derive from it, so the copies cannot drift by
// authoring; the agent frontmatter stays the ultimate source and the tests'
// byte-equality assertions are the arbiter.
export const SCAN_TOOL_KEYS = [
  {
    tool: "osv-scanner",
    wrapperPath: "skills/osv-scanner/scripts/osv-scanner-wrapper.sh",
    invocation: "osv-scanner-docker scan source -r --format json --output-file /src/.scans/final-osv-results.json /src",
  },
  {
    tool: "semgrep",
    wrapperPath: "skills/semgrep-scanner/scripts/semgrep-scanner-wrapper.sh",
    invocation: "semgrep-docker scan --json --metrics off --disable-version-check --config p/default --output /src/.scans/final-semgrep-results.json /src",
  },
  {
    tool: "trivy",
    wrapperPath: "skills/trivy-scanner/scripts/trivy-scanner-wrapper.sh",
    invocation: "trivy-docker fs --scanners vuln,misconfig,secret --format json --output /src/.scans/final-trivy-results.json /src",
  },
  {
    tool: "gitleaks",
    wrapperPath: "skills/gitleaks-scan/scripts/gitleaks-scanner-wrapper.sh",
    invocation: "gitleaks-docker detect --source /src --report-format json --report-path /src/.scans/final-gitleaks-results.json /src",
  },
  {
    tool: "pmd",
    wrapperPath: "skills/pmd-scan/scripts/pmd-scanner-wrapper.sh",
    invocation: "pmd-docker check -d /src -R category/java/errorprone.xml -f json --report-file /src/.scans/final-pmd-results.json",
  },
];

// Per-leg acceptance: exit-code contract observed live against the pinned
// digests (2026-09-04: osv exits 1 when advisories are found; the pinned
// semgrep build exits 0 with findings absent --error; trivy's default
// --exit-code is 0) plus a required finding class inside the artifact, so a
// silently empty or truncated report still fails the gate.
const LIVE_E2E_ORACLES = {
  "osv-scanner": {
    okExitCodes: [0, 1],
    findingsLabel: "at least one dependency advisory (minimist fixture)",
    countFindings: (report) => osvAdvisoryCount(report),
  },
  semgrep: {
    okExitCodes: [0],
    findingsLabel: "at least one ERROR-severity SAST result",
    countFindings: (report) => (Array.isArray(report?.results) ? report.results : [])
      .filter((r) => r?.extra?.severity === "ERROR").length,
  },
  trivy: {
    okExitCodes: [0],
    findingsLabel: "at least one misconfiguration or secret finding",
    countFindings: (report) => (Array.isArray(report?.Results) ? report.Results : []).reduce(
      (n, r) => n + (Array.isArray(r?.Misconfigurations) ? r.Misconfigurations.length : 0)
        + (Array.isArray(r?.Secrets) ? r.Secrets.length : 0),
      0,
    ),
  },
  gitleaks: {
    okExitCodes: [0, 1],
    findingsLabel: "at least one git-history secret leak",
    countFindings: (report) => (Array.isArray(report?.Leaks) ? report.Leaks : []).length,
  },
  pmd: {
    okExitCodes: [0, 4, 5],
    findingsLabel: "at least one rule violation",
    countFindings: (report) => (Array.isArray(report?.files) ? report.files : []).reduce(
      (n, f) => n + (Array.isArray(f?.violations) ? f.violations.length : 0),
      0,
    ),
  },
};

// DO NOT EDIT THESE STRINGS: byte-matched by tests/security-config.test.mjs.
// tool/wrapperPath/invocation derive from SCAN_TOOL_KEYS and artifact from
// the invocation's own /src/.scans/<file> output path, so adding a scanner
// to the shared table forces an explicit oracle entry here (and the tests
// assert one leg per wrapper file — see the legs test).
export const LIVE_E2E_LEGS = SCAN_TOOL_KEYS.map((key) => {
  const artifact = key.invocation.match(/\/src\/\.scans\/(\S+?)(?: \/src)?$/)?.[1];
  if (!artifact) {
    throw new Error(`live-e2e leg "${key.tool}": allow-key invocation carries no /src/.scans/<artifact> output path`);
  }
  const oracle = LIVE_E2E_ORACLES[key.tool];
  if (!oracle) {
    throw new Error(`live-e2e leg "${key.tool}": shared scan-tool entry has no e2e oracle; add one deliberately`);
  }
  return { tool: key.tool, wrapperPath: key.wrapperPath, invocation: key.invocation, artifact, fixture: key.tool === "gitleaks" ? LIVE_E2E_GITLEAKS_FIXTURE : LIVE_E2E_FIXTURE, ...oracle };
});

async function runLiveE2EValidation(root) {
  const run = promisify(execFile);
  try {
    await run("podman", ["--version"]);
  } catch {
    console.error("live-e2e validation unavailable: podman not installed");
    return 1;
  }
  const fixtureDir = path.join(root, LIVE_E2E_FIXTURE);
  const gitleaksFixtureDir = path.join(root, LIVE_E2E_GITLEAKS_FIXTURE);
  const missing = [];
  for (const rel of LIVE_E2E_REQUIRED_FILES) {
    try {
      await stat(path.join(fixtureDir, rel));
    } catch {
      missing.push(`${LIVE_E2E_FIXTURE}/${rel}`);
    }
  }
  for (const rel of LIVE_E2E_GITLEAKS_REQUIRED_FILES) {
    try {
      await stat(path.join(gitleaksFixtureDir, rel));
    } catch {
      missing.push(`${LIVE_E2E_GITLEAKS_FIXTURE}/${rel}`);
    }
  }
  if (missing.length) {
    console.error(`live-e2e fixture incomplete; missing: ${missing.join(", ")}`);
    return 1;
  }
  // Pre-seed the gitleaks fixture as a git repo so the synthetic secret lives
  // in history (the surface gitleaks scans). Idempotent: init only if `.git`
  // is absent, then commit the working files so a fresh clone has them. The
  // fixture's own .gitignore excludes .scans/ so re-runs never commit scan
  // artifacts. This is operator-run CLI behavior (never the verifier agent).
  if (!(await stat(path.join(gitleaksFixtureDir, ".git")).then(() => true).catch(() => false))) {
    await run("git", ["init", "-q"], { cwd: gitleaksFixtureDir });
  }
  await run("git", ["add", "-A"], { cwd: gitleaksFixtureDir });
  // Commit only when there is something staged, so the idempotent
  // "nothing to commit" case is skipped up front instead of being swallowed
  // by a .catch — a real commit failure (e.g. commit.gpgsign/hooks) still
  // surfaces here rather than being masked until the later findings check.
  const porcelain = await run("git", ["status", "--porcelain"], { cwd: gitleaksFixtureDir });
  if (porcelain.stdout.trim() !== "") {
    await run("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-q", "-m", "seed gitleaks fixture"], { cwd: gitleaksFixtureDir });
  }
  // ACCEPTED (review round 2, carried Security Nit-1): the 5s slack absorbs
  // coarse filesystem mtime granularity on volume/network mounts; a pre-seed
  // race (a stale artifact written within 5s before this clock read) is
  // negligible for this human-gated CLI, and the gate fails toward freshness.
  const startedAt = Date.now() - 5000;
  const failures = [];
  for (const leg of LIVE_E2E_LEGS) {
    const wrapperAbs = path.join(root, leg.wrapperPath);
    let src;
    try {
      src = await readFile(wrapperAbs, "utf8");
    } catch {
      failures.push(`${leg.tool}: wrapper ${leg.wrapperPath} is not readable`);
      continue;
    }
    const { image, fn } = extractWrapperPin(src);
    if (!image || !fn || !leg.invocation.startsWith(`${fn} `)) {
      failures.push(`${leg.tool}: cannot extract the pinned image/function or invocation does not match the wrapper function name`);
      continue;
    }
    const legFixtureDir = path.join(root, leg.fixture);
    const artifactPath = path.join(legFixtureDir, ".scans", leg.artifact);
    // -1 for an absent prior artifact: "nothing was there before" must not
    // impose a stricter freshness floor than this run's own startedAt gate.
    const previousMtime = await stat(artifactPath).then((s) => s.mtimeMs).catch(() => -1);
    let exitCode = 0;
    try {
      // env inheritance is deliberate and safe here: even a stray exported
      // *_SCANNER_WORKDIR cannot fake a pass, because the artifact path the
      // gate stats is derived from legFixtureDir, not from the env'd mount — a
      // redirected write leaves legFixtureDir/.scans stale and the freshness
      // check fails closed.
      await run("bash", ["-c", `source "$1" && ${leg.invocation}`, "bash", wrapperAbs], {
        cwd: legFixtureDir,
        timeout: LIVE_SCAN_TIMEOUT_MS,
        maxBuffer: LIVE_SCAN_MAX_BUFFER_BYTES,
      });
    } catch (error) {
      // Non-numeric error codes (ENOENT, spawn signals) coerce to -1, which
      // is never in okExitCodes: fail closed rather than trust an unknown code.
      exitCode = typeof error?.code === "number" ? error.code : -1;
      if (!leg.okExitCodes.includes(exitCode)) {
        const tail = String(error?.stderr || error?.message || "")
          .trim()
          .split("\n")
          .slice(-2)
          .join("; ");
        failures.push(`${leg.tool}: scan invocation failed (exit ${exitCode}): ${tail}`);
        continue;
      }
    }
    let report;
    try {
      const written = await stat(artifactPath);
      if (written.mtimeMs < Math.max(previousMtime, startedAt)) {
        failures.push(`${leg.tool}: ${leg.artifact} was not rewritten by this run (stale artifact from a prior pass)`);
        continue;
      }
      report = JSON.parse(await readFile(artifactPath, "utf8"));
    } catch (error) {
      failures.push(`${leg.tool}: ${leg.artifact} is missing or unparseable: ${error?.message ?? error}`);
      continue;
    }
    const findings = leg.countFindings(report);
    if (!(findings >= 1)) {
      failures.push(`${leg.tool}: ${leg.artifact} valid but does not contain ${leg.findingsLabel} (counted ${findings}) — the leg silently degraded`);
      continue;
    }
    console.log(`live-e2e ok: ${leg.tool} -> ${image} -> ${leg.artifact}: ${findings} (${leg.findingsLabel}), exit ${exitCode}`);
  }
  if (failures.length) {
    console.error(failures.join("\n"));
    return 1;
  }
  console.log("live end-to-end security-scan validation passed (all five fixture-backed legs produced required findings)");
  return 0;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  if (process.argv.includes("--live-e2e")) {
    process.exitCode = await runLiveE2EValidation(root);
  } else if (process.argv.includes("--live")) {
    process.exitCode = await runLiveValidation(root);
  } else {
    const errors = await validateSecurityConfiguration(root);
    if (errors.length) {
      console.error(errors.join("\n"));
      process.exitCode = 1;
    } else {
      console.log("security configuration validation passed");
    }
  }
}
