// eslint-disable-next-line @typescript-eslint/no-var-requires
const videodb = require('videodb');
const { connect } = videodb;
type Connection = ReturnType<typeof connect>;

import { createChildLogger } from '../lib/logger';

const logger = createChildLogger('videodb-service');

interface CachedConnection {
  connection: Connection;
  apiKey: string;
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
    const conn = this.getConnection();
    const collection = await conn.getCollection(this.collectionId);
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
    const conn = this.getConnection();
    const collection = await conn.getCollection(this.collectionId);
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
    const conn = this.getConnection();
    const collection = await conn.getCollection(this.collectionId);

    logger.info(
      { modelName, responseType, promptLength: prompt.length },
      'Generating coaching text via VideoDB generateText',
    );

    // Wrap in Promise.race for a hard timeout — generateText has no built-in timeout.
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`generateCoachingText timed out after ${timeoutMs}ms`)), timeoutMs),
    );

    try {
      const result = await Promise.race([
        collection.generateText(prompt, modelName, responseType),
        timeoutPromise,
      ]);

      // generateText returns:
      // - responseType='text': a string (or object with output/text field)
      // - responseType='json': an already-parsed object (NOT a string)
      // We always return a string so the caller can parse it consistently.
      let text: string;
      if (typeof result === 'string') {
        text = result;
      } else if (result !== null && result !== undefined) {
        // Object — either the JSON result (responseType='json') or a wrapper
        const obj = result as Record<string, unknown>;
        // If it looks like the coaching JSON directly, stringify it
        if ('say_this' in obj || 'ask_this' in obj) {
          text = JSON.stringify(obj);
        } else {
          // Wrapper object with an output/text field
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
  }
}

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
