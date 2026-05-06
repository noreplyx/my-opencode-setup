import { pgTable, serial, text, integer, bigint, real, jsonb, index } from 'drizzle-orm/pg-core';

// ── 1. sessions ──
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().default(''),
  title: text('title').notNull().default(''),
  directory: text('directory').notNull().default(''),
  parentId: text('parent_id'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull().default(0),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull().default(0),
  added: integer('added').notNull().default(0),
  deleted: integer('deleted').notNull().default(0),
  filesChanged: integer('files_changed').notNull().default(0),
  messageCount: integer('message_count').notNull().default(0),
  totalCost: real('total_cost').notNull().default(0),
  totalInputTokens: bigint('total_input_tokens', { mode: 'number' }).notNull().default(0),
  totalOutputTokens: bigint('total_output_tokens', { mode: 'number' }).notNull().default(0),
  totalReasoningTokens: bigint('total_reasoning_tokens', { mode: 'number' }).notNull().default(0),
  cacheReadTokens: bigint('cache_read_tokens', { mode: 'number' }).notNull().default(0),
  cacheWriteTokens: bigint('cache_write_tokens', { mode: 'number' }).notNull().default(0),
  modelUsed: text('model_used').notNull().default(''),
  providerUsed: text('provider_used').notNull().default(''),
}, (table) => [
  index('idx_sessions_updated').on(table.updatedAt),
]);

// ── 2. subagent_calls ──
export const subagentCalls = pgTable('subagent_calls', {
  id: serial('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  messageId: text('message_id').notNull().default(''),
  agentName: text('agent_name').notNull(),
  calledAt: bigint('called_at', { mode: 'number' }).notNull().default(0),
  reason: text('reason').notNull().default(''),
  promptPreview: text('prompt_preview').notNull().default(''),
  status: text('status').notNull().default('completed'),
  durationMs: bigint('duration_ms', { mode: 'number' }).notNull().default(0),
}, (table) => [
  index('idx_subagent_calls_session').on(table.sessionId),
]);

// ── 3. skill_loads ──
export const skillLoads = pgTable('skill_loads', {
  id: serial('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  skillName: text('skill_name').notNull(),
  loadedAt: bigint('loaded_at', { mode: 'number' }).notNull().default(0),
  reason: text('reason').notNull().default(''),
  context: text('context').notNull().default(''),
}, (table) => [
  index('idx_skill_loads_session').on(table.sessionId),
]);

// ── 4. tool_calls ──
export const toolCalls = pgTable('tool_calls', {
  id: serial('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  messageId: text('message_id').notNull().default(''),
  toolName: text('tool_name').notNull(),
  calledAt: bigint('called_at', { mode: 'number' }).notNull().default(0),
  status: text('status').notNull().default('completed'),
  durationMs: bigint('duration_ms', { mode: 'number' }).notNull().default(0),
  inputSummary: text('input_summary').notNull().default(''),
  outputSummary: text('output_summary').notNull().default(''),
}, (table) => [
  index('idx_tool_calls_session').on(table.sessionId),
]);

// ── 5. messages ──
export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('user'),
  agentName: text('agent_name').notNull().default(''),
  modelId: text('model_id').notNull().default(''),
  providerId: text('provider_id').notNull().default(''),
  createdAt: bigint('created_at', { mode: 'number' }).notNull().default(0),
  completedAt: bigint('completed_at', { mode: 'number' }),
  inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
  outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
  reasoningTokens: bigint('reasoning_tokens', { mode: 'number' }).notNull().default(0),
  cacheRead: bigint('cache_read', { mode: 'number' }).notNull().default(0),
  cacheWrite: bigint('cache_write', { mode: 'number' }).notNull().default(0),
  cost: real('cost').notNull().default(0),
  finishReason: text('finish_reason').notNull().default(''),
  summary: text('summary').notNull().default(''),
}, (table) => [
  index('idx_messages_session').on(table.sessionId),
]);

// ── 6. analysis_results ──
export const analysisResults = pgTable('analysis_results', {
  id: serial('id').primaryKey(),
  sessionId: text('session_id').notNull().unique().references(() => sessions.id, { onDelete: 'cascade' }),
  analyzedAt: bigint('analyzed_at', { mode: 'number' }).notNull().default(0),
  pros: jsonb('pros').notNull().default([]),
  cons: jsonb('cons').notNull().default([]),
  recommendations: jsonb('recommendations').notNull().default([]),
  alternativeAgents: jsonb('alternative_agents').notNull().default([]),
  alternativeSkills: jsonb('alternative_skills').notNull().default([]),
  efficiencyScore: real('efficiency_score').notNull().default(0),
  prompt: text('prompt').notNull().default(''),
  aiGenerated: text('ai_generated').notNull().default('false'),
});
