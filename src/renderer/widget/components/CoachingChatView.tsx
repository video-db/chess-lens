import React from 'react';
import { ChessBoard } from './ChessBoard';
import { OverlayHeader } from './OverlayHeader';

// ---------------------------------------------------------------------------
// CoachingChatView â€” full overlay panel shown when user clicks the Chat button.
// Layout (top â†’ bottom):
//   1. Header      40px   â€” shared OverlayHeader (consistent with main overlay)
//   2. Window      fixed  â€” board + best-move + suggestion
//   3. Chat area   grows  â€” greeting + messages, scrollable once panel hits maxHeight
//   4. Input bar   56px   â€” pinned above footer
//   5. Footer    50.82px  â€” pinned at bottom
// The outer container has no fixed height â€” it expands with content up to
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
  /** FEN string for the board. Null â†’ board is hidden. */
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
  const displayFenBoard = displayFen?.split(' ')[0] ?? null;
  React.useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  return (
    <div style={{
      width: 400,
      /* Grow naturally â€” no fixed height. Cap dynamically so the overlay never
         exceeds the available screen height on small/low-res displays.
         window.screen.availHeight excludes the OS taskbar/dock; subtracting 60px
         accounts for WIDGET_MARGIN (20 top + 20 bottom) and WIDGET_HEIGHT_PADDING
         (40px) that the main-process window-sizing already reserves, keeping
         content cleanly inside the clamped BrowserWindow on any screen size.
         On large screens (â‰¥ 880 px tall) the original 820 px cap wins unchanged. */
      maxHeight: Math.min(820, window.screen.availHeight - 60),
      display: 'flex',
      flexDirection: 'column',
      background: '#FFFFFF',
      borderRadius: 16,
      overflow: 'hidden',
      boxShadow: '0px 4px 24px rgba(0,0,0,0.08)',
      fontFamily: 'Inter, sans-serif',
    }}>

      {/* â”€â”€ 1. Header â€” identical to main overlay (OverlayHeader) â”€â”€ */}
      <OverlayHeader onCollapse={onCollapse ?? (() => {})} />

      {/* â”€â”€ 2. Window â€” board + best-move + suggestion (fixed, no scroll) â”€â”€ */}
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

        {/* Chess board â€” 368Ã—368 */}
        {displayFen && <ChessBoard key={displayFenBoard} fen={displayFen} moveFrom={engineFrom} moveTo={engineTo} flipped={boardFlipped} />}

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
                      background: 'rgba(0,145,6,0.08)',
                      border: '1px solid rgba(0,145,6,0.35)',
                      borderRadius: 20,
                      cursor: 'pointer',
                      fontSize: 11,
                      fontWeight: 500,
                      color: '#007a05',
                      lineHeight: '14px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {/* swap icon */}
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M1 5h10M1 5l3-3M1 5l3 3M15 11H5M15 11l-3-3M15 11l-3 3" stroke="#007a05" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    {currentTurn === 'w' ? 'White' : 'Black'} to move
                  </button>
                )}
              </div>
              {onFlipTurn && currentTurn && (
                <span style={{ fontSize: 10, color: '#888', lineHeight: '13px', marginTop: -4 }}>
                  Wrong turn detected? Switch side to recalculate.
                </span>
              )}
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

      {/* â”€â”€ 3. Chat area â€” grows freely, scrolls when panel hits maxHeight â”€â”€ */}
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

      {/* â”€â”€ 4. Input bar (fixed, pinned above footer) â”€â”€ */}
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

      {/* â”€â”€ 5. Footer (fixed, pinned at bottom) â”€â”€ */}
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
          {/* Close chat button â€” returns to expanded overlay, does NOT collapse */}
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

