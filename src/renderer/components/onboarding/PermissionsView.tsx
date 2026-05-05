/**
 * PermissionsView Component
 *
 * Onboarding step 1: grant microphone, screen capture, and notification
 * permissions. Extracted from App.tsx for maintainability.
 *
 * Props:
 *   onContinue — called when all required permissions are granted
 */

import React from 'react';
import { usePermissions } from '../../hooks/usePermissions';
import { useConfigStore } from '../../stores/config.store';
import { useNotificationPermission } from '../../hooks/useNotificationPermission';
import { StepIndicators } from '../auth/AuthView';
import logoIcon from '../../../../resources/icon-mono-orange-bg.png';
import permissionsVideo from '../../../../resources/permissions.mp4';

// ─── Icons ────────────────────────────────────────────────────────────────────

function LogoIcon() {
  return <img src={logoIcon} width={50} height={50} alt="Chess Lens" className="rounded-[8px]" />;
}

function SystemAudioIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 3.33334V16.6667" stroke="var(--color-brand)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M5.83334 6.66666V13.3333" stroke="var(--color-brand)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M14.1667 6.66666V13.3333" stroke="var(--color-brand)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M1.66666 8.33334V11.6667" stroke="var(--color-brand)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M18.3333 8.33334V11.6667" stroke="var(--color-brand)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function MicrophoneIcon({ color = 'var(--color-brand)' }: { color?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 1.66666C9.11594 1.66666 8.26809 2.01785 7.643 2.643C7.0179 3.26809 6.66671 4.11594 6.66671 5V10C6.66671 10.8841 7.0179 11.7319 7.643 12.357C8.26809 12.9821 9.11594 13.3333 10 13.3333C10.8841 13.3333 11.732 12.9821 12.357 12.357C12.9822 11.7319 13.3334 10.8841 13.3334 10V5C13.3334 4.11594 12.9822 3.26809 12.357 2.643C11.732 2.01785 10.8841 1.66666 10 1.66666Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M16.6667 8.33334V10C16.6667 11.7681 15.9643 13.4638 14.714 14.714C13.4638 15.9643 11.7681 16.6667 10 16.6667C8.23189 16.6667 6.53619 15.9643 5.28595 14.714C4.03571 13.4638 3.33333 11.7681 3.33333 10V8.33334" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M10 16.6667V18.3333" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function ScreenCaptureIcon({ color = 'var(--color-text-muted)' }: { color?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M16.6667 3.33334H3.33333C2.41286 3.33334 1.66666 4.07954 1.66666 5V12.5C1.66666 13.4205 2.41286 14.1667 3.33333 14.1667H16.6667C17.5871 14.1667 18.3333 13.4205 18.3333 12.5V5C18.3333 4.07954 17.5871 3.33334 16.6667 3.33334Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6.66666 17.5H13.3333" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M10 14.1667V17.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function NotificationIcon({ color = 'var(--color-text-muted)' }: { color?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M10 2.5C7.5 2.5 5.5 4.5 5.5 7v3.5l-1.25 1.25c-.417.417-.125 1.125.458 1.125h10.584c.583 0 .875-.708.458-1.125L14.5 10.5V7c0-2.5-2-4.5-4.5-4.5z"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 15.833a1.667 1.667 0 003.333 0"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── PermissionToggle ─────────────────────────────────────────────────────────

interface PermissionToggleProps {
  enabled: boolean;
  onClick?: () => void;
}

function PermissionToggle({ enabled, onClick }: PermissionToggleProps) {
  return (
    <button
      onClick={onClick}
      className={`w-[38px] h-[22px] rounded-[22px] relative transition-colors ${
        enabled ? 'bg-brand' : 'bg-border-card'
      }`}
    >
      <div
        className={`absolute size-[18px] bg-white rounded-[9px] top-[2px] shadow-[0px_1px_3px_0px_rgba(0,0,0,0.15)] transition-all ${
          enabled ? 'left-[18px]' : 'left-[2px]'
        }`}
      />
    </button>
  );
}

// ─── PermissionRow ────────────────────────────────────────────────────────────

interface PermissionRowProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  enabled: boolean;
  onClick?: () => void;
}

function PermissionRow({ icon, title, description, enabled, onClick }: PermissionRowProps) {
  return (
    <div
      className={`flex gap-[14px] items-center px-[17px] py-[15px] rounded-[16px] border ${
        enabled ? 'bg-warm-tint border-warm-tint-border' : 'bg-white border-border-default'
      }`}
    >
      <div
        className={`size-[36px] rounded-[10px] flex items-center justify-center border ${
          enabled
            ? 'bg-[var(--color-brand-tint-bg-lg)] border-[var(--color-brand-tint-border)]'
            : 'bg-white border-border-subtle'
        }`}
      >
        {icon}
      </div>
      <div className="flex-1 flex flex-col gap-[3px]">
        <p className="text-md font-medium text-text-heading">{title}</p>
        <p className="text-sm font-normal text-text-muted-brand">{description}</p>
      </div>
      <PermissionToggle enabled={enabled} onClick={onClick} />
    </div>
  );
}

// ─── PermissionsView ──────────────────────────────────────────────────────────

export interface PermissionsViewProps {
  onContinue: () => void;
}

export function PermissionsView({ onContinue }: PermissionsViewProps) {
  const { status, requestMicPermission, openSettings, checkPermissions } = usePermissions();
  const configStore = useConfigStore();
  const { enabled: notificationsEnabled, openSettings: openNotificationSettings } =
    useNotificationPermission();

  const allGranted = status.microphone && status.screen;

  const handleContinue = () => {
    if (allGranted) onContinue();
  };

  // Check screen permission periodically until granted
  React.useEffect(() => {
    if (!status.screen) {
      const interval = setInterval(() => {
        checkPermissions();
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [status.screen, checkPermissions]);

  return (
    <div className="h-full w-full bg-white flex flex-col relative overflow-hidden">
      {/* Brand gradient glow */}
      <div
        className="absolute top-[-22.76%] left-1/2 -translate-x-1/2 w-[600px] h-[566px] rounded-[300px] pointer-events-none brand-glow-bg"
      />

      {/* Step indicators */}
      <div className="absolute top-[32px] left-1/2 -translate-x-1/2">
        <StepIndicators currentStep={1} totalSteps={4} />
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center gap-[60px] p-[60px]">
        {/* Left side - Permissions */}
        <div className="flex flex-col gap-[32px] w-[548px] relative z-10">
          {/* Logo and heading */}
          <div className="flex flex-col gap-[20px]">
            <LogoIcon />
            <div className="flex flex-col">
              <h1 className="text-xl font-semibold text-black">Before we start,</h1>
              <h1 className="text-xl font-semibold text-black">grant a few permissions</h1>
            </div>
          </div>

          {/* Permission rows */}
          <div className="flex flex-col gap-[10px] w-full">
            <PermissionRow
              icon={<SystemAudioIcon />}
              title="System audio"
              description="Capture audio from chess apps and streaming tools."
              enabled={status.screen}
              onClick={() => !status.screen && openSettings('audio')}
            />
            <PermissionRow
              icon={<MicrophoneIcon color={status.microphone ? 'var(--color-brand)' : 'var(--color-text-muted)'} />}
              title="Microphone"
              description="Record your voice during games and coaching sessions."
              enabled={status.microphone}
              onClick={() => !status.microphone && requestMicPermission()}
            />
            <PermissionRow
              icon={<ScreenCaptureIcon color={status.screen ? 'var(--color-brand)' : 'var(--color-text-muted)'} />}
              title="Screen capture"
              description="Record your screen to capture shared content and visual context."
              enabled={status.screen}
              onClick={() => !status.screen && openSettings('screen')}
            />
            {/* App notifications */}
            <PermissionRow
              icon={<NotificationIcon color={notificationsEnabled ? 'var(--color-brand)' : 'var(--color-text-muted)'} />}
              title="App notifications"
              description="Get alerts before your games start."
              enabled={notificationsEnabled}
              onClick={() => openNotificationSettings()}
            />
          </div>

          {/* Continue button */}
          <div className="flex flex-col gap-[10px] w-full">
            <button
              onClick={handleContinue}
              disabled={!allGranted}
              className="w-full bg-brand-cta hover:bg-brand-cta-hover disabled:bg-brand-disabled disabled:cursor-not-allowed rounded-[12px] px-[24px] py-[12px] text-md font-semibold text-white text-center transition-colors"
            >
              Continue
            </button>
          </div>
        </div>

        {/* Right side - Permissions video */}
        <div className="flex-1 h-full min-h-[400px] bg-surface-muted rounded-[16px] overflow-hidden flex items-center justify-center">
          <video
            src={permissionsVideo}
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-full object-cover rounded-[16px]"
          />
        </div>
      </div>
    </div>
  );
}

export default PermissionsView;
