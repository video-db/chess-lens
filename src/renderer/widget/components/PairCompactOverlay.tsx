import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useWidgetChatStore } from '../chatStore';
import type {
  InsightCard,
  WidgetSessionState as SessionState,
  WidgetNudge as Nudge,
} from '../../../types/widget';
import { ChessLensIconBlack } from '../../components/ui/ChessLensIcon';
import { ChessLensWordmark } from '../../components/ui/ChessLensWordmark';

// ---------------------------------------------------------------------------
// Inline chess board renderer — no external dependencies
// ---------------------------------------------------------------------------

const PIECE_UNICODE: Record<string, string> = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
};

/** Parse the board part of a FEN string into an 8×8 array of piece chars or ''. */
function parseFenBoard(fenBoard: string): string[][] {
  const rows = fenBoard.split('/');
  return rows.map((rank) => {
    const cells: string[] = [];
    for (const ch of rank) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < parseInt(ch, 10); i++) cells.push('');
      } else {
        cells.push(ch);
      }
    }
    return cells;
  });
}

function ChessBoard({ fen }: { fen: string }) {
  const boardPart = fen.split(' ')[0];
  const board = useMemo(() => parseFenBoard(boardPart), [boardPart]);
  const size = 368; // match Figma board width
  const sq = size / 8;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: 'block', borderRadius: 14, border: '0.5px solid rgba(255,255,255,0.2)' }}
    >
      {board.map((rank, ri) =>
        rank.map((piece, ci) => {
          const light = (ri + ci) % 2 === 0;
          const x = ci * sq;
          const y = ri * sq;
          return (
            <g key={`${ri}-${ci}`}>
              <rect
                x={x} y={y} width={sq} height={sq}
                fill={light ? '#f0d9b5' : '#b58863'}
              />
              {piece && (
                <text
                  x={x + sq / 2}
                  y={y + sq / 2 + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={sq * 0.72}
                  style={{ userSelect: 'none' }}
                  fill={piece === piece.toUpperCase() ? '#fff' : '#111'}
                  stroke={piece === piece.toUpperCase() ? '#555' : '#ddd'}
                  strokeWidth={0.4}
                  paintOrder="stroke"
                >
                  {PIECE_UNICODE[piece] ?? piece}
                </text>
              )}
            </g>
          );
        })
      )}
      {/* File labels */}
      {'abcdefgh'.split('').map((f, i) => (
        <text
          key={f}
          x={i * sq + sq / 2}
          y={size - 1}
          textAnchor="middle"
          fontSize={9}
          fill="rgba(0,0,0,0.45)"
          style={{ userSelect: 'none' }}
        >{f}</text>
      ))}
      {/* Rank labels */}
      {[8,7,6,5,4,3,2,1].map((r, i) => (
        <text
          key={r}
          x={3}
          y={i * sq + sq / 2}
          dominantBaseline="middle"
          fontSize={9}
          fill="rgba(0,0,0,0.45)"
          style={{ userSelect: 'none' }}
        >{r}</text>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------

interface PairCompactOverlayProps {
  sessionState: SessionState;
  sayThis: InsightCard[];
  askThis: InsightCard[];
  visualDescription: string;
  nudge: Nudge | null;
  currentFen: string | null;
  /** FEN in the original player perspective (for the overlay board display). */
  displayFen: string | null;
  currentTurn: 'w' | 'b' | null;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onMuteMic: () => void;
  onUnmuteMic: () => void;
  onDismissCard: (type: 'sayThis' | 'askThis', id: string) => void;
  onDismissNudge?: () => void;
  stopDisabled?: boolean;
  statusText?: string;
}

function fmtElapsed(startTime?: number | null, endTime: number = Date.now()): string {
  if (!startTime) return '00:00';
  const sec = Math.max(0, Math.floor((endTime - startTime) / 1000));
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

// ---------------------------------------------------------------------------
// Send arrow icon for chat submit
// ---------------------------------------------------------------------------
function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 8H14M14 8L9 3M14 8L9 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Overlay header — exact Figma spec
// Left: logo mark (20.18×20.18) + wordmark (89.78×24) with gap 3.36px
// Right: collapse_content icon (20.18×20.18, #1E1E1E)
// ---------------------------------------------------------------------------
function OverlayHeader() {
  return (
    <div style={{
      background: '#F7F7F7',
      height: 40,
      padding: '8px 12px',
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10.09,
      boxSizing: 'border-box',
      WebkitAppRegion: 'drag',
    } as React.CSSProperties}>
      {/* Frame 2147223109 — logo mark + wordmark, flex-grow:1 */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 3.36, flex: 1, height: 24, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {/* Logo mark — Chess Lens icon, 20×20 */}
        <ChessLensIconBlack size={20} />
        {/* Wordmark */}
        <ChessLensWordmark size={13} variant="default" />
      </div>
      {/* Collapse icon — no-drag so it doesn't block click if needed */}
      <div style={{ display: 'flex', alignItems: 'center', width: 20.18, height: 20.18, flexShrink: 0, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M5.5 9L9 5.5M9 5.5H6M9 5.5V8.5M14.5 9L11 5.5M11 5.5H14M11 5.5V8.5M5.5 15L9 18.5M9 18.5H6M9 18.5V15.5M14.5 15L11 18.5M11 18.5H14M11 18.5V15.5" stroke="#1E1E1E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    </div>
  );
}

export function PairCompactOverlay({
  sessionState,
  sayThis,
  askThis,
  visualDescription,
  nudge,
  currentFen,
  displayFen,
  currentTurn,
  onStop,
  onPause,
  onResume,
  onMuteMic,
  onUnmuteMic,
  stopDisabled = false,
  statusText,
}: PairCompactOverlayProps) {
  const [now, setNow] = useState(Date.now());
  const [isExpanded, setIsExpanded] = useState(false);

  // ── Chat state ──
  const {
    messages: chatMessages,
    isOpen: chatOpen,
    isLoading: chatLoading,
    error: chatError,
    open: openChat,
    toggle: toggleChat,
    addMessage: chatAddMessage,
    setLoading: setChatLoading,
    setError: setChatError,
  } = useWidgetChatStore();

  const [chatInput, setChatInput] = useState('');
  const [chatPrefillCtx, setChatPrefillCtx] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const submitChatQuestion = useCallback(async (question: string, tipCtx?: string) => {
    if (!question.trim() || chatLoading) return;
    openChat();
    chatAddMessage({ role: 'user', text: question.trim(), tipCtx });
    setChatLoading(true);
    setChatError(null);
    try {
      const result = await window.widgetAPI?.chat(question.trim(), tipCtx);
      if (!result?.success || !result.reply) throw new Error(result?.error || 'No reply');
      chatAddMessage({ role: 'assistant', text: result.reply });
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Failed to get a response');
    } finally {
      setChatLoading(false);
    }
  }, [chatLoading, openChat, chatAddMessage, setChatLoading, setChatError]);

  const handleChatAskTip = useCallback((tipText: string, autoQuestion?: string) => {
    openChat();
    setChatPrefillCtx(autoQuestion ? null : tipText);
    if (autoQuestion) {
      void submitChatQuestion(autoQuestion, tipText);
    } else {
      setTimeout(() => chatInputRef.current?.focus(), 60);
    }
  }, [openChat, submitChatQuestion]);

  const handleChatSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    const question = chatInput.trim();
    if (!question || chatLoading) return;
    const tipCtx = chatPrefillCtx ?? undefined;
    setChatPrefillCtx(null);
    setChatInput('');
    await submitChatQuestion(question, tipCtx);
  }, [chatInput, chatLoading, chatPrefillCtx, submitChatQuestion]);

  const NON_ACTIONABLE = 'No actionable gameplay moment in this frame.';
  const NON_ACTIONABLE_REGEX = /no actionable gameplay moment(?: in this frame)?\.?/i;
  const CARD_TTL_MS = 60_000;

  const compact = (text: string, max = 220): string => {
    const tryJson = (input: string): string | null => {
      try {
        const parsed = JSON.parse(input) as unknown;
        if (typeof parsed === 'string') return parsed;
        if (parsed && typeof parsed === 'object') {
          const obj = parsed as Record<string, unknown>;
          const headingTip = typeof obj.heading_tip === 'string' ? obj.heading_tip : '';
          const tip = typeof obj.tip === 'string' ? obj.tip : '';
          const analysis = typeof obj.analysis === 'string' ? obj.analysis : '';
          const combined = [headingTip, tip, analysis].filter(Boolean).join(' ||| ').trim();
          return combined || null;
        }
      } catch {
        return null;
      }
      return null;
    };

    const maybeJsonText = (() => {
      const direct = tryJson(text);
      if (direct) return direct;
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start >= 0 && end > start) {
        return tryJson(text.slice(start, end + 1)) || text;
      }
      return text;
    })();

    const normalized = maybeJsonText
      .replace(/\*\*/g, '')
      .replace(/__+/g, '')
      .replace(/`+/g, '')
      .replace(/^\s*(say|ask)\s*:\s*/i, '')
      .replace(/\s*\|\|\|\s*/g, ' ||| ')
      .replace(/\.{3}([NBRQK]?[a-h]?[1-8]?x?[a-h][1-8](?:=[NBRQ])?[+#]?)/g, "Black's $1")
      .replace(/\s+/g, ' ')
      .replace(/(No actionable gameplay moment in this frame\.\s*){2,}/gi, NON_ACTIONABLE)
      .trim();
    if (!normalized || NON_ACTIONABLE_REGEX.test(normalized)) return '';
    if (normalized.length <= max) return normalized;
    return `${normalized.slice(0, max - 1)}…`;
  };

  const isChess = sessionState.gameId === 'chess';

  const recentSayThis = useMemo(
    () => isChess ? sayThis : sayThis.filter((card) => now - card.timestamp <= CARD_TTL_MS),
    [sayThis, now, isChess]
  );
  const recentAskThis = useMemo(
    () => isChess ? askThis : askThis.filter((card) => now - card.timestamp <= CARD_TTL_MS),
    [askThis, now, isChess]
  );

  const elapsedMs = sessionState.isRecording && sessionState.startTime
    ? Math.max(0, now - sessionState.startTime)
    : 0;
  void elapsedMs;

  const topTip = useMemo(() => {
    const all = [
      ...recentSayThis.map((card) => ({ kind: 'Say', card })),
      ...recentAskThis.map((card) => ({ kind: 'Ask', card })),
    ].sort((a, b) => b.card.timestamp - a.card.timestamp);

    const actionable = all.find((entry) => {
      const text = compact(entry.card.text, 320).toLowerCase();
      return text && text !== NON_ACTIONABLE.toLowerCase() && !NON_ACTIONABLE_REGEX.test(text);
    });

    return actionable ?? all[0] ?? null;
  }, [recentSayThis, recentAskThis]);

  const latestSay = recentSayThis[0] || null;
  const latestAsk = recentAskThis[0] || null;

  const chessParagraphCard = useMemo(
    () => (isChess
      ? recentSayThis.find((card) => {
          const text = card.text.trim().toLowerCase();
          return !!text && !text.startsWith('engine:');
        }) || null
      : null),
    [isChess, recentSayThis]
  );
  const chessEngineCard = useMemo(
    () => (isChess
      ? recentSayThis.find((card) => card.text.trim().toLowerCase().startsWith('engine:')) || null
      : null),
    [isChess, recentSayThis]
  );
  const chessDrillCard = useMemo(
    () => (isChess ? recentAskThis.find((card) => !!card.text.trim()) || null : null),
    [isChess, recentAskThis]
  );

  const chessParagraphText = chessParagraphCard ? compact(chessParagraphCard.text, 80) : '';
  const chessEngineText = chessEngineCard ? compact(chessEngineCard.text, 240) : '';
  const chessDrillText = chessDrillCard ? compact(chessDrillCard.text, 220) : '';
  const currentTurnLabel = currentTurn === 'w' ? 'White to move' : currentTurn === 'b' ? 'Black to move' : '';
  const chessWaitingText = isChess && chessParagraphCard && now - chessParagraphCard.timestamp >= 6000
    ? 'Waiting for the next move…'
    : '';
  const topTipMax = isChess ? 800 : 220;
  const compactTopTip = topTip ? compact(topTip.card.text, topTipMax) : null;
  const compactVisualDescription = visualDescription ? compact(visualDescription, 520) : '';
  const [visualHeadingRaw, visualBodyRaw] = compactVisualDescription.includes('|||')
    ? compactVisualDescription.split('|||').map((s) => s.trim())
    : ['', compactVisualDescription];
  const visualHeading = visualHeadingRaw ? compact(visualHeadingRaw, 120) : '';
  const visualBody = visualBodyRaw ? compact(visualBodyRaw, 520) : '';
  const compactLatestTip = latestSay ? compact(latestSay.text, 200) : '';
  const compactLatestAnalysis = latestAsk ? compact(latestAsk.text, 200) : '';

  const chessHasCoachContent = !!(chessParagraphText || chessEngineText || chessDrillText);
  const chessHasAnyContent = !!(chessHasCoachContent || (displayFen ?? currentFen));
  const primaryText = isChess
    ? (chessParagraphText || chessEngineText || '')
    : (compactTopTip || visualHeading || visualBody || '');
  const combinedText = [primaryText, compactLatestTip, compactLatestAnalysis, nudge?.message || '']
    .filter(Boolean).join(' ').toLowerCase();
  void combinedText;
  const isCritical = false;
  const inBuyPhase = false;
  void inBuyPhase;
  const mapLocation: string | undefined = undefined;
  void mapLocation;
  const hasActionableContent = isChess
    ? !!(chessHasAnyContent || nudge)
    : !!(primaryText || compactLatestTip || compactLatestAnalysis || nudge);
  const urgencyTone: 'danger' | 'info' | 'neutral' = 'neutral';
  void urgencyTone;

  const splitActionAndWhy = (text: string): { action: string; why: string } => {
    if (!text) return { action: '', why: '' };
    const normalized = text.replace(/\s+/g, ' ').trim();
    const byPipes = normalized.split(' ||| ').map((s) => s.trim()).filter(Boolean);
    if (byPipes.length > 1) {
      return { action: byPipes[0], why: byPipes.slice(1).join(' • ') };
    }
    const bySentence = normalized.split(/\.\s+/).map((s) => s.trim()).filter(Boolean);
    if (bySentence.length > 1) {
      return { action: bySentence[0], why: bySentence.slice(1).join('. ') };
    }
    return { action: normalized, why: '' };
  };

  const { action: actionHeaderRaw } = splitActionAndWhy(primaryText || compactLatestTip || compactLatestAnalysis);
  const actionHeader = actionHeaderRaw ? actionHeaderRaw.toUpperCase() : '';
  void actionHeader;

  const inAreaCooldown = false;
  const showContent = isChess
    ? hasActionableContent
    : (hasActionableContent && !inAreaCooldown);

  const showExpanded = isChess || isExpanded || isCritical;

  useEffect(() => {
    if (isCritical) setIsExpanded(true);
  }, [isCritical]);

  useEffect(() => {
    if (isChess) setIsExpanded(true);
  }, [isChess]);

  useEffect(() => {
    if (!sessionState.isRecording || sessionState.isPaused) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    setNow(Date.now());
    return () => window.clearInterval(timer);
  }, [sessionState.isRecording, sessionState.isPaused, sessionState.startTime, isChess]);

  const elapsed = sessionState.isRecording
    ? fmtElapsed(sessionState.startTime, now)
    : '00:00';

  // ── SCANNING / LOADING state ──
  // Shown when recording is active but no coach content yet
  const isScanning = sessionState.isRecording && !sessionState.isPaused && !chessHasAnyContent;

  // ── PRE-RECORDING state ──
  // Shown from the moment the overlay appears until the capture pipeline is
  // fully ready and isRecording flips to true.  statusText is set to the
  // "Connecting…" string by App.tsx while isConnecting is true.
  const isPreRecording = !sessionState.isRecording && !!statusText;

  if (isPreRecording) {
    return (
      <div style={{ width: '100%', height: 'auto', display: 'flex', flexDirection: 'column', padding: '0 0 10px 0', boxSizing: 'border-box' }}>
        <div style={{
          background: '#FFFFFF',
          borderRadius: 16,
          overflow: 'hidden',
          boxShadow: '0px 4px 24px rgba(0,0,0,0.08)',
        }}>

          {/* Header */}
          <OverlayHeader />

          {/* ── Body ── */}
          <div style={{
            background: '#FFFFFF',
            padding: '16.82px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 20.18,
            borderTop: '1px solid rgba(0,0,0,0.05)',
            borderBottom: '1px solid rgba(0,0,0,0.05)',
            boxSizing: 'border-box',
          }}>
            {/* Row 1: spinner + "STARTING RECORDING..." */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: 'conic-gradient(from 180deg at 50% 50%, #FF4000 0deg, rgba(196,196,196,0) 360deg)',
                animation: 'spin 1s linear infinite',
                flexShrink: 0,
              }} />
              <span style={{
                fontSize: 12,
                fontWeight: 500,
                color: '#464646',
                lineHeight: '13px',
                fontFamily: 'Inter, sans-serif',
              }}>
                STARTING RECORDING...
              </span>
            </div>

            {/* Row 2: status pill */}
            <div style={{
              background: '#EFEFEF',
              borderRadius: 12.84,
              padding: '6.73px 10.09px',
              boxShadow: '0px 1.07px 12.84px rgba(0,0,0,0.05)',
            }}>
              <span style={{
                fontSize: 13,
                fontWeight: 400,
                color: '#464646',
                lineHeight: '18px',
                fontFamily: 'Inter, sans-serif',
                display: 'block',
              }}>
                {statusText}
              </span>
            </div>
          </div>

          {/* ── Footer ── */}
          <div style={{
            background: '#F7F7F7',
            height: 50.82,
            padding: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxSizing: 'border-box',
            gap: 6.73,
          }}>
            {/* Timer: red dot + 00:00 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6.73, flexShrink: 0 }}>
              <div style={{
                width: 8.41,
                height: 8.41,
                borderRadius: '50%',
                background: '#FB4425',
                animation: 'pulse 1s infinite',
                flexShrink: 0,
              }} />
              <span style={{
                fontSize: 15.136,
                fontWeight: 500,
                color: '#FB4425',
                letterSpacing: '-0.02em',
                fontFamily: 'Inter, sans-serif',
              }}>
                00:00
              </span>
            </div>

            {/* CTAs: Chat + Stop */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6.73, flex: 1 }}>
              {/* Chat button — white bg, #EFEFEF border */}
              <button
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3.36,
                  padding: 8,
                  height: 34.82,
                  background: '#FFFFFF',
                  border: '1px solid #EFEFEF',
                  borderRadius: 10.09,
                  boxShadow: '0px 1.07px 12.84px rgba(0,0,0,0.05)',
                  cursor: 'default',
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#1E1E1E',
                  letterSpacing: '-0.02em',
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                {/* Chat bubble icon */}
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6A1.5 1.5 0 0 1 12.5 11H9l-3 3v-3H3.5A1.5 1.5 0 0 1 2 9.5v-6Z" stroke="#1E1E1E" strokeWidth="1.2" strokeLinejoin="round"/>
                </svg>
                Chat
              </button>

              {/* Stop button — enabled, dark bg */}
              <button
                onClick={onStop}
                disabled={stopDisabled}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3.36,
                  padding: 8,
                  height: 34.82,
                  background: '#1C1C1C',
                  border: 'none',
                  borderRadius: 10.09,
                  boxShadow: '0px 1.07px 12.84px rgba(0,0,0,0.05)',
                  cursor: stopDisabled ? 'not-allowed' : 'pointer',
                  opacity: stopDisabled ? 0.5 : 1,
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#FFFFFF',
                  letterSpacing: '-0.02em',
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                  <rect x="2.5" y="2.5" width="10" height="10" rx="1.5" fill="white"/>
                </svg>
                Stop
              </button>
            </div>
          </div>
        </div>

        <style>{`
          @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: 'auto', display: 'flex', flexDirection: 'column', padding: '0 0 10px 0', boxSizing: 'border-box' }}>

      {/* ── Single unified panel (header + body + footer) ── */}
      <div style={{
        background: '#FFFFFF',
        borderRadius: 16,
        overflow: 'hidden',
        boxShadow: '0px 4px 24px rgba(0,0,0,0.08)',
      }}>

        {/* Header */}
        <OverlayHeader />

        {/* Body */}
        <div style={{
          background: '#FFFFFF',
          padding: '16.82px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20.18,
          borderTop: '1px solid rgba(0,0,0,0.05)',
          borderBottom: '1px solid rgba(0,0,0,0.05)',
          boxSizing: 'border-box',
        }}>

          {/* Chess board � only when FEN is present */}
          {(displayFen ?? currentFen) && (
            <div>
              <ChessBoard fen={displayFen ?? currentFen ?? ''} />
              {currentTurnLabel && (
                <p style={{ fontSize: 11, fontWeight: 600, color: '#464646', margin: '6px 0 0 0', fontFamily: 'Inter, sans-serif' }}>
                  {currentTurnLabel}
                </p>
              )}
            </div>
          )}

          {/* Suggestions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16.82 }}>

            {isScanning && !chessHasCoachContent ? (
              /* ── Scanning state: spinner pill ── */
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 14, height: 14, borderRadius: '50%', background: 'conic-gradient(from 180deg at 50% 50%, #FF4000 0deg, rgba(196,196,196,0) 360deg)', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#464646', lineHeight: '13px', fontFamily: 'Inter, sans-serif' }}>SCANNING...</span>
                </div>
                <div style={{ background: '#EFEFEF', borderRadius: 12.84, padding: '6.73px 10.09px', boxShadow: '0px 1.07px 12.84px rgba(0,0,0,0.05)' }}>
                  <span style={{ fontSize: 13, fontWeight: 400, color: '#464646', lineHeight: '18px', fontFamily: 'Inter, sans-serif', display: 'block' }}>
                    Lens is reading the board, validating FEN consensus, then asking the engine for a move. The first useful tip can take a few seconds.
                  </span>
                </div>
              </>
            ) : (
              <>
                {/* ── Best move block ── */}
                {chessEngineText && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10.09 }}>
                    {/* "BEST MOVE" label — grey, no spinner */}
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#969696', lineHeight: '13px', fontFamily: 'Inter, sans-serif' }}>
                      BEST MOVE
                    </span>
                    {/* Move + badge */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10.09 }}>
                      <span style={{ fontSize: 26, fontWeight: 600, color: '#009106', fontFamily: 'Inter, sans-serif', lineHeight: '18px' }}>
                        {chessEngineText.replace(/^engine:\s*/i, '').split(/[\s|]/)[0] || chessEngineText.replace(/^engine:\s*/i, '')}
                      </span>
                      <div style={{ background: 'rgba(0,145,6,0.1)', border: '0.84px solid rgba(0,145,6,0.1)', borderRadius: 30.27, padding: '1px 6px', fontSize: 12, fontWeight: 500, color: '#009106', fontFamily: 'Inter, sans-serif' }}>
                        Best
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Coaching tip card ── */}
                {/* #F5F5F8 card — shows spinner+"COACHING TIP INCOMING..." when tip pending, tip text when arrived */}
                <div style={{ background: '#F5F5F8', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {chessParagraphText ? (
                    /* Tip has arrived — single line with ellipsis */
                    <p style={{ fontSize: 13, lineHeight: '18px', color: '#464646', fontFamily: 'Inter, sans-serif', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {chessParagraphText}
                    </p>
                  ) : (
                    /* Tip still loading — spinner + label */
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <div style={{ width: 14, height: 14, borderRadius: '50%', background: 'conic-gradient(from 180deg at 50% 50%, #FE480B 0deg, rgba(196,196,196,0) 360deg)', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                      <span style={{ fontSize: 12, fontWeight: 500, color: '#464646', lineHeight: '13px', fontFamily: 'Inter, sans-serif' }}>
                        COACHING TIP INCOMING...
                      </span>
                    </div>
                  )}
                </div>

                {/* Drill card */}
                {chessDrillText && (
                  <div style={{ background: '#F5F5F8', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 12, padding: 12 }}>
                    <p style={{ fontSize: 13, lineHeight: '18px', color: '#464646', fontFamily: 'Inter, sans-serif', margin: 0 }}>{chessDrillText}</p>
                  </div>
                )}

                {/* Waiting for next move */}
                {chessWaitingText && !chessParagraphText && !chessDrillText && (
                  <div style={{ background: '#F5F5F8', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 12, padding: 12 }}>
                    <p style={{ fontSize: 13, lineHeight: '18px', color: '#464646', fontFamily: 'Inter, sans-serif', margin: 0 }}>{chessWaitingText}</p>
                  </div>
                )}

                {/* Non-chess fallback */}
                {!isChess && (compactTopTip || visualHeading || visualBody) && (
                  <div style={{ background: '#F5F5F8', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 12, padding: 12 }}>
                    <p style={{ fontSize: 13, lineHeight: '18px', color: '#464646', fontFamily: 'Inter, sans-serif', margin: 0 }}>{compactTopTip || visualHeading || visualBody}</p>
                  </div>
                )}

                {/* Ask buttons */}
                {(chessParagraphText || chessDrillText) && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {chessParagraphText && (
                      <button onClick={() => handleChatAskTip(chessParagraphText, 'Explain this tip')} style={{ background: 'none', border: '1px solid var(--color-border-input)', borderRadius: 8, color: 'var(--color-chess-insight)', fontSize: 12, fontWeight: 500, padding: '4px 10px', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>
                        Ask about this tip
                      </button>
                    )}
                    {chessDrillText && (
                      <button onClick={() => handleChatAskTip(chessDrillText, 'Explain this drill')} style={{ background: 'none', border: '1px solid var(--color-border-input)', borderRadius: 8, color: 'var(--color-chess-insight)', fontSize: 12, fontWeight: 500, padding: '4px 10px', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>
                        Ask about drill
                      </button>
                    )}
                  </div>
                )}

                {/* Nudge */}
                {nudge && (
                  <div style={{ background: 'var(--color-chat-user-bg)', border: '1px solid var(--color-chat-note-border)', borderRadius: 10, padding: '8px 12px', fontSize: 13, color: '#464646', fontFamily: 'Inter, sans-serif' }}>
                    {nudge.message}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Chat section */}
          {isChess && (
            <>
              <div style={{ height: 1, background: 'rgba(0,0,0,0.05)' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-muted)', cursor: 'pointer', fontFamily: 'Inter, sans-serif', margin: 0 }} onClick={() => { if (!chatLoading) toggleChat(); }}>
                  CHAT WITH COACH {chatMessages.length > 0 && `(${chatMessages.length})`}
                  <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--color-text-muted)' }}>{chatOpen ? '?' : '?'}</span>
                </p>
                {(chatMessages.length > 0 || chatLoading || chatError) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
                    {chatMessages.map((msg) => (
                      <React.Fragment key={msg.id}>
                        {msg.role === 'user' && msg.tipCtx && (
                          <p style={{ fontSize: 10, color: 'var(--color-text-muted)', textAlign: 'right', fontStyle: 'italic', margin: 0, fontFamily: 'Inter, sans-serif' }}>
                            Re: &ldquo;{msg.tipCtx.slice(0, 55)}{msg.tipCtx.length > 55 ? '...' : ''}&rdquo;
                          </p>
                        )}
                        {msg.role === 'user' ? (
                          <div style={{ alignSelf: 'flex-end', background: 'var(--color-chat-user-bg)', border: '1px solid var(--color-chat-user-border)', borderRadius: '12px 12px 2px 12px', padding: 12, fontSize: 13, lineHeight: 1.55, color: 'var(--color-text-body)', maxWidth: '90%', fontFamily: 'Inter, sans-serif' }}>{msg.text}</div>
                        ) : (
                          <div style={{ alignSelf: 'flex-start', background: 'var(--color-chat-coach-bg)', border: '1px solid var(--color-chat-coach-border)', borderRadius: '12px 12px 12px 2px', padding: 12, fontSize: 13, lineHeight: 1.55, color: 'var(--color-text-body)', maxWidth: '90%', fontFamily: 'Inter, sans-serif' }}>{msg.text}</div>
                        )}
                      </React.Fragment>
                    ))}
                    {chatLoading && <p style={{ alignSelf: 'flex-start', color: 'var(--color-text-muted)', fontSize: 11, fontStyle: 'italic', margin: 0, fontFamily: 'Inter, sans-serif' }}>Thinking...</p>}
                    {chatError && <p style={{ fontSize: 11, color: 'var(--color-status-danger)', margin: 0, fontFamily: 'Inter, sans-serif' }}>{chatError}</p>}
                    <div ref={chatEndRef} />
                  </div>
                )}
                {chatOpen && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {chatMessages.length === 0 && !chatLoading && (
                      <p style={{ fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'center', margin: 0, fontFamily: 'Inter, sans-serif' }}>Ask anything about the position or a tip.</p>
                    )}
                    {chatPrefillCtx && (
                      <p style={{ fontSize: 10, color: 'var(--color-chess-insight)', fontStyle: 'italic', margin: 0, fontFamily: 'Inter, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        Context: &ldquo;{chatPrefillCtx.slice(0, 60)}{chatPrefillCtx.length > 60 ? '...' : ''}&rdquo;
                      </p>
                    )}
                    <form onSubmit={handleChatSubmit} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input ref={chatInputRef} type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder={chatPrefillCtx ? 'Ask about this tip...' : 'Ask your coach...'} disabled={chatLoading} style={{ flex: 1, background: 'var(--color-widget-header-bg)', border: '1px solid rgba(13,13,13,0.1)', borderRadius: 9999, color: 'var(--color-text-label)', fontSize: 13, fontWeight: 500, padding: '2px 6px 2px 12px', height: 44, outline: 'none', fontFamily: 'Inter, sans-serif' }} />
                      <button type="submit" disabled={!chatInput.trim() || chatLoading} style={{ background: chatInput.trim() ? '#000000' : 'var(--color-text-muted)', border: '1px solid var(--color-border-default)', borderRadius: 40, color: '#fff', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: chatInput.trim() ? 'pointer' : 'not-allowed', transition: 'background 0.15s', flexShrink: 0 }} title="Send">
                        <SendIcon />
                      </button>
                    </form>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ background: '#F7F7F7', height: 50.82, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxSizing: 'border-box', gap: 6.73 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6.73, flexShrink: 0 }}>
            <div style={{ width: 8.41, height: 8.41, borderRadius: '50%', background: '#FB4425', animation: 'pulse 1s infinite', flexShrink: 0 }} />
            <span style={{ fontSize: 15.136, fontWeight: 500, color: '#FB4425', letterSpacing: '-0.02em', fontFamily: 'Inter, sans-serif' }}>{elapsed}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6.73, flex: 1 }}>
            <button onClick={() => { openChat(); toggleChat(); }} style={{ display: 'flex', alignItems: 'center', gap: 3.36, padding: 8, height: 34.82, background: '#FFFFFF', border: '1px solid #EFEFEF', borderRadius: 10.09, boxShadow: '0px 1.07px 12.84px rgba(0,0,0,0.05)', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#1E1E1E', letterSpacing: '-0.02em', fontFamily: 'Inter, sans-serif' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6A1.5 1.5 0 0 1 12.5 11H9l-3 3v-3H3.5A1.5 1.5 0 0 1 2 9.5v-6Z" stroke="#1E1E1E" strokeWidth="1.2" strokeLinejoin="round"/></svg>
              Chat
            </button>
            <button onClick={onStop} disabled={stopDisabled} style={{ display: 'flex', alignItems: 'center', gap: 3.36, padding: 8, height: 34.82, background: '#1C1C1C', border: 'none', borderRadius: 10.09, boxShadow: '0px 1.07px 12.84px rgba(0,0,0,0.05)', cursor: stopDisabled ? 'not-allowed' : 'pointer', opacity: stopDisabled ? 0.5 : 1, fontSize: 13, fontWeight: 600, color: '#FFFFFF', letterSpacing: '-0.02em', fontFamily: 'Inter, sans-serif' }}>
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="2.5" y="2.5" width="10" height="10" rx="1.5" fill="white"/></svg>
              Stop
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}