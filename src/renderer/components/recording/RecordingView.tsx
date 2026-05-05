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
import { Loader2, ArrowLeft, Calendar, Clock, Swords } from 'lucide-react';
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
import { useSessionStore } from '../../stores/session.store';
import { ChessLensIconBlack } from '../ui/ChessLensIcon';

// ─── Processing view — Figma "Generating Game Summary" ───────────────────────

interface ProcessingViewProps {
  onBack?: () => void;
}

function ProcessingView({ onBack }: ProcessingViewProps) {
  const sessionStore = useSessionStore();
  const sessionId = sessionStore.sessionId;

  return (
    <div className="flex h-full w-full bg-white overflow-hidden">

      {/* Sidebar */}
      <div
        className="flex flex-col items-center"
        style={{ width: 72, borderRight: '1px solid rgba(0,0,0,0.1)', padding: '0 0 20px', flexShrink: 0 }}
      >
        <div className="flex flex-col items-center gap-[20px] p-[20px] flex-1">
          <ChessLensIconBlack size={32} />
        </div>
      </div>

      {/* Right side */}
      <div
        className="flex flex-col flex-1 overflow-hidden"
        style={{ background: '#F7F7F7', padding: '0 10px', gap: 10 }}
      >
        {/* Header */}
        <div className="flex gap-[12px] items-start flex-shrink-0" style={{ padding: '30px 20px 20px' }}>
          {/* Left: Back + Title + metadata */}
          <div className="flex-1 flex gap-[16px] items-start">
            <button
              onClick={onBack}
              className="flex items-center justify-center bg-white hover:bg-gray-50 transition-colors"
              style={{ width: 28, height: 28, border: '0.933px solid rgba(0,0,0,0.2)', borderRadius: 6.53, flexShrink: 0, marginTop: 2 }}
            >
              <ArrowLeft className="h-[15px] w-[15px] text-black" />
            </button>
            <div className="flex flex-col gap-[10px]">
              <h1 className="text-[24px] font-semibold text-black" style={{ letterSpacing: '0.005em' }}>
                {sessionId ? 'Game Session' : 'Processing...'}
              </h1>
              <div className="flex items-center gap-[20px]">
                <div className="flex items-center gap-[4px]">
                  <Calendar className="h-4 w-4 opacity-20" style={{ color: '#464646' }} />
                  <span className="text-[13px]" style={{ color: '#464646', letterSpacing: '0.005em' }}>
                    {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
                <div className="flex items-center gap-[4px]">
                  <Clock className="h-4 w-4 opacity-20" style={{ color: '#464646' }} />
                  <span className="text-[13px]" style={{ color: '#464646', letterSpacing: '0.005em' }}>— min</span>
                </div>
                <div className="flex items-center gap-[4px]">
                  <Swords className="h-4 w-4 opacity-20" style={{ color: '#464646' }} />
                  <span className="text-[13px]" style={{ color: '#464646', letterSpacing: '0.005em' }}>— Moves</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Analysing badge */}
          <div className="flex items-start" style={{ paddingTop: 2 }}>
            <div
              className="flex items-center gap-[6px]"
              style={{
                padding: '4px 12px 4px 10px',
                background: '#CCE9CD',
                border: '1px solid #C9E4D5',
                boxShadow: '0px 1.27px 15.27px rgba(0,0,0,0.05)',
                borderRadius: 12,
              }}
            >
              <Loader2 className="h-4 w-4 animate-spin" style={{ color: '#009106' }} />
              <span className="text-[13px] font-medium" style={{ color: '#009106', letterSpacing: '0.005em' }}>
                Analysing...
              </span>
            </div>
          </div>
        </div>

        {/* Main container — centered dialog */}
        <div
          className="flex-1 flex items-center justify-center overflow-hidden"
          style={{
            background: '#FFFFFF',
            border: '1px solid #EFEFEF',
            borderRadius: '20px 20px 0px 0px',
          }}
        >
          {/* Dialog card */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: 30,
              gap: 20,
              width: 550,
              background: '#FFFFFF',
              borderRadius: 16,
            }}
          >
            {/* container: icon + text */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, width: 490 }}>

              {/* Icon circle */}
              <div
                style={{
                  width: 68,
                  height: 68,
                  background: '#F7F7F7',
                  border: '1.7px solid #EFEFEF',
                  borderRadius: 85,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Swords className="w-8 h-8" style={{ color: '#464646', opacity: 0.6 }} />
              </div>

              {/* Text block */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, width: 490 }}>
                <h2
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 22,
                    fontWeight: 500,
                    color: '#000000',
                    textAlign: 'center',
                    margin: 0,
                    lineHeight: '27px',
                    width: 490,
                  }}
                >
                  Generating Game Summary
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: 490 }}>
                  <p
                    style={{
                      fontFamily: 'Inter, sans-serif',
                      fontSize: 14,
                      fontWeight: 400,
                      color: '#464646',
                      textAlign: 'center',
                      margin: 0,
                      lineHeight: '150%',
                      width: 370,
                    }}
                  >
                    Analyzing your game and preparing coaching insights. This will only take a moment.
                  </p>
                </div>
              </div>
            </div>

            {/* CTA */}
            <button
              onClick={onBack}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '12px 20px',
                background: '#FF4000',
                border: 'none',
                borderRadius: 12,
                boxShadow: '0px 1.27px 15.27px rgba(0,0,0,0.05)',
                cursor: 'pointer',
                fontFamily: 'Inter, sans-serif',
                fontSize: 14,
                fontWeight: 600,
                color: '#FFFFFF',
                letterSpacing: '-0.02em',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path fillRule="evenodd" clipRule="evenodd" d="M10 2.125C5.65076 2.125 2.125 5.65076 2.125 10C2.125 14.3492 5.65076 17.875 10 17.875C14.3492 17.875 17.875 14.3492 17.875 10C17.875 5.65076 14.3492 2.125 10 2.125ZM0.875 10C0.875 4.96043 4.96043 0.875 10 0.875C15.0396 0.875 19.125 4.96043 19.125 10C19.125 15.0396 15.0396 19.125 10 19.125C4.96043 19.125 0.875 15.0396 0.875 10Z" fill="white"/>
                <circle cx="10" cy="10" r="3.5" fill="white"/>
              </svg>
              <span>Start New Recording</span>
            </button>
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
    return <ProcessingView onBack={handleGoBack} />;
  }

  // If idle with no summary, useEffect above handles navigation; return null to avoid flash
  if (isIdle && !callSummary) {
    return null;
  }

  return <ActiveRecordingLayout />;
}

export default RecordingView;
