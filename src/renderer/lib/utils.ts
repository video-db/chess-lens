import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { getElectronAPI } from '../api/ipc';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Forward a renderer-side log entry to the main-process structured log file
 * (app-YYYY-MM-DD.log).  Entries appear under the module name
 * `renderer:<module>` alongside all other main-process log lines, making
 * renderer errors visible in user-reported logs without requiring DevTools access.
 *
 * Falls back silently to console if the IPC bridge is not yet available.
 */
export function rendererLog(
  level: 'debug' | 'info' | 'warn' | 'error',
  module: string,
  message: string,
  data?: Record<string, unknown>
): void {
  const api = getElectronAPI();
  if (api?.log) {
    api.log(level, module, message, data);
  } else {
    console[level](`[renderer:${module}]`, message, data ?? '');
  }
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

export function formatDate(date: Date | string): string {
  let dateStr = typeof date === 'string' ? date : date.toISOString();
  if (typeof date === 'string' && !date.endsWith('Z') && !date.includes('+') && !date.includes('-', 10)) {
    dateStr = date.replace(' ', 'T') + 'Z';
  }
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDurationMinutes(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  if (remainingMins === 0) {
    return `${hours} hr`;
  }
  return `${hours} hr ${remainingMins} min`;
}

export function formatRelativeTime(date: Date | string): string {
  const now = new Date();
  // SQLite datetime('now') returns UTC without timezone indicator (e.g., "2024-01-15 10:00:00")
  // JavaScript interprets strings without 'Z' as local time, causing timezone offset issues
  // Append 'Z' to indicate UTC if the string doesn't already have timezone info
  let dateStr = typeof date === 'string' ? date : date.toISOString();
  if (typeof date === 'string' && !date.endsWith('Z') && !date.includes('+') && !date.includes('-', 10)) {
    dateStr = date.replace(' ', 'T') + 'Z';
  }
  const then = new Date(dateStr);
  const diffMs = now.getTime() - then.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return diffDays === 1 ? 'Yesterday' : `${diffDays} days ago`;
  }
  if (diffHours > 0) {
    return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
  }
  if (diffMins > 0) {
    return diffMins === 1 ? '1 minute ago' : `${diffMins} minutes ago`;
  }
  return 'Just now';
}

/**
 * Unwrap markdown code block wrapper if present
 * Handles cases where AI returns content wrapped in ```markdown ... ```
 */
export function unwrapMarkdownCodeBlock(text: string): string {
  if (!text) return text;

  // Match content wrapped in ```markdown or ``` code blocks
  const codeBlockMatch = text.match(/^```(?:markdown|md)?\s*\n?([\s\S]*?)\n?```\s*$/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  return text;
}

/**
 * Strip markdown formatting from text for plain text previews
 */
export function stripMarkdown(text: string): string {
  // First unwrap any code block wrapper
  const unwrapped = unwrapMarkdownCodeBlock(text);

  return unwrapped
    // Remove headers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold/italic
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    // Remove bullet points
    .replace(/^[\s]*[-*+]\s+/gm, '')
    // Remove numbered lists
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Remove links
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`(.+?)`/g, '$1')
    // Remove emojis (common ones used in headings)
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
    // Collapse multiple newlines
    .replace(/\n{2,}/g, ' ')
    .replace(/\n/g, ' ')
    // Remove extra spaces
    .replace(/\s{2,}/g, ' ')
    .trim();
}
