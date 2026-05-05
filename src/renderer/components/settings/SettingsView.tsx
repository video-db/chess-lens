/**
 * Settings View Component
 *
 * Account settings — matches Figma design exactly (no tabs).
 */

import React, { useState } from 'react';
import {
  Eye,
  EyeOff,
  Copy,
  Pencil,
  Check,
  Loader2,
} from 'lucide-react';
import { useConfigStore } from '../../stores/config.store';

// ── Icon-only action button — 28×28, matches Figma spec ───────────────────────
function IconBtn({
  onClick,
  title,
  children,
}: {
  onClick?: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-[28px] h-[28px] flex items-center justify-center bg-[#F3F3F3] border border-border-default rounded-[8px] hover:bg-surface-muted transition-colors flex-shrink-0"
    >
      {children}
    </button>
  );
}

// ── Settings card ─────────────────────────────────────────────────────────────
function SettingsCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white border border-settings-card rounded-[14px] overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

// ── Card section header ───────────────────────────────────────────────────────
function CardHeader({ title }: { title: string }) {
  return (
    <div className="px-[20px] py-[16px] border-b border-border-subtle">
      <h3 className="text-[16px] font-semibold text-settings-heading">{title}</h3>
    </div>
  );
}

// ── Card row ──────────────────────────────────────────────────────────────────
function CardRow({ label, children, hasBorder = true }: { label: string; children: React.ReactNode; hasBorder?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-[20px] py-[14px] ${hasBorder ? 'border-b border-border-subtle' : ''}`}>
      <span className="text-[14px] font-medium text-text-body">{label}</span>
      <div className="flex items-center gap-[8px]">{children}</div>
    </div>
  );
}

// ── Logout icon ───────────────────────────────────────────────────────────────
function LogoutIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7.5 17.5H4.167A1.667 1.667 0 012.5 15.833V4.167A1.667 1.667 0 014.167 2.5H7.5" stroke="var(--color-status-danger)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M13.333 14.167L17.5 10l-4.167-4.167" stroke="var(--color-status-danger)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M17.5 10H7.5" stroke="var(--color-status-danger)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ── Account panel ─────────────────────────────────────────────────────────────
function AccountPanel() {
  const configStore = useConfigStore();
  const [showApiKey, setShowApiKey] = useState(false);
  const [isEditingApiKey, setIsEditingApiKey] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const maskApiKey = (key: string) => {
    if (!key) return 'Not set';
    if (key.length <= 8) return key;
    return `${key.slice(0, 6)} •••••••`;
  };

  const handleCopyApiKey = async () => {
    if (configStore.apiKey) {
      await navigator.clipboard.writeText(configStore.apiKey);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  const handleSaveApiKey = async () => {
    if (!newApiKey.trim()) return;
    setIsSaving(true);
    try {
      configStore.setConfig({ apiKey: newApiKey.trim() });
      setIsEditingApiKey(false);
      setNewApiKey('');
    } catch (err) {
      console.error('Failed to save API key:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = () => configStore.clearAuth();

  return (
    <div className="flex flex-col gap-[20px]">
      <SettingsCard>
        <CardHeader title="Account" />

        {/* Name row */}
        <CardRow label="Name">
          <span className="text-[14px] font-medium text-black">{configStore.userName || 'Not set'}</span>
          <IconBtn title="Edit name">
            <Pencil className="w-[14px] h-[14px] text-text-body" />
          </IconBtn>
        </CardRow>

        {/* API Key row */}
        <CardRow label="API Key" hasBorder={false}>
          {isEditingApiKey ? (
            <>
              <input
                type="text"
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                placeholder="Paste new API key"
                className="w-[200px] px-[12px] py-[6px] bg-surface-muted border border-border-default rounded-[8px] text-sm text-text-heading placeholder:text-text-muted-brand outline-none focus:border-brand font-jb-mono"
                autoFocus
              />
              <button
                onClick={handleSaveApiKey}
                disabled={isSaving || !newApiKey.trim()}
                className="w-[28px] h-[28px] flex items-center justify-center bg-brand-cta hover:bg-brand-cta-hover disabled:opacity-50 rounded-[8px] text-white transition-colors"
                title="Save"
              >
                {isSaving ? <Loader2 className="w-[14px] h-[14px] animate-spin" /> : <Check className="w-[14px] h-[14px]" />}
              </button>
              <IconBtn onClick={() => { setIsEditingApiKey(false); setNewApiKey(''); }} title="Cancel">
                <span className="text-[11px] font-medium text-text-body">✕</span>
              </IconBtn>
            </>
          ) : (
            <>
              <span className="text-[14px] font-medium text-black font-jb-mono">
                {showApiKey ? (configStore.apiKey || 'Not set') : maskApiKey(configStore.apiKey || '')}
              </span>
              {/* Show/hide */}
              <IconBtn onClick={() => setShowApiKey(!showApiKey)} title={showApiKey ? 'Hide' : 'Show'}>
                {showApiKey
                  ? <EyeOff className="w-[14px] h-[14px] text-text-body" />
                  : <Eye className="w-[14px] h-[14px] text-text-body" />}
              </IconBtn>
              {/* Copy */}
              <IconBtn onClick={handleCopyApiKey} title={copySuccess ? 'Copied!' : 'Copy'}>
                {copySuccess
                  ? <Check className="w-[14px] h-[14px] text-[#059669]" />
                  : <Copy className="w-[14px] h-[14px] text-text-body" />}
              </IconBtn>
              {/* Change — icon-only per Figma */}
              <IconBtn onClick={() => setIsEditingApiKey(true)} title="Change API key">
                <Pencil className="w-[14px] h-[14px] text-text-body" />
              </IconBtn>
            </>
          )}
        </CardRow>
      </SettingsCard>

      {/* Log out */}
      <button
        onClick={handleLogout}
        className="flex items-center justify-center gap-[8px] w-full px-[16px] py-[10px] bg-[var(--color-status-danger-bg)] border border-[var(--color-status-danger-border)] rounded-[10px] hover:bg-[var(--color-status-danger-bg-hover)] transition-colors"
      >
        <LogoutIcon />
        <span className="text-[14px] font-semibold text-danger">Log out</span>
      </button>
    </div>
  );
}

// ── Settings View ─────────────────────────────────────────────────────────────
export function SettingsView() {
  return (
    <div className="h-full overflow-auto bg-surface-muted">
      <div className="flex items-start justify-center pt-[40px] pb-[24px] px-[350px]">
        <div className="flex-1 max-w-[660px] flex flex-col gap-[24px]">
          <h1 className="text-[24px] font-semibold text-settings-heading tracking-[-0.17px]">
            Settings
          </h1>
          <AccountPanel />
        </div>
      </div>
    </div>
  );
}

export default SettingsView;
