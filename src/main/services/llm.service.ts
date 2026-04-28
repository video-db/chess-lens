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

// Coaching text primary model.
// When LiteLLM is configured it is used first; VideoDB 'pro' is the fallback.
// To switch back to VideoDB as primary, set this to 'pro' and invert the
// attempt order in chatCompletion / chatCompletionWithTools.
const PRIMARY_MODEL = 'pro';
const LITELLM_COACHING_MODEL = 'gpt-5.4';
// FEN extraction via vision: gpt-5.4 is the best model for board analysis.
// Used exclusively in extractFenFromImage(), not in chatCompletion().
// The base URL and model are read exclusively from runtime.json (litellmBaseUrl /
// litellmModel). No default URL is baked into source — the key must be set in
// runtime.json before the LiteLLM client is used.
const LITELLM_BASE_URL_DEFAULT = 'https://litellm-prod-app.jollymoss-e448bcff.centralus.azurecontainerapps.io/v1';
const LITELLM_MODEL_DEFAULT = 'gpt-5.4';

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
  private litellmClient: OpenAI | null = null;
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

    // Primary client: VideoDB proxy
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.apiBase,
    });

    // LiteLLM client — used as the PRIMARY for coaching when configured.
    // Base URL read from runtime.json (litellmBaseUrl) or falls back to the
    // default deployment URL. Only the API key is a secret — it is stored in
    // AppConfig (user data dir) and never in source code.
    const litellmKey = appConfig.litellmKey;
    if (litellmKey) {
      const litellmBaseUrl = runtimeConfig.litellmBaseUrl || LITELLM_BASE_URL_DEFAULT;
      this.litellmClient = new OpenAI({
        apiKey: litellmKey,
        baseURL: litellmBaseUrl,
      });
      log.info({ coachingModel: LITELLM_COACHING_MODEL }, '[LiteLLM] Client initialised — will be used as primary for coaching');
    }

    log.info({
      videodbModel: this.config.model,
      litellmPrimary: !!this.litellmClient,
    }, 'LLM Service initialized');
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

  setLitellmKey(litellmKey: string | null): void {
    const runtimeConfig = loadRuntimeConfig();
    const litellmBaseUrl = runtimeConfig.litellmBaseUrl || LITELLM_BASE_URL_DEFAULT;
    if (litellmKey) {
      this.litellmClient = new OpenAI({
        apiKey: litellmKey,
        baseURL: litellmBaseUrl,
      });
      log.info({ coachingModel: LITELLM_COACHING_MODEL }, '[LiteLLM] Client updated — primary for coaching');
    } else {
      this.litellmClient = null;
      log.info('[LiteLLM] Client cleared — VideoDB will be used for coaching');
    }
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
    const effectivePrimary = this.litellmClient ? `[LiteLLM] ${loadRuntimeConfig().litellmModel || LITELLM_COACHING_MODEL}` : `[VideoDB] ${this.config.model}`;
    log.info({
      primaryClient: this.litellmClient ? 'LiteLLM' : 'VideoDB',
      model: this.litellmClient ? (loadRuntimeConfig().litellmModel || LITELLM_COACHING_MODEL) : this.config.model,
      messageCount: messages.length,
      messagePreview,
    }, `LLM coaching request → ${effectivePrimary}`);

    const attemptWithModel = async (client: OpenAI, model: string): Promise<LLMResponse> => {
      const label = client === this.client ? '[VideoDB]' : '[LiteLLM]';
      try {
        const response = await client.chat.completions.create({
          model,
          messages: this.formatMessages(messages),
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
        });

        const elapsed = Date.now() - startTime;
        const content = response.choices[0]?.message?.content || '';
        const usage = response.usage;

        log.info({
          elapsedMs: elapsed,
          model,
          contentLength: content.length,
          promptTokens: usage?.prompt_tokens,
          completionTokens: usage?.completion_tokens,
          totalTokens: usage?.total_tokens,
          finishReason: response.choices[0]?.finish_reason,
        }, `${label} LLM request completed`);

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
            model,
            elapsedMs: elapsed,
          }, `${label} LLM API error`);
          return {
            content: '',
            success: false,
            error: `API error ${error.status}: ${error.message}`,
            _isModelUnavailable: isModelUnavailableError(error),
          } as LLMResponse & { _isModelUnavailable?: boolean };
        }

        log.error({ err: error, errorMessage: errMsg, model, elapsedMs: elapsed }, `${label} LLM request error`);
        return {
          content: '',
          success: false,
          error: errMsg,
        };
      }
    };

    // Attempt 1: LiteLLM primary (gpt-5.4) when configured
    if (this.litellmClient) {
      const litellmModel = loadRuntimeConfig().litellmModel || LITELLM_COACHING_MODEL;
      const litellmResult = await attemptWithModel(this.litellmClient, litellmModel) as LLMResponse & { _isModelUnavailable?: boolean };
      if (litellmResult.success) {
        delete (litellmResult as unknown as Record<string, unknown>)._isModelUnavailable;
        return litellmResult;
      }
      log.warn({ litellmModel, videodbModel: this.config.model }, '[LiteLLM] Primary failed, falling back to [VideoDB]');
    }

    // Attempt 2 (or sole attempt when no LiteLLM): VideoDB 'pro'
    const primaryResult = await attemptWithModel(this.client, this.config.model) as LLMResponse & { _isModelUnavailable?: boolean };
    delete (primaryResult as unknown as Record<string, unknown>)._isModelUnavailable;
    return primaryResult;
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

    const attemptWithModel = async (client: OpenAI, model: string): Promise<ToolCallResponse & { _isModelUnavailable?: boolean }> => {
      const label = client === this.client ? '[VideoDB]' : '[LiteLLM]';
      try {
        const formattedMessages = this.formatMessages(messages);
        const formattedTools = tools.length > 0 ? this.formatTools(tools) : undefined;

        const response = await client.chat.completions.create({
          model,
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
          model,
          hasContent: !!message?.content,
          contentPreview: message?.content?.slice(0, 100),
          toolCallCount: toolCalls?.length || 0,
          toolCallNames: toolCalls?.map(tc => tc.function.name),
          finishReason,
          promptTokens: response.usage?.prompt_tokens,
          completionTokens: response.usage?.completion_tokens,
        }, `${label} LLM tool call request completed`);

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
            model,
            elapsedMs: elapsed,
          }, `${label} LLM tool call API error`);
          return {
            content: null,
            tool_calls: null,
            success: false,
            error: `API error ${error.status}: ${error.message}`,
            _isModelUnavailable: isModelUnavailableError(error),
          };
        }

        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        log.error({ err: error, errorMessage: errMsg, model, elapsedMs: elapsed }, `${label} LLM tool call request error`);
        return {
          content: null,
          tool_calls: null,
          success: false,
          error: errMsg,
        };
      }
    };

    // Attempt 1: LiteLLM primary when configured
    if (this.litellmClient) {
      const litellmModel = loadRuntimeConfig().litellmModel || LITELLM_COACHING_MODEL;
      const litellmResult = await attemptWithModel(this.litellmClient, litellmModel);
      if (litellmResult.success) {
        delete (litellmResult as unknown as Record<string, unknown>)._isModelUnavailable;
        return litellmResult;
      }
      log.warn({ litellmModel, videodbModel: this.config.model }, '[LiteLLM] Primary failed, falling back to [VideoDB]');
    }

    // Attempt 2 (or sole attempt when no LiteLLM): VideoDB 'pro'
    const primaryResult = await attemptWithModel(this.client, this.config.model);
    delete (primaryResult as unknown as Record<string, unknown>)._isModelUnavailable;
    return primaryResult;
  }

  /**
   * Extract a FEN string from a screenshot buffer.
   *
   * This is a direct port of the Python benchmark script's
   * `get_fen_from_model_with_retry` function.  It sends the image as a
   * base64-encoded data URL together with the chess indexing prompt and
   * applies the same math-error retry loop.
   *
   * Priority:
   *   1. LiteLLM client  (gpt-5.4)         — when litellmKey is configured
   *   2. VideoDB client  (openai/gpt-5.4)   — as fallback
   *
   * Returns the FEN board string (without metadata fields) or null on failure.
   */
  async extractFenFromImage(
    imageBuffer: Buffer,
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp',
    indexingPrompt: string,
    maxRetries = 2
  ): Promise<string | null> {
    const runtimeConfig = loadRuntimeConfig();
    const litellmModel = runtimeConfig.litellmModel || LITELLM_MODEL_DEFAULT;

    // Choose client: prefer LiteLLM because gpt-5.4 is the best FEN-detection model.
    // Fall back to VideoDB proxy if no LiteLLM key is available.
    const client = this.litellmClient ?? this.client;
    const model = this.litellmClient ? litellmModel : this.config.model;
    const label = this.litellmClient ? '[LiteLLM]' : '[VideoDB]';

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

    log.info({ model, label }, `${label} extractFenFromImage starting`);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await client.chat.completions.create({
          model,
          messages: messages as Parameters<typeof client.chat.completions.create>[0]['messages'],
          max_tokens: 1024,
        });

        const rawText = response.choices[0]?.message?.content?.trim() || '';

        // Parse perspective and raw_board tags (same logic as Python extract_tags)
        const perspectiveMatch = rawText.match(/<perspective>\s*(.*?)\s*<\/perspective>/is);
        if (perspectiveMatch) {
          savedPerspective = perspectiveMatch[1].toLowerCase().includes('black') ? 'black' : 'white';
        }

        const rawBoardMatches = [...rawText.matchAll(/<raw_board>\s*(.*?)\s*<\/raw_board>/gis)];
        if (!rawBoardMatches.length) {
          log.warn({ attempt, label }, `${label} No <raw_board> tag found in response`);
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
          // transform_to_fen: reverse for black perspective
          let fenBoard = rawBoard;
          if (savedPerspective === 'black') {
            const rows = rawBoard.split('/');
            rows.reverse();
            fenBoard = rows.map((r) => r.split('').reverse().join('')).join('/');
          }
          log.info({ model, label, fenBoard, attempt }, `${label} FEN extracted successfully`);
          return fenBoard;
        }

        // Retry with the math error correction message (same as Python)
        log.warn({ attempt, mathError, label }, `${label} FEN math error, retrying`);
        if (attempt < maxRetries) {
          messages.push({ role: 'assistant', content: rawText });
          messages.push({ role: 'user', content: `Mathematical error: ${mathError} Please correct <raw_board>.` });
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        log.error({ attempt, error: errMsg, model, label }, `${label} extractFenFromImage error`);
        return null;
      }
    }

    log.warn({ model, label, maxRetries }, `${label} extractFenFromImage failed after ${maxRetries + 1} attempts`);
    return null;
  }

  /** Whether a LiteLLM client is configured (useful for callers to decide call path). */
  get hasLitellmClient(): boolean {
    return !!this.litellmClient;
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
