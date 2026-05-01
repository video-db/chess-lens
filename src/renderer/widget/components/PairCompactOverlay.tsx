import React, { useEffect, useMemo, useState } from 'react';
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
  const size = 200; // total SVG size px
  const sq = size / 8;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: 'block', borderRadius: 4, border: '1px solid rgba(255,255,255,0.2)' }}
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
          fontSize={7}
          fill="rgba(0,0,0,0.45)"
          style={{ userSelect: 'none' }}
        >{f}</text>
      ))}
      {/* Rank labels */}
      {[8,7,6,5,4,3,2,1].map((r, i) => (
        <text
          key={r}
          x={2}
          y={i * sq + sq / 2}
          dominantBaseline="middle"
          fontSize={7}
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

export function PairCompactOverlay({
  sessionState,
  sayThis,
  askThis,
  visualDescription,
  nudge,
  currentFen,
  displayFen,
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
      .replace(/\s+/g, ' ')
      .replace(/(No actionable gameplay moment in this frame\.\s*){2,}/gi, NON_ACTIONABLE)
      .trim();
    if (!normalized || NON_ACTIONABLE_REGEX.test(normalized)) return '';
    if (normalized.length <= max) return normalized;
    return `${normalized.slice(0, max - 1)}…`;
  };

  

  const recentSayThis = useMemo(
    () => sayThis.filter((card) => now - card.timestamp <= CARD_TTL_MS),
    [sayThis, now]
  );
  const recentAskThis = useMemo(
    () => askThis.filter((card) => now - card.timestamp <= CARD_TTL_MS),
    [askThis, now]
  );

  const elapsedMs = sessionState.isRecording && sessionState.startTime
    ? Math.max(0, now - sessionState.startTime)
    : 0;

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
  const isChess = sessionState.gameId === 'chess';

  // Widget IPC prepends newest cards first. Pick directly from that order so the
  // overlay always shows the latest coaching paragraph, engine line, and drill.
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
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  void combinedText; // retained for potential future use
  const isCritical = false;
  const inBuyPhase = false;
  const mapLocation: string | undefined = undefined;
  const hasActionableContent = isChess
    ? !!(chessHasAnyContent || nudge)
    : !!(primaryText || compactLatestTip || compactLatestAnalysis || nudge);
  const urgencyTone: 'danger' | 'info' | 'neutral' = 'neutral';

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

  const { action: actionHeaderRaw, why: rationaleRaw } = splitActionAndWhy(primaryText || compactLatestTip || compactLatestAnalysis);
  const actionHeader = actionHeaderRaw ? actionHeaderRaw.toUpperCase() : '';
  const rationale = rationaleRaw || (compactLatestAnalysis && compactLatestAnalysis !== actionHeaderRaw ? compactLatestAnalysis : '') || visualBody;

  const inAreaCooldown = false;
  const showContent = isChess
    ? hasActionableContent   // only show when board or tip is actually available
    : (hasActionableContent && !inAreaCooldown);

  useEffect(() => {
    if (isCritical) {
      setIsExpanded(true);
    }
  }, [isCritical]);

  useEffect(() => {
    // Chess should stay expanded so the player can read full move reasoning.
    if (isChess) {
      setIsExpanded(true);
    }
  }, [isChess]);

  useEffect(() => {
    if (!sessionState.isRecording || sessionState.isPaused) {
      return;
    }

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    setNow(Date.now());

    return () => window.clearInterval(timer);
  }, [sessionState.isRecording, sessionState.isPaused, sessionState.startTime]);

  const status = sessionState.isRecording
    ? sessionState.isPaused
      ? 'Paused'
      : fmtElapsed(sessionState.startTime, now)
    : 'Idle';

  const elapsed = sessionState.isRecording
    ? fmtElapsed(sessionState.startTime, now)
    : '00:00';

  const stateClass = sessionState.isRecording ? 'state-recording' : 'state-idle';
  const coachLabel = isChess ? 'Chess Coach' : `${(sessionState.gameId || 'Game').toUpperCase()} Coach`;
  const showExpanded = isChess || isExpanded || isCritical;

  return (
    <div style={{ width: '100%', height: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', padding: 10, boxSizing: 'border-box' }}>
      <style>{`
        .pp-wrap {
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }

        .pp-tip {
          max-width: min(560px, calc(100vw - 24px));
          background: rgba(10, 10, 10, 0.82);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 10px;
          color:#fff;
          padding:10px 12px;
          font-size:13px;
          line-height:1.35;
          box-sizing: border-box;
          overflow: visible;
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }

        .pp-tip--danger {
          border-color: rgba(255, 82, 82, 0.85);
          box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.55);
          animation: dangerPulse 1.1s infinite;
        }

        .pp-tip--info {
          border-color: rgba(96, 165, 250, 0.85);
          background: rgba(12, 20, 35, 0.86);
        }

        .pp-tip--neutral {
          border-color: rgba(129, 140, 248, 0.5);
        }

        @keyframes dangerPulse {
          0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5); }
          70% { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); }
          100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }

        .pp-tip-collapsed {
          max-width: 420px;
          background: rgba(10, 10, 10, 0.78);
          border: 1px solid rgba(255,255,255,0.18);
          border-radius: 999px;
          color:#fff;
          padding: 8px 12px;
          font-size: 12px;
          line-height: 1.25;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          display: inline-flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
        }

        .pp-location-ping {
          padding: 2px 8px;
          border-radius: 999px;
          border: 1px solid rgba(255, 200, 0, 0.7);
          color: #ffd76b;
          font-size: 11px;
          animation: pulse 1s infinite;
        }

        

        .pp-widget {
          position: relative;
          display: inline-flex;
          align-items: center;
          padding: 8px 10px;
          gap: 8px;
          height: 52px;
          background: rgba(22, 22, 24, 0.95);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border-radius: 14px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
          color: white;
          -webkit-app-region: drag;
          app-region: drag;
        }

        .pp-divider {
          width: 1px;
          height: 28px;
          background: rgba(255,255,255,0.1);
        }

        .pp-widget button, .pp-widget [role='button'] { -webkit-app-region: no-drag; app-region: no-drag; }

        .pp-pill {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 8px;
          border: none;
          background: transparent;
          color: rgba(255,255,255,0.65);
        }

        .pp-pill.active {
          background: rgba(255,255,255,0.08);
          color: rgba(255,255,255,0.95);
        }

        .pp-pill svg {
          width: 16px;
          height: 16px;
          fill: none;
          stroke: currentColor;
          stroke-width: 1.8;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        .pp-power {
          width:34px;
          height:34px;
          border-radius:8px;
          border:none;
          background: #ff4000;
          display:flex;
          align-items:center;
          justify-content:center;
          cursor:pointer;
          transition: background 0.15s;
        }
        .pp-power:hover { background: #cc2b02; }
        .pp-power:disabled {
          background: rgba(255, 64, 0, 0.55);
          cursor: not-allowed;
        }
        .pp-power .stop-box {
          width: 12px;
          height: 12px;
          border-radius: 2px;
          background: #fff;
        }

        .pp-status {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          border-radius: 20px;
          color: #fd5337;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: -0.02em;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          background: rgba(239, 68, 68, 0.15);
        }
        .pp-status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
          animation: pulse 1s infinite;
        }
        @keyframes pulse {
          0%,100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        .pp-actions { display:flex; gap:8px; margin-top:8px; flex-wrap: wrap; }
        .pp-btn {
          border:1px solid rgba(255,255,255,0.25);
          border-radius:8px;
          background: rgba(255,255,255,0.08);
          color:#fff;
          font-size:12px;
          padding:6px 10px;
          cursor:pointer;
        }
      `}</style>

      <div className="pp-wrap">
        {showContent && (
        showExpanded ? (
        <div className={`pp-tip pp-tip--${urgencyTone}`} onDoubleClick={() => { if (!isChess) setIsExpanded(false); }}>
          <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 4 }}>{coachLabel}</div>
          {sessionState.gameId === 'chess' ? (
            // Chess: board always visible above the tip, then engine line + drill
            <>
              {/* Board always shown above the tip when a FEN is available */}
              {(displayFen ?? currentFen) && (
                <div style={{ marginBottom: 8 }}>
                  <ChessBoard fen={displayFen ?? currentFen ?? ''} />
                  <div style={{ fontSize: 9, opacity: 0.45, marginTop: 3, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                    {(displayFen ?? currentFen ?? '').split(' ')[0]}
                  </div>
                </div>
              )}
              <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 6 }}>
                {chessParagraphText || chessEngineText || chessDrillText || chessWaitingText || null}
              </div>
              {/* Only show engine line separately when there is also a coaching paragraph */}
              {chessParagraphText && chessEngineText && (
                <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 4, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                  {chessEngineText}
                </div>
              )}
              {chessWaitingText && (
                <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4, fontStyle: 'italic' }}>
                  {chessWaitingText}
                </div>
              )}
              {chessDrillText && (
                <div style={{ fontSize: 12, opacity: 0.92, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                  {chessDrillText}
                </div>
              )}
            </>
          ) : (
            // Generic fallback for non-chess sessions
            <>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, letterSpacing: '0.02em' }}>
                {compactTopTip || visualHeading || visualBody || 'WAITING FOR LIVE GAME INSIGHT...'}
              </div>
            </>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          </div>
          {!isChess && (compactLatestTip || compactLatestAnalysis) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
              {compactLatestTip && compactLatestTip !== (compactTopTip || '') && (
                <div style={{ fontSize: 12, opacity: 0.95 }}><span style={{ color: '#ff8b5f' }}>Tip:</span> {compactLatestTip}</div>
              )}
              {compactLatestAnalysis && compactLatestAnalysis !== (compactTopTip || '') && (
                <div style={{ fontSize: 12, opacity: 0.95 }}><span style={{ color: '#76a9ff' }}>Analysis:</span> {compactLatestAnalysis}</div>
              )}
            </div>
          )}
          {nudge && <div style={{ marginTop: 8, fontSize: 12, opacity: 0.95 }}>Nudge: {nudge.message}</div>}
          
          <div className="pp-actions">
            <button className="pp-btn" onClick={sessionState.isPaused ? onResume : onPause}>{sessionState.isPaused ? 'Resume' : 'Pause'}</button>
            <button className="pp-btn" onClick={sessionState.isMicMuted ? onUnmuteMic : onMuteMic}>{sessionState.isMicMuted ? 'Unmute' : 'Mute'}</button>
            {!isCritical && !isChess && <button className="pp-btn" onClick={() => setIsExpanded(false)}>Collapse</button>}
          </div>
        </div>
        ) : (
          <div className="pp-tip-collapsed" onClick={() => setIsExpanded(true)}>
            <span>{isCritical ? '⚠️' : '🎯'}</span>
            <span style={{ fontWeight: 700 }}>{isCritical ? 'VULNERABLE' : (actionHeader || primaryText || 'Coach active')}</span>
          </div>
        ))}

        <div className={`pp-widget ${stateClass}`}>
          <button
            className={`pp-pill ${sessionState.isMicMuted ? '' : 'active'}`}
            title={sessionState.isMicMuted ? 'Unmute mic' : 'Mute mic'}
            onClick={sessionState.isMicMuted ? onUnmuteMic : onMuteMic}
          >
            <svg viewBox="0 0 24 24"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" /><path d="M19 10v2a7 7 0 01-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
          </button>
          <button
            className={`pp-pill ${sessionState.isPaused ? '' : 'active'}`}
            title={sessionState.isPaused ? 'Resume capture' : 'Pause capture'}
            onClick={sessionState.isPaused ? onResume : onPause}
          >
            <svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
          </button>
          <button
            className={`pp-pill ${sessionState.isMicMuted ? '' : 'active'}`}
            title={sessionState.isMicMuted ? 'Unmute mic' : 'Mute mic'}
            onClick={sessionState.isMicMuted ? onUnmuteMic : onMuteMic}
          >
            <svg viewBox="0 0 24 24"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19" /><path d="M19.07 4.93a10 10 0 010 14.14" /><path d="M15.54 8.46a5 5 0 010 7.08" /></svg>
          </button>

          <div className="pp-divider" />

          <div className="pp-status">
            <span className="pp-status-dot" />
            <span>{sessionState.isRecording ? elapsed : (statusText || status)}</span>
          </div>

          <div className="pp-divider" />

          <button className="pp-power" onClick={onStop} title="Stop" disabled={stopDisabled}>
            <span className="stop-box" />
          </button>
        </div>
      </div>
    </div>
  );
}
