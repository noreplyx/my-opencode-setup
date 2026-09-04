import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { validateSecurityConfiguration, checkScanWrapper, listScanWrappers, LOOPBACK_PUBLISH, collidesWithSearxngConfigMount, volumeMountIsReadOnly, volumeMountTarget, extractServerBlock, extractWrapperPin, SETTINGS_PORT_RE, SETTINGS_BIND_RE, SETTINGS_8888_RE, SECRET_INTERPOLATION_RE, SCAN_TOOL_KEYS, LIVE_E2E_LEGS } from "../scripts/validate-security-config.mjs";
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

// Test-only metadata per tool; the wrapperPath/wrapperKey/invocationKey/
// fnPrefix strings are DERIVED from the validator's shared SCAN_TOOL_KEYS
// table so this file and LIVE_E2E_LEGS cannot drift by authoring (the
// legs test remains the byte-equality arbiter against the agent frontmatter).
// The OSV entry keeps the trailing \*? leniency regex that was deliberately
// approved in the split-grant review (OSV-only exception: the pinned
// `scan source` verb prefix, the wrapper's `:Z` workdir mount, and the
// `/src/.scans/` output guard bound the extra args); the Semgrep and Trivy
// grants are exact-match, with no such tolerance and no source-shape
// leniency.
// DO NOT EDIT THESE STRINGS: they byte-match the agent frontmatter allow-keys
// in agent/code-security-scanner.md and agent/verifier.md — the agent side is
// the source of truth and this file's byte-equality grant sweep is the arbiter.
const SCAN_TOOL_TEST_EXTRAS = {
  "osv-scanner": {
    errorPrefix: "[osv-scanner] ERROR:",
    skillPath: "skills/osv-scanner/SKILL.md",
    invocationRe: /^osv-scanner-docker scan source -r --format json --output-file \/src\/\.scans\/final-osv-results\.json \/src\*?$/,
    probeArgs: "scan source -r --format json",
    imageRe: /ghcr\.io\/google\/osv-scanner@sha256:[a-f0-9]{64}/,
    guardFlag: "--output-file",
    shortFormRejected: false,
    // F3: the OSV guard now covers the Go-style single-dash long form and
    // rejects the deprecated aliases / -O short form outright.
    alternateOutputForms: ["-output-file", "-output-file=", "--output", "--output=", "-output", "-O"],
  },
  semgrep: {
    errorPrefix: "[semgrep] ERROR:",
    skillPath: "skills/semgrep-scanner/SKILL.md",
    invocationRe: /^semgrep-docker scan --json --metrics off --disable-version-check --config p\/default --output \/src\/\.scans\/final-semgrep-results\.json \/src$/,
    probeArgs: "scan --json",
    imageRe: /docker\.io\/semgrep\/semgrep@sha256:[a-f0-9]{64}/,
    guardFlag: "--output",
    shortFormRejected: true,
  },
  trivy: {
    errorPrefix: "[trivy] ERROR:",
    skillPath: "skills/trivy-scanner/SKILL.md",
    invocationRe: /^trivy-docker fs --scanners vuln,misconfig,secret --format json --output \/src\/\.scans\/final-trivy-results\.json \/src$/,
    probeArgs: "fs --scanners vuln,misconfig,secret --format json",
    imageRe: /docker\.io\/aquasec\/trivy@sha256:[a-f0-9]{64}/,
    guardFlag: "--output",
    shortFormRejected: true,
  },
};

const SCAN_TOOLS = SCAN_TOOL_KEYS.map((key) => ({
  label: key.tool,
  wrapperPath: key.wrapperPath,
  wrapperKey: `source ~/.config/opencode/${key.wrapperPath}`,
  invocationKey: key.invocation,
  fnPrefix: key.invocation.split(" ")[0],
  ...SCAN_TOOL_TEST_EXTRAS[key.tool],
}));

const WRAPPER_KEYS = SCAN_TOOLS.map((tool) => tool.wrapperKey);
const parseBashRules = (doc, name) => {
  const frontmatter = doc.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(frontmatter, `${name}: missing frontmatter`);
  return { frontmatter: frontmatter[0], rules: yaml.load(frontmatter[1]).permission.bash };
};

test("authorized OSV/Semgrep/Trivy verification requests machine-readable output", async () => {
  const verifier = await readFile(path.join(root, "agent/verifier.md"), "utf8");
  const scanner = await readFile(path.join(root, "agent/code-security-scanner.md"), "utf8");
  const GIT_DENY_TAIL = ["git * --out*", "git * --ext*", "git diff --output*", "git diff --ext-diff*", "git show --ext-diff*", "git difftool*"];
  const SCANNER_DENY_TAIL = ["source", "podman*", "docker*", "kubectl*"];
  for (const [name, doc] of [["verifier", verifier], ["scanner", scanner]]) {
    const { rules } = parseBashRules(doc, name);
    const keys = Object.keys(rules);
    assert.equal(keys[0], "*", `${name}: catch-all must be the first bash rule`);
    assert.equal(rules["*"], "deny", `${name}: bash must be deny-by-default`);
    for (const tool of SCAN_TOOLS) {
      assert.equal(rules[tool.wrapperKey], "allow", `${name}: ${tool.label} wrapper source segment must be allowed`);
      assert.equal(rules[tool.invocationKey], "allow", `${name}: pinned ${tool.label} invocation must be allowed`);
    }
    const lastAllowIndex = Math.max(...keys.map((key, i) => (rules[key] === "allow" ? i : -1)));
    for (const key of keys) {
      assert.ok(!key.includes("&&"), `${name}: compound && keys are structurally dead: ${key}`);
      for (const tool of SCAN_TOOLS) {
        if (key.startsWith(tool.fnPrefix)) {
          assert.match(key, tool.invocationRe, `${name}: ${tool.label} grant is broader than the pinned invocation`);
        }
      }
      if (key.startsWith("source")) {
        assert.ok(
          WRAPPER_KEYS.includes(key) || key === "source",
          `${name}: source grant is broader than the wrapper paths: ${key}`,
        );
      }
      // Sec N2: any `*-docker`-shaped ALLOW key must correspond to a
      // SCAN_TOOL_KEYS row (via its fnPrefix), so a fourth scanner grant
      // cannot exist without the shared table entry that feeds the live
      // legs and both live validators.
      if (rules[key] === "allow" && /^[\w-]+-docker\b/.test(key)) {
        const dockerFn = key.match(/^[\w-]+-docker/)[0];
        assert.ok(
          SCAN_TOOLS.some((tool) => tool.fnPrefix === dockerFn),
          `${name}: allow-key grants '${dockerFn}' with no SCAN_TOOL_KEYS entry (a fourth scanner must come with a table row): ${key}`,
        );
      }
    }
    for (const key of name === "verifier" ? GIT_DENY_TAIL : SCANNER_DENY_TAIL) {
      assert.ok(keys.indexOf(key) > lastAllowIndex, `${name}: deny-tail key must come after every allow: ${key}`);
    }
  }
  // This hardening tail is deliberately scanner-only: a blanket "podman*": deny would
  // shadow the verifier's seven project-scoped podman-compose allows.
  const { rules: scannerRules } = parseBashRules(scanner, "scanner");
  assert.equal(scannerRules["source"], "deny");
  assert.equal(scannerRules["podman*"], "deny");
  assert.equal(scannerRules["docker*"], "deny");
  assert.equal(scannerRules["kubectl*"], "deny");
  assert.match(verifier, /secret-output prohibition|secret files/);
  assert.match(scanner, /secret|credentials/);
  for (const tool of SCAN_TOOLS) {
    const wrapper = await readFile(path.join(root, tool.wrapperPath), "utf8");
    assert.match(wrapper, /podman run --rm/, `${tool.label}: containers must be disposable`);
    assert.match(wrapper, tool.imageRe, `${tool.label}: image must be digest-pinned`);
    assert.doesNotMatch(wrapper, /:[\w][\w.-]*@sha256:/, `${tool.label}: tag+digest mix forbidden`);
    assert.ok(wrapper.includes("#/src/.scans/"), `${tool.label}: guard must compare the /src/.scans/ prefix outside [[ (basename strip)`);
    assert.ok(wrapper.includes(`"${tool.guardFlag}"`), `${tool.label}: guard must cover the ${tool.guardFlag} prev-arg form`);
    assert.ok(wrapper.includes(`${tool.guardFlag}=*`), `${tool.label}: guard must cover the ${tool.guardFlag}= value form`);
    if (tool.shortFormRejected) {
      assert.ok(wrapper.includes("== -o*"), `${tool.label}: guard must reject the -o short form outright`);
    }
    // Full OSV-parity shape: pull-if-missing, the :Z mount, the workdir, and .scans creation.
    assert.match(wrapper, /-v "\$\{workdir\}:\/src:Z"/, `${tool.label}: must mount the workdir at /src with :Z`);
    assert.match(wrapper, /--workdir \/src/, `${tool.label}: must set --workdir /src`);
    assert.match(wrapper, /podman image exists/, `${tool.label}: must pull only if the image is missing`);
    assert.match(wrapper, /mkdir -p "\$\{workdir\}\/\.scans"/, `${tool.label}: must create the .scans output directory`);
  }
  // Trivy infra: named cache volume created-if-missing and mounted at the DB
  // cache path, the wrapper-side TRIVY_TIMEOUT default, and the injected
  // artifact-directory skip (adapted to --skip-dirs: the pinned Trivy build
  // rejects --exclude with "unknown flag" — live-verified before baking).
  const trivyWrapper = await readFile(path.join(root, "skills/trivy-scanner/scripts/trivy-scanner-wrapper.sh"), "utf8");
  assert.match(trivyWrapper, /podman volume exists trivy-cache[\s\S]*podman volume create trivy-cache/, "trivy: cache volume must be created if missing");
  assert.match(trivyWrapper, /-v trivy-cache:\/root\/\.cache\/trivy:Z/, "trivy: cache volume must be mounted :Z at /root/.cache/trivy");
  assert.match(trivyWrapper, /-e "TRIVY_TIMEOUT=\$\{TRIVY_TIMEOUT:-10m\}"/, "trivy: wrapper must inject the 10m timeout default");
  assert.match(trivyWrapper, /--skip-dirs \/src\/\.scans/, "trivy: wrapper must skip prior scan artifacts");
  assert.doesNotMatch(trivyWrapper.replace(/^\s*#.*$/gm, ""), /--exclude/, "trivy: the rejected --exclude flag must not be used in any command");
});

test("scanner wrapper output guards reject every unguarded output path", () => {
  // Hermetic: runs in a temp dir with a podman stub on PATH, so a guard bug
  // can never reach real podman/network. The guard fires before mkdir/pull,
  // so every case must exit non-zero with the tool's [label] ERROR: prefix
  // and must not invoke the stub.
  const dir = mkdtempSync(path.join(tmpdir(), "scan-guard-negative-"));
  const binDir = path.join(dir, "bin");
  mkdirSync(binDir);
  const stub = path.join(binDir, "podman");
  writeFileSync(stub, "#!/bin/sh\necho PODMAN_STUB_INVOKED >&2\nexit 97\n");
  chmodSync(stub, 0o755);
  for (const tool of SCAN_TOOLS) {
    const wrapper = path.join(root, tool.wrapperPath);
    const cases = [];
    for (const value of ["/src/evil.json", "/src/.scans/../evil.json", "/src/.scans/", "/src/.scans/.hidden"]) {
      cases.push(`${tool.guardFlag} ${value}`);
    }
    for (const value of ["/src/evil.json", "/src/.scans/../evil.json", "/src/.scans/", "/src/.scans/.hidden"]) {
      cases.push(`${tool.guardFlag}=${value}`);
    }
    if (tool.shortFormRejected) {
      // The broad `-o*` rejection also covers Go-style single-dash long
      // forms (`-output`, `-output=...`), which must never reach the CLI
      // unguarded.
      cases.push("-o /src/evil.json", "-o=/src/evil.json", "-o/src/evil.json", "-output /src/evil.json", "-output=/src/evil.json");
    }
    if (tool.alternateOutputForms) {
      // F3: OSV's guard must cover every output-flag spelling the CLI
      // accepts (single-dash `-output-file` in space and `=` forms) and
      // reject the deprecated `--output`/`-output` aliases and the `-O`
      // short form, so the wrapper's /src/.scans/ claim is true for every
      // write path the pinned build would otherwise accept.
      for (const form of tool.alternateOutputForms) {
        cases.push(form.endsWith("=") ? `${form}/src/evil.json` : `${form} /src/evil.json`);
      }
    }
    for (const bad of cases) {
      // Positional $1 (M4b hardening shape) plus a minimal env (F4): a stray
      // exported *_SCANNER_WORKDIR must not redirect the wrapper's workdir
      // away from the sandbox. HOME is pinned INTO the sandbox because a
      // spawn without HOME lets the runtime prepend system dirs (including
      // a real podman) ahead of the stub bin and break hermeticity.
      const res = spawnSync("bash", ["-c", `source "$1" && ${tool.fnPrefix} ${tool.probeArgs} ${bad} /src`, "bash", wrapper], {
        cwd: dir,
        env: { PATH: `${binDir}:${process.env.PATH}`, HOME: dir },
        encoding: "utf8",
        timeout: 30000,
      });
      const id = `${tool.label}: ${bad}`;
      assert.notEqual(res.status, 0, `${id}: guard must reject this output path`);
      assert.ok(res.stderr.includes(tool.errorPrefix), `${id}: guard must report via stderr: ${res.stderr}`);
      assert.ok(!res.stderr.includes("PODMAN_STUB_INVOKED"), `${id}: guard must fire before any podman invocation`);
    }
  }
});

test("wrapper hardening rejects write-side overrides and symlinked .scans, and injects safe defaults", () => {
  // Hermetic: temp dirs on PATH with a podman stub that logs its argv and
  // exits 0, so injection behavior is observable and rejection is provable
  // without ever touching real podman or the network.
  const run = (dir, wrapper, invocation) => spawnSync("bash", ["-c", `source "$1" && ${invocation}`, "bash", wrapper], {
    cwd: dir,
    // Minimal env (F4): no *_SCANNER_WORKDIR variables may leak in and
    // redirect the wrapper's workdir away from the sandbox `dir` (a stray
    // export would otherwise skew the symlink-parity test and mkdir .scans
    // elsewhere). HOME is pinned INTO the sandbox because a spawn without
    // HOME lets the runtime prepend system dirs (including a real podman)
    // ahead of the stub bin and break hermeticity.
    env: { PATH: `${dir}/bin:${process.env.PATH}`, HOME: dir, PODMAN_ARGV_LOG: process.env.PODMAN_ARGV_LOG },
    encoding: "utf8",
    timeout: 30000,
  });
  const sandbox = () => {
    const dir = mkdtempSync(path.join(tmpdir(), "scan-hardening-"));
    mkdirSync(path.join(dir, "bin"));
    writeFileSync(path.join(dir, "bin", "podman"), '#!/bin/sh\necho "$*" >> "$PODMAN_ARGV_LOG"\nexit 0\n');
    chmodSync(path.join(dir, "bin", "podman"), 0o755);
    return dir;
  };
  const withLog = (fn) => {
    const dir = sandbox();
    const log = path.join(dir, "podman-args.log");
    const logged = () => {
      try {
        return readFileSync(log, "utf8");
      } catch {
        return "";
      }
    };
    process.env.PODMAN_ARGV_LOG = log;
    try {
      fn(dir, logged);
    } finally {
      delete process.env.PODMAN_ARGV_LOG;
    }
  };
  const trivyWrapper = path.join(root, "skills/trivy-scanner/scripts/trivy-scanner-wrapper.sh");
  const semgrepWrapper = path.join(root, "skills/semgrep-scanner/scripts/semgrep-scanner-wrapper.sh");
  const osvWrapper = path.join(root, "skills/osv-scanner/scripts/osv-scanner-wrapper.sh");

  // Trivy cache/tmp-dir write-side overrides are rejected outright in every
  // spelling: double-dash, single-dash, space, and `=` forms (dash-
  // normalized flag-name comparison, so Go-style `-cache-dir` cannot slip
  // past a `--`-prefix-only match).
  for (const bad of [
    "--cache-dir /src/evil", "--tmp-dir /src/evil", "--cache-dir=/src/evil", "--tmp-dir=/src/evil",
    "-cache-dir /src/evil", "-tmp-dir /src/evil", "-cache-dir=/src/evil", "-tmp-dir=/src/evil",
  ]) {
    withLog((dir, logged) => {
      const res = run(dir, trivyWrapper, `trivy-docker fs --scanners vuln ${bad} --output /src/.scans/ok.json /src`);
      assert.notEqual(res.status, 0, `trivy: guard must reject ${bad}`);
      assert.ok(res.stderr.includes("[trivy] ERROR:"), `trivy: rejection must report via stderr for ${bad}`);
      assert.ok(!logged().includes("run --rm"), `trivy: guard must fire before any podman run for ${bad}`);
    });
  }
  // A symlinked .scans artifact directory is refused before any run — and
  // before mkdir -p, so even a dangling symlink yields the clean wrapper
  // error instead of mkdir's raw "File exists" stderr.
  for (const [label, wrapper, invocation] of [
    ["trivy", trivyWrapper, "trivy-docker fs --output /src/.scans/ok.json /src"],
    ["semgrep", semgrepWrapper, "semgrep-docker scan --output /src/.scans/ok.json /src"],
    ["osv-scanner", osvWrapper, "osv-scanner-docker scan source -r --output-file /src/.scans/ok.json /src"],
  ]) {
    for (const dangling of [false, true]) {
      withLog((dir, logged) => {
        if (!dangling) mkdirSync(path.join(dir, "elsewhere"));
        symlinkSync(path.join(dir, "elsewhere"), path.join(dir, ".scans"));
        const res = run(dir, wrapper, invocation);
        assert.notEqual(res.status, 0, `${label}: symlinked .scans must be refused${dangling ? " (dangling)" : ""}`);
        assert.ok(res.stderr.includes("must not be a symlink"), `${label}: symlink refusal must report via stderr`);
        assert.ok(!res.stderr.includes("File exists"), `${label}: the -L check must fire before mkdir -p`);
        assert.ok(!logged().includes("run --rm"), `${label}: symlink refusal must fire before any podman run`);
      });
    }
  }
  // Trivy's --skip-dirs injection gates on the fs/filesystem token anywhere
  // in the args (global flag first still injects); no-token runs stay clean.
  // The injected pair must land ADJACENT and immediately before the caller's
  // arguments (cobra strips it while locating the fs subcommand — the pinned
  // build only accepts the flag via that pre-subcommand adjacent pair, so
  // order is contractual, not incidental).
  withLog((dir, logged) => {
    run(dir, trivyWrapper, "trivy-docker --quiet fs /src");
    assert.match(logged(), /--skip-dirs \/src\/\.scans --quiet fs( |$)/, "trivy: --skip-dirs pair must sit immediately before the caller args on `--quiet fs`");
  });
  withLog((dir, logged) => {
    run(dir, trivyWrapper, "trivy-docker fs /src");
    assert.match(logged(), /--skip-dirs \/src\/\.scans fs( |$)/, "trivy: --skip-dirs pair must sit immediately before the fs subcommand token");
  });
  withLog((dir, logged) => {
    run(dir, trivyWrapper, "trivy-docker --version");
    assert.ok(!logged().includes("--skip-dirs"), "trivy: --version (no fs token) must not get --skip-dirs");
  });
  // OSV self-scan --config injection (repo fixture-exclusion hook): fires
  // only when the marker file sits at the scan root, exactly once, and only
  // after the `source` subcommand token (urfave rejects pre-subcommand
  // placement — live-verified); a caller-supplied --config in any dash form
  // suppresses it; invocations without a `source` token never see it. The
  // e2e gate mounts the fixture itself, where no marker exists, so the osv
  // leg is structurally unaffected.
  withLog((dir, logged) => {
    const res = run(dir, osvWrapper, "osv-scanner-docker scan source -r --format json -output-file /src/.scans/ok.json /src");
    assert.equal(res.status, 0, `osv: a guarded single-dash -output-file under /src/.scans/ must pass the guard: ${res.stderr}`);
    assert.match(logged(), /-output-file \/src\/\.scans\/ok\.json/, "osv: caller arguments pass through to podman run unmodified");
  });
  withLog((dir, logged) => {
    const res = run(dir, osvWrapper, "osv-scanner-docker scan source -r --format json --output-file /src/.scans/ok.json /src");
    assert.ok(!logged().includes("--config"), "osv: no --config injection without the marker file");
    assert.ok(!res.stderr.includes("self-scan config active"), "osv: the stderr notice must not fire without the marker");
  });
  withLog((dir, logged) => {
    writeFileSync(path.join(dir, "osv-scanner.self-scan.toml"), "[[IgnoredVulns]]\nid = \"GHSA-probe\"\nreason = \"test\"\n");
    const res = run(dir, osvWrapper, "osv-scanner-docker scan source -r --format json --output-file /src/.scans/ok.json /src");
    assert.equal((logged().match(/--config/g) ?? []).length, 1, "osv: the marker file must trigger exactly one --config injection");
    assert.match(logged(), /scan source --config \/src\/osv-scanner\.self-scan\.toml -r/, "osv: --config must be injected immediately after the source subcommand token");
    assert.ok(res.stderr.includes("[osv-scanner] self-scan config active: osv-scanner.self-scan.toml applied"), "osv: an injection must announce itself on stderr so a planted marker is visible");
    assert.equal(res.stdout, "", "osv: the injection notice must keep stdout clean");
  });
  withLog((dir, logged) => {
    writeFileSync(path.join(dir, "osv-scanner.self-scan.toml"), "[[IgnoredVulns]]\nid = \"GHSA-probe\"\nreason = \"test\"\n");
    const res = run(dir, osvWrapper, "osv-scanner-docker scan source -r --config /src/theirs.toml --output-file /src/.scans/ok.json /src");
    const out = logged();
    assert.equal((out.match(/--config/g) ?? []).length, 1, "osv: a caller-supplied --config must suppress the marker injection");
    assert.match(out, /--config \/src\/theirs\.toml/, "osv: the caller's --config must survive unmodified");
    assert.ok(!res.stderr.includes("self-scan config active"), "osv: a suppressed injection must not print the notice");
  });
  withLog((dir, logged) => {
    writeFileSync(path.join(dir, "osv-scanner.self-scan.toml"), "[[IgnoredVulns]]\nid = \"GHSA-probe\"\nreason = \"test\"\n");
    const res = run(dir, osvWrapper, "osv-scanner-docker --version");
    assert.ok(!logged().includes("--config"), "osv: --version (no source token) must never receive the injected --config");
    assert.ok(!res.stderr.includes("self-scan config active"), "osv: a marker without an injection point must not print the notice");
  });
  // Semgrep's metrics/version-check safe defaults are injected after the
  // `scan` token only when the caller has not already passed the flag:
  // the pinned semgrep build hard-errors "option '--metrics' cannot be
  // repeated" (exit 2, live-verified), so injection must be conditional per
  // flag. Non-scan invocations are untouched; the agent's exact invocation
  // (both flags already present) must cross the boundary with each flag
  // appearing exactly once.
  withLog((dir, logged) => {
    run(dir, semgrepWrapper, "semgrep-docker scan --json /src");
    assert.match(logged(), /semgrep scan --metrics off --disable-version-check --json/, "semgrep: safe defaults must be injected for scan");
  });
  withLog((dir, logged) => {
    run(dir, semgrepWrapper, "semgrep-docker scan --json --metrics off --disable-version-check --config p/default /src");
    const out = logged();
    assert.equal((out.match(/--metrics/g) ?? []).length, 1, "semgrep: --metrics must appear exactly once when the caller supplies it");
    assert.equal((out.match(/--disable-version-check/g) ?? []).length, 1, "semgrep: --disable-version-check must appear exactly once when the caller supplies it");
    assert.match(out, /semgrep scan --json --metrics off --disable-version-check --config p\/default/, "semgrep: caller flags must pass through unmodified");
  });
  withLog((dir, logged) => {
    run(dir, semgrepWrapper, "semgrep-docker scan --metrics=off /src");
    const out = logged();
    assert.equal((out.match(/--metrics/g) ?? []).length, 1, "semgrep: the `--metrics=off` value form must also suppress injection");
    assert.match(out, /scan --disable-version-check --metrics=off/, "semgrep: only the absent safe default is injected");
  });
  withLog((dir, logged) => {
    run(dir, semgrepWrapper, "semgrep-docker --version");
    assert.ok(!logged().includes("--metrics"), "semgrep: --version must not get metrics flags");
    assert.ok(!logged().includes("--disable-version-check"), "semgrep: --version must not get the version-check flag");
  });
});

test("scanner agent prose mirrors the machine-readable grants, digests, and handling rules", async () => {
  const scanner = await readFile(path.join(root, "agent/code-security-scanner.md"), "utf8");
  const { frontmatter } = parseBashRules(scanner, "scanner");
  const body = scanner.slice(frontmatter.length);
  const flat = body.replace(/\s+/g, " ");
  for (const tool of SCAN_TOOLS) {
    const wrapper = await readFile(path.join(root, tool.wrapperPath), "utf8");
    const skill = await readFile(path.join(root, tool.skillPath), "utf8");
    const imageRef = extractWrapperPin(wrapper).image;
    assert.match(imageRef, tool.imageRe, `${tool.label}: wrapper pin must match the expected image shape`);
    // Extract-and-compare, never hardcoded: the same digest must appear in
    // the scanner trust-boundary prose and in the tool's SKILL.md.
    assert.ok(body.includes(imageRef), `${tool.label}: scanner prose must pin the same digest as its wrapper`);
    assert.ok(skill.includes(imageRef), `${tool.label}: SKILL.md must pin the same digest as its wrapper`);
    assert.ok(body.includes(tool.wrapperPath), `${tool.label}: scanner body must carry the wrapper path`);
    // AC-09: each literal source…&&<fn>… chain in prose byte-matches its allow keys.
    assert.ok(body.includes(`${tool.wrapperKey} && ${tool.invocationKey}`), `${tool.label}: prose chain must byte-match the allow keys`);
  }
  assert.match(flat, /each scan is its own single `source … && <function> …` authorized command/i, "per-segment authorization must be stated");
  assert.match(flat, /three legs are \*\*independent\*\*/, "leg independence must be stated");
  assert.match(flat, /`--output-file` for OSV-Scanner, `--output` for Semgrep and Trivy/, "per-tool guard flag names must be distinguished");
  assert.match(flat, /read findings from the artifacts, not exit codes/i, "artifacts-over-exit-codes guidance must be stated");
  assert.match(flat, /operates on the host filesystem and does not shell-expand/, "host-path pre-check guidance must be stated");
  assert.match(flat, /ERROR → Major, WARNING → Minor, INFO → Nit/, "Semgrep severity mapping must be stated");
  assert.match(flat, /Elevate to Critical.*injection, RCE, or a hardcoded-secret/, "Semgrep elevation rule must be stated");
  assert.match(flat, /CRITICAL → Critical, HIGH → Major, MEDIUM → Minor, LOW → Nit/, "Trivy severity mapping must be stated");
  assert.match(flat, /secret findings are always critical \(blocking\)/i, "Trivy secrets must always be Critical");
  assert.match(flat, /report only the `file:line` location and the rule id/i, "secret redaction must cite file:line + rule ID only");
  assert.match(flat, /never\*\* copy the `code` snippet/i, "secret redaction must never quote snippet content");
  assert.match(flat, /narrow `grep`\*\* on the artifact/, "secret handling must avoid reading whole secret sections");
  assert.match(flat, /"scans skipped"\*\*\s+\*per tool\*/, "per-tool degradation must be stated");
  assert.match(flat, /Findings from the tools that did run still count/i, "skipped tools must not void the others");
  assert.match(flat, /if \*\*all three\*\* were skipped the whole report is still a non-blocking/, "all-skipped must stay non-blocking");
  assert.match(flat, /same package at the same version.*same CVE\/GHSA\/OSV alias ID/i, "dedup key must be package@version + advisory ID");
  assert.match(flat, /one finding tagged with both sources/i, "deduped findings must be tagged with both sources");
  assert.match(flat, /maximum of the two mapped severities/i, "dedup severity must take the maximum");
  assert.match(flat, /Different advisory IDs stay separate/i, "distinct advisory IDs must not merge");
  assert.match(flat, /SonarQube is a deliberate deferred future extension/, "SonarQube deferral must be stated");
  assert.ok(body.includes("/src/.scans/"), "artifacts must be pinned under /src/.scans/");
  for (const artifact of ["final-osv-results.json", "final-semgrep-results.json", "final-trivy-results.json"]) {
    assert.ok(body.includes(artifact), `artifact ${artifact} must appear in the prose`);
  }
});

// The `.gitignore` pre-flight is the Major-#1 leak guardrail: pin the
// scanner prose, its missing-file (n4) and read-only clauses, and the
// orchestrator mirror, so a future edit cannot silently drop it green.
test("the .gitignore pre-flight guardrail stays pinned in scanner and orchestrator prose", async () => {
  const scanner = await readFile(path.join(root, "agent/code-security-scanner.md"), "utf8");
  const sflat = scanner.replace(/\s+/g, " ");
  assert.match(scanner, /\*\*Artifact `\.gitignore` pre-flight\.\*\*/, "scanner must keep the .gitignore pre-flight section");
  assert.match(sflat, /repo-local and does not travel to an arbitrary pipeline target/, "pre-flight must justify itself with the repo-local caveat");
  assert.match(sflat, /check the target project's `\.gitignore` for a `\.scans\/` entry/, "pre-flight must check the TARGET project, not this repo");
  assert.match(sflat, /if it is missing — or the target has \*\*no `\.gitignore` at all\*\* \(the same Major/, "a missing .gitignore file must be the same Major as a missing entry");
  assert.match(sflat, /report a \*\*Major\*\* finding \(location `\.gitignore:1`/, "pre-flight must map to a Major at .gitignore:1");
  assert.match(sflat, /before any commit/, "the Major must gate any commit");
  assert.match(sflat, /do not edit `\.gitignore` yourself/, "the scanner must stay read-only about .gitignore");
  const orchestrator = await readFile(path.join(root, "agent/code-orchestrator.md"), "utf8");
  const oflat = orchestrator.replace(/\s+/g, " ");
  assert.match(oflat, /scanner also pre-flights the target project's own `\.gitignore`/, "orchestrator mirror must keep the pre-flight");
  assert.match(oflat, /this repo's ignore rule is repo-local/, "orchestrator mirror must keep the repo-local caveat");
  assert.match(oflat, /missing `\.scans\/` entry in the target comes back as a Major finding/, "orchestrator mirror must keep the Major escalation");
  assert.match(oflat, /must be fixed before any commit/, "orchestrator mirror must keep the commit gate");
});

// The exit-code prose was corrected after live runs against the pinned
// digests (2026-09-04): OSV exits 1 on advisories; semgrep and trivy exit 0
// even with findings. These pins keep the docs honest about what was
// observed, not folklore.
test("exit-code and opt-out prose matches the live-verified behavior", async () => {
  const scanner = (await readFile(path.join(root, "agent/code-security-scanner.md"), "utf8")).replace(/\s+/g, " ");
  assert.match(scanner, /OSV-Scanner exits 1 when advisories are found, while Semgrep and Trivy exit \*\*0\*\* even when they \*find\* things/, "scanner prose must state the live-verified exit codes");
  const semgrepSkill = (await readFile(path.join(root, "skills/semgrep-scanner/SKILL.md"), "utf8")).replace(/\s+/g, " ");
  assert.match(semgrepSkill, /Semgrep exits `0` whether or not findings exist/, "semgrep SKILL must not claim exit 1 on findings");
  assert.match(semgrepSkill, /\*removed\* leg yields \*\*no\*\* "scans skipped" note/, "semgrep opt-out must not promise a skip note for a removed leg");
  const trivySkill = (await readFile(path.join(root, "skills/trivy-scanner/SKILL.md"), "utf8")).replace(/\s+/g, " ");
  assert.match(trivySkill, /Trivy exits `0` even when findings exist/, "trivy SKILL must state the default --exit-code 0 behavior");
  assert.match(trivySkill, /A \*removed\* leg yields \*\*no\*\* "scans skipped" note/, "trivy opt-out must not promise a skip note for a removed leg");
  assert.match(trivySkill, /every scanned \*\*target project\*\* must carry its own `\.scans\/` ignore entry/, "trivy SKILL must scope the gitignore caveat to targets, not just this repo");
});

// The wrappers advertise ~/.zshrc persistence; the semgrep injection uses
// bash-style array slicing. Prove they all at least PARSE under zsh when it
// is installed (skipped, not failed, on machines without zsh).
test("all three scanner wrappers parse under zsh (advertised ~/.zshrc persistence)", (t) => {
  const probe = spawnSync("zsh", ["--version"], { encoding: "utf8", timeout: 15000 });
  if (probe.error || probe.status !== 0) {
    t.skip("zsh is not available in this environment");
    return;
  }
  for (const tool of SCAN_TOOLS) {
    const res = spawnSync("zsh", ["-n", path.join(root, tool.wrapperPath)], { encoding: "utf8", timeout: 15000 });
    assert.equal(res.status, 0, `${tool.label}: wrapper must parse under zsh (${res.stderr.trim()})`);
  }
});

// Sourcing happens in the agent's real shell (often zsh), and parsing is not
// executing: the independent verifier caught the combined OSV chain leaking
// four `name=value` lines (argname=r, prevname=r, argname=format,
// prevname=format) to STDOUT under zsh while bash stayed silent. Root cause:
// a bare `local NAME` re-executed inside the guard loop makes zsh's `local`
// echo an already-assigned parameter's value, whereas bash preserves it
// silently (trivy carried the same latent defect via flagname/prevname).
// The declarations are now hoisted before the loop in the value-carrying
// `local NAME=""` form, which is silent in BOTH shells. This gate runs the
// pinned allow-key chain under zsh and bash and asserts: zero bytes on
// stdout, no stray name=value-shaped lines in the combined output at all,
// and byte-verbatim argv at the podman boundary — including the marker-gated
// --config injection path that was the original report's suspect.
test("valid wrapper invocations leak no stray name=value lines under zsh or bash", (t) => {
  const probe = spawnSync("zsh", ["--version"], { encoding: "utf8", timeout: 15000 });
  if (probe.error || probe.status !== 0) {
    t.skip("zsh is not available in this environment");
    return;
  }
  const STRAY_LINE_RE = /^\s*(argname|prevname|flagname)=/m;
  const dir = mkdtempSync(path.join(tmpdir(), "scan-zsh-noise-"));
  mkdirSync(path.join(dir, "bin"));
  // Stub podman (existing-harness shape): logs argv, exits 0 — no real
  // container, network, or image ever touched.
  writeFileSync(path.join(dir, "bin", "podman"), '#!/bin/sh\necho "$*" >> "$PODMAN_ARGV_LOG"\nexit 0\n');
  chmodSync(path.join(dir, "bin", "podman"), 0o755);
  const log = path.join(dir, "podman-args.log");
  const logged = () => {
    try {
      return readFileSync(log, "utf8");
    } catch {
      return "";
    }
  };
  const run = (shell, wrapper, invocation) => spawnSync(shell, ["-c", `source "$1" && ${invocation}`, shell, wrapper], {
    cwd: dir,
    // Same minimal-env doctrine as the bash hardening test: no stray
    // *_SCANNER_WORKDIR may redirect the workdir; HOME is pinned into the
    // sandbox so the runtime cannot prepend system dirs ahead of the stub.
    env: { PATH: `${dir}/bin:${process.env.PATH}`, HOME: dir, PODMAN_ARGV_LOG: log },
    encoding: "utf8",
    timeout: 30000,
  });
  const assertCleanChain = (shell, tool, res, verbatim = true) => {
    const id = `${tool.label} under ${shell}`;
    assert.equal(res.status, 0, `${id}: pinned invocation must succeed: ${res.stderr}`);
    assert.equal(res.stdout, "", `${id}: nothing may reach stdout: ${JSON.stringify(res.stdout)}`);
    assert.ok(!STRAY_LINE_RE.test(`${res.stdout}\n${res.stderr}`), `${id}: combined output must carry no name=value noise: ${res.stdout}${res.stderr}`);
    if (verbatim) {
      const pinnedArgs = tool.invocationKey.slice(tool.fnPrefix.length + 1);
      assert.ok(logged().includes(pinnedArgs), `${id}: podman run must receive the pinned arguments verbatim: ${logged()}`);
    }
  };
  // (a) No marker file at the scan root: faithful passthrough, no
  // --config, no injection — in BOTH shells. (The no---config assertion
  // is scoped to the OSV run's own log slice: semgrep's pinned invocation
  // legitimately carries its own --config p/default.)
  for (const shell of ["bash", "zsh"]) {
    for (const tool of SCAN_TOOLS) {
      const before = logged().length;
      assertCleanChain(shell, tool, run(shell, path.join(root, tool.wrapperPath), tool.invocationKey));
      if (tool.label === "osv-scanner") {
        assert.ok(!logged().slice(before).includes("--config"), `osv: ${shell} passthrough run must not inject --config without the marker`);
      }
    }
  }
  // (b) The suspect path under zsh: marker present, so the --config pair
  // is injected right after the `source` token — exactly once, caller
  // argv otherwise untouched, and still zero stray lines. The --config
  // count is likewise scoped to this run's own log slice.
  writeFileSync(path.join(dir, "osv-scanner.self-scan.toml"), "[[IgnoredVulns]]\nid = \"GHSA-probe\"\nreason = \"test\"\n");
  const osv = SCAN_TOOLS.find((tool) => tool.label === "osv-scanner");
  const injectedRun = logged().length;
  const injectedRes = run("zsh", path.join(root, osv.wrapperPath), osv.invocationKey);
  assertCleanChain("zsh", osv, injectedRes, false);
  assert.ok(injectedRes.stderr.includes("[osv-scanner] self-scan config active"), "osv under zsh: the injection must announce itself on stderr (stdout stays clean)");
  const injected = logged().slice(injectedRun);
  assert.equal((injected.match(/--config/g) ?? []).length, 1, "osv under zsh: marker must trigger exactly one --config injection");
  assert.match(injected, /scan source --config \/src\/osv-scanner\.self-scan\.toml -r/, "osv under zsh: --config must land immediately after the source token, identically to bash");
  assert.ok(injected.includes("-r --format json --output-file /src/.scans/final-osv-results.json /src"), `osv under zsh: everything after the injection point must pass through unmodified: ${injected}`);
  // (c) The guard must still fire under zsh with clean reporting (the
  // fix removed prints, not the rejection path).
  const rejected = run("zsh", path.join(root, osv.wrapperPath), "osv-scanner-docker scan source -r --output-file /src/evil.json /src");
  assert.notEqual(rejected.status, 0, "osv under zsh: the /src/.scans/ guard must still reject");
  assert.ok(rejected.stderr.includes("[osv-scanner] ERROR:"), "osv under zsh: rejection must report via stderr");
  assert.ok(!STRAY_LINE_RE.test(`${rejected.stdout}\n${rejected.stderr}`), "osv under zsh: the rejection path itself must stay noise-free");
});

// The deeper live-e2e gate: the leg definitions must stay byte-identical to
// the scanner agent's allow-keys (never a divergent copy), target the right
// wrapper/artifact per tool, and their finding-count oracles must be
// fail-closed (an empty or wrong-shape artifact never passes).
test("live-e2e legs byte-match the allow-key invocations and count findings fail-closed", async () => {
  // F6 + final micro-round Sec N2: the legs iterate a table while the
  // wrapper sweep enumerates disk — SET equality (not mere length equality)
  // means adding a scanner wrapper without an explicit e2e leg, or a leg
  // without its wrapper, is a test failure, mirroring the "zero wrappers is
  // an error" doctrine.
  const wrapperFiles = await listScanWrappers(root);
  assert.deepEqual(wrapperFiles.sort(), LIVE_E2E_LEGS.map((leg) => leg.wrapperPath).sort(), "the live-e2e legs must cover exactly the scanned wrapper files, one apiece (adding a scanner forces a leg decision)");
  assert.equal(LIVE_E2E_LEGS.length, 3, "one e2e leg per scanner");
  for (const tool of SCAN_TOOLS) {
    const leg = LIVE_E2E_LEGS.find((candidate) => candidate.tool === tool.label);
    assert.ok(leg, `${tool.label}: must have a live-e2e leg`);
    assert.equal(leg.invocation, tool.invocationKey, `${tool.label}: e2e invocation must byte-match the agent allow-key`);
    assert.equal(leg.wrapperPath, tool.wrapperPath, `${tool.label}: e2e leg must source the reviewed wrapper`);
    assert.match(tool.invocationKey, /\/src\/\.scans\/(\S+) \/src$/, `${tool.label}: allow-key must carry a /src/.scans/<artifact> output path before the /src target`);
    assert.equal(leg.artifact, tool.invocationKey.match(/\/src\/\.scans\/(\S+) \/src$/)[1], `${tool.label}: e2e artifact must be the allow-key's output file`);
    assert.equal(leg.countFindings({}), 0, `${tool.label}: empty artifact never passes the gate`);
    assert.equal(leg.countFindings(null), 0, `${tool.label}: null artifact never passes the gate`);
  }
  assert.equal(LIVE_E2E_LEGS[0].countFindings({ results: [{ packages: [{ vulnerabilities: [{}, {}] }] }] }), 2, "osv: v2 nested packages[].vulnerabilities counted");
  assert.equal(LIVE_E2E_LEGS[0].countFindings({ results: [{ vulnerabilities: [{}] }] }), 1, "osv: legacy flat results[].vulnerabilities counted");
  assert.equal(LIVE_E2E_LEGS[1].countFindings({ results: [{ extra: { severity: "ERROR" } }, { extra: { severity: "WARNING" } }] }), 1, "semgrep: only ERROR results satisfy the gate");
  assert.equal(LIVE_E2E_LEGS[1].countFindings({ results: [{ extra: { severity: "WARNING" } }] }), 0, "semgrep: warnings alone do not satisfy the gate");
  assert.equal(LIVE_E2E_LEGS[2].countFindings({ Results: [{ Misconfigurations: [{}], Secrets: [{}, {}] }] }), 3, "trivy: misconfigs and secrets counted");
  assert.equal(LIVE_E2E_LEGS[2].countFindings({ Results: [{ Vulnerabilities: [{}] }] }), 0, "trivy: vulns alone do not satisfy the gate");
});

// The npm wiring must exist and the default unit-test path must stay
// hermetic: live and live-e2e are separate explicit commands.
test("live-e2e is wired as its own script and npm test stays hermetic", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts["validate:security:live:e2e"], "node scripts/validate-security-config.mjs --live-e2e", "package.json must expose the deeper gate");
  assert.equal(pkg.scripts["validate:security:live"], "node scripts/validate-security-config.mjs --live", "the fast --version live path stays separate");
  assert.ok(!/live/i.test(pkg.scripts.test), "npm test must never trigger live scans");
  assert.equal(pkg.overrides, undefined, "the toml overrides escalation stays pending with the user; package.json must not carry them");
});

test("checkScanWrapper is fail-closed on synthetic wrappers and passes every real one", async () => {
  const digest = "a".repeat(64);
  const good = [
    `    local image="docker.io/example/tool@sha256:${digest}"`,
    "    podman run --rm \\",
    '        -v "${workdir}:/src:Z" \\',
    '        "${image}" \\',
    '    echo "guard: /src/.scans/"',
  ].join("\n");
  assert.deepEqual(checkScanWrapper("synthetic-good-wrapper.sh", good), []);
  // The digest literal itself in the run invocation is the accepted
  // alternative to the "${image}" variable.
  assert.deepEqual(checkScanWrapper("synthetic-good-literal.sh", good.replace('"${image}"', `"` + `docker.io/example/tool@sha256:${digest}"`)), []);
  const reject = (relPath, mutated) => {
    const errors = checkScanWrapper(relPath, mutated);
    assert.ok(errors.length > 0, `${relPath}: must be rejected`);
  };
  reject("no-disposable-run.sh", good.replace("podman run --rm", "podman run"));
  reject("floating-tag.sh", good.replace(`@sha256:${digest}`, ":latest"));
  reject("tag-digest-mix.sh", good.replace("@sha256:", ":0.1@sha256:"));
  reject("no-pin.sh", good.replace(/local image="[^"]+"/, "local image=\"docker.io/example/tool\""));
  reject("no-guard.sh", good.replace("/src/.scans/", "/src/out/"));
  // Declares a digest pin yet runs a tagged image instead: the pin must be
  // the image actually passed to podman run, and no stray registry
  // reference may live outside the 'local image=' line and comments.
  reject("runs-tag-despite-pin.sh", good.replace('"${image}"', '"other/repo:latest"'));
  reject("stray-image-literal.sh", `${good}\npodman run --rm \\\n    evil.example/tool:1.0 \\\n    "$@"\n`);
  // A SECOND `podman run --rm` block must also carry the pin: an unpinned
  // single-token image (no slash, so no stray-reference regex match) can
  // only be caught by checking every run block, not just the first.
  reject("second-run-block-unpinned.sh", `${good}\npodman run --rm busybox:latest echo hi\n`);
  // F2: the block sweep triggers on ANY `podman run` line, not just `--rm`
  // ones — `podman run busybox:latest ...` has no `--rm`, no slash, and no
  // tag-at-digest shape, so it escaped both the old sweep trigger and the
  // STRAY regex; it must now fail closed.
  reject("second-run-no-rm-unpinned.sh", `${good}\npodman run busybox:latest echo hi\n`);
  // Sec Nit-2: the trigger now fires per `;`/`&&` segment of each
  // continuation-joined logical line, so an unpinned `podman run` hidden
  // mid-compound — no slash or digest shape, invisible to the STRAY regex —
  // fails closed.
  reject("compound-semi-run-unpinned.sh", `${good}\nX=1; podman run busybox echo hi\n`);
  reject("compound-and-run-unpinned.sh", `${good}\ncd /src && podman run busybox:1.36 echo hi\n`);
  // Carried Security Nit-2 (comment direction 1): comment lines never
  // execute, so a doc comment that literally mentions `podman run --rm`
  // with an unpinned ref must not create a false-positive block error.
  assert.deepEqual(checkScanWrapper("comment-mentions-run.sh", `${good}\n# podman run --rm docker.io/example/evil:9.9 echo hi\n`), []);
  // Carried Security Nit-2 (comment direction 2): conversely, a comment
  // must not SATISFY the disposable-run check either — the real run here
  // lacks --rm.
  reject("comment-fake-disposable-run.sh", `${good.replace("    podman run --rm \\", "    podman run \\")}\n# podman run --rm docker.io/example/tool:9.9\n`);
  // Real repo wrappers must all satisfy the same contract, and the sweep must
  // see them (zero wrappers is fail-closed in validateSecurityConfiguration).
  const wrappers = await listScanWrappers(root);
  assert.ok(wrappers.length >= 3, "the sweep must find the OSV, semgrep, and trivy wrappers");
  for (const rel of wrappers) {
    assert.deepEqual(checkScanWrapper(rel, await readFile(path.join(root, rel), "utf8")), [], `${rel}: must pass`);
  }
  assert.deepEqual(await listScanWrappers(mkdtempSync(path.join(tmpdir(), "no-skills-here-"))), []);
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
