/**
 * Settings View Component
 *
 * Main settings page with tabs for Account and Notifications.
 * Redesigned based on Figma specs.
 */

import React, { useState } from 'react';
import {
  Eye,
  EyeOff,
  Copy,
  Pencil,
  LogOut,
  Check,
  Loader2,
} from 'lucide-react';
import { useConfigStore } from '../../stores/config.store';
import { NotificationsPanel } from './NotificationsPanel';

type SettingsTab = 'account' | 'notifications';

interface SettingsViewProps {
  initialTab?: SettingsTab | null;
}

// Tab navigation component
function SettingsTabs({
  activeTab,
  onTabChange,
}: {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}) {
  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'account', label: 'Account' },
    { id: 'notifications', label: 'Notifications' },
  ];

  return (
    <div className="bg-[#f7f7f7] flex gap-[10px] p-[4px] rounded-[14px] w-full">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`flex-1 px-[16px] py-[12px] rounded-[12px] text-[14px] font-medium transition-all ${
            activeTab === tab.id
              ? 'bg-[#ff4000] text-white font-semibold shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]'
              : 'text-[#464646] hover:bg-[#efefef]'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// Settings Card wrapper
function SettingsCard({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-white border border-[#e4e4ec] rounded-[14px] overflow-hidden ${className}`}
    >
      {children}
    </div>
  );
}

// Card header
function CardHeader({ title }: { title: string }) {
  return (
    <div className="px-[20px] py-[16px] border-b border-[#ededf3]">
      <h3 className="text-[16px] font-semibold text-[#141420] leading-[22.5px]">
        {title}
      </h3>
    </div>
  );
}

// Card row
function CardRow({
  label,
  children,
  hasBorder = true,
}: {
  label: string;
  children: React.ReactNode;
  hasBorder?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between px-[20px] py-[14px] ${
        hasBorder ? 'border-b border-[#ededf3]' : ''
      }`}
    >
      <span className="text-[14px] font-medium text-[#464646]">{label}</span>
      <div className="flex items-center gap-[8px]">{children}</div>
    </div>
  );
}

// Logout icon SVG
function LogoutIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7.5 17.5H4.16667C3.72464 17.5 3.30072 17.3244 2.98816 17.0118C2.67559 16.6993 2.5 16.2754 2.5 15.8333V4.16667C2.5 3.72464 2.67559 3.30072 2.98816 2.98816C3.30072 2.67559 3.72464 2.5 4.16667 2.5H7.5" stroke="#d1242f" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M13.333 14.1667L17.4997 10L13.333 5.83337" stroke="#d1242f" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M17.5 10H7.5" stroke="#d1242f" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// Account Panel Component
function AccountPanel() {
  const configStore = useConfigStore();
  const [showApiKey, setShowApiKey] = useState(false);
  const [isEditingApiKey, setIsEditingApiKey] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const maskApiKey = (key: string) => {
    if (!key) return '';
    if (key.length <= 8) return key;
    return `${key.slice(0, 8)} •••••••`;
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

  const handleCancelEdit = () => {
    setIsEditingApiKey(false);
    setNewApiKey('');
  };

  const handleLogout = () => {
    configStore.clearAuth();
  };

  return (
    <div className="flex flex-col gap-[20px]">
      {/* Account Card */}
      <SettingsCard>
        <CardHeader title="Account" />

        {/* Name Row */}
        <CardRow label="Name">
          <span className="text-[14px] font-medium text-black">
            {configStore.userName || 'Not set'}
          </span>
        </CardRow>

        {/* API Key Row */}
        <CardRow label="API Key" hasBorder={false}>
          {isEditingApiKey ? (
            <>
              <input
                type="text"
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                placeholder="Paste new API key"
                className="w-[200px] px-[12px] py-[6px] bg-[#f7f7f7] border border-[#e9e9e9] rounded-[8px] text-[13px] text-[#141420] placeholder:text-[#969696] outline-none focus:border-[#ec5b16]"
              />
              <button
                onClick={handleSaveApiKey}
                disabled={isSaving || !newApiKey.trim()}
                className="px-[10px] py-[6px] bg-[#ff4000] hover:bg-[#e63900] disabled:opacity-50 rounded-[8px] text-[13px] font-medium text-white transition-colors"
              >
                {isSaving ? <Loader2 className="w-[14px] h-[14px] animate-spin" /> : 'Save'}
              </button>
              <button
                onClick={handleCancelEdit}
                className="px-[10px] py-[6px] bg-[#f0f0f5] border border-[#efefef] rounded-[8px] text-[13px] font-medium text-[#464646] hover:bg-[#e8e8ed] transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <span className="text-[14px] font-medium text-black font-mono">
                {showApiKey
                  ? configStore.apiKey || 'Not set'
                  : maskApiKey(configStore.apiKey || '')}
              </span>
              <button
                onClick={() => setShowApiKey(!showApiKey)}
                className="p-[6px] bg-[#f0f0f5] border border-[#efefef] rounded-[8px] hover:bg-[#e8e8ed] transition-colors"
                title={showApiKey ? 'Hide API key' : 'Show API key'}
              >
                {showApiKey ? (
                  <EyeOff className="w-[16px] h-[16px] text-[#464646]" />
                ) : (
                  <Eye className="w-[16px] h-[16px] text-[#464646]" />
                )}
              </button>
              <button
                onClick={handleCopyApiKey}
                className="p-[6px] bg-[#f0f0f5] border border-[#efefef] rounded-[8px] hover:bg-[#e8e8ed] transition-colors"
                title={copySuccess ? 'Copied!' : 'Copy API key'}
              >
                {copySuccess ? (
                  <Check className="w-[16px] h-[16px] text-[#059669]" />
                ) : (
                  <Copy className="w-[16px] h-[16px] text-[#464646]" />
                )}
              </button>
              <button
                onClick={() => setIsEditingApiKey(true)}
                className="flex items-center gap-[4px] px-[10px] py-[6px] bg-[#f0f0f5] border border-[#efefef] rounded-[8px] hover:bg-[#e8e8ed] transition-colors"
              >
                <Pencil className="w-[16px] h-[16px] text-[#ff4000]" />
                <span className="text-[13px] font-medium text-[#ff4000]">Change</span>
              </button>
            </>
          )}
        </CardRow>
      </SettingsCard>

      {/* Log out Button */}
      <button
        onClick={handleLogout}
        className="flex items-center justify-center gap-[8px] w-full px-[17px] py-[11px] bg-[rgba(209,36,47,0.06)] border border-[rgba(209,36,47,0.19)] rounded-[10px] hover:bg-[rgba(209,36,47,0.1)] transition-colors"
      >
        <LogoutIcon />
        <span className="text-[14px] font-semibold text-[#d1242f]">Log out</span>
      </button>
    </div>
  );
}

export function SettingsView({ initialTab }: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab || 'account');

  const renderTabContent = () => {
    switch (activeTab) {
      case 'account':
        return <AccountPanel />;
      case 'notifications':
        return <NotificationsPanel />;
      default:
        return null;
    }
  };

  return (
    <div className="h-full overflow-auto bg-white">
      <div className="flex items-start justify-center pt-[40px] pb-[24px] px-[60px]">
        <div className="flex-1 max-w-[660px] flex flex-col gap-[30px]">
          {/* Title */}
          <h1 className="text-[24px] font-semibold text-[#141420] tracking-[-0.17px]">
            Settings
          </h1>

          {/* Content */}
          <div className="flex flex-col gap-[24px]">
            {/* Tab Navigation */}
            <SettingsTabs activeTab={activeTab} onTabChange={setActiveTab} />

            {/* Tab Content */}
            {renderTabContent()}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsView;
