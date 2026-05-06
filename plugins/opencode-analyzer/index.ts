// OpenCode Analyzer Plugin - AI Agent System Analytic Tool
import { initDatabase, getSessionCount } from './src/database.js';
import { startServer } from './src/routes.js';
import { handleSessionEvent, handleMessageEvent, handleMessagePartEvent, importAuditLog } from './src/collector.js';
import { log, clearLog } from './src/logger.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_LOG_PATH = path.join(__dirname, '..', '..', '..', 'logs', 'agent-audit.log');

let server: ReturnType<typeof import('http').createServer> | null = null;
let initialized = false;
let eventCounter = 0;
const lastEvents: Array<{ type: string; time: number; hasInfo: boolean }> = [];

// We'll store the client for the routes to use
let opencodeClient: any = null;

// ----- Type definitions for OpenCode plugin context -----

interface EventPayload {
  type?: string;
  properties?: {
    info?: Record<string, unknown>;
    part?: Record<string, unknown>;
  };
}

interface OpenCodeEvent {
  event?: EventPayload;
}

interface ToolExecuteInput {
  sessionID?: string;
  tool?: string;
  args?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ToolExecuteOutput {
  output?: string;
  [key: string]: unknown;
}

interface ChatMessageInput {
  sessionID?: string;
  agent?: string;
  [key: string]: unknown;
}

interface PluginHooks {
  event(input: OpenCodeEvent): Promise<void>;
  'chat.message'(input: ChatMessageInput): Promise<void>;
  'tool.execute.after'(input: ToolExecuteInput, output: ToolExecuteOutput): Promise<void>;
}

const plugin = {
  id: 'opencode-analyzer',
  server: async function(input?: any): Promise<PluginHooks> {
  clearLog();
  log('INFO', 'Plugin loading started');
  
  // Store the OpenCode client for AI-powered analysis
  if (input?.client) {
    opencodeClient = input.client;
    log('INFO', 'OpenCode client acquired for AI analysis');
  }
  
  if (!initialized) {
    initialized = true;
    
    try {
      await initDatabase();
      log('INFO', 'Database initialized');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log('ERROR', 'Database init failed: ' + message);
    }
    
    try {
      const count = await importAuditLog(AUDIT_LOG_PATH);
      log('INFO', `Imported ${count} audit log entries`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log('ERROR', 'Audit log import failed: ' + message);
    }
    
    // Background: start server
    startServer(9876).then(srv => {
      server = srv;
      log('INFO', 'Dashboard server started');
    }).catch(err => {
      const message = err instanceof Error ? err.message : String(err);
      log('ERROR', 'Server start failed: ' + message);
    });
    
    log('INFO', 'Plugin loading complete - hooks registered');
  }
  
  return {
    async event({ event }: OpenCodeEvent) {
      eventCounter++;
      if (event?.type) {
        // Store last 20 events for diagnostics
        lastEvents.push({ type: event.type, time: Date.now(), hasInfo: !!event.properties?.info });
        if (lastEvents.length > 20) lastEvents.shift();
        
        if (eventCounter <= 5 || eventCounter % 10 === 0) {
          log('INFO', `Event #${eventCounter}: type=${event.type}`);
        }
        
        try {
          switch (event.type) {
            case 'session.created':
            case 'session.updated': {
              const info = event.properties?.info as { id?: string; title?: string } | undefined;
              if (info) {
                log('INFO', `Session event: ${event.type} id=${info.id?.substring(0, 16)} title="${info.title}"`);
              }
              await handleSessionEvent(event as unknown as { properties: { info: Record<string, unknown> } });
              break;
            }
            case 'message.updated':
              await handleMessageEvent(event as unknown as { properties: { info: Record<string, unknown> } }, undefined);
              break;
            case 'message.part.updated':
              await handleMessagePartEvent(event as any);
              break;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log('ERROR', `Event handler failed for ${event.type}: ${message}`);
        }
      }
    },
    
    'chat.message': async (input: ChatMessageInput) => {
      log('INFO', `chat.message hook fired: sessionID=${input?.sessionID?.substring(0, 16)} agent=${input?.agent}`);
    },
    
    'tool.execute.after': async (input: ToolExecuteInput, output: ToolExecuteOutput) => {
      try {
        const { insertToolCall, insertSubagentCall, insertSkillLoad } = await import('./src/database.js');
        
        const sessionId = input.sessionID || '';
        const toolName = input.tool || '';
        const args = input.args || {};
        
        // Detect subagent delegation via 'task' tool
        if (toolName === 'task') {
          const subagentType = (args.subagent_type as string) || (args.agent as string) || 'unknown';
          const description = (args.description as string) || (args.prompt as string) || 'Subtask delegation';
          const promptPreview = (args.prompt as string) || description || '';
          
          await insertSubagentCall({
            session_id: sessionId,
            message_id: '',
            agent_name: subagentType,
            called_at: Date.now(),
            reason: description.substring(0, 200),
            prompt_preview: promptPreview.substring(0, 500),
            status: 'completed',
            duration_ms: 0
          });
          log('INFO', `Captured subagent call: ${subagentType} in session ${sessionId.substring(0, 16)}`);
        }
        
        // Detect skill loads via 'skill' tool
        if (toolName === 'skill') {
          const skillName = (args.name as string) || (args.skill_name as string) || 'unknown';
          
          await insertSkillLoad({
            session_id: sessionId,
            skill_name: skillName,
            loaded_at: Date.now(),
            reason: (args.description as string) || 'Skill loaded via tool call',
            context: JSON.stringify(args).substring(0, 1000)
          });
          log('INFO', `Captured skill load: ${skillName} in session ${sessionId.substring(0, 16)}`);
        }
        
        // Always record the raw tool call too
        await insertToolCall({
          session_id: sessionId,
          message_id: '',
          tool_name: toolName,
          called_at: Date.now(),
          status: 'completed',
          duration_ms: 0,
          input_summary: JSON.stringify(args).substring(0, 500),
          output_summary: (output?.output || '').substring(0, 500)
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log('ERROR', 'tool.execute.after failed: ' + message);
      }
    }
  };
  }
};

export default plugin;
export { plugin as opencodeAnalyzer };

// Export diagnostics for the health API
export function getDiagnostics() {
  return {
    initialized,
    serverRunning: !!server,
    eventCounter,
    lastEvents,
    sessionCount: -1 // getSessionCount is now async - computed lazily if needed
  };
}

export function getClient(): any {
  return opencodeClient;
}
