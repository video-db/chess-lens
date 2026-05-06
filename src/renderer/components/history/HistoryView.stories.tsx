/**
 * HistoryView Stories
 *
 * Storybook for the Game Library page — uses the exact same JSX and Tailwind
 * classes as the live HistoryView and RecordingCard components.
 *
 * Run with:  npm run storybook   →   http://localhost:6006
 * Navigate to:  History / HistoryView
 */

import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Calendar, Clock, History, Search, Settings, LogOut, Swords, ChevronRight } from 'lucide-react';

// ── Shared helpers (mirrors live utils) ──────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatDurationMinutes(seconds: number): string {
  const mins = Math.round(seconds / 60);
  return `${mins} min`;
}

// ── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_OVERVIEW =
  'Magnus Carlsen opened with the Ruy López, quickly seizing control of the center by move 15. Caruana responded with a sharp queenside counter-attack, but Carlsen\'s precise endgame technique proved decisive. After 62 moves, Carlsen converted his passed pawn advantage into a clean victory. The game lasted approximately 5 hours and 20 minutes, with Carlsen finishing with 12 minutes remaining on his clock and Caruana left with just 3 minutes.';

const MOCK_RECORDINGS = [
  {
    id: 1,
    meetingName: 'Magnus Carlsen vs. Gaurav Tyagi',
    createdAt: '2025-03-20T10:00:00.000Z',
    duration: 900,
    status: 'available' as const,
    shortOverview: MOCK_OVERVIEW,
  },
  {
    id: 2,
    meetingName: 'Magnus Carlsen vs. Hikaru Nakamura',
    createdAt: '2026-03-20T10:00:00.000Z',
    duration: 1500,
    status: 'available' as const,
    shortOverview: MOCK_OVERVIEW,
  },
  {
    id: 3,
    meetingName: 'Magnus Carlsen vs. Ian Nepomniachtchi',
    createdAt: '2025-03-20T10:00:00.000Z',
    duration: 1440,
    status: 'available' as const,
    shortOverview: MOCK_OVERVIEW,
  },
];

// ── Record icon — exact copy from live HistoryView ────────────────────────────

const RecordIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path fillRule="evenodd" clipRule="evenodd" d="M10 2.125C5.65076 2.125 2.125 5.65076 2.125 10C2.125 14.3492 5.65076 17.875 10 17.875C14.3492 17.875 17.875 14.3492 17.875 10C17.875 5.65076 14.3492 2.125 10 2.125ZM0.875 10C0.875 4.96043 4.96043 0.875 10 0.875C15.0396 0.875 19.125 4.96043 19.125 10C19.125 15.0396 15.0396 19.125 10 19.125C4.96043 19.125 0.875 15.0396 0.875 10Z" fill="white"/>
    <circle cx="10" cy="10" r="3.5" fill="white"/>
  </svg>
);

// ── Mock RecordingCard — exact copy of live RecordingCard JSX ─────────────────

function MockRecordingCard({ recording, onClick }: { recording: typeof MOCK_RECORDINGS[0]; onClick: () => void }) {
  const title = recording.meetingName || `Recording - ${formatDate(recording.createdAt)}`;
  const description = recording.shortOverview || 'No summary available yet.';

  return (
    <div
      onClick={onClick}
      className="bg-surface-muted border border-border-default rounded-[16px] pt-[20px] pb-[24px] px-[20px] cursor-pointer transition-all duration-200 flex flex-col gap-[20px] h-full hover:bg-[#f0fdf4] hover:border-[#86efac]"
    >
      {/* Header */}
      <div className="flex flex-col gap-[10px]">
        <h3 className="text-[18px] font-medium text-black leading-[22px] tracking-[0.005em] line-clamp-1">
          {title}
        </h3>
        {/* Metadata */}
        <div className="flex items-center gap-[20px]">
          <div className="flex items-center gap-[4px]">
            <Calendar className="h-4 w-4 text-text-body opacity-20" />
            <span className="text-sm text-text-body tracking-[0.005em]">{formatDate(recording.createdAt)}</span>
          </div>
          {recording.duration && (
            <div className="flex items-center gap-[4px]">
              <Clock className="h-4 w-4 text-text-body opacity-20" />
              <span className="text-sm text-text-body tracking-[0.005em]">{formatDurationMinutes(recording.duration)}</span>
            </div>
          )}
          <div className="flex items-center gap-[4px]">
            <Swords className="h-4 w-4 text-text-body opacity-20" />
            <span className="text-sm text-text-body tracking-[0.005em]">— Moves</span>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-black/10 w-full" />

      {/* Description */}
      <p className="text-sm text-text-faint leading-[22px] tracking-[0.005em] line-clamp-4">
        {description}
      </p>
    </div>
  );
}

// ── Alert banner — recording active ──────────────────────────────────────────

function MockAlertBanner() {
  return (
    <div
      className="flex flex-row items-center gap-[10px] px-[16px] py-[12px] rounded-[12px] flex-shrink-0"
      style={{ background: '#FFF5EC', border: '1px solid #FFAD6D' }}
    >
      {/* Pulsing dot */}
      <div className="relative w-[16px] h-[16px] flex items-center justify-center flex-shrink-0">
        <div className="absolute w-[16px] h-[16px] rounded-full" style={{ background: '#E2462C', opacity: 0.1 }} />
        <div className="w-[6px] h-[6px] rounded-full" style={{ background: '#E2462C' }} />
      </div>

      {/* Message */}
      <div className="flex flex-row items-center gap-[4px] flex-1">
        <span className="text-[13px] font-semibold" style={{ color: '#111928' }}>
          Recording in progress.
        </span>
        <span className="text-[13px] font-normal flex-1" style={{ color: '#111928' }}>
          A game session is currently active. The new recording will appear here once it ends.
        </span>
        <div className="flex items-center gap-[4px] flex-shrink-0">
          <span className="text-[13px] font-semibold cursor-pointer" style={{ color: '#EC5B16' }}>
            View recording
          </span>
          <ChevronRight className="h-[20px] w-[20px]" style={{ color: '#EC5B16' }} />
        </div>
      </div>
    </div>
  );
}

// ── Mock Sidebar — matches live NewSidebar (history tab active) ───────────────

function MockSidebar() {
  return (
    <div
      style={{
        width: 72,
        height: '100%',
        background: '#FFFFFF',
        borderRight: '1px solid rgba(0,0,0,0.1)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '0 0 20px',
        flexShrink: 0,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: 20, flex: 1 }}>
        {/* Logo */}
        <div style={{ width: 32, height: 32, background: '#000000', borderRadius: 5.46, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="5" fill="white" opacity="0.9"/>
            <circle cx="9" cy="9" r="2" fill="#FF4000"/>
          </svg>
        </div>
        {/* History icon — active */}
        <div style={{ width: 32, height: 32, borderRadius: 6, background: '#FFE9D3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <History size={20} color="#C14103" />
        </div>
        {/* Settings icon */}
        <div style={{ width: 32, height: 32, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Settings size={20} color="#000000" style={{ opacity: 0.2 }} />
        </div>
      </div>
      {/* Logout */}
      <div style={{ width: 32, height: 32, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LogOut size={20} color="#000000" />
      </div>
    </div>
  );
}

// ── Full HistoryView — exact live structure ───────────────────────────────────

function MockHistoryView({ isRecordingActive }: { isRecordingActive: boolean }) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredRecordings = MOCK_RECORDINGS.filter((r) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return r.meetingName?.toLowerCase().includes(q) || r.shortOverview?.toLowerCase().includes(q);
  });

  const hasRecordings = MOCK_RECORDINGS.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'row', width: '100%', height: '100vh', background: '#FFFFFF', overflow: 'hidden' }}>
      <MockSidebar />
      <div className="h-full flex flex-col bg-surface-muted" style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
      <div className="flex-1 flex flex-col overflow-hidden px-[10px] pt-[10px] gap-[10px]">

        {/* Header row */}
        <div className="flex items-center gap-[12px] px-[20px] pt-[10px]">
          <h1 className="text-[22px] font-semibold text-black tracking-[0.005em] flex-1">
            Game Library
          </h1>

          {/* Search */}
          {hasRecordings && (
            <div className="relative w-[376px]">
              <Search className="absolute left-[10px] top-1/2 -translate-y-1/2 h-[20px] w-[20px] text-text-muted-brand" />
              <input
                type="text"
                placeholder="Search session name, opponent, opening"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-[43px] pl-[34px] pr-[10px] rounded-[12px] border border-[#E1E1E1] bg-white text-[14px] font-normal text-text-label placeholder:text-text-muted-brand focus:outline-none focus:border-border-default transition-colors"
              />
            </div>
          )}

          {/* Start New Game button */}
          {hasRecordings && (
            <button className="flex items-center gap-[4px] px-[20px] h-[44px] bg-brand-cta hover:bg-brand-cta-hover rounded-[12px] text-[14px] font-semibold text-white transition-colors shadow-[0px_1.27px_15.27px_rgba(0,0,0,0.05)] flex-shrink-0">
              <RecordIcon />
              <span>Start New Game</span>
            </button>
          )}
        </div>

        {/* Main container */}
        <div className="flex-1 flex flex-col mx-0 mb-0 bg-white border border-border-default rounded-[20px_20px_0px_0px] overflow-hidden">
          <div className="flex-1 overflow-y-auto px-[20px] pt-[20px] pb-[20px]">
            <div className="flex flex-col gap-[20px]">

              {/* Alert banner — only when recording active */}
              {isRecordingActive && <MockAlertBanner />}

              {/* Cards grid */}
              {filteredRecordings.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-[12px] py-[40px]">
                  <p className="text-[22px] font-medium text-black text-center">No matching recordings</p>
                  <p className="text-base text-text-body text-center max-w-[370px]">Try a different search term</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[20px]">
                  {filteredRecordings.map((recording) => (
                    <MockRecordingCard
                      key={recording.id}
                      recording={recording}
                      onClick={() => {}}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta: Meta = {
  title: 'History/HistoryView',
  parameters: {
    layout: 'fullscreen',
    backgrounds: { default: 'light', values: [{ name: 'light', value: '#f5f5f5' }] },
  },
};

export default meta;
type Story = StoryObj;

// ── Stories ───────────────────────────────────────────────────────────────────

/**
 * Normal game library — no active recording.
 */
export const Default: Story = {
  name: 'Game Library',
  render: () => <MockHistoryView isRecordingActive={false} />,
};

/**
 * Game library while a recording is active.
 * Shows the orange alert banner at the top of the cards.
 */
export const RecordingActive: Story = {
  name: 'Game Library (Recording Active)',
  render: () => <MockHistoryView isRecordingActive={true} />,
};
