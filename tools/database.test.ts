import { describe, expect, test } from "bun:test"
import {
  extractDatabaseName,
  isReadOnlyQuery,
  hasMultiStatement,
  formatResults,
  escapeMarkdownCell,
  applyLimit,
  applyTop,
} from "./database"

// ---------------------------------------------------------------------------
// extractDatabaseName
// ---------------------------------------------------------------------------

describe("extractDatabaseName", () => {
  describe("PostgreSQL connection strings", () => {
    test("extracts host, port, and database from a standard URL", () => {
      const result = extractDatabaseName(
        "postgresql://user:password@db.example.com:5432/mydb",
        "postgres",
      )
      expect(result).toBe("db.example.com:5432/mydb")
    })

    test("uses default port 5432 when port is omitted", () => {
      const result = extractDatabaseName(
        "postgresql://user:password@db.example.com/mydb",
        "postgres",
      )
      expect(result).toBe("db.example.com:5432/mydb")
    })

    test("uses (default) when no database path is present", () => {
      const result = extractDatabaseName(
        "postgresql://user:password@db.example.com:5432/",
        "postgres",
      )
      expect(result).toBe("db.example.com:5432/(default)")
    })
  })

  describe("MySQL connection strings", () => {
    test("extracts host, port, and database from a standard URL", () => {
      const result = extractDatabaseName(
        "mysql://user:password@db.example.com:3306/mydb",
        "mysql",
      )
      expect(result).toBe("db.example.com:3306/mydb")
    })

    test("uses default port 3306 when port is omitted", () => {
      const result = extractDatabaseName(
        "mysql://user:password@db.example.com/mydb",
        "mysql",
      )
      expect(result).toBe("db.example.com:3306/mydb")
    })

    test("uses (default) when no database path is present", () => {
      const result = extractDatabaseName(
        "mysql://user:password@db.example.com:3306/",
        "mysql",
      )
      expect(result).toBe("db.example.com:3306/(default)")
    })
  })

  describe("MSSQL connection strings", () => {
    test("extracts server and database from a standard connection string", () => {
      const result = extractDatabaseName(
        "Server=sql.example.com;Database=mydb;User Id=user;Password=pass;",
        "mssql",
      )
      expect(result).toBe("sql.example.com/mydb")
    })

    test("supports Data Source and Initial Catalog synonyms", () => {
      const result = extractDatabaseName(
        "Data Source=sql.example.com;Initial Catalog=mydb;Integrated Security=True;",
        "mssql",
      )
      expect(result).toBe("sql.example.com/mydb")
    })

    test("uses (default) when no database is specified", () => {
      const result = extractDatabaseName(
        "Server=sql.example.com;User Id=user;Password=pass;",
        "mssql",
      )
      expect(result).toBe("sql.example.com/(default)")
    })

    test("handles spaces around key=value separators", () => {
      const result = extractDatabaseName(
        "Server = sql.example.com ; Database = mydb ; User Id = user ; Password = pass ;",
        "mssql",
      )
      expect(result).toBe("sql.example.com/mydb")
    })
  })

  describe("malformed and edge cases", () => {
    test("returns 'unknown' for an unsupported database type", () => {
      const result = extractDatabaseName("some-string", "sqlite")
      expect(result).toBe("unknown")
    })

    test("returns 'unknown' for a malformed postgres URL", () => {
      const result = extractDatabaseName("not-a-valid-url", "postgres")
      expect(result).toBe("unknown")
    })

    test("returns 'unknown' for a malformed mysql URL", () => {
      const result = extractDatabaseName("not-a-valid-url", "mysql")
      expect(result).toBe("unknown")
    })

    test("returns 'unknown' for an empty string", () => {
      const result = extractDatabaseName("", "postgres")
      expect(result).toBe("unknown")
    })

    test("handles MSSQL with unknown server gracefully", () => {
      const result = extractDatabaseName("", "mssql")
      expect(result).toBe("unknown/(default)")
    })
  })
})

// ---------------------------------------------------------------------------
// isReadOnlyQuery
// ---------------------------------------------------------------------------

describe("isReadOnlyQuery", () => {
  describe("SELECT queries", () => {
    test("accepts a simple SELECT", () => {
      expect(isReadOnlyQuery("SELECT * FROM users")).toBe(true)
    })

    test("accepts SELECT with specific columns", () => {
      expect(isReadOnlyQuery("SELECT id, name FROM users WHERE id = 1")).toBe(true)
    })

    test("accepts SELECT with JOINs", () => {
      expect(isReadOnlyQuery("SELECT u.id, o.total FROM users u JOIN orders o ON u.id = o.user_id")).toBe(true)
    })

    test("accepts SELECT with subqueries", () => {
      expect(isReadOnlyQuery("SELECT * FROM (SELECT id FROM users) AS sub")).toBe(true)
    })

    test("accepts SELECT with functions", () => {
      expect(isReadOnlyQuery("SELECT COUNT(*) FROM users")).toBe(true)
    })
  })

  describe("WITH (CTE) queries", () => {
    test("accepts a simple WITH query", () => {
      expect(isReadOnlyQuery("WITH cte AS (SELECT * FROM users) SELECT * FROM cte")).toBe(true)
    })

    test("accepts WITH RECURSIVE", () => {
      expect(isReadOnlyQuery("WITH RECURSIVE cte AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM cte WHERE n < 10) SELECT * FROM cte")).toBe(true)
    })

    test("accepts multiple CTEs", () => {
      expect(isReadOnlyQuery("WITH a AS (SELECT 1 AS n), b AS (SELECT 2 AS n) SELECT * FROM a UNION SELECT * FROM b")).toBe(true)
    })
  })

  describe("write keyword rejection", () => {
    test("rejects INSERT", () => {
      expect(isReadOnlyQuery("INSERT INTO users (id) VALUES (1)")).toBe(false)
    })

    test("rejects UPDATE", () => {
      expect(isReadOnlyQuery("UPDATE users SET name = 'test' WHERE id = 1")).toBe(false)
    })

    test("rejects DELETE", () => {
      expect(isReadOnlyQuery("DELETE FROM users WHERE id = 1")).toBe(false)
    })

    test("rejects DROP", () => {
      expect(isReadOnlyQuery("DROP TABLE users")).toBe(false)
    })

    test("rejects ALTER", () => {
      expect(isReadOnlyQuery("ALTER TABLE users ADD COLUMN age INT")).toBe(false)
    })

    test("rejects CREATE", () => {
      expect(isReadOnlyQuery("CREATE TABLE test (id INT)")).toBe(false)
    })

    test("rejects TRUNCATE", () => {
      expect(isReadOnlyQuery("TRUNCATE TABLE users")).toBe(false)
    })

    test("rejects EXEC", () => {
      expect(isReadOnlyQuery("EXEC sp_who")).toBe(false)
    })

    test("rejects EXECUTE", () => {
      expect(isReadOnlyQuery("EXECUTE sp_who")).toBe(false)
    })

    test("rejects MERGE", () => {
      expect(isReadOnlyQuery("MERGE INTO users USING ...")).toBe(false)
    })

    test("rejects REPLACE", () => {
      expect(isReadOnlyQuery("REPLACE INTO users VALUES (1)")).toBe(false)
    })

    test("rejects GRANT", () => {
      expect(isReadOnlyQuery("GRANT SELECT ON users TO bob")).toBe(false)
    })

    test("rejects REVOKE", () => {
      expect(isReadOnlyQuery("REVOKE SELECT ON users FROM bob")).toBe(false)
    })

    test("rejects RENAME", () => {
      expect(isReadOnlyQuery("RENAME TABLE users TO old_users")).toBe(false)
    })

    test("rejects SET", () => {
      expect(isReadOnlyQuery("SET @var = 1")).toBe(false)
    })

    test("rejects CALL", () => {
      expect(isReadOnlyQuery("CALL my_proc()")).toBe(false)
    })

    test("rejects COPY", () => {
      expect(isReadOnlyQuery("COPY users FROM '/tmp/data.csv'")).toBe(false)
    })

    test("rejects LOAD", () => {
      expect(isReadOnlyQuery("LOAD DATA INFILE '/tmp/data.csv' INTO TABLE users")).toBe(false)
    })

    test("rejects BULK", () => {
      expect(isReadOnlyQuery("BULK INSERT users FROM '/tmp/data.csv'")).toBe(false)
    })
  })

  describe("multi-word write patterns", () => {
    test("rejects EXECUTE IMMEDIATE", () => {
      expect(isReadOnlyQuery("EXECUTE IMMEDIATE 'SELECT 1'")).toBe(false)
    })

    test("rejects LOAD DATA", () => {
      expect(isReadOnlyQuery("LOAD DATA LOCAL INFILE '/tmp/data.csv' INTO TABLE users")).toBe(false)
    })

    test("rejects BULK INSERT", () => {
      expect(isReadOnlyQuery("BULK INSERT users FROM '/tmp/data.csv' WITH (FORMAT = 'CSV')")).toBe(false)
    })
  })

  describe("string literals containing keywords", () => {
    test("allows SELECT with 'insert' inside a string literal", () => {
      expect(isReadOnlyQuery("SELECT * FROM users WHERE name = 'insert'")).toBe(true)
    })

    test("allows SELECT with 'delete' inside a string literal", () => {
      expect(isReadOnlyQuery("SELECT * FROM users WHERE name = 'delete'")).toBe(true)
    })

    test("allows SELECT with 'drop table' inside a string literal", () => {
      expect(isReadOnlyQuery("SELECT * FROM users WHERE name = 'drop table users'")).toBe(true)
    })

    test("allows SELECT with 'update' inside a string literal", () => {
      expect(isReadOnlyQuery("SELECT * FROM users WHERE name = 'update'")).toBe(true)
    })
  })

  describe("comments containing keywords", () => {
    test("allows SELECT with write keyword in a single-line comment", () => {
      expect(isReadOnlyQuery("SELECT * FROM users -- DROP TABLE users")).toBe(true)
    })

    test("allows SELECT with write keyword in a block comment", () => {
      expect(isReadOnlyQuery("SELECT * FROM users /* DROP TABLE users */")).toBe(true)
    })

    test("allows SELECT with INSERT in a block comment", () => {
      expect(isReadOnlyQuery("SELECT 1 /* INSERT INTO users VALUES (1) */")).toBe(true)
    })
  })

  describe("escaped quotes", () => {
    test("handles escaped single quotes (doubled) inside string literals", () => {
      expect(isReadOnlyQuery("SELECT * FROM users WHERE name = 'O''Brien'")).toBe(true)
    })

    test("handles escaped double quotes (doubled) inside string literals", () => {
      expect(isReadOnlyQuery('SELECT * FROM users WHERE name = "O""Brien"')).toBe(true)
    })
  })

  describe("bypass scenarios from review", () => {
    // NOTE: node-sql-parser successfully parses SELECT dblink_exec(...) as a
    // valid SELECT statement, so the AST path returns true and the regex
    // fallback is never reached. These are known gaps — the function does not
    // currently detect write operations hidden inside function arguments.
    // A future enhancement should add AST-level or deeper string inspection.

    test("does NOT reject SELECT with INSERT via dblink() (known gap — parser treats as SELECT)", () => {
      expect(isReadOnlyQuery("SELECT dblink_exec('connstr', 'INSERT INTO users VALUES (1)')")).toBe(true)
    })

    test("does NOT reject SELECT with UPDATE via dblink() (known gap)", () => {
      expect(isReadOnlyQuery("SELECT dblink_exec('connstr', 'UPDATE users SET name = ''x''')")).toBe(true)
    })

    test("does NOT reject SELECT with DELETE via dblink() (known gap)", () => {
      expect(isReadOnlyQuery("SELECT dblink_exec('connstr', 'DELETE FROM users')")).toBe(true)
    })

    test("does NOT reject SELECT with DROP via dblink() (known gap)", () => {
      expect(isReadOnlyQuery("SELECT dblink_exec('connstr', 'DROP TABLE users')")).toBe(true)
    })

    test("does NOT reject SELECT with fn_ExecuteSQL() (known gap)", () => {
      expect(isReadOnlyQuery("SELECT fn_ExecuteSQL('INSERT INTO users VALUES (1)')")).toBe(true)
    })

    test("rejects SELECT with sp_executesql containing INSERT (semicolon triggers multi-stmt detection)", () => {
      expect(isReadOnlyQuery("SELECT * FROM OPENQUERY(server, 'SELECT 1'); EXEC sp_executesql N'INSERT INTO users VALUES (1)'")).toBe(false)
    })
  })

  describe("edge cases", () => {
    test("rejects an empty string", () => {
      expect(isReadOnlyQuery("")).toBe(false)
    })

    test("rejects a string with only whitespace", () => {
      expect(isReadOnlyQuery("   ")).toBe(false)
    })

    test("rejects a multi-statement query (parser returns array)", () => {
      expect(isReadOnlyQuery("SELECT 1; SELECT 2")).toBe(false)
    })

    // NOTE: node-sql-parser parses "SELECT * INTO new_table FROM users" as a
    // valid SELECT statement (the INTO is treated as a SELECT clause, not a
    // write operation). The post-AST regex check catches this.
    test("rejects SELECT INTO (post-AST check catches table creation)", () => {
      expect(isReadOnlyQuery("SELECT * INTO new_table FROM users")).toBe(false)
    })

    test("allows SELECT with lowercase keywords", () => {
      expect(isReadOnlyQuery("select * from users")).toBe(true)
    })

    test("allows SELECT with mixed case", () => {
      expect(isReadOnlyQuery("Select * From users")).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// hasMultiStatement
// ---------------------------------------------------------------------------

describe("hasMultiStatement", () => {
  test("returns false for a single SELECT statement", () => {
    expect(hasMultiStatement("SELECT * FROM users")).toBe(false)
  })

  test("returns true for a single SELECT with a trailing semicolon", () => {
    expect(hasMultiStatement("SELECT * FROM users;")).toBe(true)
  })

  test("returns true for two SELECT statements separated by semicolon", () => {
    expect(hasMultiStatement("SELECT 1; SELECT 2")).toBe(true)
  })

  test("returns true for SELECT followed by INSERT", () => {
    expect(hasMultiStatement("SELECT 1; INSERT INTO users VALUES (1)")).toBe(true)
  })

  describe("semicolons in string literals", () => {
    test("ignores semicolons inside single-quoted strings", () => {
      expect(hasMultiStatement("SELECT * FROM users WHERE name = 'hello; world'")).toBe(false)
    })

    test("ignores semicolons inside double-quoted strings", () => {
      expect(hasMultiStatement('SELECT * FROM users WHERE name = "hello; world"')).toBe(false)
    })

    test("ignores semicolons inside strings with escaped quotes", () => {
      expect(hasMultiStatement("SELECT * FROM users WHERE name = 'O''Brien; test'")).toBe(false)
    })
  })

  describe("semicolons in comments", () => {
    test("ignores semicolons inside single-line comments", () => {
      expect(hasMultiStatement("SELECT 1 -- this is a comment; with semicolon")).toBe(false)
    })

    test("ignores semicolons inside block comments", () => {
      expect(hasMultiStatement("SELECT 1 /* block; comment */")).toBe(false)
    })

    test("ignores semicolons in both comments and strings", () => {
      expect(hasMultiStatement("SELECT 'str;' /* comment; */ -- line;")).toBe(false)
    })
  })

  describe("edge cases", () => {
    test("returns false for an empty string", () => {
      expect(hasMultiStatement("")).toBe(false)
    })

    test("returns false for a string with only whitespace", () => {
      expect(hasMultiStatement("   ")).toBe(false)
    })

    test("detects semicolon after a comment", () => {
      expect(hasMultiStatement("SELECT 1 /* comment */; SELECT 2")).toBe(true)
    })

    test("detects semicolon before a comment", () => {
      expect(hasMultiStatement("SELECT 1; -- trailing comment")).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// formatResults
// ---------------------------------------------------------------------------

describe("formatResults", () => {
  test("returns empty message for zero rows", () => {
    const result = formatResults(["id", "name"], [])
    expect(result).toBe("_(0 rows returned)_")
  })

  test("formats a single row", () => {
    const result = formatResults(["id", "name"], [{ id: 1, name: "Alice" }])
    expect(result).toContain("| id | name |")
    expect(result).toContain("| --- | --- |")
    expect(result).toContain("| 1 | Alice |")
    expect(result).toContain("_1 row(s) returned_")
  })

  test("formats multiple rows", () => {
    const rows = [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]
    const result = formatResults(["id", "name"], rows)
    expect(result).toContain("| 1 | Alice |")
    expect(result).toContain("| 2 | Bob |")
    expect(result).toContain("_2 row(s) returned_")
  })

  test("renders NULL values as 'NULL'", () => {
    const rows = [{ id: 1, name: null }, { id: 2, name: undefined }]
    const result = formatResults(["id", "name"], rows)
    expect(result).toContain("| 1 | NULL |")
    expect(result).toContain("| 2 | NULL |")
  })

  test("handles special characters in values", () => {
    const rows = [{ id: 1, name: "John & Jane" }]
    const result = formatResults(["id", "name"], rows)
    expect(result).toContain("| 1 | John & Jane |")
  })

  test("handles pipe characters in values", () => {
    const rows = [{ id: 1, name: "a|b|c" }]
    const result = formatResults(["id", "name"], rows)
    expect(result).toContain("| 1 | a\\|b\\|c |")
  })

  test("handles newlines in values", () => {
    const rows = [{ id: 1, name: "hello\nworld" }]
    const result = formatResults(["id", "name"], rows)
    expect(result).toContain("| 1 | hello\\nworld |")
  })

  test("handles pipe characters in column names", () => {
    const rows = [{ "a|b": 1 }]
    const result = formatResults(["a|b"], rows)
    expect(result).toContain("| a\\|b |")
  })

  test("handles numeric and boolean values", () => {
    const rows = [{ id: 0, active: true, score: 99.5 }]
    const result = formatResults(["id", "active", "score"], rows)
    expect(result).toContain("| 0 | true | 99.5 |")
  })

  test("formats a table with many columns", () => {
    const rows = [{ a: 1, b: 2, c: 3, d: 4 }]
    const result = formatResults(["a", "b", "c", "d"], rows)
    expect(result).toContain("| a | b | c | d |")
    expect(result).toContain("| 1 | 2 | 3 | 4 |")
  })
})

// ---------------------------------------------------------------------------
// escapeMarkdownCell
// ---------------------------------------------------------------------------

describe("escapeMarkdownCell", () => {
  test("escapes pipe characters", () => {
    expect(escapeMarkdownCell("a|b|c")).toBe("a\\|b\\|c")
  })

  test("replaces newlines with \\n", () => {
    expect(escapeMarkdownCell("hello\nworld")).toBe("hello\\nworld")
  })

  test("removes carriage returns", () => {
    expect(escapeMarkdownCell("hello\r\nworld")).toBe("hello\\nworld")
  })

  test("passes through normal text unchanged", () => {
    expect(escapeMarkdownCell("normal text")).toBe("normal text")
  })

  test("handles empty string", () => {
    expect(escapeMarkdownCell("")).toBe("")
  })
})

// ---------------------------------------------------------------------------
// applyLimit (PostgreSQL/MySQL)
// ---------------------------------------------------------------------------

describe("applyLimit", () => {
  test("appends LIMIT to a simple SELECT", () => {
    const result = applyLimit("SELECT * FROM users ORDER BY id", 10)
    expect(result).toBe("SELECT * FROM users ORDER BY id LIMIT 10")
  })

  test("appends LIMIT to SELECT with WHERE clause", () => {
    const result = applyLimit("SELECT id, name FROM users WHERE active = true", 5)
    expect(result).toBe("SELECT id, name FROM users WHERE active = true LIMIT 5")
  })

  test("falls back to subquery wrapping when query already has LIMIT", () => {
    const result = applyLimit("SELECT * FROM users LIMIT 5", 10)
    expect(result).toMatch(/^SELECT \* FROM \(SELECT \* FROM users LIMIT 5\) AS _db_limit_sub_\d+ LIMIT 10$/)
  })

  test("falls back to subquery wrapping for CTE queries", () => {
    const result = applyLimit("WITH cte AS (SELECT * FROM users) SELECT * FROM cte", 10)
    expect(result).toMatch(/^SELECT \* FROM \(WITH cte AS \(SELECT \* FROM users\) SELECT \* FROM cte\) AS _db_limit_sub_\d+ LIMIT 10$/)
  })

  test("falls back to subquery wrapping for UNION queries", () => {
    const result = applyLimit("SELECT * FROM users UNION SELECT * FROM admins", 10)
    expect(result).toMatch(/^SELECT \* FROM \(SELECT \* FROM users UNION SELECT \* FROM admins\) AS _db_limit_sub_\d+ LIMIT 10$/)
  })

  test("strips trailing semicolon before appending LIMIT", () => {
    const result = applyLimit("SELECT * FROM users;", 10)
    expect(result).toBe("SELECT * FROM users LIMIT 10")
  })
})

// ---------------------------------------------------------------------------
// applyTop (MSSQL)
// ---------------------------------------------------------------------------

describe("applyTop", () => {
  test("prepends TOP to a simple SELECT", () => {
    const result = applyTop("SELECT * FROM users ORDER BY id", 10)
    expect(result).toBe("SELECT TOP 10 * FROM users ORDER BY id")
  })

  test("prepends TOP to SELECT with specific columns", () => {
    const result = applyTop("SELECT id, name FROM users WHERE active = true", 5)
    expect(result).toBe("SELECT TOP 5 id, name FROM users WHERE active = true")
  })

  test("falls back to subquery wrapping when query already has TOP", () => {
    const result = applyTop("SELECT TOP 5 * FROM users", 10)
    expect(result).toMatch(/^SELECT TOP 10 \* FROM \(SELECT TOP 5 \* FROM users\) AS _db_limit_sub_\d+$/)
  })

  test("falls back to subquery wrapping for CTE queries", () => {
    const result = applyTop("WITH cte AS (SELECT * FROM users) SELECT * FROM cte", 10)
    expect(result).toMatch(/^SELECT TOP 10 \* FROM \(WITH cte AS \(SELECT \* FROM users\) SELECT \* FROM cte\) AS _db_limit_sub_\d+$/)
  })

  test("falls back to subquery wrapping for UNION queries", () => {
    const result = applyTop("SELECT * FROM users UNION SELECT * FROM admins", 10)
    expect(result).toMatch(/^SELECT TOP 10 \* FROM \(SELECT \* FROM users UNION SELECT \* FROM admins\) AS _db_limit_sub_\d+$/)
  })
})
