export interface EventPayload {
  type?: string;
  properties?: {
    info?: Record<string, unknown>;
    part?: Record<string, unknown>;
  };
}

export interface OpenCodeEvent {
  event?: EventPayload;
}

export interface ToolExecuteInput {
  sessionID?: string;
  tool?: string;
  args?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ToolExecuteOutput {
  output?: string;
  [key: string]: unknown;
}

export interface ChatMessageInput {
  sessionID?: string;
  agent?: string;
  [key: string]: unknown;
}
