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
  } catch (error) {
    console.warn("Failed to parse connection string:", error)
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
    "TRUNCATE", "EXEC", "EXECUTE", "MERGE", "REPLACE",
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
 * Format rows as a markdown table.
 */
function formatResults<T>(columns: string[], rows: T[]): string {
  if (rows.length === 0) return "_(0 rows returned)_"

  const escapedColumns = columns.map(escapeMarkdownCell)
  const header = `| ${escapedColumns.join(" | ")} |`
  const separator = `| ${escapedColumns.map(() => "---").join(" | ")} |`
  const body = rows
    .map((row) => {
      const r = row as Record<string, unknown>
      return `| ${columns.map((col) => {
        const val = r[col]
        if (val === null || val === undefined) return "NULL"
        return escapeMarkdownCell(String(val))
      }).join(" | ")} |`
    })
    .join("\n")

  return `${header}\n${separator}\n${body}\n\n_${rows.length} row(s) returned_`
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
    // Support schema-qualified table names (e.g. "public.users")
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
      queryText = `SELECT column_name, data_type, is_nullable, character_maximum_length,
                          column_default, ordinal_position
                   FROM information_schema.columns
                   WHERE table_schema = $1 AND table_name = $2
                   ORDER BY ordinal_position`
      params = [schema, table]
    } else {
      queryText = `SELECT column_name, data_type, is_nullable, character_maximum_length,
                          column_default, ordinal_position
                   FROM information_schema.columns
                   WHERE table_name = $1
                   ORDER BY ordinal_position`
      params = [table]
    }

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
    // CP-05: Set query timeout (30s) for MySQL 5.7+
    await this.connection.execute("SET SESSION max_execution_time = 30000")
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

  async listTables(): Promise<TableInfo[]> {
    const result = await this.pool!.request().query(`
      SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_SCHEMA, TABLE_NAME
    `)
    return (result.recordset as Record<string, unknown>[]).map((r: Record<string, unknown>) => ({
      table_schema: r.TABLE_SCHEMA as string,
      table_name: r.TABLE_NAME as string,
      table_type: r.TABLE_TYPE as string,
    }))
  }

  async describeTable(tableName: string): Promise<ColumnInfo[]> {
    // Support schema-qualified table names (e.g. "dbo.users")
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
    if (schema) {
      queryText = `
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
    } else {
      queryText = `
        SELECT
          c.COLUMN_NAME AS column_name,
          c.DATA_TYPE AS data_type,
          c.IS_NULLABLE AS is_nullable,
          c.CHARACTER_MAXIMUM_LENGTH AS max_length,
          c.COLUMN_DEFAULT AS [default]
        FROM INFORMATION_SCHEMA.COLUMNS c
        WHERE c.TABLE_NAME = @tableName
        ORDER BY c.ORDINAL_POSITION
      `
    }

    const request = this.pool!.request()
      .input("tableName", this.mssql!.NVarChar, table)
    if (schema) {
      request.input("schema", this.mssql!.NVarChar, schema)
    }
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

async function createDriver(type: string, connectionString: string): Promise<DatabaseDriver> {
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

export default tool({
  description: `Query a database (PostgreSQL, MySQL, SQL Server) to retrieve data or schema information.

Use action="query" with a SELECT statement to fetch data rows.
Use action="schema" to explore database structure:
  - With a table name: describe columns, types, nullability, defaults
  - Without a table name: list all tables in the database

Results are returned as formatted markdown tables.`,
  args: {
    type: tool.schema.enum(["postgres", "mysql", "mssql"]).describe(
      "Database type: 'postgres' for PostgreSQL, 'mysql' for MySQL/MariaDB, 'mssql' for SQL Server",
    ),
    action: tool.schema.enum(["query", "schema"]).describe(
      "'query' — run a SELECT SQL statement and return data rows. " +
      "'schema' — explore database structure (list tables or describe a table's columns).",
    ),
    connectionString: tool.schema.string().describe(
      "Full connection string. Examples:\n" +
      "- PostgreSQL: postgresql://user:password@host:5432/dbname\n" +
      "- MySQL: mysql://user:password@host:3306/dbname\n" +
      "- SQL Server: Server=host;Database=dbname;User Id=user;Password=password;TrustServerCertificate=true;",
    ),
    query: tool.schema.string().describe(
      "For action='query': a SELECT SQL statement (e.g. SELECT * FROM users WHERE id = 1).\n" +
      "For action='schema': a table name to describe its columns (fallback if tableName is not provided), or leave empty to list all tables.",
    ),
    tableName: tool.schema.string().optional().describe(
      "For action='schema': the table name to describe its columns. Supports schema-qualified names (e.g. 'public.users'). " +
      "If not provided, falls back to the 'query' parameter for backward compatibility.",
    ),
    limit: tool.schema.number().optional().describe(
      "Maximum number of rows to return (default: 100, max: 1000). Only applies to action='query'.",
    ),
  },
  async execute(args, context) {
    const { type, action, connectionString, query, tableName, limit = 100 } = args
    const maxLimit = Math.min(limit, 1000)
    const limitCapped = limit > 1000

    // Validate connection string is provided
    if (!connectionString || !connectionString.trim()) {
      return "A connection string is required."
    }

    // Input size limits (CP-06)
    if (connectionString.length > 10240) {
      return "Connection string exceeds maximum length of 10KB."
    }
    if (query && query.length > 102400) {
      return "Query exceeds maximum length of 100KB."
    }

    // Validate: for "query" action, a query is required
    if (action === "query" && (!query || !query.trim())) {
      return "A SQL query is required when action is 'query'."
    }

    // Security: reject multi-statement queries
    if (action === "query" && hasMultiStatement(query!)) {
      return "Multi-statement queries are not allowed."
    }

    // Security: only allow read-only queries
    if (action === "query" && !isReadOnlyQuery(query!)) {
      return "Only SELECT (read-only) queries are allowed. Write operations (INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, etc.) are not supported."
    }

    let driver: DatabaseDriver | null = null
    try {
      driver = await createDriver(type, connectionString)
      await driver.connect(connectionString)

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
      if (limitCapped) {
        result += "\n\nNote: limit capped to 1000."
      }

      const dbId = extractDatabaseName(connectionString, type)

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
      const dbId = extractDatabaseName(connectionString, type)
      // Audit logging: log query failure
      console.warn(`[database] ${type}/${action} on ${dbId}: error - ${sanitized}`)
      return `Database error [${dbId}]: ${sanitized}`
    } finally {
      if (driver) {
        await driver.close().catch((e) => console.warn("Failed to close database connection:", e))
      }
    }
  },
})

// CP-06: Export pure functions for testability
export { extractDatabaseName, formatResults, isReadOnlyQuery, hasMultiStatement, escapeMarkdownCell, applyLimit, applyTop, stripCommentsAndStrings }
export type { DatabaseDriver }
export { PostgresDriver, MySQLDriver, MSSQLDriver, createDriver }
