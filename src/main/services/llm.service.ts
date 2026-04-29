/**
 * LLM Service - VideoDB Proxy
 *
 * Provides LLM capabilities through VideoDB's OpenAI-compatible API proxy.
 * Uses the OpenAI SDK for cleaner API interactions.
 */

import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolMessageParam,
  ChatCompletionAssistantMessageParam,
} from 'openai/resources/chat/completions';
import { logger } from '../lib/logger';
import { loadAppConfig, loadRuntimeConfig } from '../lib/config';

const log = logger.child({ module: 'llm-service' });

// Coaching model — sent to the VideoDB proxy.
// 'basic' was tested but hits a hard output cap at ~16 tokens on the proxy,
// causing every JSON response to be truncated mid-object.
// 'pro' returns complete JSON responses reliably.
const PRIMARY_MODEL = 'pro';

// Model used for RTStream indexVisuals() — passed as modelName to the SDK,
// not as a direct API call, so the full openai/ namespace is supported.
export const RTSTREAM_VISION_MODEL = 'openai/gpt-5.4';

/**
 * Per-request timeouts enforced via Promise.race + setTimeout.
 * More reliable than AbortSignal on Windows/Electron.
 *
 * Vision calls (gpt-5.4): 12s — benchmark avg ~10s
 * Coaching calls (pro):   60s — fire-and-forget background call; engine tip
 *                               is already on screen so no user impact if slow
 */
const VISION_TIMEOUT_MS  = 12000;
const COACHING_TIMEOUT_MS = 60000;

/** Wraps a promise with a hard timeout. Rejects with an error if exceeded. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * Extra parameters sent to the VideoDB proxy on every chat completion request.
 * reasoning_effort='low' asks the model to use less compute for faster responses.
 * If the proxy doesn't support it the field is silently ignored.
 */
const EXTRA_PARAMS = { reasoning_effort: 'low' } as Record<string, unknown>;

/** Returns true when the error indicates the requested model is unavailable. */
function isModelUnavailableError(error: unknown): boolean {
  if (error instanceof OpenAI.APIError) {
    // 404 = model not found
    if (error.status === 404) return true;
    // Explicit model_not_found error code (e.g. VideoDB proxy returns this)
    if (error.code === 'model_not_found') return true;
    // 400 with a message indicating the model is not supported/available
    if (error.status === 400) {
      const msg = error.message.toLowerCase();
      return msg.includes('model') && (
        msg.includes('not found') ||
        msg.includes('not exist') ||
        msg.includes('not available') ||
        msg.includes('not supported') ||
        msg.includes('is not supported') ||
        msg.includes('unsupported') ||
        msg.includes('does not support')
      );
    }
  }
  return false;
}

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

export class LLMService {
  private config: LLMConfig;
  private client: OpenAI;
  private static instance: LLMService | null = null;

  constructor(config?: Partial<LLMConfig>) {
    const appConfig = loadAppConfig();
    const runtimeConfig = loadRuntimeConfig();

    this.config = {
      apiKey: config?.apiKey || appConfig.apiKey || '',
      apiBase: config?.apiBase || runtimeConfig.apiUrl || 'https://api.videodb.io',
      model: config?.model || PRIMARY_MODEL,
      maxTokens: config?.maxTokens || 800,
      temperature: config?.temperature || 0.7,
    };

    // VideoDB proxy client — used for all LLM calls including vision.
    // timeout: hard ceiling so a hung request never stalls the pipeline.
    // 10s is enough for the pro model; gpt-5.4 avg ~10s per the benchmark.
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.apiBase,
      timeout: 12000,  // 12s — slightly above benchmark avg to avoid cutting off valid responses
    });

    log.info({
      model: this.config.model,
      apiBase: this.config.apiBase,
      rtstreamVisionModel: RTSTREAM_VISION_MODEL,
    }, 'LLM Service initialized (VideoDB proxy)');
  }

  static getInstance(config?: Partial<LLMConfig>): LLMService {
    if (!LLMService.instance) {
      LLMService.instance = new LLMService(config);
    }
    return LLMService.instance;
  }

  static resetInstance(): void {
    LLMService.instance = null;
  }

  setApiKey(apiKey: string): void {
    this.config.apiKey = apiKey;
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.apiBase,
    });
  }

  /**
   * Convert our ChatMessage format to OpenAI's format
   */
  private formatMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
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

  /**
   * Convert our Tool format to OpenAI's format
   */
  private formatTools(tools: Tool[]): ChatCompletionTool[] {
    return tools.map((tool): ChatCompletionTool => ({
      type: 'function',
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters as Record<string, unknown>,
      },
    }));
  }

  async chatCompletion(messages: ChatMessage[], timeoutMs?: number): Promise<LLMResponse> {
    if (!this.config.apiKey) {
      log.error('[VideoDB] LLM API key not configured');
      return {
        content: '',
        success: false,
        error: 'API key not configured',
      };
    }

    const startTime = Date.now();
    const messagePreview = messages[messages.length - 1]?.content?.slice(0, 100) || '';
    log.info({
      model: this.config.model,
      messageCount: messages.length,
      messagePreview,
    }, `[VideoDB] LLM coaching request → ${this.config.model}`);

    // Use caller-supplied timeout, or the default COACHING_TIMEOUT_MS.
    // Pass Infinity to disable the timeout entirely (fire-and-forget coaching path).
    const effectiveTimeout = timeoutMs !== undefined ? timeoutMs : COACHING_TIMEOUT_MS;

    try {
      const apiCall = this.client.chat.completions.create({
        model: this.config.model,
        messages: this.formatMessages(messages),
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        stream: false,
        ...EXTRA_PARAMS,
      } as Parameters<typeof this.client.chat.completions.create>[0]) as Promise<OpenAI.Chat.ChatCompletion>;

      const response = effectiveTimeout === Infinity
        ? await apiCall
        : await withTimeout(apiCall, effectiveTimeout, 'chatCompletion');

      const elapsed = Date.now() - startTime;
      const content = response.choices[0]?.message?.content || '';
      const usage = response.usage;

      log.info({
        elapsedMs: elapsed,
        model: this.config.model,
        contentLength: content.length,
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
        totalTokens: usage?.total_tokens,
        finishReason: response.choices[0]?.finish_reason,
      }, '[VideoDB] LLM request completed');

      return {
        content,
        success: true,
        usage: usage ? {
          promptTokens: usage.prompt_tokens || 0,
          completionTokens: usage.completion_tokens || 0,
          totalTokens: usage.total_tokens || 0,
        } : undefined,
      };
    } catch (error) {
      const elapsed = Date.now() - startTime;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';

      if (error instanceof OpenAI.APIError) {
        log.error({
          status: error.status,
          code: error.code,
          type: error.type,
          message: error.message,
          model: this.config.model,
          elapsedMs: elapsed,
        }, '[VideoDB] LLM API error');
        return {
          content: '',
          success: false,
          error: `API error ${error.status}: ${error.message}`,
        };
      }

      log.error({ err: error, errorMessage: errMsg, model: this.config.model, elapsedMs: elapsed }, '[VideoDB] LLM request error');
      return {
        content: '',
        success: false,
        error: errMsg,
      };
    }
  }

  async chatCompletionJSON<T = unknown>(
    messages: ChatMessage[],
    parseResponse?: (content: string) => T,
    timeoutMs?: number
  ): Promise<JSONLLMResponse<T>> {
    const response = await this.chatCompletion(messages, timeoutMs);

    if (!response.success) {
      return {
        data: null,
        success: false,
        error: response.error,
        raw: response.content,
      };
    }

    try {
      let jsonString = response.content.trim();

      // 1. Strip markdown code fences if present (handles both complete and partial fences)
      const completeFenceMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (completeFenceMatch) {
        jsonString = completeFenceMatch[1].trim();
      } else {
        // Partial fence (model truncated before closing ```) — strip opening fence only
        jsonString = jsonString.replace(/^```(?:json)?\s*/i, '').trim();
      }

      // 2. Extract the JSON object by finding the outermost { } pair.
      // This handles cases where the model emits explanatory text before/after the JSON.
      const jsonStart = jsonString.indexOf('{');
      const jsonEnd   = jsonString.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        jsonString = jsonString.slice(jsonStart, jsonEnd + 1);
      }

      const data = parseResponse
        ? parseResponse(jsonString)
        : JSON.parse(jsonString) as T;

      return {
        data,
        success: true,
        raw: response.content,
      };
    } catch (parseError) {
      log.warn({ error: parseError, content: response.content }, 'Failed to parse JSON response');
      return {
        data: null,
        success: false,
        error: 'Failed to parse JSON response',
        raw: response.content,
      };
    }
  }

  /**
   * Chat completion with tool calling support
   */
  async chatCompletionWithTools(
    messages: ChatMessage[],
    tools: Tool[]
  ): Promise<ToolCallResponse> {
    if (!this.config.apiKey) {
      log.error('LLM API key not configured');
      return {
        content: null,
        tool_calls: null,
        success: false,
        error: 'API key not configured',
      };
    }

    const startTime = Date.now();

    try {
      const formattedMessages = this.formatMessages(messages);
      const formattedTools = tools.length > 0 ? this.formatTools(tools) : undefined;

      const response = await withTimeout(
        this.client.chat.completions.create({
          model: this.config.model,
          messages: formattedMessages,
          tools: formattedTools,
          tool_choice: formattedTools ? 'auto' : undefined,
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
          stream: false,
          ...EXTRA_PARAMS,
        } as Parameters<typeof this.client.chat.completions.create>[0]) as Promise<OpenAI.Chat.ChatCompletion>,
        COACHING_TIMEOUT_MS,
        'chatCompletionWithTools'
      );

      const elapsed = Date.now() - startTime;
      const message = response.choices[0]?.message;
      const finishReason = response.choices[0]?.finish_reason;

      const toolCalls: ToolCall[] | null = message?.tool_calls
        ? message.tool_calls
            .filter((tc): tc is typeof tc & { type: 'function'; function: { name: string; arguments: string } } =>
              tc.type === 'function' && 'function' in tc
            )
            .map(tc => ({
              id: tc.id,
              type: 'function' as const,
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments,
              },
            }))
        : null;

      log.info({
        elapsedMs: elapsed,
        model: this.config.model,
        hasContent: !!message?.content,
        contentPreview: message?.content?.slice(0, 100),
        toolCallCount: toolCalls?.length || 0,
        toolCallNames: toolCalls?.map(tc => tc.function.name),
        finishReason,
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
      }, '[VideoDB] LLM tool call request completed');

      return {
        content: message?.content || null,
        tool_calls: toolCalls,
        success: true,
        finishReason: finishReason || undefined,
      };
    } catch (error) {
      const elapsed = Date.now() - startTime;

      if (error instanceof OpenAI.APIError) {
        log.error({
          status: error.status,
          code: error.code,
          type: error.type,
          message: error.message,
          model: this.config.model,
          elapsedMs: elapsed,
        }, '[VideoDB] LLM tool call API error');
        return {
          content: null,
          tool_calls: null,
          success: false,
          error: `API error ${error.status}: ${error.message}`,
        };
      }

      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      log.error({ err: error, errorMessage: errMsg, model: this.config.model, elapsedMs: elapsed }, '[VideoDB] LLM tool call request error');
      return {
        content: null,
        tool_calls: null,
        success: false,
        error: errMsg,
      };
    }
  }

  /**
   * Extract a FEN string from a screenshot buffer.
   *
   * This is a direct port of the Python benchmark script's
   * `get_fen_from_model_with_retry` function.  It sends the image as a
   * base64-encoded data URL together with the chess indexing prompt and
   * applies the same math-error retry loop.
   *
   * Uses the VideoDB proxy with model openai/gpt-5.4 for vision-based FEN extraction.
   *
   * Returns an object with:
   *   - fenBoard: the board string in WHITE's perspective (for the chess engine)
   *   - perspective: the original perspective detected in the image ('white' | 'black')
   *
   * The caller can use `perspective` to reconstruct the display board (which should
   * show the position as the player actually sees it on screen).
   * Returns null on failure.
   */
  async extractFenFromImage(
    imageBuffer: Buffer,
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp',
    indexingPrompt: string,
    maxRetries = 1
  ): Promise<{ fenBoard: string; perspective: 'white' | 'black' } | null> {
    const base64Image = imageBuffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64Image}`;

    // Mirrors the Python script's message structure exactly
    type VisionMessage = {
      role: 'user' | 'assistant';
      content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
    };
    const messages: VisionMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: indexingPrompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ];

    let savedPerspective: 'white' | 'black' = 'white';

    log.info({ model: RTSTREAM_VISION_MODEL }, '[VideoDB] extractFenFromImage starting');

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await withTimeout(
          this.client.chat.completions.create({
            model: RTSTREAM_VISION_MODEL,
            messages: messages as Parameters<typeof this.client.chat.completions.create>[0]['messages'],
            max_tokens: 768,
            stream: false,
            ...EXTRA_PARAMS,
          } as Parameters<typeof this.client.chat.completions.create>[0]) as Promise<OpenAI.Chat.ChatCompletion>,
          VISION_TIMEOUT_MS,
          'extractFenFromImage'
        );

        const rawText = response.choices[0]?.message?.content?.trim() || '';

        // Parse perspective and raw_board tags (same logic as Python extract_tags)
        const perspectiveMatch = rawText.match(/<perspective>\s*(.*?)\s*<\/perspective>/is);
        if (perspectiveMatch) {
          savedPerspective = perspectiveMatch[1].toLowerCase().includes('black') ? 'black' : 'white';
        } else {
          log.warn({ attempt }, '[VideoDB] <perspective> tag missing in response — defaulting to white. Board may be silently flipped if player is Black.');
        }

        const rawBoardMatches = [...rawText.matchAll(/<raw_board>\s*(.*?)\s*<\/raw_board>/gis)];
        if (!rawBoardMatches.length) {
          log.warn({ attempt }, '[VideoDB] No <raw_board> tag found in response');
          return null;
        }

        const rawBoard = rawBoardMatches[rawBoardMatches.length - 1][1]
          .replace(/\s+/g, '').replace(/\n/g, '');

        // Validate math (same as Python validate_fen_math)
        const ranks = rawBoard.split('/');
        let mathError: string | null = null;
        if (ranks.length !== 8) {
          mathError = `Board has ${ranks.length} ranks instead of 8.`;
        } else {
          for (let i = 0; i < ranks.length; i++) {
            let squares = 0;
            for (const ch of ranks[i]) {
              if (/\d/.test(ch)) squares += parseInt(ch, 10);
              else if (/[a-zA-Z]/.test(ch)) squares += 1;
              else { mathError = `Invalid character '${ch}' in rank ${i + 1}.`; break; }
            }
            if (mathError) break;
            if (squares !== 8) {
              mathError = `Visual Row ${i + 1} ('${ranks[i]}') sums to ${squares} squares instead of 8.`;
              break;
            }
          }
        }

        if (!mathError) {
          // transform_to_fen: reverse for black perspective (white-perspective board for engine)
          let fenBoard = rawBoard;
          if (savedPerspective === 'black') {
            const rows = rawBoard.split('/');
            rows.reverse();
            fenBoard = rows.map((r) => r.split('').reverse().join('')).join('/');
          }
          log.info({ fenBoard, perspective: savedPerspective, attempt }, '[VideoDB] FEN extracted successfully');
          return { fenBoard, perspective: savedPerspective };
        }

        // Retry with the math error correction message (same as Python)
        log.warn({ attempt, mathError }, '[VideoDB] FEN math error, retrying');
        if (attempt < maxRetries) {
          messages.push({ role: 'assistant', content: rawText });
          messages.push({ role: 'user', content: `Mathematical error: ${mathError} Please correct <raw_board>.` });
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        log.error({ attempt, error: errMsg }, '[VideoDB] extractFenFromImage error');
        // Don't retry on server errors (5xx) or timeouts — they won't resolve
        // with a math-correction follow-up and just waste time.
        const status = (error as { status?: number }).status;
        if (!status || status >= 500 || errMsg.toLowerCase().includes('timeout')) {
          return null;
        }
        return null;
      }
    }

    log.warn({ maxRetries }, '[VideoDB] extractFenFromImage failed after all attempts');
    return null;
  }

  /** Always true — the VideoDB client is always available. */
  get hasLitellmClient(): boolean {
    return true;
  }

  async complete(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    const messages: ChatMessage[] = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    messages.push({ role: 'user', content: prompt });

    return this.chatCompletion(messages);
  }

  async completeJSON<T = unknown>(
    prompt: string,
    systemPrompt?: string
  ): Promise<JSONLLMResponse<T>> {
    const messages: ChatMessage[] = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    messages.push({ role: 'user', content: prompt });

    return this.chatCompletionJSON<T>(messages);
  }

  async analyze<T = unknown>(
    text: string,
    analysisPrompt: string,
    jsonSchema?: string
  ): Promise<JSONLLMResponse<T>> {
    const systemPrompt = `You are an AI assistant that analyzes text and returns structured JSON responses.
${jsonSchema ? `\nExpected JSON schema:\n${jsonSchema}` : ''}
Always respond with valid JSON only, no additional text.`;

    const userPrompt = `${analysisPrompt}

Text to analyze:
"${text}"`;

    return this.completeJSON<T>(userPrompt, systemPrompt);
  }
}

export function getLLMService(): LLMService {
  return LLMService.getInstance();
}

export function initLLMService(apiKey: string): LLMService {
  LLMService.resetInstance();
  return LLMService.getInstance({ apiKey });
}

export default LLMService;
