/**
 * Recording Detail Page
 *
 * Full page view for a recording with:
 * - Header: back button, title, metadata, actions
 * - Left panel: Session summary, key points, checklist
 * - Right panel: Video player, chat button
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  ArrowLeft,
  Calendar,
  Clock,
  FileText,
  List,
  CheckSquare,
  MessageCircle,
  Sparkles,
  Upload,
  Link2,
  ChevronDown,
  ChevronUp,
  Check,
  Loader2,
  Video,
  Copy,
  Crosshair,
  Send,
  X,
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
  const [showAllKeyPoints, setShowAllKeyPoints] = useState(false);
  const [collectionId, setCollectionId] = useState<string | null>(null);

  // Fetch recording data
  const { data: recording, isLoading } = trpc.recordings.get.useQuery(
    { recordingId },
    { enabled: !!recordingId }
  );

  // Fetch fresh playback URL to avoid stale player links causing stream reconnect loops.
  const { data: playbackData } = trpc.recordings.getPlaybackUrl.useQuery(
    { recordingId },
    { enabled: !!recordingId }
  );

  // Fetch gameplay tips so the post-game coach chat has session context.
  const { data: gameplayTips = [] } = trpc.recordings.getGameplayTips.useQuery(
    { recordingId },
    { enabled: !!recordingId }
  );

  // Populate collectionId if missing
  const populateCollectionIdMutation = trpc.recordings.populateCollectionId.useMutation();

  useEffect(() => {
    if (recording?.videoId && !recording?.collectionId && !collectionId) {
      populateCollectionIdMutation.mutateAsync({ recordingId }).then((result) => {
        if (result.collectionId) {
          setCollectionId(result.collectionId);
        }
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
        <button
          onClick={onBack}
          className="text-brand hover:underline"
        >
          Go back
        </button>
      </div>
    );
  }

  const isGameSession = !!recording.gameId;
  const title = recording.meetingName || `Recording - ${formatDate(recording.createdAt)}`;
  const resolvedPlayerUrl = playbackData?.playerUrl || recording.playerUrl;
  const isVideoReady = recording.status === 'available' && !!resolvedPlayerUrl;

  return (
    <div className="bg-surface-muted h-full flex flex-col pt-[10px] px-[10px]">
      {/* Header */}
      <Header
        title={title}
        recordingId={recordingId}
        createdAt={recording.createdAt}
        duration={recording.duration}
        playerUrl={resolvedPlayerUrl}
        onBack={onBack}
      />

      {/* Main Content */}
      <div className="flex-1 bg-white border border-border-default rounded-[20px] p-[20px] pb-[40px] flex gap-[30px] overflow-hidden mb-[10px]">
        {/* Left Panel - Session Insights (scrollable) */}
        <div className="flex-1 flex flex-col gap-[30px] min-w-0 overflow-y-auto pr-[10px]">
          {/* Section Header */}
          <div className="flex items-center gap-[4px]">
            <Sparkles className="h-5 w-5 text-[#ec5b16]" />
            <h2 className="text-[18px] font-semibold text-black tracking-[0.09px]">
              Session Insights
            </h2>
          </div>

          {/* Cards */}
          <div className="flex flex-col gap-[20px] pb-[20px]">
            {/* Session Summary Card */}
            <SummaryCard summary={recording.shortOverview || recording.insights} />

            {/* Key Points Card */}
            <KeyPointsCard
              keyPoints={recording.keyPoints}
              expanded={showAllKeyPoints}
              onToggle={() => setShowAllKeyPoints(!showAllKeyPoints)}
            />

            {/* In-match Suggestions Timeline */}
            <GameplayTipsCard
              recordingId={recordingId}
              playerUrl={resolvedPlayerUrl}
            />

            {/* Post-Game Coach Chat */}
            <PostGameChatPanel
              recordingId={recordingId}
              tips={gameplayTips}
            />

            {/* Action Items Card (Post-Session Checklist) */}
            <ActionItemsCard
              recordingId={recordingId}
              checklist={recording.postMeetingChecklist}
              completedIndices={recording.postMeetingChecklistCompleted}
            />
          </div>
        </div>

        {/* Right Panel - Video & Transcript (sticky) */}
        <div className="flex-1 flex flex-col gap-[30px] min-w-0 sticky top-0 self-start">
          {/* Video Player */}
          <VideoPlayerSection
            playerUrl={resolvedPlayerUrl}
            isReady={isVideoReady}
          />

          {/* Chat with Video Button */}
          <div className="flex justify-center">
            <ChatWithVideoButton
              videoId={recording.videoId}
              collectionId={collectionId}
              disabled={!isVideoReady}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

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
    <div className="flex gap-[12px] items-start p-[20px]">
      {/* Left: Back + Title */}
      <div className="flex-1 flex gap-[16px] items-start">
        {/* Back Button */}
        <div className="pt-[2px]">
          <button
            onClick={onBack}
            className="w-[28px] h-[28px] bg-white border border-black/20 rounded-[6.5px] flex items-center justify-center hover:bg-gray-50 transition-colors"
          >
            <ArrowLeft className="h-[15px] w-[15px] text-black" />
          </button>
        </div>

        {/* Title & Metadata */}
        <div className="flex-1 flex flex-col gap-[10px]">
          <h1 className="text-[24px] font-semibold text-black tracking-[0.12px]">
            {title}
          </h1>
          <div className="flex items-center gap-[20px]">
            {/* Date */}
            <div className="flex items-center gap-[4px]">
              <Calendar className="h-4 w-4 text-[#969696]" />
              <span className="text-[14px] text-[#464646] tracking-[0.07px]">
                {formatDate(createdAt)}
              </span>
            </div>
            {/* Duration */}
            {duration && (
              <div className="flex items-center gap-[8px]">
                <Clock className="h-4 w-4 text-[#969696]" />
                <span className="text-[14px] text-[#464646] tracking-[0.07px]">
                  {formatDurationMinutes(duration)}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right: Action Buttons */}
      <div className="flex gap-[12px] items-start">
        {/* Export Button with Dropdown */}
        <div className="relative">
          <button
            onClick={() => setExportOpen(!exportOpen)}
            disabled={downloadingVideo}
            className={cn(
              "flex items-center gap-[6px] border rounded-[12px] px-[16px] py-[12px] shadow-[0px_1.27px_15.27px_0px_rgba(0,0,0,0.05)] transition-colors",
              exportOpen
                ? "bg-chat-user border-chat-note-border"
                : "bg-white border-[#efefef] hover:bg-[#efefef] hover:border-[#969696]"
            )}
          >
            {downloadingVideo ? (
              <Loader2 className="h-5 w-5 text-black animate-spin" />
            ) : (
              <Upload className="h-5 w-5 text-black" />
            )}
            <span className="text-[14px] font-semibold text-black tracking-[-0.28px]">
              Export
            </span>
            <ChevronDown className="h-5 w-5 text-black" />
          </button>

          {/* Dropdown Menu */}
          {exportOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
              <div className="absolute right-0 top-full mt-2 z-20 bg-white border border-[#efefef] rounded-[12px] shadow-[0px_17px_17px_0px_rgba(0,0,0,0.12),0px_4px_9px_0px_rgba(0,0,0,0.14)] p-[8px] min-w-[180px]">
                <button
                  onClick={handleDownloadVideo}
                  className="w-full flex items-center gap-[6px] px-[10px] py-[8px] rounded-[10px] hover:bg-[#efefef] transition-colors"
                >
                  <Video className="h-5 w-5 text-black" />
                  <span className="text-[13px] font-medium text-black">Video</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Copy Video Link Button */}
        <button
          onClick={handleCopyLink}
          disabled={!playerUrl || copyState !== 'idle'}
          className={cn(
            "flex items-center gap-[4px] rounded-[12px] px-[14px] py-[12px] shadow-[0px_1.27px_15.27px_0px_rgba(0,0,0,0.05)] transition-colors",
            copyState === 'copied' ? "bg-[#007657]" :
            copyState === 'copying' ? "bg-[#ff7e32]" :
            "bg-brand-cta hover:bg-brand-cta-hover",
            !playerUrl && "opacity-50 cursor-not-allowed"
          )}
        >
          {copyState === 'copied' ? (
            <Check className="h-5 w-5 text-white" />
          ) : copyState === 'copying' ? (
            <Loader2 className="h-5 w-5 text-white animate-spin" />
          ) : (
            <Link2 className="h-5 w-5 text-white" />
          )}
          <span className="text-[14px] font-semibold text-white tracking-[-0.28px]">
            {copyState === 'copied' ? "Link copied!" :
             copyState === 'copying' ? "Creating link..." :
             "Copy video link"}
          </span>
        </button>
      </div>
    </div>
  );
}

interface SummaryCardProps {
  summary: string | null | undefined;
}

function normalizeGameSummary(summary: string): string {
  return summary
    .replace(/\bIn the meeting titled\b/gi, 'In this match titled')
    .replace(/\bmeeting\b/gi, 'session')
    .replace(/\bagenda\b/gi, 'gameplan')
    .replace(/\bchecklist\b/gi, 'next-match goals')
    .replace(/\bpurpose of the meeting\b/gi, 'purpose of the session')
    .replace(/\bcontent and purpose of the meeting\b/gi, 'gameplay context and purpose of the session');
}

function SummaryCard({ summary }: SummaryCardProps) {
  const [copied, setCopied] = useState(false);

  if (!summary) return null;

  const displaySummary = normalizeGameSummary(summary);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(displaySummary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-chat-user border border-[var(--color-warm-tint-border)] rounded-[16px] p-[20px] flex flex-col gap-[16px]">
      {/* Header */}
      <div className="flex items-center gap-[8px]">
        <FileText className="h-5 w-5 text-[#ec5b16]" />
        <h3 className="flex-1 text-[16px] font-medium text-black tracking-[0.08px]">
          Session Summary
        </h3>
        <button
          onClick={handleCopy}
          className="flex items-center gap-[4px] px-[10px] py-[6px] rounded-[8px] text-[12px] font-medium text-[#ec5b16] hover:bg-[#ffe9d3] transition-colors"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      {/* Content */}
      <p className="text-[14px] text-[#2d2d2d] leading-[20px] tracking-[0.07px]">
        {displaySummary}
      </p>
    </div>
  );
}

interface KeyPointsCardProps {
  keyPoints: Array<{ topic: string; points: string[] }> | null | undefined;
  expanded: boolean;
  onToggle: () => void;
}

function KeyPointsCard({ keyPoints, expanded, onToggle }: KeyPointsCardProps) {
  const [copied, setCopied] = useState(false);

  if (!keyPoints || keyPoints.length === 0) return null;

  const handleCopy = async () => {
    const text = keyPoints.map((kp, idx) => {
      const points = kp.points.map(p => `  • ${p}`).join('\n');
      return `${idx + 1}. ${kp.topic}\n${points}`;
    }).join('\n\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn(
      "bg-chat-user border border-[var(--color-warm-tint-border)] rounded-[16px] p-[20px] flex flex-col gap-[16px] relative overflow-hidden",
      !expanded && "max-h-[200px]"
    )}>
      {/* Header */}
      <div className="flex items-center gap-[8px]">
        <List className="h-5 w-5 text-[#ec5b16]" />
        <h3 className="flex-1 text-[16px] font-medium text-black tracking-[0.08px]">
          Key Points
        </h3>
        <button
          onClick={handleCopy}
          className="flex items-center gap-[4px] px-[10px] py-[6px] rounded-[8px] text-[12px] font-medium text-[#ec5b16] hover:bg-[#ffe9d3] transition-colors z-20"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {/* Content */}
      <div className="flex flex-col text-[14px] text-[#2d2d2d]">
        {keyPoints.map((kp, idx) => (
          <div key={idx} className="mb-2">
            <p className="font-semibold leading-[24px]">
              {idx + 1}. {kp.topic}
            </p>
            <ul className="list-disc ml-[42px]">
              {kp.points.map((point, pIdx) => (
                <li key={pIdx} className="leading-[24px]">
                  {point}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Gradient Overlay & See More Button */}
      {!expanded && (
        <>
          <div className="absolute bottom-0 left-0 right-0 h-[52px] bg-gradient-to-t from-[var(--color-chat-user)] to-transparent pointer-events-none" />
          <button
            onClick={onToggle}
            className="absolute bottom-[6px] left-1/2 -translate-x-1/2 flex items-center gap-px bg-white border border-[#ffcfa5] rounded-full px-[12px] py-[8px] hover:bg-gray-50 transition-colors"
          >
            <span className="text-[13px] font-medium text-[#1f2937] tracking-[0.065px] px-[4px]">
              See more
            </span>
            <ChevronDown className="h-4 w-4 text-[#1f2937]" />
          </button>
        </>
      )}
    </div>
  );
}

interface ActionItemsCardProps {
  recordingId: number;
  checklist: string[] | null | undefined;
  completedIndices: number[] | null | undefined;
}

function ActionItemsCard({ recordingId, checklist, completedIndices }: ActionItemsCardProps) {
  const [checked, setChecked] = useState<Set<number>>(new Set(completedIndices || []));
  const updateChecklistMutation = trpc.recordings.updateChecklistCompletion.useMutation();

  // Sync local state when completedIndices changes
  useEffect(() => {
    setChecked(new Set(completedIndices || []));
  }, [completedIndices]);

  const handleToggle = (idx: number) => {
    setChecked(prev => {
      const newSet = new Set(prev);
      if (newSet.has(idx)) {
        newSet.delete(idx);
      } else {
        newSet.add(idx);
      }
      // Persist to DB
      updateChecklistMutation.mutate({
        recordingId,
        completedIndices: Array.from(newSet),
      });
      return newSet;
    });
  };

  const isEmpty = !checklist || checklist.length === 0;

  return (
    <div className="bg-surface-muted border border-border-default rounded-[16px] p-[20px] flex flex-col gap-[16px]">
      {/* Header */}
      <div className="flex items-center gap-[8px]">
        <CheckSquare className="h-5 w-5 text-[#ec5b16]" />
        <h3 className="text-[16px] font-medium text-black tracking-[0.08px]">
          Action Items
        </h3>
      </div>

      {/* Content */}
      {isEmpty ? (
        <p className="text-[14px] text-[#969696] italic">
          No post-session agenda detected
        </p>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {checklist.map((item, idx) => {
            const isChecked = checked.has(idx);
            return (
              <div
                key={idx}
                onClick={() => handleToggle(idx)}
                className="bg-white border border-[#efefef] rounded-[8px] px-[16px] py-[12px] flex items-start gap-[12px] cursor-pointer hover:bg-gray-50 transition-colors"
              >
                {/* Checkbox */}
                <div className={cn(
                  "w-4 h-4 shrink-0 rounded border flex items-center justify-center mt-[2px]",
                  isChecked ? "bg-brand border-brand" : "border-brand"
                )}>
                  {isChecked && <Check className="h-3 w-3 text-white" />}
                </div>
                <span className={cn(
                  "text-[14px] leading-[20px] tracking-[0.07px]",
                  isChecked ? "text-[#969696] line-through" : "text-black"
                )}>
                  {item}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface VideoPlayerSectionProps {
  playerUrl: string | null | undefined;
  isReady: boolean;
}

function VideoPlayerSection({ playerUrl, isReady }: VideoPlayerSectionProps) {
  const embedUrl = playerUrl?.replace('/watch', '/embed');

  return (
    <div className="border border-[#efefef] rounded-[16px] px-[6px] py-[5px]">
      <div className="aspect-video rounded-[16px] border border-black/10 overflow-hidden bg-gray-100">
        {isReady && embedUrl ? (
          <iframe
            src={embedUrl}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen 
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-[#969696]">
            <Loader2 className="h-8 w-8 animate-spin text-[#ec5b16]" />
            <p className="text-[14px]">Loading the video...</p>
          </div>
        )}
      </div>
    </div>
  );
}

interface ChatWithVideoButtonProps {
  videoId: string | null | undefined;
  collectionId: string | null | undefined;
  disabled: boolean;
}

function ChatWithVideoButton({ videoId, collectionId, disabled }: ChatWithVideoButtonProps) {
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
        "w-[248px] h-[52px] rounded-[32px] shadow-[0px_2px_3px_0px_rgba(0,0,0,0.18)] relative overflow-hidden",
        (disabled || !videoId || !collectionId) && "opacity-50 cursor-not-allowed"
      )}
    >
      {/* Gradient Background */}
      <div
        className="absolute inset-0 rounded-[32px] border-2 border-[#494949]"
        style={{
          background: 'linear-gradient(260deg, rgb(0, 0, 0) 4.66%, rgb(30, 30, 30) 99.38%)',
        }}
      >
        <div className="absolute inset-0 rounded-[inherit] shadow-[inset_0px_4px_4px_0px_rgba(255,255,255,0.32)]" />
      </div>

      {/* Content */}
      <div className="absolute inset-0 flex items-center justify-center gap-[6px]">
        <MessageCircle className="h-5 w-5 text-white" />
        <span className="text-[16px] font-medium text-white tracking-[-0.08px]">
          Chat with video
        </span>
      </div>
    </button>
  );
}

function formatTipTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

interface GameplayTipsCardProps {
  recordingId: number;
  playerUrl: string | null | undefined;
}

function GameplayTipsCard({ recordingId, playerUrl }: GameplayTipsCardProps) {
  const { data: tips = [] } = trpc.recordings.getGameplayTips.useQuery(
    { recordingId },
    { enabled: !!recordingId }
  );

  if (!tips.length) return null;

  const openAtTimestamp = (seconds: number) => {
    if (!playerUrl) return;
    const hasQuery = playerUrl.includes('?');
    const timedUrl = `${playerUrl}${hasQuery ? '&' : '?'}t=${Math.max(0, Math.floor(seconds))}`;
    window.electronAPI?.app.openExternalLink(timedUrl);
  };

  return (
    <div className="bg-surface-muted border border-border-default rounded-[16px] p-[16px] flex flex-col gap-[12px] max-h-[280px] overflow-y-auto">
      <div className="flex items-center gap-[8px]">
        <Crosshair className="h-4 w-4 text-chess-insight" />
        <h3 className="text-[15px] font-semibold text-[#1f2937]">In-match Suggestions</h3>
      </div>

      <div className="flex flex-col gap-[8px]">
        {tips.map((tip) => (
          <div key={tip.id} className="bg-white border border-[#e7e7ef] rounded-[10px] p-[10px] flex gap-[10px] items-start">
            <button
              type="button"
              onClick={() => openAtTimestamp(tip.startTime)}
              disabled={!playerUrl}
              className="shrink-0 text-[12px] font-semibold text-white bg-chess-insight px-[8px] py-[4px] rounded-[999px] hover:bg-[#dfe7ff] disabled:opacity-60 disabled:cursor-not-allowed"
              title={playerUrl ? 'Open video at this timestamp' : 'Video link not available yet'}
            >
              {formatTipTimestamp(tip.startTime)}
            </button>
            <p className="text-[13px] text-[#2d2d2d] leading-[18px]">{tip.tip}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// PostGameChatPanel
// ============================================================================

interface PostGameChatMsg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  tipCtx?: string;
}

interface PostGameChatPanelProps {
  recordingId: number;
  /** Pre-fetched gameplay tips used as context when the user asks a question. */
  tips: { id: string; startTime: number; tip: string }[];
}

function PostGameChatPanel({ recordingId, tips }: PostGameChatPanelProps) {
  void recordingId; // available for future per-recording persistence
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<PostGameChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefillCtx, setPrefillCtx] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  let idCounter = useRef(0);

  // Auto-scroll to newest message
  useEffect(() => {
    if (isExpanded) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isExpanded]);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    const question = input.trim();
    if (!question || isLoading) return;

    const tipCtx = prefillCtx ?? undefined;
    setPrefillCtx(null);
    setInput('');
    setIsExpanded(true);
    setError(null);

    // Build tip context block from recent session tips
    const tipsContext = tips.length > 0
      ? `Session coaching tips:\n${tips.slice(0, 5).map((t, i) => `${i + 1}. [${formatTipTimestamp(t.startTime)}] ${t.tip}`).join('\n')}`
      : '';
    const fullTipCtx = [tipsContext, tipCtx ? `Player is asking about: "${tipCtx}"` : '']
      .filter(Boolean).join('\n\n') || undefined;

    const userMsg: PostGameChatMsg = {
      id: `pgcm-${++idCounter.current}`,
      role: 'user',
      text: question,
      tipCtx,
    };
    setMessages((p) => [...p, userMsg]);
    setIsLoading(true);

    try {
      const api = getElectronAPI();
      if (!api) throw new Error('Electron API not available');
      const result = await api.liveAssist.chat(question, fullTipCtx);
      if (!result.success || !result.reply) {
        throw new Error(result.error || 'No reply received');
      }
      const assistantMsg: PostGameChatMsg = {
        id: `pgcm-${++idCounter.current}`,
        role: 'assistant',
        text: result.reply,
      };
      setMessages((p) => [...p, assistantMsg]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get a response');
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, prefillCtx, tips]);

  /** Called from a tip card's "Ask" button — pre-fills context and opens panel */
  const askAboutTip = useCallback((tipText: string) => {
    setPrefillCtx(tipText);
    setIsExpanded(true);
    setTimeout(() => inputRef.current?.focus(), 60);
  }, []);

  const hasMessages = messages.length > 0;

  return (
    <div className="border border-[#efefef] rounded-[16px] overflow-hidden flex flex-col">
      {/* Header */}
      <button
        className="bg-surface-muted border-b border-[#efefef] px-[16px] py-[10px] flex items-center gap-[8px] w-full text-left hover:bg-[#f0f0f5] transition-colors"
        onClick={() => setIsExpanded((v) => !v)}
      >
        <MessageCircle size={18} className="text-[#ec5b16] shrink-0" />
        <span className="font-medium text-[15px] text-black flex-1">Ask the Coach</span>
        <span className="text-[12px] text-[#969696] mr-2">Post-game analysis</span>
        {hasMessages && !isExpanded && (
          <span className="text-[11px] text-[#969696] bg-white border border-[#ededf3] rounded-full px-[6px] py-[1px]">
            {messages.length} message{messages.length !== 1 ? 's' : ''}
          </span>
        )}
        {isLoading && <Loader2 size={14} className="text-[#ec5b16] animate-spin" />}
        {isExpanded
          ? <ChevronUp size={16} className="text-[#969696]" />
          : <ChevronDown size={16} className="text-[#969696]" />}
      </button>

      {isExpanded && (
        <>
          {/* Message thread */}
          <div className="bg-white flex flex-col gap-[10px] p-[14px] max-h-[320px] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {messages.length === 0 && !isLoading ? (
              <p className="text-[13px] text-[#969696] text-center py-[12px]">
                Ask anything about this game — moves, tactics, key moments, or coaching tips.
              </p>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className={`flex flex-col gap-[4px] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  {msg.role === 'user' && msg.tipCtx && (
                    <p className="text-[11px] text-[#969696] max-w-[85%] text-right line-clamp-1 italic">
                      Re: "{msg.tipCtx.slice(0, 60)}{msg.tipCtx.length > 60 ? '…' : ''}"
                    </p>
                  )}
                  <div className={`rounded-[10px] px-[12px] py-[8px] max-w-[85%] text-[13px] leading-[20px] ${
                    msg.role === 'user'
                      ? 'bg-chat-user border border-chat-user-border text-text-body'
                      : 'bg-chat-coach border border-chat-coach-border text-black'
                  }`}>
                    {msg.role === 'assistant' ? (
                      <div className="prose prose-sm max-w-none text-[13px] leading-[20px] text-black [&_p]:mb-1 [&_p:last-child]:mb-0">
                        <ReactMarkdown>{msg.text}</ReactMarkdown>
                      </div>
                    ) : msg.text}
                  </div>
                </div>
              ))
            )}
            {isLoading && (
              <div className="flex items-start gap-[8px]">
                <div className="bg-chat-coach border border-chat-coach-border rounded-[10px] px-[12px] py-[8px] flex items-center gap-[6px]">
                  <Loader2 size={12} className="text-[#ec5b16] animate-spin" />
                  <span className="text-[13px] text-[#969696]">Thinking...</span>
                </div>
              </div>
            )}
            {error && (
              <div className="flex items-center gap-[6px] bg-[#fef2f2] border border-[#fecaca] rounded-[8px] px-[10px] py-[6px]">
                <span className="text-[12px] text-[#dc2626]">{error}</span>
                <button onClick={() => setError(null)} className="ml-auto text-[#dc2626] hover:opacity-70">
                  <X size={12} />
                </button>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Context badge (when a tip was selected) */}
          {prefillCtx && (
            <div className="bg-[#fff8f5] border-t border-[#fde0cc] px-[14px] py-[6px] flex items-center gap-[6px]">
              <span className="text-[11px] text-[#ec5b16] italic flex-1 truncate">
                Context: "{prefillCtx.slice(0, 70)}{prefillCtx.length > 70 ? '…' : ''}"
              </span>
              <button onClick={() => setPrefillCtx(null)} className="text-[#ec5b16] hover:opacity-70 shrink-0">
                <X size={11} />
              </button>
            </div>
          )}

          {/* Input */}
          <div className="bg-white border-t border-[#efefef] p-[10px]">
            <form onSubmit={handleSubmit} className="flex items-center gap-[8px]">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={prefillCtx ? 'Ask about this tip…' : 'Ask about this game, moves, or tactics…'}
                disabled={isLoading}
                className="flex-1 px-[12px] py-[8px] bg-surface-muted border border-[#ededf3] rounded-[8px] text-[13px] text-black placeholder:text-[#969696] focus:outline-none focus:border-[#ec5b16] focus:ring-1 focus:ring-[#ec5b16]/20 disabled:opacity-50 transition-colors"
              />
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="flex items-center justify-center w-[34px] h-[34px] bg-[#ec5b16] hover:bg-[#d9520f] rounded-[8px] disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
              >
                <Send size={14} className="text-white" />
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

export { PostGameChatPanel };

export default RecordingDetailPage;
