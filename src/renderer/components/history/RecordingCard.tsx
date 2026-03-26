import React from 'react';
import { Calendar, Clock, CheckCircle2, AlertTriangle, Loader2, Circle, Copy, ExternalLink } from 'lucide-react';
import type { Recording } from '../../../shared/schemas/recording.schema';
import { formatDate, formatDurationMinutes, stripMarkdown, cn } from '../../lib/utils';
import { Tooltip } from '../ui/Tooltip';

// Generate the call_md folder path for a recording
function getCallMdPath(recording: Recording): string {
  const date = new Date(recording.createdAt);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const name = (recording.meetingName || 'untitled-meeting')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 100);

  return `~/.call_md/meetings/${year}/${month}/${day}/${name}`;
}

interface RecordingCardProps {
  recording: Recording;
  onClick: () => void;
}

type RecordingStatus = 'recording' | 'processing' | 'available' | 'failed';

interface StatusConfig {
  label: string;
  bgColor: string;
  hoverBg: string;
  hoverBorder: string;
  icon: React.ReactNode;
}

const statusConfigs: Record<RecordingStatus, StatusConfig> = {
  recording: {
    label: 'Recording',
    bgColor: 'bg-[#3b82f6]',
    hoverBg: 'hover:bg-[#eff6ff]',
    hoverBorder: 'hover:border-[#93c5fd]',
    icon: <Circle className="h-4 w-4 fill-current" />,
  },
  processing: {
    label: 'Processing',
    bgColor: 'bg-[#eab308]',
    hoverBg: 'hover:bg-[#fefce8]',
    hoverBorder: 'hover:border-[#fde047]',
    icon: <Loader2 className="h-4 w-4 animate-spin" />,
  },
  available: {
    label: 'Done',
    bgColor: 'bg-[#559e58]',
    hoverBg: 'hover:bg-[#f0fdf4]',
    hoverBorder: 'hover:border-[#86efac]',
    icon: <CheckCircle2 className="h-4 w-4" />,
  },
  failed: {
    label: 'Error',
    bgColor: 'bg-[#ef4444]',
    hoverBg: 'hover:bg-[#fef2f2]',
    hoverBorder: 'hover:border-[#fca5a5]',
    icon: <AlertTriangle className="h-4 w-4" />,
  },
};

function StatusBadge({ status }: { status: RecordingStatus }) {
  const config = statusConfigs[status] || statusConfigs.available;

  return (
    <div
      className={cn(
        'inline-flex w-fit items-center gap-[4px] pl-[6px] pr-[8px] py-[4px] rounded-[36px] text-white text-[13px] font-medium leading-[1.5]',
        config.bgColor
      )}
    >
      {config.icon}
      <span>{config.label}</span>
    </div>
  );
}

function CopyPathButton({ recording }: { recording: Recording }) {
  const isDisabled = recording.status === 'recording' || recording.status === 'failed';
  const path = getCallMdPath(recording);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDisabled) return;

    // Copy the path with ~ prefix (user can expand it)
    navigator.clipboard.writeText(path);
  };

  if (isDisabled) {
    return (
      <button
        disabled
        className="w-[24px] h-[24px] flex items-center justify-center rounded opacity-10 cursor-not-allowed"
      >
        <Copy className="w-[16px] h-[16px] text-[#464646]" />
      </button>
    );
  }

  return (
    <Tooltip content="Copy folder path">
      <button
        onClick={handleClick}
        className="w-[24px] h-[24px] flex items-center justify-center rounded opacity-60 hover:opacity-100 cursor-pointer transition-opacity"
      >
        <Copy className="w-[16px] h-[16px] text-[#464646]" />
      </button>
    </Tooltip>
  );
}

function OpenFolderButton({ recording }: { recording: Recording }) {
  const isDisabled = recording.status === 'recording' || recording.status === 'failed';
  const path = getCallMdPath(recording);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDisabled) return;

    // Use shell.openPath via IPC - the main process will resolve ~ to home dir
    try {
      await window.electronAPI?.app?.openCallMdFolder?.(path);
    } catch (err) {
      console.error('Failed to open folder:', err);
    }
  };

  if (isDisabled) {
    return (
      <button
        disabled
        className="w-[24px] h-[24px] flex items-center justify-center rounded opacity-10 cursor-not-allowed"
      >
        <ExternalLink className="w-[16px] h-[16px] text-[#464646]" />
      </button>
    );
  }

  return (
    <Tooltip content="Open folder">
      <button
        onClick={handleClick}
        className="w-[24px] h-[24px] flex items-center justify-center rounded opacity-60 hover:opacity-100 cursor-pointer transition-opacity"
      >
        <ExternalLink className="w-[16px] h-[16px] text-[#464646]" />
      </button>
    </Tooltip>
  );
}

export function RecordingCard({ recording, onClick }: RecordingCardProps) {
  const config = statusConfigs[recording.status] || statusConfigs.available;

  // Get the title - prefer meetingName, fallback to date-based title
  const title = recording.meetingName || `Recording - ${formatDate(recording.createdAt)}`;

  // Get the description - prefer shortOverview, fallback to insights
  const getDescription = (): string => {
    if (recording.shortOverview) {
      return recording.shortOverview;
    }
    if (recording.insights) {
      return stripMarkdown(recording.insights);
    }
    if (recording.meetingDescription) {
      return recording.meetingDescription;
    }
    return 'No summary available yet.';
  };

  const description = getDescription();

  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-[#f7f7f7] border border-[#efefef] rounded-[16px] pt-[20px] pb-[24px] px-[20px] cursor-pointer',
        'transition-all duration-200',
        'flex flex-col gap-[20px] h-full',
        config.hoverBg,
        config.hoverBorder
      )}
    >
      {/* Header Section */}
      <div className="flex flex-col gap-[10px]">
        {/* Status Badge and Action Buttons */}
        <div className="flex items-start justify-between">
          <StatusBadge status={recording.status} />
          <div className="flex items-center gap-[8px]">
            <CopyPathButton recording={recording} />
            <OpenFolderButton recording={recording} />
          </div>
        </div>

        {/* Title */}
        <h3 className="text-[18px] font-medium text-black tracking-[0.09px] line-clamp-1">
          {title}
        </h3>

        {/* Metadata Row */}
        <div className="flex items-center gap-[20px]">
          {/* Date */}
          <div className="flex items-center gap-[4px]">
            <Calendar className="h-4 w-4 text-[#969696]" />
            <span className="text-[13px] text-[#464646] tracking-[0.065px]">
              {formatDate(recording.createdAt)}
            </span>
          </div>

          {/* Duration */}
          {recording.duration && (
            <div className="flex items-center gap-[8px]">
              <Clock className="h-4 w-4 text-[#969696]" />
              <span className="text-[13px] text-[#464646] tracking-[0.065px]">
                {formatDurationMinutes(recording.duration)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      <p className="text-[13px] text-[#2d2d2d] leading-[18px] tracking-[0.065px] line-clamp-4">
        {description}
      </p>
    </div>
  );
}
