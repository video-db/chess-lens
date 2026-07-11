/**
 * LLM Service - VideoDB Proxy
 *
 * Provides LLM capabilities through VideoDB's OpenAI-compatible API proxy.
 * Uses the OpenAI SDK for cleaner API interactions.
 */

import OpenAI from 'openai';
import { logger } from '../../lib/logger';
import { pipelineLatency } from '../../lib/pipeline-latency';
import { loadAppConfig, loadRuntimeConfig } from '../../lib/config';
import { flipBoardPerspective, validateFenRanks, getPieceOnBoard } from '../../lib/chess/fen-utils';
import {
  extractLastRawBoard,
  parseAlgebraicTag,
  parsePerspectiveTag,
  parseTurnTag,
  validateAndRepairBoard,
} from '../../lib/llm/llm-fen-response';
import { parseJsonPayload } from '../../lib/llm/llm-json';
import { formatMessages, formatTools } from './llm-openai-format';
import type {
  ChatMessage,
  JSONLLMResponse,
  LLMConfig,
  LLMResponse,
  Tool,
  ToolCall,
  ToolCallResponse,
} from './llm.types';

export type {
  ChatMessage,
  JSONLLMResponse,
  LLMConfig,
  LLMResponse,
  Tool,
  ToolCall,
  ToolCallResponse,
} from './llm.types';

const log = logger.child({ module: 'llm-service' });

// Default text model for generic non-vision calls sent to the VideoDB proxy.
// Chess coaching now overrides this per call to use gpt-5.4 directly.
const PRIMARY_MODEL = 'pro';

// Model used for RTStream indexVisuals() --- passed as modelName to the SDK,
// not as a direct API call, so the full openai/ namespace is supported.
export const RTSTREAM_VISION_MODEL = 'openai/gpt-5.4';
export const GPT_54_MODEL = 'openai/gpt-5.4';

/**
 * Per-request timeouts enforced via Promise.race + setTimeout.
 * More reliable than AbortSignal on Windows/Electron.
 *
 * Vision calls (gpt-5.4): 12s --- benchmark avg ~10s
 * Coaching calls (pro):   60s --- fire-and-forget background call; engine tip
 *                               is already on screen so no user impact if slow
 */
const VISION_TIMEOUT_MS  = 30000;
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
 * Extra parameters sent on text (non-vision) chat completion requests.
 * reasoning_effort='low' asks the model to use less compute for faster responses.
 * If the proxy doesn't support it the field is silently ignored.
 *
 * NOT used for vision (FEN/turn extraction) calls --- those run at full
 * reasoning effort to maximise chessboard reading accuracy.
 */
const EXTRA_PARAMS = { reasoning_effort: 'low' } as Record<string, unknown>;
const VISION_PARAMS = {} as Record<string, unknown>;


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

    // VideoDB proxy client --- used for all LLM calls including vision.
    // The client-level timeout must be higher than the longest per-request
    // timeout we use (coaching LLM: 45 s, chat: 30 s). Per-request limits are
    // enforced by withTimeout() / Promise.race so this is just a safety net for
    // truly hung connections. Set to 90 s to cover all cases.
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.apiBase,
      timeout: 90000,  // 90s --- must exceed the longest per-request timeout (45s coaching)
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

  async chatCompletion(messages: ChatMessage[], timeoutMs?: number, modelOverride?: string): Promise<LLMResponse> {
    if (!this.config.apiKey) {
      log.error('[VideoDB] LLM API key not configured');
      return {
        content: '',
        success: false,
        error: 'API key not configured',
      };
    }

    const model = modelOverride || this.config.model;

    const startTime = Date.now();
    const messagePreview = messages[messages.length - 1]?.content?.slice(0, 100) || '';
    log.info({
      model,
      messageCount: messages.length,
      messagePreview,
    }, `[VideoDB] LLM coaching request --- ${model}`);

    // Use caller-supplied timeout, or the default COACHING_TIMEOUT_MS.
    // Pass Infinity to disable the timeout entirely (fire-and-forget coaching path).
    const effectiveTimeout = timeoutMs !== undefined ? timeoutMs : COACHING_TIMEOUT_MS;

    try {
      const apiCall = this.client.chat.completions.create({
        model,
        messages: formatMessages(messages),
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
        model,
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
          model,
          elapsedMs: elapsed,
        }, '[VideoDB] LLM API error');
        return {
          content: '',
          success: false,
          error: `API error ${error.status}: ${error.message}`,
        };
      }

      log.error({ err: error, errorMessage: errMsg, model, elapsedMs: elapsed }, '[VideoDB] LLM request error');
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
    timeoutMs?: number,
    modelOverride?: string
  ): Promise<JSONLLMResponse<T>> {
    const response = await this.chatCompletion(messages, timeoutMs, modelOverride);

    if (!response.success) {
      return {
        data: null,
        success: false,
        error: response.error,
        raw: response.content,
      };
    }

    try {
      const data = parseJsonPayload<T>(response.content, parseResponse);

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
      const formattedMessages = formatMessages(messages);
      const formattedTools = tools.length > 0 ? formatTools(tools) : undefined;

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
    maxRetries = 1,
    cycleId?: number
  ): Promise<{ fenBoard: string; perspective: 'white' | 'black'; reportedTurn: 'w' | 'b' | null; reportedLastMoveFrom: string | null; reportedLastMoveTo: string | null } | null> {
    const base64Image = imageBuffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64Image}`;

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
    let savedReportedTurn: 'w' | 'b' | null = null;
    let savedLastMoveFrom: string | null = null;
    let savedLastMoveTo:   string | null = null;

    log.info({ model: RTSTREAM_VISION_MODEL }, '[VideoDB] extractFenFromImage starting');

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await withTimeout(
          this.client.chat.completions.create({
            model: RTSTREAM_VISION_MODEL,
            messages: messages as Parameters<typeof this.client.chat.completions.create>[0]['messages'],
            max_tokens: 1024,
            stream: false,
            ...VISION_PARAMS,
          } as Parameters<typeof this.client.chat.completions.create>[0]) as Promise<OpenAI.Chat.ChatCompletion>,
          VISION_TIMEOUT_MS,
          'extractFenFromImage'
        );

        const rawText = response.choices[0]?.message?.content?.trim() || '';

        const parsedPerspective = parsePerspectiveTag(rawText);
        if (parsedPerspective) {
          savedPerspective = parsedPerspective;
        } else {
          log.warn({ attempt }, '[VideoDB] <perspective> tag missing in response; defaulting to white. Board may be silently flipped if player is Black.');
        }

        const parsedTurn = parseTurnTag(rawText);
        if (parsedTurn) {
          savedReportedTurn = parsedTurn;
          log.debug({ reportedTurn: savedReportedTurn, attempt }, '[VideoDB] <turn> tag parsed');
        }

        const parsedFrom = parseAlgebraicTag(rawText, 'last_move_from');
        const parsedTo = parseAlgebraicTag(rawText, 'last_move_to');
        if (parsedFrom && parsedTo) {
          savedLastMoveFrom = parsedFrom;
          savedLastMoveTo = parsedTo;
          log.debug({ from: parsedFrom, to: parsedTo, attempt }, '[VideoDB] <last_move_from/to> tags parsed');
        } else if (parsedFrom || parsedTo) {
          // Only one tag present; unreliable, discard both.
          log.debug({ parsedFrom, parsedTo, attempt }, '[VideoDB] Only one last_move tag found; discarding both');
        }

        const rawBoard = extractLastRawBoard(rawText);
        if (!rawBoard) {
          log.warn({ attempt }, '[VideoDB] No <raw_board> tag found in response');
          if (cycleId !== undefined) pipelineLatency.endStep(cycleId, 'fenExtract', 'no raw_board tag');
          return null;
        }

        const mathError = validateFenRanks(rawBoard);

        if (!mathError) {
          const fenBoard = savedPerspective === 'black' ? flipBoardPerspective(rawBoard) : rawBoard;
          log.info({ fenBoard, perspective: savedPerspective, reportedTurn: savedReportedTurn, lastMoveFrom: savedLastMoveFrom, lastMoveTo: savedLastMoveTo, attempt }, '[VideoDB] FEN extracted successfully');
          return { fenBoard, perspective: savedPerspective, reportedTurn: savedReportedTurn, reportedLastMoveFrom: savedLastMoveFrom, reportedLastMoveTo: savedLastMoveTo };
        }

        // Retry with an explicit recount instruction so the model corrects the
        // specific failing rank rather than guessing.
        log.warn({ attempt, mathError }, '[VideoDB] FEN math error, retrying with recount instruction');
        if (attempt < maxRetries) {
          messages.push({ role: 'assistant', content: rawText });
          messages.push({
            role: 'user',
            content:
              `Your previous <raw_board> had a mathematical FEN error: ${mathError}\n` +
              `Recount ALL 8 ranks from scratch, one by one.\n` +
              `For each rank: count every piece letter as 1 square and every digit as that many empty squares. The total must equal exactly 8.\n` +
              `Fix the specific failing rank first, then verify every other rank before outputting.\n` +
              `Correct only <raw_board> and keep <perspective> accurate. ` +
              `Output ONLY <perspective> and <raw_board>.`,
          });
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        log.error({ attempt, error: errMsg }, '[VideoDB] extractFenFromImage error');
        if (cycleId !== undefined) pipelineLatency.endStep(cycleId, 'fenExtract', errMsg.slice(0, 80));
        return null;
      }
    }

    log.warn({ maxRetries }, '[VideoDB] extractFenFromImage failed after all attempts');
    if (cycleId !== undefined) pipelineLatency.endStep(cycleId, 'fenExtract', 'all attempts failed');
    return null;
  }

  async complete(prompt: string, systemPrompt?: string, timeoutMs?: number, modelOverride?: string): Promise<LLMResponse> {
    const messages: ChatMessage[] = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    messages.push({ role: 'user', content: prompt });

    return this.chatCompletion(messages, timeoutMs, modelOverride);
  }

  async completeJSON<T = unknown>(
    prompt: string,
    systemPrompt?: string,
    timeoutMs?: number,
    modelOverride?: string
  ): Promise<JSONLLMResponse<T>> {
    const messages: ChatMessage[] = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    messages.push({ role: 'user', content: prompt });

    return this.chatCompletionJSON<T>(messages, undefined, timeoutMs, modelOverride);
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

  /**
   * Parallel FEN + turn extraction from a single screenshot.
   *
   * Fires two independent vision calls simultaneously:
   *   - FEN call  (fenPrompt):  extracts <perspective> + <raw_board>; retries once on math errors
   *     with an explicit recount instruction.
   *   - Turn call (turnPrompt): extracts <perspective> + <last_move_from> + <last_move_to> + <turn>.
   *
   * Results are merged:
   *   - fenBoard + perspective come from the FEN call.
   *   - reportedTurn + reportedLastMoveFrom/To come from the turn call.
   *   - If the FEN call fails but the turn call succeeds, perspective falls back
   *     to the turn call's perspective value.
   *
   * Returns null only when the FEN call fails entirely (no usable board).
   */
  async extractFenAndTurnFromImage(
    imageBuffer: Buffer,
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp',
    fenPrompt: string,
    turnPrompt: string,
    cycleId?: number,
    skipTurn = false,
  ): Promise<{
    fenBoard: string;
    perspective: 'white' | 'black';
    reportedTurn: 'w' | 'b' | null;
    reportedLastMoveFrom: string | null;
    reportedLastMoveTo:   string | null;
    /** True when neither the FEN call nor the turn call needed a retry.
     *  Used by ChessScreenshotService as one signal in the confidence gate. */
    noRetryNeeded: boolean;
    /** Raw LLM text response from FEN call (for debug). */
    fenRawText: string | null;
    /** Raw <raw_board> content before perspective flip (for debug). */
    fenRawBoard: string | null;
    /** Whether the FEN call needed a retry. */
    fenRetried: boolean;
    /** Whether local auto-correction was applied. */
    fenAutoFixed: boolean;
  } | null> {
    const dataUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;

    type VisionMsg = {
      role: 'user' | 'assistant';
      content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
    };


    const fenCall = async (): Promise<{
      fenBoard: string;
      perspective: 'white' | 'black';
      retried: boolean;
      /** Raw LLM text response (for debug logging). */
      rawText?: string;
      /** Raw <raw_board> content before perspective flip (for debug). */
      rawBoard?: string;
      /** Math error string if one occurred (for debug). */
      mathError?: string;
      /** True when local auto-correction was applied (for debug). */
      autoFixed?: boolean;
    } | null> => {
      const messages: VisionMsg[] = [{
        role: 'user',
        content: [
          { type: 'text',      text: fenPrompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      }];

      let savedPerspective: 'white' | 'black' = 'white';

      for (let attempt = 0; attempt <= 2; attempt++) {
        try {
          const response = await withTimeout(
            this.client.chat.completions.create({
              model: RTSTREAM_VISION_MODEL,
              messages: messages as Parameters<typeof this.client.chat.completions.create>[0]['messages'],
              max_tokens: 2048,
              temperature: 0,
              stream: false,
              ...VISION_PARAMS,
            } as Parameters<typeof this.client.chat.completions.create>[0]) as Promise<OpenAI.Chat.ChatCompletion>,
            VISION_TIMEOUT_MS,
            'extractFen (parallel)',
          );

          const rawText = response.choices[0]?.message?.content?.trim() ?? '';

          const parsedPerspective = parsePerspectiveTag(rawText);
          if (parsedPerspective) {
            savedPerspective = parsedPerspective;
          }

          const rawBoard = extractLastRawBoard(rawText);
          if (!rawBoard) {
            log.warn({ attempt }, '[VideoDB] extractFen (parallel): no <raw_board> tag');
            return null;
          }
          const mathError = validateFenRanks(rawBoard);

          if (!mathError) {
            const fenBoard = savedPerspective === 'black' ? flipBoardPerspective(rawBoard) : rawBoard;
            log.info({ fenBoard, perspective: savedPerspective, attempt }, '[VideoDB] extractFen (parallel): success');
            return { fenBoard, perspective: savedPerspective, retried: attempt > 0, rawText, rawBoard };
          }

          log.warn({ attempt, mathError, rawBoard }, '[VideoDB] extractFen (parallel): math error, retrying with recount');
          if (attempt < 2) {
            messages.push({ role: 'assistant', content: rawText });
            messages.push({
              role: 'user',
              content:
                `Your previous <raw_board> had a mathematical FEN error: ${mathError}\n` +
                `Recount ALL 8 ranks from scratch, one by one.\n` +
                `For each rank: count every piece letter as 1 square and every digit as that many empty squares. The total must equal exactly 8.\n` +
                `Fix the specific failing rank first, then verify every other rank before outputting.\n` +
                `Correct only <raw_board> and keep <perspective> accurate. ` +
                `Output ONLY <perspective> and <raw_board>.`,
            });
          }
        } catch (err) {
          log.error({ attempt, err }, '[VideoDB] extractFen (parallel): API error');
          return null;
        }
      }

      log.warn('[VideoDB] extractFen (parallel): failed after retries');

      // Local auto-correction fallback.
      const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
      const lastRawText = typeof lastAssistantMsg?.content === 'string' ? lastAssistantMsg.content : '';
      const lastRawBoard = extractLastRawBoard(lastRawText);
      if (lastRawBoard) {
        const repaired = validateAndRepairBoard(lastRawBoard);
        if (repaired) {
          const fenBoard = savedPerspective === 'black' ? flipBoardPerspective(repaired.board) : repaired.board;
          log.info(
            { rawBoard: lastRawBoard, repairedBoard: repaired.board, fenBoard, perspective: savedPerspective, autoFixed: repaired.autoFixed },
            '[VideoDB] extractFen (parallel): local auto-correction succeeded'
          );
          return {
            fenBoard,
            perspective: savedPerspective,
            retried: true,
            rawText: lastRawText,
            rawBoard: lastRawBoard,
            mathError: `Local auto-correction: ${lastRawBoard} -> ${repaired.board}`,
            autoFixed: true,
          };
        }
        log.warn('[VideoDB] extractFen (parallel): local auto-correction also failed; dropping frame');
      }

      return null;
    };

    // --- Turn call --- with move-pair validation + one retry ---
    //
    // After parsing <last_move_from> and <last_move_to> we cross-check them
    // against the FEN board produced by the parallel FEN call:
    //   - The FROM square must be empty (the piece left it).
    //   - The TO square must have a piece (the piece arrived there).
    // If the pair fails this check we retry once with an explicit correction
    // prompt so the model can self-correct origin/destination confusion.
    //
    // getPieceAt returns '' for empty, a piece letter for occupied, or null on
    // parse error --- mirroring deriveTurnFromAlgebraicMove in live-assist.service.
    const isMovePairValid = (board: string, from: string, to: string): boolean => {
      const fp = getPieceOnBoard(board, from);
      const tp = getPieceOnBoard(board, to);
      if (fp === null || tp === null) return false;
      // FROM must be empty, TO must be occupied --- or they are swapped (also acceptable)
      return (fp === '' && tp !== '') || (fp !== '' && tp === '');
    };

    const turnCall = async (fenBoardForValidation: string | null): Promise<{
      perspective:  'white' | 'black';
      reportedTurn: 'w' | 'b' | null;
      reportedLastMoveFrom: string | null;
      reportedLastMoveTo:   string | null;
      retried: boolean;
    } | null> => {
      type TurnMsg = {
        role: 'user' | 'assistant';
        content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
      };
      const messages: TurnMsg[] = [{
        role: 'user',
        content: [
          { type: 'text',      text: turnPrompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      }];

      const parseTurn = (rawText: string) => {
        const perspective = parsePerspectiveTag(rawText) ?? 'white';
        const reportedTurn = parseTurnTag(rawText);
        const from = parseAlgebraicTag(rawText, 'last_move_from');
        const to   = parseAlgebraicTag(rawText, 'last_move_to');
        return { perspective, reportedTurn, from, to };
      };

      for (let attempt = 0; attempt <= 1; attempt++) {
        try {
          const response = await withTimeout(
            this.client.chat.completions.create({
              model: RTSTREAM_VISION_MODEL,
              messages: messages as Parameters<typeof this.client.chat.completions.create>[0]['messages'],
              max_tokens: 512,
              temperature: 0,
              stream: false,
              ...VISION_PARAMS,
            } as Parameters<typeof this.client.chat.completions.create>[0]) as Promise<OpenAI.Chat.ChatCompletion>,
            VISION_TIMEOUT_MS,
            'extractTurn (parallel)',
          );

          const rawText = response.choices[0]?.message?.content?.trim() ?? '';
          const { perspective, reportedTurn, from, to } = parseTurn(rawText);

          // Validate move pair against the FEN when both squares are present
          const pairPresent = from !== null && to !== null;
          const pairValid   = pairPresent && fenBoardForValidation !== null
            ? isMovePairValid(fenBoardForValidation, from!, to!)
            : pairPresent; // no FEN available --- accept as-is

          if (pairPresent && !pairValid && attempt === 0) {
            // Squares don't match the board --- one retry with a correction prompt
            const fromPiece = fenBoardForValidation ? getPieceOnBoard(fenBoardForValidation, from!) : null;
            const toPiece   = fenBoardForValidation ? getPieceOnBoard(fenBoardForValidation, to!)   : null;
            const diagnosis = fenBoardForValidation
              ? `Square ${from} has "${fromPiece ?? '?'}" and square ${to} has "${toPiece ?? '?'}" on the board. ` +
                `The ORIGIN square must be EMPTY and the DESTINATION square must have a piece.`
              : `The square pair does not match the board.`;
            log.warn(
              { from, to, fromPiece, toPiece, attempt },
              '[VideoDB] extractTurn (parallel): move pair failed FEN validation --- retrying',
            );
            messages.push({ role: 'assistant', content: rawText });
            messages.push({
              role: 'user',
              content:
                `Your previous <last_move_from>/${to} pair is incorrect. ${diagnosis}\n` +
                `Re-examine the two highlighted squares carefully:\n` +
                `  - The ORIGIN (<last_move_from>) is the highlighted square that is NOW EMPTY --- no piece on it.\n` +
                `  - The DESTINATION (<last_move_to>) is the highlighted square that HAS A PIECE on it.\n` +
                `If you cannot clearly identify both squares, omit <last_move_from>, <last_move_to>, and <turn>.\n` +
                `Output ONLY <perspective>, <last_move_from>, <last_move_to>, and <turn>.`,
            });
            continue;
          }

          const acceptPair = pairPresent && pairValid;
          log.debug(
            { perspective, reportedTurn, from, to, pairValid: acceptPair, attempt },
            '[VideoDB] extractTurn (parallel): parsed',
          );
          return {
            perspective,
            reportedTurn,
            reportedLastMoveFrom: acceptPair ? from : null,
            reportedLastMoveTo:   acceptPair ? to   : null,
            retried: attempt > 0,
          };
        } catch (err) {
          log.error({ err }, '[VideoDB] extractTurn (parallel): API error');
          return null;
        }
      }

      // Exhausted retries --- return whatever the last turn tag said, but drop bad squares
      log.warn('[VideoDB] extractTurn (parallel): move pair still invalid after retry --- dropping squares');
      return { perspective: 'white', reportedTurn: null, reportedLastMoveFrom: null, reportedLastMoveTo: null, retried: true };
    };

    // --- Run FEN + turn calls in parallel ---
    // Both fire simultaneously. After both resolve we validate the turn move
    // pair against the FEN board. If the pair is invalid (origin not empty or
    // destination empty) we fire a single correction-only turn call with the
    // FEN context, which is now available.
    //
    // skipTurn=true: the caller has determined that the turn call is unnecessary
    // for this frame (e.g. the initial board position on the very first tick,
    // where there is no last-move highlight and the turn is always White).
    // In that case we run only the FEN call to save one full vision round-trip
    // (~10-12 s) and return null turn/move fields.
    if (cycleId !== undefined) pipelineLatency.startStep(cycleId, 'fenExtract');
    const [fenResult, turnResult] = skipTurn
      ? await Promise.all([fenCall(), Promise.resolve(null)])
      : await Promise.all([fenCall(), turnCall(null)]);
    if (cycleId !== undefined) {
      pipelineLatency.endStep(cycleId, 'fenExtract', fenResult ? undefined : 'fen failed');
    }

    if (!fenResult) {
      log.warn('[VideoDB] extractFenAndTurnFromImage: FEN call failed --- returning null');
      return null;
    }

    // If the turn call produced a square pair, validate it against the FEN.
    // If invalid, fire one more turn call with the FEN board available for
    // context in the correction prompt.
    let resolvedTurn = turnResult;
    let postMergeRetried = false;
    if (
      turnResult?.reportedLastMoveFrom != null &&
      turnResult?.reportedLastMoveTo   != null &&
      !isMovePairValid(fenResult.fenBoard, turnResult.reportedLastMoveFrom, turnResult.reportedLastMoveTo)
    ) {
      log.warn(
        { from: turnResult.reportedLastMoveFrom, to: turnResult.reportedLastMoveTo },
        '[VideoDB] extractFenAndTurnFromImage: move pair failed post-merge FEN validation --- retrying turn call with FEN context',
      );
      resolvedTurn = await turnCall(fenResult.fenBoard);
      postMergeRetried = true;
    }

    const noRetryNeeded =
      !fenResult.retried &&
      !(turnResult?.retried ?? false) &&
      !postMergeRetried;

    return {
      fenBoard:             fenResult.fenBoard,
      perspective:          fenResult.perspective,
      reportedTurn:         resolvedTurn?.reportedTurn         ?? null,
      reportedLastMoveFrom: resolvedTurn?.reportedLastMoveFrom ?? null,
      reportedLastMoveTo:   resolvedTurn?.reportedLastMoveTo   ?? null,
      noRetryNeeded,
      fenRawText:   fenResult.rawText   ?? null,
      fenRawBoard:  fenResult.rawBoard  ?? null,
      fenRetried:   fenResult.retried,
      fenAutoFixed: fenResult.autoFixed ?? false,
    };
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
