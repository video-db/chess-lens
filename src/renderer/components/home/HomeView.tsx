/**
 * HomeView Component
 *
 * New home page design with:
 * - App permissions section with toggles
 * - Start Recording button
 * - Recent games
 * - Today's calendar events
 * - Connected MCP servers
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { trpc } from '../../api/trpc';
import { useSessionStore } from '../../stores/session.store';
import { useNotificationPermission } from '../../hooks/useNotificationPermission';
import { RecordingCard } from '../history/RecordingCard';
import { RecordingDetailPage } from '../history/RecordingDetailPage';
import type { UpcomingMeeting } from '../../../shared/types/calendar.types';
import type { MCPServerConfig } from '../../../preload/index';

// Hook for auto-hiding scrollbar
function useAutoHideScrollbar(timeout = 1500) {
  const [isScrolling, setIsScrolling] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleScroll = useCallback(() => {
    setIsScrolling(true);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      setIsScrolling(false);
    }, timeout);
  }, [timeout]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return { isScrolling, handleScroll };
}

// Scrollbar styles
const scrollbarBaseStyles = `
  [&::-webkit-scrollbar]:w-[6px]
  [&::-webkit-scrollbar-track]:bg-transparent
  [&::-webkit-scrollbar-thumb]:rounded-full
  [&::-webkit-scrollbar-thumb]:transition-colors
  [&::-webkit-scrollbar-thumb]:duration-300
`;
const scrollbarVisibleStyles = '[&::-webkit-scrollbar-thumb]:bg-scrollbar-thumb';

// scrollbar-thumb color is defined in tailwind config via --color-scrollbar-thumb
// We keep the hardcoded fallback for the hidden state
const scrollbarHiddenStyles = '[&::-webkit-scrollbar-thumb]:bg-transparent';

// Icons
function SpeakerIcon({ enabled }: { enabled: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M10 3.333L5.833 6.667H2.5v6.666h3.333L10 16.667V3.333z"
        stroke={enabled ? 'var(--color-brand)' : 'var(--color-text-body)'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={enabled ? 'var(--color-brand-tint-bg-2xl)' : 'none'}
      />
      <path
        d="M14.167 7.5a4.167 4.167 0 010 5M16.667 5a7.5 7.5 0 010 10"
        stroke={enabled ? 'var(--color-brand)' : 'var(--color-text-body)'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MicIcon({ enabled }: { enabled: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="7.5"
        y="2.5"
        width="5"
        height="10"
        rx="2.5"
        stroke={enabled ? 'var(--color-brand)' : 'var(--color-text-body)'}
        strokeWidth="1.5"
        fill={enabled ? 'var(--color-brand-tint-bg-2xl)' : 'none'}
      />
      <path
        d="M15 8.333v1.667a5 5 0 01-10 0V8.333M10 15v2.5M7.5 17.5h5"
        stroke={enabled ? 'var(--color-brand)' : 'var(--color-text-body)'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ScreenIcon({ enabled }: { enabled: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="2.5"
        y="3.333"
        width="15"
        height="10"
        rx="1.5"
        stroke={enabled ? 'var(--color-brand)' : 'var(--color-text-body)'}
        strokeWidth="1.5"
        fill={enabled ? 'var(--color-brand-tint-bg-2xl)' : 'none'}
      />
      <path
        d="M6.667 16.667h6.666"
        stroke={enabled ? 'var(--color-brand)' : 'var(--color-text-body)'}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M10 13.333v3.334"
        stroke={enabled ? 'var(--color-brand)' : 'var(--color-text-body)'}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function NotificationIcon({ enabled }: { enabled: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M10 2.5C7.5 2.5 5.5 4.5 5.5 7v3.5l-1.25 1.25c-.417.417-.125 1.125.458 1.125h10.584c.583 0 .875-.708.458-1.125L14.5 10.5V7c0-2.5-2-4.5-4.5-4.5z"
        stroke={enabled ? 'var(--color-brand)' : 'var(--color-text-body)'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={enabled ? 'var(--color-brand-tint-bg-2xl)' : 'none'}
      />
      <path
        d="M8.5 15.833a1.667 1.667 0 003.333 0"
        stroke={enabled ? 'var(--color-brand)' : 'var(--color-text-body)'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2.5" y="4.167" width="15" height="13.333" rx="2" stroke="var(--color-text-heading)" strokeWidth="1.5" />
      <path d="M2.5 8.333h15" stroke="var(--color-text-heading)" strokeWidth="1.5" />
      <path d="M6.667 2.5v3.333M13.333 2.5v3.333" stroke="var(--color-text-heading)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="6" stroke="#969696" strokeWidth="1.25" />
      <path d="M8 4.5v4l2.5 1.5" stroke="#969696" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MCPIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="3" stroke="black" strokeWidth="1.25" />
      <path d="M8 2v2M8 12v2M2 8h2M12 8h2" stroke="black" strokeWidth="1.25" strokeLinecap="round" />
      <path d="M3.76 3.76l1.41 1.41M10.83 10.83l1.41 1.41M3.76 12.24l1.41-1.41M10.83 5.17l1.41-1.41" stroke="black" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

function RecordingIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="10" r="4" fill="white" />
      <circle cx="10" cy="10" r="7" stroke="white" strokeWidth="1.5" />
    </svg>
  );
}

function EmptyRecordingsIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="6" width="24" height="20" rx="2" stroke="#969696" strokeWidth="1.5" />
      <path d="M4 12h24" stroke="#969696" strokeWidth="1.5" />
      <rect x="8" y="16" width="6" height="6" rx="1" stroke="#969696" strokeWidth="1.5" />
      <path d="M18 17h6M18 21h4" stroke="#969696" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function EmptyCalendarIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="6.5" width="24" height="21" rx="2" stroke="#969696" strokeWidth="1.5" />
      <path d="M4 12.5h24" stroke="#969696" strokeWidth="1.5" />
      <path d="M10 3.5v5M22 3.5v5" stroke="#969696" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function EmptyMCPIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="5" stroke="#969696" strokeWidth="1.5" />
      <path d="M16 4v4M16 24v4M4 16h4M24 16h4" stroke="#969696" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7.5 7.5l2.83 2.83M21.67 21.67l2.83 2.83M7.5 24.5l2.83-2.83M21.67 10.33l2.83-2.83" stroke="#969696" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function WorkflowIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 7h4v6H3V7zM13 7h4v6h-4V7z" stroke="black" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 10h2M11 10h2" stroke="black" strokeWidth="1.25" strokeLinecap="round" />
      <circle cx="10" cy="10" r="1.5" stroke="black" strokeWidth="1.25" />
    </svg>
  );
}

function EmptyWorkflowIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5 11h6v10H5V11zM21 11h6v10h-6V11z" stroke="#969696" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 16h3M18 16h3" stroke="#969696" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="16" cy="16" r="2.5" stroke="#969696" strokeWidth="1.5" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M15.68 8.182c0-.567-.05-1.113-.145-1.636H8v3.094h4.305a3.68 3.68 0 01-1.597 2.415v2.007h2.585c1.513-1.393 2.387-3.444 2.387-5.88z" fill="#4285F4" />
      <path d="M8 16c2.16 0 3.97-.716 5.293-1.938l-2.585-2.007c-.716.48-1.632.763-2.708.763-2.083 0-3.848-1.407-4.479-3.297H.855v2.073A7.997 7.997 0 008 16z" fill="#34A853" />
      <path d="M3.521 9.521A4.813 4.813 0 013.27 8c0-.528.091-1.04.252-1.521V4.406H.855A7.997 7.997 0 000 8c0 1.29.309 2.512.855 3.594l2.666-2.073z" fill="#FBBC05" />
      <path d="M8 3.182c1.174 0 2.229.404 3.058.1197l2.292-2.292C11.967.794 10.157 0 8 0 4.872 0 2.167 1.793.855 4.406l2.666 2.073C4.152 4.589 5.917 3.182 8 3.182z" fill="#EA4335" />
    </svg>
  );
}

// Confirmation Dialog Component
function ConfirmationDialog({
  isOpen,
  title,
  message,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  variant = 'danger',
}: {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'danger' | 'default';
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onCancel}
      />
      {/* Dialog */}
      <div className="relative bg-white rounded-[16px] p-[24px] w-[400px] shadow-[0px_4px_24px_0px_rgba(0,0,0,0.15)] flex flex-col gap-[20px]">
        <div className="flex flex-col gap-[8px]">
          <h3 className="text-lg font-semibold text-text-heading">{title}</h3>
          <p className="text-base text-text-body leading-[20px]">{message}</p>
        </div>
        <div className="flex gap-[12px] justify-end">
          <button
            onClick={onCancel}
            className="px-[16px] py-[10px] rounded-[10px] border border-border-card text-base font-medium text-text-body hover:bg-surface-muted transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`px-[16px] py-[10px] rounded-[10px] text-base font-medium text-white transition-colors ${
              variant === 'danger'
                ? 'bg-status-error hover:bg-danger-hover'
                : 'bg-brand hover:bg-brand-hover'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

// Toggle Component
function Toggle({
  enabled,
  onChange,
  size = 'default',
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  size?: 'default' | 'small';
}) {
  const width = size === 'small' ? 'w-[32px]' : 'w-[38px]';
  const height = size === 'small' ? 'h-[18px]' : 'h-[22px]';
  const knobSize = size === 'small' ? 'size-[14px]' : 'size-[18px]';
  const knobOffset = size === 'small' ? (enabled ? 'left-[16px]' : 'left-[2px]') : (enabled ? 'left-[18px]' : 'left-[2px]');

  return (
    <button
      onClick={() => onChange(!enabled)}
      className={`${width} ${height} rounded-full relative transition-colors ${
        enabled ? 'bg-brand' : 'bg-border-card'
      }`}
    >
      <div
        className={`absolute ${knobSize} bg-white rounded-full top-[2px] shadow-[0px_1px_3px_0px_rgba(0,0,0,0.15)] transition-all ${knobOffset}`}
      />
    </button>
  );
}

// Permission Item Component
function PermissionItem({
  icon,
  title,
  description,
  enabled,
  onChange,
  isFirst,
  isLast,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  const bgColor = 'bg-white';
  const borderRadius = isFirst
    ? 'rounded-t-[10px]'
    : isLast
    ? 'rounded-b-[10px]'
    : '';

  return (
    <div className={`flex items-center gap-[14px] px-[16px] py-[13px] ${bgColor} ${borderRadius}`}>
      <div
        className={`w-[36px] h-[36px] rounded-[10px] flex items-center justify-center ${
          enabled
            ? 'bg-[var(--color-brand-tint-bg-lg)] border border-[var(--color-brand-tint-border)]'
            : 'bg-white border border-border-subtle'
        }`}
      >
        {icon}
      </div>
      <div className="flex-1">
        <p className="text-base font-medium text-text-heading">{title}</p>
        <p className="text-sm text-[rgba(70,70,70,0.6)]">{description}</p>
      </div>
      <Toggle enabled={enabled} onChange={onChange} />
    </div>
  );
}

// Calendar Event Item Component
function CalendarEventItem({
  event,
  notifyEnabled,
  onToggleNotify,
}: {
  event: UpcomingMeeting;
  notifyEnabled: boolean;
  onToggleNotify: (enabled: boolean) => void;
}) {
  const formatTime = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
  };

  return (
    <div className="bg-white border border-border-subtle rounded-[10px] px-[15px] py-[13px]">
      <div className="flex items-start">
        <div className="flex-1 flex flex-col gap-[10px]">
          <p className="text-base font-medium text-black tracking-[0.07px] line-clamp-1">
            {event.summary}
          </p>
          <div className="flex items-center gap-[12px]">
            <div className="flex items-center gap-[4px] flex-1">
              <ClockIcon />
              <span className="text-base text-text-body tracking-[0.07px]">
                {formatTime(event.startTime)} - {formatTime(event.endTime)}
              </span>
            </div>
            <Toggle enabled={notifyEnabled} onChange={onToggleNotify} size="small" />
          </div>
        </div>
      </div>
    </div>
  );
}

// MCP Server Item Component
function MCPServerItem({
  server,
  onRemove,
}: {
  server: MCPServerConfig;
  onRemove: () => void;
}) {
  return (
    <div className="bg-white border border-border-subtle rounded-[10px] px-[15px] py-[13px]">
      <div className="flex items-center gap-[12px]">
        <div className="w-[20px] h-[20px] flex items-center justify-center">
          <MCPIcon />
        </div>
        <div className="flex-1 flex flex-col gap-[6px]">
          <p className="text-base font-medium text-black tracking-[0.07px]">{server.name}</p>
          <p className="text-sm text-text-body tracking-[0.065px]">
            {server.description || 'Sync game notes & summaries'}
          </p>
        </div>
        <button
          onClick={onRemove}
          className="w-[24px] h-[24px] flex items-center justify-center hover:bg-surface-muted rounded-[6px] transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 4l8 8M12 4l-8 8" stroke="var(--color-text-muted)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// Workflow Item Component
function WorkflowItem({
  workflow,
  onEdit,
}: {
  workflow: { id: string; name: string; enabled: boolean };
  onEdit: () => void;
}) {
  return (
    <div className="bg-white border border-border-subtle rounded-[10px] px-[15px] py-[13px]">
      <div className="flex items-center gap-[6px]">
        <p className="flex-1 text-base font-medium text-black tracking-[0.07px]">{workflow.name}</p>
        <button
          onClick={onEdit}
          className="w-[20px] h-[20px] flex items-center justify-center hover:opacity-70 transition-opacity"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M14.167 2.5L17.5 5.833M2.5 17.5L3.333 14.167L14.167 3.333L16.667 5.833L5.833 16.667L2.5 17.5Z" stroke="var(--color-text-muted)" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

interface HomeViewProps {
  onStartRecording: () => void;
  onNavigateToHistory: () => void;
}

interface WorkflowData {
  id: string;
  name: string;
  webhookUrl: string;
  enabled: boolean;
}

export function HomeView({ onStartRecording, onNavigateToHistory }: HomeViewProps) {
  const [selectedRecordingId, setSelectedRecordingId] = useState<number | null>(null);
  const { enabled: notificationsEnabled, openSettings: openNotificationSettings } =
    useNotificationPermission();

  // Auto-hide scrollbars
  const leftScrollbar = useAutoHideScrollbar();

  // Session state for stream toggles
  const sessionStore = useSessionStore();
  const { streams, setStreams } = sessionStore;

  // Fetch recordings
  const { data: recordings, isLoading: recordingsLoading } = trpc.recordings.list.useQuery(undefined, {
    refetchInterval: 10000,
  });

  // Get recent recordings (latest 2)
  const recentRecordings = useMemo(() => {
    if (!recordings) return [];
    return [...recordings]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 2);
  }, [recordings]);

  const handleToggleNotifications = async () => {
    await openNotificationSettings();
  };

  // If viewing a recording detail
  if (selectedRecordingId !== null) {
    return (
      <RecordingDetailPage
        recordingId={selectedRecordingId}
        onBack={() => setSelectedRecordingId(null)}
      />
    );
  }

  return (
    <div className="h-full p-[24px] bg-white overflow-hidden">
      <div
        className={`h-full flex flex-col gap-[40px] overflow-y-auto ${scrollbarBaseStyles} ${leftScrollbar.isScrolling ? scrollbarVisibleStyles : scrollbarHiddenStyles}`}
        onScroll={leftScrollbar.handleScroll}
      >
        <div className="flex flex-col gap-[30px] w-full">
          {/* Dashboard Header with Start Recording button */}
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-semibold text-black tracking-tight">
              Dashboard
            </h1>
            <button
              onClick={onStartRecording}
              disabled={!streams.systemAudio && !streams.microphone}
              className="flex items-center gap-[4px] bg-brand-cta hover:bg-brand-cta-hover disabled:opacity-50 disabled:cursor-not-allowed px-[20px] py-[12px] rounded-[12px] shadow-[0px_1.272px_15.267px_0px_rgba(0,0,0,0.05)] transition-colors"
            >
              <RecordingIcon />
              <span className="text-base font-semibold text-white tracking-[-0.28px]">
                Start Recording
              </span>
            </button>
          </div>

          {/* App Permissions Section */}
          <div className="bg-surface-muted border border-border-default rounded-[12px] p-[16px] flex flex-col gap-[20px]">
            <h2 className="text-lg font-semibold text-text-heading">
              App permissions
            </h2>

            {/* Permission Toggles */}
            <div className="flex flex-col rounded-[12px] overflow-hidden border border-border-default">
              <PermissionItem
                icon={<SpeakerIcon enabled={streams.systemAudio} />}
                title="System audio"
                description="Capture game and browser audio"
                enabled={streams.systemAudio}
                onChange={(enabled) => setStreams({ systemAudio: enabled })}
                isFirst
              />
              <div className="h-[1px] bg-border-subtle" />
              <PermissionItem
                icon={<MicIcon enabled={streams.microphone} />}
                title="Microphone"
                description="Record your voice during gameplay"
                enabled={streams.microphone}
                onChange={(enabled) => setStreams({ microphone: enabled })}
              />
              <div className="h-[1px] bg-border-subtle" />
              <PermissionItem
                icon={<ScreenIcon enabled={streams.screen} />}
                title="Screen capture"
                description="Record your screen to capture visual context"
                enabled={streams.screen}
                onChange={(enabled) => setStreams({ screen: enabled })}
              />
              <div className="h-[1px] bg-border-subtle" />
              <PermissionItem
                icon={<NotificationIcon enabled={notificationsEnabled} />}
                title="App notifications"
                description="Allow Chess Lens to send notifications and reminders"
                enabled={notificationsEnabled}
                onChange={handleToggleNotifications}
                isLast
              />
            </div>
          </div>
        </div>

        {/* Recent Sessions Section */}
        <div className="flex flex-col gap-[14px]">
          {/* Header */}
          <div className="flex items-center justify-between w-full">
            <h2 className="text-lg font-semibold text-text-heading">
              Recent sessions
            </h2>
          </div>

          {/* Content */}
          {recordingsLoading ? (
            <div className="flex items-center justify-center py-[40px] bg-surface-muted border border-border-default rounded-[16px] w-full">
              <Loader2 className="w-6 h-6 animate-spin text-text-muted-brand" />
            </div>
          ) : recentRecordings.length === 0 ? (
            <div className="flex items-center justify-center py-[40px] bg-surface-muted border border-border-default rounded-[16px] w-full">
              <div className="flex flex-col items-center gap-[10px] px-[8px] py-[14px]">
                <EmptyRecordingsIcon />
                <p className="text-base text-text-heading">No games recorded yet</p>
                <p className="text-sm-label text-text-muted-brand text-center max-w-[264px]">
                  Your recorded sessions will appear here with AI summaries, transcripts, and action items.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-[20px] w-full">
                {recentRecordings.map((recording) => (
                  <RecordingCard
                    key={recording.id}
                    recording={recording}
                    onClick={() => setSelectedRecordingId(recording.id)}
                  />
                ))}
              </div>
              <button
                onClick={onNavigateToHistory}
                className="flex items-center justify-center gap-[4px] bg-white border border-border-default px-[20px] py-[12px] rounded-[12px] hover:bg-gray-50 transition-colors"
              >
                <span className="text-[14px] font-semibold text-black tracking-[-0.28px]">
                  View all
                </span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default HomeView;
