import React, { useState } from 'react';
import { Loader2, ChevronDown } from 'lucide-react';
import {
  type SupportedGameId,
  CHESS_PERSONALITIES,
} from '../../../shared/config/game-coaching';
import logoOrangeIcon from '../../../../resources/chess-lens-icon-orange.svg';

function LogoIcon() {
  return <img src={logoOrangeIcon} width={50} height={50} alt="Chess Lens" className="rounded-[8px]" />;
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
  initialCoachPersonalityId = 'default',
  isGenerating,
  onNext,
  onSkip,
}: InfoStepProps) {
  const [name, setName] = useState(initialName);
  const [coachPersonalityId, setCoachPersonalityId] = useState(initialCoachPersonalityId);
  const gameId: SupportedGameId = 'chess';

  const canSubmit = name.trim().length > 0 && !isGenerating;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    // Use onSkip for direct start (no description/questions flow needed)
    onSkip(name.trim(), '', gameId, coachPersonalityId);
  };

  return (
    <div className="flex flex-col items-center w-full max-w-[380px]">
      {/* Logo + heading */}
      <div className="flex flex-col items-center gap-[16px] mb-[30px]">
        <LogoIcon />
        <div className="flex flex-col items-center gap-[8px]">
          <h1 className="text-[22px] font-semibold text-black text-center tracking-[-0.44px] leading-[33px]">
            Set up your game session
          </h1>
          <p className="text-[13px] font-normal text-text-body text-center leading-[22px]">
            Name your game and choose a coaching style. Chess Lens will do the rest.
          </p>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="w-full flex flex-col gap-[20px]">

        {/* Match Name */}
        <div className="flex flex-col gap-[8px]">
          <label htmlFor="game-name" className="text-[14px] font-medium text-text-label tracking-[0.005em]">
            Match Name
          </label>
          <input
            id="game-name"
            type="text"
            placeholder="e.g. Casual blitz"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isGenerating}
            autoFocus
            className="w-full h-[50px] px-[16px] py-[14px] bg-input-bg border border-border-input rounded-[12px] text-base font-medium text-text-label placeholder:text-text-muted-brand focus:outline-none focus:border-input-focus focus:shadow-[0_0_0_3px_var(--color-input-focus-ring)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          />
        </div>

        {/* Coach Personality */}
        <div className="flex flex-col gap-[8px]">
          <label htmlFor="coach-personality" className="text-[14px] font-medium text-text-label tracking-[0.005em]">
            Coach personality*
          </label>
          <div className="relative">
            <select
              id="coach-personality"
              value={coachPersonalityId}
              onChange={(e) => setCoachPersonalityId(e.target.value)}
              disabled={isGenerating}
              className="w-full appearance-none h-[50px] px-[16px] py-[14px] pr-[40px] bg-input-bg border border-border-input rounded-[12px] text-base font-medium text-text-label focus:outline-none focus:border-input-focus focus:shadow-[0_0_0_3px_var(--color-input-focus-ring)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <option value="" disabled>Choose a style...</option>
              {CHESS_PERSONALITIES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-[14px] top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted-brand pointer-events-none" />
          </div>
        </div>

        {/* Buttons */}
        <div className="flex flex-col gap-[10px] pt-[4px]">
          {/* Start now */}
          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full h-[45px] flex items-center justify-center bg-brand-cta hover:bg-brand-cta-hover disabled:bg-brand-disabled disabled:cursor-not-allowed rounded-[12px] text-[14px] font-medium text-white text-center transition-colors"
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              'Start now'
            )}
          </button>

          {/* Hint text */}
          <p className="text-[13px] font-medium text-text-body text-center leading-[20px] tracking-[0.13px]">
            A floating coaching overlay will appear over your game window.
          </p>
        </div>
      </form>
    </div>
  );
}
