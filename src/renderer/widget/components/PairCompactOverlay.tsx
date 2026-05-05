import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useWidgetChatStore } from '../chatStore';
import logoIcon from '../../../../../resources/chess-lens-icon-black.svg';
import type {
  InsightCard,
  WidgetSessionState as SessionState,
  WidgetNudge as Nudge,
} from '../../../types/widget';

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

  const chessParagraphText = chessParagraphCard ? compact(chessParagraphCard.text, 1000) : '';
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

  return (
    <div style={{ width: '100%', height: 'auto', display: 'flex', flexDirection: 'column', padding: '0 0 10px 0', boxSizing: 'border-box' }}>

      {/* ── Main coaching panel ── */}
      {showContent && showExpanded && (
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 16,
            border: '1px solid rgba(0,0,0,0.05)',
            marginBottom: 8,
            overflow: 'hidden',
            boxShadow: '0px 4px 24px rgba(0,0,0,0.08)',
          }}
        >
          {/* Header strip */}
          <div
            style={{
              background: 'var(--color-widget-header-bg)',
              padding: '8px 12px',
              height: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid var(--color-widget-border)',
              boxSizing: 'border-box',
            }}
          >
            {/* Logo + wordmark */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <img src={logoIcon} width={20} height={20} alt="Chess Lens" style={{ borderRadius: 3 }} />
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-label)', fontFamily: 'Inter, sans-serif' }}>
                Chess Lens
              </span>
            </div>
            <button
              onClick={() => { if (!isChess) setIsExpanded(false); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--color-text-muted)', fontSize: 12 }}
            >
              ▲
            </button>
          </div>

          {/* Content area */}
          <div style={{ padding: '16.82px 16px', display: 'flex', flexDirection: 'column', gap: 20, borderTop: '1px solid rgba(0,0,0,0.05)', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>

            {/* Chess board */}
            {(displayFen ?? currentFen) && (
              <div>
                <ChessBoard fen={displayFen ?? currentFen ?? ''} />
                {currentTurnLabel && (
                  <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-body)', marginTop: 6, fontFamily: 'Inter, sans-serif' }}>
                    {currentTurnLabel}
                  </p>
                )}
              </div>
            )}

            {/* Suggestions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Best move section */}
              {chessEngineText && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-muted)', fontFamily: 'Inter, sans-serif' }}>
                    BEST MOVE
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 26, fontWeight: 600, color: 'var(--color-chess-best-move)', fontFamily: 'Inter, sans-serif', lineHeight: 1 }}>
                      {chessEngineText.replace(/^engine:\s*/i, '').split(/[\s|]/)[0] || chessEngineText.replace(/^engine:\s*/i, '')}
                    </span>
                    <div style={{
                      background: 'var(--color-chess-best-move-bg)',
                      border: '0.84px solid var(--color-chess-best-move-bg)',
                      borderRadius: 30,
                      padding: '1px 6px',
                      fontSize: 12,
                      fontWeight: 500,
                      color: 'var(--color-chess-best-move)',
                      fontFamily: 'Inter, sans-serif',
                    }}>
                      Best
                    </div>
                  </div>
                </div>
              )}

              {/* Coaching paragraph */}
              {chessParagraphText && (
                <div style={{
                  background: 'var(--color-surface-muted)',
                  border: '1px solid rgba(0,0,0,0.1)',
                  borderRadius: 12,
                  padding: 12,
                }}>
                  <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--color-text-body)', fontFamily: 'Inter, sans-serif', margin: 0 }}>
                    {chessParagraphText}
                  </p>
                </div>
              )}

              {/* Engine analysis card */}
              {chessParagraphText && chessEngineText && (
                <div style={{
                  background: 'var(--color-surface-muted)',
                  border: '1px solid rgba(0,0,0,0.1)',
                  borderRadius: 12,
                  padding: 12,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-label)', fontFamily: 'Inter, sans-serif' }}>Engine</span>
                  </div>
                  <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--color-text-body)', fontFamily: 'Inter, sans-serif', margin: 0 }}>
                    {chessEngineText.replace(/^engine:\s*/i, '')}
                  </p>
                </div>
              )}

              {/* Drill card */}
              {chessDrillText && (
                <div style={{
                  background: 'var(--color-surface-muted)',
                  border: '1px solid rgba(0,0,0,0.1)',
                  borderRadius: 12,
                  padding: 12,
                }}>
                  <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--color-text-body)', fontFamily: 'Inter, sans-serif', margin: 0 }}>
                    {chessDrillText}
                  </p>
                </div>
              )}

              {/* Waiting / scanning */}
              {(chessWaitingText || isScanning) && !chessParagraphText && !chessDrillText && (
                <div style={{
                  background: 'var(--color-input-bg)',
                  borderRadius: 12,
                  padding: '6px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}>
                  <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-body)', fontFamily: 'Inter, sans-serif', margin: 0 }}>
                    {isScanning ? 'SCANNING...' : chessWaitingText}
                  </p>
                </div>
              )}

              {/* Non-chess fallback */}
              {!isChess && (compactTopTip || visualHeading || visualBody) && (
                <div style={{
                  background: 'var(--color-surface-muted)',
                  border: '1px solid rgba(0,0,0,0.1)',
                  borderRadius: 12,
                  padding: 12,
                }}>
                  <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--color-text-body)', fontFamily: 'Inter, sans-serif', margin: 0 }}>
                    {compactTopTip || visualHeading || visualBody}
                  </p>
                </div>
              )}
            </div>

            {/* Ask buttons */}
            {(chessParagraphText || chessDrillText) && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {chessParagraphText && (
                  <button
                    onClick={() => handleChatAskTip(chessParagraphText, 'Explain this tip')}
                    style={{
                      background: 'none',
                      border: '1px solid var(--color-border-input)',
                      borderRadius: 8,
                      color: 'var(--color-chess-insight)',
                      fontSize: 12,
                      fontWeight: 500,
                      padding: '4px 10px',
                      cursor: 'pointer',
                      fontFamily: 'Inter, sans-serif',
                    }}
                  >
                    Ask about this tip
                  </button>
                )}
                {chessDrillText && (
                  <button
                    onClick={() => handleChatAskTip(chessDrillText, 'Explain this drill')}
                    style={{
                      background: 'none',
                      border: '1px solid var(--color-border-input)',
                      borderRadius: 8,
                      color: 'var(--color-chess-insight)',
                      fontSize: 12,
                      fontWeight: 500,
                      padding: '4px 10px',
                      cursor: 'pointer',
                      fontFamily: 'Inter, sans-serif',
                    }}
                  >
                    Ask about drill
                  </button>
                )}
              </div>
            )}

            {/* Nudge */}
            {nudge && (
              <div style={{
                background: 'var(--color-chat-user-bg)',
                border: '1px solid var(--color-chat-note-border)',
                borderRadius: 10,
                padding: '8px 12px',
                fontSize: 13,
                color: 'var(--color-text-body)',
                fontFamily: 'Inter, sans-serif',
              }}>
                {nudge.message}
              </div>
            )}
          </div>

          {/* ── Chat section ── */}
          {isChess && (
            <>
              {/* Divider */}
              <div style={{ height: 2, background: 'rgba(0,0,0,0.05)', margin: '0 0' }} />

              {/* Chat panel */}
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Section label */}
                <p
                  style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-muted)', cursor: 'pointer', fontFamily: 'Inter, sans-serif', margin: 0 }}
                  onClick={() => { if (!chatLoading) toggleChat(); }}
                >
                  CHAT WITH COACH {chatMessages.length > 0 && `(${chatMessages.length})`}
                  <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--color-text-muted)' }}>{chatOpen ? '▲' : '▼'}</span>
                </p>

                {/* Messages */}
                {(chatMessages.length > 0 || chatLoading || chatError) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
                    {chatMessages.map((msg) => (
                      <React.Fragment key={msg.id}>
                        {msg.role === 'user' && msg.tipCtx && (
                          <p style={{ fontSize: 10, color: 'var(--color-text-muted)', textAlign: 'right', fontStyle: 'italic', margin: 0, fontFamily: 'Inter, sans-serif' }}>
                            Re: "{msg.tipCtx.slice(0, 55)}{msg.tipCtx.length > 55 ? '…' : ''}"
                          </p>
                        )}
                        {msg.role === 'user' ? (
                          /* User bubble — orange warm per Figma */
                          <div style={{
                            alignSelf: 'flex-end',
                            background: 'var(--color-chat-user-bg)',
                            border: '1px solid var(--color-chat-user-border)',
                            borderRadius: '12px 12px 2px 12px',
                            padding: '12px',
                            fontSize: 13,
                            lineHeight: 1.55,
                            color: 'var(--color-text-body)',
                            maxWidth: '90%',
                            fontFamily: 'Inter, sans-serif',
                          }}>
                            {msg.text}
                          </div>
                        ) : (
                          /* Coach bubble — olive per Figma */
                          <div style={{
                            alignSelf: 'flex-start',
                            background: 'var(--color-chat-coach-bg)',
                            border: '1px solid var(--color-chat-coach-border)',
                            borderRadius: '12px 12px 12px 2px',
                            padding: '12px',
                            fontSize: 13,
                            lineHeight: 1.55,
                            color: 'var(--color-text-body)',
                            maxWidth: '90%',
                            fontFamily: 'Inter, sans-serif',
                          }}>
                            {msg.text}
                          </div>
                        )}
                      </React.Fragment>
                    ))}
                    {chatLoading && (
                      <p style={{ alignSelf: 'flex-start', color: 'var(--color-text-muted)', fontSize: 11, fontStyle: 'italic', margin: 0, fontFamily: 'Inter, sans-serif' }}>
                        Thinking…
                      </p>
                    )}
                    {chatError && (
                      <p style={{ fontSize: 11, color: 'var(--color-status-danger)', margin: 0, fontFamily: 'Inter, sans-serif' }}>{chatError}</p>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                )}

                {/* Input */}
                {chatOpen && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {chatMessages.length === 0 && !chatLoading && (
                      <p style={{ fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'center', margin: 0, fontFamily: 'Inter, sans-serif' }}>
                        Ask anything about the position or a tip.
                      </p>
                    )}
                    {chatPrefillCtx && (
                      <p style={{ fontSize: 10, color: 'var(--color-chess-insight)', fontStyle: 'italic', margin: 0, fontFamily: 'Inter, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        Context: "{chatPrefillCtx.slice(0, 60)}{chatPrefillCtx.length > 60 ? '…' : ''}"
                      </p>
                    )}
                    <form
                      onSubmit={handleChatSubmit}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 0 0 0' }}
                    >
                      <input
                        ref={chatInputRef}
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        placeholder={chatPrefillCtx ? 'Ask about this tip…' : 'Ask your coach...'}
                        disabled={chatLoading}
                        style={{
                          flex: 1,
                          background: 'var(--color-widget-header-bg)',
                          border: '1px solid rgba(13,13,13,0.1)',
                          borderRadius: 9999,
                          color: 'var(--color-text-label)',
                          fontSize: 13,
                          fontWeight: 500,
                          padding: '2px 6px 2px 12px',
                          height: 44,
                          outline: 'none',
                          fontFamily: 'Inter, sans-serif',
                        }}
                      />
                      <button
                        type="submit"
                        disabled={!chatInput.trim() || chatLoading}
                        style={{
                          background: chatInput.trim() ? '#000000' : 'var(--color-text-muted)',
                          border: '1px solid var(--color-border-default)',
                          borderRadius: 40,
                          color: '#fff',
                          width: 32,
                          height: 32,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: chatInput.trim() ? 'pointer' : 'not-allowed',
                          transition: 'background 0.15s',
                          flexShrink: 0,
                        }}
                        title="Send"
                      >
                        <SendIcon />
                      </button>
                    </form>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Collapsed pill — for non-chess or when explicitly collapsed */}
      {showContent && !showExpanded && (
        <div
          onClick={() => setIsExpanded(true)}
          style={{
            background: 'var(--color-widget-header-bg)',
            border: '1px solid var(--color-border-default)',
            borderRadius: 9999,
            padding: '8px 12px',
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--color-text-body)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
            marginBottom: 8,
            boxShadow: '0px 1px 12px rgba(0,0,0,0.05)',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          <span>🎯</span>
          <span>{primaryText || 'Coach active'}</span>
        </div>
      )}

      {/* ── Control bar (footer) ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--color-widget-header-bg)',
          borderRadius: 16,
          padding: '8px',
          gap: '6.73px',
          boxShadow: '0px 1.07px 12.84px rgba(0,0,0,0.05)',
          WebkitAppRegion: 'drag',
        } as React.CSSProperties}
      >
        {/* Timer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6.73px', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <div style={{
            width: 8.41,
            height: 8.41,
            borderRadius: '50%',
            background: 'var(--color-recording-dot)',
            animation: 'pulse 1s infinite',
          }} />
          <span style={{
            fontSize: 15,
            fontWeight: 500,
            color: 'var(--color-recording-dot)',
            letterSpacing: '-0.02em',
            fontFamily: 'Inter, sans-serif',
          }}>
            {sessionState.isRecording ? elapsed : (statusText || '00:00')}
          </span>
        </div>

        {/* CTAs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6.73px', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {/* Pause / Resume button */}
          <button
            onClick={sessionState.isPaused ? onResume : onPause}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '3.36px',
              padding: '8px',
              height: '34.82px',
              background: '#FFFFFF',
              border: '1.07px solid var(--color-border-default)',
              borderRadius: '10.09px',
              boxShadow: '0px 1.07px 12.84px rgba(0,0,0,0.05)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--color-text-label)',
              letterSpacing: '-0.02em',
              fontFamily: 'Inter, sans-serif',
              transition: 'opacity 0.15s',
            }}
          >
            {sessionState.isPaused ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M5 3.5V12.5L13 8L5 3.5Z" fill="currentColor" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="3.5" y="2.5" width="3" height="11" rx="1" fill="currentColor"/><rect x="9.5" y="2.5" width="3" height="11" rx="1" fill="currentColor"/></svg>
            )}
            {sessionState.isPaused ? 'Resume' : 'Pause'}
          </button>

          {/* Stop button */}
          <button
            onClick={onStop}
            disabled={stopDisabled}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '3.36px',
              padding: '8px',
              height: '34.82px',
              background: 'var(--color-widget-stop-bg)',
              border: 'none',
              borderRadius: '10.09px',
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
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="2.5" y="2.5" width="10" height="10" rx="1.5" fill="white"/></svg>
            Stop
          </button>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
