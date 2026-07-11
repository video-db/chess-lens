import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions';
import type { ChatMessage, Tool } from './llm.types';

export function formatMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
  return messages.map((msg): ChatCompletionMessageParam => {
    if (msg.role === 'tool') {
      return {
        role: 'tool',
        content: msg.content || '',
        tool_call_id: msg.tool_call_id || '',
      } as ChatCompletionToolMessageParam;
    }

    if (msg.role === 'assistant' && msg.tool_calls) {
      return {
        role: 'assistant',
        content: msg.content,
        tool_calls: msg.tool_calls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        })),
      } as ChatCompletionAssistantMessageParam;
    }

    return {
      role: msg.role as 'system' | 'user' | 'assistant',
      content: msg.content || '',
    };
  });
}

export function formatTools(tools: Tool[]): ChatCompletionTool[] {
  return tools.map((tool): ChatCompletionTool => ({
    type: 'function',
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters as Record<string, unknown>,
    },
  }));
}
