/**
 * RecordingView Component
 *
 * Full-screen view shown while a game session is active (recording, processing,
 * or awaiting call summary). Extracted from App.tsx for maintainability.
 *
 * Props:
 *   onBack — called when the session ends or the user returns to Home
 */

import React from 'react';
import { Loader2 } from 'lucide-react';
import { useSession } from '../../hooks/useSession';
import { useCopilot } from '../../hooks/useCopilot';
import { useCopilotStore } from '../../stores/copilot.store';
import { useGameSetupStore } from '../../stores/meeting-setup.store';
import { useSessionLifecycle } from '../../hooks/useSessionLifecycle';
import { RecordingHeader } from './RecordingHeader';
import { MetricsBar } from './MetricsBar';
import { LiveAssistPanel } from './LiveAssistPanel';
import { MeetingAgendaPanel } from './MeetingAgendaPanel';
import { TranscriptionPanel } from '../transcription/TranscriptionPanel';
import { CallSummaryView } from '../copilot';

// ─── Processing spinner sub-view ──────────────────────────────────────────────

function ProcessingView() {
  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface-muted">
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-full bg-warm-tint flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-brand animate-spin" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-black">Generating Game Summary</h2>
            <p className="text-sm text-text-body mt-1">
              Analyzing your game and preparing coaching insights...
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Call summary sub-view ────────────────────────────────────────────────────

interface SummaryViewProps {
  onGoBack: () => void;
  onStartNewCall: () => void;
}

function SummaryView({ onGoBack, onStartNewCall }: SummaryViewProps) {
  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface-muted">
      {/* Header */}
      <div className="flex items-center justify-between px-[20px] py-[16px] bg-white border-b border-border-default">
        <h2 className="text-[22px] font-semibold text-black tracking-[0.005em]">Game Complete</h2>
        <div className="flex gap-[8px]">
          <button
            onClick={onGoBack}
            className="px-[14px] py-[8px] border border-border-default rounded-[10px] text-sm font-medium text-text-body hover:bg-surface-muted transition-colors"
          >
            Back to Home
          </button>
          <button
            onClick={onStartNewCall}
            className="px-[14px] py-[8px] bg-brand-cta hover:bg-brand-cta-hover rounded-[12px] text-sm font-medium text-white transition-colors"
          >
            Start New Game
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden p-6">
        <div className="max-w-4xl mx-auto h-full flex flex-col">
          <div className="flex-1 min-h-0 overflow-auto">
            <CallSummaryView />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Active recording layout ──────────────────────────────────────────────────

function ActiveRecordingLayout() {
  const meetingSetupStore = useGameSetupStore();
  const { checklist } = meetingSetupStore;
  const hasChecklist = checklist.length > 0;

  return (
    <div className="flex flex-col h-full bg-surface-muted">
      {/* Header with timer + controls */}
      <RecordingHeader />

      {/* Main container */}
      <div className="flex-1 bg-white border border-border-default rounded-t-[20px] mx-[10px] p-[20px] flex gap-[30px] overflow-hidden">
        {/* Left column — AI coaching panel */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <LiveAssistPanel />
        </div>

        {/* Right column — metrics, session goals, transcript */}
        <div className="w-[460px] shrink-0 flex flex-col gap-[13px] h-full">
          <MetricsBar />
          <div className="flex-1 bg-surface-muted border border-border-default rounded-[16px] p-[12px] flex flex-col gap-[16px] overflow-hidden min-h-0">
            {hasChecklist && <MeetingAgendaPanel checklist={checklist} />}
            <TranscriptionPanel />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── RecordingView ────────────────────────────────────────────────────────────

export interface RecordingViewProps {
  onBack?: () => void;
}

export function RecordingView({ onBack }: RecordingViewProps) {
  const { isCallActive, callSummary } = useCopilotStore();
  const { status } = useSession();
  const { prepareNewSession } = useSessionLifecycle();

  const isRecording = status === 'recording';
  const isProcessing = status === 'processing' || status === 'stopping';
  const isIdle = status === 'idle';

  // Navigate to detail page once call summary is ready (after recording ended)
  const wasRecordingRef = React.useRef(false);
  React.useEffect(() => {
    if (isRecording) {
      wasRecordingRef.current = true;
    }
    if (callSummary && wasRecordingRef.current) {
      onBack?.();
    }
  }, [callSummary, isRecording, onBack]);

  useCopilot();

  const handleStartNewCall = () => { prepareNewSession(); };
  const handleGoBack = () => { prepareNewSession(); onBack?.(); };

  if (callSummary && !isCallActive) {
    return <SummaryView onGoBack={handleGoBack} onStartNewCall={handleStartNewCall} />;
  }

  if (isProcessing) {
    return <ProcessingView />;
  }

  // If idle with no summary, useEffect above handles navigation; return null to avoid flash
  if (isIdle && !callSummary) {
    return null;
  }

  return <ActiveRecordingLayout />;
}

export default RecordingView;
