import { tool } from "@opencode-ai/plugin"
import { Parser } from "node-sql-parser"
import type { Client } from "pg"
import type { Connection } from "mysql2/promise"
import type { ConnectionPool } from "mssql"

/**
 * Module-level cache for dynamically imported database driver modules.
 * Avoids repeated dynamic imports (~5-50ms latency per call) after first load.
 */
const driverModules: Record<string, any> = {}

/**
 * Connection pool entry for reusing database connections across tool calls.
 */
interface PooledDriver {
  driver: DatabaseDriver
  lastUsed: number
  key: string
}

const connectionPools = new Map<string, PooledDriver>()
let poolCleanupInterval: ReturnType<typeof setInterval> | null = null

function schedulePoolCleanup() {
  if (poolCleanupInterval) return
  poolCleanupInterval = setInterval(() => {
    const now = Date.now()
    const idleTimeout = 5 * 60 * 1000 // 5 minutes
    for (const [key, pooled] of connectionPools.entries()) {
      if (now - pooled.lastUsed > idleTimeout) {
        connectionPools.delete(key)
        pooled.driver.close().catch((e) => console.warn("[database] Error closing idle connection:", e))
      }
    }
    if (connectionPools.size === 0 && poolCleanupInterval) {
      clearInterval(poolCleanupInterval)
      poolCleanupInterval = null
    }
  }, 60 * 1000)
  // Don't prevent process exit in Node/Bun environments
  if (poolCleanupInterval && typeof poolCleanupInterval === "object" && "unref" in poolCleanupInterval) {
    ;(poolCleanupInterval as any).unref()
  }
}

/**
 * Close all active pooled connections (useful for testing or teardown).
 */
async function closeAllPools(): Promise<void> {
  if (poolCleanupInterval) {
    clearInterval(poolCleanupInterval)
    poolCleanupInterval = null
  }
  const closePromises: Promise<void>[] = []
  for (const [key, pooled] of connectionPools.entries()) {
    connectionPools.delete(key)
    closePromises.push(pooled.driver.close().catch((e) => console.warn("[database] Error closing pooled connection:", e)))
  }
  await Promise.all(closePromises)
}

/**
 * Resolves a connection string from connectionId via SQL_CONNECTIONS env var
 * or falls back to direct connectionString parameter.
 */
function resolveConnectionString(connectionId?: string, connectionString?: string): string {
  if (connectionId && connectionId.trim()) {
    const envConnections = process.env.SQL_CONNECTIONS
    if (!envConnections) {
      throw new Error("SQL_CONNECTIONS environment variable is not defined.")
    }
    let parsed: Record<string, string>
    try {
      parsed = JSON.parse(envConnections)
    } catch {
      throw new Error("SQL_CONNECTIONS environment variable contains invalid JSON.")
    }
    const resolved = parsed[connectionId.trim()]
    if (!resolved) {
      throw new Error(`Connection ID '${connectionId}' not found in SQL_CONNECTIONS.`)
    }
    return resolved
  }
  if (connectionString && connectionString.trim()) {
    return connectionString.trim()
  }
  throw new Error("Either connectionId or connectionString must be provided.")
}

/**
 * Extracts a human-readable database identifier from a connection string.
 */
function extractDatabaseName(connStr: string, type: string): string {
  try {
    if (type === "postgres" || type === "mysql") {
      const url = new URL(connStr)
      return `${url.hostname}:${url.port || (type === "postgres" ? "5432" : "3306")}/${url.pathname.replace(/^\//, "") || "(default)"}`
    }
    if (type === "mssql") {
      // Parse SQL Server connection string to extract server and database only
      const serverMatch = connStr.match(/(?:Server|Data Source)\s*=\s*([^;]+)/i)
      const dbMatch = connStr.match(/(?:Database|Initial Catalog)\s*=\s*([^;]+)/i)
      const server = serverMatch ? serverMatch[1].trim() : "unknown"
      const db = dbMatch ? dbMatch[1].trim() : "(default)"
      return `${server}/${db}`
    }
    return "unknown"
  } catch {
    console.warn("Failed to parse connection string for display name extraction")
    return "unknown"
  }
}

/**
 * Strips SQL comments (single-line -- and block /* *​/) and protects string literals
 * so that keyword matching can be performed on the remaining SQL text.
 *
 * Order of operations:
 * 1. Protect string literals (with escaped quote handling: '' and "")
 * 2. Strip single-line comments (-- ...) — these may contain /* which should not
 *    be treated as block comment delimiters
 * 3. Strip block comments (/* ... *​/) — remaining after single-line removal
 * 4. Restore string literals
 */
function stripCommentsAndStrings(sql: string): string {
  // Protect string literals with escaped quote handling
  const strings: string[] = []
  let result = sql.replace(/'(?:[^']|'')*'/g, (match) => {
    strings.push(match)
    return `__STR${strings.length - 1}__`
  })
  result = result.replace(/"(?:[^"]|"")*"/g, (match) => {
    strings.push(match)
    return `__STR${strings.length - 1}__`
  })

  // Strip single-line comments (outside strings)
  result = result.replace(/--.*$/gm, "")

  // Strip block comments (outside strings)
  result = result.replace(/\/\*[\s\S]*?\*\//g, "")

  // Restore string literals
  result = result.replace(/__STR(\d+)__/g, (_, idx) => strings[parseInt(idx)])

  return result
}

/**
 * Validates that a SQL query is read-only (SELECT or WITH, no write keywords).
 *
 * Uses the node-sql-parser AST parser as the primary check:
 * - Parses the SQL into an AST
 * - If the result is an array, it's a multi-statement query → rejected
 * - If the top-level type is "select" or has a WITH clause → allowed
 * - Any other type (insert, update, delete, drop, call, etc.) → rejected
 *
 * Falls back to a hardened regex-based check if the parser cannot parse the SQL
 * (e.g., database-specific functions like dblink(), fn_ExecuteSQL()).
 *
 * The hardened regex fallback:
 * - Strips SQL comments (-- and /* *​/) before keyword matching
 * - Handles escaped quotes ('') and ("")
 * - Uses \b word boundaries to avoid substring matching
 * - Uses .toLocaleUpperCase("en-US") to avoid Turkish locale issues
 * - Checks all write keywords including CALL, COPY, LOAD, BULK, EXECUTE IMMEDIATE
 */
function isReadOnlyQuery(sql: string): boolean {
  // Primary check: AST parser
  try {
    const parser = new Parser()
    const ast = parser.astify(sql)

    // If the parser returns an array, it's a multi-statement query
    if (Array.isArray(ast)) {
      return false
    }

    // Check that the top-level statement is a SELECT or WITH
    if (ast.type === "select" || (ast as any).with) {
      // Post-AST check: strip comments AND string literals, then check for write patterns
      // that node-sql-parser misclassifies as SELECT (e.g., SELECT INTO, SELECT FOR UPDATE)
      const cleaned = stripCommentsAndStrings(sql)
      const noStrings = cleaned.replace(/'(?:[^']|'')*'/g, "").replace(/"(?:[^"]|"")*"/g, "")
      const upper = noStrings.toLocaleUpperCase("en-US")
      // Reject SELECT INTO (table creation, file write, variable assignment)
      if (/\bINTO\b/.test(upper)) {
        return false
      }
      // Reject FOR UPDATE / FOR SHARE (write locks)
      if (/\bFOR\s+(UPDATE|NO\s+KEY\s+UPDATE|SHARE|KEY\s+SHARE)\b/.test(upper)) {
        return false
      }
      return true
    }

    return false
  } catch {
    // Parser failed (e.g., dblink(), fn_ExecuteSQL(), or unsupported syntax)
    // Fall through to hardened regex fallback
  }

  // Hardened regex fallback
  const cleaned = stripCommentsAndStrings(sql)
  const upper = cleaned.toLocaleUpperCase("en-US").trim()

  // Must start with SELECT or WITH
  if (!upper.startsWith("SELECT") && !upper.startsWith("WITH")) {
    return false
  }

  // Single-word write keywords (checked with \b word boundaries)
  const writeKeywords = [
    "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE",
    "TRUNCATE", "EXEC", "EXECUTE", "MERGE",
    "GRANT", "REVOKE", "RENAME", "SET", "INTO",
    "CALL", "COPY", "LOAD", "BULK",
  ]

  for (const kw of writeKeywords) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const regex = new RegExp(`\\b${escaped}\\b`)
    if (regex.test(upper)) {
      return false
    }
  }

  // Multi-word write patterns (checked separately since \b doesn't span spaces)
  const multiWordPatterns = [
    /\bEXECUTE\s+IMMEDIATE\b/,
    /\bLOAD\s+DATA\b/,
    /\bBULK\s+INSERT\b/,
  ]
  for (const pattern of multiWordPatterns) {
    if (pattern.test(upper)) {
      return false
    }
  }

  return true
}

/**
 * Checks whether a SQL query contains multiple statements (semicolons outside
 * string literals and comments). Multi-statement queries are a common SQL
 * injection vector.
 *
 * Handles:
 * - Escaped single quotes ('') inside string literals
 * - Escaped double quotes ("") inside string literals
 * - Single-line comments (-- ...)
 * - Block comments (/* ... *​/)
 */
function hasMultiStatement(sql: string): boolean {
  const cleaned = stripCommentsAndStrings(sql)
  // Remove string literals to avoid false positives from semicolons inside strings
  const noStrings = cleaned.replace(/'(?:[^']|'')*'/g, "").replace(/"(?:[^"]|"")*"/g, "")
  return noStrings.includes(";")
}

/**
 * Escape markdown table special characters in a cell value.
 * Replaces `|` with `\|` and newlines with `\n` to prevent table injection.
 */
function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "\\n").replace(/\r/g, "")
}

/**
 * Format rows as a markdown table with column and size truncation.
 */
function formatResults<T>(columns: string[], rows: T[]): string {
  if (rows.length === 0) return "_(0 rows returned)_"

  let displayedColumns = columns
  let truncatedColsNote = ""
  if (columns.length > 15) {
    displayedColumns = columns.slice(0, 15)
    truncatedColsNote = `\n\n_(Note: ${columns.length - 15} column(s) omitted from table output)_`
  }

  const escapedColumns = displayedColumns.map(escapeMarkdownCell)
  const header = `| ${escapedColumns.join(" | ")} |`
  const separator = `| ${escapedColumns.map(() => "---").join(" | ")} |`

  let body = ""
  let displayedRowCount = 0
  let isByteTruncated = false

  for (const row of rows) {
    const r = row as Record<string, unknown>
    const line = `| ${displayedColumns.map((col) => {
      const val = r[col]
      if (val === null || val === undefined) return "NULL"
      const valStr = String(val)
      const truncated = valStr.length > 120 ? valStr.slice(0, 117) + "..." : valStr
      return escapeMarkdownCell(truncated)
    }).join(" | ")} |\n`

    if (body.length + line.length > 50000) {
      isByteTruncated = true
      break
    }
    body += line
    displayedRowCount++
  }

  const bodyTrimmed = body.trimEnd()
  let summary = `_${rows.length} row(s) returned_`
  if (isByteTruncated) {
    summary = `_${displayedRowCount} of ${rows.length} row(s) displayed (output truncated at 50KB)_`
  }

  return `${header}\n${separator}\n${bodyTrimmed}\n\n${summary}${truncatedColsNote}`
}

/**
 * Try to append a LIMIT clause directly to a SQL query.
 * This preserves ORDER BY semantics (unlike subquery wrapping).
 * Falls back to subquery wrapping if the SQL already has LIMIT/TOP or is complex.
 *
 * For PostgreSQL/MySQL: appends `LIMIT N`
 * For MSSQL: prepends `SELECT TOP N` (handled separately)
 *
 * Performance caveat: Subquery wrapping can prevent index usage and
 * force full scans. Direct LIMIT appending is preferred when possible.
 */
function applyLimit(sql: string, limit: number): string {
  const cleaned = stripCommentsAndStrings(sql).trim()
  const upper = cleaned.toLocaleUpperCase("en-US")

  // If the query already has a LIMIT or TOP clause, fall back to subquery wrapping
  // to avoid double-LIMIT errors
  if (/\bLIMIT\s+\d+/i.test(cleaned) || /\bTOP\s+\d+/i.test(cleaned)) {
    return `SELECT * FROM (${sql}) AS _db_limit_sub_${Date.now()} LIMIT ${limit}`
  }

  // Strip trailing semicolons for analysis
  const noTrailingSemi = cleaned.replace(/;+\s*$/, "")
  const upperNoSemi = noTrailingSemi.toLocaleUpperCase("en-US")

  // Check that it's a simple single SELECT (not a CTE, UNION, etc.)
  // Simple SELECT: starts with SELECT, no WITH, no UNION, no semicolons
  const isSimpleSelect =
    upperNoSemi.startsWith("SELECT") &&
    !upperNoSemi.startsWith("WITH") &&
    !/\bUNION\b/i.test(noTrailingSemi) &&
    !noTrailingSemi.includes(";")

  if (isSimpleSelect) {
    // Append LIMIT directly — preserves ORDER BY semantics
    return `${sql.replace(/;+\s*$/, "")} LIMIT ${limit}`
  }

  // Fall back to subquery wrapping for complex queries (CTEs, UNIONs, etc.)
  return `SELECT * FROM (${sql}) AS _db_limit_sub_${Date.now()} LIMIT ${limit}`
}

/**
 * Apply TOP N for MSSQL queries. Tries to prepend SELECT TOP N directly
 * for simple SELECTs, falls back to subquery wrapping for complex queries.
 */
function applyTop(sql: string, limit: number): string {
  const cleaned = stripCommentsAndStrings(sql).trim()
  const upper = cleaned.toLocaleUpperCase("en-US")

  // If the query already has TOP, fall back to subquery wrapping
  if (/\bTOP\s+\d+/i.test(cleaned)) {
    return `SELECT TOP ${limit} * FROM (${sql}) AS _db_limit_sub_${Date.now()}`
  }

  // Check that it's a simple single SELECT
  const isSimpleSelect =
    upper.startsWith("SELECT") &&
    !upper.startsWith("WITH") &&
    !/\bUNION\b/i.test(cleaned) &&
    !cleaned.includes(";")

  if (isSimpleSelect) {
    // Prepend TOP after SELECT — preserves ORDER BY semantics
    return sql.replace(/^\s*SELECT\s+/i, `SELECT TOP ${limit} `)
  }

  // Fall back to subquery wrapping
  return `SELECT TOP ${limit} * FROM (${sql}) AS _db_limit_sub_${Date.now()}`
}

// ---------------------------------------------------------------------------
// CP-04: Driver Abstraction & Type Safety
// ---------------------------------------------------------------------------

/**
 * Column information returned by schema inspection.
 */
interface ColumnInfo {
  column_name: string
  data_type: string
  is_nullable: string
  max_length: string
  default: string
}

/**
 * Table information returned by schema listing.
 */
interface TableInfo {
  table_schema: string
  table_name: string
  table_type: string
}

/**
 * Result of a query execution.
 */
interface QueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
}

/**
 * Abstract driver interface for database operations.
 * Each database type implements this interface.
 */
interface DatabaseDriver {
  /** Connect to the database */
  connect(connectionString: string): Promise<void>
  /** Execute a SELECT/WITH query and return results */
  query(sql: string, limit: number, params?: unknown[]): Promise<QueryResult>
  /** Explain a SELECT/WITH query execution plan */
  explain(sql: string, analyze?: boolean): Promise<string>
  /** List all user tables in the database */
  listTables(): Promise<TableInfo[]>
  /** Describe columns of a specific table */
  describeTable(tableName: string): Promise<ColumnInfo[]>
  /** Close the connection */
  close(): Promise<void>
}

// ---------------------------------------------------------------------------
// PostgresDriver
// ---------------------------------------------------------------------------

class PostgresDriver implements DatabaseDriver {
  private client: Client | null = null

  async connect(connectionString: string): Promise<void> {
    let pg: typeof import("pg")
    if (driverModules.pg) {
      pg = driverModules.pg
    } else {
      try {
        pg = await import("pg")
        driverModules.pg = pg
      } catch {
        throw new Error("PostgreSQL driver (pg) is not installed. Run: bun add pg")
      }
    }
    // CP-05: Enforce TLS — check for sslmode=require or verify-full
    const upper = connectionString.toLocaleUpperCase("en-US")
    if (!upper.includes("SSLMODE=REQUIRE") && !upper.includes("SSLMODE=VERIFY-FULL")) {
      console.warn(
        "⚠️  PostgreSQL connection is not using TLS/SSL. " +
        "Add '?sslmode=require' to your connection string for secure connections.",
      )
    }
    this.client = new pg.Client({ connectionString, connectionTimeoutMillis: 10000 })
    await this.client.connect()
    // DB-level read-only enforcement & query timeout
    await this.client.query("SET default_transaction_read_only = ON")
    await this.client.query("SET statement_timeout = '30000'")
  }

  async query(sql: string, limit: number, params?: unknown[]): Promise<QueryResult> {
    // CP-05: Push LIMIT into the SQL query (prefer direct appending over subquery wrapping)
    const limitedSql = applyLimit(sql, limit)
    const result = await this.client!.query({
      text: limitedSql,
      values: params || [],
      rowMode: "array",
    })
    const columns = result.fields.map((f: { name: string }) => f.name)
    const rows = result.rows.map((row: unknown[]) => {
      const obj: Record<string, unknown> = {}
      columns.forEach((col: string, i: number) => {
        obj[col] = row[i]
      })
      return obj
    })
    return { columns, rows }
  }

  async explain(sql: string, analyze = false): Promise<string> {
    const verb = analyze ? "EXPLAIN (ANALYZE, FORMAT TEXT)" : "EXPLAIN (FORMAT TEXT)"
    const result = await this.client!.query(`${verb} ${sql}`)
    return result.rows.map((r: Record<string, unknown>) => Object.values(r)[0]).join("\n")
  }

  async listTables(): Promise<TableInfo[]> {
    const result = await this.client!.query(
      `SELECT table_schema, table_name, table_type
       FROM information_schema.tables
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
       ORDER BY table_schema, table_name`,
    )
    return result.rows.map((r: Record<string, unknown>) => ({
      table_schema: r.table_schema as string,
      table_name: r.table_name as string,
      table_type: r.table_type as string,
    }))
  }

  async describeTable(tableName: string): Promise<ColumnInfo[]> {
    // Support schema-qualified table names (e.g. "public.users"), default to "public"
    const dotIndex = tableName.indexOf(".")
    let schema: string = "public"
    let table: string
    if (dotIndex >= 0) {
      schema = tableName.substring(0, dotIndex)
      table = tableName.substring(dotIndex + 1)
    } else {
      table = tableName
    }

    const queryText = `SELECT column_name, data_type, is_nullable, character_maximum_length,
                        column_default, ordinal_position
                 FROM information_schema.columns
                 WHERE table_schema = $1 AND table_name = $2
                 ORDER BY ordinal_position`
    const params = [schema, table]

    const result = await this.client!.query(queryText, params)
    return result.rows.map((r: Record<string, unknown>) => ({
      column_name: r.column_name as string,
      data_type: r.data_type as string,
      is_nullable: r.is_nullable as string,
      max_length: (r.character_maximum_length as string) ?? "—",
      default: (r.column_default as string) ?? "—",
    }))
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.end().catch((e) => console.warn("Failed to close database connection:", e))
    }
  }
}

// ---------------------------------------------------------------------------
// MySQLDriver
// ---------------------------------------------------------------------------

class MySQLDriver implements DatabaseDriver {
  private connection: Connection | null = null

  async connect(connectionString: string): Promise<void> {
    let mysql2: typeof import("mysql2/promise")
    if (driverModules.mysql2) {
      mysql2 = driverModules.mysql2
    } else {
      try {
        mysql2 = await import("mysql2/promise")
        driverModules.mysql2 = mysql2
      } catch {
        throw new Error("MySQL driver (mysql2) is not installed. Run: bun add mysql2")
      }
    }
    // CP-05: Enforce TLS — check for ssl=true or ssl={} in connection string/options
    const hasSSL = /[?&]ssl=true\b/i.test(connectionString) || /[?&]ssl=\{\}/i.test(connectionString)
    if (!hasSSL) {
      console.warn(
        "⚠️  MySQL connection is not using TLS/SSL. " +
        "Add '?ssl=true' to your connection string for secure connections.",
      )
    }
    this.connection = await mysql2.createConnection({
      uri: connectionString,
      connectTimeout: 10000,
    })
    // DB-level read-only enforcement
    await this.connection.execute("SET SESSION TRANSACTION READ ONLY").catch(() => {})

    // CP-05: Set query timeout (30s) for MySQL 5.7+ / MariaDB
    try {
      await this.connection.execute("SET SESSION max_execution_time = 30000")
    } catch {
      try {
        await this.connection.execute("SET SESSION max_statement_time = 30")
      } catch {
        console.warn("⚠️  Could not set query timeout — unsupported MySQL/MariaDB version")
      }
    }
  }

  async query(sql: string, limit: number, params?: unknown[]): Promise<QueryResult> {
    // CP-05: Push LIMIT into the SQL query (prefer direct appending over subquery wrapping)
    const limitedSql = applyLimit(sql, limit)
    const [rows] = await this.connection!.execute(limitedSql, (params || []) as any)
    const rowsArray = rows as Record<string, unknown>[]
    if (rowsArray.length === 0) return { columns: [], rows: [] }
    const columns = Object.keys(rowsArray[0])
    return { columns, rows: rowsArray }
  }

  async explain(sql: string, analyze = false): Promise<string> {
    const verb = analyze ? "EXPLAIN ANALYZE" : "EXPLAIN"
    const [rows] = await this.connection!.execute(`${verb} ${sql}`)
    const rowsArray = rows as Record<string, unknown>[]
    if (analyze || rowsArray.length === 0) {
      return rowsArray.map((r) => Object.values(r)[0]).join("\n")
    }
    const cols = Object.keys(rowsArray[0])
    return formatResults(cols, rowsArray)
  }

  async listTables(): Promise<TableInfo[]> {
    const [rows] = await this.connection!.execute(
      `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA NOT IN ('mysql', 'sys', 'performance_schema', 'information_schema')
       ORDER BY TABLE_SCHEMA, TABLE_NAME`,
    )
    const rowsArray = rows as Record<string, unknown>[]
    return rowsArray.map((r: Record<string, unknown>) => ({
      table_schema: r.TABLE_SCHEMA as string,
      table_name: r.TABLE_NAME as string,
      table_type: r.TABLE_TYPE as string,
    }))
  }

  async describeTable(tableName: string): Promise<ColumnInfo[]> {
    // Support schema-qualified table names (e.g. "mydb.users")
    const dotIndex = tableName.indexOf(".")
    let schema: string | null = null
    let table: string
    if (dotIndex >= 0) {
      schema = tableName.substring(0, dotIndex)
      table = tableName.substring(dotIndex + 1)
    } else {
      table = tableName
    }

    let queryText: string
    let params: unknown[]
    if (schema) {
      queryText = `SELECT COLUMN_NAME AS column_name, COLUMN_TYPE AS data_type, IS_NULLABLE AS is_nullable,
                          CHARACTER_MAXIMUM_LENGTH AS max_length, COLUMN_DEFAULT AS \`default\`
                   FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
                   ORDER BY ORDINAL_POSITION`
      params = [schema, table]
    } else {
      queryText = `SELECT COLUMN_NAME AS column_name, COLUMN_TYPE AS data_type, IS_NULLABLE AS is_nullable,
                          CHARACTER_MAXIMUM_LENGTH AS max_length, COLUMN_DEFAULT AS \`default\`
                   FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_NAME = ?
                   ORDER BY ORDINAL_POSITION`
      params = [table]
    }

    const [rows] = await this.connection!.execute(queryText, params as any)
    const rowsArray = rows as Record<string, unknown>[]
    return rowsArray.map((r: Record<string, unknown>) => ({
      column_name: r.column_name as string,
      data_type: r.data_type as string,
      is_nullable: r.is_nullable as string,
      max_length: (r.max_length as string) ?? "—",
      default: (r.default as string) ?? "—",
    }))
  }

  async close(): Promise<void> {
    if (this.connection) {
      await this.connection.end().catch((e) => console.warn("Failed to close database connection:", e))
    }
  }
}

// ---------------------------------------------------------------------------
// MSSQLDriver
// ---------------------------------------------------------------------------

class MSSQLDriver implements DatabaseDriver {
  private pool: ConnectionPool | null = null
  private mssql: typeof import("mssql") | null = null

  async connect(connectionString: string): Promise<void> {
    let mssql: typeof import("mssql")
    if (driverModules.mssql) {
      mssql = driverModules.mssql
    } else {
      try {
        mssql = await import("mssql")
        driverModules.mssql = mssql
      } catch {
        throw new Error("SQL Server driver (mssql) is not installed. Run: bun add mssql")
      }
    }
    // CP-05: Enforce TLS — check for Encrypt=true in connection string
    const upper = connectionString.toLocaleUpperCase("en-US")
    if (!upper.includes("ENCRYPT=TRUE")) {
      console.warn(
        "⚠️  SQL Server connection is not using TLS/SSL. " +
        "Add 'Encrypt=true' to your connection string for secure connections.",
      )
    }
    this.mssql = mssql
    this.pool = (await mssql.connect({
      connectionString,
      requestTimeout: 30000,
      connectionTimeout: 10000,
    } as any)) as unknown as ConnectionPool
  }

  async query(sql: string, limit: number, params?: unknown[]): Promise<QueryResult> {
    // CP-05: Push LIMIT into the SQL query using TOP (prefer direct prepending over subquery wrapping)
    const limitedSql = applyTop(sql, limit)
    const request = this.pool!.request()
    if (params && params.length > 0) {
      params.forEach((val, i) => {
        request.input(`param${i}`, val)
      })
    }
    const result = await request.query(limitedSql)
    const rows = result.recordset as Record<string, unknown>[]
    if (rows.length === 0) return { columns: [], rows: [] }
    const columns = Object.keys(rows[0])
    return { columns, rows }
  }

  async explain(sql: string): Promise<string> {
    await this.pool!.request().query("SET SHOWPLAN_TEXT ON")
    try {
      const result = await this.pool!.request().query(sql)
      const rows = result.recordset as Record<string, unknown>[]
      return rows.map((r) => Object.values(r)[0]).join("\n")
    } finally {
      await this.pool!.request().query("SET SHOWPLAN_TEXT OFF").catch(() => {})
    }
  }

  async listTables(): Promise<TableInfo[]> {
    const result = await this.pool!.request().query(`
      SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE IN ('BASE TABLE', 'VIEW')
      ORDER BY TABLE_SCHEMA, TABLE_NAME
    `)
    return (result.recordset as Record<string, unknown>[]).map((r: Record<string, unknown>) => ({
      table_schema: r.TABLE_SCHEMA as string,
      table_name: r.TABLE_NAME as string,
      table_type: r.TABLE_TYPE as string,
    }))
  }

  async describeTable(tableName: string): Promise<ColumnInfo[]> {
    // Support schema-qualified table names (e.g. "dbo.users"), default to "dbo"
    const dotIndex = tableName.indexOf(".")
    let schema: string = "dbo"
    let table: string
    if (dotIndex >= 0) {
      schema = tableName.substring(0, dotIndex)
      table = tableName.substring(dotIndex + 1)
    } else {
      table = tableName
    }

    const queryText = `
      SELECT
        c.COLUMN_NAME AS column_name,
        c.DATA_TYPE AS data_type,
        c.IS_NULLABLE AS is_nullable,
        c.CHARACTER_MAXIMUM_LENGTH AS max_length,
        c.COLUMN_DEFAULT AS [default]
      FROM INFORMATION_SCHEMA.COLUMNS c
      WHERE c.TABLE_SCHEMA = @schema AND c.TABLE_NAME = @tableName
      ORDER BY c.ORDINAL_POSITION
    `

    const request = this.pool!.request()
      .input("tableName", this.mssql!.NVarChar, table)
      .input("schema", this.mssql!.NVarChar, schema)
    const result = await request.query(queryText)
    return (result.recordset as Record<string, unknown>[]).map((r: Record<string, unknown>) => ({
      column_name: r.column_name as string,
      data_type: r.data_type as string,
      is_nullable: r.is_nullable as string,
      max_length: (r.max_length as string) ?? "—",
      default: (r.default as string) ?? "—",
    }))
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.close().catch((e) => console.warn("Failed to close database connection:", e))
    }
  }
}

// ---------------------------------------------------------------------------
// Driver dispatch
// ---------------------------------------------------------------------------

async function createDriver(type: string): Promise<DatabaseDriver> {
  switch (type) {
    case "postgres": return new PostgresDriver()
    case "mysql": return new MySQLDriver()
    case "mssql": return new MSSQLDriver()
    default: throw new Error(`Unsupported database type: ${type}`)
  }
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

async function getOrCreateDriver(type: string, connectionString: string): Promise<DatabaseDriver> {
  const poolKey = `${type}:${connectionString}`
  const existing = connectionPools.get(poolKey)
  if (existing) {
    existing.lastUsed = Date.now()
    return existing.driver
  }

  const driver = await createDriver(type)
  await driver.connect(connectionString)
  connectionPools.set(poolKey, { driver, lastUsed: Date.now(), key: poolKey })
  schedulePoolCleanup()
  return driver
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export default tool({
  description: `Query a database (PostgreSQL, MySQL, SQL Server) to retrieve data, schema information, or query execution plans.

Use action="query" with a SELECT statement to fetch data rows.
Use action="schema" to explore database structure:
  - With a table name: describe columns, types, nullability, defaults
  - Without a table name: list all tables in the database
Use action="explain" to inspect query execution plan (optional analyze=true for runtime stats).

Results are returned as formatted markdown tables or code blocks.`,
  args: {
    type: tool.schema.enum(["postgres", "mysql", "mssql"]).describe(
      "Database type: 'postgres' for PostgreSQL, 'mysql' for MySQL/MariaDB, 'mssql' for SQL Server",
    ),
    action: tool.schema.enum(["query", "schema", "explain"]).describe(
      "'query' — run a SELECT SQL statement and return data rows. " +
      "'schema' — explore database structure (list tables or describe a table's columns). " +
      "'explain' — inspect query execution plan.",
    ),
    connectionId: tool.schema.string().optional().describe(
      "Connection ID defined in SQL_CONNECTIONS env var (JSON map of connection ID to connection string). Preferred over raw connectionString for security.",
    ),
    connectionString: tool.schema.string().optional().describe(
      "Full connection string. (Optional fallback if connectionId is not used). Examples:\n" +
      "- PostgreSQL: postgresql://user:password@host:5432/dbname\n" +
      "- MySQL: mysql://user:password@host:3306/dbname\n" +
      "- SQL Server: Server=host;Database=dbname;User Id=user;Password=password;TrustServerCertificate=true;",
    ),
    query: tool.schema.string().optional().describe(
      "For action='query' or 'explain': a SELECT SQL statement (e.g. SELECT * FROM users WHERE id = 1).\n" +
      "For action='schema': a table name to describe its columns (fallback if tableName is not provided), or leave empty to list all tables.",
    ),
    tableName: tool.schema.string().optional().describe(
      "For action='schema': the table name to describe its columns. Supports schema-qualified names (e.g. 'public.users'). " +
      "If not provided, falls back to the 'query' parameter for backward compatibility.",
    ),
    analyze: tool.schema.boolean().optional().describe(
      "For action='explain': if true, execute query to fetch actual runtime performance statistics (EXPLAIN ANALYZE). Default: false.",
    ),
    limit: tool.schema.number().optional().describe(
      "Maximum number of rows to return (default: 100, max: 1000). Only applies to action='query'.",
    ),
  },
  async execute(args, context) {
    const { type, action, connectionId, connectionString, query, tableName, analyze = false, limit = 100 } = args
    const maxLimit = Math.min(limit, 1000)
    const limitCapped = limit > 1000

    let connStr: string
    try {
      connStr = resolveConnectionString(connectionId, connectionString)
    } catch (err) {
      return (err as Error).message
    }

    // Input size limits (CP-06)
    if (connStr.length > 10240) {
      return "Connection string exceeds maximum length of 10KB."
    }
    if (query && query.length > 102400) {
      return "Query exceeds maximum length of 100KB."
    }

    // Validate: for "query" or "explain" action, a query is required
    if ((action === "query" || action === "explain") && (!query || !query.trim())) {
      return `A SQL query is required when action is '${action}'.`
    }

    // Security: reject multi-statement queries
    if ((action === "query" || action === "explain") && hasMultiStatement(query!)) {
      return "Multi-statement queries are not allowed."
    }

    // Security: only allow read-only queries
    if ((action === "query" || action === "explain") && !isReadOnlyQuery(query!)) {
      return "Only SELECT (read-only) queries are allowed. Write operations (INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, etc.) are not supported."
    }

    try {
      const driver = await getOrCreateDriver(type, connStr)
      let result: string

      if (action === "schema") {
        // Use tableName if provided, otherwise fall back to query for backward compatibility
        const tableToDescribe = (tableName || query || "").trim()
        if (tableToDescribe) {
          // Describe a specific table
          const columns = await driver.describeTable(tableToDescribe)
          if (columns.length === 0) {
            result = `Table "${tableToDescribe}" not found in any schema.`
          } else {
            result = formatResults(
              ["column_name", "data_type", "is_nullable", "max_length", "default"],
              columns,
            )
          }
        } else {
          // List all tables
          const tables = await driver.listTables()
          if (tables.length === 0) {
            result = "No user tables found."
          } else {
            result = formatResults(
              ["table_schema", "table_name", "table_type"],
              tables,
            )
          }
        }
      } else if (action === "explain") {
        const planText = await driver.explain(query!, analyze)
        result = `\`\`\`\n${planText}\n\`\`\``
      } else {
        // action === "query"
        const queryResult = await driver.query(query!, maxLimit, undefined)
        if (queryResult.rows.length === 0) {
          result = "_(0 rows returned)_"
        } else {
          result = formatResults(queryResult.columns, queryResult.rows)
        }
      }

      // Append limit cap warning if the user requested more than 1000
      if (limitCapped && action === "query") {
        result += "\n\nNote: limit capped to 1000."
      }

      const dbId = extractDatabaseName(connStr, type)

      // Audit logging: log successful query execution
      console.debug(`[database] ${type}/${action} on ${dbId}: completed`)

      return {
        output: result,
        metadata: {
          type,
          action,
          database: dbId,
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Sanitize: redact connection strings and passwords from error messages
      const sanitized = message
        .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "<connection-redacted>")
        .replace(/mysql:\/\/[^\s]+/gi, "<connection-redacted>")
        // MSSQL: redact the entire connection string (all key=value pairs) except the server name
        .replace(/(Server\s*=\s*[^;]+).*$/gmi, "$1;Password=<redacted>;")
        .replace(/password\s*[:=]\s*\S+/gi, "password=<redacted>")
      const dbId = extractDatabaseName(connStr, type)
      // Audit logging: log query failure
      console.warn(`[database] ${type}/${action} on ${dbId}: error - ${sanitized}`)
      return `Database error [${dbId}]: ${sanitized}`
    }
  },
})

// CP-06: Export pure functions for testability
export {
  extractDatabaseName,
  formatResults,
  isReadOnlyQuery,
  hasMultiStatement,
  escapeMarkdownCell,
  applyLimit,
  applyTop,
  stripCommentsAndStrings,
  resolveConnectionString,
  getOrCreateDriver,
  closeAllPools,
  connectionPools,
}
export type { DatabaseDriver }
export { PostgresDriver, MySQLDriver, MSSQLDriver, createDriver }
