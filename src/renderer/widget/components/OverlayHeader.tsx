import React from 'react';
import { ChessLensWordmark } from '../../components/ui/ChessLensWordmark';

// ---------------------------------------------------------------------------
// Overlay header â€” exact Figma SVG spec
// Left: 6-dot drag-grid + wordmark (left-aligned, draggable)
// Right: collapse arrow icon â€” collapses overlay to footer-only
// ---------------------------------------------------------------------------
export function OverlayHeader({ onCollapse }: { onCollapse: () => void }) {
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
        {/* 6-dot drag grid â€” 2 columns Ã— 3 rows */}
        <svg width="12" height="20" viewBox="0 0 12 20" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
          <circle cx="3" cy="3"   r="1.5" fill="#242424"/>
          <circle cx="9" cy="3"   r="1.5" fill="#242424"/>
          <circle cx="3" cy="10"  r="1.5" fill="#242424"/>
          <circle cx="9" cy="10"  r="1.5" fill="#242424"/>
          <circle cx="3" cy="17"  r="1.5" fill="#242424"/>
          <circle cx="9" cy="17"  r="1.5" fill="#242424"/>
        </svg>
        {/* Wordmark â€” left-aligned */}
        <div>
          <ChessLensWordmark size={13} variant="default" />
        </div>
      </div>

      {/* Right: collapse button â€” collapses to footer bar */}
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

