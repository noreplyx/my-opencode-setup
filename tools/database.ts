import { tool } from "@opencode-ai/plugin"

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
    return "unknown"
  }
}

/**
 * Validates that a SQL query is read-only (SELECT or WITH, no write keywords).
 * Strips string literals before checking to avoid false positives.
 */
function isReadOnlyQuery(sql: string): boolean {
  const upper = sql.trim().toUpperCase()
  // Must start with SELECT or WITH
  if (!upper.startsWith("SELECT") && !upper.startsWith("WITH")) return false

  // Check for write keywords anywhere in the query (case-insensitive)
  const writeKeywords = [
    "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE",
    "TRUNCATE", "EXEC", "EXECUTE", "MERGE", "REPLACE",
    "GRANT", "REVOKE", "RENAME", "SET", "INTO",
  ]

  // Remove string literals to avoid false positives
  const noStrings = sql.replace(/'[^']*'/g, "").replace(/"[^"]*"/g, "")
  const upperNoStrings = noStrings.toUpperCase()

  for (const kw of writeKeywords) {
    if (upperNoStrings.includes(kw)) return false
  }

  return true
}

/**
 * Checks whether a SQL query contains multiple statements (semicolons outside string literals).
 * Multi-statement queries are a common SQL injection vector.
 */
function hasMultiStatement(sql: string): boolean {
  // Remove string literals to avoid false positives
  const noStrings = sql.replace(/'[^']*'/g, "").replace(/"[^"]*"/g, "")
  return noStrings.includes(";")
}

/**
 * Format rows as a markdown table.
 */
function formatResults(columns: string[], rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "_(0 rows returned)_"

  const header = `| ${columns.join(" | ")} |`
  const separator = `| ${columns.map(() => "---").join(" | ")} |`
  const body = rows
    .map((row) => {
      return `| ${columns.map((col) => {
        const val = row[col]
        if (val === null || val === undefined) return "NULL"
        return String(val)
      }).join(" | ")} |`
    })
    .join("\n")

  return `${header}\n${separator}\n${body}\n\n_${rows.length} row(s) returned_`
}

// ---------------------------------------------------------------------------
// CP-04: Driver Abstraction & Type Safety
// ---------------------------------------------------------------------------

/**
 * Column information returned by schema inspection.
 */
interface ColumnInfo extends Record<string, unknown> {
  column_name: string
  data_type: string
  is_nullable: string
  max_length: string
  default: string
}

/**
 * Table information returned by schema listing.
 */
interface TableInfo extends Record<string, unknown> {
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
  query(sql: string, limit: number): Promise<QueryResult>
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
  private client: any

  async connect(connectionString: string): Promise<void> {
    let pg: any
    try {
      pg = await import("pg")
    } catch {
      throw new Error("PostgreSQL driver (pg) is not installed. Run: bun add pg")
    }
    this.client = new pg.Client({ connectionString, connectionTimeoutMillis: 10000 })
    await this.client.connect()
    await this.client.query("SET statement_timeout = '30000'")
  }

  async query(sql: string, limit: number): Promise<QueryResult> {
    // CP-05: Push LIMIT into the SQL query
    const limitedSql = `SELECT * FROM (${sql}) AS _db_limit_sub LIMIT ${limit}`
    const result = await this.client.query({
      text: limitedSql,
      rowMode: "array",
    })
    const columns = result.fields.map((f: any) => f.name)
    const rows = result.rows.map((row: any[]) => {
      const obj: Record<string, unknown> = {}
      columns.forEach((col: string, i: number) => {
        obj[col] = row[i]
      })
      return obj
    })
    return { columns, rows }
  }

  async listTables(): Promise<TableInfo[]> {
    const result = await this.client.query(
      `SELECT table_schema, table_name, table_type
       FROM information_schema.tables
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
       ORDER BY table_schema, table_name`,
    )
    return result.rows.map((r: any) => ({
      table_schema: r.table_schema,
      table_name: r.table_name,
      table_type: r.table_type,
    }))
  }

  async describeTable(tableName: string): Promise<ColumnInfo[]> {
    const result = await this.client.query(
      `SELECT column_name, data_type, is_nullable, character_maximum_length,
              column_default, ordinal_position
       FROM information_schema.columns
       WHERE table_name = $1
       ORDER BY ordinal_position`,
      [tableName],
    )
    return result.rows.map((r: any) => ({
      column_name: r.column_name,
      data_type: r.data_type,
      is_nullable: r.is_nullable,
      max_length: r.character_maximum_length ?? "—",
      default: r.column_default ?? "—",
    }))
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.end().catch(() => {})
    }
  }
}

// ---------------------------------------------------------------------------
// MySQLDriver
// ---------------------------------------------------------------------------

class MySQLDriver implements DatabaseDriver {
  private connection: any

  async connect(connectionString: string): Promise<void> {
    let mysql2: any
    try {
      mysql2 = await import("mysql2/promise")
    } catch {
      throw new Error("MySQL driver (mysql2) is not installed. Run: bun add mysql2")
    }
    this.connection = await mysql2.createConnection({
      uri: connectionString,
      connectTimeout: 10000,
      timeout: 30000,
    })
  }

  async query(sql: string, limit: number): Promise<QueryResult> {
    // CP-05: Push LIMIT into the SQL query
    const limitedSql = `SELECT * FROM (${sql}) AS _db_limit_sub LIMIT ${limit}`
    const [rows] = await this.connection.execute(limitedSql)
    const rowsArray = rows as any[]
    if (rowsArray.length === 0) return { columns: [], rows: [] }
    const columns = Object.keys(rowsArray[0])
    return { columns, rows: rowsArray }
  }

  async listTables(): Promise<TableInfo[]> {
    const [rows] = await this.connection.execute("SHOW TABLES")
    const rowsArray = rows as any[]
    if (rowsArray.length === 0) return []
    const tableNames = rowsArray.map((r: any) => Object.values(r)[0] as string)
    return tableNames.map((name: string) => ({
      table_schema: "",
      table_name: name,
      table_type: "BASE TABLE",
    }))
  }

  async describeTable(tableName: string): Promise<ColumnInfo[]> {
    const [rows] = await this.connection.execute(
      `SELECT COLUMN_NAME AS column_name, COLUMN_TYPE AS data_type, IS_NULLABLE AS is_nullable,
              CHARACTER_MAXIMUM_LENGTH AS max_length, COLUMN_DEFAULT AS \`default\`
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [tableName],
    )
    const rowsArray = rows as any[]
    return rowsArray.map((r: any) => ({
      column_name: r.column_name,
      data_type: r.data_type,
      is_nullable: r.is_nullable,
      max_length: r.max_length ?? "—",
      default: r.default ?? "—",
    }))
  }

  async close(): Promise<void> {
    if (this.connection) {
      await this.connection.end().catch(() => {})
    }
  }
}

// ---------------------------------------------------------------------------
// MSSQLDriver
// ---------------------------------------------------------------------------

class MSSQLDriver implements DatabaseDriver {
  private pool: any
  private mssql: any

  async connect(connectionString: string): Promise<void> {
    let mssql: any
    try {
      mssql = await import("mssql")
    } catch {
      throw new Error("SQL Server driver (mssql) is not installed. Run: bun add mssql")
    }
    this.mssql = mssql
    this.pool = await mssql.connect({
      connectionString,
      connectionTimeout: 10000,
      requestTimeout: 30000,
    })
  }

  async query(sql: string, limit: number): Promise<QueryResult> {
    // CP-05: Push LIMIT into the SQL query using TOP
    const limitedSql = `SELECT TOP ${limit} * FROM (${sql}) AS _db_limit_sub`
    const result = await this.pool.request().query(limitedSql)
    const rows = result.recordset
    if (rows.length === 0) return { columns: [], rows: [] }
    const columns = Object.keys(rows[0])
    return { columns, rows }
  }

  async listTables(): Promise<TableInfo[]> {
    const result = await this.pool.request().query(`
      SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_SCHEMA, TABLE_NAME
    `)
    return result.recordset.map((r: any) => ({
      table_schema: r.TABLE_SCHEMA,
      table_name: r.TABLE_NAME,
      table_type: r.TABLE_TYPE,
    }))
  }

  async describeTable(tableName: string): Promise<ColumnInfo[]> {
    const result = await this.pool.request()
      .input("tableName", this.mssql.NVarChar, tableName)
      .query(`
        SELECT
          c.COLUMN_NAME AS column_name,
          c.DATA_TYPE AS data_type,
          c.IS_NULLABLE AS is_nullable,
          c.CHARACTER_MAXIMUM_LENGTH AS max_length,
          c.COLUMN_DEFAULT AS [default]
        FROM INFORMATION_SCHEMA.COLUMNS c
        WHERE c.TABLE_NAME = @tableName
        ORDER BY c.ORDINAL_POSITION
      `)
    return result.recordset.map((r: any) => ({
      column_name: r.column_name,
      data_type: r.data_type,
      is_nullable: r.is_nullable,
      max_length: r.max_length ?? "—",
      default: r.default ?? "—",
    }))
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.close().catch(() => {})
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
      "For action='schema': a table name to describe its columns, or leave empty to list all tables.",
    ),
    limit: tool.schema.number().optional().describe(
      "Maximum number of rows to return (default: 100, max: 1000). Only applies to action='query'.",
    ),
  },
  async execute(args, context) {
    const { type, action, connectionString, query, limit = 100 } = args
    const maxLimit = Math.min(limit, 1000)

    // Validate connection string is provided
    if (!connectionString || !connectionString.trim()) {
      return "A connection string is required."
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
        if (query && query.trim()) {
          // Describe a specific table
          const columns = await driver.describeTable(query.trim())
          if (columns.length === 0) {
            result = `Table "${query}" not found in any schema.`
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
        const queryResult = await driver.query(query!, maxLimit)
        if (queryResult.rows.length === 0) {
          result = "_(0 rows returned)_"
        } else {
          result = formatResults(queryResult.columns, queryResult.rows)
        }
      }

      return {
        output: result,
        metadata: {
          type,
          action,
          database: extractDatabaseName(connectionString, type),
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Sanitize: redact connection strings and passwords from error messages
      const sanitized = message
        .replace(/postgresql:\/\/[^\s]+/gi, "<connection-redacted>")
        .replace(/mysql:\/\/[^\s]+/gi, "<connection-redacted>")
        .replace(/(Server\s*=\s*[^;]+;\s*(?:Database\s*=\s*[^;]+;\s*)?(?:User\s+Id\s*=\s*[^;]+;\s*)?)Password\s*=\s*[^;]+/gi, "$1Password=<redacted>")
        .replace(/password\s*[:=]\s*\S+/gi, "password=<redacted>")
      const dbId = extractDatabaseName(connectionString, type)
      return `Database error [${dbId}]: ${sanitized}`
    } finally {
      if (driver) {
        await driver.close().catch(() => {})
      }
    }
  },
})

// CP-06: Export pure functions for testability
export { extractDatabaseName, formatResults, isReadOnlyQuery, hasMultiStatement }
export type { DatabaseDriver }
export { PostgresDriver, MySQLDriver, MSSQLDriver, createDriver }
