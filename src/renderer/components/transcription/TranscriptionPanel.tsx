/**
 * Transcription Panel Component
 *
 * Modern chat-like interface for live transcription:
 * - Avatar indicators (Me/Them)
 * - Timestamp badges
 * - Styled message bubbles
 * - Auto-scroll to latest
 */

import React, { useEffect, useRef } from 'react';
import { Mic, Volume2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { ScrollArea } from '../ui/scroll-area';
import { Switch } from '../ui/switch';
import { Badge } from '../ui/badge';
import { useTranscriptionStore, TranscriptItem } from '../../stores/transcription.store';
import { useSessionStore } from '../../stores/session.store';
import { cn } from '../../lib/utils';

interface TranscriptMessageProps {
  item: TranscriptItem;
  isLive?: boolean;
}

function TranscriptMessage({ item, isLive }: TranscriptMessageProps) {
  const isMe = item.source === 'mic';

  // Format timestamp from epoch to MM:SS relative to recording start
  const formatTime = (timestamp: number) => {
    // For now, just show time since we don't have recording start time here
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div
      className={cn(
        'animate-in slide-in-from-bottom-2 duration-300',
        isLive && 'opacity-90'
      )}
    >
      <div className="flex gap-3">
        {/* Avatar */}
        <div
          className={cn(
            'w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 mt-1',
            isMe
              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
              : 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300'
          )}
        >
          {isMe ? (
            <Mic className="w-4 h-4" />
          ) : (
            <Volume2 className="w-4 h-4" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 max-w-3xl">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={cn(
                'text-xs font-medium',
                isMe ? 'text-blue-600 dark:text-blue-400' : 'text-purple-600 dark:text-purple-400'
              )}
            >
              {isMe ? 'You' : 'Them'}
            </span>
            <span className="text-xs text-slate-400">{formatTime(item.timestamp)}</span>
            {isLive && (
              <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4">
                LIVE
              </Badge>
            )}
          </div>

          <div
            className={cn(
              'rounded-2xl px-4 py-3 text-sm leading-relaxed',
              isMe
                ? 'bg-blue-50 dark:bg-blue-950/30 text-slate-900 dark:text-slate-100'
                : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100',
              isLive && 'italic opacity-80'
            )}
          >
            {item.text}
          </div>
        </div>
      </div>
    </div>
  );
}

function PendingMessage({ text, source }: { text: string; source: 'mic' | 'system_audio' }) {
  const isMe = source === 'mic';

  return (
    <div className="flex gap-3 opacity-60">
      <div
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 mt-1',
          isMe
            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
            : 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300'
        )}
      >
        {isMe ? <Mic className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
      </div>
      <div className="flex-1 max-w-3xl">
        <div className="flex items-center gap-2 mb-1">
          <span
            className={cn(
              'text-xs font-medium',
              isMe ? 'text-blue-600 dark:text-blue-400' : 'text-purple-600 dark:text-purple-400'
            )}
          >
            {isMe ? 'You' : 'Customer'}
          </span>
          <Badge variant="outline" className="text-xs px-1.5 py-0 h-4 animate-pulse">
            Speaking...
          </Badge>
        </div>
        <div
          className={cn(
            'rounded-2xl px-4 py-3 text-sm leading-relaxed italic',
            isMe
              ? 'bg-blue-50/50 dark:bg-blue-950/20'
              : 'bg-slate-50 dark:bg-slate-800/50 border border-slate-200/50 dark:border-slate-700/50'
          )}
        >
          {text}
        </div>
      </div>
    </div>
  );
}

export function TranscriptionPanel() {
  const { items, enabled, pendingMic, pendingSystemAudio, setEnabled } = useTranscriptionStore();
  const { status } = useSessionStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  const isRecording = status === 'recording';

  // Auto-scroll to bottom when new items arrive
  useEffect(() => {
    if (scrollRef.current) {
      const scrollElement = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }
    }
  }, [items, pendingMic, pendingSystemAudio]);

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-3 flex-shrink-0 border-b">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold">Live Transcription</CardTitle>
            <p className="text-xs text-slate-500 mt-0.5">Real-time conversation feed</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {enabled ? 'Enabled' : 'Disabled'}
            </span>
            <Switch checked={enabled} onCheckedChange={setEnabled} disabled={isRecording} />
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-hidden p-0">
        <ScrollArea className="h-full" ref={scrollRef}>
          <div className="p-6 space-y-4">
            {items.length === 0 && !pendingMic && !pendingSystemAudio ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                  <Mic className="w-8 h-8 text-slate-400" />
                </div>
                <p className="text-slate-500 dark:text-slate-400 font-medium">
                  {enabled
                    ? isRecording
                      ? 'Waiting for speech...'
                      : 'Start recording to see transcription'
                    : 'Enable transcription to see live text'}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {enabled && !isRecording && 'Click the Start Recording button above'}
                </p>
              </div>
            ) : (
              <>
                {items.map((item) => (
                  <TranscriptMessage
                    key={item.id}
                    item={item}
                  />
                ))}

                {/* Pending transcripts */}
                {pendingMic && <PendingMessage text={pendingMic} source="mic" />}
                {pendingSystemAudio && <PendingMessage text={pendingSystemAudio} source="system_audio" />}
              </>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

export default TranscriptionPanel;
