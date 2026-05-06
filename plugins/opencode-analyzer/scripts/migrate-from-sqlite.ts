#!/usr/bin/env node
/**
 * Migration Script: SQLite → PostgreSQL
 *
 * Reads the existing analyzer.db (SQLite via sql.js) and inserts all data
 * into PostgreSQL using Drizzle ORM.
 *
 * Usage: node scripts/migrate-from-sqlite.js
 * Requires: DATABASE_URL in .env or environment
 */

// @ts-expect-error - no @types/sql.js available
import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import 'dotenv/config';

// @ts-expect-error - compiled JS output without .d.ts; schema is typeof import('../src/db/schema.js')
import * as schema from '../dist/src/db/schema.js';
// @ts-expect-error - compiled JS output without .d.ts
import { getConnectionString } from '../dist/src/db/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'analyzer.db');

function readAll(sqliteDb: any, sql: string): any[] {
  const stmt = sqliteDb.prepare(sql);
  const rows: any[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

async function main(): Promise<void> {
  // 1. Check SQLite file exists
  if (!fs.existsSync(DB_PATH)) {
    console.error(`No SQLite database found at ${DB_PATH}. Nothing to migrate.`);
    process.exit(0);
  }

  // 2. Load SQLite data
  console.log('Loading SQLite database...');
  const SQL = await initSqlJs();
  const buffer = fs.readFileSync(DB_PATH);
  const sqliteDb = new SQL.Database(buffer);

  // 3. Read all tables
  const sessions = readAll(sqliteDb, 'SELECT * FROM sessions');
  const subagentCalls = readAll(sqliteDb, 'SELECT * FROM subagent_calls');
  const skillLoads = readAll(sqliteDb, 'SELECT * FROM skill_loads');
  const toolCalls = readAll(sqliteDb, 'SELECT * FROM tool_calls');
  const messages = readAll(sqliteDb, 'SELECT * FROM messages');
  const analysisResults = readAll(sqliteDb, 'SELECT * FROM analysis_results');

  console.log(`Found: ${sessions.length} sessions`);
  console.log(`Found: ${subagentCalls.length} subagent calls`);
  console.log(`Found: ${skillLoads.length} skill loads`);
  console.log(`Found: ${toolCalls.length} tool calls`);
  console.log(`Found: ${messages.length} messages`);
  console.log(`Found: ${analysisResults.length} analysis results`);

  if (sessions.length === 0) {
    console.log('No data to migrate. Exiting.');
    process.exit(0);
  }

  // 4. Connect to PostgreSQL
  console.log('\nConnecting to PostgreSQL...');
  const pool = new pg.Pool({ connectionString: getConnectionString(), max: 5 });
  const db = drizzle(pool, { schema });

  try {
    // 5. Insert data in dependency order: sessions first, then children
    const BATCH_SIZE = 100;

    // --- SESSIONS ---
    console.log('\nImporting sessions...');
    for (let i = 0; i < sessions.length; i += BATCH_SIZE) {
      const batch = sessions.slice(i, i + BATCH_SIZE).map((row: any) => ({
        id: row.id,
        projectId: row.project_id ?? '',
        title: row.title ?? '',
        directory: row.directory ?? '',
        parentId: row.parent_id ?? null,
        createdAt: row.created_at ?? 0,
        updatedAt: row.updated_at ?? 0,
        added: row.added ?? 0,
        deleted: row.deleted ?? 0,
        filesChanged: row.files_changed ?? 0,
        messageCount: row.message_count ?? 0,
        totalCost: row.total_cost ?? 0,
        totalInputTokens: row.total_input_tokens ?? 0,
        totalOutputTokens: row.total_output_tokens ?? 0,
        totalReasoningTokens: row.total_reasoning_tokens ?? 0,
        cacheReadTokens: row.cache_read_tokens ?? 0,
        cacheWriteTokens: row.cache_write_tokens ?? 0,
        modelUsed: row.model_used ?? '',
        providerUsed: row.provider_used ?? '',
      }));
      await db.insert(schema.sessions).values(batch as any).onConflictDoNothing();
      console.log(`  Sessions: ${Math.min(i + BATCH_SIZE, sessions.length)}/${sessions.length}`);
    }

    // --- SUBAGENT CALLS ---
    if (subagentCalls.length > 0) {
      console.log('Importing subagent calls...');
      for (let i = 0; i < subagentCalls.length; i += BATCH_SIZE) {
        const batch = subagentCalls.slice(i, i + BATCH_SIZE).map((row: any) => ({
          sessionId: row.session_id,
          messageId: row.message_id ?? '',
          agentName: row.agent_name,
          calledAt: row.called_at ?? 0,
          reason: row.reason ?? '',
          promptPreview: row.prompt_preview ?? '',
          status: row.status ?? 'completed',
          durationMs: row.duration_ms ?? 0,
        }));
        await insertBatch(schema.subagentCalls, batch as any, 'subagent calls');
        console.log(`  Subagent calls: ${Math.min(i + BATCH_SIZE, subagentCalls.length)}/${subagentCalls.length}`);
      }
    }

    // Helper: insert batch, retry row-by-row on FK violations
    async function insertBatch(table: any, rows: any[], label: string): Promise<void> {
      try {
        await db.insert(table).values(rows);
      } catch (err: any) {
        if (err.message.includes('foreign key constraint')) {
          console.log(`    Some ${label} skipped due to FK violation (orphaned session_id)`);
          for (const row of rows) {
            try {
              await db.insert(table).values(row);
            } catch (e: any) {
              if (!e.message.includes('foreign key constraint')) throw e;
            }
          }
        } else {
          throw err;
        }
      }
    }

    // --- SKILL LOADS ---
    if (skillLoads.length > 0) {
      console.log('Importing skill loads...');
      for (let i = 0; i < skillLoads.length; i += BATCH_SIZE) {
        const batch = skillLoads.slice(i, i + BATCH_SIZE).map((row: any) => ({
          sessionId: row.session_id,
          skillName: row.skill_name,
          loadedAt: row.loaded_at ?? 0,
          reason: row.reason ?? '',
          context: row.context ?? '',
        }));
        await insertBatch(schema.skillLoads, batch as any, 'skill loads');
        console.log(`  Skill loads: ${Math.min(i + BATCH_SIZE, skillLoads.length)}/${skillLoads.length}`);
      }
    }

    // --- TOOL CALLS ---
    if (toolCalls.length > 0) {
      console.log('Importing tool calls...');
      for (let i = 0; i < toolCalls.length; i += BATCH_SIZE) {
        const batch = toolCalls.slice(i, i + BATCH_SIZE).map((row: any) => ({
          sessionId: row.session_id,
          messageId: row.message_id ?? '',
          toolName: row.tool_name,
          calledAt: row.called_at ?? 0,
          status: row.status ?? 'completed',
          durationMs: row.duration_ms ?? 0,
          inputSummary: row.input_summary ?? '',
          outputSummary: row.output_summary ?? '',
        }));
        await insertBatch(schema.toolCalls, batch as any, 'tool calls');
        console.log(`  Tool calls: ${Math.min(i + BATCH_SIZE, toolCalls.length)}/${toolCalls.length}`);
      }
    }

    // --- MESSAGES ---
    if (messages.length > 0) {
      console.log('Importing messages...');
      for (let i = 0; i < messages.length; i += BATCH_SIZE) {
        const batch = messages.slice(i, i + BATCH_SIZE).map((row: any) => ({
          id: row.id,
          sessionId: row.session_id,
          role: row.role ?? 'user',
          agentName: row.agent_name ?? '',
          modelId: row.model_id ?? '',
          providerId: row.provider_id ?? '',
          createdAt: row.created_at ?? 0,
          completedAt: row.completed_at ?? null,
          inputTokens: row.input_tokens ?? 0,
          outputTokens: row.output_tokens ?? 0,
          reasoningTokens: row.reasoning_tokens ?? 0,
          cacheRead: row.cache_read ?? 0,
          cacheWrite: row.cache_write ?? 0,
          cost: row.cost ?? 0,
          finishReason: row.finish_reason ?? '',
          summary: row.summary ?? '',
        }));
        await insertBatch(schema.messages, batch as any, 'messages');
        console.log(`  Messages: ${Math.min(i + BATCH_SIZE, messages.length)}/${messages.length}`);
      }
    }

    // --- ANALYSIS RESULTS ---
    if (analysisResults.length > 0) {
      console.log('Importing analysis results...');
      for (let i = 0; i < analysisResults.length; i += BATCH_SIZE) {
        const batch = analysisResults.slice(i, i + BATCH_SIZE).map((row: any) => {
          let pros: string[] = []; try { pros = JSON.parse(row.pros || '[]'); } catch(e) {}
          let cons: string[] = []; try { cons = JSON.parse(row.cons || '[]'); } catch(e) {}
          let recommendations: string[] = []; try { recommendations = JSON.parse(row.recommendations || '[]'); } catch(e) {}
          let altAgents: string[] = []; try { altAgents = JSON.parse(row.alternative_agents || '[]'); } catch(e) {}
          let altSkills: string[] = []; try { altSkills = JSON.parse(row.alternative_skills || '[]'); } catch(e) {}

          return {
            sessionId: row.session_id,
            analyzedAt: row.analyzed_at ?? 0,
            pros,
            cons,
            recommendations,
            alternativeAgents: altAgents,
            alternativeSkills: altSkills,
            efficiencyScore: row.efficiency_score ?? 0,
          };
        });
        await insertBatch(schema.analysisResults, batch as any, 'analysis results');
        console.log(`  Analysis results: ${Math.min(i + BATCH_SIZE, analysisResults.length)}/${analysisResults.length}`);
      }
    }

    console.log('\n✓ Migration complete!');
    console.log(`Total: ${sessions.length} sessions, ${subagentCalls.length} subagent calls, ${skillLoads.length} skill loads, ${toolCalls.length} tool calls, ${messages.length} messages, ${analysisResults.length} analyses.`);

  } catch (err: any) {
    console.error('\n✗ Migration failed:', err.message);
    if (err.message.includes('ECONNREFUSED')) {
      console.error('  Hint: Is PostgreSQL running? Check your DATABASE_URL in .env');
    } else if (err.message.includes('does not exist')) {
      console.error('  Hint: Did you run "npx drizzle-kit migrate" first to create tables?');
    }
    process.exit(1);
  } finally {
    await pool.end();
    sqliteDb.close();
  }
}

main();
