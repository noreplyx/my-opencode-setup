import { tool } from "@opencode-ai/plugin"

/**
 * Module-level cache for the ioredis module.
 * Avoids repeated dynamic imports (~5-50ms latency per call) after first load.
 */
let redisModule: typeof import("ioredis") | null = null

/**
 * Module-level flag to gate the TLS warning so it only fires once per session.
 */
let tlsWarningShown = false

/**
 * Connection cache for reusing active ioredis clients.
 */
interface CachedConnection {
  client: import("ioredis").Redis
  lastUsed: number
}

const connectionCache = new Map<string, CachedConnection>()

/**
 * Extracts a human-readable Redis instance identifier from a connection string.
 */
function extractRedisIdentifier(connStr: string): string {
  try {
    const url = new URL(connStr)
    const db = url.pathname ? url.pathname.replace(/^\//, "") : "0"
    return `${url.hostname}:${url.port || "6379"}/${db}`
  } catch {
    return connStr
  }
}

/**
 * Sanitizes a connection string for safe logging (redacts password).
 */
function sanitizeConnectionString(connStr: string): string {
  try {
    const url = new URL(connStr)
    if (url.password) {
      url.password = "****"
    }
    return url.toString()
  } catch {
    // If it's not a valid URL, just mask anything that looks like a password
    return connStr.replace(/(:)([^@]+)(@)/, "$1****$3")
  }
}

/**
 * Parses a Redis connection string and returns connection options.
 */
function parseConnectionString(connStr: string): {
  host: string
  port: number
  username?: string
  password?: string
  db: number
  tls: boolean
} {
  const url = new URL(connStr)
  const host = url.hostname || "localhost"
  const port = parseInt(url.port || "6379", 10)
  const username = url.username ? decodeURIComponent(url.username) : undefined
  const password = url.password ? decodeURIComponent(url.password) : undefined
  const db = parseInt((url.pathname || "").replace(/^\//, "") || "0", 10)
  const tls = url.protocol === "rediss:" || url.searchParams.get("tls") === "true"
  return { host, port, username, password, db, tls }
}

/**
 * Formats a Redis reply value for display.
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL"
  if (Buffer.isBuffer(value)) return value.toString("utf-8")
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

/**
 * Formats results as a markdown table.
 */
function formatKeyValueTable(entries: [string, any][]): string {
  if (entries.length === 0) return "_(empty)_"
  const header = "| Key | Value |"
  const separator = "| --- | --- |"
  const body = entries
    .map(([k, v]) => {
      const val = formatValue(v)
      // Escape pipe characters and truncate long values
      const escapedVal = val.replace(/\|/g, "\\|").replace(/\n/g, "\\n")
      const truncatedVal = escapedVal.length > 200 ? escapedVal.substring(0, 200) + "..." : escapedVal
      const escapedKey = k.replace(/\|/g, "\\|")
      return `| ${escapedKey} | ${truncatedVal} |`
    })
    .join("\n")
  return `${header}\n${separator}\n${body}\n\n_${entries.length} entries_`
}

/**
 * Formats a simple list of values as a markdown list.
 */
function formatList(items: any[]): string {
  if (items.length === 0) return "_(empty)_"
  return items.map((item, i) => `${i + 1}. ${formatValue(item)}`).join("\n")
}

/**
 * Formats a single result value.
 */
function formatResult(label: string, value: any): string {
  return `**${label}:** ${formatValue(value)}`
}

/**
 * Validates a Redis key/field/member/element parameter.
 * Throws if the value contains null bytes or exceeds the maximum length.
 */
function validateKeyParam(value: string, name: string, maxLength: number = 512): void {
  if (typeof value !== "string") return
  if (value.includes("\0")) {
    throw new Error(`'${name}' contains null bytes which are not allowed`)
  }
  if (value.length > maxLength) {
    throw new Error(`'${name}' exceeds maximum length of ${maxLength} characters`)
  }
}

/**
 * Validates an array of key/field/member parameters.
 */
function validateKeyArray(arr: string[], name: string, maxLength: number = 512): void {
  if (!Array.isArray(arr)) return
  for (let i = 0; i < arr.length; i++) {
    validateKeyParam(arr[i], `${name}[${i}]`, maxLength)
  }
}

// ---------------------------------------------------------------------------
// Redis Driver
// ---------------------------------------------------------------------------

interface RedisConnection {
  host: string
  port: number
  db: number
}

interface RedisResult {
  output: string
  metadata: {
    action: string
    key?: string
    connection: RedisConnection
    duration: number
  }
}

class RedisDriver {
  private redis: typeof import("ioredis") | null = null
  private client: import("ioredis").Redis | null = null
  private connection: RedisConnection = { host: "localhost", port: 6379, db: 0 }
  private connKey: string = ""

  async connect(connectionString: string): Promise<void> {
    if (redisModule) {
      this.redis = redisModule
    } else {
      try {
        const Redis = await import("ioredis")
        this.redis = Redis
        redisModule = Redis
      } catch {
        throw new Error(
          "Redis driver (ioredis) is not installed. Run: bun add ioredis"
        )
      }
    }

    const opts = parseConnectionString(connectionString)
    this.connection = { host: opts.host, port: opts.port, db: opts.db }
    this.connKey = `${opts.username || ""}:${opts.host}:${opts.port}/${opts.db}`

    const cached = connectionCache.get(this.connKey)
    if (cached && (cached.client.status === "ready" || cached.client.status === "connect")) {
      this.client = cached.client
      cached.lastUsed = Date.now()
      return
    }

    const clientOpts: import("ioredis").RedisOptions = {
      host: opts.host,
      port: opts.port,
      username: opts.username,
      password: opts.password,
      db: opts.db,
      connectTimeout: 10000,
      retryStrategy: (times: number) => {
        if (times > 3) return null // Stop retrying after 3 attempts
        return Math.min(times * 200, 2000)
      },
      lazyConnect: true,
    }

    if (opts.tls) {
      clientOpts.tls = {}
    }

    this.client = new this.redis.default(clientOpts)
    await this.getClient().connect()

    connectionCache.set(this.connKey, { client: this.client, lastUsed: Date.now() })
  }

  /**
   * Safely returns the connected Redis client, throwing if not connected.
   */
  private getClient(): import("ioredis").Redis {
    if (!this.client) {
      throw new Error("Redis client is not connected. Call connect() first.")
    }
    return this.client
  }

  async execute(action: string, args: Record<string, any>): Promise<RedisResult> {
    const startTime = Date.now()
    let output = ""
    const key = args.key

    // Validate main key parameter if present
    if (key) {
      validateKeyParam(key, "key")
    }

    try {
      switch (action) {
        // ---- Read Operations ----

        case "get": {
          if (!key) throw new Error("'key' is required for get")
          const value = await this.getClient().get(key)
          output = formatResult("Value", value)
          break
        }

        case "mget": {
          if (!args.keys || !Array.isArray(args.keys) || args.keys.length === 0) {
            throw new Error("'keys' (array) is required for mget")
          }
          if (args.keys.length > 100) {
            throw new Error("'keys' array exceeds maximum of 100 keys for mget")
          }
          validateKeyArray(args.keys, "keys")
          const values = await this.getClient().mget(...args.keys)
          const entries = args.keys.map((k: string, i: number) => [k, values[i]] as [string, any])
          output = formatKeyValueTable(entries)
          break
        }

        case "exists": {
          if (!key) throw new Error("'key' is required for exists")
          const count = await this.getClient().exists(key)
          output = formatResult("Exists", count > 0 ? "true" : "false")
          break
        }

        case "keys": {
          const pattern = args.pattern || "*"
          if (pattern) {
            validateKeyParam(pattern, "pattern", 1024)
          }
          // WARNING: KEYS blocks Redis on large databases. For production, prefer 'scan'.
          if (pattern === "*") {
            console.warn("⚠️  KEYS * blocks Redis on large databases. Consider using 'scan' instead.")
          }
          const keys = await this.getClient().keys(pattern)
          if (keys.length > 10000) {
            keys.length = 10000
          }
          if (keys.length === 0) {
            output = `_(no keys matching pattern \`${pattern}\`)_`
          } else {
            output = `**Keys matching \`${pattern}\`:** (${keys.length} total)\n\n${formatList(keys)}`
          }
          break
        }

        case "scan": {
          const pattern = args.pattern || "*"
          if (pattern) {
            validateKeyParam(pattern, "pattern", 1024)
          }
          const count = args.count || 100
          const maxKeysLimit = 1000
          const maxIterations = 100
          const keys: string[] = []
          let cursor = "0"
          let iterations = 0
          let isCapped = false

          do {
            const result = await this.getClient().scan(cursor, "MATCH", pattern, "COUNT", count)
            cursor = result[0]
            keys.push(...result[1])
            iterations++

            if (keys.length >= maxKeysLimit) {
              keys.length = maxKeysLimit
              isCapped = true
              break
            }
            if (iterations >= maxIterations) {
              isCapped = true
              break
            }
          } while (cursor !== "0")

          if (keys.length === 0) {
            output = `_(no keys matching pattern \`${pattern}\`)_`
          } else {
            const capNotice = isCapped ? " _(results capped at 1,000 keys)_" : ""
            output = `**Keys matching \`${pattern}\`:** (${keys.length} total)${capNotice}\n\n${formatList(keys)}`
          }
          break
        }

        case "ttl": {
          if (!key) throw new Error("'key' is required for ttl")
          const ttl = await this.getClient().ttl(key)
          const label = ttl === -1 ? "No expiry" : ttl === -2 ? "Key does not exist" : `${ttl} seconds`
          output = formatResult("TTL", label)
          break
        }

        case "type": {
          if (!key) throw new Error("'key' is required for type")
          const type = await this.getClient().type(key)
          output = formatResult("Type", type)
          break
        }

        case "dbsize": {
          const size = await this.getClient().dbsize()
          output = formatResult("Database size", `${size} keys`)
          break
        }

        case "ping": {
          const result = await this.getClient().ping()
          output = formatResult("PING", result)
          break
        }

        case "info": {
          const info = await this.getClient().info()
          const lines = info.split("\n")
          const summary: string[] = []
          for (const line of lines) {
            if (
              line.startsWith("redis_version:") ||
              line.startsWith("uptime_in_seconds:") ||
              line.startsWith("connected_clients:") ||
              line.startsWith("used_memory_human:") ||
              line.startsWith("total_system_memory_human:") ||
              line.startsWith("db0:") ||
              line.startsWith("keyspace_hits:") ||
              line.startsWith("keyspace_misses:") ||
              line.startsWith("role:")
            ) {
              summary.push(line.trim())
            }
          }
          output = `**Redis Server Info:**\n\n${summary.join("\n")}`
          break
        }

        case "strlen": {
          if (!key) throw new Error("'key' is required for strlen")
          const len = await this.getClient().strlen(key)
          output = formatResult("String length", len)
          break
        }

        // ---- Hash Read Operations ----

        case "hget": {
          if (!key) throw new Error("'key' is required for hget")
          if (!args.field) throw new Error("'field' is required for hget")
          validateKeyParam(args.field, "field")
          const value = await this.getClient().hget(key, args.field)
          output = formatResult(`Hash field "${args.field}"`, value)
          break
        }

        case "hgetall": {
          if (!key) throw new Error("'key' is required for hgetall")
          const obj = await this.getClient().hgetall(key)
          const entries = Object.entries(obj)
          output = `**Hash: \`${key}\`**\n\n${formatKeyValueTable(entries)}`
          break
        }

        case "hkeys": {
          if (!key) throw new Error("'key' is required for hkeys")
          const fields = await this.getClient().hkeys(key)
          if (fields.length === 0) {
            output = `_(hash \`${key}\` is empty or does not exist)_`
          } else {
            output = `**Fields in hash \`${key}\`:** (${fields.length} total)\n\n${formatList(fields)}`
          }
          break
        }

        case "hvals": {
          if (!key) throw new Error("'key' is required for hvals")
          const values = await this.getClient().hvals(key)
          if (values.length === 0) {
            output = `_(hash \`${key}\` is empty or does not exist)_`
          } else {
            output = `**Values in hash \`${key}\`:** (${values.length} total)\n\n${formatList(values)}`
          }
          break
        }

        case "hlen": {
          if (!key) throw new Error("'key' is required for hlen")
          const len = await this.getClient().hlen(key)
          output = formatResult(`Hash "${key}" field count`, len)
          break
        }

        case "hexists": {
          if (!key) throw new Error("'key' is required for hexists")
          if (!args.field) throw new Error("'field' is required for hexists")
          validateKeyParam(args.field, "field")
          const exists = await this.getClient().hexists(key, args.field)
          output = formatResult(`Field "${args.field}" exists in "${key}"`, exists ? "true" : "false")
          break
        }

        // ---- List Read Operations ----

        case "lrange": {
          if (!key) throw new Error("'key' is required for lrange")
          const start = args.start ?? 0
          const stop = args.stop ?? -1
          const maxItems = 1000
          const effectiveStop = stop === -1 ? (start + maxItems - 1) : Math.min(stop, start + maxItems - 1)
          const items = await this.getClient().lrange(key, start, effectiveStop)
          if (items.length === 0) {
            output = `_(list \`${key}\` is empty or does not exist)_`
          } else {
            output = `**List \`${key}\` [${start}..${effectiveStop}]:** (${items.length} items)\n\n${formatList(items)}`
          }
          break
        }

        case "llen": {
          if (!key) throw new Error("'key' is required for llen")
          const len = await this.getClient().llen(key)
          output = formatResult(`List "${key}" length`, len)
          break
        }

        case "lindex": {
          if (!key) throw new Error("'key' is required for lindex")
          if (args.index === undefined) throw new Error("'index' is required for lindex")
          const value = await this.getClient().lindex(key, args.index)
          output = formatResult(`List "${key}"[${args.index}]`, value)
          break
        }

        // ---- Set Read Operations ----

        case "smembers": {
          if (!key) throw new Error("'key' is required for smembers")
          const members = await this.getClient().smembers(key)
          if (members.length === 0) {
            output = `_(set \`${key}\` is empty or does not exist)_`
          } else {
            output = `**Set \`${key}\`:** (${members.length} members)\n\n${formatList(members)}`
          }
          break
        }

        case "scard": {
          if (!key) throw new Error("'key' is required for scard")
          const count = await this.getClient().scard(key)
          output = formatResult(`Set "${key}" cardinality`, count)
          break
        }

        case "sismember": {
          if (!key) throw new Error("'key' is required for sismember")
          if (!args.member) throw new Error("'member' is required for sismember")
          validateKeyParam(args.member, "member")
          const isMember = await this.getClient().sismember(key, args.member)
          output = formatResult(`"${args.member}" is member of "${key}"`, isMember ? "true" : "false")
          break
        }

        // ---- Sorted Set Read Operations ----

        case "zrange": {
          if (!key) throw new Error("'key' is required for zrange")
          const start = args.start ?? 0
          const stop = args.stop ?? -1
          const withScores = args.withScores === true
          let items: string[]
          if (withScores) {
            items = await this.getClient().zrange(key, start, stop, "WITHSCORES")
            const entries: [string, string][] = []
            for (let i = 0; i < items.length; i += 2) {
              entries.push([items[i], items[i + 1]])
            }
            output = `**Sorted Set \`${key}\` [${start}..${stop}] (with scores):**\n\n${formatKeyValueTable(entries)}`
          } else {
            items = await this.getClient().zrange(key, start, stop)
            output = items.length === 0
              ? `_(sorted set \`${key}\` is empty or does not exist)_`
              : `**Sorted Set \`${key}\` [${start}..${stop}]:** (${items.length} members)\n\n${formatList(items)}`
          }
          break
        }

        case "zrevrange": {
          if (!key) throw new Error("'key' is required for zrevrange")
          const start = args.start ?? 0
          const stop = args.stop ?? -1
          const withScores = args.withScores === true
          let items: string[]
          if (withScores) {
            items = await this.getClient().zrevrange(key, start, stop, "WITHSCORES")
            const entries: [string, string][] = []
            for (let i = 0; i < items.length; i += 2) {
              entries.push([items[i], items[i + 1]])
            }
            output = `**Sorted Set \`${key}\` [${start}..${stop}] (reverse with scores):**\n\n${formatKeyValueTable(entries)}`
          } else {
            items = await this.getClient().zrevrange(key, start, stop)
            output = items.length === 0
              ? `_(sorted set \`${key}\` is empty or does not exist)_`
              : `**Sorted Set \`${key}\` [${start}..${stop}] (reverse):** (${items.length} members)\n\n${formatList(items)}`
          }
          break
        }

        case "zcard": {
          if (!key) throw new Error("'key' is required for zcard")
          const card = await this.getClient().zcard(key)
          output = formatResult(`Sorted Set "${key}" cardinality`, card)
          break
        }

        case "zscore": {
          if (!key) throw new Error("'key' is required for zscore")
          if (!args.member) throw new Error("'member' is required for zscore")
          validateKeyParam(args.member, "member")
          const score = await this.getClient().zscore(key, args.member)
          output = formatResult(`Score of "${args.member}" in "${key}"`, score === null ? "NULL" : score)
          break
        }

        case "zrank": {
          if (!key) throw new Error("'key' is required for zrank")
          if (!args.member) throw new Error("'member' is required for zrank")
          validateKeyParam(args.member, "member")
          const rank = await this.getClient().zrank(key, args.member)
          output = formatResult(`Rank of "${args.member}" in "${key}"`, rank === null ? "NULL" : rank)
          break
        }

        // ---- Write/Update Operations ----

        case "set": {
          if (!key) throw new Error("'key' is required for set")
          if (args.value === undefined) throw new Error("'value' is required for set")
          const result = args.seconds !== undefined
            ? await this.getClient().set(key, args.value, "EX", args.seconds)
            : await this.getClient().set(key, args.value)
          output = result === "OK"
            ? `✅ Key \`${key}\` set successfully${args.seconds ? ` (TTL: ${args.seconds}s)` : ""}`
            : `Result: ${formatValue(result)}`
          break
        }

        case "mset": {
          if (!args.keyValues || typeof args.keyValues !== "object" || Object.keys(args.keyValues).length === 0) {
            throw new Error("'keyValues' object with at least one key-value pair is required for mset")
          }
          const keys = Object.keys(args.keyValues)
          validateKeyArray(keys, "keyValues")
          const kvPairs: (string | number)[] = []
          for (const [k, v] of Object.entries(args.keyValues)) {
            kvPairs.push(k, v === null ? "" : typeof v === "boolean" ? String(v) : typeof v === "object" ? JSON.stringify(v) : v as string | number)
          }
          const result = await this.getClient().mset(...kvPairs)
          output = result === "OK"
            ? `✅ ${keys.length} keys set successfully`
            : `Result: ${formatValue(result)}`
          break
        }

        case "append": {
          if (!key) throw new Error("'key' is required for append")
          if (args.value === undefined) throw new Error("'value' is required for append")
          const newLen = await this.getClient().append(key, args.value)
          output = formatResult(`Appended to "${key}", new length`, newLen)
          break
        }

        case "incr": {
          if (!key) throw new Error("'key' is required for incr")
          const newVal = await this.getClient().incr(key)
          output = formatResult(`INCR "${key}"`, newVal)
          break
        }

        case "decr": {
          if (!key) throw new Error("'key' is required for decr")
          const newVal = await this.getClient().decr(key)
          output = formatResult(`DECR "${key}"`, newVal)
          break
        }

        case "rename": {
          if (!key) throw new Error("'key' is required for rename")
          if (!args.newKey) throw new Error("'newKey' is required for rename")
          validateKeyParam(args.newKey, "newKey")
          await this.getClient().rename(key, args.newKey)
          output = `✅ Key \`${key}\` renamed to \`${args.newKey}\``
          break
        }

        case "expire": {
          if (!key) throw new Error("'key' is required for expire")
          if (args.seconds === undefined) throw new Error("'seconds' is required for expire")
          const result = await this.getClient().expire(key, args.seconds)
          output = result === 1
            ? `✅ TTL set on \`${key}\`: ${args.seconds}s`
            : `⚠️  Key \`${key}\` does not exist`
          break
        }

        // ---- Hash Write Operations ----

        case "hset": {
          if (!key) throw new Error("'key' is required for hset")
          if (args.fields && typeof args.fields === "object" && Object.keys(args.fields).length > 0) {
            const fieldEntries = Object.entries(args.fields)
            validateKeyArray(fieldEntries.map(([f]) => f), "fields")
            const flatArgs: (string | number)[] = []
            for (const [f, v] of fieldEntries) {
              flatArgs.push(f, typeof v === "object" ? JSON.stringify(v) : (v as string | number))
            }
            const newFields = await this.getClient().hset(key, ...flatArgs)
            output = `✅ Hash \`${key}\` updated with ${fieldEntries.length} field(s) (${newFields} new field(s))`
          } else if (args.field !== undefined && args.value !== undefined) {
            validateKeyParam(args.field, "field")
            const newFields = await this.getClient().hset(key, args.field, args.value)
            output = newFields > 0
              ? `✅ Hash \`${key}\` field \`${args.field}\` set (${newFields} new field(s))`
              : `✅ Hash \`${key}\` field \`${args.field}\` updated`
          } else {
            throw new Error("Either ('field' and 'value') or ('fields' object) is required for hset")
          }
          break
        }

        case "hincrby": {
          if (!key) throw new Error("'key' is required for hincrby")
          if (!args.field) throw new Error("'field' is required for hincrby")
          validateKeyParam(args.field, "field")
          const increment = args.increment ?? 1
          const newVal = await this.getClient().hincrby(key, args.field, increment)
          output = formatResult(`Hash "${key}" field "${args.field}" incremented by ${increment}`, newVal)
          break
        }

        // ---- List Write Operations ----

        case "lpush": {
          if (!key) throw new Error("'key' is required for lpush")
          if (!args.elements || !Array.isArray(args.elements) || args.elements.length === 0) {
            throw new Error("'elements' (array) is required for lpush")
          }
          validateKeyArray(args.elements, "elements")
          const newLen = await this.getClient().lpush(key, ...args.elements)
          output = formatResult(`LPUSH "${key}"`, `new length = ${newLen}`)
          break
        }

        case "rpush": {
          if (!key) throw new Error("'key' is required for rpush")
          if (!args.elements || !Array.isArray(args.elements) || args.elements.length === 0) {
            throw new Error("'elements' (array) is required for rpush")
          }
          validateKeyArray(args.elements, "elements")
          const newLen = await this.getClient().rpush(key, ...args.elements)
          output = formatResult(`RPUSH "${key}"`, `new length = ${newLen}`)
          break
        }

        // ---- Set Write Operations ----

        case "sadd": {
          if (!key) throw new Error("'key' is required for sadd")
          if (!args.members || !Array.isArray(args.members) || args.members.length === 0) {
            throw new Error("'members' (array) is required for sadd")
          }
          validateKeyArray(args.members, "members")
          const added = await this.getClient().sadd(key, ...args.members)
          output = formatResult(`SADD "${key}"`, `${added} new member(s) added`)
          break
        }

        // ---- Sorted Set Write Operations ----

        case "zadd": {
          if (!key) throw new Error("'key' is required for zadd")
          if (args.scoreMembers && typeof args.scoreMembers === "object" && Object.keys(args.scoreMembers).length > 0) {
            const pairs: (number | string)[] = []
            for (const [mem, score] of Object.entries(args.scoreMembers)) {
              validateKeyParam(mem, "member")
              pairs.push(Number(score), mem)
            }
            const added = await this.getClient().zadd(key, ...pairs)
            output = formatResult(`ZADD "${key}"`, `${added} new member(s) added`)
          } else if (args.score !== undefined && args.member !== undefined) {
            validateKeyParam(args.member, "member")
            const added = await this.getClient().zadd(key, args.score, args.member)
            output = formatResult(`ZADD "${key}"`, `${added} new member(s) added`)
          } else {
            throw new Error("Either ('score' and 'member') or ('scoreMembers' object) is required for zadd")
          }
          break
        }

        // ---- Delete Operations ----

        case "del": {
          let targetKeys: string[] = []
          if (args.keys && Array.isArray(args.keys) && args.keys.length > 0) {
            targetKeys = args.keys
          } else if (key) {
            targetKeys = [key]
          } else {
            throw new Error("'key' or 'keys' (array) is required for del")
          }
          validateKeyArray(targetKeys, "keys")
          const removed = await this.getClient().del(...targetKeys)
          output = removed > 0
            ? `🗑️  Deleted ${removed} key(s)`
            : `⚠️  No matching keys found to delete`
          break
        }

        case "hdel": {
          if (!key) throw new Error("'key' is required for hdel")
          if (!args.field) throw new Error("'field' is required for hdel")
          validateKeyParam(args.field, "field")
          const removed = await this.getClient().hdel(key, args.field)
          output = removed > 0
            ? `🗑️  Hash field \`${args.field}\` removed from \`${key}\``
            : `⚠️  Field \`${args.field}\` does not exist in hash \`${key}\``
          break
        }

        case "lrem": {
          if (!key) throw new Error("'key' is required for lrem")
          if (args.count === undefined) throw new Error("'count' is required for lrem")
          if (args.element === undefined) throw new Error("'element' is required for lrem")
          validateKeyParam(String(args.element), "element")
          const removed = await this.getClient().lrem(key, args.count, args.element)
          output = formatResult(`LREM "${key}"`, `${removed} element(s) removed`)
          break
        }

        case "lpop": {
          if (!key) throw new Error("'key' is required for lpop")
          const count = args.count
          let value: any
          if (count && count > 1) {
            value = await this.getClient().lpop(key, count)
          } else {
            value = await this.getClient().lpop(key)
          }
          if (value === null) {
            output = `⚠️  List \`${key}\` is empty or does not exist`
          } else {
            const popped = Array.isArray(value) ? value : [value]
            output = `🗑️  Popped from \`${key}\`:\n\n${formatList(popped)}`
          }
          break
        }

        case "rpop": {
          if (!key) throw new Error("'key' is required for rpop")
          const count = args.count
          let value: any
          if (count && count > 1) {
            value = await this.getClient().rpop(key, count)
          } else {
            value = await this.getClient().rpop(key)
          }
          if (value === null) {
            output = `⚠️  List \`${key}\` is empty or does not exist`
          } else {
            const popped = Array.isArray(value) ? value : [value]
            output = `🗑️  Popped from \`${key}\`:\n\n${formatList(popped)}`
          }
          break
        }

        case "srem": {
          if (!key) throw new Error("'key' is required for srem")
          if (!args.members || !Array.isArray(args.members) || args.members.length === 0) {
            throw new Error("'members' (array) is required for srem")
          }
          validateKeyArray(args.members, "members")
          const removed = await this.getClient().srem(key, ...args.members)
          output = formatResult(`SREM "${key}"`, `${removed} member(s) removed`)
          break
        }

        case "spop": {
          if (!key) throw new Error("'key' is required for spop")
          const count = args.count || 1
          const value = await this.getClient().spop(key, count)
          if (value === null || (Array.isArray(value) && value.length === 0)) {
            output = `⚠️  Set \`${key}\` is empty or does not exist`
          } else {
            const popped = Array.isArray(value) ? value : [value]
            output = `🗑️  Popped from \`${key}\`:\n\n${formatList(popped)}`
          }
          break
        }

        case "zrem": {
          if (!key) throw new Error("'key' is required for zrem")
          const members = args.members || (args.member ? [args.member] : null)
          if (!members || members.length === 0) {
            throw new Error("'member' or 'members' (array) is required for zrem")
          }
          validateKeyArray(members, "members")
          const removed = await this.getClient().zrem(key, ...members)
          output = formatResult(`ZREM "${key}"`, `${removed} member(s) removed`)
          break
        }

        case "flushdb": {
          if (args.confirm !== true) {
            throw new Error("Confirmation required: set `confirm: true` to flush the current database")
          }
          const result = await this.getClient().flushdb()
          output = result === "OK" ? "🗑️  Current database flushed" : `Result: ${formatValue(result)}`
          break
        }

        default: {
          throw new Error(
            `Unknown action: "${action}". Supported actions: get, set, del, exists, keys, scan, ttl, type, dbsize, ping, info, strlen, mget, mset, append, incr, decr, rename, expire, hget, hset, hdel, hgetall, hkeys, hvals, hlen, hexists, hincrby, lpush, rpush, lrange, llen, lindex, lpop, rpop, lrem, sadd, smembers, scard, srem, sismember, spop, zadd, zrange, zrevrange, zcard, zscore, zrank, zrem, flushdb`
          )
        }
      }
    } catch (error: unknown) {
      // Handle Redis-specific errors gracefully
      if (error && typeof error === "object" && "code" in error) {
        const errCode = (error as { code: string }).code
        if (errCode === "ECONNREFUSED") {
          throw new Error(
            `Connection refused to Redis at ${this.connection.host}:${this.connection.port}. ` +
            "Make sure Redis is running and the connection string is correct."
          )
        }
        if (errCode === "ETIMEOUT" || errCode === "ETIMEDOUT") {
          throw new Error(
            `Connection timed out connecting to Redis at ${this.connection.host}:${this.connection.port}.`
          )
        }
      }
      if (error instanceof Error) {
        if (error.message?.includes("NOAUTH")) {
          throw new Error("Authentication failed. Check your Redis password in the connection string.")
        }
        if (error.message?.includes("WRONGTYPE")) {
          throw new Error(
            `Operation against a key holding the wrong kind of value. ` +
            "Use a different action or check the key's type with the 'type' action."
          )
        }
      }
      // Re-throw other errors
      throw error
    }

    const duration = Date.now() - startTime

    return {
      output,
      metadata: {
        action,
        key,
        connection: { ...this.connection },
        duration,
      },
    }
  }

  async close(): Promise<void> {
    if (this.connKey && connectionCache.has(this.connKey)) {
      const cached = connectionCache.get(this.connKey)
      if (cached) cached.lastUsed = Date.now()
    }
  }
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export default tool({
  description:
    "Access a Redis database to read, update, and delete data. " +
    "Supports strings, hashes, lists, sets, and sorted sets (zsets). " +
    "Connection string format: redis://[[username]:[password]]@host:port/[db] or rediss:// for TLS. " +
    "Use 'get'/'set'/'del' for simple key operations, 'h*' for hashes, 'l*' for lists, 's*' for sets, 'z*' for sorted sets.",

  args: {
    connectionString: tool.schema
      .string()
      .describe(
        "Redis connection string, e.g. redis://localhost:6379 or rediss://user:password@host:6379/0"
      ),

    action: tool.schema
      .enum([
        // Read
        "get", "mget", "exists", "keys", "scan", "ttl", "type", "dbsize", "ping", "info", "strlen",
        // Hash read
        "hget", "hgetall", "hkeys", "hvals", "hlen", "hexists",
        // List read
        "lrange", "llen", "lindex",
        // Set read
        "smembers", "scard", "sismember",
        // Sorted Set read
        "zrange", "zrevrange", "zcard", "zscore", "zrank",
        // Write/Update
        "set", "mset", "append", "incr", "decr", "rename", "expire",
        // Hash write
        "hset", "hincrby",
        // List write
        "lpush", "rpush",
        // Set write
        "sadd",
        // Sorted Set write
        "zadd",
        // Delete
        "del", "hdel", "lrem", "lpop", "rpop", "srem", "spop", "zrem", "flushdb",
      ])
      .describe("The Redis operation to perform"),

    key: tool.schema
      .string()
      .optional()
      .describe("The Redis key to operate on"),

    newKey: tool.schema
      .string()
      .optional()
      .describe("New key name (for rename)"),

    field: tool.schema
      .string()
      .optional()
      .describe("The field name (for hash operations: hget, hset, hdel, hexists, hincrby)"),

    fields: tool.schema
      .record(tool.schema.string(), tool.schema.string())
      .optional()
      .describe("Object of field-value pairs (for batch hset)"),

    value: tool.schema
      .string()
      .optional()
      .describe("The value to set (for set, append, hset)"),

    keyValues: tool.schema
      .record(tool.schema.string(), tool.schema.string())
      .optional()
      .describe("Key-value pairs object (for mset)"),

    keys: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Array of keys (for mget, batch del)"),

    seconds: tool.schema
      .number()
      .optional()
      .describe("TTL in seconds (for set with expiry, expire)"),

    pattern: tool.schema
      .string()
      .optional()
      .describe("Glob pattern (for keys, scan, e.g. 'user:*')"),

    start: tool.schema
      .number()
      .optional()
      .describe("Start index (for lrange, zrange, default: 0)"),

    stop: tool.schema
      .number()
      .optional()
      .describe("Stop index (for lrange, zrange, default: -1 = all)"),

    index: tool.schema
      .number()
      .optional()
      .describe("List index (for lindex)"),

    count: tool.schema
      .number()
      .optional()
      .describe("Count (for lrem, lpop, rpop, spop, scan)"),

    element: tool.schema
      .string()
      .optional()
      .describe("Element value (for lrem)"),

    elements: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Elements to push (for lpush, rpush)"),

    members: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Members to add/remove (for sadd, srem, zrem)"),

    member: tool.schema
      .string()
      .optional()
      .describe("Member to check/operate on (for sismember, zadd, zscore, zrank, zrem)"),

    score: tool.schema
      .number()
      .optional()
      .describe("Score for sorted set member (for zadd)"),

    scoreMembers: tool.schema
      .record(tool.schema.string(), tool.schema.number())
      .optional()
      .describe("Member-to-score object mapping (for batch zadd)"),

    withScores: tool.schema
      .boolean()
      .optional()
      .describe("Include scores in zrange / zrevrange results"),

    increment: tool.schema
      .number()
      .optional()
      .describe("Increment amount (for hincrby, default: 1)"),

    confirm: tool.schema
      .boolean()
      .optional()
      .describe("Set to true to confirm destructive operations (flushdb)"),
  },

  async execute(args, context) {
    const { connectionString, action, ...rest } = args

    if (!connectionString) {
      throw new Error("'connectionString' is required")
    }

    if (!action) {
      throw new Error("'action' is required")
    }

    const connStr = connectionString as string
    if (connStr.length > 2000) {
      throw new Error("Connection string exceeds maximum length (2000 characters)")
    }

    const act = action as string

    if (!tlsWarningShown && !connStr.startsWith("rediss://") && !connStr.includes("?tls=true")) {
      tlsWarningShown = true
      console.warn(
        `⚠️  Redis connection to ${extractRedisIdentifier(connStr)} is not using TLS/SSL. ` +
        "Use rediss:// scheme or add ?tls=true for encrypted connections."
      )
    }

    const startTime = Date.now()
    const driver = new RedisDriver()

    try {
      await driver.connect(connStr)
      const result = await driver.execute(act, rest)

      return {
        output: result.output,
        metadata: {
          type: "redis",
          action: result.metadata.action,
          key: result.metadata.key,
          connection: `${result.metadata.connection.host}:${result.metadata.connection.port}/${result.metadata.connection.db}`,
          duration: `${result.metadata.duration}ms`,
        },
      }
    } catch (error: unknown) {
      let errorMessage = "Unknown Redis error"
      if (error instanceof Error) {
        errorMessage = sanitizeConnectionString(error.message)
      }
      return {
        output: `Redis error [${extractRedisIdentifier(connStr)}]: ${errorMessage}`,
        metadata: {
          type: "redis",
          action: act,
          connection: extractRedisIdentifier(connStr),
          duration: `${Date.now() - startTime}ms`,
        },
      }
    } finally {
      await driver.close()
    }
  },
})

// ---------------------------------------------------------------------------
// Exports for testability
// ---------------------------------------------------------------------------

export function resetTlsWarningFlag(): void {
  tlsWarningShown = false
}

export function closeAllConnections(): void {
  for (const [, cached] of connectionCache.entries()) {
    try {
      cached.client.disconnect()
    } catch {
      // ignore
    }
  }
  connectionCache.clear()
}

export {
  extractRedisIdentifier,
  sanitizeConnectionString,
  parseConnectionString,
  formatValue,
  formatKeyValueTable,
  formatList,
  formatResult,
}
export type { RedisConnection, RedisResult }
export { RedisDriver }
