import React, { useEffect, useRef, useState, useCallback } from 'react';
import { PairCompactOverlay } from './components/PairCompactOverlay';
import type {
  InsightCard,
  WidgetSessionState as SessionState,
  WidgetNudge as Nudge,
  WidgetLiveAssistData,
} from '../../types/widget';

export function WidgetApp() {
  const [sessionState, setSessionState] = useState<SessionState>({
    isRecording: false,
    isPaused: false,
    isMicMuted: false,
    startTime: null,
    gameId: '',
  });
  const [sayThis, setSayThis] = useState<InsightCard[]>([]);
  const [askThis, setAskThis] = useState<InsightCard[]>([]);
  const [visualDescription, setVisualDescription] = useState<string>('');
  const [nudge, setNudge] = useState<Nudge | null>(null);
  const [currentFen, setCurrentFen] = useState<string | null>(null);
  const [displayFen, setDisplayFen] = useState<string | null>(null);
  const [currentTurn, setCurrentTurn] = useState<'w' | 'b' | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);

  // Ref for the root wrapper — observed by ResizeObserver to auto-resize the window
  const rootRef = useRef<HTMLDivElement>(null);

  // ResizeObserver: report rendered content height to main process whenever it changes
  useEffect(() => {
    const api = window.widgetAPI;
    if (!api?.reportContentHeight) return;
    const el = rootRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        api.reportContentHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const api = window.widgetAPI;
    if (!api) return;

    let cancelled = false;
    let retryTimer: number | null = null;
    let retryCount = 0;

    // Set up listeners
    const unsubSession = api.onSessionState((state) => {
      setSessionState((prev) => {
        // Transitioning recording → not recording: clear all coaching state
        if (prev.isRecording && !state.isRecording) {
          setSayThis([]);
          setAskThis([]);
          setCurrentFen(null);
          setDisplayFen(null);
          setCurrentTurn(null);
        }
        // Transitioning not-recording → recording: also clear (fresh session)
        if (!prev.isRecording && state.isRecording) {
          setSayThis([]);
          setAskThis([]);
          setCurrentFen(null);
          setDisplayFen(null);
          setCurrentTurn(null);
        }
        return state;
      });
      if (state.isRecording) {
        setIsConnecting(false);
      }
    });

    const unsubLiveAssist = api.onLiveAssist((data) => {
      setSayThis(data.sayThis);
      setAskThis(data.askThis);
    });

    const unsubVisual = api.onVisualAnalysis((data) => {
      setVisualDescription(data.description);
    });

    const unsubNudge = api.onNudge((n) => {
      setNudge(n);
    });

    const unsubFen = api.onFen((data) => {
      setCurrentFen(data.fen);
      setDisplayFen(data.displayFen);
      setCurrentTurn(data.turn);
    });

    const requestStateUntilRecording = () => {
      void api.requestInitialState();

      retryCount += 1;
      if (cancelled || retryCount >= 10) {
        setIsConnecting(false);
        return;
      }

      retryTimer = window.setTimeout(() => {
        if (!cancelled) {
          requestStateUntilRecording();
        }
      }, 500);
    };

    requestStateUntilRecording();

    return () => {
      cancelled = true;
      setIsConnecting(false);
      if (retryTimer) {
        window.clearTimeout(retryTimer);
      }
      unsubSession();
      unsubLiveAssist();
      unsubVisual();
      unsubNudge();
      unsubFen();
    };
  }, []);

  // Auto-dismiss nudge after 5 seconds
  useEffect(() => {
    if (!nudge) return;
    const timer = setTimeout(() => {
      setNudge(null);
    }, 5000);
    return () => clearTimeout(timer);
  }, [nudge]);

  const handlePause = useCallback(async () => {
    await window.widgetAPI?.pause();
  }, []);

  const handleResume = useCallback(async () => {
    await window.widgetAPI?.resume();
  }, []);

  const handleStop = useCallback(async () => {
    if (isStopping) return;
    setIsStopping(true);
    setSessionState((prev) => ({
      ...prev,
      isRecording: false,
      isPaused: false,
    }));

    try {
      await window.widgetAPI?.stop();
    } finally {
      setIsStopping(false);
    }
  }, [isStopping]);

  const handleMuteMic = useCallback(async () => {
    await window.widgetAPI?.muteMic();
  }, []);

  const handleUnmuteMic = useCallback(async () => {
    await window.widgetAPI?.unmuteMic();
  }, []);

  const handleDismissCard = useCallback(async (type: 'sayThis' | 'askThis', id: string) => {
    await window.widgetAPI?.dismissCard(type, id);
    if (type === 'sayThis') {
      setSayThis((prev) => prev.filter((c) => c.id !== id));
    } else {
      setAskThis((prev) => prev.filter((c) => c.id !== id));
    }
  }, []);

  const handleDismissNudge = useCallback(async () => {
    if (nudge) {
      await window.widgetAPI?.dismissNudge(nudge.id);
      setNudge(null);
    }
  }, [nudge]);

  return (
    <div ref={rootRef} style={{ width: '100%' }}>
      <PairCompactOverlay
        sessionState={sessionState}
        sayThis={sayThis}
        askThis={askThis}
        visualDescription={visualDescription}
        nudge={nudge}
        currentFen={currentFen}
        displayFen={displayFen}
        currentTurn={currentTurn}
        onStop={handleStop}
        onPause={handlePause}
        onResume={handleResume}
        onMuteMic={handleMuteMic}
        onUnmuteMic={handleUnmuteMic}
        onDismissCard={handleDismissCard}
        onDismissNudge={handleDismissNudge}
        stopDisabled={isStopping}
        statusText={isConnecting ? 'Connecting...' : undefined}
      />
    </div>
  );
}
