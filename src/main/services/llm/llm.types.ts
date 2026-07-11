export interface LLMConfig {
  apiKey: string;
  apiBase: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, {
        type: string;
        description?: string;
        enum?: string[];
      }>;
      required?: string[];
    };
  };
}

export interface ToolCallResponse {
  content: string | null;
  tool_calls: ToolCall[] | null;
  success: boolean;
  error?: string;
  finishReason?: string;
}

export interface LLMResponse {
  content: string;
  success: boolean;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface JSONLLMResponse<T = unknown> {
  data: T | null;
  success: boolean;
  error?: string;
  raw?: string;
}
