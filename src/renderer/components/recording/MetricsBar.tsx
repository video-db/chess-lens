/**
 * Metrics Bar Component
 *
 * Shows recording metrics:
 * - Move ratio (White vs Black with progress bar)
 */

import React from 'react';
import { useCopilotStore } from '../../stores/copilot.store';

export function MetricsBar() {
  const { metrics } = useCopilotStore();

  const whitePercent = metrics ? Math.round(metrics.talkRatio.me * 100) : 50;
  const blackPercent = metrics ? Math.round(metrics.talkRatio.them * 100) : 50;

  return (
    <div className="flex items-center h-[35px]">
      {/* Move Ratio Pill */}
      <div className="bg-white border border-border-default rounded-[40px] h-full px-[16px] py-[4px] flex items-center flex-1">
        <div className="flex items-center gap-[12px] w-full">
          <span className="text-base text-text-body whitespace-nowrap">
            White: {whitePercent}%
          </span>
          {/* Progress bar */}
          <div className="flex-1 h-[7px] bg-progress-track rounded-[4px] overflow-hidden relative">
            {/* White portion (brand) */}
            <div
              className="absolute top-0 left-0 h-full bg-brand rounded-l-[4px]"
              style={{ width: `${whitePercent}%` }}
            />
            {/* Black portion (blue) */}
            <div
              className="absolute top-0 right-0 h-full bg-progress-alt rounded-r-[4px]"
              style={{ width: `${blackPercent}%` }}
            />
          </div>
          <span className="text-base text-text-body whitespace-nowrap">
            Black: {blackPercent}%
          </span>
        </div>
      </div>
    </div>
  );
}

export default MetricsBar;
