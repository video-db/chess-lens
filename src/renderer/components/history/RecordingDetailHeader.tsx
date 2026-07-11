import { useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  Check,
  Clock,
  Link2,
  Loader2,
  Swords,
  Upload,
  Video,
} from 'lucide-react';
import { trpc } from '../../api/trpc';
import { cn, formatDate, formatDurationMinutes, rendererLog } from '../../lib/utils';

interface RecordingDetailHeaderProps {
  title: string;
  recordingId: number;
  createdAt: string;
  duration: number | null;
  moveCount: number | null | undefined;
  playerUrl: string | null | undefined;
  onBack: () => void;
}

export function RecordingDetailHeader({
  title,
  recordingId,
  createdAt,
  duration,
  moveCount,
  playerUrl,
  onBack,
}: RecordingDetailHeaderProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied'>('idle');
  const [exportOpen, setExportOpen] = useState(false);
  const [downloadingVideo, setDownloadingVideo] = useState(false);
  const downloadVideoMutation = trpc.recordings.downloadVideo.useMutation();

  const handleCopyLink = async () => {
    if (!playerUrl || copyState !== 'idle') return;
    setCopyState('copying');
    await navigator.clipboard.writeText(playerUrl);
    setCopyState('copied');
    setTimeout(() => setCopyState('idle'), 2000);
  };

  const handleDownloadVideo = async () => {
    setDownloadingVideo(true);
    setExportOpen(false);
    try {
      const result = await downloadVideoMutation.mutateAsync({ recordingId });
      window.open(result.downloadUrl, '_blank');
    } catch (error) {
      rendererLog('error', 'recording-detail', 'Failed to download video', {
        recordingId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setDownloadingVideo(false);
    }
  };

  return (
    <div className="flex gap-[12px] items-start" style={{ padding: '30px 20px 20px' }}>
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
            {title}
          </h1>
          <div className="flex items-center gap-[20px]">
            <div className="flex items-center gap-[4px]">
              <Calendar className="h-4 w-4 text-text-body opacity-20" />
              <span className="text-[13px] text-text-body" style={{ letterSpacing: '0.005em' }}>{formatDate(createdAt)}</span>
            </div>
            {duration && (
              <div className="flex items-center gap-[4px]">
                <Clock className="h-4 w-4 text-text-body opacity-20" />
                <span className="text-[13px] text-text-body" style={{ letterSpacing: '0.005em' }}>{formatDurationMinutes(duration)}</span>
              </div>
            )}
            <div className="flex items-center gap-[4px]">
              <Swords className="h-4 w-4 text-text-body opacity-20" />
              <span className="text-[13px] text-text-body" style={{ letterSpacing: '0.005em' }}>
                {moveCount != null ? `${moveCount} Moves` : '- Moves'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-[12px] items-start">
        <div className="relative">
          <button
            onClick={() => setExportOpen(!exportOpen)}
            disabled={downloadingVideo}
            className="flex items-center gap-[6px] bg-white border border-border-default hover:bg-surface-muted transition-colors"
            style={{ borderRadius: 12, padding: '12px 20px 12px 16px', boxShadow: '0px 1.27px 15.27px rgba(0,0,0,0.05)' }}
          >
            {downloadingVideo ? <Loader2 className="h-5 w-5 text-black animate-spin" /> : <Upload className="h-5 w-5 text-black" />}
            <span className="text-[14px] font-semibold text-black" style={{ letterSpacing: '-0.02em' }}>Export</span>
          </button>
          {exportOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
              <div className="absolute right-0 top-full mt-2 z-20 bg-white border border-border-default rounded-[12px] p-[8px] min-w-[180px]" style={{ boxShadow: '0px 17px 17px rgba(0,0,0,0.12)' }}>
                <button
                  onClick={handleDownloadVideo}
                  className="w-full flex items-center gap-[6px] px-[10px] py-[8px] rounded-[10px] hover:bg-surface-muted transition-colors"
                >
                  <Video className="h-5 w-5 text-black" />
                  <span className="text-[13px] font-medium text-black">Video</span>
                </button>
              </div>
            </>
          )}
        </div>

        <button
          onClick={handleCopyLink}
          disabled={!playerUrl || copyState !== 'idle'}
          className={cn(
            'flex items-center gap-[4px] transition-colors',
            copyState === 'copied' ? 'bg-[#007657]' : 'bg-brand-cta hover:bg-brand-cta-hover',
            !playerUrl && 'opacity-50 cursor-not-allowed'
          )}
          style={{ borderRadius: 12, padding: '12px 20px', boxShadow: '0px 1.27px 15.27px rgba(0,0,0,0.05)', isolation: 'isolate' }}
        >
          {copyState === 'copied' ? <Check className="h-5 w-5 text-white" /> :
           copyState === 'copying' ? <Loader2 className="h-5 w-5 text-white animate-spin" /> :
           <Link2 className="h-5 w-5 text-white" />}
          <span className="text-[14px] font-semibold text-white" style={{ letterSpacing: '-0.02em' }}>
            {copyState === 'copied' ? 'Link copied!' : copyState === 'copying' ? 'Creating link...' : 'Copy video link'}
          </span>
        </button>
      </div>
    </div>
  );
}
