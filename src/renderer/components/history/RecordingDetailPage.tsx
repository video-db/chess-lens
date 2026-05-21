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
import { classifyStoredMove, MOVE_BADGE, KEY_MOMENT_QUALITIES, type MoveQuality } from '../../../shared/lib/moveClassification';

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

        {/* Header */}
        <div className="flex gap-[12px] items-start" style={{ padding: '30px 20px 20px' }}>
          <div className="flex-1 flex gap-[16px] items-start">
            <button
              onClick={onBack}
              className="flex items-center justify-center bg-white hover:bg-gray-50 transition-colors"
              style={{ width: 28, height: 28, border: '0.933px solid rgba(0,0,0,0.2)', borderRadius: 6.53, flexShrink: 0, marginTop: 2 }}
            >
              <ArrowLeft className="h-[15px] w-[15px] text-black" />
            </button>
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
              </div>
            </div>
          </div>
          {/* No badge in the processing state */}
        </div>

        {/* Main container — centered dialog */}
        <div
          className="flex-1 flex items-center justify-center overflow-hidden"
          style={{ background: '#FFFFFF', border: '1px solid #EFEFEF', borderRadius: '20px 20px 0px 0px' }}
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
            {/* Chess icon */}
            <svg width="68" height="68" viewBox="0 0 68 68" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="0.85" y="0.85" width="66.3" height="66.3" rx="33.15" fill="#F7F7F7"/>
              <rect x="0.85" y="0.85" width="66.3" height="66.3" rx="33.15" stroke="#EFEFEF" strokeWidth="1.7"/>
              <path opacity="0.2" d="M46 34.1712C45.91 40.6062 40.6787 45.87 34.2437 45.9975C32.6289 46.0341 31.0227 45.7511 29.5175 45.165L34 39C30.67 37 26.8462 37.5875 24.6625 37.9575C24.1087 38.0515 23.5397 37.9882 23.0202 37.7747C22.5006 37.5612 22.0514 37.2062 21.7238 36.75L20 34L33 26V22H34C35.5904 21.9998 37.1649 22.3158 38.6321 22.9295C40.0993 23.5433 41.4298 24.4425 42.5464 25.575C43.663 26.7076 44.5433 28.0507 45.1362 29.5264C45.7291 31.0022 46.0227 32.581 46 34.1712Z" fill="#464646"/>
              <path d="M35 30.5C35 30.7967 34.912 31.0867 34.7472 31.3334C34.5824 31.58 34.3481 31.7723 34.074 31.8858C33.7999 31.9994 33.4983 32.0291 33.2073 31.9712C32.9164 31.9133 32.6491 31.7704 32.4393 31.5607C32.2295 31.3509 32.0867 31.0836 32.0288 30.7926C31.9709 30.5017 32.0006 30.2001 32.1142 29.926C32.2277 29.6519 32.4199 29.4176 32.6666 29.2528C32.9133 29.088 33.2033 29 33.5 29C33.8978 29 34.2793 29.158 34.5606 29.4393C34.8419 29.7206 35 30.1022 35 30.5ZM47 34.185C46.9437 37.5528 45.586 40.7682 43.2115 43.1572C40.837 45.5461 37.6299 46.9233 34.2625 47H33.9912C30.8032 47.0224 27.7195 45.8648 25.3337 43.75C25.1348 43.5731 25.0143 43.3245 24.9987 43.0588C24.991 42.9272 25.0093 42.7954 25.0525 42.6709C25.0957 42.5464 25.163 42.4316 25.2506 42.3331C25.3382 42.2346 25.4443 42.1544 25.5629 42.0969C25.6815 42.0394 25.8102 42.0058 25.9418 41.9981C26.2075 41.9825 26.4686 42.0731 26.6675 42.25C27.4209 42.9242 28.267 43.487 29.18 43.9212L32.5 39.355C29.6525 38.1262 26.5662 38.6488 24.825 38.9438C24.088 39.071 23.3301 38.9881 22.6381 38.7044C21.9461 38.4208 21.3481 37.9479 20.9125 37.34L20.875 37.2862L19.1525 34.5362C19.0826 34.4244 19.0356 34.2999 19.014 34.1698C18.9925 34.0397 18.9969 33.9066 19.027 33.7783C19.0571 33.6499 19.1123 33.5287 19.1894 33.4218C19.2665 33.3148 19.3639 33.2241 19.4762 33.155L32 25.4412V22C32 21.7348 32.1053 21.4804 32.2929 21.2929C32.4804 21.1054 32.7348 21 33 21H34C35.7228 20.9998 37.4285 21.3421 39.018 22.007C40.6074 22.6718 42.0488 23.646 43.2584 24.8728C44.468 26.0996 45.4217 27.5546 46.064 29.1533C46.7063 30.7519 47.0245 32.4623 47 34.185ZM45 34.1575C45.0208 32.6998 44.7517 31.2524 44.2083 29.8996C43.6648 28.5468 42.8579 27.3155 41.8344 26.2773C40.8108 25.2391 39.5911 24.4148 38.2462 23.8521C36.9012 23.2895 35.4579 22.9999 34 23V26C33.9999 26.1707 33.956 26.3386 33.8727 26.4876C33.7893 26.6366 33.6692 26.7618 33.5237 26.8512L21.3825 34.3237L22.5525 36.1987C22.7731 36.4959 23.0723 36.7256 23.4163 36.862C23.7604 36.9985 24.1356 37.0363 24.5 36.9713C26.5 36.6338 30.5962 35.9412 34.2587 37.9937C35.5377 37.9256 36.742 37.37 37.6239 36.4412C38.5058 35.5123 38.9983 34.2808 39 33C39 32.7348 39.1053 32.4804 39.2929 32.2929C39.4804 32.1054 39.7348 32 40 32C40.2652 32 40.5195 32.1054 40.7071 32.2929C40.8946 32.4804 41 32.7348 41 33C40.9975 34.7648 40.3294 36.4637 39.1291 37.7574C37.9288 39.0511 36.2846 39.8444 34.525 39.9788L31.1362 44.6388C32.1436 44.8999 33.182 45.0215 34.2225 45C37.0712 44.9336 39.7838 43.768 41.7926 41.7471C43.8014 39.7261 44.9507 37.0065 45 34.1575Z" fill="#464646"/>
            </svg>

            {/* Text */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <h2 style={{ fontFamily: 'Inter, sans-serif', fontSize: 22, fontWeight: 500, color: '#000000', textAlign: 'center', margin: 0 }}>
                Analysing game...
              </h2>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 400, color: '#464646', textAlign: 'center', margin: 0, lineHeight: '150%', width: 370 }}>
                Your coach is hard at work! The game analysis and match replay will be ready in a few minutes.
              </p>
            </div>

            {/* CTA */}
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
            <AccuracyCard label={`${players.white} Accuracy`} value={recording.accuracyWhite ?? null} color="#009106" />
            <AccuracyCard label={`${players.black} Accuracy`} value={recording.accuracyBlack ?? null} color="#EF4444" />
          </div>

          {/* Opening row */}
          <div
            style={{ background: '#F7F7F7', border: '1px solid #EFEFEF', borderRadius: 12, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            <span className="text-[14px] font-semibold text-black" style={{ textTransform: 'capitalize' }}>Opening</span>
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-[4px]" style={{ flex: 1 }}>
                <span className="text-[11px] font-semibold text-text-body" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.5 }}>White</span>
                <span className="text-[13px] font-medium text-black">{recording.whiteOpening ?? '—'}</span>
              </div>
              <div style={{ width: 1, background: 'rgba(0,0,0,0.08)', alignSelf: 'stretch', flexShrink: 0 }} />
              <div className="flex flex-col gap-[4px]" style={{ flex: 1 }}>
                <span className="text-[11px] font-semibold text-text-body" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.5 }}>Black</span>
                <span className="text-[13px] font-medium text-black">{recording.blackOpening ?? '—'}</span>
              </div>
            </div>
          </div>

          {/* Win Probability chart */}
          <WinProbabilitySection tips={gameplayTips} keyMomentIndices={computeKeyMomentIndices(gameplayTips)} />

          {/* Badges row */}
          <BadgesRow tips={gameplayTips} keyMomentIndices={computeKeyMomentIndices(gameplayTips)} />

          {/* Match Summary */}
          <MatchSummaryCard summary={recording.shortOverview || recording.insights} />

          {/* Key Moments */}
          <KeyMomentsCard tips={gameplayTips} playerUrl={resolvedPlayerUrl} />

          {/* Insights & Patterns */}
          <InsightsPatternsCard keyPoints={recording.keyPoints} recordingStatus={recording.status} />
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
  const barWidth = value !== null ? `${Math.min(100, value)}%` : '0%';

  return (
    <div className="flex-1 flex flex-col gap-[24px]" style={{ background: '#F7F7F7', border: '1px solid #EFEFEF', borderRadius: 16, padding: 16 }}>
      {/* Label */}
      <span className="text-[14px] font-semibold text-black" style={{ textTransform: 'capitalize' }}>{label}</span>

      {/* Value + progress */}
      <div className="flex flex-col gap-[20px]">
        <div className="flex items-flex-end gap-[4px]">
          {value !== null ? (
            <>
              <span className="text-[36px] font-bold leading-none" style={{ color }}>
                {value}
              </span>
              <span className="text-[20px] font-semibold text-text-body" style={{ lineHeight: '28px', alignSelf: 'flex-end' }}>%</span>
            </>
          ) : (
            <span className="text-[14px] font-medium" style={{ color: '#464646', opacity: 0.4, lineHeight: '36px' }}>
              Pending
            </span>
          )}
        </div>
        {/* Progress bar */}
        <div className="relative h-[4px] rounded-[30px] bg-white overflow-hidden">
          <div className="absolute left-0 top-0 h-full rounded-[30px]" style={{ width: barWidth, background: value !== null ? color : 'transparent' }} />
        </div>
      </div>
    </div>
  );
}

// ── Win Probability Section ───────────────────────────────────────────────────

// ── Shared key-moment index computation ──────────────────────────────────────

const KM_IMPACT_RANK: Record<MoveQuality, number> = {
  blunder: 0, mistake: 1, brilliant: 2, great: 3,
  inaccuracy: 4, best: 5, excellent: 6, good: 7, book: 8,
};
const KM_MAX = 7;

function computeKeyMomentIndices(
  tips: { winChance?: number; winChanceBefore?: number; turn?: 'w' | 'b'; centipawnLoss?: number; engineEval?: number }[]
): Set<number> {
  const classified = tips.map((tip, idx) => ({
    idx,
    quality: classifyStoredMove({
      winChance: tip.winChance, winChanceBefore: tip.winChanceBefore,
      engineEval: tip.engineEval, centipawnLoss: tip.centipawnLoss, turn: tip.turn,
    }) as MoveQuality,
    centipawnLoss: tip.centipawnLoss,
  }));

  const keyMoments = classified.filter((t) => KEY_MOMENT_QUALITIES.has(t.quality));

  const capped = keyMoments.length > KM_MAX
    ? keyMoments
        .slice()
        .sort((a, b) => {
          const d = KM_IMPACT_RANK[a.quality] - KM_IMPACT_RANK[b.quality];
          return d !== 0 ? d : (b.centipawnLoss ?? 0) - (a.centipawnLoss ?? 0);
        })
        .slice(0, KM_MAX)
    : keyMoments;

  return new Set(capped.map((t) => t.idx));
}

function WinProbabilitySection({
  tips,
  keyMomentIndices,
}: {
  tips: { winChance?: number; winChanceBefore?: number; turn?: 'w' | 'b'; centipawnLoss?: number; engineEval?: number }[];
  keyMomentIndices: Set<number>;
}) {
  // ── Layout constants (match Figma SVG: 743×252 card) ──────────────────────
  // Chart canvas within the SVG viewBox
  const CHART_W = 691;   // matches rect width in Figma (726.831 - 35.573 ≈ 691)
  const CHART_H = 168;   // y range: 53 → 221 = 168px

  // Y coordinates for each percentage label (Figma: 100→y=0, 75→y=42, 50→y=84, 25→y=126, 0→y=168)
  const Y_LABELS: { val: number; y: number }[] = [
    { val: 100, y: 0   },
    { val: 75,  y: 42  },
    { val: 50,  y: 84  },
    { val: 25,  y: 126 },
    { val: 0,   y: 168 },
  ];

  const toY = (wc: number) => ((100 - wc) / 100) * CHART_H;

  // ── Data ────────────────────────────────────────────────────────────────────
  const tipData    = tips.filter((t) => typeof t.winChance === 'number');
  const dataPoints = tipData.map((t) => t.winChance as number);
  const hasData    = dataPoints.length >= 2;

  // Classify so key-moment dots can be coloured by quality
  const pointQualities = tipData.map((t) =>
    classifyStoredMove({
      winChance: t.winChance, winChanceBefore: t.winChanceBefore,
      turn: t.turn, centipawnLoss: t.centipawnLoss, engineEval: t.engineEval,
    }) as MoveQuality
  );

  const points = dataPoints.map((wc, i) => ({
    x: dataPoints.length === 1 ? 0 : (i / (dataPoints.length - 1)) * CHART_W,
    y: toY(wc),
    wc,
  }));

  const polylinePoints = points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const midY = toY(50);

  return (
    <div style={{ background: '#F7F7F7', border: '0.617px solid #EFEFEF', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#000000', fontFamily: 'Inter, sans-serif', textTransform: 'uppercase', letterSpacing: '0.005em' }}>
          Win Probability
        </span>
        {/* Legend — explains the single line and the 50% baseline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="20" height="8" viewBox="0 0 20 8" style={{ flexShrink: 0 }}>
              <line x1="0" y1="4" x2="20" y2="4" stroke="#464646" strokeWidth="1.5" strokeOpacity="0.5" strokeLinecap="round" />
            </svg>
            <span style={{ fontSize: 12, fontWeight: 500, color: '#464646', fontFamily: 'Inter, sans-serif' }}>White's win %</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="20" height="8" viewBox="0 0 20 8" style={{ flexShrink: 0 }}>
              <line x1="0" y1="4" x2="20" y2="4" stroke="#FF4000" strokeWidth="1.23" strokeDasharray="2.47 2.47" strokeLinecap="round" />
            </svg>
            <span style={{ fontSize: 12, fontWeight: 500, color: '#464646', fontFamily: 'Inter, sans-serif' }}>Equal (50%)</span>
          </div>
        </div>
      </div>

      {/* ── Chart ── */}
      <div style={{ display: 'flex', gap: 8 }}>

        {/* Y-axis labels — fixed height matching chart */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-end', width: 22, flexShrink: 0, height: CHART_H + 20 }}>
          {Y_LABELS.map(({ val }) => (
            <span key={val} style={{ fontSize: 10, fontWeight: 500, color: '#969696', fontFamily: 'Inter, sans-serif', letterSpacing: '0.005em', lineHeight: 1 }}>
              {val}
            </span>
          ))}
          {/* spacer for x-axis label row */}
          <span style={{ fontSize: 10, color: 'transparent', lineHeight: 1 }}>0</span>
        </div>

        {/* SVG chart area — explicit height so the SVG renders */}
        <div style={{ flex: 1, height: CHART_H + 20 }}>
          <svg
            width="100%"
            height={CHART_H + 20}
            viewBox={`0 0 ${CHART_W} ${CHART_H + 20}`}
            preserveAspectRatio="none"
            style={{ display: 'block', overflow: 'visible' }}
          >
            {/* Grid lines at 0/25/50/75/100 */}
            {Y_LABELS.map(({ y }) => (
              <line key={y} x1={0} y1={y} x2={CHART_W} y2={y} stroke="#E5E7EB" strokeWidth={0.8} />
            ))}

            {!hasData ? (
              <text x={CHART_W / 2} y={CHART_H / 2} textAnchor="middle" dominantBaseline="middle" fontSize={12} fill="#969696" fontFamily="Inter, sans-serif">
                Game data not available
              </text>
            ) : (
              <>
                {/* 50% dashed baseline */}
                <line
                  x1={0} y1={midY} x2={CHART_W} y2={midY}
                  stroke="#FF4000"
                  strokeWidth={1.23}
                  strokeLinecap="round"
                  strokeDasharray="2.47 2.47"
                />

                {/* Win probability line */}
                <polyline
                  points={polylinePoints}
                  fill="none"
                  stroke="#464646"
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeOpacity={0.5}
                />

                {/* Dots — only at positions that appear in the Key Moments card */}
                {points.map((p, i) => {
                  if (!keyMomentIndices.has(i)) return null;
                  const badge = MOVE_BADGE[pointQualities[i]];
                  return (
                    <circle
                      key={i}
                      cx={p.x}
                      cy={p.y}
                      r={3.5}
                      fill={badge.color}
                      stroke="white"
                      strokeWidth={1.23}
                    />
                  );
                })}

                {/* X-axis move numbers */}
                {points.map((p, i) => (
                  <text
                    key={`lbl-${i}`}
                    x={p.x}
                    y={CHART_H + 14}
                    textAnchor="middle"
                    fontSize={9}
                    fill="#969696"
                    fontFamily="Inter, sans-serif"
                  >
                    {i + 1}
                  </text>
                ))}
              </>
            )}
          </svg>
        </div>
      </div>
    </div>
  );
}

// ── Badges Row ────────────────────────────────────────────────────────────────
// Shows one pill per distinct quality in the capped key moments —
// acts as a colour legend for the win probability chart dots.

function BadgesRow({
  tips,
  keyMomentIndices,
}: {
  tips: { winChance?: number; winChanceBefore?: number; turn?: 'w' | 'b'; centipawnLoss?: number; engineEval?: number }[];
  keyMomentIndices: Set<number>;
}) {
  const qualityOrder: MoveQuality[] = [
    'brilliant', 'great', 'best', 'inaccuracy', 'mistake', 'blunder',
  ];

  const presentQualities = new Set<MoveQuality>();
  keyMomentIndices.forEach((idx) => {
    const tip = tips[idx];
    if (!tip) return;
    const q = classifyStoredMove({
      winChance: tip.winChance, winChanceBefore: tip.winChanceBefore,
      turn: tip.turn, centipawnLoss: tip.centipawnLoss, engineEval: tip.engineEval,
    }) as MoveQuality;
    if (KEY_MOMENT_QUALITIES.has(q)) presentQualities.add(q);
  });

  const badges = qualityOrder.filter((q) => presentQualities.has(q));
  if (!badges.length) return null;

  return (
    <div className="flex items-center gap-[8px] flex-wrap">
      {badges.map((q) => {
        const b = MOVE_BADGE[q];
        return (
          <div
            key={q}
            className="flex items-center gap-[5px]"
            style={{ background: b.bg, border: `1px solid ${b.color}`, borderRadius: 6, padding: '4px 10px' }}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" style={{ flexShrink: 0 }}>
              <circle cx="4" cy="4" r="3.5" fill={b.color} />
            </svg>
            <span style={{ fontSize: 12, fontWeight: 600, color: b.color, fontFamily: 'Inter, sans-serif', letterSpacing: '0.005em' }}>
              {b.label}
            </span>
          </div>
        );
      })}
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

// MoveQuality, MOVE_BADGE, KEY_MOMENT_QUALITIES are imported from the shared
// moveClassification module at the top of this file.

function KeyMomentsCard({
  tips,
  playerUrl,
}: {
  tips: {
    id: string;
    startTime: number;
    tip: string;
    centipawnLoss?: number;
    winChance?: number;
    winChanceBefore?: number;
    engineEval?: number;
    turn?: 'w' | 'b';
  }[];
  playerUrl: string | null | undefined;
}) {
  // Classify all tips using the WP-based shared classifier, preserving original index for move number
  const classified = tips.map((tip, idx) => ({
    ...tip,
    originalIndex: idx,
    quality: classifyStoredMove({
      winChance: tip.winChance,
      winChanceBefore: tip.winChanceBefore,
      engineEval: tip.engineEval,
      centipawnLoss: tip.centipawnLoss,
      turn: tip.turn,
    }) as MoveQuality,
  }));

  const keyMoments = classified.filter((t) => KEY_MOMENT_QUALITIES.has(t.quality));

  // Impact rank: lower = more impactful. Blunders/mistakes outrank inaccuracies;
  // brilliant/great/best are notable positives ranked below errors in priority.
  const IMPACT_RANK: Record<MoveQuality, number> = {
    blunder:    0,
    mistake:    1,
    brilliant:  2,
    great:      3,
    inaccuracy: 4,
    best:       5,
    excellent:  6,
    good:       7,
    book:       8,
  };

  // Cap at 7: keep the most impactful moves, then restore chronological order.
  const MAX_KEY_MOMENTS = 7;
  const cappedKeyMoments = keyMoments.length > MAX_KEY_MOMENTS
    ? keyMoments
        .slice()
        .sort((a, b) => {
          const rankDiff = IMPACT_RANK[a.quality] - IMPACT_RANK[b.quality];
          if (rankDiff !== 0) return rankDiff;
          // Within the same tier, prefer higher WP loss (more impactful)
          return (b.centipawnLoss ?? 0) - (a.centipawnLoss ?? 0);
        })
        .slice(0, MAX_KEY_MOMENTS)
        .sort((a, b) => a.originalIndex - b.originalIndex) // restore move order
    : keyMoments;

  // Fallback: if no key moments, show the 5 most impactful by CPL
  const displayTips = cappedKeyMoments.length > 0
    ? cappedKeyMoments
    : classified
        .filter((t) => t.centipawnLoss !== undefined)
        .sort((a, b) => (b.centipawnLoss ?? 0) - (a.centipawnLoss ?? 0))
        .slice(0, 5);

  if (!displayTips.length) return null;

  const openAtTimestamp = (seconds: number) => {
    if (!playerUrl) return;
    const hasQuery = playerUrl.includes('?');
    const timedUrl = `${playerUrl}${hasQuery ? '&' : '?'}t=${Math.max(0, Math.floor(seconds))}`;
    window.electronAPI?.app.openExternalLink(timedUrl);
  };

  // Derive chess move number from the tip's position in the full tip list.
  // Each full move = white tip + black tip, so move number = floor(originalIndex / 2) + 1.
  const getMoveNumber = (originalIndex: number): number => Math.floor(originalIndex / 2) + 1;

  // Derive a short move label from the tip text (SAN notation)
  const getMoveLabel = (tipText: string): string => {
    const moveMatch = tipText.match(/\b([NBRQK]?[a-h]?[1-8]?x?[a-h][1-8](?:=[NBRQ])?[+#]?)\b/);
    return moveMatch ? moveMatch[1] : '—';
  };

  return (
    <div
      style={{
        background: '#F7F7F7',
        border: '1px solid #EFEFEF',
        borderRadius: 16,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* Section title */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: '#000000',
            letterSpacing: '0.005em',
            textTransform: 'uppercase',
          }}
        >
          Key Moments
        </span>
        <span style={{ fontSize: 12, color: '#464646', opacity: 0.5, letterSpacing: '0.005em' }}>
          {displayTips.length} move{displayTips.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Rows table */}
      <div
        style={{
          background: '#FFFFFF',
          border: '1px solid #EFEFEF',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        {displayTips.map((tip, index) => {
          const cfg = MOVE_BADGE[tip.quality];
          const moveLabel = getMoveLabel(tip.tip);
          const moveNumber = getMoveNumber(tip.originalIndex);
          const shortDesc = tip.tip.length > 110 ? tip.tip.slice(0, 107) + '…' : tip.tip;
          const isLast = index === displayTips.length - 1;

          return (
            <div
              key={tip.id}
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                padding: 16,
                gap: 20,
                height: 72,
                background: '#FFFFFF',
                borderBottom: isLast ? 'none' : '1px solid #EFEFEF',
                boxSizing: 'border-box',
              }}
            >
              {/* left — "MOVE 4" label + "Bc4" SAN, flex-col, 56×40 */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'flex-start',
                  gap: 8,
                  width: 56,
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: 400,
                    fontSize: 12,
                    lineHeight: '16px',
                    color: '#464646',
                  }}
                >
                  MOVE {moveNumber}
                </span>
                <span
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: 600,
                    fontSize: 20,
                    lineHeight: '16px',
                    color: '#000000',
                  }}
                >
                  {moveLabel}
                </span>
              </div>

              {/* vertical divider — rotated border, aligns via alignSelf stretch */}
              <div style={{ width: 1, alignSelf: 'stretch', background: '#EFEFEF', flexShrink: 0 }} />

              {/* title column — description text + play row, flex-col, flex-grow 1 */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'flex-start',
                  gap: 8,
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {/* description */}
                <p
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: 400,
                    fontSize: 14,
                    lineHeight: '16px',
                    color: '#464646',
                    margin: 0,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    width: '100%',
                  }}
                  title={tip.tip}
                >
                  {shortDesc}
                </p>

                {/* play row — triangle icon + "Jump to X:XX" */}
                <button
                  onClick={() => openAtTimestamp(tip.startTime)}
                  disabled={!playerUrl}
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    padding: 0,
                    background: 'none',
                    border: 'none',
                    cursor: playerUrl ? 'pointer' : 'not-allowed',
                    opacity: playerUrl ? 1 : 0.4,
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M11 6C11 6.152 10.962 6.303 10.886 6.436C10.811 6.569 10.703 6.68 10.573 6.759L2.168 11.718C2.031 11.801 1.875 11.847 1.715 11.850C1.554 11.852 1.396 11.813 1.257 11.735C1.118 11.657 1.002 11.543 0.922 11.407C0.843 11.271 0.800 11.116 0.800 10.958V1.042C0.800 0.884 0.843 0.729 0.922 0.593C1.002 0.457 1.118 0.343 1.257 0.265C1.396 0.187 1.554 0.148 1.715 0.150C1.875 0.153 2.031 0.199 2.168 0.282L10.573 5.241C10.703 5.320 10.811 5.431 10.886 5.564C10.962 5.697 11 5.848 11 6Z"
                      fill="#C14103"
                    />
                  </svg>
                  <span
                    style={{
                      fontFamily: 'Inter, sans-serif',
                      fontWeight: 500,
                      fontSize: 13,
                      lineHeight: '16px',
                      color: '#464646',
                    }}
                  >
                    Jump to {formatTipTimestamp(tip.startTime)}
                  </span>
                </button>
              </div>

              {/* badge */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: 6,
                  gap: 1,
                  background: cfg.bg,
                  borderRadius: 6,
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: 500,
                    fontSize: 13,
                    lineHeight: '16px',
                    letterSpacing: '0.005em',
                    color: cfg.color,
                  }}
                >
                  {cfg.label}
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

function InsightsPatternsCard({
  keyPoints,
  recordingStatus,
}: {
  keyPoints: Array<{ topic: string; points: string[] }> | null | undefined;
  recordingStatus: string;
}) {
  const hasData = keyPoints && keyPoints.length > 0;
  const isProcessing = recordingStatus === 'processing' || recordingStatus === 'recording';
  const placeholderText = isProcessing ? 'Analysis in progress…' : 'No insights available for this session.';

  return (
    <div
      style={{
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        padding: 16,
        gap: 20,
        background: '#F7F7F7',
        border: '1px solid #EFEFEF',
        borderRadius: 16,
        alignSelf: 'stretch',
      }}
    >
      {/* Header */}
      <span
        style={{
          fontFamily: 'Inter, sans-serif',
          fontWeight: 600,
          fontSize: 14,
          lineHeight: '17px',
          textTransform: 'uppercase',
          color: '#000000',
        }}
      >
        Insights &amp; Patterns
      </span>

      {/* Content list or placeholder */}
      {hasData ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 10,
            alignSelf: 'stretch',
          }}
        >
          {keyPoints.map((kp, idx) => (
            <div
              key={idx}
              style={{
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                padding: '8px 16px',
                gap: 16,
                background: '#FFFFFF',
                border: '1px solid #EFEFEF',
                borderRadius: 12,
                alignSelf: 'stretch',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 2,
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: 500,
                    fontSize: 13,
                    lineHeight: '24px',
                    letterSpacing: '0.005em',
                    color: '#C14103',
                    alignSelf: 'stretch',
                  }}
                >
                  {kp.topic}
                </span>
                {kp.points[0] && (
                  <span
                    style={{
                      fontFamily: 'Inter, sans-serif',
                      fontWeight: 400,
                      fontSize: 13,
                      lineHeight: '20px',
                      letterSpacing: '0.005em',
                      color: '#1E1E1E',
                      alignSelf: 'stretch',
                    }}
                  >
                    {kp.points[0]}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            alignSelf: 'stretch',
            padding: '24px 0',
          }}
        >
          <span
            style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: 13,
              color: '#464646',
              opacity: 0.5,
            }}
          >
            {placeholderText}
          </span>
        </div>
      )}
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
  void recordingId;

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
              {/* Tip content */}
              <p className="text-[13px] text-black" style={{ lineHeight: '20px' }}>
                {tip.tip}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── PostGameChatPanel (exported for external use) ────────────────────────────

export function PostGameChatPanel({ recordingId, tips }: { recordingId: number; tips: { id: string; startTime: number; tip: string }[] }) {
  return <CoachNotesSection recordingId={recordingId} tips={tips} />;
}

export default RecordingDetailPage;