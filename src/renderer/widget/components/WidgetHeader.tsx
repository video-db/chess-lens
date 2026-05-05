import React from 'react';
import logoIcon from '../../../../../resources/chess-lens-icon-black.svg';

function CollapseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M5 12L10 7L15 12"
        stroke="#1E1E1E"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WidgetHeader() {
  const handleCollapse = () => {
    window.widgetAPI?.hide();
  };

  return (
    <div
      className="flex items-center justify-between"
      style={{
        height: '40px',
        padding: '8px 12px',
        gap: '10px',
        background: 'var(--color-widget-header-bg)',
        borderBottom: '1px solid var(--color-widget-border)',
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      {/* Left: Logo + wordmark image */}
      <div className="flex items-center gap-[3.36px] flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <img src={logoIcon} width={20} height={20} alt="Chess Lens" className="rounded-[3px]" />
      </div>

      {/* Right: Collapse icon */}
      <div
        className="flex items-center"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={handleCollapse}
          className="flex items-center justify-center hover:opacity-70 transition-opacity"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          title="Collapse"
        >
          <CollapseIcon />
        </button>
      </div>
    </div>
  );
}
