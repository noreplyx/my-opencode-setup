import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { Request, Response, NextFunction, Router } from 'express';
import {
  getSessions, getSessionById, getSessionCount,
  getSubagentCalls, getSkillLoads, getToolCalls,
  getMessages, getAnalysis, getAgentStats,
  getSkillStats, getToolStats, getDailyStats,
  searchSessions
} from './database.js';
import { analyzeSession, importAuditLog } from './collector.js';
import { log } from './logger.js';
import { insertSubagentCall, insertSkillLoad, insertToolCall, upsertAnalysis } from './database.js';


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Async error wrapper for Express 4
function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

interface GetDiagnosticsResult {
  initialized: boolean;
  serverRunning: boolean;
  eventCounter: number;
  lastEvents: Array<{ type: string; time: number; hasInfo: boolean }>;
  sessionCount: number;
  error?: string;
}

interface SkillLoadRecord {
  skill_name: string;
  [key: string]: unknown;
}

// No external AI API — analysis is fully data-driven via analyzeSession()

export function createRouter(): Router {
  const router = express.Router();
  
  router.use(cors());
  router.use(express.json());
  
  // ---- Diagnostics API ----
  
  // GET /api/health - check if plugin is alive
  router.get('/api/health', asyncHandler(async (req: Request, res: Response) => {
    try {
      // Dynamic import to avoid circular dependency
      const mod: { getDiagnostics?: () => GetDiagnosticsResult } = await import('../index.js');
      const diag = mod.getDiagnostics ? mod.getDiagnostics() : { error: 'getDiagnostics not available' } as GetDiagnosticsResult;
      res.json({ status: 'ok', timestamp: Date.now(), ...diag });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.json({ status: 'error', error: message });
    }
  }));

  // POST /api/backfill/:id - attempt to fetch session messages from OpenCode API and extract agent/skill/tool data
  router.post('/api/backfill/:id', asyncHandler(async (req: Request, res: Response) => {
    try {
      const sessionId = req.params.id as string;
      const opencodePort = 4096;
      
      // Try to fetch session messages from the local OpenCode server
      const msgRes = await fetch(`http://localhost:${opencodePort}/session/${sessionId}/message?limit=100`, {
        signal: AbortSignal.timeout(5000)
      }).catch(() => null);
      
      if (!msgRes || !msgRes.ok) {
        res.json({ backfilled: 0, error: 'Could not reach OpenCode server' });
        return;
      }
      
      const messages: Array<{ info?: { id?: string; time?: { created?: number } }; parts?: Array<Record<string, unknown>> }> = await msgRes.json();
      let count = 0;
      
      for (const msg of messages) {
        if (!msg.parts) continue;
        
        for (const part of msg.parts) {
          const partType = part.type as string;
          
          if (partType === 'agent') {
            await insertSubagentCall({
              session_id: sessionId,
              message_id: msg.info?.id || '',
              agent_name: (part.name as string) || 'unknown',
              called_at: msg.info?.time?.created || Date.now(),
              reason: ((part.source as { value?: string })?.value || '').substring(0, 200) || 'Agent delegation',
              prompt_preview: ((part.source as { value?: string })?.value || '').substring(0, 500) || '',
              status: 'completed',
              duration_ms: 0
            });
            count++;
          }
          
          if (partType === 'subtask') {
            await insertSubagentCall({
              session_id: sessionId,
              message_id: msg.info?.id || '',
              agent_name: (part.agent as string) || 'unknown',
              called_at: msg.info?.time?.created || Date.now(),
              reason: (part.description as string) || 'Subtask delegation',
              prompt_preview: ((part.prompt as string) || '').substring(0, 500),
              status: 'completed',
              duration_ms: 0
            });
            count++;
          }
          
          if (partType === 'tool') {
            const statePart = part.state as { time?: { start?: number; end?: number }; status?: string; input?: unknown; output?: string } | undefined;
            await insertToolCall({
              session_id: sessionId,
              message_id: msg.info?.id || '',
              tool_name: (part.tool as string) || 'unknown',
              called_at: statePart?.time?.start || Date.now(),
              status: statePart?.status || 'completed',
              duration_ms: statePart?.time?.end && statePart?.time?.start 
                ? (statePart.time.end - statePart.time.start) : 0,
              input_summary: JSON.stringify(statePart?.input || {}).substring(0, 500),
              output_summary: (statePart?.output || '').substring(0, 500)
            });
            count++;
          }
          
          // Check for skill references in text parts (skills loaded via system prompt)
          if (partType === 'text' && part.text) {
            // Try multiple patterns for skill references
            const skillPatterns = [
              /skill[:\s]+['"]([^'"]+)['"]/i,
              /load(?:ed)?\s+skill[:\s]+['"]?([\w-]+)['"]?/i,
              /skill\s+name[:\s]+['"]?([\w-]+)['"]?/i
            ];
            for (const pattern of skillPatterns) {
              const textContent = part.text as string;
              const skillMatch = textContent.match(pattern);
              if (skillMatch) {
                const existing = await getSkillLoads(sessionId);
                if (!existing.some(s => s.skillName === skillMatch[1])) {
                  await insertSkillLoad({
                    session_id: sessionId,
                    skill_name: skillMatch[1],
                    loaded_at: msg.info?.time?.created || Date.now(),
                    reason: 'Detected skill reference in message text',
                    context: ''
                  });
                  count++;
                }
                break;
              }
            }
          }
        }
      }
      
      log('INFO', `Backfilled ${count} entries for session ${sessionId.substring(0, 16)}`);
      res.json({ backfilled: count });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log('ERROR', 'Backfill failed: ' + message);
      res.json({ backfilled: 0, error: message });
    }
  }));

  // ---- Sessions API ----
  
  // GET /api/sessions - list all sessions
  router.get('/api/sessions', asyncHandler(async (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const sessions = await getSessions(limit, offset);
    const total = await getSessionCount();
    res.json({ sessions, total, limit, offset });
  }));

  // GET /api/sessions/search - search sessions by title
  router.get('/api/sessions/search', asyncHandler(async (req: Request, res: Response) => {
    const query = (req.query.q as string) || '';
    if (!query.trim()) {
      res.json({ sessions: [], total: 0 });
      return;
    }
    const limit = parseInt(req.query.limit as string) || 50;
    const result = await searchSessions(query, limit);
    res.json(result);
  }));

  // GET /api/sessions/:id - get session detail
  router.get('/api/sessions/:id', asyncHandler(async (req: Request, res: Response) => {
    const session = await getSessionById(req.params.id as string);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(session);
  }));

  // GET /api/sessions/:id/subagents - get subagent calls for a session
  router.get('/api/sessions/:id/subagents', asyncHandler(async (req: Request, res: Response) => {
    const calls = await getSubagentCalls(req.params.id as string);
    res.json(calls);
  }));

  // GET /api/sessions/:id/skills - get skill loads for a session
  router.get('/api/sessions/:id/skills', asyncHandler(async (req: Request, res: Response) => {
    const skills = await getSkillLoads(req.params.id as string);
    res.json(skills);
  }));

  // GET /api/sessions/:id/tools - get tool calls for a session
  router.get('/api/sessions/:id/tools', asyncHandler(async (req: Request, res: Response) => {
    const tools = await getToolCalls(req.params.id as string);
    res.json(tools);
  }));

  // GET /api/sessions/:id/messages - get messages for a session
  router.get('/api/sessions/:id/messages', asyncHandler(async (req: Request, res: Response) => {
    const messages = await getMessages(req.params.id as string);
    res.json(messages);
  }));

  // GET /api/sessions/:id/analysis - get analysis for a session
  router.get('/api/sessions/:id/analysis', asyncHandler(async (req: Request, res: Response) => {
    try {
      const existing = await getAnalysis(req.params.id as string);
      if (existing) {
        res.json(existing);
        return;
      }
      const analysis = await analyzeSession(req.params.id as string);
      res.json(analysis || { pros: [], cons: [], recommendations: [], alternativeAgents: [], alternativeSkills: [], efficiencyScore: 0 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  }));

  // POST /api/sessions/:id/analyze - trigger rule-based analysis
  router.post('/api/sessions/:id/analyze', asyncHandler(async (req: Request, res: Response) => {
    try {
      const analysis = await analyzeSession(req.params.id as string);
      res.json(analysis || { error: 'Could not analyze session' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  }));

  // POST /api/sessions/:id/ai-analyze - AI-powered analysis using OpenCode agent
  router.post('/api/sessions/:id/ai-analyze', asyncHandler(async (req: Request, res: Response) => {
    try {
      const sessionId = req.params.id as string;

      // Fetch session data
      const session = await getSessionById(sessionId);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      const subagentCalls = await getSubagentCalls(sessionId);
      const skillLoads = await getSkillLoads(sessionId);
      const toolCalls = await getToolCalls(sessionId);
      const messages = await getMessages(sessionId);

      // Calculate aggregate stats
      const totalTokens = (session.totalInputTokens || 0) + (session.totalOutputTokens || 0);
      const totalDurationMs = subagentCalls.reduce((sum: number, c) => sum + (c.durationMs || 0), 0);
      const toolDurationMs = toolCalls.reduce((sum: number, t) => sum + (t.durationMs || 0), 0);

      // Build a concise prompt with session data
      const analysisPrompt = `Analyze this OpenCode AI agent session and provide structured feedback as a JSON object with these exact keys:
- "pros": array of strings (positive aspects of this session, be specific using real data)
- "cons": array of strings (negative aspects or issues, be specific)
- "recommendations": array of strings (actionable suggestions to improve)
- "efficiency_score": number 0-100 (overall efficiency rating)

Session Data:
Title: ${session.title || '(untitled)'}
Created: ${new Date(session.createdAt || Date.now()).toISOString()}
Files Changed: ${session.filesChanged || 0} (${session.added || 0} additions, ${session.deleted || 0} deletions)
Total Cost: $${Number(session.totalCost || 0).toFixed(6)}

Subagent Calls (${subagentCalls.length}):
${subagentCalls.map(c => `  Agent: ${c.agentName} | Reason: ${(c.reason || '').substring(0, 150)} | Duration: ${c.durationMs || 0}ms`).join('\n')}

Skill Loads (${skillLoads.length}):
${skillLoads.map(s => `  Skill: ${s.skillName} | Reason: ${(s.reason || '').substring(0, 150)}`).join('\n')}

Tool Calls (${toolCalls.length}):
${toolCalls.map(t => `  Tool: ${t.toolName} | Duration: ${t.durationMs || 0}ms | Status: ${t.status || 'completed'}`).join('\n')}

Token Usage: ${totalTokens} tokens across ${messages.length} messages

Return ONLY valid JSON, no markdown, no code blocks.`;

      log('INFO', `Requesting AI analysis for session ${sessionId.substring(0, 16)}`);

      // Try to use OpenCode's AI via the local HTTP API on port 3456
      const opencodeServerUrl = 'http://localhost:3456';
      let aiResult: any = null;

      try {
        // Create a temporary session for analysis
        const createRes = await fetch(`${opencodeServerUrl}/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: `Analysis: ${(session.title || sessionId).substring(0, 100)}` }),
          signal: AbortSignal.timeout(5000),
        });

        if (createRes.ok) {
          const createData = await createRes.json();
          const tempSessionId = createData?.id || createData?.data?.id;
          
          if (tempSessionId) {
            log('INFO', `Created analysis session: ${tempSessionId.substring(0, 16)}`);
            
            // Send the analysis prompt to the session
            const promptRes = await fetch(`${opencodeServerUrl}/session/${tempSessionId}/message`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                parts: [{ type: 'text', text: analysisPrompt }],
                format: { type: 'text' },
              }),
              signal: AbortSignal.timeout(60000),
            });
            
            if (promptRes.ok) {
              const promptData = await promptRes.json();
              
              // Extract text from response parts
              let content = '';
              const responseData = promptData?.data ?? promptData;
              if (responseData?.parts && Array.isArray(responseData.parts)) {
                content = responseData.parts
                  .filter((p: any) => p.type === 'text' && p.text)
                  .map((p: any) => p.text)
                  .join('\n');
              } else if (typeof responseData === 'string') {
                content = responseData;
              } else {
                content = JSON.stringify(responseData);
              }
              
              if (content) {
                // Try to extract JSON from the response
                try {
                  const jsonMatch = content.match(/\{[\s\S]*\}/);
                  const jsonStr = jsonMatch ? jsonMatch[0] : content;
                  aiResult = JSON.parse(jsonStr);
                } catch {
                  log('WARN', 'Failed to parse AI response as JSON, using rule-based fallback');
                }
              }
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log('WARN', `AI analysis HTTP call failed: ${msg}, using rule-based fallback`);
      }

      // Fallback to rule-based analysis if AI failed
      if (!aiResult || !aiResult.pros) {
        log('INFO', 'Using rule-based analysis as fallback');
        const fallback = await analyzeSession(sessionId);
        res.json(fallback || { pros: [], cons: [], recommendations: [], alternativeAgents: [], alternativeSkills: [], efficiencyScore: 0, aiGenerated: true });
        return;
      }

      // Save the AI analysis
      const analysisPayload = {
        session_id: sessionId,
        analyzed_at: Date.now(),
        pros: aiResult.pros || [],
        cons: aiResult.cons || [],
        recommendations: aiResult.recommendations || [],
        alternative_agents: [] as Array<{ name: string; reason: string }>,
        alternative_skills: [] as Array<{ name: string; reason: string }>,
        efficiency_score: typeof aiResult.efficiency_score === 'number' ? aiResult.efficiency_score : 50,
        prompt: analysisPrompt,
        ai_generated: true,
      };

      await upsertAnalysis(analysisPayload);

      res.json({
        pros: analysisPayload.pros,
        cons: analysisPayload.cons,
        recommendations: analysisPayload.recommendations,
        alternativeAgents: [],
        alternativeSkills: [],
        efficiencyScore: analysisPayload.efficiency_score,
        aiGenerated: true,
      });

      log('INFO', `AI analysis complete for session ${sessionId.substring(0, 16)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log('ERROR', `AI analysis failed: ${message}`);
      // Fallback to rule-based
      try {
        const fallback = await analyzeSession(req.params.id as string);
        res.json(fallback || { pros: [], cons: [], recommendations: [], alternativeAgents: [], alternativeSkills: [], efficiencyScore: 0, aiGenerated: true });
      } catch {
        res.json({ pros: [], cons: [], recommendations: [], alternativeAgents: [], alternativeSkills: [], efficiencyScore: 0, aiGenerated: true, error: message });
      }
    }
  }));

  // ---- Stats API ----
  
  // GET /api/stats/agents - agent statistics
  router.get('/api/stats/agents', asyncHandler(async (req: Request, res: Response) => {
    const stats = await getAgentStats();
    res.json(stats);
  }));

  // GET /api/stats/skills - skill statistics
  router.get('/api/stats/skills', asyncHandler(async (req: Request, res: Response) => {
    const stats = await getSkillStats();
    res.json(stats);
  }));

  // GET /api/stats/tools - tool statistics
  router.get('/api/stats/tools', asyncHandler(async (req: Request, res: Response) => {
    const stats = await getToolStats();
    res.json(stats);
  }));

  // GET /api/stats/daily - daily usage stats
  router.get('/api/stats/daily', asyncHandler(async (req: Request, res: Response) => {
    const days = parseInt(req.query.days as string) || 30;
    const stats = await getDailyStats(days);
    res.json(stats);
  }));

  // GET /api/stats/overview - overview stats for dashboard
  router.get('/api/stats/overview', asyncHandler(async (req: Request, res: Response) => {
    const sessionCount = await getSessionCount();
    const agentStats = await getAgentStats();
    const skillStats = await getSkillStats();
    
    const totalSubagentCalls = agentStats.reduce((sum, a) => sum + Number(a.callCount), 0);
    const totalSkillLoads = skillStats.reduce((sum, s) => sum + Number(s.loadCount), 0);
    
    res.json({
      total_sessions: sessionCount,
      total_subagent_calls: totalSubagentCalls,
      total_skill_loads: totalSkillLoads,
      unique_agents: agentStats.length,
      unique_skills: skillStats.length,
      top_agent: agentStats[0] || null,
      top_skill: skillStats[0] || null
    });
  }));

  // ---- Data Management API ----
  
  // POST /api/import-audit - trigger audit log import
  router.post('/api/import-audit', asyncHandler(async (req: Request, res: Response) => {
    const auditLogPath = req.body.path || path.join(projectRoot, '..', '..', '..', 'logs', 'agent-audit.log');
    try {
      const count = await importAuditLog(auditLogPath);
      res.json({ imported: count, path: auditLogPath });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  }));

  // ---- Frontend Static Files ----
  
  const webDir = path.join(projectRoot, '..', 'web');
  
  // Serve SPA - all non-API routes go to index.html
  router.get('/', (req: Request, res: Response) => {
    res.sendFile(path.join(webDir, 'index.html'));
  });
  
  // Serve static files from web directory
  router.use(express.static(webDir));
  
  // Fallback for SPA routing
  router.get('*', (req: Request, res: Response) => {
    if (!req.path.startsWith('/api/')) {
      res.sendFile(path.join(webDir, 'index.html'));
    } else {
      res.status(404).json({ error: 'API endpoint not found' });
    }
  });
  
  // Global error handler for async routes
  router.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error('[opencode-analyzer] Route error:', err.message);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: err.message,
      timestamp: Date.now()
    });
  });

  return router;
}

export async function startServer(preferredPort = 9876): Promise<ReturnType<typeof import('http').createServer> | null> {
  const app = express();
  const router = createRouter();
  app.use(router);
  
  return new Promise((resolve, reject) => {
    const server = app.listen(preferredPort, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : preferredPort;
      console.log(`[opencode-analyzer] Dashboard server running at http://localhost:${port}`);
      // Write the actual port to a file for discovery
      try {
        const portFile = path.join(projectRoot, '..', 'analyzer.port');
        fs.writeFileSync(portFile, String(port));
      } catch (e) {
        // Silently ignore
      }
      resolve(server);
    });
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Port in use - try next port
        const nextPort = preferredPort + 1;
        console.log(`[opencode-analyzer] Port ${preferredPort} in use, trying ${nextPort}...`);
        server.close();
        // Recursively try next port
        startServer(nextPort).then(resolve).catch(reject);
      } else {
        console.error(`[opencode-analyzer] Server error: ${err.message}`);
        // Don't reject - let OpenCode continue without the dashboard
        resolve(null);
      }
    });
  });
}
