import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useWidgetChatStore } from '../chatStore';
import type {
  InsightCard,
  WidgetSessionState as SessionState,
  WidgetNudge as Nudge,
} from '../../../types/widget';
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

/**
 * Convert an algebraic square string (e.g. "b7") to a {col, row} SVG grid index.
 * col: 0 = file a … 7 = file h
 * row: 0 = rank 8 (top of board in white perspective) … 7 = rank 1
 * Returns null when the input is malformed.
 */
function squareToGrid(sq: string): { col: number; row: number } | null {
  if (!sq || sq.length < 2) return null;
  const col = sq.charCodeAt(0) - 97; // 'a'=0 … 'h'=7
  const row = 8 - parseInt(sq[1], 10); // '8'→0, '1'→7
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  return { col, row };
}

function ChessBoard({
  fen,
  moveFrom,
  moveTo,
  flipped,
}: {
  fen: string;
  /** Source square of the best move, e.g. "b7" (white-perspective algebraic). */
  moveFrom?: string;
  /** Destination square of the best move, e.g. "b8" (white-perspective algebraic). */
  moveTo?: string;
  /** True when the board is rendered from Black's point of view (rotated 180°). */
  flipped?: boolean;
}) {
  const boardPart = fen.split(' ')[0];
  const board = useMemo(() => parseFenBoard(boardPart), [boardPart]);
  const size = 368; // match Figma board width
  const sq = size / 8;

  // Convert the API's algebraic from/to squares into SVG grid coords,
  // mirroring for the black-perspective board when needed.
  const arrow = useMemo(() => {
    const from = squareToGrid(moveFrom ?? '');
    const to   = squareToGrid(moveTo ?? '');
    if (!from || !to) return null;

    return {
      fromCol: flipped ? 7 - from.col : from.col,
      fromRow: flipped ? 7 - from.row : from.row,
      toCol:   flipped ? 7 - to.col   : to.col,
      toRow:   flipped ? 7 - to.row   : to.row,
    };
  }, [moveFrom, moveTo, flipped]);

  // Arrow geometry helpers
  const arrowColor = 'rgba(0, 145, 6, 0.82)';
  const arrowWidth = sq * 0.22;
  const arrowHeadLen = sq * 0.42;
  const arrowHeadWidth = sq * 0.44;

  let arrowElem: React.ReactNode = null;
  if (arrow) {
    const x1 = arrow.fromCol * sq + sq / 2;
    const y1 = arrow.fromRow * sq + sq / 2;
    const x2 = arrow.toCol * sq + sq / 2;
    const y2 = arrow.toRow * sq + sq / 2;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 1) {
      const ux = dx / len;
      const uy = dy / len;

      // Shorten the shaft so it doesn't overlap the arrowhead
      const shaftEndX = x2 - ux * arrowHeadLen;
      const shaftEndY = y2 - uy * arrowHeadLen;

      // Push shaft start back slightly from origin centre
      const shaftStartX = x1 + ux * sq * 0.28;
      const shaftStartY = y1 + uy * sq * 0.28;

      // Perpendicular unit for arrowhead wings
      const px = -uy;
      const py = ux;

      const tipX = x2 - ux * (sq * 0.08); // slight inset at tip
      const tipY = y2 - uy * (sq * 0.08);
      const wing1X = shaftEndX + px * arrowHeadWidth / 2;
      const wing1Y = shaftEndY + py * arrowHeadWidth / 2;
      const wing2X = shaftEndX - px * arrowHeadWidth / 2;
      const wing2Y = shaftEndY - py * arrowHeadWidth / 2;

      arrowElem = (
        <g style={{ pointerEvents: 'none' }}>
          {/* Shaft */}
          <line
            x1={shaftStartX} y1={shaftStartY}
            x2={shaftEndX}   y2={shaftEndY}
            stroke={arrowColor}
            strokeWidth={arrowWidth}
            strokeLinecap="round"
          />
          {/* Arrowhead triangle */}
          <polygon
            points={`${tipX},${tipY} ${wing1X},${wing1Y} ${wing2X},${wing2Y}`}
            fill={arrowColor}
          />
        </g>
      );
    }
  }

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

          // Highlight from/to squares
          const isFromSq = arrow && ri === arrow.fromRow && ci === arrow.fromCol;
          const isToSq   = arrow && ri === arrow.toRow   && ci === arrow.toCol;

          return (
            <g key={`${ri}-${ci}`}>
              <rect
                x={x} y={y} width={sq} height={sq}
                fill={light ? '#f0d9b5' : '#b58863'}
              />
              {/* Square highlight overlay */}
              {(isFromSq || isToSq) && (
                <rect
                  x={x} y={y} width={sq} height={sq}
                  fill="rgba(0, 200, 10, 0.35)"
                />
              )}
              {piece && (
                piece === piece.toUpperCase() ? (
                  /* White piece: dark outline layer first, solid white fill on top */
                  <>
                    <text
                      x={x + sq / 2}
                      y={y + sq / 2 + 1}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={sq * 0.72}
                      style={{ userSelect: 'none' }}
                      fill="#ffffff"
                      stroke="#444444"
                      strokeWidth={2.2}
                      paintOrder="stroke fill"
                    >
                      {PIECE_UNICODE[piece] ?? piece}
                    </text>
                    <text
                      x={x + sq / 2}
                      y={y + sq / 2 + 1}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={sq * 0.72}
                      style={{ userSelect: 'none' }}
                      fill="#ffffff"
                    >
                      {PIECE_UNICODE[piece] ?? piece}
                    </text>
                  </>
                ) : (
                  /* Black piece: solid dark fill with a light outline */
                  <text
                    x={x + sq / 2}
                    y={y + sq / 2 + 1}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={sq * 0.72}
                    style={{ userSelect: 'none' }}
                    fill="#111111"
                    stroke="#dddddd"
                    strokeWidth={0.4}
                    paintOrder="stroke fill"
                  >
                    {PIECE_UNICODE[piece] ?? piece}
                  </text>
                )
              )}
            </g>
          );
        })
      )}
      {/* Arrow drawn on top of all squares and pieces */}
      {arrowElem}
      {/* File labels */}
      {(flipped ? 'hgfedcba' : 'abcdefgh').split('').map((f, i) => (
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
      {(flipped ? [1,2,3,4,5,6,7,8] : [8,7,6,5,4,3,2,1]).map((r, i) => (
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
  /**
   * Authoritative board orientation from the main process.
   * 'white' = rank 1 at bottom (normal view); 'black' = rank 8 at bottom (flipped).
   * Drives ChessBoard's `flipped` prop so the mini-board always matches the main page board.
   */
  boardOrientation?: 'white' | 'black';
  /** Best move SAN from the chess engine (e.g. "b8=Q+"). */
  engineSan?: string;
  /** Best move LAN (UCI) from the chess engine (e.g. "b7b8q"). Kept for reference. */
  engineLan?: string;
  /** Source square of the best move, e.g. "b7". From chess-api.com directly. */
  engineFrom?: string;
  /** Destination square of the best move, e.g. "b8". From chess-api.com directly. */
  engineTo?: string;
  /** Centipawn evaluation from the engine as a float (e.g. -11.62). */
  engineEval?: number;
  /** Mate-in-N from the engine (null = no forced mate). */
  engineMate?: number | null;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onMuteMic: () => void;
  onUnmuteMic: () => void;
  onDismissCard: (type: 'sayThis' | 'askThis', id: string) => void;
  onDismissNudge?: () => void;
  stopDisabled?: boolean;
  statusText?: string;
  /** Error message from the recording pipeline startup, shown instead of the connecting spinner. */
  connectingError?: string | null;
  /** Called when the user clicks the flip-turn button to manually override detected turn. */
  onFlipTurn?: () => void;
  /** True while the main process is re-running the engine after a user-initiated turn flip. */
  isRegenerating?: boolean;
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
// CoachingChatView — full overlay panel shown when user clicks the Chat button.
// Layout (top → bottom):
//   1. Header      40px   — shared OverlayHeader (consistent with main overlay)
//   2. Window      fixed  — board + best-move + suggestion
//   3. Chat area   grows  — greeting + messages, scrollable once panel hits maxHeight
//   4. Input bar   56px   — pinned above footer
//   5. Footer    50.82px  — pinned at bottom
// The outer container has no fixed height — it expands with content up to
// maxHeight: 820px, at which point the chat area becomes scrollable.
// ---------------------------------------------------------------------------

interface CoachingChatViewProps {
  /** Best-move SAN (e.g. "Nf6"). Shown in the BEST MOVE block. */
  engineSan?: string;
  /** Source square of the best move, e.g. "g8". From chess-api.com directly. */
  engineFrom?: string;
  /** Destination square of the best move, e.g. "f6". From chess-api.com directly. */
  engineTo?: string;
  /** Centipawn eval label already formatted (e.g. "+0.42") or null. */
  engineEvalLabel?: string | null;
  /** FEN string for the board. Null → board is hidden. */
  displayFen?: string | null;
  /** Whether the board is shown from black's perspective (used to orient the arrow). */
  boardFlipped?: boolean;
  /** Coaching-tip / visual-analysis text shown above the chat thread. */
  suggestionText?: string;
  /** Initial coach message shown in the chat thread (green-tinted bubble). */
  coachGreeting?: string;
  /** Live chat messages (user + assistant turns). */
  chatMessages?: { role: 'user' | 'assistant'; text: string }[];
  /** Whether the chat is waiting for a reply. */
  chatLoading?: boolean;
  /** Current value of the chat input field. */
  chatInputValue?: string;
  onChatInputChange?: (v: string) => void;
  onChatSubmit?: (e?: React.FormEvent) => void;
  /** Collapse the whole overlay to the mini-bar (header collapse button). */
  onCollapse?: () => void;
  /** Close just the chat panel and return to the expanded overlay (footer "Close chat" button). */
  onCloseChat?: () => void;
  onStop?: () => void;
  stopDisabled?: boolean;
  elapsed?: string;
  /** Current side to move ('w' = White, 'b' = Black). Shown next to BEST MOVE. */
  currentTurn?: 'w' | 'b' | null;
  /** Called when user clicks the flip-turn button. */
  onFlipTurn?: () => void;
}

export function CoachingChatView({
  engineSan,
  engineFrom,
  engineTo,
  engineEvalLabel,
  displayFen,
  boardFlipped,
  suggestionText,
  coachGreeting = 'Position loaded. What do you want to know about c7c5?',
  chatMessages = [],
  chatLoading = false,
  chatInputValue = '',
  onChatInputChange,
  onChatSubmit,
  onCollapse,
  onCloseChat,
  onStop,
  stopDisabled = false,
  elapsed = '00:00',
  currentTurn,
  onFlipTurn,
}: CoachingChatViewProps) {
  const chatEndRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  return (
    <div style={{
      width: 400,
      /* Grow naturally — no fixed height. Cap at 820px then chat area scrolls. */
      maxHeight: 820,
      display: 'flex',
      flexDirection: 'column',
      background: '#FFFFFF',
      borderRadius: 16,
      overflow: 'hidden',
      boxShadow: '0px 4px 24px rgba(0,0,0,0.08)',
      fontFamily: 'Inter, sans-serif',
    }}>

      {/* ── 1. Header — identical to main overlay (OverlayHeader) ── */}
      <OverlayHeader onCollapse={onCollapse ?? (() => {})} />

      {/* ── 2. Window — board + best-move + suggestion (fixed, no scroll) ── */}
      <div style={{
        width: '100%',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '16.82px 16px',
        gap: 20.18,
        background: '#FFFFFF',
        borderTop: '1px solid rgba(0,0,0,0.05)',
        borderBottom: '1px solid rgba(0,0,0,0.05)',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}>

        {/* Chess board — 368×368 */}
        {displayFen && <ChessBoard fen={displayFen} moveFrom={engineFrom} moveTo={engineTo} flipped={boardFlipped} />}

        {/* Best move + suggestion */}
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16.82 }}>

          {/* Best move block */}
          {engineSan && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10.09 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: '#969696', lineHeight: '13px' }}>
                BEST MOVE
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10.09 }}>
                <span style={{ fontSize: 26, fontWeight: 600, color: '#009106', lineHeight: '18px' }}>
                  {engineSan}
                </span>
                {engineEvalLabel && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '1px 6px',
                    gap: 3.36,
                    background: 'rgba(0,145,6,0.1)',
                    border: '0.84px solid rgba(0,145,6,0.1)',
                    borderRadius: 30.27,
                    fontSize: 12,
                    fontWeight: 500,
                    color: '#009106',
                    lineHeight: '18px',
                  }}>
                    {engineEvalLabel}
                  </div>
                )}
                {onFlipTurn && currentTurn && (
                  <button
                    onClick={onFlipTurn}
                    title={`Switch turn to ${currentTurn === 'w' ? 'Black' : 'White'}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '3px 8px',
                      background: 'rgba(0,0,0,0.05)',
                      border: '0.84px solid rgba(0,0,0,0.12)',
                      borderRadius: 20,
                      cursor: 'pointer',
                      fontSize: 11,
                      fontWeight: 500,
                      color: '#464646',
                      lineHeight: '14px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {/* swap icon */}
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M1 5h10M1 5l3-3M1 5l3 3M15 11H5M15 11l-3-3M15 11l-3 3" stroke="#464646" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    {currentTurn === 'w' ? 'White' : 'Black'} to move
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Visual-analysis / suggestion card */}
          {suggestionText && (
            <div style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: 12,
              gap: 10,
              background: '#F5F5F8',
              border: '1px solid rgba(0,0,0,0.1)',
              borderRadius: 12,
              boxSizing: 'border-box',
            }}>
              <p style={{ width: '100%', margin: 0, fontSize: 13, fontWeight: 400, lineHeight: '18px', color: '#464646' }}>
                {suggestionText}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── 3. Chat area — grows freely, scrolls when panel hits maxHeight ── */}
      <div
        className="chess-chat-scroll"
        style={{
          width: '100%',
          /* flex: 1 makes it fill remaining space once at maxHeight */
          flex: '1 1 auto',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          padding: '16px 16px 0 16px',
          gap: 10,
          boxSizing: 'border-box',
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(217,217,217,0.8) transparent',
        } as React.CSSProperties}
      >
        {/* "CHAT WITH COACH" label */}
        <span style={{ fontSize: 12, fontWeight: 500, color: '#969696', lineHeight: '13px', flexShrink: 0 }}>
          CHAT WITH COACH
        </span>

        {/* Coach greeting bubble */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignSelf: 'flex-start',
          padding: 12,
          gap: 10,
          background: '#F8F8ED',
          border: '1px solid #779556',
          borderRadius: '12px 12px 12px 2px',
          maxWidth: 324,
          boxSizing: 'border-box',
          flexShrink: 0,
        }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 400, lineHeight: '18px', color: '#464646', maxWidth: 300 }}>
            {coachGreeting}
          </p>
        </div>

        {/* Dynamic chat messages */}
        {chatMessages.map((msg, idx) => {
          const isUser = msg.role === 'user';
          return (
            <div key={idx} style={{
              display: 'flex',
              justifyContent: isUser ? 'flex-end' : 'flex-start',
              width: '100%',
              flexShrink: 0,
            }}>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                padding: 12,
                gap: 10,
                background: isUser ? '#FFF5EC' : '#F8F8ED',
                border: isUser ? '1px solid #FFAD6D' : '1px solid #779556',
                borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                maxWidth: 300,
                boxSizing: 'border-box',
              }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: isUser ? 500 : 400, lineHeight: '18px', color: '#464646', width: '100%' }}>
                  {msg.text}
                </p>
              </div>
            </div>
          );
        })}

        {/* Loading dots */}
        {chatLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#969696', animation: 'chatpulse 1s infinite 0s' }} />
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#969696', animation: 'chatpulse 1s infinite 0.2s' }} />
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#969696', animation: 'chatpulse 1s infinite 0.4s' }} />
          </div>
        )}

        {/* Scroll anchor + bottom padding */}
        <div ref={chatEndRef} style={{ height: 16, flexShrink: 0 }} />
      </div>

      {/* ── 4. Input bar (fixed, pinned above footer) ── */}
      <div style={{
        width: '100%',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '0 10px 12px',
        gap: 10,
        boxSizing: 'border-box',
      }}>
        <form
          onSubmit={onChatSubmit}
          style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            padding: '2px 6px 2px 12px',
            gap: 4,
            background: '#F7F7F7',
            border: '1px solid rgba(13,13,13,0.1)',
            borderRadius: 9999,
            boxSizing: 'border-box',
            height: 44,
          }}
        >
          <input
            value={chatInputValue}
            onChange={(e) => onChatInputChange?.(e.target.value)}
            placeholder="Ask your coach..."
            style={{
              flex: 1,
              border: 'none',
              background: 'transparent',
              outline: 'none',
              fontSize: 13,
              fontWeight: 500,
              color: '#1E1E1E',
              fontFamily: 'Inter, sans-serif',
              lineHeight: '20px',
            }}
          />
          {/* Send button */}
          <button
            type="submit"
            disabled={!chatInputValue.trim() || chatLoading}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: chatInputValue.trim() && !chatLoading ? 'pointer' : 'default',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: chatInputValue.trim() && !chatLoading ? 1 : 0.4,
              transition: 'opacity 0.15s',
            }}
          >
            <svg width="32" height="32" viewBox="12.8379 11.7683 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="12.8379" y="11.7683" width="32" height="32" rx="16" fill="black"/>
              <rect x="13.3728" y="12.3032" width="30.9302" height="30.9302" rx="15.4651" stroke="#EFEFEF" strokeWidth="1.06984"/>
              <path d="M35.3304 26.8934L24.8304 20.9003C24.6532 20.8006 24.45 20.7572 24.2476 20.776C24.0452 20.7947 23.8533 20.8747 23.6976 21.0052C23.5418 21.1358 23.4295 21.3107 23.3756 21.5067C23.3217 21.7026 23.3288 21.9104 23.396 22.1022L25.3104 27.7684L23.396 33.4353C23.3427 33.5861 23.3264 33.7475 23.3484 33.9059C23.3703 34.0643 23.43 34.2151 23.5223 34.3457C23.6146 34.4763 23.7369 34.5829 23.879 34.6564C24.021 34.73 24.1786 34.7684 24.3385 34.7684C24.5122 34.7681 24.683 34.7229 24.8341 34.6372L35.3291 28.6341C35.4839 28.5474 35.6129 28.421 35.7027 28.268C35.7926 28.115 35.8401 27.9409 35.8404 27.7634C35.8407 27.586 35.7938 27.4117 35.7045 27.2583C35.6152 27.105 35.4867 26.9782 35.3322 26.8909L35.3304 26.8934ZM24.3385 33.7684C24.3388 33.766 24.3388 33.7634 24.3385 33.7609L26.1972 28.2684H29.8385C29.9711 28.2684 30.0983 28.2158 30.192 28.122C30.2858 28.0282 30.3385 27.9011 30.3385 27.7684C30.3385 27.6358 30.2858 27.5087 30.192 27.4149C30.0983 27.3211 29.9711 27.2684 29.8385 27.2684H26.1972L24.3422 21.7784C24.3416 21.7749 24.3403 21.7715 24.3385 21.7684L34.8385 27.7578L24.3385 33.7684Z" fill="white"/>
            </svg>
          </button>
        </form>
      </div>

      {/* ── 5. Footer (fixed, pinned at bottom) ── */}
      <div style={{
        width: '100%',
        height: 50.82,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 8,
        gap: 6.73,
        background: '#F7F7F7',
        borderTop: '1px solid #EFEFEF',
        boxSizing: 'border-box',
      }}>
        {/* Timer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6.73, flexShrink: 0 }}>
          <div style={{ width: 8.41, height: 8.41, borderRadius: '50%', background: '#FB4425', animation: 'pulse 1s infinite', flexShrink: 0 }} />
          <span style={{ fontSize: 15.136, fontWeight: 500, color: '#FB4425', letterSpacing: '-0.02em', fontFamily: 'Inter, sans-serif' }}>
            {elapsed}
          </span>
        </div>

        {/* CTAs */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6.73, flex: 1 }}>
          {/* Close chat button — returns to expanded overlay, does NOT collapse */}
          <button
            onClick={onCloseChat}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 3.36,
              padding: 8,
              height: 34.82,
              background: '#FFFFFF',
              border: '1.07px solid #EFEFEF',
              borderRadius: 10.09,
              boxShadow: '0px 1.07px 12.84px rgba(0,0,0,0.05)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              color: '#1E1E1E',
              letterSpacing: '-0.02em',
              fontFamily: 'Inter, sans-serif',
              flexShrink: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 1L13 13M13 1L1 13" stroke="#1E1E1E" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Close chat
          </button>
          {/* Stop button */}
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

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes chatpulse { 0%,100%{opacity:0.3} 50%{opacity:1} }
        .chess-chat-scroll::-webkit-scrollbar { width: 4px; }
        .chess-chat-scroll::-webkit-scrollbar-track { background: transparent; }
        .chess-chat-scroll::-webkit-scrollbar-thumb { background: rgba(217,217,217,0.8); border-radius: 21px; }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overlay header — exact Figma SVG spec
// Left: 6-dot drag-grid + wordmark (left-aligned, draggable)
// Right: collapse arrow icon — collapses overlay to footer-only
// ---------------------------------------------------------------------------
function OverlayHeader({ onCollapse }: { onCollapse: () => void }) {
  return (
    <div style={{
      background: '#F7F7F7',
      height: 40,
      padding: '8px 12px',
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      boxSizing: 'border-box',
      WebkitAppRegion: 'drag',
    } as React.CSSProperties}>

      {/* Left: drag-grid icon + wordmark */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
        {/* 6-dot drag grid — 2 columns × 3 rows */}
        <svg width="12" height="20" viewBox="0 0 12 20" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
          <circle cx="3" cy="3"   r="1.5" fill="#242424"/>
          <circle cx="9" cy="3"   r="1.5" fill="#242424"/>
          <circle cx="3" cy="10"  r="1.5" fill="#242424"/>
          <circle cx="9" cy="10"  r="1.5" fill="#242424"/>
          <circle cx="3" cy="17"  r="1.5" fill="#242424"/>
          <circle cx="9" cy="17"  r="1.5" fill="#242424"/>
        </svg>
        {/* Wordmark — left-aligned */}
        <div>
          <ChessLensWordmark size={13} variant="default" />
        </div>
      </div>

      {/* Right: collapse button — collapses to footer bar */}
      <button
        onClick={onCollapse}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
        title="Collapse"
      >
        <svg width="12" height="12" viewBox="370 12 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M375.807 22.1022H373.074C372.895 22.1022 372.746 22.0417 372.625 21.9208C372.504 21.7998 372.443 21.65 372.443 21.4713C372.443 21.2925 372.504 21.1427 372.625 21.0221C372.746 20.9013 372.895 20.8409 373.074 20.8409H376.308C376.524 20.8409 376.704 20.9137 376.85 21.0593C376.996 21.205 377.068 21.3855 377.068 21.6008V24.8351C377.068 25.0138 377.008 25.1635 376.887 25.2843C376.766 25.4053 376.616 25.4658 376.438 25.4658C376.259 25.4658 376.109 25.4053 375.988 25.2843C375.867 25.1635 375.807 25.0138 375.807 24.8351V22.1022ZM380.011 17.8977H382.744C382.923 17.8977 383.073 17.9582 383.194 18.0792C383.315 18.2001 383.375 18.3499 383.375 18.5286C383.375 18.7075 383.315 18.8572 383.194 18.9779C383.073 19.0987 382.923 19.1591 382.744 19.1591H379.51C379.295 19.1591 379.114 19.0863 378.969 18.9407C378.823 18.7949 378.75 18.6144 378.75 18.3991V15.1648C378.75 14.9862 378.811 14.8364 378.932 14.7156C379.053 14.5947 379.202 14.5342 379.381 14.5342C379.56 14.5342 379.71 14.5947 379.83 14.7156C379.951 14.8364 380.011 14.9862 380.011 15.1648V17.8977Z" fill="#1E1E1E"/>
        </svg>
      </button>
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
  boardOrientation,
  engineSan,
  engineLan: _engineLan, // kept in IPC pipeline for reference; arrow uses engineFrom/engineTo
  engineFrom,
  engineTo,
  engineEval,
  engineMate,
  onStop,
  onPause,
  onResume,
  onMuteMic,
  onUnmuteMic,
  stopDisabled = false,
  statusText,
  connectingError,
  onFlipTurn,
  isRegenerating = false,
}: PairCompactOverlayProps) {
  const [now, setNow] = useState(Date.now());
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  // Track when the latest FEN arrived so we can show a fallback after a long wait.
  const [lastFenAt, setLastFenAt] = useState<number | null>(null);
  const prevFenRef = useRef<string | null>(null);

  // Derive whether the board should be rendered from Black's perspective.
  // Prefer the authoritative `boardOrientation` prop sent by the main process
  // (derived from the LLM's <perspective> tag on the captured screenshot).
  // Fall back to the legacy FEN-diff heuristic only when the prop is absent
  // (e.g. during a session started before this field was introduced).
  const boardFlipped = useMemo(() => {
    if (boardOrientation !== undefined) return boardOrientation === 'black';
    // Legacy fallback: when the board is rotated 180° for Black, displayFen's
    // board part differs from the engine's white-perspective currentFen.
    if (!currentFen || !displayFen) return false;
    return currentFen.split(' ')[0] !== displayFen.split(' ')[0];
  }, [boardOrientation, currentFen, displayFen]);

  // Track when the board position last changed so we can show a fallback
  // message if the engine/LLM hasn't responded after a reasonable wait.
  const activeFen = displayFen ?? currentFen;
  useEffect(() => {
    const fenBoard = activeFen ? activeFen.split(' ')[0] : null;
    if (fenBoard && fenBoard !== prevFenRef.current) {
      prevFenRef.current = fenBoard;
      setLastFenAt(Date.now());
    }
  }, [activeFen]);

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
  // Engine-only interim tip (prefixed with "engine:") — shown below the coaching
  // tip once the real LLM tip has arrived, so the player can see both.
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

  const chessParagraphText = chessParagraphCard ? compact(chessParagraphCard.text, 300) : '';
  const chessDrillText = chessDrillCard ? compact(chessDrillCard.text, 220) : '';
  // Strip the "engine: " prefix before displaying. No length cap — show full summary.
  const chessEngineText = chessEngineCard
    ? chessEngineCard.text.replace(/^engine:\s*/i, '').trim()
    : '';

  // Format the eval badge label directly from the engine prop values — no regex needed.
  const engineEvalLabel: string | null = engineMate != null
    ? `M${Math.abs(engineMate)}`
    : typeof engineEval === 'number'
      ? `${engineEval >= 0 ? '+' : ''}${engineEval.toFixed(2)}`
      : null;

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

  const chessHasCoachContent = !!(chessParagraphText || engineSan || chessDrillText);
  const chessHasAnyContent = !!(chessHasCoachContent || (displayFen ?? currentFen));
  // Show a fallback message if coaching hasn't arrived 20s after the board was confirmed.
  const coachTipTimedOut = !chessHasCoachContent && lastFenAt !== null && (now - lastFenAt) > 20000;
  const primaryText = isChess
    ? (chessParagraphText || engineSan || '')
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

  // Notify the main process whenever collapsed state changes so it can resize
  // the window to bar-height (collapsed) or let content-height drive it (expanded).
  // useRef tracks whether this is the initial mount — we skip the first fire
  // because the window starts expanded by default and the IPC may not be ready.
  const collapsedInitialMount = useRef(true);
  useEffect(() => {
    if (collapsedInitialMount.current) {
      collapsedInitialMount.current = false;
      return;
    }
    void window.widgetAPI?.setCollapsed(isCollapsed);
  }, [isCollapsed]);

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

  // ── Derive coach greeting from current live position data ──
  const coachGreeting = chessParagraphText
    ? chessParagraphText
    : engineSan
      ? `The best move here is ${engineSan}. What would you like to know?`
      : 'Position loaded. Ask me anything about the current position.';

  // ── CHAT VIEW — shown whenever chatOpen is true ──
  if (chatOpen) {
    return (
      <div style={{ width: '100%', height: 'auto', display: 'flex', flexDirection: 'column', padding: '0 0 10px 0', boxSizing: 'border-box' }}>
        <CoachingChatView
          engineSan={engineSan}
          engineFrom={engineFrom}
          engineTo={engineTo}
          engineEvalLabel={engineEvalLabel}
          displayFen={displayFen ?? currentFen}
          boardFlipped={boardFlipped}
          suggestionText={chessParagraphText || (compactTopTip ?? undefined) || undefined}
          coachGreeting={coachGreeting}
          chatMessages={chatMessages}
          chatLoading={chatLoading}
          chatInputValue={chatInput}
          onChatInputChange={setChatInput}
          onChatSubmit={handleChatSubmit}
          onCollapse={() => { toggleChat(); setIsCollapsed(true); }}
          onCloseChat={() => toggleChat()}
          onStop={onStop}
          stopDisabled={stopDisabled}
          elapsed={elapsed}
        />
        <style>{`
          @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
          @keyframes chatpulse { 0%,100%{opacity:0.3} 50%{opacity:1} }
        `}</style>
      </div>
    );
  }

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
          <OverlayHeader onCollapse={() => setIsCollapsed(true)} />

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
            {connectingError ? (
              /* ── Error state ── */
              <>
                {/* Row 1: warning icon + "FAILED TO START" */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                    <circle cx="7" cy="7" r="6.3" stroke="#E53935" strokeWidth="1.4"/>
                    <line x1="7" y1="4" x2="7" y2="8" stroke="#E53935" strokeWidth="1.4" strokeLinecap="round"/>
                    <circle cx="7" cy="10" r="0.7" fill="#E53935"/>
                  </svg>
                  <span style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: '#E53935',
                    lineHeight: '13px',
                    fontFamily: 'Inter, sans-serif',
                  }}>
                    FAILED TO START
                  </span>
                </div>

                {/* Row 2: error message pill */}
                <div style={{
                  background: '#FFF3F3',
                  borderRadius: 12.84,
                  padding: '6.73px 10.09px',
                  boxShadow: '0px 1.07px 12.84px rgba(0,0,0,0.05)',
                  border: '1px solid rgba(229,57,53,0.15)',
                }}>
                  <span style={{
                    fontSize: 13,
                    fontWeight: 400,
                    color: '#E53935',
                    lineHeight: '18px',
                    fontFamily: 'Inter, sans-serif',
                    display: 'block',
                    wordBreak: 'break-word',
                  }}>
                    {connectingError}
                  </span>
                </div>
              </>
            ) : (
              /* ── Connecting (normal) state ── */
              <>
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
              </>
            )}
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

  // ── COLLAPSED state ──
  // Just the footer bar — logo mark + timer + Chat + Stop + expand icon
  if (isCollapsed) {
    return (
      <div style={{ width: '100%', padding: '0 0 10px 0', boxSizing: 'border-box' }}>
        <div
          style={{
            background: '#F7F7F7',
            borderRadius: 16,
            height: 50.82,
            padding: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 6.73,
            boxSizing: 'border-box',
            boxShadow: '0px 4px 24px rgba(0,0,0,0.08)',
            WebkitAppRegion: 'drag',
          } as React.CSSProperties}>

          {/* Wordmark + timer */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6.73, flexShrink: 0, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {/* Wordmark — matches Figma collapsed bar icon (26×29 wordmark image) */}
            <ChessLensWordmark size={13} variant="default" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6.73 }}>
              <div style={{ width: 8.41, height: 8.41, borderRadius: '50%', background: '#FB4425', animation: 'pulse 1s infinite', flexShrink: 0 }} />
              <span style={{ fontSize: 15.136, fontWeight: 500, color: '#FB4425', letterSpacing: '-0.02em', fontFamily: 'Inter, sans-serif' }}>
                {elapsed}
              </span>
            </div>
          </div>

          {/* CTAs + expand — right side */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6.73, flex: 1, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {/* Chat button */}
            <button
              onClick={() => { setIsCollapsed(false); openChat(); }}
              style={{ display: 'flex', alignItems: 'center', gap: 3.36, padding: 8, height: 34.82, background: '#FFFFFF', border: '1px solid #EFEFEF', borderRadius: 10.09, boxShadow: '0px 1.07px 12.84px rgba(0,0,0,0.05)', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#1E1E1E', letterSpacing: '-0.02em', fontFamily: 'Inter, sans-serif' }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6A1.5 1.5 0 0 1 12.5 11H9l-3 3v-3H3.5A1.5 1.5 0 0 1 2 9.5v-6Z" stroke="#1E1E1E" strokeWidth="1.2" strokeLinejoin="round"/>
              </svg>
              Chat
            </button>
            {/* Stop button */}
            <button
              onClick={onStop}
              disabled={stopDisabled}
              style={{ display: 'flex', alignItems: 'center', gap: 3.36, padding: 8, height: 34.82, background: '#1C1C1C', border: 'none', borderRadius: 10.09, boxShadow: '0px 1.07px 12.84px rgba(0,0,0,0.05)', cursor: stopDisabled ? 'not-allowed' : 'pointer', opacity: stopDisabled ? 0.5 : 1, fontSize: 13, fontWeight: 600, color: '#FFFFFF', letterSpacing: '-0.02em', fontFamily: 'Inter, sans-serif' }}
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="2.5" y="2.5" width="10" height="10" rx="1.5" fill="white"/></svg>
              Stop
            </button>
            {/* Expand icon — expand_content_24dp, Vector at 22.92% inset in 20×20 = #1F1F1F */}
            <button
              onClick={() => setIsCollapsed(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              title="Expand"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* 22.92% of 20 = 4.58px inset each side → path occupies 4.58→15.42 */}
                <path d="M4.58 7.5V4.58H7.5M4.58 12.5V15.42H7.5M15.42 7.5V4.58H12.5M15.42 12.5V15.42H12.5" stroke="#1F1F1F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
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
        <OverlayHeader onCollapse={() => setIsCollapsed(true)} />

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
            <ChessBoard fen={displayFen ?? currentFen ?? ''} moveFrom={engineFrom} moveTo={engineTo} flipped={boardFlipped} />
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
                {/* ── Best move + flip-turn row ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10.09 }}>
                  {engineSan && (
                    <>
                      {/* "BEST MOVE" label — grey */}
                      <span style={{ fontSize: 12, fontWeight: 500, color: '#969696', lineHeight: '13px', fontFamily: 'Inter, sans-serif' }}>
                        BEST MOVE
                      </span>
                      {/* Move + eval badge + flip-turn button — all inline */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10.09 }}>
                        <span style={{ fontSize: 26, fontWeight: 600, color: '#009106', fontFamily: 'Inter, sans-serif', lineHeight: '18px' }}>
                          {engineSan}
                        </span>
                        <div style={{ background: 'rgba(0,145,6,0.1)', border: '0.84px solid rgba(0,145,6,0.1)', borderRadius: 30.27, padding: '1px 6px', fontSize: 12, fontWeight: 500, color: '#009106', fontFamily: 'Inter, sans-serif' }}>
                          {engineEvalLabel ?? 'Best'}
                        </div>
                        {/* Flip-turn button — inline beside eval badge, hidden while regenerating */}
                        {onFlipTurn && currentTurn && !isRegenerating && (
                          <button
                            onClick={onFlipTurn}
                            title={`Switch turn to ${currentTurn === 'w' ? 'Black' : 'White'}`}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '3px 8px',
                              background: 'rgba(0,0,0,0.05)',
                              border: '0.84px solid rgba(0,0,0,0.12)',
                              borderRadius: 20,
                              cursor: 'pointer',
                              fontSize: 11,
                              fontWeight: 500,
                              color: '#464646',
                              fontFamily: 'Inter, sans-serif',
                              lineHeight: '14px',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M1 5h10M1 5l3-3M1 5l3 3M15 11H5M15 11l-3-3M15 11l-3 3" stroke="#464646" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            {currentTurn === 'w' ? 'White' : 'Black'} to move
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* ── Regenerating indicator — shown while engine re-runs after turn flip ── */}
                {isRegenerating && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'rgba(0,145,6,0.06)', border: '0.84px solid rgba(0,145,6,0.15)', borderRadius: 10, boxSizing: 'border-box' }}>
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'conic-gradient(from 90deg, rgba(0,145,6,1) 0deg, rgba(196,196,196,0) 360deg)', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#009106', lineHeight: '14px', fontFamily: 'Inter, sans-serif' }}>
                      Switching turn, regenerating tip…
                    </span>
                  </div>
                )}

                {/* ── Coaching tip card ── */}
                {/* Shows spinner+"COACHING TIP INCOMING..." while pending, tip text when arrived */}
                <div style={{ background: '#F5F5F8', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 12, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 38, boxSizing: 'border-box', justifyContent: 'center' }}>
                  {chessParagraphText ? (
                    /* Tip has arrived — wrap naturally */
                    <p style={{ fontSize: 13, lineHeight: '18px', color: '#464646', fontFamily: 'Inter, sans-serif', margin: 0 }}>
                      {chessParagraphText}
                    </p>
                  ) : (
                    /* Tip still loading — spinner or timeout fallback */
                    coachTipTimedOut ? (
                      <span style={{ fontSize: 12, fontWeight: 400, color: '#969696', lineHeight: '16px', fontFamily: 'Inter, sans-serif' }}>
                        Engine is taking longer than usual. Tip will appear when ready.
                      </span>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <div style={{ width: 14, height: 14, borderRadius: '50%', background: 'conic-gradient(from 90deg, rgba(254,72,11,1) 0deg, rgba(196,196,196,0) 360deg)', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                        <span style={{ fontSize: 12, fontWeight: 500, color: '#464646', lineHeight: '13px', fontFamily: 'Inter, sans-serif' }}>
                          COACHING TIP INCOMING...
                        </span>
                      </div>
                    )
                  )}
                </div>

                {/* ── Engine output text — shown ONLY after the coaching tip has arrived ── */}
                {chessParagraphText && chessEngineText && (
                  <div style={{ background: '#F7F7F7', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 12, padding: '12px 13px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {/* Header row: gear icon + "Engine" label */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                        <path d="M7.39783 6.66642V3.60242C7.39783 3.43053 7.45527 3.28714 7.57016 3.17226C7.68516 3.05726 7.82855 2.99976 8.00033 2.99976H13.731C13.9029 2.99976 14.0463 3.05726 14.1612 3.17226C14.2762 3.28714 14.3337 3.43053 14.3337 3.60242V6.66642C14.3337 6.8382 14.2762 6.98159 14.1612 7.09659C14.0463 7.21148 13.9029 7.26892 13.731 7.26892H8.00033C7.82855 7.26892 7.68516 7.21148 7.57016 7.09659C7.45527 6.98159 7.39783 6.8382 7.39783 6.66642ZM1.66699 12.3971V9.33309C1.66699 9.16131 1.72449 9.01792 1.83949 8.90292C1.95438 8.78803 2.09777 8.73059 2.26966 8.73059H7.33366C7.50544 8.73059 7.64883 8.78803 7.76383 8.90292C7.87871 9.01792 7.93616 9.16131 7.93616 9.33309V12.3971C7.93616 12.569 7.87871 12.7124 7.76383 12.8273C7.64883 12.9423 7.50544 12.9998 7.33366 12.9998H2.26966C2.09777 12.9998 1.95438 12.9423 1.83949 12.8273C1.72449 12.7124 1.66699 12.569 1.66699 12.3971ZM1.66699 6.66642V3.60242C1.66699 3.43053 1.72449 3.28714 1.83949 3.17226C1.95438 3.05726 2.09777 2.99976 2.26966 2.99976H5.33366C5.50544 2.99976 5.64883 3.05726 5.76383 3.17226C5.87871 3.28714 5.93616 3.43053 5.93616 3.60242V6.66642C5.93616 6.8382 5.87871 6.98159 5.76383 7.09659C5.64883 7.21148 5.50544 7.26892 5.33366 7.26892H2.26966C2.09777 7.26892 1.95438 7.21148 1.83949 7.09659C1.72449 6.98159 1.66699 6.8382 1.66699 6.66642ZM8.39766 6.26909H13.3337V3.99976H8.39766V6.26909ZM2.66699 11.9998H6.93633V9.73042H2.66699V11.9998ZM2.66699 6.26909H4.93633V3.99976H2.66699V6.26909ZM10.1952 12.9716L9.79516 13.1088C9.68494 13.1446 9.57749 13.1434 9.47283 13.1049C9.36805 13.0664 9.28533 13.001 9.22466 12.9088L9.13616 12.7459C9.07549 12.6425 9.05199 12.5333 9.06566 12.4184C9.07933 12.3034 9.13449 12.2066 9.23116 12.1279L9.53366 11.8689C9.48577 11.6818 9.46183 11.4946 9.46183 11.3074C9.46183 11.1202 9.48577 10.933 9.53366 10.7459L9.23116 10.4869C9.13883 10.4126 9.08366 10.3186 9.06566 10.2049C9.04777 10.0913 9.06916 9.9827 9.12983 9.87926L9.24133 9.70626C9.30199 9.61392 9.38194 9.54853 9.48116 9.51009C9.58027 9.47164 9.68494 9.47037 9.79516 9.50626L10.1952 9.64342C10.3259 9.51598 10.4678 9.4132 10.6208 9.33509C10.7738 9.25687 10.9362 9.19209 11.108 9.14076L11.176 8.74726C11.2008 8.63014 11.2576 8.53398 11.3465 8.45876C11.4354 8.38353 11.5384 8.34592 11.6555 8.34592H11.8323C11.9494 8.34592 12.0524 8.38526 12.1413 8.46392C12.2302 8.54248 12.287 8.64031 12.3118 8.75742L12.3798 9.14076C12.5516 9.19209 12.714 9.25687 12.867 9.33509C13.02 9.4132 13.1619 9.51598 13.2927 9.64342L13.6927 9.50626C13.8029 9.47037 13.9103 9.47164 14.015 9.51009C14.1198 9.54853 14.2025 9.61392 14.2632 9.70626L14.3515 9.86892C14.4123 9.97237 14.4358 10.0816 14.422 10.1966C14.4083 10.3115 14.3532 10.4083 14.2567 10.4869L13.9542 10.7459C14.002 10.933 14.026 11.1202 14.026 11.3074C14.026 11.4946 14.002 11.6818 13.9542 11.8689L14.2567 12.1279C14.349 12.2023 14.4041 12.2963 14.422 12.4101C14.44 12.5238 14.4187 12.6323 14.358 12.7356L14.2465 12.9088C14.1858 13.001 14.1059 13.0664 14.0067 13.1049C13.9075 13.1434 13.8029 13.1446 13.6927 13.1088L13.2927 12.9716C13.1575 13.0989 13.0146 13.2017 12.8638 13.2799C12.7129 13.3581 12.5516 13.4229 12.3798 13.4741L12.3118 13.8678C12.287 13.9848 12.2302 14.0809 12.1413 14.1561C12.0524 14.2313 11.9494 14.2689 11.8323 14.2689H11.6555C11.5384 14.2689 11.4354 14.2296 11.3465 14.1511C11.2576 14.0724 11.2008 13.9745 11.176 13.8574L11.108 13.4741C10.9362 13.4229 10.7749 13.3581 10.624 13.2799C10.4732 13.2017 10.3303 13.0989 10.1952 12.9716ZM12.724 12.2876C12.9937 12.0179 13.1285 11.6912 13.1285 11.3074C13.1285 10.9236 12.9937 10.5969 12.724 10.3273C12.4543 10.0576 12.1276 9.92276 11.7438 9.92276C11.3602 9.92276 11.0335 10.0576 10.7638 10.3273C10.4942 10.5969 10.3593 10.9236 10.3593 11.3074C10.3593 11.6912 10.4942 12.0179 10.7638 12.2876C11.0335 12.5573 11.3602 12.6921 11.7438 12.6921C12.1276 12.6921 12.4543 12.5573 12.724 12.2876Z" fill="#1E1E1E"/>
                      </svg>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#1E1E1E', lineHeight: '15px', fontFamily: 'Inter, sans-serif' }}>
                        Engine
                      </span>
                    </div>
                    {/* Engine analysis text */}
                    <p style={{ fontSize: 13, lineHeight: '18px', color: '#464646', fontFamily: 'Inter, sans-serif', margin: 0 }}>
                      {chessEngineText}
                    </p>
                  </div>
                )}

                {/* Waiting for next move */}
                {chessWaitingText && !chessParagraphText && (
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

                {/* Nudge */}
                {nudge && (
                  <div style={{ background: 'var(--color-chat-user-bg)', border: '1px solid var(--color-chat-note-border)', borderRadius: 10, padding: '8px 12px', fontSize: 13, color: '#464646', fontFamily: 'Inter, sans-serif' }}>
                    {nudge.message}
                  </div>
                )}
              </>
            )}
          </div>


        </div>

        {/* Footer */}
        <div style={{ background: '#F7F7F7', height: 50.82, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxSizing: 'border-box', gap: 6.73 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6.73, flexShrink: 0 }}>
            <div style={{ width: 8.41, height: 8.41, borderRadius: '50%', background: '#FB4425', animation: 'pulse 1s infinite', flexShrink: 0 }} />
            <span style={{ fontSize: 15.136, fontWeight: 500, color: '#FB4425', letterSpacing: '-0.02em', fontFamily: 'Inter, sans-serif' }}>{elapsed}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6.73, flex: 1 }}>
            <button onClick={() => openChat()} style={{ display: 'flex', alignItems: 'center', gap: 3.36, padding: 8, height: 34.82, background: '#FFFFFF', border: '1px solid #EFEFEF', borderRadius: 10.09, boxShadow: '0px 1.07px 12.84px rgba(0,0,0,0.05)', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#1E1E1E', letterSpacing: '-0.02em', fontFamily: 'Inter, sans-serif' }}>
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
