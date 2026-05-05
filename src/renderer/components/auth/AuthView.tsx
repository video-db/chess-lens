/**
 * AuthView Component
 *
 * Welcome screen for initial setup matching the Figma design.
 * Full-screen centered layout with step indicators.
 */

import React, { useState } from 'react';
import { Loader2, ChevronRight } from 'lucide-react';
import { useConfigStore } from '../../stores/config.store';
import { trpc } from '../../api/trpc';
import { getElectronAPI } from '../../api/ipc';
import logoOrangeIcon from '../../../../resources/icon-mono-orange-bg.png';

function LogoIcon() {
  return <img src={logoOrangeIcon} width={50} height={50} alt="Chess Lens" className="rounded-[8px]" />;
}

// Step indicators component - exported for use in other setup views
export function StepIndicators({ currentStep, totalSteps = 3 }: { currentStep: number; totalSteps?: number }) {
  return (
    <div className="flex gap-[6px] items-center justify-center">
      {Array.from({ length: totalSteps }).map((_, step) => {
        let className = 'rounded-[3px] ';
        if (step === currentStep) {
          // Current step - active (wide brand bar)
          className += 'w-[24px] h-[6px] bg-brand';
        } else if (step < currentStep) {
          // Completed step - dimmed brand dot
          className += 'w-[6px] h-[6px] bg-brand/40';
        } else {
          // Future step - gray dot
          className += 'w-[6px] h-[6px] bg-[var(--color-step-indicator-future)]';
        }
        return <div key={step} className={className} />;
      })}
    </div>
  );
}

export function AuthView() {
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  const configStore = useConfigStore();
  const registerMutation = trpc.auth.register.useMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !apiKey.trim()) {
      setError('Please enter your name and API key');
      return;
    }

    try {
      const result = await registerMutation.mutateAsync({
        name: name.trim(),
        apiKey: apiKey.trim(),
      });

      if (result.success && result.accessToken) {
        configStore.setAuth(result.accessToken, result.name || name, apiKey.trim(), null);
        setName('');
        setApiKey('');
      } else {
        setError(result.error || 'Registration failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    }
  };

  const handleGetApiKey = () => {
    const api = getElectronAPI();
    if (api) {
      api.app.openExternalLink('https://console.videodb.io');
    }
  };

  const isSubmitting = registerMutation.isPending;
  const canSubmit = name.trim().length > 0 && apiKey.trim().length > 0 && !isSubmitting;

  return (
    <div className="h-full w-full bg-surface-page flex flex-col items-center justify-center relative overflow-hidden">
      {/* Brand gradient glow */}
      <div
        className="absolute top-[-30%] left-1/2 -translate-x-1/2 w-[600px] h-[567px] rounded-[300px] pointer-events-none brand-glow-bg"
      />

      {/* Main content */}
      <div className="flex flex-col items-center w-full max-w-[380px] px-6 relative z-10">
        {/* Logo and heading */}
        <div className="flex flex-col items-center gap-[16px] mb-[32px]">
          <LogoIcon />
          <div className="flex flex-col items-center gap-[8px]">
            <h1 className="text-xl font-semibold text-black text-center tracking-[-0.44px]">
              Welcome to Chess Lens
            </h1>
            <p className="text-base font-normal text-text-body text-center">
              Record, Analyse, and get AI insights from every chess match.
            </p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-[16px]">
          {/* Name field */}
          <div className="flex flex-col gap-[8px]">
            <label className="text-base font-medium text-text-label tracking-[0.005em]">
              Your name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
              className="w-full h-[50px] bg-input-bg border border-border-input rounded-[12px] px-[16px] py-[14px] text-base font-medium text-text-label placeholder:text-text-muted-brand outline-none focus:border-[#c0c0c0] transition-colors"
              autoFocus
            />
          </div>

          {/* API Key field */}
          <div className="flex flex-col gap-[8px]">
            <label className="text-base font-medium text-text-label tracking-[0.005em]">
              VideoDB API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-xxxxxxxxxxxxxxxx"
              className="w-full h-[50px] bg-input-bg border border-border-input rounded-[12px] px-[16px] py-[14px] text-base font-medium text-text-label placeholder:text-text-muted-brand outline-none focus:border-[#c0c0c0] transition-colors font-mono"
            />
          </div>

          {/* Error message */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-[10px]">
              <p className="text-[13px] text-red-600">{error}</p>
            </div>
          )}

          {/* Buttons */}
          <div className="flex flex-col gap-[10px] mt-[16px]">
            {/* Continue button */}
            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full h-[45px] bg-brand-cta hover:bg-brand-cta-hover disabled:bg-brand-disabled disabled:cursor-not-allowed rounded-[12px] px-[24px] py-[12px] text-base font-medium text-white text-center transition-colors flex items-center justify-center"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                'Continue'
              )}
            </button>

            {/* Get API key link */}
            <button
              type="button"
              onClick={handleGetApiKey}
              className="w-full flex items-center justify-center gap-[4px] px-[16px] py-[12px] rounded-[10px] hover:bg-black/5 transition-colors"
            >
              <span className="text-sm font-medium text-text-body">
                Don't have an API key?
              </span>
              <span className="text-sm font-medium text-brand">
                Get one
              </span>
              <ChevronRight className="w-[14px] h-[14px] text-brand" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

