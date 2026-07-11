import React from 'react';
import { ChessLensWordmark } from '../../components/ui/ChessLensWordmark';

interface CollapsedOverlayBarProps {
  elapsed: string;
  stopDisabled: boolean;
  onExpand: () => void;
  onOpenChat: () => void;
  onStop: () => void;
}

export function CollapsedOverlayBar({
  elapsed,
  stopDisabled,
  onExpand,
  onOpenChat,
  onStop,
}: CollapsedOverlayBarProps) {
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
        } as React.CSSProperties}
      >
        <svg width="12" height="20" viewBox="0 0 12 20" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
          <circle cx="3" cy="3" r="1.5" fill="#242424" />
          <circle cx="9" cy="3" r="1.5" fill="#242424" />
          <circle cx="3" cy="10" r="1.5" fill="#242424" />
          <circle cx="9" cy="10" r="1.5" fill="#242424" />
          <circle cx="3" cy="17" r="1.5" fill="#242424" />
          <circle cx="9" cy="17" r="1.5" fill="#242424" />
        </svg>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6.73, flexShrink: 0, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <ChessLensWordmark size={13} variant="default" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6.73 }}>
            <div style={{ width: 8.41, height: 8.41, borderRadius: '50%', background: '#FB4425', animation: 'pulse 1s infinite', flexShrink: 0 }} />
            <span style={{ fontSize: 15.136, fontWeight: 500, color: '#FB4425', letterSpacing: '-0.02em', fontFamily: 'Inter, sans-serif' }}>
              {elapsed}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6.73, flex: 1, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={onOpenChat}
            style={{ display: 'flex', alignItems: 'center', gap: 3.36, padding: 8, height: 34.82, background: '#FFFFFF', border: '1px solid #EFEFEF', borderRadius: 10.09, boxShadow: '0px 1.07px 12.84px rgba(0,0,0,0.05)', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#1E1E1E', letterSpacing: '-0.02em', fontFamily: 'Inter, sans-serif' }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6A1.5 1.5 0 0 1 12.5 11H9l-3 3v-3H3.5A1.5 1.5 0 0 1 2 9.5v-6Z" stroke="#1E1E1E" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
            Chat
          </button>
          <button
            onClick={onStop}
            disabled={stopDisabled}
            style={{ display: 'flex', alignItems: 'center', gap: 3.36, padding: 8, height: 34.82, background: '#1C1C1C', border: 'none', borderRadius: 10.09, boxShadow: '0px 1.07px 12.84px rgba(0,0,0,0.05)', cursor: stopDisabled ? 'not-allowed' : 'pointer', opacity: stopDisabled ? 0.5 : 1, fontSize: 13, fontWeight: 600, color: '#FFFFFF', letterSpacing: '-0.02em', fontFamily: 'Inter, sans-serif' }}
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="2.5" y="2.5" width="10" height="10" rx="1.5" fill="white" /></svg>
            Stop
          </button>
          <button
            onClick={onExpand}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            title="Expand"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4.58 7.5V4.58H7.5M4.58 12.5V15.42H7.5M15.42 7.5V4.58H12.5M15.42 12.5V15.42H12.5" stroke="#1F1F1F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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

