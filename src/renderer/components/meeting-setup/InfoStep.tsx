import React, { useState } from 'react';
import { Loader2, ChevronDown } from 'lucide-react';
import {
  type SupportedGameId,
  CHESS_PERSONALITIES,
} from '../../../shared/config/game-coaching';

// Icons
function ChessSetupIcon() {
  return (
    <svg width="50" height="50" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="50" height="50" rx="12" fill="#EC5B16" />
      <path
        d="M17 18h16v14H17V18z"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M21 14v4M29 14v4M17 24h16"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 12l4-4-4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RecordingIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="3" fill="currentColor" />
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

interface InfoStepProps {
  initialName: string;
  initialDescription: string;
  initialCoachPersonalityId?: string;
  isGenerating: boolean;
  isSkipping?: boolean;
  onBack: () => void;
  onNext: (name: string, description: string, gameId: SupportedGameId, coachPersonalityId: string) => void;
  onSkip: (name: string, description: string, gameId: SupportedGameId, coachPersonalityId: string) => void;
}

export function InfoStep({
  initialName,
  initialDescription,
  initialCoachPersonalityId = 'default',
  isGenerating,
  isSkipping,
  onBack,
  onNext,
  onSkip,
}: InfoStepProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [coachPersonalityId, setCoachPersonalityId] = useState(initialCoachPersonalityId);
  const gameId: SupportedGameId = 'chess';

  const canContinue = name.trim().length > 0;
  const isDisabled = isGenerating || isSkipping;

  const selectedPersonality = CHESS_PERSONALITIES.find((p) => p.id === coachPersonalityId) ?? CHESS_PERSONALITIES[0];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canContinue && !isDisabled) {
      onNext(name.trim(), description.trim(), gameId, coachPersonalityId);
    }
  };

  return (
    <div className="flex flex-col items-center">
      {/* Icon and heading */}
      <div className="flex flex-col items-center gap-[16px] mb-[32px]">
        <ChessSetupIcon />
        <div className="flex flex-col items-center gap-[8px]">
          <h1 className="text-[22px] font-semibold text-black text-center tracking-[-0.44px] leading-[33px]">
            Game Details
          </h1>
          <p className="text-[14px] font-normal text-[#464646] text-center leading-[21px]">
            Tell us about your game so we can prepare better
          </p>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="w-full flex flex-col gap-[20px]">
        {/* Game Name */}
        <div className="flex flex-col gap-[8px]">
          <label htmlFor="game-name" className="text-[14px] font-medium text-[#141420]">
            Game Name
          </label>
          <input
            id="game-name"
            type="text"
            placeholder="e.g., Bullet Game vs Magnus"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isDisabled}
            autoFocus
            className="w-full px-[16px] py-[14px] bg-white border border-[#e0e0e8] rounded-[12px] text-[14px] text-black placeholder:text-[#969696] focus:outline-none focus:border-[#ec5b16] focus:ring-1 focus:ring-[#ec5b16] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          />
        </div>

        {/* Description */}
        <div className="flex flex-col gap-[8px]">
          <label htmlFor="meeting-description" className="text-[14px] font-medium text-[#141420]">
            Description <span className="text-[#969696] font-normal">(optional)</span>
          </label>
          <textarea
            id="game-description"
            placeholder="What opening are you playing? Any specific goals for this game?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isDisabled}
            rows={4}
            className="w-full px-[16px] py-[14px] bg-white border border-[#e0e0e8] rounded-[12px] text-[14px] text-black placeholder:text-[#969696] focus:outline-none focus:border-[#ec5b16] focus:ring-1 focus:ring-[#ec5b16] disabled:opacity-50 disabled:cursor-not-allowed transition-colors resize-none"
          />
          <p className="text-[12px] text-[#969696]">
            Add details if you want better coaching questions, or leave it blank to start faster.
          </p>
        </div>

        {/* Coach Personality */}
        <div className="flex flex-col gap-[8px]">
          <label htmlFor="coach-personality" className="text-[14px] font-medium text-[#141420]">
            Coach Personality
          </label>
          <div className="relative">
            <select
              id="coach-personality"
              value={coachPersonalityId}
              onChange={(e) => setCoachPersonalityId(e.target.value)}
              disabled={isDisabled}
              className="w-full appearance-none px-[16px] py-[14px] pr-[40px] bg-white border border-[#e0e0e8] rounded-[12px] text-[14px] text-black focus:outline-none focus:border-[#ec5b16] focus:ring-1 focus:ring-[#ec5b16] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {CHESS_PERSONALITIES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <ChevronDown
              className="absolute right-[14px] top-1/2 -translate-y-1/2 w-4 h-4 text-[#969696] pointer-events-none"
            />
          </div>
          {selectedPersonality && (
            <p className="text-[12px] text-[#969696]">
              {selectedPersonality.description}
            </p>
          )}
        </div>

        {/* Buttons */}
        <div className="flex flex-col gap-[12px] pt-[8px]">
          {/* Primary row: Back and Continue */}
          <div className="flex gap-[12px]">
            <button
              type="button"
              onClick={onBack}
              disabled={isDisabled}
              className="flex-1 flex items-center justify-center gap-[6px] px-[20px] py-[14px] bg-white border border-[#e0e0e8] rounded-[12px] text-[14px] font-semibold text-[#464646] hover:bg-[#f7f7f7] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ArrowLeftIcon />
              Back
            </button>
            <button
              type="submit"
              disabled={!canContinue || isDisabled}
              className="flex-1 flex items-center justify-center gap-[6px] px-[20px] py-[14px] bg-[#ff4000] hover:bg-[#e63900] rounded-[12px] text-[14px] font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-[0px_1.272px_15.267px_0px_rgba(0,0,0,0.05)]"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Preparing...
                </>
              ) : (
                <>
                  Continue
                  <ArrowRightIcon />
                </>
              )}
            </button>
          </div>

          {/* Skip and Record button */}
          <button
            type="button"
            onClick={() => {
              console.log('[InfoStep] Skip clicked, passing name:', name.trim(), 'description:', description.trim());
              onSkip(name.trim(), description.trim(), gameId, coachPersonalityId);
            }}
            disabled={isDisabled}
            className="w-full flex items-center justify-center gap-[6px] px-[20px] py-[12px] bg-transparent border border-dashed border-[#c0c0c8] rounded-[12px] text-[14px] font-medium text-[#464646] hover:border-[#ec5b16] hover:text-[#ec5b16] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSkipping ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <RecordingIcon />
                Skip and Record
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
