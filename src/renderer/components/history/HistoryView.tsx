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
                {/* Icon — chess knight from Figma */}
                <svg width="68" height="68" viewBox="0 0 68 68" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="0.85" y="0.85" width="66.3" height="66.3" rx="33.15" fill="#F7F7F7"/>
                  <rect x="0.85" y="0.85" width="66.3" height="66.3" rx="33.15" stroke="#EFEFEF" strokeWidth="1.7"/>
                  <path opacity="0.2" d="M46 34.1712C45.91 40.6062 40.6787 45.87 34.2437 45.9975C32.6289 46.0341 31.0227 45.7511 29.5175 45.165L34 39C30.67 37 26.8462 37.5875 24.6625 37.9575C24.1087 38.0515 23.5397 37.9882 23.0202 37.7747C22.5006 37.5612 22.0514 37.2062 21.7238 36.75L20 34L33 26V22H34C35.5904 21.9998 37.1649 22.3158 38.6321 22.9295C40.0993 23.5433 41.4298 24.4425 42.5464 25.575C43.663 26.7076 44.5433 28.0507 45.1362 29.5264C45.7291 31.0022 46.0227 32.581 46 34.1712Z" fill="#464646"/>
                  <path d="M35 30.5C35 30.7967 34.912 31.0867 34.7472 31.3334C34.5824 31.58 34.3481 31.7723 34.074 31.8858C33.7999 31.9994 33.4983 32.0291 33.2073 31.9712C32.9164 31.9133 32.6491 31.7704 32.4393 31.5607C32.2295 31.3509 32.0867 31.0836 32.0288 30.7926C31.9709 30.5017 32.0006 30.2001 32.1142 29.926C32.2277 29.6519 32.4199 29.4176 32.6666 29.2528C32.9133 29.088 33.2033 29 33.5 29C33.8978 29 34.2793 29.158 34.5606 29.4393C34.8419 29.7206 35 30.1022 35 30.5ZM47 34.185C46.9437 37.5528 45.586 40.7682 43.2115 43.1572C40.837 45.5461 37.6299 46.9233 34.2625 47H33.9912C30.8032 47.0224 27.7195 45.8648 25.3337 43.75C25.1348 43.5731 25.0143 43.3245 24.9987 43.0588C24.991 42.9272 25.0093 42.7954 25.0525 42.6709C25.0957 42.5464 25.163 42.4316 25.2506 42.3331C25.3382 42.2346 25.4443 42.1544 25.5629 42.0969C25.6815 42.0394 25.8102 42.0058 25.9418 41.9981C26.2075 41.9825 26.4686 42.0731 26.6675 42.25C27.4209 42.9242 28.267 43.487 29.18 43.9212L32.5 39.355C29.6525 38.1262 26.5662 38.6488 24.825 38.9438C24.088 39.071 23.3301 38.9881 22.6381 38.7044C21.9461 38.4208 21.3481 37.9479 20.9125 37.34L20.875 37.2862L19.1525 34.5362C19.0826 34.4244 19.0356 34.2999 19.014 34.1698C18.9925 34.0397 18.9969 33.9066 19.027 33.7783C19.0571 33.6499 19.1123 33.5287 19.1894 33.4218C19.2665 33.3148 19.3639 33.2241 19.4762 33.155L32 25.4412V22C32 21.7348 32.1053 21.4804 32.2929 21.2929C32.4804 21.1054 32.7348 21 33 21H34C35.7228 20.9998 37.4285 21.3421 39.018 22.007C40.6074 22.6718 42.0488 23.646 43.2584 24.8728C44.468 26.0996 45.4217 27.5546 46.064 29.1533C46.7063 30.7519 47.0245 32.4623 47 34.185ZM45 34.1575C45.0208 32.6998 44.7517 31.2524 44.2083 29.8996C43.6648 28.5468 42.8579 27.3155 41.8344 26.2773C40.8108 25.2391 39.5911 24.4148 38.2462 23.8521C36.9012 23.2895 35.4579 22.9999 34 23V26C33.9999 26.1707 33.956 26.3386 33.8727 26.4876C33.7893 26.6366 33.6692 26.7618 33.5237 26.8512L21.3825 34.3237L22.5525 36.1987C22.7731 36.4959 23.0723 36.7256 23.4163 36.862C23.7604 36.9985 24.1356 37.0363 24.5 36.9713C26.5 36.6338 30.5962 35.9412 34.2587 37.9937C35.5377 37.9256 36.742 37.37 37.6239 36.4412C38.5058 35.5123 38.9983 34.2808 39 33C39 32.7348 39.1053 32.4804 39.2929 32.2929C39.4804 32.1054 39.7348 32 40 32C40.2652 32 40.5195 32.1054 40.7071 32.2929C40.8946 32.4804 41 32.7348 41 33C40.9975 34.7648 40.3294 36.4637 39.1291 37.7574C37.9288 39.0511 36.2846 39.8444 34.525 39.9788L31.1362 44.6388C32.1436 44.8999 33.182 45.0215 34.2225 45C37.0712 44.9336 39.7838 43.768 41.7926 41.7471C43.8014 39.7261 44.9507 37.0065 45 34.1575Z" fill="#464646"/>
                </svg>

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
