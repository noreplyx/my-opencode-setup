import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { eq, sql, count, desc, asc, isNull, like } from 'drizzle-orm';
import { getDbPath } from './db/config.js';
import * as schema from './db/schema.js';

// ----- Type definitions for insert shapes -----

interface SessionInput {
  id: string;
  projectID?: string;
  title?: string;
  directory?: string;
  parentID?: string | null;
  time?: { created?: number; updated?: number };
  summary?: { additions?: number; deletions?: number; files?: number };
}

interface SubagentCallInput {
  session_id: string;
  message_id?: string;
  agent_name: string;
  called_at?: number;
  reason?: string;
  prompt_preview?: string;
  status?: string;
  duration_ms?: number;
}

interface SkillLoadInput {
  session_id: string;
  skill_name: string;
  loaded_at?: number;
  reason?: string;
  context?: string;
}

interface ToolCallInput {
  session_id: string;
  message_id?: string;
  tool_name: string;
  called_at?: number;
  status?: string;
  duration_ms?: number;
  input_summary?: string;
  output_summary?: string;
}

interface MessageInput {
  id: string;
  session_id: string;
  role?: string;
  agent_name?: string;
  model_id?: string;
  provider_id?: string;
  created_at?: number;
  completed_at?: number | null;
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  cache_read?: number;
  cache_write?: number;
  cost?: number;
  finish_reason?: string;
  summary?: string;
}

interface AnalysisInput {
  session_id: string;
  analyzed_at?: number;
  pros?: string[];
  cons?: string[];
  recommendations?: string[];
  alternative_agents?: Array<{ name: string; reason: string }>;
  alternative_skills?: Array<{ name: string; reason: string }>;
  efficiency_score?: number;
  prompt?: string;
  ai_generated?: boolean;
}

// ----- Module state -----

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

let sqliteDb: Database | null = null;
let db: DrizzleDb | null = null;

/**
 * Initialize the database with SQLite via Bun's built-in sqlite + Drizzle ORM.
 */
export async function initDatabase(): Promise<DrizzleDb> {
  const dbPath = getDbPath();
  sqliteDb = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  sqliteDb.exec('PRAGMA journal_mode = WAL');
  // Enable foreign key enforcement
  sqliteDb.exec('PRAGMA foreign_keys = ON');

  db = drizzle(sqliteDb, { schema });

  // Create all 6 tables and indexes inline
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      directory TEXT NOT NULL DEFAULT '',
      parent_id TEXT,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      added INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0,
      files_changed INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      total_cost REAL NOT NULL DEFAULT 0,
      total_input_tokens INTEGER NOT NULL DEFAULT 0,
      total_output_tokens INTEGER NOT NULL DEFAULT 0,
      total_reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      model_used TEXT NOT NULL DEFAULT '',
      provider_used TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS subagent_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL DEFAULT '',
      agent_name TEXT NOT NULL,
      called_at INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT '',
      prompt_preview TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'completed',
      duration_ms INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS skill_loads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      skill_name TEXT NOT NULL,
      loaded_at INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT '',
      context TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS tool_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL DEFAULT '',
      tool_name TEXT NOT NULL,
      called_at INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'completed',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      input_summary TEXT NOT NULL DEFAULT '',
      output_summary TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'user',
      agent_name TEXT NOT NULL DEFAULT '',
      model_id TEXT NOT NULL DEFAULT '',
      provider_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0,
      completed_at INTEGER,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read INTEGER NOT NULL DEFAULT 0,
      cache_write INTEGER NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      finish_reason TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS analysis_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
      analyzed_at INTEGER NOT NULL DEFAULT 0,
      pros TEXT NOT NULL DEFAULT '[]',
      cons TEXT NOT NULL DEFAULT '[]',
      recommendations TEXT NOT NULL DEFAULT '[]',
      alternative_agents TEXT NOT NULL DEFAULT '[]',
      alternative_skills TEXT NOT NULL DEFAULT '[]',
      efficiency_score REAL NOT NULL DEFAULT 0,
      prompt TEXT NOT NULL DEFAULT '',
      ai_generated TEXT NOT NULL DEFAULT 'false'
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);
    CREATE INDEX IF NOT EXISTS idx_subagent_calls_session ON subagent_calls(session_id);
    CREATE INDEX IF NOT EXISTS idx_skill_loads_session ON skill_loads(session_id);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
  `);

  return db;
}

/**
 * SQLite persists automatically — no-op kept for API compatibility.
 */
export function saveDatabase(): void {
  // No-op: SQLite persists automatically
}

/**
 * Return the drizzle db instance.
 */
export function getDatabase(): DrizzleDb | null {
  return db;
}

/**
 * Close the SQLite database connection.
 */
export function closeDatabase(): void {
  if (sqliteDb) {
    sqliteDb.close();
    sqliteDb = null;
    db = null;
  }
}

/**
 * Internal helper: throws if db is not initialized.
 */
function getDb(): DrizzleDb {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

// ── SESSION OPERATIONS ──

export async function upsertSession(session: SessionInput): Promise<void> {
  const d = getDb();
  await d.insert(schema.sessions)
    .values({
      id: session.id || '',
      projectId: session.projectID || '',
      title: session.title || '',
      directory: session.directory || '',
      parentId: session.parentID || null,
      createdAt: session.time?.created || Date.now(),
      updatedAt: session.time?.updated || Date.now(),
      added: session.summary?.additions || 0,
      deleted: session.summary?.deletions || 0,
      filesChanged: session.summary?.files || 0,
    })
    .onConflictDoUpdate({
      target: schema.sessions.id,
      set: {
        title: sql`COALESCE(NULLIF(excluded.title, ''), sessions.title)`,
        updatedAt: sql`excluded.updated_at`,
        added: sql`excluded.added`,
        deleted: sql`excluded.deleted`,
        filesChanged: sql`excluded.files_changed`,
      },
    });
}

export async function getSessions(limit = 50, offset = 0, excludeParent = true) {
  const d = getDb();
  const query = d.select({
    id: schema.sessions.id,
    projectId: schema.sessions.projectId,
    title: schema.sessions.title,
    directory: schema.sessions.directory,
    parentId: schema.sessions.parentId,
    createdAt: schema.sessions.createdAt,
    updatedAt: schema.sessions.updatedAt,
    added: schema.sessions.added,
    deleted: schema.sessions.deleted,
    filesChanged: schema.sessions.filesChanged,
    messageCount: schema.sessions.messageCount,
    totalCost: schema.sessions.totalCost,
    totalInputTokens: schema.sessions.totalInputTokens,
    totalOutputTokens: schema.sessions.totalOutputTokens,
    totalReasoningTokens: schema.sessions.totalReasoningTokens,
    cacheReadTokens: schema.sessions.cacheReadTokens,
    cacheWriteTokens: schema.sessions.cacheWriteTokens,
    modelUsed: schema.sessions.modelUsed,
    providerUsed: schema.sessions.providerUsed,
    subagent_count: sql<number>`(SELECT COUNT(*) FROM subagent_calls sc WHERE sc.session_id = sessions.id)`.as('subagent_count'),
    skill_count: sql<number>`(SELECT COUNT(*) FROM skill_loads sl WHERE sl.session_id = sessions.id)`.as('skill_count'),
  })
    .from(schema.sessions)
    .orderBy(desc(schema.sessions.updatedAt))
    .limit(limit)
    .offset(offset);

  if (excludeParent) {
    query.where(isNull(schema.sessions.parentId));
  }

  return await query;
}

export async function searchSessions(query: string, limit = 50) {
  const d = getDb();
  const pattern = `%${query}%`;
  const rows = await d.select({
    id: schema.sessions.id,
    projectId: schema.sessions.projectId,
    title: schema.sessions.title,
    directory: schema.sessions.directory,
    parentId: schema.sessions.parentId,
    createdAt: schema.sessions.createdAt,
    updatedAt: schema.sessions.updatedAt,
    added: schema.sessions.added,
    deleted: schema.sessions.deleted,
    filesChanged: schema.sessions.filesChanged,
    messageCount: schema.sessions.messageCount,
    totalCost: schema.sessions.totalCost,
    totalInputTokens: schema.sessions.totalInputTokens,
    totalOutputTokens: schema.sessions.totalOutputTokens,
    totalReasoningTokens: schema.sessions.totalReasoningTokens,
    cacheReadTokens: schema.sessions.cacheReadTokens,
    cacheWriteTokens: schema.sessions.cacheWriteTokens,
    modelUsed: schema.sessions.modelUsed,
    providerUsed: schema.sessions.providerUsed,
    subagent_count: sql<number>`(SELECT COUNT(*) FROM subagent_calls sc WHERE sc.session_id = sessions.id)`.as('subagent_count'),
    skill_count: sql<number>`(SELECT COUNT(*) FROM skill_loads sl WHERE sl.session_id = sessions.id)`.as('skill_count'),
  })
    .from(schema.sessions)
    .where(like(schema.sessions.title, pattern))
    .orderBy(desc(schema.sessions.updatedAt))
    .limit(limit);
  const totalArr = await d.select({ cnt: count() })
    .from(schema.sessions)
    .where(like(schema.sessions.title, pattern));
  const total = totalArr[0]?.cnt ?? 0;
  return { sessions: rows, total };
}

export async function getSessionById(sessionId: string) {
  const d = getDb();
  const rows = await d.select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);
  return rows.length > 0 ? rows[0] : null;
}

export async function getSessionCount(): Promise<number> {
  const d = getDb();
  const rows = await d.select({ cnt: count() }).from(schema.sessions);
  return rows[0]?.cnt ?? 0;
}

// ── SUBAGENT CALL OPERATIONS ──

export async function insertSubagentCall(call: SubagentCallInput): Promise<void> {
  const d = getDb();
  await d.insert(schema.subagentCalls).values({
    sessionId: call.session_id || '',
    messageId: call.message_id || '',
    agentName: call.agent_name || '',
    calledAt: call.called_at || Date.now(),
    reason: call.reason || '',
    promptPreview: (call.prompt_preview || '').substring(0, 500),
    status: call.status || 'completed',
    durationMs: call.duration_ms || 0,
  });
}

export async function getSubagentCalls(sessionId: string) {
  const d = getDb();
  return await d.select()
    .from(schema.subagentCalls)
    .where(eq(schema.subagentCalls.sessionId, sessionId))
    .orderBy(asc(schema.subagentCalls.calledAt));
}

// ── SKILL LOAD OPERATIONS ──

export async function insertSkillLoad(skillLoad: SkillLoadInput): Promise<void> {
  const d = getDb();
  await d.insert(schema.skillLoads).values({
    sessionId: skillLoad.session_id || '',
    skillName: skillLoad.skill_name || '',
    loadedAt: skillLoad.loaded_at || Date.now(),
    reason: skillLoad.reason || '',
    context: (skillLoad.context || '').substring(0, 1000),
  });
}

export async function getSkillLoads(sessionId: string) {
  const d = getDb();
  return await d.select()
    .from(schema.skillLoads)
    .where(eq(schema.skillLoads.sessionId, sessionId))
    .orderBy(asc(schema.skillLoads.loadedAt));
}

// ── TOOL CALL OPERATIONS ──

export async function insertToolCall(toolCall: ToolCallInput): Promise<void> {
  const d = getDb();
  await d.insert(schema.toolCalls).values({
    sessionId: toolCall.session_id || '',
    messageId: toolCall.message_id || '',
    toolName: toolCall.tool_name || '',
    calledAt: toolCall.called_at || Date.now(),
    status: toolCall.status || 'completed',
    durationMs: toolCall.duration_ms || 0,
    inputSummary: (toolCall.input_summary || '').substring(0, 500),
    outputSummary: (toolCall.output_summary || '').substring(0, 500),
  });
}

export async function getToolCalls(sessionId: string) {
  const d = getDb();
  return await d.select()
    .from(schema.toolCalls)
    .where(eq(schema.toolCalls.sessionId, sessionId))
    .orderBy(asc(schema.toolCalls.calledAt));
}

// ── MESSAGE OPERATIONS ──

export async function upsertMessage(msg: MessageInput): Promise<void> {
  const d = getDb();
  await d.insert(schema.messages).values({
    id: msg.id || '',
    sessionId: msg.session_id || '',
    role: msg.role || 'user',
    agentName: msg.agent_name || '',
    modelId: msg.model_id || '',
    providerId: msg.provider_id || '',
    createdAt: msg.created_at || Date.now(),
    completedAt: msg.completed_at || null,
    inputTokens: msg.input_tokens || 0,
    outputTokens: msg.output_tokens || 0,
    reasoningTokens: msg.reasoning_tokens || 0,
    cacheRead: msg.cache_read || 0,
    cacheWrite: msg.cache_write || 0,
    cost: msg.cost || 0,
    finishReason: msg.finish_reason || '',
    summary: msg.summary || '',
  })
    .onConflictDoUpdate({
      target: schema.messages.id,
      set: {
        completedAt: sql`COALESCE(excluded.completed_at, messages.completed_at)`,
        outputTokens: sql`COALESCE(excluded.output_tokens, messages.output_tokens)`,
        reasoningTokens: sql`COALESCE(excluded.reasoning_tokens, messages.reasoning_tokens)`,
        cacheRead: sql`COALESCE(excluded.cache_read, messages.cache_read)`,
        cacheWrite: sql`COALESCE(excluded.cache_write, messages.cache_write)`,
        cost: sql`COALESCE(excluded.cost, messages.cost)`,
        finishReason: sql`COALESCE(excluded.finish_reason, messages.finish_reason)`,
      },
    });
}

export async function getMessages(sessionId: string) {
  const d = getDb();
  return await d.select()
    .from(schema.messages)
    .where(eq(schema.messages.sessionId, sessionId))
    .orderBy(asc(schema.messages.createdAt));
}

// ── ANALYSIS OPERATIONS ──

export async function upsertAnalysis(analysis: AnalysisInput): Promise<void> {
  const d = getDb();
  await d.insert(schema.analysisResults).values({
    sessionId: analysis.session_id || '',
    analyzedAt: analysis.analyzed_at || Date.now(),
    pros: analysis.pros || [],
    cons: analysis.cons || [],
    recommendations: analysis.recommendations || [],
    alternativeAgents: analysis.alternative_agents || [],
    alternativeSkills: analysis.alternative_skills || [],
    efficiencyScore: analysis.efficiency_score || 0,
    prompt: analysis.prompt || '',
    aiGenerated: analysis.ai_generated ? 'true' : 'false',
  })
    .onConflictDoUpdate({
      target: schema.analysisResults.sessionId,
      set: {
        analyzedAt: sql`excluded.analyzed_at`,
        pros: sql`excluded.pros`,
        cons: sql`excluded.cons`,
        recommendations: sql`excluded.recommendations`,
        alternativeAgents: sql`excluded.alternative_agents`,
        alternativeSkills: sql`excluded.alternative_skills`,
        efficiencyScore: sql`excluded.efficiency_score`,
        prompt: sql`COALESCE(NULLIF(excluded.prompt, ''), analysis_results.prompt)`,
        aiGenerated: sql`excluded.ai_generated`,
      },
    });
}

export async function getAnalysis(sessionId: string) {
  const d = getDb();
  const rows = await d.select()
    .from(schema.analysisResults)
    .where(eq(schema.analysisResults.sessionId, sessionId))
    .limit(1);
  if (rows.length === 0) return null;
  // text({mode:'json'}) columns are already parsed as JS arrays — no JSON.parse needed
  return rows[0];
}

// ── AGGREGATION OPERATIONS ──

export async function getAgentStats() {
  const d = getDb();
  return await d.select({
    agentName: schema.subagentCalls.agentName,
    callCount: count().as('call_count'),
    avgDurationMs: sql<number>`AVG(${schema.subagentCalls.durationMs})`.as('avg_duration_ms'),
    totalDurationMs: sql<number>`SUM(${schema.subagentCalls.durationMs})`.as('total_duration_ms'),
  })
    .from(schema.subagentCalls)
    .groupBy(schema.subagentCalls.agentName)
    .orderBy(desc(count()));
}

export async function getSkillStats() {
  const d = getDb();
  return await d.select({
    skillName: schema.skillLoads.skillName,
    loadCount: count().as('load_count'),
  })
    .from(schema.skillLoads)
    .groupBy(schema.skillLoads.skillName)
    .orderBy(desc(count()));
}

export async function getToolStats() {
  const d = getDb();
  return await d.select({
    toolName: schema.toolCalls.toolName,
    callCount: count().as('call_count'),
    avgDurationMs: sql<number>`AVG(${schema.toolCalls.durationMs})`.as('avg_duration_ms'),
  })
    .from(schema.toolCalls)
    .groupBy(schema.toolCalls.toolName)
    .orderBy(desc(count()));
}

export async function getDailyStats(days = 30) {
  const d = getDb();
  const cutoff = Date.now() - (days * 86400000);
  return await d.select({
    day: sql<string>`strftime('%Y-%m-%d', ${schema.sessions.createdAt} / 1000, 'unixepoch')`.as('day'),
    sessionCount: count().as('session_count'),
    totalTokens: sql<number>`COALESCE(SUM(COALESCE(${schema.sessions.totalInputTokens}, 0) + COALESCE(${schema.sessions.totalOutputTokens}, 0)), 0)`.as('total_tokens'),
    totalCost: sql<number>`COALESCE(SUM(COALESCE(${schema.sessions.totalCost}, 0)), 0)`.as('total_cost'),
  })
    .from(schema.sessions)
    .where(sql`${schema.sessions.createdAt} >= ${cutoff}`)
    .groupBy(sql`1`)
    .orderBy(sql`1`);
}
