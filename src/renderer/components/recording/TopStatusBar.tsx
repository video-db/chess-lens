/**
 * Top Status Bar Component
 *
 * Compact status bar showing recording info:
 * - Recording time with indicator
 * - Talk ratio visualization
 * - Health score
 * - Stop recording button
 */

import React from 'react';
import { Circle, Square, Mic, Users, Loader2, Gauge } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { useSession } from '../../hooks/useSession';
import { useCopilotStore } from '../../stores/copilot.store';
import { formatDuration, cn } from '../../lib/utils';

export function TopStatusBar() {
  const { status, elapsedTime, isRecording, isStopping, stopRecording } =
    useSession();
  const { metrics, healthScore, isCallActive } = useCopilotStore();

  const mePercent = metrics ? Math.round(metrics.talkRatio.me * 100) : 0;
  const themPercent = metrics ? Math.round(metrics.talkRatio.them * 100) : 0;

  // In idle state, show minimal status bar (GameSetupFlow handles recording start)
  if (!isRecording && status === 'idle') {
    return (
      <div className="h-14 border-b bg-white/80 dark:bg-slate-900/80 backdrop-blur-lg flex items-center justify-center px-6">
        <span className="text-sm text-muted-foreground">Prepare your game below</span>
      </div>
    );
  }

  if (status === 'starting') {
    return (
      <div className="h-16 border-b bg-white/80 dark:bg-slate-900/80 backdrop-blur-lg flex items-center px-6 gap-6">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
            <span className="text-2xl font-mono font-bold tracking-tight text-slate-400">0:00</span>
          </div>
          <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
            STARTING
          </Badge>
        </div>

        <div className="flex-1" />

        <Button size="sm" className="gap-2" disabled>
          <Loader2 className="w-3 h-3 animate-spin" />
          Starting...
        </Button>
      </div>
    );
  }

  if (status === 'processing') {
    return (
      <div className="h-16 border-b bg-white/80 dark:bg-slate-900/80 backdrop-blur-lg flex items-center px-6 gap-6">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
            <span className="text-2xl font-mono font-bold tracking-tight text-slate-500">
              {formatDuration(elapsedTime)}
            </span>
          </div>
          <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            PROCESSING
          </Badge>
        </div>

        <div className="flex-1" />

        <span className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Uploading recording...
        </span>
      </div>
    );
  }

  return (
    <div className="h-16 border-b bg-white/80 dark:bg-slate-900/80 backdrop-blur-lg flex items-center px-6 gap-6">
      {/* Recording Status */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Circle
            className={cn(
              'w-3 h-3',
              isRecording ? 'fill-red-500 text-red-500 animate-pulse' : 'text-slate-400'
            )}
          />
          <span className="text-2xl font-mono font-bold tracking-tight">
            {formatDuration(elapsedTime)}
          </span>
        </div>
        {isRecording && (
          <Badge variant="secondary" className="text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
            REC
          </Badge>
        )}
      </div>

      <div className="h-8 w-px bg-slate-200 dark:bg-slate-700" />

      {/* Move Ratio */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Mic className="w-4 h-4 text-blue-500" />
          <div className="text-sm font-medium text-slate-600 dark:text-slate-400">White</div>
          <div className="text-lg font-bold text-blue-600">{mePercent}%</div>
        </div>
        <div className="w-24 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full transition-all duration-500',
              mePercent > 65 ? 'bg-amber-500' : mePercent >= 35 ? 'bg-blue-500' : 'bg-blue-400'
            )}
            style={{ width: `${mePercent}%` }}
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="text-lg font-bold text-purple-600">{themPercent}%</div>
          <div className="text-sm font-medium text-slate-600 dark:text-slate-400">Black</div>
          <Users className="w-4 h-4 text-purple-500" />
        </div>
      </div>

      {/* Speaking Pace */}
      {metrics && (
        <>
          <div className="h-8 w-px bg-slate-200 dark:bg-slate-700" />
          <div className="flex items-center gap-2">
            <Gauge className="w-4 h-4 text-slate-500" />
            <span className={cn(
              'text-lg font-bold',
              metrics.pace > 180 ? 'text-amber-500' : 'text-slate-600 dark:text-slate-400'
            )}>
              {metrics.pace}
            </span>
            <span className="text-sm text-slate-500">WPM</span>
          </div>
        </>
      )}

      {/* Health Score */}
      {isCallActive && (
        <>
          <div className="h-8 w-px bg-slate-200 dark:bg-slate-700" />
          <Badge
            variant={healthScore >= 70 ? 'default' : healthScore >= 50 ? 'secondary' : 'destructive'}
            className="text-sm px-3 py-1"
          >
            Health: {healthScore}
          </Badge>
        </>
      )}

      <div className="flex-1" />

      {/* Recording Controls */}
      {isRecording && !isStopping && (
        <Button variant="destructive" size="sm" className="gap-2" onClick={stopRecording}>
          <Square className="w-3 h-3 fill-white" />
          Stop
        </Button>
      )}

      {/* Stopping state */}
      {isStopping && (
        <Button variant="secondary" size="sm" className="gap-2" disabled>
          <Loader2 className="w-3 h-3 animate-spin" />
          Stopping...
        </Button>
      )}
    </div>
  );
}

export default TopStatusBar;
