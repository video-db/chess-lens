/**
 * Conversation Metrics Calculator Service
 *
 * Real-time calculation of conversation intelligence metrics.
 * Pure statistics - no LLM required.
 *
 * Metrics calculated:
 * - Talk ratio (Me vs Them speaking time)
 * - Pace (Words per minute for "me")
 * - Questions asked by "me"
 * - Monologue detection
 * - Interruption count
 * - Average response time
 */

import { logger } from '../../lib/logger';
import type { TranscriptSegmentData } from './transcript-buffer.service';

const log = logger.child({ module: 'conversation-metrics' });

export interface ConversationMetrics {
  talkRatio: {
    me: number; // 0-1 percentage
    them: number;
  };
  pace: number; // words per minute for "me"
  questionsAsked: number; // count from "me"
  monologueDetected: boolean; // "me" speaking > 45s continuously
  longestMonologue: number; // seconds
  totalDuration: number; // total speaking time in seconds
  callDuration: number; // elapsed time since call start
  wordCount: {
    me: number;
    them: number;
  };
  segmentCount: {
    me: number;
    them: number;
  };
  averageSegmentLength: {
    me: number; // seconds
    them: number;
  };
  interruptionCount: number;
}

export interface MetricsTrend {
  current: ConversationMetrics;
  previous?: ConversationMetrics;
  talkRatioTrend: 'improving' | 'stable' | 'declining'; // improving = more balanced
  paceTrend: 'faster' | 'stable' | 'slower';
}

export class ConversationMetricsService {
  private readonly MONOLOGUE_THRESHOLD = 45; // seconds
  private readonly IDEAL_TALK_RATIO_MIN = 0.35;
  private readonly IDEAL_TALK_RATIO_MAX = 0.55;
  private previousMetrics: Map<string, ConversationMetrics> = new Map();

  constructor() {}

  /**
   * Calculate all metrics from segments
   */
  calculate(segments: TranscriptSegmentData[], elapsedTimeSeconds?: number): ConversationMetrics {
    const meSegments = segments.filter(s => s.isFinal && s.channel === 'me');
    const themSegments = segments.filter(s => s.isFinal && s.channel === 'them');

    if (meSegments.length > 0) {
      const totalWords = meSegments.reduce((sum, s) => sum + s.text.trim().split(/\s+/).filter(w => w.length > 0).length, 0);
      const totalDuration = meSegments.reduce((sum, s) => sum + (s.endTime - s.startTime), 0);
    }

    const meDuration = this.calculateDuration(meSegments);
    const themDuration = this.calculateDuration(themSegments);
    const totalDuration = meDuration + themDuration;

    const meWordCount = this.countWords(meSegments);
    const themWordCount = this.countWords(themSegments);

    // Calculate call duration from segments or use provided elapsed time
    const callDurationFromSegments = segments.length > 0
      ? Math.max(...segments.map(s => s.endTime))
      : 0;
    const callDuration = Math.max(callDurationFromSegments, elapsedTimeSeconds || 0);

    return {
      talkRatio: {
        me: totalDuration > 0 ? meDuration / totalDuration : 0.5,
        them: totalDuration > 0 ? themDuration / totalDuration : 0.5,
      },
      pace: this.calculatePace(meSegments, callDuration),
      questionsAsked: this.countQuestions(meSegments),
      monologueDetected: this.detectMonologue(meSegments),
      longestMonologue: this.findLongestMonologue(meSegments),
      totalDuration,
      callDuration,
      wordCount: {
        me: meWordCount,
        them: themWordCount,
      },
      segmentCount: {
        me: meSegments.length,
        them: themSegments.length,
      },
      averageSegmentLength: {
        me: meSegments.length > 0 ? meDuration / meSegments.length : 0,
        them: themSegments.length > 0 ? themDuration / themSegments.length : 0,
      },
      interruptionCount: this.countInterruptions(segments),
    };
  }

  /**
   * Calculate metrics with trend comparison
   */
  calculateWithTrend(sessionId: string, segments: TranscriptSegmentData[], elapsedTimeSeconds?: number): MetricsTrend {
    const current = this.calculate(segments, elapsedTimeSeconds);
    const previous = this.previousMetrics.get(sessionId);

    // Store current for next comparison
    this.previousMetrics.set(sessionId, current);

    if (!previous) {
      return {
        current,
        talkRatioTrend: 'stable',
        paceTrend: 'stable',
      };
    }

    // Calculate talk ratio trend (closer to 50/50 is "improving")
    const currentBalance = Math.abs(current.talkRatio.me - 0.5);
    const previousBalance = Math.abs(previous.talkRatio.me - 0.5);
    let talkRatioTrend: 'improving' | 'stable' | 'declining' = 'stable';

    if (currentBalance < previousBalance - 0.05) {
      talkRatioTrend = 'improving';
    } else if (currentBalance > previousBalance + 0.05) {
      talkRatioTrend = 'declining';
    }

    // Calculate pace trend
    let paceTrend: 'faster' | 'stable' | 'slower' = 'stable';
    if (current.pace > previous.pace + 10) {
      paceTrend = 'faster';
    } else if (current.pace < previous.pace - 10) {
      paceTrend = 'slower';
    }

    return {
      current,
      previous,
      talkRatioTrend,
      paceTrend,
    };
  }

  /**
   * Calculate total speaking duration
   */
  private calculateDuration(segments: TranscriptSegmentData[]): number {
    return segments.reduce((sum, s) => sum + (s.endTime - s.startTime), 0);
  }

  /**
   * Calculate words per minute
   * Uses the time span from first to last segment for accurate calculation
   */
  private calculatePace(segments: TranscriptSegmentData[], callDurationSeconds?: number): number {
    if (segments.length === 0) return 0;

    const totalWords = this.countWords(segments);
    if (totalWords === 0) return 0;

    // Calculate the time span from first to last segment
    // This represents the period over which the user was speaking
    const firstSegment = segments[0];
    const lastSegment = segments[segments.length - 1];
    const timeSpanSeconds = lastSegment.endTime - firstSegment.startTime;

    // Use the time span if it's reasonable (> 5 seconds)
    if (timeSpanSeconds > 5) {
      const timeSpanMinutes = timeSpanSeconds / 60;
      const rawWpm = Math.round(totalWords / timeSpanMinutes);

      // Clamp to realistic range (50-250 WPM)
      // Normal speech is 120-150 WPM, fast is 150-180, very fast is 180+
      return Math.min(250, Math.max(50, rawWpm));
    }

    // Fallback: use call duration if available
    if (callDurationSeconds && callDurationSeconds > 10) {
      const callMinutes = callDurationSeconds / 60;
      const rawWpm = Math.round(totalWords / callMinutes);
      return Math.min(250, Math.max(0, rawWpm));
    }

    // For very short calls, return 0 (not enough data)
    return 0;
  }

  /**
   * Count total words
   */
  private countWords(segments: TranscriptSegmentData[]): number {
    return segments.reduce((sum, s) => {
      const words = s.text.trim().split(/\s+/).filter(w => w.length > 0);
      return sum + words.length;
    }, 0);
  }

  /**
   * Count questions asked
   */
  private countQuestions(segments: TranscriptSegmentData[]): number {
    return segments.filter(s => /\?/.test(s.text)).length;
  }

  /**
   * Detect if currently in a monologue
   */
  private detectMonologue(segments: TranscriptSegmentData[]): boolean {
    if (segments.length < 3) return false;

    // Check last 5 segments
    const recent = segments.slice(-5);
    if (recent.length < 3) return false;

    const firstStart = recent[0].startTime;
    const lastEnd = recent[recent.length - 1].endTime;
    const duration = lastEnd - firstStart;

    return duration > this.MONOLOGUE_THRESHOLD;
  }

  /**
   * Find the longest continuous speaking stretch
   */
  private findLongestMonologue(segments: TranscriptSegmentData[]): number {
    if (segments.length === 0) return 0;

    let maxDuration = 0;
    let currentStreak: TranscriptSegmentData[] = [];

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];

      if (currentStreak.length === 0) {
        currentStreak.push(segment);
      } else {
        const lastSegment = currentStreak[currentStreak.length - 1];
        // Consider continuous if gap is less than 2 seconds
        if (segment.startTime - lastSegment.endTime < 2) {
          currentStreak.push(segment);
        } else {
          // End current streak, check duration
          const streakDuration =
            currentStreak[currentStreak.length - 1].endTime - currentStreak[0].startTime;
          maxDuration = Math.max(maxDuration, streakDuration);
          currentStreak = [segment];
        }
      }
    }

    // Check final streak
    if (currentStreak.length > 0) {
      const streakDuration =
        currentStreak[currentStreak.length - 1].endTime - currentStreak[0].startTime;
      maxDuration = Math.max(maxDuration, streakDuration);
    }

    return maxDuration;
  }

  /**
   * Count potential interruptions
   * (When one speaker starts before another finishes with overlap)
   */
  private countInterruptions(segments: TranscriptSegmentData[]): number {
    if (segments.length < 2) return 0;

    let interruptions = 0;
    const sortedSegments = [...segments].sort((a, b) => a.startTime - b.startTime);

    for (let i = 1; i < sortedSegments.length; i++) {
      const current = sortedSegments[i];
      const previous = sortedSegments[i - 1];

      // Different speakers and overlap
      if (
        current.channel !== previous.channel &&
        current.startTime < previous.endTime
      ) {
        interruptions++;
      }
    }

    return interruptions;
  }

  /**
   * Get a health score for the conversation (0-100)
   */
  getConversationHealthScore(metrics: ConversationMetrics): number {
    let score = 100;

    // Talk ratio penalty (ideal is 40-60%)
    const talkRatioDeviation = Math.abs(metrics.talkRatio.me - 0.5);
    score -= talkRatioDeviation * 100; // Max -50 for all one-sided

    // Monologue penalty
    if (metrics.monologueDetected) {
      score -= 15;
    }

    // Pace penalty (too fast > 180, too slow < 100)
    if (metrics.pace > 180) {
      score -= Math.min(20, (metrics.pace - 180) / 5);
    } else if (metrics.pace < 100 && metrics.pace > 0) {
      score -= Math.min(10, (100 - metrics.pace) / 5);
    }

    // Questions bonus (asking questions is good)
    if (metrics.questionsAsked > 0) {
      score += Math.min(10, metrics.questionsAsked * 2);
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Get recommendations based on metrics
   */
  getRecommendations(metrics: ConversationMetrics): string[] {
    const recommendations: string[] = [];

    if (metrics.talkRatio.me > 0.65) {
      recommendations.push('Consider letting the customer speak more');
    }

    if (metrics.talkRatio.me < 0.35) {
      recommendations.push('You may need to provide more information');
    }

    if (metrics.monologueDetected) {
      recommendations.push('Try breaking up long explanations with questions');
    }

    if (metrics.questionsAsked < 2 && metrics.callDuration > 120) {
      recommendations.push('Consider asking more discovery questions');
    }

    if (metrics.pace > 180) {
      recommendations.push('Try slowing down your speaking pace');
    }

    return recommendations;
  }

  /**
   * Clear stored data for a session
   */
  clear(sessionId: string): void {
    this.previousMetrics.delete(sessionId);
  }
}

// Singleton Instance

let instance: ConversationMetricsService | null = null;

export function getMetricsService(): ConversationMetricsService {
  if (!instance) {
    instance = new ConversationMetricsService();
  }
  return instance;
}

export function resetMetricsService(): void {
  instance = null;
}

export default ConversationMetricsService;
