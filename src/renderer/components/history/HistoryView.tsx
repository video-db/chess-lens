import React, { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { RecordingCard } from './RecordingCard';
import { RecordingDetailPage } from './RecordingDetailPage';
import { trpc } from '../../api/trpc';
import { useSessionStore } from '../../stores/session.store';

interface HistoryViewProps {
  initialSelectedRecordingId?: number | null;
  onClearInitialSelection?: () => void;
  onStartRecording?: () => void;
}

export function HistoryView({ initialSelectedRecordingId, onClearInitialSelection, onStartRecording }: HistoryViewProps = {}) {
  const [selectedRecordingId, setSelectedRecordingId] = useState<number | null>(initialSelectedRecordingId ?? null);
  const [searchQuery, setSearchQuery] = useState('');
  const [hasCleanedUp, setHasCleanedUp] = useState(false);

  const activeSessionId = useSessionStore((state) => state.sessionId);

  useEffect(() => {
    if (initialSelectedRecordingId != null) {
      setSelectedRecordingId(initialSelectedRecordingId);
      onClearInitialSelection?.();
    }
  }, [initialSelectedRecordingId, onClearInitialSelection]);

  const { data: recordings, isLoading, refetch } = trpc.recordings.list.useQuery(
    undefined, { refetchInterval: 10000 }
  );

  const cleanupMutation = trpc.recordings.cleanupStale.useMutation({
    onSuccess: (result) => { if (result.cleaned > 0) refetch(); },
  });

  useEffect(() => {
    if (!hasCleanedUp && recordings) {
      const staleCount = recordings.filter(
        r => (r.status === 'processing' || r.status === 'recording') && r.sessionId !== activeSessionId
      ).length;
      if (staleCount > 0) cleanupMutation.mutate({ maxAgeMinutes: 0, excludeSessionId: activeSessionId || undefined });
      setHasCleanedUp(true);
    }
  }, [recordings, hasCleanedUp, activeSessionId]);

  const allRecordings = useMemo(() =>
    [...(recordings || [])].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ),
    [recordings]
  );

  const filteredRecordings = useMemo(() => {
    if (!searchQuery.trim()) return allRecordings;
    const q = searchQuery.toLowerCase();
    return allRecordings.filter((r) =>
      r.meetingName?.toLowerCase().includes(q) ||
      r.shortOverview?.toLowerCase().includes(q)
    );
  }, [allRecordings, searchQuery]);

  if (selectedRecordingId !== null) {
    return <RecordingDetailPage recordingId={selectedRecordingId} onBack={() => setSelectedRecordingId(null)} />;
  }

  const hasRecordings = allRecordings.length > 0;

  // ── Record icon SVG ──────────────────────────────────────────────────────────
  const RecordIcon = () => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="10" r="7.5" stroke="white" strokeWidth="1.5"/>
      <circle cx="10" cy="10" r="3.5" fill="white"/>
    </svg>
  );

  return (
    <div className="h-full flex flex-col bg-surface-muted">
      <div className="flex-1 flex flex-col overflow-hidden px-[10px] pt-[10px] gap-[10px]">

        {/* Header row */}
        <div className="flex items-center gap-[12px] px-[20px] pt-[10px]">
          <h1 className="text-[22px] font-semibold text-black tracking-[0.005em] flex-1">
            Game Library
          </h1>

          {/* Search — only when there are recordings */}
          {hasRecordings && (
            <div className="relative w-[376px]">
              <Search className="absolute left-[10px] top-1/2 -translate-y-1/2 h-[20px] w-[20px] text-text-muted-brand" />
              <input
                type="text"
                placeholder="Search session name, opponent, opening"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-[43px] pl-[34px] pr-[10px] rounded-[12px] border border-[#E1E1E1] bg-white text-[14px] font-normal text-text-label placeholder:text-text-muted-brand focus:outline-none focus:border-border-default transition-colors"
              />
            </div>
          )}

          {/* Start New Game button — only when there are recordings */}
          {hasRecordings && onStartRecording && (
            <button
              onClick={onStartRecording}
              className="flex items-center gap-[4px] px-[20px] h-[44px] bg-brand-cta hover:bg-brand-cta-hover rounded-[12px] text-[14px] font-semibold text-white transition-colors shadow-[0px_1.27px_15.27px_rgba(0,0,0,0.05)] flex-shrink-0"
            >
              <RecordIcon />
              <span>Start New Game</span>
            </button>
          )}
        </div>

        {/* Main container */}
        <div className="flex-1 flex flex-col mx-0 mb-0 bg-white border border-border-default rounded-[20px_20px_0px_0px] overflow-hidden">

          {isLoading ? (
            <div className="flex items-center justify-center flex-1">
              <RefreshCw className="h-6 w-6 animate-spin text-text-muted-brand" />
            </div>

          ) : !hasRecordings ? (
            /* ── Empty state: centered Dialog card per Figma ── */
            <div className="flex-1 flex items-center justify-center p-[20px]">
              <div
                className="flex flex-col items-center gap-[20px] bg-white rounded-[16px] p-[30px]"
                style={{ width: 550 }}
              >
                {/* Icon circle */}
                <div
                  className="flex items-center justify-center flex-shrink-0"
                  style={{
                    width: 68, height: 68,
                    background: '#F7F7F7',
                    border: '1.7px solid #EFEFEF',
                    borderRadius: '50%',
                  }}
                >
                  {/* Inbox / history icon — #464646 with two-vector pattern */}
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M3 3v5h5"
                      stroke="#464646"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={0.2}
                    />
                    <path
                      d="M3.05 13A9 9 0 1 0 6 5.3L3 8"
                      stroke="#464646"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M12 7v5l4 2"
                      stroke="#464646"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>

                {/* Text */}
                <div className="flex flex-col items-center gap-[12px]" style={{ width: 490 }}>
                  <p
                    className="text-[22px] font-medium text-black text-center"
                    style={{ lineHeight: '27px' }}
                  >
                    No games yet. Let's fix that.
                  </p>
                  <p
                    className="text-[14px] font-normal text-text-body text-center"
                    style={{ lineHeight: '150%', maxWidth: 370 }}
                  >
                    Start a session and Chess Lens will coach you through every move — your games will appear here.
                  </p>
                </div>

                {/* Start New Game button */}
                {onStartRecording && (
                  <button
                    onClick={onStartRecording}
                    className="flex items-center gap-[4px] px-[20px] h-[44px] bg-brand-cta hover:bg-brand-cta-hover rounded-[12px] text-[14px] font-semibold text-white transition-colors"
                    style={{ boxShadow: '0px 1.27px 15.27px rgba(0,0,0,0.05)' }}
                  >
                    <RecordIcon />
                    <span>Start New Game</span>
                  </button>
                )}
              </div>
            </div>

          ) : filteredRecordings.length === 0 ? (
            /* ── No search results ── */
            <div className="flex-1 flex flex-col items-center justify-center gap-[12px] p-[20px]">
              <p className="text-[22px] font-medium text-black text-center">No matching recordings</p>
              <p className="text-base text-text-body text-center max-w-[370px]">Try a different search term</p>
            </div>

          ) : (
            /* ── Cards grid ── */
            <div className="flex-1 overflow-y-auto px-[20px] pt-[20px] pb-[20px]">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[20px]">
                {filteredRecordings.map((recording) => (
                  <RecordingCard
                    key={recording.id}
                    recording={recording}
                    onClick={() => setSelectedRecordingId(recording.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
