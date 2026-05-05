/**
 * Recording Detail Page
 *
 * Post-game analysis view matching Figma design:
 * - Header: back, title, metadata (date/duration/moves/result), export + copy link CTAs
 * - Left panel: accuracy cards, opening, win probability, badges, match summary, key moments, insights
 * - Right panel: video player, chat with video, coach notes
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  ArrowLeft,
  Calendar,
  Clock,
  MessageCircle,
  Upload,
  Link2,
  ChevronDown,
  Check,
  Loader2,
  Video,
  Send,
  X,
  Swords,
} from 'lucide-react';
import { trpc } from '../../api/trpc';
import { getElectronAPI } from '../../api/ipc';
import type { Recording } from '../../../shared/schemas/recording.schema';
import { formatDate, formatDurationMinutes, cn } from '../../lib/utils';

interface RecordingDetailPageProps {
  recordingId: number;
  onBack: () => void;
}

export function RecordingDetailPage({ recordingId, onBack }: RecordingDetailPageProps) {
  const [collectionId, setCollectionId] = useState<string | null>(null);

  const { data: recording, isLoading } = trpc.recordings.get.useQuery(
    { recordingId },
    { enabled: !!recordingId }
  );

  const { data: playbackData } = trpc.recordings.getPlaybackUrl.useQuery(
    { recordingId },
    { enabled: !!recordingId }
  );

  const { data: gameplayTips = [] } = trpc.recordings.getGameplayTips.useQuery(
    { recordingId },
    { enabled: !!recordingId }
  );

  const populateCollectionIdMutation = trpc.recordings.populateCollectionId.useMutation();

  useEffect(() => {
    if (recording?.videoId && !recording?.collectionId && !collectionId) {
      populateCollectionIdMutation.mutateAsync({ recordingId }).then((result) => {
        if (result.collectionId) setCollectionId(result.collectionId);
      });
    } else if (recording?.collectionId) {
      setCollectionId(recording.collectionId);
    }
  }, [recording?.videoId, recording?.collectionId, recordingId]);

  if (isLoading) {
    return (
      <div className="bg-surface-muted h-full flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-brand border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!recording) {
    return (
      <div className="bg-surface-muted h-full flex flex-col items-center justify-center gap-4">
        <p className="text-text-body">Recording not found</p>
        <button onClick={onBack} className="text-brand hover:underline">Go back</button>
      </div>
    );
  }

  const title = recording.meetingName || `Recording - ${formatDate(recording.createdAt)}`;
  const resolvedPlayerUrl = playbackData?.playerUrl || recording.playerUrl;
  // Video is ready if we have a player URL — regardless of recording status
  const isVideoReady = !!resolvedPlayerUrl;
  const isVideoFailed = recording.status === 'failed' && !resolvedPlayerUrl;
  const isVideoProcessing = (recording.status === 'processing' || recording.status === 'recording') && !resolvedPlayerUrl;
  const players = extractPlayerNames(recording.meetingName);

  // ── Figma post-recording state ──
  // When the recording has just ended and summary data isn't ready yet, show
  // the centered dialog matching the Figma "Recording Ended" screen.
  const isJustEnded = (recording.status === 'processing' || recording.status === 'recording') && !recording.shortOverview;

  if (isJustEnded) {
    return (
      <div className="bg-surface-muted h-full flex flex-col overflow-hidden" style={{ padding: '0 10px' }}>

        {/* Header — matches Figma exactly */}
        <div className="flex gap-[12px] items-start" style={{ padding: '30px 20px 20px' }}>
          {/* Left: Back + Title + Metadata */}
          <div className="flex-1 flex gap-[16px] items-start">
            {/* Back button */}
            <button
              onClick={onBack}
              className="flex items-center justify-center bg-white hover:bg-gray-50 transition-colors"
              style={{ width: 28, height: 28, border: '0.933px solid rgba(0,0,0,0.2)', borderRadius: 6.53, flexShrink: 0, marginTop: 2 }}
            >
              <ArrowLeft className="h-[15px] w-[15px] text-black" />
            </button>

            {/* Title + metadata */}
            <div className="flex flex-col gap-[10px]">
              <h1 className="text-[24px] font-semibold text-black" style={{ letterSpacing: '0.005em' }}>
                {title}
              </h1>
              <div className="flex items-center gap-[20px]">
                <div className="flex items-center gap-[4px]">
                  <Calendar className="h-4 w-4 text-text-body opacity-20" />
                  <span className="text-[13px] text-text-body" style={{ letterSpacing: '0.005em' }}>{formatDate(recording.createdAt)}</span>
                </div>
                {recording.duration && (
                  <div className="flex items-center gap-[4px]">
                    <Clock className="h-4 w-4 text-text-body opacity-20" />
                    <span className="text-[13px] text-text-body" style={{ letterSpacing: '0.005em' }}>{formatDurationMinutes(recording.duration)}</span>
                  </div>
                )}
                <div className="flex items-center gap-[4px]">
                  <Swords className="h-4 w-4 text-text-body opacity-20" />
                  <span className="text-[13px] text-text-body" style={{ letterSpacing: '0.005em' }}>— Moves</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Analysis status badge */}
          <div className="flex items-start" style={{ paddingTop: 2 }}>
            <div
              className="flex items-center gap-[6px]"
              style={{
                padding: '4px 12px 4px 10px',
                background: '#CCE9CD',
                border: '1px solid #C9E4D5',
                boxShadow: '0px 1.27px 15.27px rgba(0,0,0,0.05)',
                borderRadius: 12,
              }}
            >
              <Loader2 className="h-4 w-4 animate-spin" style={{ color: '#009106' }} />
              <span className="text-[13px] font-medium" style={{ color: '#009106', letterSpacing: '0.005em' }}>
                Analysing...
              </span>
            </div>
          </div>
        </div>

        {/* Main container — centered dialog */}
        <div
          className="flex-1 flex items-center justify-center overflow-hidden"
          style={{
            background: '#FFFFFF',
            border: '1px solid #EFEFEF',
            borderRadius: '20px 20px 0px 0px',
          }}
        >
          {/* Dialog card */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: 30,
              gap: 20,
              width: 550,
              background: '#FFFFFF',
              borderRadius: 16,
            }}
          >
            {/* container: icon + text */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, width: 490 }}>

              {/* Icon circle — 68×68, #F7F7F7 bg, #EFEFEF border */}
              <div
                style={{
                  width: 68,
                  height: 68,
                  background: '#F7F7F7',
                  border: '1.7px solid #EFEFEF',
                  borderRadius: 85,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Swords className="w-8 h-8" style={{ color: '#464646', opacity: 0.6 }} />
              </div>

              {/* Text block */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, width: 490 }}>
                {/* Heading */}
                <h2
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 22,
                    fontWeight: 500,
                    color: '#000000',
                    textAlign: 'center',
                    margin: 0,
                    lineHeight: '27px',
                    width: 490,
                  }}
                >
                  Analysis in Progress
                </h2>

                {/* Detail */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: 490 }}>
                  <p
                    style={{
                      fontFamily: 'Inter, sans-serif',
                      fontSize: 14,
                      fontWeight: 400,
                      color: '#464646',
                      textAlign: 'center',
                      margin: 0,
                      lineHeight: '150%',
                      width: 370,
                    }}
                  >
                    Your game is being processed. Analysis and insights will appear here shortly.
                  </p>
                </div>
              </div>
            </div>

            {/* CTA — Start New Recording */}
            <button
              onClick={onBack}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '12px 20px',
                background: '#FF4000',
                border: 'none',
                borderRadius: 12,
                boxShadow: '0px 1.27px 15.27px rgba(0,0,0,0.05)',
                cursor: 'pointer',
                fontFamily: 'Inter, sans-serif',
                fontSize: 14,
                fontWeight: 600,
                color: '#FFFFFF',
                letterSpacing: '-0.02em',
              }}
            >
              {/* Recording icon — outer ring + inner dot */}
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path fillRule="evenodd" clipRule="evenodd" d="M10 2.125C5.65076 2.125 2.125 5.65076 2.125 10C2.125 14.3492 5.65076 17.875 10 17.875C14.3492 17.875 17.875 14.3492 17.875 10C17.875 5.65076 14.3492 2.125 10 2.125ZM0.875 10C0.875 4.96043 4.96043 0.875 10 0.875C15.0396 0.875 19.125 4.96043 19.125 10C19.125 15.0396 15.0396 19.125 10 19.125C4.96043 19.125 0.875 15.0396 0.875 10Z" fill="white"/>
                <circle cx="10" cy="10" r="3.5" fill="white"/>
              </svg>
              <span>Start New Recording</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface-muted h-full flex flex-col overflow-hidden" style={{ padding: '0 10px' }}>
      {/* Header */}
      <Header
        title={title}
        recordingId={recordingId}
        createdAt={recording.createdAt}
        duration={recording.duration}
        playerUrl={resolvedPlayerUrl}
        onBack={onBack}
      />

      {/* Main container */}
      <div
        className="flex-1 bg-white border border-border-default overflow-hidden"
        style={{ borderRadius: 20, padding: 20, gap: 30, display: 'flex', flexDirection: 'row', alignItems: 'flex-start', marginBottom: 0 }}
      >
        {/* Left panel — scrollable */}
        <div className="flex flex-col gap-[16px] overflow-y-auto" style={{ width: 743, flexShrink: 0, height: '100%', paddingRight: 8 }}>

          {/* Accuracy cards row */}
          <div className="flex gap-[16px]">
            <AccuracyCard label={`${players.white} Accuracy`} value={null} color="#009106" />
            <AccuracyCard label={`${players.black} Accuracy`} value={null} color="#EF4444" />
          </div>

          {/* Opening row */}
          <div
            className="flex items-center justify-between"
            style={{ background: '#F7F7F7', border: '1px solid #EFEFEF', borderRadius: 12, padding: '16px', gap: 30 }}
          >
            <span className="text-[14px] font-semibold text-black" style={{ textTransform: 'capitalize' }}>Opening</span>
            <span className="text-[14px] font-semibold text-text-body text-right">—</span>
          </div>

          {/* Win Probability chart */}
          <WinProbabilitySection players={players} />

          {/* Badges row */}
          <BadgesRow recording={recording} />

          {/* Match Summary */}
          <MatchSummaryCard summary={recording.shortOverview || recording.insights} />

          {/* Key Moments */}
          <KeyMomentsCard tips={gameplayTips} playerUrl={resolvedPlayerUrl} />

          {/* Insights & Patterns */}
          <InsightsPatternsCard keyPoints={recording.keyPoints} />
        </div>

        {/* Vertical divider */}
        <div style={{ width: 1, background: 'rgba(0,0,0,0.05)', alignSelf: 'stretch', flexShrink: 0 }} />

        {/* Right panel — coach notes + video */}
        <div className="flex flex-col gap-[24px] overflow-y-auto flex-1" style={{ height: '100%' }}>
          {/* Video player */}
          <VideoPlayerSection
            playerUrl={resolvedPlayerUrl}
            isReady={isVideoReady}
            isFailed={isVideoFailed}
            isProcessing={isVideoProcessing}
          />

          {/* Chat with video button */}
          <div className="flex justify-center">
            <ChatWithVideoButton
              videoId={recording.videoId}
              collectionId={collectionId}
              disabled={!isVideoReady}
            />
          </div>

          {/* Coach Notes */}
          <CoachNotesSection recordingId={recordingId} tips={gameplayTips} />
        </div>
      </div>
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

interface HeaderProps {
  title: string;
  recordingId: number;
  createdAt: string;
  duration: number | null;
  playerUrl: string | null | undefined;
  onBack: () => void;
}

function Header({ title, recordingId, createdAt, duration, playerUrl, onBack }: HeaderProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied'>('idle');
  const [exportOpen, setExportOpen] = useState(false);
  const [downloadingVideo, setDownloadingVideo] = useState(false);
  const downloadVideoMutation = trpc.recordings.downloadVideo.useMutation();

  const handleCopyLink = async () => {
    if (!playerUrl || copyState !== 'idle') return;
    setCopyState('copying');
    await navigator.clipboard.writeText(playerUrl);
    setCopyState('copied');
    setTimeout(() => setCopyState('idle'), 2000);
  };

  const handleDownloadVideo = async () => {
    setDownloadingVideo(true);
    setExportOpen(false);
    try {
      const result = await downloadVideoMutation.mutateAsync({ recordingId });
      window.open(result.downloadUrl, '_blank');
    } catch (error) {
      console.error('Failed to download video:', error);
    } finally {
      setDownloadingVideo(false);
    }
  };

  return (
    <div className="flex gap-[12px] items-start" style={{ padding: '30px 20px 20px' }}>
      {/* Left: Back + Title + Metadata */}
      <div className="flex-1 flex gap-[16px] items-start">
        {/* Back button */}
        <button
          onClick={onBack}
          className="flex items-center justify-center bg-white hover:bg-gray-50 transition-colors"
          style={{ width: 28, height: 28, border: '0.933px solid rgba(0,0,0,0.2)', borderRadius: 6.53, flexShrink: 0, marginTop: 2 }}
        >
          <ArrowLeft className="h-[15px] w-[15px] text-black" />
        </button>

        {/* Title + metadata */}
        <div className="flex flex-col gap-[10px]">
          <h1 className="text-[24px] font-semibold text-black" style={{ letterSpacing: '0.005em' }}>
            {title}
          </h1>
          <div className="flex items-center gap-[20px]">
            {/* Date */}
            <div className="flex items-center gap-[4px]">
              <Calendar className="h-4 w-4 text-text-body opacity-20" />
              <span className="text-[13px] text-text-body" style={{ letterSpacing: '0.005em' }}>{formatDate(createdAt)}</span>
            </div>
            {/* Duration */}
            {duration && (
              <div className="flex items-center gap-[4px]">
                <Clock className="h-4 w-4 text-text-body opacity-20" />
                <span className="text-[13px] text-text-body" style={{ letterSpacing: '0.005em' }}>{formatDurationMinutes(duration)}</span>
              </div>
            )}
            {/* Moves */}
            <div className="flex items-center gap-[4px]">
              <Swords className="h-4 w-4 text-text-body opacity-20" />
              <span className="text-[13px] text-text-body" style={{ letterSpacing: '0.005em' }}>— Moves</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right: CTAs */}
      <div className="flex gap-[12px] items-start">
        {/* Export button */}
        <div className="relative">
          <button
            onClick={() => setExportOpen(!exportOpen)}
            disabled={downloadingVideo}
            className="flex items-center gap-[6px] bg-white border border-border-default hover:bg-surface-muted transition-colors"
            style={{ borderRadius: 12, padding: '12px 20px 12px 16px', boxShadow: '0px 1.27px 15.27px rgba(0,0,0,0.05)' }}
          >
            {downloadingVideo ? <Loader2 className="h-5 w-5 text-black animate-spin" /> : <Upload className="h-5 w-5 text-black" />}
            <span className="text-[14px] font-semibold text-black" style={{ letterSpacing: '-0.02em' }}>Export</span>
          </button>
          {exportOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
              <div className="absolute right-0 top-full mt-2 z-20 bg-white border border-border-default rounded-[12px] p-[8px] min-w-[180px]" style={{ boxShadow: '0px 17px 17px rgba(0,0,0,0.12)' }}>
                <button
                  onClick={handleDownloadVideo}
                  className="w-full flex items-center gap-[6px] px-[10px] py-[8px] rounded-[10px] hover:bg-surface-muted transition-colors"
                >
                  <Video className="h-5 w-5 text-black" />
                  <span className="text-[13px] font-medium text-black">Video</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Copy video link button */}
        <button
          onClick={handleCopyLink}
          disabled={!playerUrl || copyState !== 'idle'}
          className={cn(
            "flex items-center gap-[4px] transition-colors",
            copyState === 'copied' ? "bg-[#007657]" : "bg-brand-cta hover:bg-brand-cta-hover",
            !playerUrl && "opacity-50 cursor-not-allowed"
          )}
          style={{ borderRadius: 12, padding: '12px 20px', boxShadow: '0px 1.27px 15.27px rgba(0,0,0,0.05)', isolation: 'isolate' }}
        >
          {copyState === 'copied' ? <Check className="h-5 w-5 text-white" /> :
           copyState === 'copying' ? <Loader2 className="h-5 w-5 text-white animate-spin" /> :
           <Link2 className="h-5 w-5 text-white" />}
          <span className="text-[14px] font-semibold text-white" style={{ letterSpacing: '-0.02em' }}>
            {copyState === 'copied' ? 'Link copied!' : copyState === 'copying' ? 'Creating link...' : 'Copy video link'}
          </span>
        </button>
      </div>
    </div>
  );
}

/**
 * Extracts player names from a game title like "Magnus Carlsen vs. Gaurav Tyagi"
 * Returns { white, black } using the names if found, otherwise falls back to "White" / "Black".
 */
function extractPlayerNames(title: string | null | undefined): { white: string; black: string } {
  if (!title) return { white: 'White', black: 'Black' };
  // Match patterns: "A vs B", "A vs. B", "A VS B"
  const match = title.match(/^(.+?)\s+vs\.?\s+(.+)$/i);
  if (match) {
    return {
      white: match[1].trim(),
      black: match[2].trim(),
    };
  }
  return { white: 'White', black: 'Black' };
}

// ── Accuracy Card ─────────────────────────────────────────────────────────────

function AccuracyCard({ label, value, color }: { label: string; value: number | null; color: string }) {
  const displayValue = value !== null ? value : null;
  const barWidth = value !== null ? `${Math.min(100, value)}%` : '0%';

  return (
    <div className="flex-1 flex flex-col gap-[24px]" style={{ background: '#F7F7F7', border: '1px solid #EFEFEF', borderRadius: 16, padding: 16 }}>
      {/* Label */}
      <span className="text-[14px] font-semibold text-black" style={{ textTransform: 'capitalize' }}>{label}</span>

      {/* Value + progress */}
      <div className="flex flex-col gap-[20px]">
        <div className="flex items-flex-end gap-[4px]">
          <span className="text-[36px] font-bold leading-none" style={{ color: displayValue !== null ? color : '#000000' }}>
            {displayValue !== null ? displayValue : '—'}
          </span>
          {displayValue !== null && (
            <span className="text-[20px] font-semibold text-text-body" style={{ lineHeight: '28px', alignSelf: 'flex-end' }}>%</span>
          )}
        </div>
        {/* Progress bar */}
        <div className="relative h-[4px] rounded-[30px] bg-white overflow-hidden">
          <div className="absolute left-0 top-0 h-full rounded-[30px]" style={{ width: barWidth, background: displayValue !== null ? color : 'transparent' }} />
        </div>
      </div>
    </div>
  );
}

// ── Win Probability Section ───────────────────────────────────────────────────

function WinProbabilitySection({ players }: { players: { white: string; black: string } }) {
  const yLabels = [100, 75, 50, 25, 0];

  return (
    <div className="flex flex-col gap-[20px]" style={{ background: '#F7F7F7', border: '0.617px solid #EFEFEF', borderRadius: 16, padding: 16 }}>
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="text-[14px] font-semibold text-black" style={{ textTransform: 'capitalize' }}>Win Probability</span>
        <div className="flex items-center gap-[12px]">
          <div className="flex items-center gap-[4px]">
            <div className="w-[16px] h-[16px] flex items-center justify-center">
              <div className="w-[6px] h-[6px] rounded-full" style={{ background: '#C14103' }} />
            </div>
            <span className="text-[13px] font-medium" style={{ color: '#242424', letterSpacing: '0.005em' }}>{players.white}</span>
          </div>
          <div className="flex items-center gap-[4px]">
            <div className="w-[16px] h-[16px] flex items-center justify-center">
              <div className="w-[6px] h-[6px] rounded-full" style={{ background: '#009106' }} />
            </div>
            <span className="text-[13px] font-medium" style={{ color: '#242424', letterSpacing: '0.005em' }}>{players.black}</span>
          </div>
        </div>
      </div>

      {/* Chart placeholder */}
      <div className="flex gap-[6px]" style={{ height: 167 }}>
        {/* Y-axis labels */}
        <div className="flex flex-col justify-between items-end" style={{ width: 14 }}>
          {yLabels.map((v) => (
            <span key={v} className="text-[10px] font-medium" style={{ color: '#969696', letterSpacing: '0.005em' }}>{v}</span>
          ))}
        </div>
        {/* Chart area */}
        <div className="flex-1 relative flex flex-col justify-between">
          {yLabels.map((v) => (
            <div key={v} className="w-full" style={{ height: 1, background: '#E5E7EB' }} />
          ))}
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[12px] text-text-muted-brand">Game data not available</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Badges Row ────────────────────────────────────────────────────────────────

function BadgesRow({ recording }: { recording: Recording }) {
  void recording;
  const badges = [
    { label: 'Hypermodern Opening', bg: '#FFE9D3', color: '#EC5B16' },
    { label: 'Best', bg: '#DFFBE0', color: '#009106' },
  ];

  if (!badges.length) return null;

  return (
    <div className="flex items-center gap-[12px] flex-wrap">
      {badges.map((b, i) => (
        <div key={i} className="flex items-center" style={{ background: b.bg, borderRadius: 6, padding: '6px 10px' }}>
          <span className="text-[13px] font-medium" style={{ color: b.color, letterSpacing: '0.005em' }}>{b.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Match Summary Card ────────────────────────────────────────────────────────

function MatchSummaryCard({ summary }: { summary: string | null | undefined }) {
  if (!summary) return null;

  const normalized = summary
    .replace(/\bIn the meeting titled\b/gi, 'In this match titled')
    .replace(/\bmeeting\b/gi, 'session')
    .replace(/\bagenda\b/gi, 'gameplan');

  return (
    <div className="flex flex-col gap-[20px]" style={{ background: '#F7F7F7', border: '1px solid #EFEFEF', borderRadius: 16, padding: 20 }}>
      <div className="flex items-center gap-[8px]">
        <span className="text-[14px] font-semibold text-black" style={{ textTransform: 'capitalize' }}>Match Summary</span>
      </div>
      <p className="text-[13px] text-[#2D2D2D]" style={{ lineHeight: '20px', letterSpacing: '0.005em' }}>
        {normalized}
      </p>
    </div>
  );
}

// ── Key Moments Card ──────────────────────────────────────────────────────────

function formatTipTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Move quality badge colors
const moveBadgeColors: Record<string, { bg: string; color: string }> = {
  best:       { bg: '#DFFBE0', color: '#009106' },
  good:       { bg: '#DFFBE0', color: '#009106' },
  inaccuracy: { bg: '#FFE9D3', color: '#EC5B16' },
  mistake:    { bg: '#FEF9C3', color: '#C49A20' },
  blunder:    { bg: '#FEE2E2', color: '#EF4444' },
};

function KeyMomentsCard({ tips, playerUrl }: { tips: { id: string; startTime: number; tip: string }[]; playerUrl: string | null | undefined }) {
  if (!tips.length) return null;

  const openAtTimestamp = (seconds: number) => {
    if (!playerUrl) return;
    const hasQuery = playerUrl.includes('?');
    const timedUrl = `${playerUrl}${hasQuery ? '&' : '?'}t=${Math.max(0, Math.floor(seconds))}`;
    window.electronAPI?.app.openExternalLink(timedUrl);
  };

  // Classify tip quality from text
  const classifyTip = (tipText: string): keyof typeof moveBadgeColors => {
    const lower = tipText.toLowerCase();
    if (lower.includes('blunder') || lower.includes('walked into') || lower.includes('decisive mistake')) return 'blunder';
    if (lower.includes('mistake') || lower.includes('cedes') || lower.includes('weaker')) return 'mistake';
    if (lower.includes('excellent') || lower.includes('best') || lower.includes('strong') || lower.includes('well-timed')) return 'best';
    if (lower.includes('inaccuracy') || lower.includes('slightly')) return 'inaccuracy';
    return 'good';
  };

  return (
    <div className="flex flex-col gap-[20px]" style={{ background: '#F7F7F7', border: '1px solid #EFEFEF', borderRadius: 16, padding: 16, minHeight: 200 }}>
      <span className="text-[14px] font-semibold text-black" style={{ textTransform: 'capitalize' }}>Key Moments</span>

      <div className="flex flex-col gap-[16px]">
        {tips.map((tip, idx) => {
          const quality = classifyTip(tip.tip);
          const badge = moveBadgeColors[quality];
          // Extract a short move label from tip text (first word that looks like a move)
          const moveMatch = tip.tip.match(/\b([NBRQK]?[a-h]?[1-8]?x?[a-h][1-8](?:=[NBRQ])?[+#]?)\b/);
          const moveLabel = moveMatch ? moveMatch[1] : '—';

          return (
            <div key={tip.id} className="flex items-center gap-[20px] bg-white rounded-[12px]" style={{ padding: 16 }}>
              {/* Move # + notation */}
              <div className="flex flex-col gap-[8px]" style={{ width: 56, flexShrink: 0 }}>
                <span className="text-[12px] text-text-body" style={{ letterSpacing: '0.005em' }}>MOVE {idx + 1}</span>
                <span className="text-[20px] font-semibold text-black" style={{ lineHeight: '16px' }}>{moveLabel}</span>
              </div>

              {/* Vertical divider */}
              <div style={{ width: 1, height: 40, background: '#EFEFEF', flexShrink: 0 }} />

              {/* Description + jump link */}
              <div className="flex-1 flex flex-col gap-[8px]">
                <p className="text-[14px] text-text-body">{tip.tip}</p>
                <button
                  onClick={() => openAtTimestamp(tip.startTime)}
                  disabled={!playerUrl}
                  className="flex items-center gap-[4px] text-left disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M3 6L9 2M9 2V8M9 2H3" stroke="#C14103" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span className="text-[13px] font-medium text-text-body">
                    Jump to {formatTipTimestamp(tip.startTime)}
                  </span>
                </button>
              </div>

              {/* Quality badge */}
              <div style={{ background: badge.bg, borderRadius: 6, padding: '6px' }}>
                <span className="text-[13px] font-medium" style={{ color: badge.color, letterSpacing: '0.005em' }}>
                  {quality.charAt(0).toUpperCase() + quality.slice(1)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Insights & Patterns Card ──────────────────────────────────────────────────

function InsightsPatternsCard({ keyPoints }: { keyPoints: Array<{ topic: string; points: string[] }> | null | undefined }) {
  if (!keyPoints || keyPoints.length === 0) return null;

  return (
    <div className="flex flex-col gap-[20px]" style={{ background: '#F7F7F7', border: '1px solid #EFEFEF', borderRadius: 16, padding: 16 }}>
      <span className="text-[14px] font-semibold text-black uppercase tracking-[0.005em]">Insights &amp; patterns</span>

      <div className="flex flex-col gap-[10px]">
        {keyPoints.map((kp, idx) => (
          <div key={idx} className="flex items-center gap-[16px] bg-white" style={{ border: '1px solid #EFEFEF', borderRadius: 12, padding: '8px 16px' }}>
            <div className="flex flex-col gap-[2px] flex-1">
              <span className="text-[13px] font-medium" style={{ color: '#C14103', lineHeight: '24px', letterSpacing: '0.005em' }}>
                {kp.topic}
              </span>
              {kp.points[0] && (
                <span className="text-[13px] text-[#1E1E1E]" style={{ lineHeight: '20px', letterSpacing: '0.005em' }}>
                  {kp.points[0]}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Video Player ──────────────────────────────────────────────────────────────

function VideoPlayerSection({
  playerUrl,
  isReady,
  isFailed,
  isProcessing,
}: {
  playerUrl: string | null | undefined;
  isReady: boolean;
  isFailed?: boolean;
  isProcessing?: boolean;
}) {
  const embedUrl = playerUrl?.replace('/watch', '/embed');

  const renderInner = () => {
    if (isReady && embedUrl) {
      return (
        <iframe
          src={embedUrl}
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      );
    }
    if (isFailed) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-3">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="9" stroke="#969696" strokeWidth="1.5"/>
            <path d="M12 8v4M12 16v.5" stroke="#969696" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <p className="text-[13px] text-text-muted-brand text-center">
            Video export failed
          </p>
          <p className="text-[12px] text-text-muted-brand text-center max-w-[200px]">
            The game analysis is still available below
          </p>
        </div>
      );
    }
    // Processing or unknown
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-brand" />
        <p className="text-[14px] text-text-muted-brand">
          {isProcessing ? 'Exporting video...' : 'Loading the video...'}
        </p>
      </div>
    );
  };

  return (
    <div style={{ border: '0.79px solid #EFEFEF', borderRadius: 14.23 }}>
      <div className="aspect-video overflow-hidden bg-[#262522]" style={{ borderRadius: 9.48 }}>
        {renderInner()}
      </div>
    </div>
  );
}

// ── Chat with Video Button ────────────────────────────────────────────────────

function ChatWithVideoButton({ videoId, collectionId, disabled }: { videoId: string | null | undefined; collectionId: string | null | undefined; disabled: boolean }) {
  const handleClick = () => {
    if (!videoId || !collectionId) return;
    const chatUrl = `https://chat.videodb.io?video_id=${videoId}&collection_id=${collectionId}`;
    window.electronAPI?.app.openExternalLink(chatUrl);
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled || !videoId || !collectionId}
      className={cn(
        "relative overflow-hidden",
        (disabled || !videoId || !collectionId) && "opacity-50 cursor-not-allowed"
      )}
      style={{ width: 248, height: 52, borderRadius: 32, boxShadow: '0px 2px 3px rgba(0,0,0,0.18)', filter: 'drop-shadow(0px 2px 3px rgba(0,0,0,0.18))' }}
    >
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(267.98deg, #000000 4.66%, #1E1E1E 99.38%)',
          borderRadius: 32,
          border: '2px solid #494949',
          boxShadow: 'inset 0px 4px 4px rgba(255,255,255,0.32)',
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center gap-[6px]">
        <MessageCircle className="h-5 w-5 text-white" />
        <span className="text-[16px] font-medium text-white" style={{ letterSpacing: '-0.005em' }}>Chat with video</span>
      </div>
    </button>
  );
}

// ── Coach Notes Section ───────────────────────────────────────────────────────

function CoachNotesSection({ recordingId, tips }: { recordingId: number; tips: { id: string; startTime: number; tip: string }[] }) {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<{ id: string; role: 'user' | 'assistant'; text: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const idCounter = useRef(0);
  void recordingId;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    const question = input.trim();
    if (!question || isLoading) return;

    const tipsContext = tips.length > 0
      ? `Session coaching tips:\n${tips.slice(0, 5).map((t, i) => `${i + 1}. [${formatTipTimestamp(t.startTime)}] ${t.tip}`).join('\n')}`
      : '';

    setInput('');
    setError(null);
    const userMsg = { id: `cn-${++idCounter.current}`, role: 'user' as const, text: question };
    setMessages((p) => [...p, userMsg]);
    setIsLoading(true);

    try {
      const api = getElectronAPI();
      if (!api) throw new Error('Electron API not available');
      const result = await api.liveAssist.chat(question, tipsContext || undefined);
      if (!result.success || !result.reply) throw new Error(result.error || 'No reply received');
      setMessages((p) => [...p, { id: `cn-${++idCounter.current}`, role: 'assistant', text: result.reply! }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get a response');
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, tips]);

  return (
    <div className="flex flex-col gap-[20px]">
      <span className="text-[14px] font-semibold text-black uppercase tracking-[0.005em]">Coach Notes</span>

      {/* In-session coaching tips */}
      {tips.length === 0 ? (
        <p className="text-[13px] text-text-muted-brand italic">
          No coaching notes were captured for this session.
        </p>
      ) : (
        <div className="flex flex-col gap-[16px]">
          {tips.map((tip) => (
            <div
              key={tip.id}
              className="flex flex-col justify-center gap-[10px]"
              style={{ background: '#FFF5EC', border: '1px solid #FFCFA5', borderRadius: 10, padding: 12 }}
            >
              {/* Timestamp pill */}
              <div className="flex items-center gap-[12px]">
                <div className="flex items-center" style={{ background: '#FFFFFF', borderRadius: 7, padding: '4px 8px' }}>
                  <span className="text-[13px] font-semibold" style={{ color: '#EC5B16' }}>
                    {formatTipTimestamp(tip.startTime)}
                  </span>
                </div>
              </div>
              {/* Tip content — shown once, no duplication */}
              <p className="text-[13px] text-black" style={{ lineHeight: '20px' }}>
                {tip.tip}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Chat messages */}
      {messages.length > 0 && (
        <div className="flex flex-col gap-[10px] max-h-[300px] overflow-y-auto">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className="max-w-[85%] text-[13px]"
                style={{
                  padding: '12px',
                  borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                  background: msg.role === 'user' ? 'var(--color-chat-user-bg)' : 'var(--color-chat-coach-bg)',
                  border: `1px solid ${msg.role === 'user' ? 'var(--color-chat-user-border)' : 'var(--color-chat-coach-border)'}`,
                  lineHeight: '18px',
                  color: 'var(--color-text-body)',
                }}
              >
                {msg.role === 'assistant' ? (
                  <div className="prose prose-sm max-w-none text-[13px] leading-[18px]">
                    <ReactMarkdown>{msg.text}</ReactMarkdown>
                  </div>
                ) : msg.text}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div style={{ background: 'var(--color-chat-coach-bg)', border: '1px solid var(--color-chat-coach-border)', borderRadius: '12px 12px 12px 2px', padding: '8px 12px' }} className="flex items-center gap-[6px]">
                <Loader2 size={12} className="text-brand animate-spin" />
                <span className="text-[13px] text-text-muted-brand">Thinking...</span>
              </div>
            </div>
          )}
          {error && (
            <div className="flex items-center gap-[6px] rounded-[8px] px-[10px] py-[6px]" style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
              <span className="text-[12px] text-[#DC2626] flex-1">{error}</span>
              <button onClick={() => setError(null)}><X size={12} className="text-[#DC2626]" /></button>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Chat input */}
      <form onSubmit={handleSubmit} className="flex items-center gap-[4px]" style={{ background: '#F7F7F7', border: '1px solid rgba(13,13,13,0.1)', borderRadius: 9999, padding: '2px 6px 2px 12px' }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask your coach..."
          disabled={isLoading}
          className="flex-1 bg-transparent text-[13px] font-medium text-text-label placeholder:text-text-muted-brand outline-none"
          style={{ height: 40 }}
        />
        <button
          type="submit"
          disabled={!input.trim() || isLoading}
          className="flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          style={{ width: 32, height: 32, borderRadius: 40, background: input.trim() ? '#000000' : '#969696', border: '1px solid #EFEFEF', flexShrink: 0 }}
        >
          <Send size={14} className="text-white" />
        </button>
      </form>
    </div>
  );
}

// ── PostGameChatPanel (exported for external use) ────────────────────────────

export function PostGameChatPanel({ recordingId, tips }: { recordingId: number; tips: { id: string; startTime: number; tip: string }[] }) {
  return <CoachNotesSection recordingId={recordingId} tips={tips} />;
}

export default RecordingDetailPage;