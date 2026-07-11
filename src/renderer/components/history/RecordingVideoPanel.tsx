import { useEffect, useState } from 'react';
import { Loader2, MessageCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

export function VideoPlayerSection({
  playerUrl,
  isReady,
  isFailed,
  isProcessing,
  seekTimestamp,
}: {
  playerUrl: string | null | undefined;
  isReady: boolean;
  isFailed?: boolean;
  isProcessing?: boolean;
  seekTimestamp?: number | null;
}) {
  const baseEmbedUrl = playerUrl?.replace('/watch', '/embed');
  const [iframeSrc, setIframeSrc] = useState<string | undefined>(baseEmbedUrl);

  useEffect(() => {
    setIframeSrc(baseEmbedUrl);
  }, [baseEmbedUrl]);

  useEffect(() => {
    if (seekTimestamp == null || !baseEmbedUrl) return;
    const hasQuery = baseEmbedUrl.includes('?');
    setIframeSrc(`${baseEmbedUrl}${hasQuery ? '&' : '?'}t=${seekTimestamp}`);
  }, [seekTimestamp, baseEmbedUrl]);

  const renderInner = () => {
    if (isReady && iframeSrc) {
      return (
        <iframe
          src={iframeSrc}
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      );
    }
    if (isFailed) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-3">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="9" stroke="#969696" strokeWidth="1.5"/>
            <path d="M12 8v4M12 16v.5" stroke="#969696" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <p className="text-[13px] text-text-muted-brand text-center">
            Video export failed
          </p>
          <p className="text-[12px] text-text-muted-brand text-center max-w-[200px]">
            The game analysis is still available below
          </p>
        </div>
      );
    }
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-brand" />
        <p className="text-[14px] text-text-muted-brand">
          {isProcessing ? 'Exporting video...' : 'Loading the video...'}
        </p>
      </div>
    );
  };

  return (
    <div style={{ border: '0.79px solid #EFEFEF', borderRadius: 14.23 }}>
      <div className="aspect-video overflow-hidden bg-[#262522]" style={{ borderRadius: 9.48 }}>
        {renderInner()}
      </div>
    </div>
  );
}

export function ChatWithVideoButton({
  videoId,
  collectionId,
  disabled,
}: {
  videoId: string | null | undefined;
  collectionId: string | null | undefined;
  disabled: boolean;
}) {
  const handleClick = () => {
    if (!videoId || !collectionId) return;
    const chatUrl = `https://chat.videodb.io?video_id=${videoId}&collection_id=${collectionId}`;
    window.electronAPI?.app.openExternalLink(chatUrl);
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled || !videoId || !collectionId}
      className={cn(
        'relative overflow-hidden',
        (disabled || !videoId || !collectionId) && 'opacity-50 cursor-not-allowed'
      )}
      style={{ width: 248, height: 52, borderRadius: 32, boxShadow: '0px 2px 3px rgba(0,0,0,0.18)', filter: 'drop-shadow(0px 2px 3px rgba(0,0,0,0.18))' }}
    >
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(267.98deg, #000000 4.66%, #1E1E1E 99.38%)',
          borderRadius: 32,
          border: '2px solid #494949',
          boxShadow: 'inset 0px 4px 4px rgba(255,255,255,0.32)',
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center gap-[6px]">
        <MessageCircle className="h-5 w-5 text-white" />
        <span className="text-[16px] font-medium text-white" style={{ letterSpacing: '-0.005em' }}>Chat with video</span>
      </div>
    </button>
  );
}
