import { describe, expect, it } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

describe("ioredis not installed error message", () => {
  it("source code contains 'bun add ioredis' error message", () => {
    const source = readFileSync(join(__dirname, "redis.ts"), "utf-8")
    expect(source).toContain("bun add ioredis")
  })
})
