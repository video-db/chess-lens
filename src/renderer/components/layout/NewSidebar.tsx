/**
 * NewSidebar Component
 *
 * Sidebar matching Figma — 72px wide, logo + nav icons + logout.
 * Active icon: #C14103 color, #FFE9D3 container bg.
 * Inactive icon: #000000 full opacity (no dimming per Figma).
 */

import React from 'react';
import { useConfigStore } from '../../stores/config.store';
import { useSessionStore } from '../../stores/session.store';
import { getElectronAPI } from '../../api/ipc';
import logoIcon from '../../../../resources/chess-lens-icon-black.svg';

type Tab = 'home' | 'history' | 'settings';

interface NewSidebarProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  className?: string;
}

// ── Game Library / History Icon ───────────────────────────────────────────────
function GameLibraryIcon({ active }: { active: boolean }) {
  const color = active ? '#C14103' : '#000000';
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {active && (
        <circle cx="12" cy="12" r="8.25" fill="#C14103" opacity={0.2} />
      )}
      <path d="M3 3v5h5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 7v5l4 2" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Recording Indicator Icon ──────────────────────────────────────────────────
function RecordingIndicatorIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9" stroke="var(--color-brand)" strokeWidth="1.5" fill="var(--color-brand-tint-bg-xl)" />
      <circle cx="12" cy="12" r="5" fill="var(--color-status-danger)" className="animate-pulse" />
    </svg>
  );
}

// ── Settings Icon ─────────────────────────────────────────────────────────────
function SettingsIcon({ active }: { active: boolean }) {
  const color = active ? '#C14103' : '#000000';
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="3" stroke={color} strokeWidth="1.5" />
      <path
        d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Logout Icon ───────────────────────────────────────────────────────────────
function LogoutIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke="#000000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 17l5-5-5-5M21 12H9" stroke="#000000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
export function NewSidebar({ activeTab, onTabChange, className = '' }: NewSidebarProps) {
  const configStore = useConfigStore();
  const { status } = useSessionStore();
  const isRecording = status === 'recording';

  const handleLogout = async () => {
    const api = getElectronAPI();
    if (api) await api.app.logout();
    configStore.clearAuth();
  };

  const tabs: { id: Tab; icon: (active: boolean) => React.ReactNode; label: string }[] = [
    {
      id: 'home',
      icon: (a) => isRecording ? <RecordingIndicatorIcon /> : <GameLibraryIcon active={a} />,
      label: isRecording ? 'Recording' : 'Game Library',
    },
    { id: 'settings', icon: (a) => <SettingsIcon active={a} />, label: 'Settings' },
  ];

  return (
    <div className={`flex flex-col h-full bg-white border-r border-black/10 ${className}`}>
      <div className="flex-1 flex flex-col items-center gap-[20px] p-[20px]">
        <img src={logoIcon} width={32} height={32} alt="Chess Lens" className="rounded-[5px]" />
        {tabs.map(({ id, icon, label }) => (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={`p-[4px] rounded-[6px] transition-colors ${
              activeTab === id ? 'bg-sidebar-active' : 'hover:bg-surface-hover'
            }`}
            title={label}
          >
            {icon(activeTab === id)}
          </button>
        ))}
      </div>
      <div className="flex flex-col items-center pb-[20px]">
        <button
          onClick={handleLogout}
          className="p-[4px] rounded-[6px] hover:bg-surface-hover transition-colors"
          title="Log out"
        >
          <LogoutIcon />
        </button>
      </div>
    </div>
  );
}

export default NewSidebar;
