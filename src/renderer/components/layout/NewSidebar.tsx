/**
 * NewSidebar Component
 *
 * Sidebar matching Figma — 72px wide, logo + nav icons + logout.
 * Active icon: #C14103 color, #FFE9D3 container bg.
 * Inactive icon: #000000 full opacity (no dimming per Figma).
 */

import React from 'react';
import { History, Settings, LogOut } from 'lucide-react';
import { useConfigStore } from '../../stores/config.store';
import { useSessionStore } from '../../stores/session.store';
import { getElectronAPI } from '../../api/ipc';
import { ChessLensIconBlack } from '../ui/ChessLensIcon';

type Tab = 'home' | 'history' | 'settings';

interface NewSidebarProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  className?: string;
}

// ── Recording pulse indicator — shown when actively recording ─────────────────
function RecordingIndicatorIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9" stroke="var(--color-brand)" strokeWidth="1.5" fill="var(--color-brand-tint-bg-xl)" />
      <circle cx="12" cy="12" r="5" fill="var(--color-status-danger)" className="animate-pulse" />
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
      icon: (active) => isRecording
        ? <RecordingIndicatorIcon />
        : <History className="w-6 h-6" style={{ color: active ? '#C14103' : '#000000' }} />,
      label: isRecording ? 'Recording' : 'Game Library',
    },
    {
      id: 'settings',
      icon: (active) => <Settings className="w-6 h-6" style={{ color: active ? '#C14103' : '#000000' }} />,
      label: 'Settings',
    },
  ];

  return (
    <div className={`flex flex-col h-full bg-white border-r border-black/10 ${className}`}>
      <div className="flex-1 flex flex-col items-center gap-[20px] p-[20px]">
        <ChessLensIconBlack size={32} className="rounded-[5px]" />
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
          <LogOut className="w-6 h-6 text-black" />
        </button>
      </div>
    </div>
  );
}

export default NewSidebar;
