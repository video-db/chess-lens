/**
 * Move History Panel Component
 *
 * Shows coaching tips and analysis delivered during recording.
 * Raw FEN / board-mapping entries from the screenshot pipeline are
 * filtered out — only human-readable coaching text is displayed.
 */

import React, { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { useTranscriptionStore, TranscriptItem } from '../../stores/transcription.store';
import { useVisualIndexStore, VisualIndexItem } from '../../stores/visual-index.store';
import { useSessionStore } from '../../stores/session.store';

/**
 * Returns true when the visual-index text is internal pipeline data
 * (raw FEN boards, board-mapping XML, screenshot source tags) that
 * should never be shown to the user.
 */
function isInternalPipelineText(text: string): boolean {
  if (!text) return true;
  const t = text.trim();
  // Screenshot-path synthetic tags
  if (/<source>/i.test(t)) return true;
  if (/<perspective>/i.test(t)) return true;
  if (/<raw_board>/i.test(t)) return true;
  if (/<board_mapping>/i.test(t)) return true;
  // Pure FEN board strings: 8 ranks of pieces/digits separated by /
  if (/^[prnbqkPRNBQK1-8]+(?:\/[prnbqkPRNBQK1-8]+){7}(\s|$)/.test(t)) return true;
  // Full FEN strings
  if (/^[prnbqkPRNBQK1-8/]+\s+[wb]\s+[-KQkq]+\s+[-a-h1-8]+\s+\d+\s+\d+/.test(t)) return true;
  // Visual Row lines from board mapping
  if (/Visual Row\s+\d+/i.test(t)) return true;
  return false;
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function SparkleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 2.5L11.5 7L16.25 8.125L12.5 11.25L13.125 16.25L10 13.75L6.875 16.25L7.5 11.25L3.75 8.125L8.5 7L10 2.5Z" stroke="#EC5B16" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="rgba(236, 91, 22, 0.1)" />
    </svg>
  );
}

// ─── TranscriptMessage ────────────────────────────────────────────────────────

interface TranscriptMessageProps {
  item: TranscriptItem;
}

function TranscriptMessage({ item }: TranscriptMessageProps) {
  const isMe = item.source === 'mic';

  const formatRelativeTime = (timestamp: number) => {
    const startTime = useSessionStore.getState().startTime;
    if (!startTime) return '0:00';
    const relativeMs = timestamp - startTime;
    const totalSeconds = Math.max(0, Math.floor(relativeMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col gap-[8px]">
      <div className="bg-[#f9fafb] rounded-[10px] px-[8px] py-[6px] flex items-center gap-[12px]">
        <div className={`px-[8px] py-[4px] rounded-[7px] ${isMe ? 'bg-[#ffe9d3]' : 'bg-[rgba(45,140,255,0.2)]'}`}>
          <span className={`font-semibold text-[13px] leading-[16px] ${isMe ? 'text-[#ec5b16]' : 'text-[#2d8cff]'}`}>
            {formatRelativeTime(item.timestamp)}
          </span>
        </div>
        <span className="font-medium text-[13px] text-black leading-[16px]">
          {isMe ? 'Player' : 'Engine'}
        </span>
      </div>
      <p className="text-[14px] text-black leading-[22px]">{item.text}</p>
    </div>
  );
}

// ─── CoachingEntry (replaces VisualAnalysisEntry) ─────────────────────────────

interface CoachingEntryProps {
  item: VisualIndexItem;
}

function CoachingEntry({ item }: CoachingEntryProps) {
  const parseCoachingText = (text: string): { heading: string; body: string } => {
    const normalized = (text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return { heading: 'Coach', body: '' };

    if (normalized.includes('|||')) {
      const [heading, ...rest] = normalized.split('|||').map((s) => s.trim()).filter(Boolean);
      return { heading: heading || 'Coach', body: rest.join(' ').trim() || heading || '' };
    }

    try {
      const parsed = JSON.parse(normalized) as Record<string, unknown>;
      const heading = typeof parsed.heading_tip === 'string' ? parsed.heading_tip : 'Coach';
      const tip = typeof parsed.tip === 'string' ? parsed.tip : '';
      const analysis = typeof parsed.analysis === 'string' ? parsed.analysis : '';
      const body = [tip, analysis].filter(Boolean).join(' ').trim();
      return { heading, body: body || heading };
    } catch {
      return { heading: 'Coach', body: normalized };
    }
  };

  const parsed = parseCoachingText(item.text);

  const formatRelativeTime = () => {
    const startTime = useSessionStore.getState().startTime;
    if (!startTime) return '0:00';
    const relativeMs = item.timestamp - startTime;
    const totalSeconds = Math.max(0, Math.floor(relativeMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-[#eff6ff] border border-[#5095fb] rounded-[10px] p-[12px] flex flex-col gap-[12px]">
      <div className="flex items-center gap-[12px]">
        <div className="bg-white px-[8px] py-[4px] rounded-[7px]">
          <span className="font-semibold text-[13px] text-[#5095fb] leading-[16px]">{formatRelativeTime()}</span>
        </div>
        <span className="font-medium text-[13px] text-black leading-[16px]">{parsed.heading}</span>
      </div>
      <div className="text-[14px] text-black leading-[24px] prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
        <ReactMarkdown>{parsed.body}</ReactMarkdown>
      </div>
    </div>
  );
}

// ─── PendingMessage ───────────────────────────────────────────────────────────

interface PendingMessageProps {
  text: string;
  source: 'mic' | 'system_audio';
}

function PendingMessage({ text, source }: PendingMessageProps) {
  const isMe = source === 'mic';
  return (
    <div className="flex flex-col gap-[8px] opacity-70">
      <div className="bg-[#f9fafb] rounded-[10px] px-[8px] py-[6px] flex items-center gap-[12px]">
        <div className={`px-[8px] py-[4px] rounded-[7px] animate-pulse ${isMe ? 'bg-[#ffe9d3]' : 'bg-[rgba(45,140,255,0.2)]'}`}>
          <span className={`font-semibold text-[13px] leading-[16px] ${isMe ? 'text-[#ec5b16]' : 'text-[#2d8cff]'}`}>...</span>
        </div>
        <span className="font-medium text-[13px] text-black leading-[16px]">{isMe ? 'Player' : 'Engine'}</span>
      </div>
      <p className="text-[14px] text-black leading-[22px] italic">{text}</p>
    </div>
  );
}

// ─── Merge helpers ────────────────────────────────────────────────────────────

interface MergedItem {
  type: 'transcript' | 'coaching';
  timestamp: number;
  data: TranscriptItem | VisualIndexItem;
}

function mergeItems(transcripts: TranscriptItem[], visuals: VisualIndexItem[], isChess: boolean): MergedItem[] {
  // Filter out internal pipeline FEN/board-mapping entries
  const readableVisuals = visuals.filter((v) => !isInternalPipelineText(v.text));
  const merged: MergedItem[] = [
    // Chess sessions are visual/board-action based — spoken words are not moves
    // and should not appear in the Move History panel.
    ...(!isChess ? transcripts.map((t) => ({ type: 'transcript' as const, timestamp: t.timestamp, data: t })) : []),
    ...readableVisuals.map((v) => ({ type: 'coaching' as const, timestamp: v.timestamp, data: v })),
  ];
  return merged.sort((a, b) => a.timestamp - b.timestamp);
}

// ─── TranscriptionPanel ───────────────────────────────────────────────────────

export function TranscriptionPanel() {
  const { items, enabled, pendingMic, pendingSystemAudio } = useTranscriptionStore();
  const { items: visualItems } = useVisualIndexStore();
  const { status, selectedGameId } = useSessionStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevItemCountRef = useRef(0);

  const isRecording = status === 'recording';
  const isChess = selectedGameId === 'chess';
  const mergedItems = mergeItems(items, visualItems, isChess);
  const effectivePendingMic = isChess ? null : pendingMic;
  const effectivePendingSystemAudio = isChess ? null : pendingSystemAudio;
  const totalItemCount = mergedItems.length + (effectivePendingMic ? 1 : 0) + (effectivePendingSystemAudio ? 1 : 0);

  useEffect(() => {
    if (totalItemCount > prevItemCountRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevItemCountRef.current = totalItemCount;
  }, [totalItemCount]);

  return (
    <div className="border border-[#efefef] rounded-[12px] flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-[#efefef] px-[16px] py-[10px] flex items-center gap-[8px] shrink-0 rounded-t-[12px]">
        <SparkleIcon />
        <span className="font-medium text-[15px] text-black">Move History</span>
      </div>

      {/* Content */}
      <div
        ref={scrollRef}
        className="flex-1 bg-white overflow-y-auto p-[16px] flex flex-col gap-[10px] [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
      >
        {mergedItems.length === 0 && !effectivePendingMic && !effectivePendingSystemAudio ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <div className="w-[64px] h-[64px] rounded-full bg-[#f7f7f7] flex items-center justify-center mb-4">
              <SparkleIcon />
            </div>
            <p className="text-[#464646] font-medium text-[14px]">
              {enabled
                ? isRecording
                  ? 'Waiting for moves...'
                  : 'Start recording to see move history'
                : 'Enable analysis to see coaching history'}
            </p>
          </div>
        ) : (
          <>
            {mergedItems.map((item) =>
              item.type === 'transcript' ? (
                <TranscriptMessage key={(item.data as TranscriptItem).id} item={item.data as TranscriptItem} />
              ) : (
                <CoachingEntry key={(item.data as VisualIndexItem).id} item={item.data as VisualIndexItem} />
              )
            )}
            {effectivePendingMic && <PendingMessage text={effectivePendingMic} source="mic" />}
            {effectivePendingSystemAudio && <PendingMessage text={effectivePendingSystemAudio} source="system_audio" />}
          </>
        )}
      </div>
    </div>
  );
}

export default TranscriptionPanel;
