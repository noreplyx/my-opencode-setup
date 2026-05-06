import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

// ── 1. sessions ──
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().default(''),
  title: text('title').notNull().default(''),
  directory: text('directory').notNull().default(''),
  parentId: text('parent_id'),
  createdAt: integer('created_at', { mode: 'number' }).notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull().default(0),
  added: integer('added').notNull().default(0),
  deleted: integer('deleted').notNull().default(0),
  filesChanged: integer('files_changed').notNull().default(0),
  messageCount: integer('message_count').notNull().default(0),
  totalCost: real('total_cost').notNull().default(0),
  totalInputTokens: integer('total_input_tokens', { mode: 'number' }).notNull().default(0),
  totalOutputTokens: integer('total_output_tokens', { mode: 'number' }).notNull().default(0),
  totalReasoningTokens: integer('total_reasoning_tokens', { mode: 'number' }).notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens', { mode: 'number' }).notNull().default(0),
  cacheWriteTokens: integer('cache_write_tokens', { mode: 'number' }).notNull().default(0),
  modelUsed: text('model_used').notNull().default(''),
  providerUsed: text('provider_used').notNull().default(''),
}, (table) => ({
  sessionsUpdatedIdx: index('idx_sessions_updated').on(table.updatedAt),
}));

// ── 2. subagent_calls ──
export const subagentCalls = sqliteTable('subagent_calls', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  messageId: text('message_id').notNull().default(''),
  agentName: text('agent_name').notNull(),
  calledAt: integer('called_at', { mode: 'number' }).notNull().default(0),
  reason: text('reason').notNull().default(''),
  promptPreview: text('prompt_preview').notNull().default(''),
  status: text('status').notNull().default('completed'),
  durationMs: integer('duration_ms', { mode: 'number' }).notNull().default(0),
}, (table) => ({
  subagentCallsSessionIdx: index('idx_subagent_calls_session').on(table.sessionId),
}));

// ── 3. skill_loads ──
export const skillLoads = sqliteTable('skill_loads', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  skillName: text('skill_name').notNull(),
  loadedAt: integer('loaded_at', { mode: 'number' }).notNull().default(0),
  reason: text('reason').notNull().default(''),
  context: text('context').notNull().default(''),
}, (table) => ({
  skillLoadsSessionIdx: index('idx_skill_loads_session').on(table.sessionId),
}));

// ── 4. tool_calls ──
export const toolCalls = sqliteTable('tool_calls', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  messageId: text('message_id').notNull().default(''),
  toolName: text('tool_name').notNull(),
  calledAt: integer('called_at', { mode: 'number' }).notNull().default(0),
  status: text('status').notNull().default('completed'),
  durationMs: integer('duration_ms', { mode: 'number' }).notNull().default(0),
  inputSummary: text('input_summary').notNull().default(''),
  outputSummary: text('output_summary').notNull().default(''),
}, (table) => ({
  toolCallsSessionIdx: index('idx_tool_calls_session').on(table.sessionId),
}));

// ── 5. messages ──
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('user'),
  agentName: text('agent_name').notNull().default(''),
  modelId: text('model_id').notNull().default(''),
  providerId: text('provider_id').notNull().default(''),
  createdAt: integer('created_at', { mode: 'number' }).notNull().default(0),
  completedAt: integer('completed_at', { mode: 'number' }),
  inputTokens: integer('input_tokens', { mode: 'number' }).notNull().default(0),
  outputTokens: integer('output_tokens', { mode: 'number' }).notNull().default(0),
  reasoningTokens: integer('reasoning_tokens', { mode: 'number' }).notNull().default(0),
  cacheRead: integer('cache_read', { mode: 'number' }).notNull().default(0),
  cacheWrite: integer('cache_write', { mode: 'number' }).notNull().default(0),
  cost: real('cost').notNull().default(0),
  finishReason: text('finish_reason').notNull().default(''),
  summary: text('summary').notNull().default(''),
}, (table) => ({
  messagesSessionIdx: index('idx_messages_session').on(table.sessionId),
}));

// ── 6. analysis_results ──
export const analysisResults = sqliteTable('analysis_results', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').notNull().unique().references(() => sessions.id, { onDelete: 'cascade' }),
  analyzedAt: integer('analyzed_at', { mode: 'number' }).notNull().default(0),
  pros: text('pros', { mode: 'json' }).notNull().default([]),
  cons: text('cons', { mode: 'json' }).notNull().default([]),
  recommendations: text('recommendations', { mode: 'json' }).notNull().default([]),
  alternativeAgents: text('alternative_agents', { mode: 'json' }).notNull().default([]),
  alternativeSkills: text('alternative_skills', { mode: 'json' }).notNull().default([]),
  efficiencyScore: real('efficiency_score').notNull().default(0),
  prompt: text('prompt').notNull().default(''),
  aiGenerated: text('ai_generated').notNull().default('false'),
});
