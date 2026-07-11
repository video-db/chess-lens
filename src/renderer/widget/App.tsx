import React, { useEffect, useRef, useState, useCallback } from 'react';
import { PairCompactOverlay } from './components/PairCompactOverlay';
import type {
  InsightCard,
  WidgetSessionState as SessionState,
  WidgetNudge as Nudge,
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
  /** Authoritative board orientation received from the main process ('white' = rank 1 at bottom). */
  const [boardOrientation, setBoardOrientation] = useState<'white' | 'black'>('white');
  // Local turn override — lets the user flip the detected turn without an IPC round-trip.
  // Reset ONLY when the board position (FEN board part) actually changes, not on every fen event.
  const [turnOverride, setTurnOverride] = useState<'w' | 'b' | null>(null);
  const lastFenBoardRef = useRef<string | null>(null);
  // True from the moment the user clicks flip-turn until the engine produces
  // a new result with engineSan present (meaning the re-analysis completed).
  const [isTurnFlipping, setIsTurnFlipping] = useState(false);
  const flipPendingRef = useRef(false); // tracks whether a flip is still awaiting engine result
  const flipStartedAtRef = useRef<number>(0); // timestamp when the flip was initiated
  const [engineSan, setEngineSan] = useState<string | undefined>(undefined);
  const [engineLan, setEngineLan] = useState<string | undefined>(undefined);
  const [engineFrom, setEngineFrom] = useState<string | undefined>(undefined);
  const [engineTo, setEngineTo] = useState<string | undefined>(undefined);
  const [engineEval, setEngineEval] = useState<number | undefined>(undefined);
  const [engineMate, setEngineMate] = useState<number | null | undefined>(undefined);
  const [isStopping, setIsStopping] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [connectingError, setConnectingError] = useState<string | null>(null);
  const [forceStartupUi, setForceStartupUi] = useState(false);
  // Counts consecutive NO_BOARD frames received from the main process.
  // Stored as a ref so the onNoBoard callback always sees the current value.
  const noBoardStreakRef = useRef(0);
  const activeSessionStartRef = useRef<number | null>(null);

  // Ref for the root wrapper — observed by ResizeObserver to auto-resize the window
  const rootRef = useRef<HTMLDivElement>(null);

  // ResizeObserver: report rendered content height to main process whenever it changes
  useEffect(() => {
    const api = window.widgetAPI;
    if (!api?.reportContentHeight) return;
    const el = rootRef.current;
    if (!el) return;

    let rafId: number | null = null;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(() => {
        rafId = null;
        api.reportContentHeight(entry.contentRect.height);
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const api = window.widgetAPI;
    if (!api) return;

    let cancelled = false;
    let retryTimer: number | null = null;

    // Set up listeners
    const resetCoachingState = () => {
      setSayThis([]);
      setAskThis([]);
      setCurrentFen(null);
      setDisplayFen(null);
      setCurrentTurn(null);
      setBoardOrientation('white');
      setTurnOverride(null);
      setIsTurnFlipping(false);
      flipPendingRef.current = false;
      flipStartedAtRef.current = 0;
      lastFenBoardRef.current = null;
      setEngineSan(undefined);
      setEngineLan(undefined);
      setEngineFrom(undefined);
      setEngineTo(undefined);
      setEngineEval(undefined);
      setEngineMate(undefined);
      noBoardStreakRef.current = 0;
      setForceStartupUi(false);
    };

    const unsubSession = api.onSessionState((state) => {
      setSessionState((prev) => {
        const nextStartTime = state.startTime ?? null;
        const isNewRecordingSession =
          state.isRecording
          && nextStartTime !== null
          && nextStartTime !== activeSessionStartRef.current;

        // Transitioning recording → not recording: clear all coaching state.
        if (prev.isRecording && !state.isRecording) {
          resetCoachingState();
          activeSessionStartRef.current = null;
        }
        // Clear only for a genuinely new capture session. requestInitialState
        // syncs can briefly replay recording state after FEN has arrived; those
        // should not blank the board and make the widget appear stuck/stale.
        if (isNewRecordingSession && lastFenBoardRef.current === null) {
          resetCoachingState();
        }
        if (isNewRecordingSession) {
          activeSessionStartRef.current = nextStartTime;
        }
        return state;
      });
      // Clear connecting state only when recording is actually live.
      // Do NOT clear it just because we received isRecording=false — that is
      // exactly the pre-recording window we want to keep showing.
      if (state.isRecording) {
        setIsConnecting(false);
      }
    });

    const unsubLiveAssist = api.onLiveAssist((data) => {
      setSayThis(data.sayThis);
      setAskThis(data.askThis);
      // Only clear the regenerating spinner when the incoming coaching cards
      // are genuinely newer than the flip — this filters out syncWidgetState
      // replays which re-send the same accumulated state every 500ms.
      if (flipPendingRef.current) {
        const hasNewTip = data.sayThis.some(
          (card) => card.timestamp > flipStartedAtRef.current
        );
        if (hasNewTip) {
          flipPendingRef.current = false;
          setIsTurnFlipping(false);
        }
      }
    });

    const unsubVisual = api.onVisualAnalysis((data) => {
      setVisualDescription(data.description);
    });

    const unsubNudge = api.onNudge((n) => {
      setNudge(n);
    });

    const unsubFen = api.onFen((data) => {
      api.log?.('info', 'App', 'onFen received', {
        fen: data.fen?.slice(0, 40) ?? null,
        displayFen: data.displayFen?.slice(0, 40) ?? null,
        turn: data.turn ?? null,
        boardOrientation: data.boardOrientation ?? null,
        isSync: !!data.isSync,
        isFlipAck: !!data.isFlipAck,
      });
      // Only reset the no-board streak when this is a fresh board detection
      // from the pipeline, not a syncWidgetState replay (isSync: true).
      // Replays fire every ~1 s and would otherwise keep resetting the streak,
      // preventing the no-board fallback from ever triggering.
      if (!data.isSync) {
        noBoardStreakRef.current = 0;
        setForceStartupUi(false);
      }

      setCurrentFen(data.fen);
      setDisplayFen(data.displayFen);
      setCurrentTurn(data.turn);
      if (data.boardOrientation) {
        setBoardOrientation(data.boardOrientation);
      }
      // Only reset the turn override when the board position itself changes.
      const incomingBoard = data.fen.split(' ')[0] ?? null;
      const boardChanged = incomingBoard !== lastFenBoardRef.current;
      if (boardChanged) {
        lastFenBoardRef.current = incomingBoard;
        setTurnOverride(null);
        flipPendingRef.current = false;
        setIsTurnFlipping(false);
        setSayThis([]);
        setAskThis([]);
      }
      // Do NOT clear isTurnFlipping here — wait for the coaching tip (onLiveAssist)
      // which signals the full regeneration is done. Clearing on fen events makes the
      // spinner disappear as soon as the fast engine result arrives, before the tip.
      setEngineSan(data.engineSan);
      setEngineLan(data.engineLan);
      setEngineFrom(data.engineFrom);
      setEngineTo(data.engineTo);
      setEngineEval(data.engineEval);
      setEngineMate(data.engineMate);
    });

    const unsubStartError = api.onStartError?.((data) => {
      // Stop polling and surface the error in the overlay
      cancelled = true;
      if (retryTimer) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
      setConnectingError(data.message);
    }) ?? (() => {});

    // Count consecutive NO_BOARD frames. Each frame where the LLM sees no
    // board increments the streak; any valid fen event resets it (above).
    // After 3 consecutive no-board frames the overlay reverts to startup UI.
    const NO_BOARD_THRESHOLD = 3;
    const unsubNoBoard = api.onNoBoard?.(() => {
      noBoardStreakRef.current += 1;
      if (noBoardStreakRef.current >= NO_BOARD_THRESHOLD) {
        setForceStartupUi(true);
      }
    }) ?? (() => {});

    // Keep polling requestInitialState until the main process responds.
    // No retry cap — we stay in the connecting state until isRecording fires.
    // Each call is cheap (IPC ping); we stop as soon as cancelled.
    const requestStateUntilRecording = () => {
      void api.requestInitialState();

      retryTimer = window.setTimeout(() => {
        if (!cancelled) {
          requestStateUntilRecording();
        }
      }, 500);
    };

    requestStateUntilRecording();

    return () => {
      cancelled = true;
      if (retryTimer) {
        window.clearTimeout(retryTimer);
      }
      unsubSession();
      unsubLiveAssist();
      unsubVisual();
      unsubNudge();
      unsubFen();
      unsubStartError();
      unsubNoBoard();
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

  const handleFlipTurn = useCallback(() => {
    setTurnOverride((prev) => {
      const base = prev ?? currentTurn;
      if (base === null) return null;
      return base === 'w' ? 'b' : 'w';
    });
    // Immediately clear stale engine output and coaching tip so the overlay
    // enters its loading state and the user sees the regenerating indicator
    // rather than stale content from the previous turn.
    setEngineSan(undefined);
    setEngineLan(undefined);
    setEngineFrom(undefined);
    setEngineTo(undefined);
    setEngineEval(undefined);
    setEngineMate(undefined);
    setSayThis([]);
    setAskThis([]);
    setIsTurnFlipping(true);
    flipPendingRef.current = true;
    flipStartedAtRef.current = Date.now();
    window.widgetAPI?.flipTurn().catch(() => {
      setIsTurnFlipping(false);
      flipPendingRef.current = false;
    });
  }, [currentTurn]);

  return (
    <div
      ref={rootRef}
      style={{ width: '100%' }}
    >
      <PairCompactOverlay
        sessionState={sessionState}
        sayThis={sayThis}
        askThis={askThis}
        visualDescription={visualDescription}
        nudge={nudge}
        currentFen={currentFen}
        displayFen={displayFen}
        currentTurn={turnOverride ?? currentTurn}
        boardOrientation={boardOrientation}
        engineSan={engineSan}
        engineLan={engineLan}
        engineFrom={engineFrom}
        engineTo={engineTo}
        engineEval={engineEval}
        engineMate={engineMate}
        onStop={handleStop}
        onPause={handlePause}
        onResume={handleResume}
        onMuteMic={handleMuteMic}
        onUnmuteMic={handleUnmuteMic}
        onDismissCard={handleDismissCard}
        onDismissNudge={handleDismissNudge}
        onFlipTurn={handleFlipTurn}
        isRegenerating={isTurnFlipping}
        stopDisabled={isStopping}
        statusText={
          forceStartupUi
            ? 'No chess board detected. Move your chess tab back into focus.'
            : (isConnecting || connectingError)
              ? 'Connecting to VideoDB and starting screen capture...'
              : undefined
        }
        connectingError={connectingError}
        forceStartupUi={forceStartupUi}
      />
    </div>
  );
}
