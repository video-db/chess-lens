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

// Model used for direct OpenAI-compatible API calls through the VideoDB proxy.
// The proxy accepts its own model names (mini, basic, pro, ultra) for these calls.
const PRIMARY_MODEL = 'pro';

// Model used for RTStream indexVisuals() — passed as modelName to the SDK,
// not as a direct API call, so the full openai/ namespace is supported.
export const RTSTREAM_VISION_MODEL = 'openai/gpt-5.4';

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
      maxTokens: config?.maxTokens || 4096,
      temperature: config?.temperature || 0.7,
    };

    // VideoDB proxy client — used for all LLM calls including vision
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.apiBase,
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

  async chatCompletion(messages: ChatMessage[]): Promise<LLMResponse> {
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

    try {
      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: this.formatMessages(messages),
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
      });

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
    parseResponse?: (content: string) => T
  ): Promise<JSONLLMResponse<T>> {
    const response = await this.chatCompletion(messages);

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

      // Strip markdown code blocks if present
      const jsonMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonString = jsonMatch[1].trim();
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

      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: formattedMessages,
        tools: formattedTools,
        tool_choice: formattedTools ? 'auto' : undefined,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
      });

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
   * Detect the chessboard bounding box inside a full-screen screenshot.
   *
   * Sends a lightweight, single-turn vision prompt (no board analysis) that
   * asks the model to return only a JSON bounding box as fractions of the
   * image dimensions.  The result is intended to be cached by the caller
   * (ChessScreenshotService) and used to crop every subsequent screenshot
   * before the full FEN-extraction pipeline runs.
   *
   * Returns null if detection fails or the response cannot be parsed.
   */
  async detectChessBoardRegion(
    imageBuffer: Buffer
  ): Promise<{ x: number; y: number; w: number; h: number } | null> {
    const base64Image = imageBuffer.toString('base64');
    const dataUrl = `data:image/png;base64,${base64Image}`;

    const detectionPrompt =
      'Locate the chessboard in this screenshot. ' +
      'Return ONLY a single line of valid JSON with exactly four keys: ' +
      '{"x": <0-1>, "y": <0-1>, "w": <0-1>, "h": <0-1>} ' +
      'where each value is a decimal fraction of the full image dimensions ' +
      '(x and y are the top-left corner, w and h are width and height). ' +
      'No markdown, no explanation, no extra text — just the JSON object.';

    type VisionMessage = {
      role: 'user';
      content: Array<{ type: string; text?: string; image_url?: { url: string } }>;
    };
    const messages: VisionMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: detectionPrompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ];

    log.info({ model: this.config.model }, '[VideoDB] detectChessBoardRegion starting');

    try {
      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: messages as Parameters<typeof this.client.chat.completions.create>[0]['messages'],
        max_tokens: 64,
      });

      const rawText = response.choices[0]?.message?.content?.trim() || '';

      // Strip markdown code fences if the model wraps the JSON
      const jsonText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

      const parsed = JSON.parse(jsonText) as { x: unknown; y: unknown; w: unknown; h: unknown };

      const x = Number(parsed.x);
      const y = Number(parsed.y);
      const w = Number(parsed.w);
      const h = Number(parsed.h);

      if (
        [x, y, w, h].some((v) => isNaN(v) || v < 0 || v > 1) ||
        w <= 0.01 || h <= 0.01
      ) {
        log.warn({ rawText, parsed }, '[VideoDB] detectChessBoardRegion: parsed values out of range');
        return null;
      }

      log.info({ x, y, w, h }, '[VideoDB] detectChessBoardRegion succeeded');
      return { x, y, w, h };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log.warn({ error: errMsg }, '[VideoDB] detectChessBoardRegion failed');
      return null;
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
    maxRetries = 2
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

    log.info({ model: this.config.model }, '[VideoDB] extractFenFromImage starting');

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.config.model,
          messages: messages as Parameters<typeof this.client.chat.completions.create>[0]['messages'],
          max_tokens: 2048,
        });

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
