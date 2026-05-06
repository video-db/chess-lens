/**
 * Recording Header Component
 *
 * Header for recording view with:
 * - Game name and time
 * - Recording timer with red dot
 * - Pause/Stop buttons
 */

import React, { useState, useEffect } from 'react';
import { Pause, Square, Loader2, Calendar } from 'lucide-react';
import { useSession } from '../../hooks/useSession';
import { useGameSetupStore } from '../../stores/meeting-setup.store';

// Clock icon
function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="6" stroke="var(--color-text-body)" strokeWidth="1.25" />
      <path
        d="M8 4.5v4l2.5 1.5"
        stroke="var(--color-text-body)"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Pause icon
function PauseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="5" y="4" width="3" height="12" rx="1" fill="currentColor" />
      <rect x="12" y="4" width="3" height="12" rx="1" fill="currentColor" />
    </svg>
  );
}

// Stop icon
function StopIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="5" y="5" width="10" height="10" rx="1" fill="white" />
    </svg>
  );
}

// Play icon (for resume)
function PlayIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 4L16 10L6 16V4Z" fill="currentColor" />
    </svg>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatStartTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function RecordingHeader() {
  const { status, elapsedTime, isRecording, isStopping, isPaused, stopRecording, pauseRecording, resumeRecording } = useSession();
  const { name } = useGameSetupStore();

  // Capture start time once when component mounts
  const [startTime] = useState(() => new Date());

  const gameName = name || 'Chess Game';

  return (
    <div className="flex items-start gap-[12px]" style={{ padding: '30px 20px 20px' }}>
      {/* Title section */}
      <div className="flex-1 flex flex-col gap-[10px]">
        <h1 className="font-semibold text-black" style={{ fontSize: 24, lineHeight: '29px', letterSpacing: '0.005em' }}>{gameName}</h1>
        <div className="flex items-center gap-[20px]">
          <div className="flex items-center gap-[4px]">
            <Calendar size={16} color="#464646" style={{ opacity: 0.2 }} />
            <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 400, fontSize: 13, color: '#464646', letterSpacing: '0.005em', lineHeight: '16px' }}>
              {startTime.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </span>
          </div>
          <div className="flex items-center gap-[4px]">
            <ClockIcon />
            <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 400, fontSize: 13, color: '#464646', letterSpacing: '0.005em', lineHeight: '16px' }}>
              {formatStartTime(startTime)}
            </span>
          </div>
        </div>
      </div>

      {/* Controls section */}
      <div className="flex items-center gap-[12px]" style={{ paddingTop: 2, flexShrink: 0 }}>
        {/* Timer */}
        <div className="flex items-center gap-[10px]">
          <div
            className={`w-[8px] h-[8px] rounded-[4px] ${
              isPaused
                ? 'bg-chess-draw'
                : isRecording
                  ? 'bg-[#D1242F] animate-pulse'
                  : 'bg-text-muted-brand'
            }`}
            style={{ flexShrink: 0 }}
          />
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 500, fontSize: 24, letterSpacing: '0.005em', color: '#000000', lineHeight: '32px' }}>
            {formatTime(elapsedTime)}
          </span>
        </div>

        {/* Pause/Resume Recording button */}
        {isRecording && !isStopping && (
          <button
            onClick={isPaused ? resumeRecording : pauseRecording}
            className={`flex items-center gap-[6px] bg-white border rounded-[12px] pl-[16px] pr-[20px] py-[12px] shadow-[0px_1.272px_15.267px_0px_rgba(0,0,0,0.05)] hover:bg-surface-muted transition-colors ${
              isPaused ? 'border-brand' : 'border-border-default'
            }`}
          >
            {isPaused ? <PlayIcon /> : <PauseIcon />}
            <span className={`font-semibold text-base tracking-[-0.28px] ${isPaused ? 'text-brand' : 'text-black'}`}>
              {isPaused ? 'Resume Recording' : 'Pause Recording'}
            </span>
          </button>
        )}

        {/* Stop button */}
        {isRecording && !isStopping && (
          <button
            onClick={stopRecording}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '12px 20px',
              gap: 4,
              background: '#EF4444',
              boxShadow: '0px 1.27px 15.27px rgba(0,0,0,0.05)',
              borderRadius: 12,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <StopIcon />
            <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 14, letterSpacing: '-0.02em', color: '#FFFFFF' }}>Stop</span>
          </button>
        )}

        {/* Stopping state */}
        {isStopping && (
          <button
            disabled
            className="flex items-center gap-[4px] bg-surface-muted border border-border-default rounded-[12px] px-[20px] py-[12px] cursor-not-allowed"
          >
            <Loader2 className="w-[20px] h-[20px] animate-spin text-text-muted-brand" />
            <span className="font-semibold text-base text-text-muted-brand tracking-[-0.28px]">
              Stopping...
            </span>
          </button>
        )}

        {/* Starting state */}
        {status === 'starting' && (
          <button
            disabled
            className="flex items-center gap-[4px] bg-surface-muted border border-border-default rounded-[12px] px-[20px] py-[12px] cursor-not-allowed"
          >
            <Loader2 className="w-[20px] h-[20px] animate-spin text-text-muted-brand" />
            <span className="font-semibold text-base text-text-muted-brand tracking-[-0.28px]">
              Starting...
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

export default RecordingHeader;
