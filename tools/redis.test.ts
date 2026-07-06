import { describe, expect, it, test, mock, beforeEach, afterEach, spyOn } from "bun:test"

// ---------------------------------------------------------------------------
// Mock ioredis BEFORE importing the module under test
// ---------------------------------------------------------------------------

function createMockRedis() {
  return {
    connect: mock(() => Promise.resolve()),
    quit: mock(() => Promise.resolve("OK")),
    get: mock((key: string) => Promise.resolve("value")),
    set: mock((key: string, value: any, ...args: any[]) => Promise.resolve("OK")),
    del: mock((key: string) => Promise.resolve(1)),
    exists: mock((key: string) => Promise.resolve(1)),
    keys: mock((pattern: string) => Promise.resolve(["key1", "key2"])),
    scan: mock((cursor: string, ...args: any[]) => Promise.resolve(["0", ["key1", "key2"]])),
    ttl: mock((key: string) => Promise.resolve(-1)),
    type: mock((key: string) => Promise.resolve("string")),
    dbsize: mock(() => Promise.resolve(42)),
    ping: mock(() => Promise.resolve("PONG")),
    info: mock(() => Promise.resolve("redis_version:7.0\nconnected_clients:1\nused_memory_human:1M\n")),
    strlen: mock((key: string) => Promise.resolve(5)),
    mget: mock((...keys: string[]) => Promise.resolve(["v1", "v2"])),
    mset: mock((...kv: any[]) => Promise.resolve("OK")),
    append: mock((key: string, value: any) => Promise.resolve(10)),
    incr: mock((key: string) => Promise.resolve(2)),
    decr: mock((key: string) => Promise.resolve(0)),
    rename: mock((key: string, newKey: string) => Promise.resolve("OK")),
    expire: mock((key: string, seconds: number) => Promise.resolve(1)),
    hget: mock((key: string, field: string) => Promise.resolve("fieldval")),
    hset: mock((key: string, field: string, value: any) => Promise.resolve(1)),
    hdel: mock((key: string, field: string) => Promise.resolve(1)),
    hgetall: mock((key: string) => Promise.resolve({ f1: "v1", f2: "v2" })),
    hkeys: mock((key: string) => Promise.resolve(["f1", "f2"])),
    hvals: mock((key: string) => Promise.resolve(["v1", "v2"])),
    hlen: mock((key: string) => Promise.resolve(2)),
    hexists: mock((key: string, field: string) => Promise.resolve(1)),
    hincrby: mock((key: string, field: string, inc: number) => Promise.resolve(5)),
    lpush: mock((key: string, ...elements: any[]) => Promise.resolve(3)),
    rpush: mock((key: string, ...elements: any[]) => Promise.resolve(3)),
    lrange: mock((key: string, start: number, stop: number) => Promise.resolve(["a", "b", "c"])),
    llen: mock((key: string) => Promise.resolve(3)),
    lindex: mock((key: string, index: number) => Promise.resolve("a")),
    lpop: mock((key: string, count?: number) => Promise.resolve(["a"])),
    rpop: mock((key: string, count?: number) => Promise.resolve(["c"])),
    lrem: mock((key: string, count: number, element: any) => Promise.resolve(1)),
    sadd: mock((key: string, ...members: any[]) => Promise.resolve(1)),
    smembers: mock((key: string) => Promise.resolve(["m1", "m2"])),
    scard: mock((key: string) => Promise.resolve(2)),
    srem: mock((key: string, ...members: any[]) => Promise.resolve(1)),
    sismember: mock((key: string, member: any) => Promise.resolve(1)),
    spop: mock((key: string, count?: number) => Promise.resolve(["m1"])),
    flushdb: mock(() => Promise.resolve("OK")),
  }
}

let mockRedis: ReturnType<typeof createMockRedis>

mock.module("ioredis", () => ({
  default: class MockRedis {
    constructor(opts: any) {
      Object.assign(this, createMockRedis())
      ;(this as any).connectOptions = opts
    }
  }
}))

// Now import the module under test
import {
  extractRedisIdentifier,
  sanitizeConnectionString,
  parseConnectionString,
  formatValue,
  formatKeyValueTable,
  formatList,
  formatResult,
  RedisDriver,
  resetTlsWarningFlag,
} from "./redis"

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe("extractRedisIdentifier", () => {
  it("extracts host:port/db from a valid URL with port", () => {
    expect(extractRedisIdentifier("redis://localhost:6379/0")).toBe("localhost:6379/0")
  })
  it("defaults port to 6379 when not specified", () => {
    expect(extractRedisIdentifier("redis://myhost/1")).toBe("myhost:6379/1")
  })
  it("extracts host:port/db with custom port and db", () => {
    expect(extractRedisIdentifier("redis://host:6380/5")).toBe("host:6380/5")
  })
  it("falls back to raw string for invalid URLs", () => {
    expect(extractRedisIdentifier("not-a-url")).toBe("not-a-url")
  })
})

describe("sanitizeConnectionString", () => {
  it("redacts password in a valid redis:// URL", () => {
    const result = sanitizeConnectionString("redis://user:secret@host:6379")
    expect(result).toContain("****")
    expect(result).not.toContain("secret")
  })
  it("redacts password in a valid rediss:// URL", () => {
    const result = sanitizeConnectionString("rediss://user:secret@host:6379")
    expect(result).toContain("****")
    expect(result).not.toContain("secret")
  })
  it("leaves URL without password unchanged", () => {
    const result = sanitizeConnectionString("redis://localhost:6379")
    expect(result).not.toContain("****")
  })
  it("redacts password in a non-URL string with password pattern", () => {
    const result = sanitizeConnectionString("redis://admin:pass123@host")
    expect(result).toContain("****")
    expect(result).not.toContain("pass123")
  })
  it("leaves non-URL string without password unchanged", () => {
    const result = sanitizeConnectionString("localhost:6379")
    expect(result).toBe("localhost:6379")
  })
})

describe("parseConnectionString", () => {
  it("parses a full URL with all parts", () => {
    const result = parseConnectionString("redis://user:pass@myhost:6380/5")
    expect(result).toEqual({ host: "myhost", port: 6380, password: "pass", db: 5 })
  })
  it("parses a minimal URL with defaults", () => {
    const result = parseConnectionString("redis://localhost:6379/0")
    expect(result).toEqual({ host: "localhost", port: 6379, password: undefined, db: 0 })
  })
  it("parses a URL with password but no username", () => {
    const result = parseConnectionString("redis://:secret@host:6379")
    expect(result).toEqual({ host: "host", port: 6379, password: "secret", db: 0 })
  })
  it("parses a URL with db index and default port", () => {
    const result = parseConnectionString("redis://host/3")
    expect(result).toEqual({ host: "host", port: 6379, password: undefined, db: 3 })
  })
  it("parses an IPv6 address", () => {
    const result = parseConnectionString("redis://[::1]:6379/0")
    expect(result.host).toBe("[::1]")
    expect(result.port).toBe(6379)
  })
})

describe("formatValue", () => {
  it("formats null as NULL", () => expect(formatValue(null)).toBe("NULL"))
  it("formats undefined as NULL", () => expect(formatValue(undefined)).toBe("NULL"))
  it("decodes a Buffer as utf-8 string", () => {
    expect(formatValue(Buffer.from("hello", "utf-8"))).toBe("hello")
  })
  it("JSON-stringifies an object with 2-space indent", () => {
    expect(formatValue({ foo: "bar" })).toBe('{\n  "foo": "bar"\n}')
  })
  it("formats a primitive string as-is", () => expect(formatValue("hello")).toBe("hello"))
  it("formats a number as string", () => expect(formatValue(42)).toBe("42"))
  it("formats NaN as string", () => expect(formatValue(NaN)).toBe("NaN"))
  it("formats Infinity as string", () => expect(formatValue(Infinity)).toBe("Infinity"))
  it("formats a Symbol as its description", () => expect(formatValue(Symbol("test"))).toBe("Symbol(test)"))
})

describe("formatKeyValueTable", () => {
  it("returns _(empty)_ for an empty array", () => {
    expect(formatKeyValueTable([])).toBe("_(empty)_")
  })
  it("formats entries as a markdown table", () => {
    const result = formatKeyValueTable([["name", "Alice"], ["age", 30]])
    expect(result).toContain("| Key | Value |")
    expect(result).toContain("| --- | --- |")
    expect(result).toContain("Alice")
    expect(result).toContain("30")
    expect(result).toContain("2 entries")
  })
  it("escapes pipe characters in values", () => {
    const result = formatKeyValueTable([["key", "a|b"]])
    expect(result).toContain("a\\|b")
  })
  it("truncates values longer than 200 characters", () => {
    const longVal = "x".repeat(300)
    const result = formatKeyValueTable([["key", longVal]])
    expect(result).toContain("...")
    expect(result.length).toBeLessThan(500)
  })
  it("escapes newlines in values", () => {
    const result = formatKeyValueTable([["key", "line1\nline2"]])
    expect(result).toContain("line1\\nline2")
  })
  it("escapes pipe characters in keys", () => {
    const result = formatKeyValueTable([["a|b", "val"]])
    expect(result).toContain("a\\|b")
  })
})

describe("formatList", () => {
  it("returns _(empty)_ for an empty array", () => {
    expect(formatList([])).toBe("_(empty)_")
  })
  it("formats multiple items as a numbered markdown list", () => {
    const result = formatList(["a", "b", "c"])
    expect(result).toBe("1. a\n2. b\n3. c")
  })
  it("formats null/undefined items as NULL", () => {
    const result = formatList(["a", null, "c"])
    expect(result).toBe("1. a\n2. NULL\n3. c")
  })
})

describe("formatResult", () => {
  it("formats a label and value as bold label with value", () => {
    expect(formatResult("Key", "value")).toBe("**Key:** value")
  })
  it("formats a label with null value as NULL", () => {
    expect(formatResult("Key", null)).toBe("**Key:** NULL")
  })
})

// ---------------------------------------------------------------------------
// TLS warning gating tests
// ---------------------------------------------------------------------------

describe("TLS warning gating", () => {
  let warnSpy: ReturnType<typeof mock>

  beforeEach(() => {
    resetTlsWarningFlag()
    warnSpy = mock((...args: any[]) => {})
    spyOn(console, "warn").mockImplementation(warnSpy)
  })

  afterEach(() => {
    mock.restore()
  })

  it("triggers console.warn on first non-TLS connection", async () => {
    const { default: redisTool } = await import("./redis")
    await redisTool.execute({ connectionString: "redis://localhost:6379", action: "ping" }, {} as any)
    expect(warnSpy).toHaveBeenCalled()
    const warnMsg = warnSpy.mock.calls[0][0]
    expect(warnMsg).toContain("TLS")
  })

  it("does NOT trigger console.warn on second non-TLS connection", async () => {
    const { default: redisTool } = await import("./redis")
    await redisTool.execute({ connectionString: "redis://localhost:6379", action: "ping" }, {} as any)
    warnSpy.mockClear()
    await redisTool.execute({ connectionString: "redis://localhost:6379", action: "ping" }, {} as any)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it("triggers console.warn again after resetTlsWarningFlag()", async () => {
    const { default: redisTool } = await import("./redis")
    await redisTool.execute({ connectionString: "redis://localhost:6379", action: "ping" }, {} as any)
    warnSpy.mockClear()
    resetTlsWarningFlag()
    await redisTool.execute({ connectionString: "redis://localhost:6379", action: "ping" }, {} as any)
    expect(warnSpy).toHaveBeenCalled()
  })

  it("does NOT trigger console.warn for TLS connections (rediss://)", async () => {
    const { default: redisTool } = await import("./redis")
    await redisTool.execute({ connectionString: "rediss://localhost:6379", action: "ping" }, {} as any)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it("does NOT trigger console.warn for TLS connections (?tls=true)", async () => {
    const { default: redisTool } = await import("./redis")
    await redisTool.execute({ connectionString: "redis://localhost:6379?tls=true", action: "ping" }, {} as any)
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// RedisDriver tests
// ---------------------------------------------------------------------------

describe("RedisDriver", () => {
  let driver: RedisDriver

  beforeEach(() => {
    driver = new RedisDriver()
  })

  afterEach(async () => {
    await driver.close()
  })

  describe("connect()", () => {
    it("creates client and connects with a valid connection string", async () => {
      await driver.connect("redis://localhost:6379/0")
      expect((driver as any).client).not.toBeNull()
    })

    it("throws on an invalid URL", async () => {
      await expect(driver.connect("not-a-valid-url-at-all")).rejects.toThrow()
    })
  })

  describe("execute() — Read operations", () => {
    beforeEach(async () => {
      await driver.connect("redis://localhost:6379/0")
    })

    it("get — returns formatted result with the value", async () => {
      const result = await driver.execute("get", { key: "foo" })
      expect(result.output).toContain("value")
    })

    it("set — returns success message", async () => {
      const result = await driver.execute("set", { key: "foo", value: "bar" })
      expect(result.output).toContain("✅")
    })

    it("set with TTL — returns success message mentioning TTL", async () => {
      const result = await driver.execute("set", { key: "foo", value: "bar", seconds: 60 })
      expect(result.output).toContain("TTL")
    })

    it("del — returns deletion message", async () => {
      const result = await driver.execute("del", { key: "foo" })
      expect(result.output).toContain("🗑️")
    })

    it("exists — returns true when key exists", async () => {
      const result = await driver.execute("exists", { key: "foo" })
      expect(result.output).toContain("true")
    })

    it("keys with * — warns and returns formatted key list", async () => {
      const warnSpy = mock((...args: any[]) => {})
      spyOn(console, "warn").mockImplementation(warnSpy)
      const result = await driver.execute("keys", { pattern: "*" })
      expect(warnSpy).toHaveBeenCalled()
      expect(result.output).toContain("key1")
      mock.restore()
    })

    it("keys with empty pattern — defaults to * and warns", async () => {
      const warnSpy = mock((...args: any[]) => {})
      spyOn(console, "warn").mockImplementation(warnSpy)
      const result = await driver.execute("keys", { pattern: "" })
      expect(warnSpy).toHaveBeenCalled()
      expect(result.output).toContain("key1")
      mock.restore()
    })

    it("scan — returns formatted key list", async () => {
      const result = await driver.execute("scan", { pattern: "*", count: 10 })
      expect(result.output).toContain("key1")
    })

    it("ttl — returns formatted TTL info", async () => {
      const result = await driver.execute("ttl", { key: "foo" })
      expect(result.output).toContain("No expiry")
    })

    it("type — returns key type", async () => {
      const result = await driver.execute("type", { key: "foo" })
      expect(result.output).toContain("string")
    })

    it("dbsize — returns database size", async () => {
      const result = await driver.execute("dbsize", {})
      expect(result.output).toContain("42")
    })

    it("ping — returns PONG", async () => {
      const result = await driver.execute("ping", {})
      expect(result.output).toContain("PONG")
    })

    it("info — returns server info summary", async () => {
      const result = await driver.execute("info", {})
      expect(result.output).toContain("redis_version")
    })

    it("strlen — returns string length", async () => {
      const result = await driver.execute("strlen", { key: "foo" })
      expect(result.output).toContain("5")
    })

    it("mget — returns key-value table", async () => {
      const result = await driver.execute("mget", { keys: ["k1", "k2"] })
      expect(result.output).toContain("v1")
    })

    it("hgetall — returns hash fields table", async () => {
      const result = await driver.execute("hgetall", { key: "hash" })
      expect(result.output).toContain("f1")
    })

    it("hkeys — returns field list", async () => {
      const result = await driver.execute("hkeys", { key: "hash" })
      expect(result.output).toContain("f1")
    })

    it("hvals — returns value list", async () => {
      const result = await driver.execute("hvals", { key: "hash" })
      expect(result.output).toContain("v1")
    })

    it("hlen — returns field count", async () => {
      const result = await driver.execute("hlen", { key: "hash" })
      expect(result.output).toContain("2")
    })

    it("hexists — returns true/false", async () => {
      const result = await driver.execute("hexists", { key: "hash", field: "f1" })
      expect(result.output).toContain("true")
    })

    it("lrange — returns list items", async () => {
      const result = await driver.execute("lrange", { key: "list", start: 0, stop: -1 })
      expect(result.output).toContain("a")
    })

    it("llen — returns list length", async () => {
      const result = await driver.execute("llen", { key: "list" })
      expect(result.output).toContain("3")
    })

    it("lindex — returns element at index", async () => {
      const result = await driver.execute("lindex", { key: "list", index: 0 })
      expect(result.output).toContain("a")
    })

    it("smembers — returns set members", async () => {
      const result = await driver.execute("smembers", { key: "set" })
      expect(result.output).toContain("m1")
    })

    it("scard — returns set cardinality", async () => {
      const result = await driver.execute("scard", { key: "set" })
      expect(result.output).toContain("2")
    })

    it("sismember — returns membership status", async () => {
      const result = await driver.execute("sismember", { key: "set", member: "m1" })
      expect(result.output).toContain("true")
    })
  })

  describe("execute() — Write operations", () => {
    beforeEach(async () => {
      await driver.connect("redis://localhost:6379/0")
    })

    it("mset — returns success message", async () => {
      const result = await driver.execute("mset", { keyValues: { a: "1", b: "2" } })
      expect(result.output).toContain("✅")
    })

    it("mset — preserves number values (not stringified)", async () => {
      const result = await driver.execute("mset", { keyValues: { count: 42, price: 9.99 } })
      expect(result.output).toContain("✅")
    })

    it("mset — preserves boolean values", async () => {
      const result = await driver.execute("mset", { keyValues: { enabled: true, disabled: false } })
      expect(result.output).toContain("✅")
    })

    it("mset — handles null values", async () => {
      const result = await driver.execute("mset", { keyValues: { key: null } })
      expect(result.output).toContain("✅")
    })

    it("mset — JSON.stringify's objects and arrays", async () => {
      const result = await driver.execute("mset", { keyValues: { config: { theme: "dark" }, items: ["a", "b"] } })
      expect(result.output).toContain("✅")
    })

    it("append — returns new length", async () => {
      const result = await driver.execute("append", { key: "foo", value: "bar" })
      expect(result.output).toContain("10")
    })

    it("incr — returns new value", async () => {
      const result = await driver.execute("incr", { key: "counter" })
      expect(result.output).toContain("2")
    })

    it("decr — returns new value", async () => {
      const result = await driver.execute("decr", { key: "counter" })
      expect(result.output).toContain("0")
    })

    it("rename — returns success message", async () => {
      const result = await driver.execute("rename", { key: "old", newKey: "new" })
      expect(result.output).toContain("✅")
    })

    it("expire — returns success message", async () => {
      const result = await driver.execute("expire", { key: "foo", seconds: 60 })
      expect(result.output).toContain("✅")
    })

    it("hset — returns success message", async () => {
      const result = await driver.execute("hset", { key: "hash", field: "f1", value: "v1" })
      expect(result.output).toContain("✅")
    })

    it("hincrby — returns new value", async () => {
      const result = await driver.execute("hincrby", { key: "hash", field: "counter", increment: 5 })
      expect(result.output).toContain("5")
    })

    it("lpush — returns new length", async () => {
      const result = await driver.execute("lpush", { key: "list", elements: ["a", "b"] })
      expect(result.output).toContain("3")
    })

    it("rpush — returns new length", async () => {
      const result = await driver.execute("rpush", { key: "list", elements: ["a", "b"] })
      expect(result.output).toContain("3")
    })

    it("sadd — returns added count", async () => {
      const result = await driver.execute("sadd", { key: "set", members: ["m1", "m2"] })
      expect(result.output).toContain("1")
    })
  })

  describe("execute() — Delete operations", () => {
    beforeEach(async () => {
      await driver.connect("redis://localhost:6379/0")
    })

    it("hdel — returns removal message", async () => {
      const result = await driver.execute("hdel", { key: "hash", field: "f1" })
      expect(result.output).toContain("🗑️")
    })

    it("lrem — returns removed count", async () => {
      const result = await driver.execute("lrem", { key: "list", count: 1, element: "a" })
      expect(result.output).toContain("1")
    })

    it("lpop — returns popped items", async () => {
      const result = await driver.execute("lpop", { key: "list", count: 1 })
      expect(result.output).toContain("🗑️")
    })

    it("rpop — returns popped items", async () => {
      const result = await driver.execute("rpop", { key: "list", count: 1 })
      expect(result.output).toContain("🗑️")
    })

    it("srem — returns removed count", async () => {
      const result = await driver.execute("srem", { key: "set", members: ["m1"] })
      expect(result.output).toContain("1")
    })

    it("spop — returns popped items", async () => {
      const result = await driver.execute("spop", { key: "set", count: 1 })
      expect(result.output).toContain("🗑️")
    })
  })

  describe("execute() — Safety gates", () => {
    beforeEach(async () => {
      await driver.connect("redis://localhost:6379/0")
    })

    it("flushdb without confirm — throws error", async () => {
      await expect(driver.execute("flushdb", {})).rejects.toThrow("Confirmation required")
    })

    it("flushdb with confirm — returns success", async () => {
      const result = await driver.execute("flushdb", { confirm: true })
      expect(result.output).toContain("🗑️")
    })
  })

  describe("execute() — Error handling", () => {
    beforeEach(async () => {
      await driver.connect("redis://localhost:6379/0")
    })

    it("ECONNREFUSED — returns connection refused error", async () => {
      const client = (driver as any).getClient()
      client.get = mock(() => Promise.reject({ code: "ECONNREFUSED" }))
      await expect(driver.execute("get", { key: "foo" })).rejects.toThrow("Connection refused")
    })

    it("ETIMEOUT — returns timeout error", async () => {
      const client = (driver as any).getClient()
      client.get = mock(() => Promise.reject({ code: "ETIMEOUT" }))
      await expect(driver.execute("get", { key: "foo" })).rejects.toThrow("timed out")
    })

    it("NOAUTH — returns authentication error", async () => {
      const client = (driver as any).getClient()
      client.get = mock(() => Promise.reject(new Error("NOAUTH")))
      await expect(driver.execute("get", { key: "foo" })).rejects.toThrow("Authentication failed")
    })

    it("WRONGTYPE — returns wrong kind error", async () => {
      const client = (driver as any).getClient()
      client.get = mock(() => Promise.reject(new Error("WRONGTYPE")))
      await expect(driver.execute("get", { key: "foo" })).rejects.toThrow("wrong kind")
    })

    it("Unknown action — lists supported actions", async () => {
      await expect(driver.execute("unknown_action", {})).rejects.toThrow("Unknown action")
    })
  })

  describe("execute() — Metadata", () => {
    beforeEach(async () => {
      await driver.connect("redis://localhost:6379/0")
    })

    it("result contains action, key, connection, duration", async () => {
      const result = await driver.execute("get", { key: "foo" })
      expect(result.metadata.action).toBe("get")
      expect(result.metadata.key).toBe("foo")
      expect(result.metadata.connection).toEqual({ host: "localhost", port: 6379, db: 0 })
      expect(result.metadata.duration).toBeGreaterThanOrEqual(0)
    })
  })

  describe("connect() — Retry strategy", () => {
    it("retryStrategy returns increasing delays and stops after 3 attempts", async () => {
      await driver.connect("redis://localhost:6379/0")
      const client = (driver as any).client
      const retryStrategy = client.connectOptions.retryStrategy
      expect(retryStrategy(1)).toBe(200)
      expect(retryStrategy(2)).toBe(400)
      expect(retryStrategy(3)).toBe(600)
      expect(retryStrategy(4)).toBeNull()
    })
  })

  describe("execute() — Input validation", () => {
    beforeEach(async () => {
      await driver.connect("redis://localhost:6379/0")
    })

    it("Pattern too long (> 1024 chars) throws error mentioning 1024", async () => {
      const longPattern = "a".repeat(1025)
      await expect(driver.execute("keys", { pattern: longPattern })).rejects.toThrow("1024")
    })

    it("Pattern with null byte throws error mentioning null byte", async () => {
      await expect(driver.execute("keys", { pattern: "foo\0bar" })).rejects.toThrow("null byte")
    })

    it("Valid pattern succeeds", async () => {
      const result = await driver.execute("keys", { pattern: "valid:*" })
      expect(result.output).toContain("key1")
    })

    it("Key with null byte throws error", async () => {
      await expect(driver.execute("get", { key: "foo\0bar" })).rejects.toThrow("null byte")
    })

    it("newKey too long throws error mentioning 512", async () => {
      const longKey = "a".repeat(513)
      await expect(driver.execute("rename", { key: "old", newKey: longKey })).rejects.toThrow("512")
    })

    it("Field with null byte throws error", async () => {
      await expect(driver.execute("hget", { key: "hash", field: "f\0ield" })).rejects.toThrow("null byte")
    })

    it("Member with null byte throws error", async () => {
      await expect(driver.execute("sismember", { key: "set", member: "m\0ember" })).rejects.toThrow("null byte")
    })

    it("Element with null byte throws error", async () => {
      await expect(driver.execute("lrem", { key: "list", count: 1, element: "e\0lement" })).rejects.toThrow("null byte")
    })

    it("lrange with large stop value caps to max 1000 items", async () => {
      const result = await driver.execute("lrange", { key: "list", start: 0, stop: 2000 })
      expect(result.output).toContain("[0..")
    })

    it("mget with too many keys throws error mentioning 100", async () => {
      const manyKeys = Array.from({ length: 101 }, (_, i) => `key${i}`)
      await expect(driver.execute("mget", { keys: manyKeys })).rejects.toThrow("100")
    })

    it("keys with many results truncates at 10000", async () => {
      const client = (driver as any).getClient()
      const manyKeys = Array.from({ length: 15000 }, (_, i) => `key${i}`)
      client.keys = mock(() => Promise.resolve(manyKeys))
      const result = await driver.execute("keys", { pattern: "*" })
      expect(result.output).toContain("10000")
    })
  })

  describe("close()", () => {
    it("calls client.quit() on normal close", async () => {
      await driver.connect("redis://localhost:6379/0")
      const client = (driver as any).client
      const quitSpy = mock(() => Promise.resolve("OK"))
      client.quit = quitSpy
      await driver.close()
      expect(quitSpy).toHaveBeenCalled()
    })

    it("handles error during close gracefully", async () => {
      await driver.connect("redis://localhost:6379/0")
      const client = (driver as any).client
      client.quit = mock(() => Promise.reject(new Error("close error")))
      await expect(driver.close()).resolves.toBeUndefined()
    })
  })
})
