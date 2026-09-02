import assert from "node:assert/strict";
import { test } from "node:test";
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "searxng-secret-"));
  const secretDirectory = path.join(directory, "secret");
  const entrypoint = path.join(directory, "entrypoint");
  const wrapper = path.join(directory, "bootstrap");
  await writeFile(entrypoint, "#!/bin/sh\nsleep 0.2\nprintf '%s' \"$SEARXNG_SECRET\" > \"$SECRET_OUTPUT\"\n");
  await chmod(entrypoint, 0o755);
  const source = await readFile(path.join(root, "mcp/searxng/bootstrap-secret.sh"), "utf8");
  await writeFile(
    wrapper,
    source.replace("/var/lib/searxng-secret", secretDirectory).replace(
      "/usr/local/searxng/entrypoint.sh",
      entrypoint,
    ),
  );
  await chmod(wrapper, 0o755);
  return { directory, secretDirectory, wrapper };
}

test("bootstrap generates and reuses a restrictive persistent secret", async () => {
  const fixturePaths = await fixture();
  const output = path.join(fixturePaths.directory, "output");
  await mkdir(fixturePaths.secretDirectory);

  await exec(fixturePaths.wrapper, [], { env: { ...process.env, SECRET_OUTPUT: output } });
  const first = await readFile(path.join(fixturePaths.secretDirectory, "secret"), "utf8");
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal((await stat(path.join(fixturePaths.secretDirectory, "secret"))).mode & 0o777, 0o600);
  assert.equal(await readFile(output, "utf8"), first);

  await exec(fixturePaths.wrapper, [], { env: { ...process.env, SECRET_OUTPUT: output } });
  assert.equal(await readFile(path.join(fixturePaths.secretDirectory, "secret"), "utf8"), first);
});

test("explicit secret takes precedence without changing fallback state", async () => {
  const fixturePaths = await fixture();
  const output = path.join(fixturePaths.directory, "output");
  const explicit = "explicit-secret";
  await exec(fixturePaths.wrapper, [], {
    env: { ...process.env, SEARXNG_SECRET: explicit, SECRET_OUTPUT: output },
  });
  assert.equal(await readFile(output, "utf8"), explicit);
  await assert.rejects(readFile(path.join(fixturePaths.secretDirectory, "secret")));
});

test("bootstrap fails when persistent storage is absent or malformed", async () => {
  const absent = await fixture();
  await assert.rejects(exec(absent.wrapper, [], { env: { ...process.env } }));

  const malformed = await fixture();
  await mkdir(malformed.secretDirectory);
  await writeFile(path.join(malformed.secretDirectory, "secret"), "not-a-secret");
  await assert.rejects(exec(malformed.wrapper, [], { env: { ...process.env } }));
});

test("concurrent initialization serializes access to persistent storage", async () => {
  const fixturePaths = await fixture();
  const firstOutput = path.join(fixturePaths.directory, "first-output");
  const secondOutput = path.join(fixturePaths.directory, "second-output");
  await mkdir(fixturePaths.secretDirectory);

  await Promise.all([
    exec(fixturePaths.wrapper, [], { env: { ...process.env, SECRET_OUTPUT: firstOutput } }),
    exec(fixturePaths.wrapper, [], { env: { ...process.env, SECRET_OUTPUT: secondOutput } }),
  ]);

  const secret = await readFile(path.join(fixturePaths.secretDirectory, "secret"), "utf8");
  assert.equal(await readFile(firstOutput, "utf8"), secret);
  assert.equal(await readFile(secondOutput, "utf8"), secret);
});
