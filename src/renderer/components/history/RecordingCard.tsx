import React from 'react';
import { Calendar, Clock, Move } from 'lucide-react';
import type { Recording } from '../../../shared/schemas/recording.schema';
import { formatDate, formatDurationMinutes, stripMarkdown, cn } from '../../lib/utils';

interface RecordingCardProps {
  recording: Recording;
  onClick: () => void;
}

type RecordingStatus = 'recording' | 'processing' | 'available' | 'failed';

export function RecordingCard({ recording, onClick }: RecordingCardProps) {
  const status = recording.status as RecordingStatus;

  const hoverStyles: Record<RecordingStatus, { bg: string; border: string }> = {
    recording: { bg: 'hover:bg-[#eff6ff]', border: 'hover:border-[#93c5fd]' },
    processing: { bg: 'hover:bg-[#fefce8]', border: 'hover:border-[#fde047]' },
    available:  { bg: 'hover:bg-[#f0fdf4]', border: 'hover:border-[#86efac]' },
    failed:     { bg: 'hover:bg-[#fef2f2]', border: 'hover:border-[#fca5a5]' },
  };

  const { bg: hoverBg, border: hoverBorder } = hoverStyles[status] ?? hoverStyles.available;

  const title = recording.meetingName || `Recording - ${formatDate(recording.createdAt)}`;

  const normalizeDesc = (text: string): string =>
    text
      .replace(/\bIn the meeting titled\b/gi, 'In this match titled')
      .replace(/\bmeeting\b/gi, 'session')
      .replace(/\bagenda\b/gi, 'gameplan')
      .replace(/\bchecklist\b/gi, 'goals')
      .replace(/\baction items\b/gi, 'next-match goals');

  const description = (() => {
    if (recording.shortOverview) return normalizeDesc(recording.shortOverview);
    if (recording.insights) return normalizeDesc(stripMarkdown(recording.insights));
    if (recording.meetingDescription) return normalizeDesc(recording.meetingDescription);
    return 'No summary available yet.';
  })();

  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-surface-muted border border-border-default rounded-[16px] pt-[20px] pb-[24px] px-[20px] cursor-pointer',
        'transition-all duration-200 flex flex-col gap-[20px] h-full',
        hoverBg, hoverBorder
      )}
    >
      {/* Header */}
      <div className="flex flex-col gap-[10px]">
        <h3 className="text-[18px] font-medium text-black leading-[22px] tracking-[0.005em] line-clamp-1">
          {title}
        </h3>

        {/* Metadata — date, duration, moves */}
        <div className="flex items-center gap-[20px]">
          <div className="flex items-center gap-[4px]">
            <Calendar className="h-4 w-4 text-text-body opacity-20" />
            <span className="text-sm text-text-body tracking-[0.005em]">{formatDate(recording.createdAt)}</span>
          </div>
          {recording.duration && (
            <div className="flex items-center gap-[4px]">
              <Clock className="h-4 w-4 text-text-body opacity-20" />
              <span className="text-sm text-text-body tracking-[0.005em]">{formatDurationMinutes(recording.duration)}</span>
            </div>
          )}
          <div className="flex items-center gap-[4px]">
            <Move className="h-4 w-4 text-text-body opacity-20" />
            <span className="text-sm text-text-body tracking-[0.005em]">— Moves</span>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-black/10 w-full" />

      {/* Description */}
      <p className="text-sm text-text-faint leading-[22px] tracking-[0.005em] line-clamp-4">
        {description}
      </p>
    </div>
  );
}
