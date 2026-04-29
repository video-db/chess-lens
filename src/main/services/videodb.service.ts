// eslint-disable-next-line @typescript-eslint/no-var-requires
const videodb = require('videodb');
const { connect } = videodb;
type Connection = ReturnType<typeof connect>;

import { createChildLogger } from '../lib/logger';

const logger = createChildLogger('videodb-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Collection = any;

interface CachedConnection {
  connection: Connection;
  apiKey: string;
  /** Cached default collection object — avoids a GET /collection round-trip on every coaching call. */
  defaultCollection?: Collection;
}

let cachedConnection: CachedConnection | null = null;

export class VideoDBService {
  private apiKey: string;
  private baseUrl?: string;
  private collectionId?: string;

  constructor(apiKey: string, baseUrl?: string, collectionId?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.collectionId = collectionId;
  }

  /**
   * Set the collection ID to use for all operations
   */
  setCollectionId(collectionId: string): void {
    this.collectionId = collectionId;
  }

  /**
   * Get the collection ID being used
   */
  getCollectionId(): string | undefined {
    return this.collectionId;
  }

  private getConnection(): Connection {
    if (cachedConnection && cachedConnection.apiKey === this.apiKey) {
      return cachedConnection.connection;
    }

    logger.info('Creating new VideoDB connection');

    const connection = this.baseUrl
      ? connect({ apiKey: this.apiKey, baseUrl: this.baseUrl })
      : connect({ apiKey: this.apiKey });

    cachedConnection = {
      connection,
      apiKey: this.apiKey,
    };

    return connection;
  }

  /**
   * Get the default collection, reusing a cached instance to avoid a network
   * GET on every call. The cache is invalidated whenever the connection changes
   * (i.e. when the API key changes). A specific collectionId on this service
   * instance always forces a fresh fetch.
   */
  private async getDefaultCollection(): Promise<Collection> {
    const conn = this.getConnection();
    if (this.collectionId) {
      // Specific collection requested — always fetch fresh so callers get the
      // exact collection they asked for (no risk of returning the wrong one).
      return conn.getCollection(this.collectionId);
    }
    // Default collection: reuse cached object if the connection hasn't changed.
    if (cachedConnection && cachedConnection.defaultCollection) {
      return cachedConnection.defaultCollection;
    }
    const collection = await conn.getCollection();
    if (cachedConnection) {
      cachedConnection.defaultCollection = collection;
    }
    return collection;
  }

  async verifyApiKey(): Promise<boolean> {
    try {
      const conn = this.getConnection();
      logger.info('Attempting to verify API key by getting collection...');
      await conn.getCollection();
      logger.info('API key verified successfully');
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error({
        errorMessage,
        errorStack,
        errorType: error?.constructor?.name
      }, 'API key verification failed');
      return false;
    }
  }

  /**
   * Find or create the "chess-lens" collection for this user.
   * Returns the collection ID.
   */
  async findOrCreateCallMdCollection(): Promise<string> {
    const conn = this.getConnection();
    const COLLECTION_NAME = 'Chess Lens Recordings';

    logger.info('Looking for chess-lens collection...');

    try {
      // List all collections and find the one named "chess-lens"
      const collections = await conn.getCollections();

      for (const collection of collections) {
        if (collection.name === COLLECTION_NAME) {
          logger.info({ collectionId: collection.id }, 'Found existing chess-lens collection');
          return collection.id;
        }
      }

      // Collection not found, create it
      logger.info('chess-lens collection not found, creating...');
      const newCollection = await conn.createCollection(
        COLLECTION_NAME,
        'Chess game recordings from Chess Lens app',
        false // isPublic
      );

      logger.info({ collectionId: newCollection.id }, 'Created chess-lens collection');
      return newCollection.id;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ errorMessage }, 'Failed to find or create chess-lens collection');
      throw error;
    }
  }

  async createSessionToken(
    userId: string = 'default-user',
    expiresIn: number = 86400
  ): Promise<{
    sessionToken: string;
    expiresIn: number;
    expiresAt: number;
  }> {
    const conn = this.getConnection();

    logger.info({ userId, expiresIn }, 'Creating session token');

    // SDK signature: generateClientToken(expiresIn?: number) => Promise<string>
    const sessionToken = await conn.generateClientToken(expiresIn);

    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

    return {
      sessionToken,
      expiresIn,
      expiresAt,
    };
  }

  async createCaptureSession(params: {
    endUserId: string;
    metadata?: Record<string, unknown>;
  }): Promise<{
    sessionId: string;
    collectionId: string;
    endUserId: string;
    status: string;
  }> {
    const conn = this.getConnection();

    logger.info({ endUserId: params.endUserId, collectionId: this.collectionId }, 'Creating capture session');

    // Use the configured collection ID, or fall back to default
    const collection = await conn.getCollection(this.collectionId);

    const sessionOptions: {
      endUserId: string;
      metadata?: Record<string, unknown>;
    } = {
      endUserId: params.endUserId,
    };

    if (params.metadata) {
      sessionOptions.metadata = params.metadata;
    }

    const session = await collection.createCaptureSession(sessionOptions);

    logger.info({ sessionId: session.id, collectionId: collection.id }, 'Capture session created');

    return {
      sessionId: session.id,
      collectionId: collection.id,
      endUserId: params.endUserId,
      status: 'created',
    };
  }

  async getVideo(videoId: string) {
    const collection = await this.getDefaultCollection();
    return collection.getVideo(videoId);
  }

  async indexVideo(videoId: string): Promise<void> {
    logger.info({ videoId }, 'Indexing video for spoken words');
    const video = await this.getVideo(videoId);
    await video.indexSpokenWords();
    logger.info({ videoId }, 'Video indexed successfully');
  }

  async generateInsights(videoId: string, customPrompt?: string): Promise<string | null> {
    logger.info({ videoId, collectionId: this.collectionId }, 'Generating AI insights');
    const collection = await this.getDefaultCollection();
    const video = await this.getVideo(videoId);

    // Fetch transcript text (like Python version)
    let transcriptText: string | null = null;
    try {
      transcriptText = await video.getTranscriptText();
    } catch (error) {
      logger.warn({ error, videoId }, 'Failed to get transcript');
    }

    // Check if transcript exists (like Python version)
    if (!transcriptText || transcriptText.trim().length === 0) {
      logger.info({ videoId }, 'No transcript available, skipping insight generation');
      return null;
    }

    // Construct the full prompt with transcript (matching Python's format exactly)
    const prompt = customPrompt || `Analyze the following meeting transcript and generate a comprehensive meeting report in markdown format.

**Output Structure:**
## 📋 Meeting Summary
A brief 2-3 sentence executive summary of the meeting.

## 🎯 Key Discussion Points
- Bullet points of the main topics discussed

## 💡 Key Decisions
- Any decisions that were made during the meeting
---

Transcript:
${transcriptText}`;
    const primaryModel = 'pro';
    const fallbackModel = 'pro';
    let result: unknown;
    try {
      logger.info({ videoId, model: primaryModel }, 'Generating insights with VideoDB model');
      result = await collection.generateText(prompt, primaryModel);
    } catch (primaryError) {
      const msg = primaryError instanceof Error ? primaryError.message.toLowerCase() : String(primaryError).toLowerCase();
      const isModelUnavailable = msg.includes('not found') || msg.includes('not available') ||
        msg.includes('unsupported') || msg.includes('does not exist') || msg.includes('404');
      if (isModelUnavailable) {
        logger.warn({ videoId, primaryModel, fallbackModel }, 'Primary model unavailable, retrying with fallback model');
        result = await collection.generateText(prompt, fallbackModel);
      } else {
        throw primaryError;
      }
    }

    logger.info({ videoId }, 'Insights generated successfully');

    // Handle both string and object responses (like Python version)
    let generatedText: string;
    if (typeof result === 'string') {
      generatedText = result;
    } else {
      const resultObj = result as Record<string, unknown>;
      generatedText = (resultObj.output as string) ||
                      (resultObj.text as string) ||
                      ((resultObj.data as Record<string, unknown>)?.text as string) || '';
    }

    if (!generatedText) {
      logger.warn({ videoId }, 'Empty response from text generation SDK');
      return null;
    }

    return generatedText.trim();
  }

  async downloadVideo(videoId: string, name?: string): Promise<{ downloadUrl: string; name: string }> {
    logger.info({ videoId, name }, 'Getting video download URL');
    const video = await this.getVideo(videoId);
    logger.info({ videoId, streamUrl: video.streamUrl }, 'Got video object');

    const result = await video.download(name);
    logger.info({ videoId, result }, 'Download API response');

    return {
      downloadUrl: result.downloadUrl as string,
      name: result.name as string,
    };
  }

  /**
   * Generate text directly via VideoDB's generateText API — no video required.
   * Used for lightweight coaching/chat generation where the full video pipeline
   * isn't needed.  Accepts a plain prompt and returns the raw text output.
   *
   * @param prompt       The full prompt including any context (FEN, engine data, etc.)
   * @param modelName    'basic' | 'pro' | 'ultra' (default 'pro')
   * @param responseType 'text' | 'json' (default 'text')
   * @param timeoutMs    Hard timeout in ms (default 30s)
   */
  async generateCoachingText(
    prompt: string,
    modelName: 'basic' | 'pro' | 'ultra' = 'pro',
    responseType: 'text' | 'json' = 'text',
    timeoutMs = 30000
  ): Promise<string | null> {
    const collection = await this.getDefaultCollection();

    logger.info(
      { modelName, responseType, promptLength: prompt.length },
      'Generating coaching text via VideoDB generateText',
    );

    // Wrap entire operation in a hard timeout.
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`generateCoachingText timed out after ${timeoutMs}ms`)), timeoutMs),
    );

    try {
      const result = await Promise.race([
        collection.generateText(prompt, modelName, responseType),
        timeoutPromise,
      ]);

      logger.debug({ resultType: typeof result, resultKeys: result && typeof result === 'object' ? Object.keys(result as object) : [] }, 'generateCoachingText raw result');

      // The SDK returns different shapes depending on whether the job is sync or async:
      //
      // Sync (basic model): result is a string or { output: string } directly.
      //
      // Async (pro/ultra model): the API returns status='processing' with
      // request_type='async', causing the SDK to return the raw job envelope
      // immediately (it does NOT poll in this branch). The envelope looks like:
      //   { status: 'processing', data: { output_url: '...', ... }, request_type: 'async' }
      // In this case we must poll output_url ourselves until the job finishes.
      //
      // We detect the async case by checking for output_url in the result or its
      // data sub-object.

      const extractOutputUrl = (obj: Record<string, unknown>): string | null => {
        if (typeof obj.output_url === 'string') return obj.output_url;
        const data = obj.data as Record<string, unknown> | undefined;
        if (data && typeof data.output_url === 'string') return data.output_url;
        return null;
      };

      const pollOutputUrl = async (url: string): Promise<string | null> => {
        const POLL_INTERVAL_MS = 3000;
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

          let pollData: Record<string, unknown>;
          try {
            // Use the VideoDB SDK's own HTTP client (via a raw collection method isn't
            // available, so we call the VideoDB API URL directly using the SDK's axios
            // instance — but the easiest path is a plain fetch with the same auth header).
            const apiKey = this.apiKey;
            const res = await fetch(url, {
              headers: { 'x-access-token': apiKey },
            });
            pollData = await res.json() as Record<string, unknown>;
          } catch (fetchErr) {
            logger.warn({ fetchErr }, 'generateCoachingText: poll fetch failed, retrying');
            continue;
          }

          const status = (pollData.status as string | undefined)?.toLowerCase();
          logger.debug({ status, url }, 'generateCoachingText: poll tick');

          if (status === 'processing' || status === 'in progress') continue;

          if (pollData.success === false) {
            logger.warn({ message: pollData.message }, 'generateCoachingText: async job failed');
            return null;
          }

          // Successful response — extract the actual text output.
          // Shape: { success: true, data: { output: "..." } } or { response: { data: { output: "..." } } }
          const inner =
            (pollData.response as Record<string, unknown> | undefined)?.data as Record<string, unknown> | undefined
            ?? pollData.data as Record<string, unknown> | undefined
            ?? pollData;

          const output =
            (inner.output as string | undefined) ||
            (inner.text as string | undefined) ||
            (typeof inner === 'string' ? inner : null);

          logger.info({ outputLength: output?.length ?? 0 }, 'generateCoachingText: async job completed');
          return output ?? null;
        }

        logger.warn({ url }, 'generateCoachingText: polling timed out');
        return null;
      };

      // --- Async path: SDK returned a job envelope with output_url ---
      if (result !== null && result !== undefined && typeof result === 'object') {
        const obj = result as Record<string, unknown>;
        const outputUrl = extractOutputUrl(obj);
        if (outputUrl) {
          logger.info({ outputUrl }, 'generateCoachingText: async job detected — polling output_url');
          const polledText = await Promise.race([pollOutputUrl(outputUrl), timeoutPromise]);
          return polledText ?? null;
        }
      }

      // --- Sync path: SDK returned the result directly ---
      let text: string;
      if (typeof result === 'string') {
        text = result;
      } else if (result !== null && result !== undefined) {
        const obj = result as Record<string, unknown>;
        if ('say_this' in obj || 'ask_this' in obj) {
          text = JSON.stringify(obj);
        } else {
          const inner = (obj.output as string) ||
                        (obj.text as string) ||
                        ((obj.data as Record<string, unknown>)?.text as string) ||
                        JSON.stringify(obj);
          text = inner;
        }
      } else {
        text = '';
      }

      if (!text) {
        logger.warn({ modelName }, 'generateCoachingText: empty response');
        return null;
      }

      return typeof text === 'string' ? text.trim() : JSON.stringify(text);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ error: msg, modelName }, 'generateCoachingText failed');
      return null;
    }
  }

  static clearCache(): void {
    cachedConnection = null;
    logger.info('VideoDB connection cache cleared');
  }}

export function createVideoDBService(apiKey: string, baseUrl?: string, collectionId?: string): VideoDBService {
  return new VideoDBService(apiKey, baseUrl, collectionId);
}

/**
 * Get a VideoDBService configured from the current app + runtime config.
 * Reads apiKey from AppConfig and apiUrl + collectionId from the user record.
 * Returns null if no API key is configured.
 */
export function getVideoDBServiceFromConfig(): VideoDBService | null {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { loadAppConfig, loadRuntimeConfig } = require('../lib/config');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getUserByAccessToken } = require('../db');

  const appConfig = loadAppConfig();
  const runtimeConfig = loadRuntimeConfig();

  let apiKey = appConfig.apiKey as string | undefined;
  let collectionId: string | undefined;

  if (!apiKey && appConfig.accessToken) {
    const user = getUserByAccessToken(appConfig.accessToken);
    if (user) {
      apiKey = user.apiKey;
      collectionId = user.collectionId || undefined;
    }
  }

  if (!apiKey) return null;
  return new VideoDBService(apiKey, runtimeConfig.apiUrl, collectionId);
}
