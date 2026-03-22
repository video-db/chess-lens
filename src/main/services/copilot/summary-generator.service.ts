/**
 * Summary Generator Service
 *
 * Generates a clean, high-quality meeting summary using a single LLM call.
 * Outputs a well-formatted markdown summary with action items.
 */

import { logger } from '../../lib/logger';
import { getLLMService } from '../llm.service';
import type { TranscriptSegmentData } from './transcript-buffer.service';
import type { ConversationMetrics } from './conversation-metrics.service';

const log = logger.child({ module: 'summary-generator' });

// Types

export interface CallSummary {
  /** The complete meeting summary as markdown text */
  summary: string;
  /** When the summary was generated */
  generatedAt: number;
}

export interface FullCallReport {
  summary: CallSummary;
  metrics?: ConversationMetrics;
  callDuration: number;
  segmentCount: number;
}

// Summary Generator Service

export class SummaryGeneratorService {
  constructor() {}

  /**
   * Generate a comprehensive meeting summary
   */
  async generate(segments: TranscriptSegmentData[]): Promise<CallSummary> {
    const finalSegments = segments.filter(s => s.isFinal);

    if (finalSegments.length === 0) {
      return this.emptyResults();
    }

    log.info({ segmentCount: finalSegments.length }, 'Generating meeting summary');

    const transcript = this.formatTranscript(finalSegments);
    const duration = this.calculateDuration(finalSegments);
    const llm = getLLMService();

    const prompt = `You are an expert meeting note-taker. Generate a comprehensive, well-organized meeting summary from the following transcript.

MEETING DURATION: ${this.formatDuration(duration)}

TRANSCRIPT:
${transcript}

---

Generate a professional meeting summary in markdown format. The summary should be:
- Clear and concise
- Well-organized with proper headings
- Actionable with specific to-dos

Use this structure:

## Meeting Summary

A 2-3 sentence overview of what this meeting was about and the main outcome.

## Key Discussion Points

- Bullet points of the main topics discussed
- Include important details and context
- Note any significant points raised by participants

## Decisions Made

- List any decisions that were reached
- Include the reasoning if discussed
- Skip this section if no clear decisions were made

## Action Items

- [ ] Specific task - Owner (if mentioned)
- [ ] Another task - Owner
- List all commitments and follow-ups mentioned
- Include deadlines if specified

## Notes

- Any other important information
- Open questions or items needing follow-up
- Skip this section if nothing additional to note

---

Important:
- Write in a professional but conversational tone
- Be specific - use names, dates, and details from the transcript
- Focus on what's actionable and important
- Don't include filler or obvious statements
- If something wasn't discussed, don't make it up`;

    try {
      const response = await llm.complete(
        prompt,
        'You are a professional meeting summarizer. Generate clear, actionable meeting notes.'
      );

      if (response.success && response.content) {
        log.info('Meeting summary generated successfully');
        return {
          summary: response.content.trim(),
          generatedAt: Date.now(),
        };
      }
    } catch (error) {
      log.error({ error }, 'Summary generation failed');
    }

    // Fallback: generate a basic summary
    return this.generateFallbackSummary(finalSegments);
  }

  /**
   * Generate a quick summary (for shorter meetings or quick review)
   */
  async generateQuick(segments: TranscriptSegmentData[]): Promise<CallSummary> {
    const finalSegments = segments.filter(s => s.isFinal);

    if (finalSegments.length === 0) {
      return this.emptyResults();
    }

    const transcript = this.formatTranscript(finalSegments);
    const llm = getLLMService();

    const prompt = `Summarize this meeting in a brief format:

${transcript}

Generate a quick summary with:
1. One sentence overview
2. 3-5 key points as bullets
3. Action items as a checklist

Keep it concise and actionable.`;

    try {
      const response = await llm.complete(
        prompt,
        'You are a meeting summarizer. Be brief and actionable.'
      );

      if (response.success && response.content) {
        return {
          summary: response.content.trim(),
          generatedAt: Date.now(),
        };
      }
    } catch (error) {
      log.warn({ error }, 'Quick summary generation failed');
    }

    return this.emptyResults();
  }

  /**
   * Format transcript for the LLM
   */
  private formatTranscript(segments: TranscriptSegmentData[]): string {
    return segments
      .map(s => {
        const speaker = s.channel === 'me' ? 'You' : 'Them';
        const time = this.formatTime(s.startTime);
        return `[${time}] ${speaker}: ${s.text}`;
      })
      .join('\n');
  }

  /**
   * Calculate meeting duration from segments
   */
  private calculateDuration(segments: TranscriptSegmentData[]): number {
    if (segments.length === 0) return 0;
    const firstTime = segments[0].startTime;
    const lastTime = segments[segments.length - 1].endTime;
    return lastTime - firstTime;
  }

  /**
   * Format duration as human readable
   */
  private formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    if (mins === 0) return `${secs} seconds`;
    if (secs === 0) return `${mins} minute${mins > 1 ? 's' : ''}`;
    return `${mins} minute${mins > 1 ? 's' : ''} ${secs} second${secs > 1 ? 's' : ''}`;
  }

  /**
   * Format time as MM:SS
   */
  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Generate fallback summary if LLM fails
   */
  private generateFallbackSummary(segments: TranscriptSegmentData[]): CallSummary {
    const duration = this.calculateDuration(segments);
    const mySegments = segments.filter(s => s.channel === 'me');
    const theirSegments = segments.filter(s => s.channel === 'them');

    const summary = `## Meeting Summary

This meeting lasted ${this.formatDuration(duration)} with ${segments.length} exchanges.

## Transcript Overview

- You spoke ${mySegments.length} times
- They spoke ${theirSegments.length} times

## Notes

The full summary could not be generated. Please review the transcript directly.`;

    return {
      summary,
      generatedAt: Date.now(),
    };
  }

  /**
   * Return empty results
   */
  private emptyResults(): CallSummary {
    return {
      summary: '## Meeting Summary\n\nNo transcript available to summarize.',
      generatedAt: Date.now(),
    };
  }
}

// Singleton Instance

let instance: SummaryGeneratorService | null = null;

export function getSummaryGenerator(): SummaryGeneratorService {
  if (!instance) {
    instance = new SummaryGeneratorService();
  }
  return instance;
}

export function resetSummaryGenerator(): void {
  instance = null;
}

export default SummaryGeneratorService;
