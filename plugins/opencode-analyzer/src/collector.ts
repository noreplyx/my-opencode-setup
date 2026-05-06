import fs from 'fs';
import { 
  upsertSession, insertSubagentCall, insertSkillLoad, insertToolCall, 
  upsertMessage, upsertAnalysis, getSubagentCalls, getSkillLoads,
  getToolCalls, getMessages, getSessionById, saveDatabase
} from './database.js';

function truncate(str: string, maxLen: number): string {
  if (!str || str.length <= maxLen) return str || '';
  return str.substring(0, maxLen) + '...';
}

// ----- Type definitions -----

interface EventInfo {
  id?: string;
  projectID?: string;
  title?: string;
  directory?: string;
  parentID?: string | null;
  time?: { created?: number; updated?: number };
  summary?: { additions?: number; deletions?: number; files?: number };
}

interface MessageInfo {
  id: string;
  sessionID: string;
  role?: string;
  mode?: string;
  modelID?: string;
  providerID?: string;
  time?: { created?: number; completed?: number | null };
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
  cost?: number;
  finish?: string;
}

interface AgentPart {
  sessionID: string;
  messageID?: string;
  type: 'agent';
  name?: string;
  source?: { value?: string };
}

interface SubtaskPart {
  sessionID: string;
  messageID?: string;
  type: 'subtask';
  agent?: string;
  description?: string;
  prompt?: string;
}

interface ToolPartState {
  time?: { start?: number; end?: number };
  status?: string;
  input?: unknown;
  output?: string;
}

interface ToolPart {
  sessionID: string;
  messageID?: string;
  type: 'tool';
  tool?: string;
  state?: ToolPartState;
}

type MessagePart = AgentPart | SubtaskPart | ToolPart;

interface EventPayload {
  type?: string;
  properties?: {
    info?: EventInfo | MessageInfo;
    part?: MessagePart;
  };
}

interface OpenCodeEvent {
  event?: EventPayload;
}

interface ParsedAuditLine {
  timestamp: string;
  agent: string;
  task: string;
  files: string;
  status: string;
  duration: string;
}

interface AlternativeItem {
  name: string;
  reason: string;
}

interface AnalysisResult {
  session_id: string;
  analyzed_at: number;
  pros: string[];
  cons: string[];
  recommendations: string[];
  alternative_agents: AlternativeItem[];
  alternative_skills: AlternativeItem[];
  efficiency_score: number;
}

// ----- Event Handlers -----

/**
 * Handle a session.created or session.updated event from OpenCode
 */
export async function handleSessionEvent(event: EventPayload): Promise<void> {
  if (!event.properties?.info) return;
  const info = event.properties.info as EventInfo;
  
  await upsertSession({
    id: info.id || '',
    projectID: info.projectID || '',
    title: info.title || '',
    directory: info.directory || '',
    parentID: info.parentID || null,
    time: info.time || { created: Date.now(), updated: Date.now() },
    summary: info.summary || {}
  });
}

/**
 * Handle a message.updated event - extract agent, subagent calls, skill loads
 */
export async function handleMessageEvent(event: EventPayload, client: unknown): Promise<void> {
  if (!event.properties?.info) return;
  const msg = event.properties.info as MessageInfo;
  
  // Only process assistant messages with agent data
  if (msg.role !== 'assistant') return;
  if (!msg.id) return; // Guard: id is required for upsertMessage
  
  const sessionId = msg.sessionID || '';
  
  // Store the message record
  await upsertMessage({
    id: msg.id || '',
    session_id: sessionId,
    role: 'assistant',
    agent_name: msg.mode || '',
    model_id: msg.modelID || '',
    provider_id: msg.providerID || '',
    created_at: msg.time?.created || Date.now(),
    completed_at: msg.time?.completed || null,
    input_tokens: msg.tokens?.input || 0,
    output_tokens: msg.tokens?.output || 0,
    reasoning_tokens: msg.tokens?.reasoning || 0,
    cache_read: msg.tokens?.cache?.read || 0,
    cache_write: msg.tokens?.cache?.write || 0,
    cost: msg.cost || 0,
    finish_reason: msg.finish || '',
    summary: ''
  });
  
  // Try to fetch the message parts to look for AgentPart / SubtaskPart
  // This requires the OpenCode client API
  await fetchMessageParts(sessionId, msg.id, client).catch(() => {});
}

async function fetchMessageParts(sessionId: string, messageId: string, client: unknown): Promise<void> {
  if (!client) return;
  try {
    // OpenCode SDK client can be used to fetch messages
    // The client has methods like client.GET('/session/{id}/message/{messageID}')
    // But the exact API depends on the SDK version
    // For now, we'll rely on the audit log and event data
  } catch (err) {
    // Silently ignore - we'll use audit log as primary source
  }
}

/**
 * Handle message.part.updated event - captures AgentPart, SubtaskPart, skill references
 */
export async function handleMessagePartEvent(event: EventPayload): Promise<void> {
  if (!event.properties?.part) return;
  const part = event.properties.part;
  const sessionId = part.sessionID || '';
  if (!sessionId) return; // Can't store without a session
  
  if (part.type === 'agent') {
    // This is an agent part (subagent was invoked)
    const agentPart = part as AgentPart;
    await insertSubagentCall({
      session_id: sessionId,
      message_id: agentPart.messageID || '',
      agent_name: agentPart.name || 'unknown',
      called_at: Date.now(),
      reason: extractAgentReason(agentPart),
      prompt_preview: agentPart.source?.value || '',
      status: 'completed',
      duration_ms: 0
    });
  }
  
  if (part.type === 'subtask') {
    // Subtask part indicates a subagent was delegated to
    const subtaskPart = part as SubtaskPart;
    await insertSubagentCall({
      session_id: sessionId,
      message_id: subtaskPart.messageID || '',
      agent_name: subtaskPart.agent || 'unknown',
      called_at: Date.now(),
      reason: subtaskPart.description || 'Subtask delegation',
      prompt_preview: (subtaskPart.prompt || '').substring(0, 500),
      status: 'completed',
      duration_ms: 0
    });
  }
  
  if (part.type === 'tool') {
    const toolPart = part as ToolPart;
    await insertToolCall({
      session_id: sessionId,
      message_id: toolPart.messageID || '',
      tool_name: toolPart.tool || 'unknown',
      called_at: toolPart.state?.time?.start || Date.now(),
      status: toolPart.state?.status || 'completed',
      duration_ms: toolPart.state?.time?.end && toolPart.state?.time?.start 
        ? (toolPart.state.time.end - toolPart.state.time.start) 
        : 0,
      input_summary: JSON.stringify(toolPart.state?.input || {}).substring(0, 500),
      output_summary: (toolPart.state?.output || '').substring(0, 500)
    });
  }
}

function extractAgentReason(part: AgentPart): string {
  if (part.source?.value) {
    const text = part.source.value;
    // Try to extract reason from context around the agent mention
    return text.substring(0, 200);
  }
  return 'Agent delegation';
}

/**
 * Parse the audit log file to extract agent calls, skill loads
 * Format: [TIMESTAMP] AGENT=name | TASK=desc | FILES=paths | STATUS=status | DURATION=sec
 */
export async function importAuditLog(auditLogPath: string): Promise<number> {
  if (!fs.existsSync(auditLogPath)) {
    return 0;
  }
  
  const content = fs.readFileSync(auditLogPath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  let count = 0;
  
  for (const line of lines) {
    try {
      const parsed = parseAuditLogLine(line);
      if (!parsed) continue;
      
      // Check if we already have this via session_id heuristic
      // Use a pseudo session ID based on timestamp if needed
      const pseudoSessionId = `audit-${parsed.timestamp.replace(/[^\d]/g, '').substring(0, 14)}`;
      
      await insertSubagentCall({
        session_id: pseudoSessionId,
        message_id: '',
        agent_name: parsed.agent,
        called_at: new Date(parsed.timestamp).getTime() || Date.now(),
        reason: parsed.task,
        prompt_preview: `Files: ${parsed.files}`,
        status: parsed.status,
        duration_ms: parseInt(parsed.duration) * 1000 || 0
      });
      count++;
    } catch (e) {
      // Skip malformed lines
    }
  }
  
  return count;
}

function parseAuditLogLine(line: string): ParsedAuditLine | null {
  // Format: [TIMESTAMP] AGENT=name | TASK=desc | FILES=paths | STATUS=status | DURATION=sec
  // or: TIMESTAMP AGENT=name | TASK=desc ...
  
  const cleanLine = line.trim();
  
  // Extract timestamp from brackets or start of line
  let timestamp = '';
  let rest = cleanLine;
  
  const bracketMatch = cleanLine.match(/^\[([^\]]+)\]\s*(.*)/);
  if (bracketMatch) {
    timestamp = bracketMatch[1];
    rest = bracketMatch[2];
  } else {
    // Try: YYYY-MM-DD HH:MM:SS at start
    const dateMatch = cleanLine.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+(.*)/);
    if (dateMatch) {
      timestamp = dateMatch[1];
      rest = dateMatch[2];
    } else {
      return null;
    }
  }
  
  // Parse key=value pairs separated by |
  const parts = rest.split('|').map(p => p.trim());
  const data: Record<string, string> = {};
  
  for (const part of parts) {
    const eqIndex = part.indexOf('=');
    if (eqIndex > 0) {
      const key = part.substring(0, eqIndex).trim();
      const value = part.substring(eqIndex + 1).trim();
      if (key === 'AGENT') data.agent = value;
      else if (key === 'TASK') data.task = value;
      else if (key === 'FILES') data.files = value;
      else if (key === 'STATUS') data.status = value;
      else if (key === 'DURATION') data.duration = value;
    }
  }
  
  if (!data.agent) return null;
  
  return {
    timestamp,
    agent: data.agent,
    task: data.task || '',
    files: data.files || '',
    status: data.status || 'success',
    duration: data.duration || '0'
  };
}

/**
 * Analyze a session and generate pros/cons/recommendations using actual session data
 */
export async function analyzeSession(sessionId: string): Promise<AnalysisResult | null> {
  const session = await getSessionById(sessionId);
  if (!session) return null;
  
  const subagentCalls = await getSubagentCalls(sessionId);
  const skillLoads = await getSkillLoads(sessionId);
  const toolCalls = await getToolCalls(sessionId);
  const messages = await getMessages(sessionId);
  
  const pros: string[] = [];
  const cons: string[] = [];
  const recommendations: string[] = [];
  const alternativeAgents: AlternativeItem[] = [];
  const alternativeSkills: AlternativeItem[] = [];
  
  // ---- Aggregate raw metrics ----
  
  const agentNames = [...new Set(subagentCalls.map(c => c.agentName))] as string[];
  const agentCounts: Record<string, number> = {};
  const agentDurations: Record<string, number> = {};
  const agentPromptPreviews: Record<string, string[]> = {};
  subagentCalls.forEach(c => {
    agentCounts[c.agentName] = (agentCounts[c.agentName] || 0) + 1;
    agentDurations[c.agentName] = (agentDurations[c.agentName] || 0) + (c.durationMs || 0);
    if (!agentPromptPreviews[c.agentName]) agentPromptPreviews[c.agentName] = [];
    if (c.promptPreview) agentPromptPreviews[c.agentName].push(c.promptPreview);
  });
  
  const toolNames = [...new Set(toolCalls.map(t => t.toolName))] as string[];
  const toolCounts: Record<string, number> = {};
  const toolFailures: Record<string, number> = {};
  const toolInputSummaries: string[] = [];
  const toolOutputSummaries: string[] = [];
  toolCalls.forEach(t => {
    toolCounts[t.toolName] = (toolCounts[t.toolName] || 0) + 1;
    if (t.status && t.status !== 'completed') {
      toolFailures[t.toolName] = (toolFailures[t.toolName] || 0) + 1;
    }
    if (t.inputSummary && t.inputSummary !== '{}') toolInputSummaries.push(t.inputSummary);
    if (t.outputSummary) toolOutputSummaries.push(t.outputSummary);
  });
  
  const skillNames = [...new Set(skillLoads.map(s => s.skillName))] as string[];
  const skillReasons: string[] = skillLoads.map(s => s.reason).filter(Boolean);
  
  const totalTokens = (Number(session.totalInputTokens) || 0) + (Number(session.totalOutputTokens) || 0);
  const totalCost = Number(session.totalCost) || 0;
  const totalDurationMs = subagentCalls.reduce((sum, c) => sum + (c.durationMs || 0), 0);
  const totalToolDurationMs = toolCalls.reduce((sum, t) => sum + (t.durationMs || 0), 0);
  const totalToolFailures = Object.values(toolFailures).reduce((a, b) => a + b, 0);
  const filesChanged = session.filesChanged || 0;
  const msgCount = messages.length;
  
  // ---- Data-driven Pros ----
  
  // Pro: Agent delegation with actual prompt context
  if (subagentCalls.length > 0) {
    for (const agent of agentNames) {
      const count = agentCounts[agent];
      const previews = agentPromptPreviews[agent] || [];
      const dur = agentDurations[agent] || 0;
      
      // Find the most descriptive prompt preview
      const meaningfulPreviews = previews.filter(p => p && p.length > 20 && p !== 'Agent delegation');
      let promptContext = '';
      if (meaningfulPreviews.length > 0) {
        // Sort by length descending, take the best one
        meaningfulPreviews.sort((a, b) => b.length - a.length);
        promptContext = truncate(meaningfulPreviews[0].replace(/\s+/g, ' ').trim(), 80);
      }
      
      if (promptContext) {
        const durStr = dur >= 1000 ? ` (${(dur / 1000).toFixed(1)}s total)` : '';
        pros.push(`Agent '${agent}' called ${count} time${count > 1 ? 's' : ''}${durStr} — prompt: "${promptContext}"`);
      } else {
        pros.push(`Agent '${agent}' called ${count} time${count > 1 ? 's' : ''}${dur >= 1000 ? ` (${(dur / 1000).toFixed(1)}s total)` : ''}`);
      }
    }
  }
  
  // Pro: Tool usage patterns with real tool names
  if (toolNames.length > 0) {
    const toolListStr = toolNames.join(', ');
    pros.push(`Used tools: ${toolListStr} (${toolCalls.length} total call${toolCalls.length > 1 ? 's' : ''})`);
    
    // Check for effective tool combinations
    if (toolNames.includes('read') && toolNames.includes('write')) {
      pros.push('Effective read-write tool workflow — read existing code then write changes');
    }
    if (toolNames.includes('grep') || toolNames.includes('glob')) {
      pros.push('Used search tools (grep/glob) for codebase navigation');
    }
    
    // Mention actual input/output detail from tool calls
    const meaningfulInputs = toolInputSummaries.filter(s => s.length > 10);
    if (meaningfulInputs.length > 0) {
      pros.push(`Tool calls included specific inputs like "${truncate(meaningfulInputs[0].replace(/\s+/g, ' ').trim(), 60)}"`);
    }
  }
  
  // Pro: Skill loads with real reasons
  if (skillLoads.length > 0) {
    for (const skill of skillLoads) {
      const reason = skill.reason && skill.reason !== 'Not specified' && skill.reason.length > 5
        ? ` — ${truncate(skill.reason.replace(/\s+/g, ' ').trim(), 80)}`
        : '';
      pros.push(`Loaded skill '${skill.skillName}'${reason}`);
    }
  }
  
  // Pro: Cost and token awareness
  if (totalCost > 0) {
    const tokenBreakdown = Number(session.totalInputTokens) > 0 || Number(session.totalOutputTokens) > 0
      ? ` (${Number(session.totalInputTokens) || 0} in / ${Number(session.totalOutputTokens) || 0} out tokens)`
      : '';
    pros.push(`Total session cost: $${totalCost.toFixed(4)}${tokenBreakdown}`);
  } else if (totalTokens > 0) {
    pros.push(`Total token usage: ${totalTokens.toLocaleString()} (${Number(session.totalInputTokens) || 0} in / ${Number(session.totalOutputTokens) || 0} out)`);
  }
  
  // Pro: File changes
  if (filesChanged > 0) {
    const addDel = (session.added || 0) > 0 || (session.deleted || 0) > 0
      ? ` (+${session.added || 0}/-${session.deleted || 0})`
      : '';
    pros.push(`Modified ${filesChanged} file${filesChanged > 1 ? 's' : ''}${addDel}`);
  }
  
  // Pro: Conversation awareness
  if (msgCount > 0) {
    pros.push(`Conversation spanned ${msgCount} message${msgCount > 1 ? 's' : ''}`);
  }
  
  // ---- Data-driven Cons ----
  
  // Con: Similar prompts across multiple calls to same agent
  for (const [agent, count] of Object.entries(agentCounts)) {
    if (count > 3) {
      const previews = agentPromptPreviews[agent] || [];
      const similarCount = previews.filter(p => p && p.length > 0).length;
      cons.push(`Agent '${agent}' was called ${count} times${similarCount > 0 ? ` with ${similarCount} similar prompt${similarCount > 1 ? 's' : ''}` : ''} — consider batching or more comprehensive prompts`);
    }
  }
  
  // Con: No skills loaded but agents were used
  if (skillLoads.length === 0 && subagentCalls.length > 0) {
    const agentsUsed = agentNames.join(', ');
    cons.push(`No skills loaded despite ${subagentCalls.length} subagent call${subagentCalls.length > 1 ? 's' : ''} (${agentsUsed}) — skills provide critical context`);
  }
  
  // Con: High token usage with low file changes
  if (totalTokens > 50000 && filesChanged < 3) {
    cons.push(`High token consumption (${totalTokens.toLocaleString()} tokens) for only ${filesChanged} file change${filesChanged !== 1 ? 's' : ''}`);
  }
  if (totalCost > 0.05 && filesChanged === 0) {
    cons.push(`Cost of $${totalCost.toFixed(4)} incurred with no file changes — session may have been exploratory without output`);
  }
  
  // Con: Tool failures
  if (totalToolFailures > 0) {
    const failureDetails = Object.entries(toolFailures)
      .map(([tool, count]) => `'${tool}' (${count}x)`)
      .join(', ');
    cons.push(`${totalToolFailures} tool call${totalToolFailures > 1 ? 's' : ''} failed: ${failureDetails}`);
  }
  
  // Con: No tool usage
  if (toolNames.length === 0 && subagentCalls.length > 0) {
    cons.push('No tool calls recorded — agents may not be interacting with the codebase effectively');
  }
  
  // Con: Single agent type used
  if (agentNames.length === 1 && subagentCalls.length > 1) {
    const singleAgent = agentNames[0];
    const count = agentCounts[singleAgent];
    cons.push(`Only one agent type used ('${singleAgent}', ${count} call${count > 1 ? 's' : ''}) — consider using specialized agents for different task phases`);
  }
  
  // Con: Many messages but no file output
  if (msgCount > 10 && filesChanged === 0) {
    cons.push(`${msgCount} messages exchanged but no files changed — session may have been stuck in reasoning loop`);
  }
  
  // Con: No subagents used
  if (subagentCalls.length === 0) {
    cons.push('No subagent delegation detected — all work done by the main agent');
  }
  
  // ---- Data-driven Recommendations ----
  
  // Recommendation: Batch similar agent calls
  for (const [agent, count] of Object.entries(agentCounts)) {
    if (count > 3) {
      const previews = agentPromptPreviews[agent] || [];
      const distinctPreviews = [...new Set(previews.map(p => p ? p.substring(0, 40) : ''))].filter(Boolean);
      if (distinctPreviews.length <= 2 && count > 3) {
        recommendations.push(`Agent '${agent}' was called ${count}x with very similar prompts — consolidate into a single comprehensive request`);
      } else {
        recommendations.push(`Agent '${agent}' was called ${count}x — batch related tasks or use more detailed prompts to reduce round-trips`);
      }
    }
  }
  
  // Recommendation: Load relevant skills based on agent usage
  if (skillLoads.length === 0 && subagentCalls.length > 0) {
    if (agentNames.includes('implementor') || agentNames.includes('finder')) {
      alternativeSkills.push({
        name: 'code-philosophy',
        reason: `Session used '${agentNames.filter(a => a === 'implementor' || a === 'finder').join("', '")}' agent(s) but no code-philosophy skill was loaded. This skill provides clean code, SOLID principles, and best practice guidance for implementation tasks.`
      });
    }
    if (agentNames.includes('implementor') || agentNames.includes('orchestrator')) {
      alternativeSkills.push({
        name: 'backend-code-philosophy',
        reason: `Backend-related agents ('${agentNames.filter(a => a === 'implementor' || a === 'orchestrator').join("', '")}') were used without backend-code-philosophy skill for microservice readiness and scaling guidance.`
      });
    }
    if (subagentCalls.length > 3) {
      alternativeSkills.push({
        name: 'plan-brainstorm',
        reason: `${subagentCalls.length} subagent calls without any skills loaded — loading planning skills first could improve task decomposition and quality.`
      });
    }
  }
  
  // Recommendation: Add QA agent
  if (agentNames.includes('implementor') && !agentNames.includes('qa') && !agentNames.includes('quality-assurance')) {
    alternativeAgents.push({
      name: 'qa',
      reason: `Code was implemented by 'implementor' but no QA/validation agent was used. Adding 'qa' can run tests and validate changes.`
    });
    recommendations.push('Add a QA agent after implementation to validate changes automatically');
  }
  
  // Recommendation: Add finder for research
  if (toolCalls.length > 5 && !agentNames.includes('finder')) {
    alternativeAgents.push({
      name: 'finder',
      reason: `${toolCalls.length} tool calls were made directly — 'finder' agent specializes in codebase research and could reduce direct tool usage.`
    });
    recommendations.push('Consider using the finder agent for codebase research to reduce direct tool call overhead');
  }
  
  // Recommendation: Add orchestrator for complex sessions
  if (agentNames.length > 2 && !agentNames.includes('orchestrator')) {
    alternativeAgents.push({
      name: 'orchestrator',
      reason: `${agentNames.length} different agents were used without an orchestrator to coordinate them. Orchestrator can manage multi-agent workflows.`
    });
    recommendations.push(`With ${agentNames.length} agents in use, an orchestrator could coordinate the workflow more effectively`);
  }
  
  // Recommendation: General tool usage
  if (toolNames.length === 0 && subagentCalls.length > 0) {
    recommendations.push('Encourage agents to use tools (read, grep, glob, write, edit) for better codebase interaction');
  }
  
  // Recommendation: Reduce conversation length
  if (msgCount > 20 && filesChanged < 3) {
    recommendations.push(`Long conversation (${msgCount} messages) with few file changes (${filesChanged}). Consider more focused prompts to reduce token waste.`);
  }
  
  // Recommendation: Cost optimization
  if (totalCost > 0.1) {
    recommendations.push(`Session cost ($${totalCost.toFixed(4)}) is relatively high. Consider using smaller/faster models for non-critical tasks.`);
  }
  
  // Recommendation: If no agents at all
  if (subagentCalls.length === 0 && toolCalls.length > 0) {
    recommendations.push('Delegate complex tasks to specialized subagents (implementor, finder) instead of doing all work directly');
  }
  if (subagentCalls.length === 0 && toolCalls.length === 0) {
    recommendations.push('Enable subagent delegation and tool usage for more effective AI-assisted development');
  }
  
  // ---- Efficiency Score Calculation ----
  // Multi-factor score based on real metrics (0-100)
  
  let score = 50; // Baseline
  
  // Agent diversity (max +15)
  if (agentNames.length > 2) score += 15;
  else if (agentNames.length === 2) score += 10;
  else if (agentNames.length === 1) score += 3;
  
  // Skill usage (max +15)
  if (skillLoads.length > 2) score += 15;
  else if (skillLoads.length === 1) score += 8;
  else if (skillLoads.length > 0) score += 12;
  
  // Tool success rate (max +15)
  if (toolCalls.length > 0) {
    const successRate = 1 - (totalToolFailures / toolCalls.length);
    if (successRate >= 0.95) score += 15;
    else if (successRate >= 0.8) score += 10;
    else score += 5;
  }
  
  // Cost efficiency: tokens per file changed (max +15)
  if (filesChanged > 0) {
    const tokensPerFile = totalTokens / filesChanged;
    if (tokensPerFile < 5000) score += 15;
    else if (tokensPerFile < 20000) score += 10;
    else if (tokensPerFile < 50000) score += 5;
    // else 0 — too many tokens per file
  } else if (totalTokens === 0) {
    score += 5; // No data, neutral
  }
  // If no files changed but tools were used, still give partial credit
  if (filesChanged === 0 && toolCalls.length > 0) score += 5;
  if (filesChanged === 0 && subagentCalls.length > 0) score += 3;
  
  // Conversation efficiency: messages per file changed (max +10)
  if (filesChanged > 0 && msgCount > 0) {
    const msgsPerFile = msgCount / filesChanged;
    if (msgsPerFile <= 3) score += 10;
    else if (msgsPerFile <= 8) score += 6;
    else if (msgsPerFile <= 15) score += 3;
  }
  
  // Duration efficiency (max +10)
  if (totalDurationMs > 0 && filesChanged > 0) {
    const secPerFile = totalDurationMs / 1000 / filesChanged;
    if (secPerFile < 30) score += 10;
    else if (secPerFile < 120) score += 7;
    else if (secPerFile < 300) score += 4;
    else score += 2;
  } else if (totalDurationMs > 0) {
    // Duration with no files — penalize slightly
    score -= 5;
  }
  
  // Tool diversity bonus (max +5)
  if (toolNames.length >= 3) score += 5;
  else if (toolNames.length >= 2) score += 3;
  
  // Agent count bonus — high counts indicate busy session (max +5)
  if (subagentCalls.length > 10) score += 5;
  else if (subagentCalls.length > 5) score += 3;
  
  // Negative: repeated similar calls (penalty)
  for (const [agent, count] of Object.entries(agentCounts)) {
    if (count > 5) {
      const previews = agentPromptPreviews[agent] || [];
      const distinctPreviews = [...new Set(previews.map(p => p ? p.substring(0, 30) : ''))].filter(Boolean);
      if (distinctPreviews.length <= 1) {
        score -= 10; // Repeated same task repeatedly
        break;
      }
    }
  }
  
  // Negative: tool failures
  if (totalToolFailures > 0) {
    score -= Math.min(15, totalToolFailures * 5);
  }
  
  // Clamp
  score = Math.min(100, Math.max(0, Math.round(score)));
  
  const analysis: AnalysisResult = {
    session_id: sessionId,
    analyzed_at: Date.now(),
    pros,
    cons,
    recommendations,
    alternative_agents: alternativeAgents,
    alternative_skills: alternativeSkills,
    efficiency_score: score
  };
  
  await upsertAnalysis(analysis);
  return analysis;
}

function getAgentRecommendationReason(agent: string, session: unknown, calls: unknown, tools: unknown): string {
  const reasons: Record<string, string> = {
    'finder': 'Could help research codebase structure and find relevant files before implementation',
    'implementor': 'Could handle code writing tasks more efficiently',
    'qa': 'Could verify changes with testing and validation',
    'plandescriber': 'Could create detailed implementation roadmaps for complex tasks',
    'orchestrator': 'Could coordinate multiple agents for complex multi-step goals',
    'skillscribe': 'Could distill patterns into reusable skills'
  };
  return reasons[agent] || `Consider using ${agent} for specialized tasks`;
}

function getSkillRecommendationReason(skill: string, session: unknown): string {
  const reasons: Record<string, string> = {
    'code-philosophy': 'Would provide clean code and SOLID principles for implementation quality',
    'backend-code-philosophy': 'Would help if this session involves backend development',
    'frontend-code-philosophy': 'Would help if this session involves frontend development',
    'quality-assurance': 'Would improve testing and quality verification',
    'api-documentation': 'Would help document any APIs created or modified',
    'accessibility': 'Would ensure UI changes meet accessibility standards',
    'devops-cicd': 'Would help with deployment and CI/CD configuration',
    'plan-brainstorm': 'Would help in planning phases with collaborative brainstorming'
  };
  return reasons[skill] || `Consider loading ${skill} for better context`;
}
