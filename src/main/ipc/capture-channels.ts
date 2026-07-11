import type { CaptureConfig } from '../../shared/schemas/capture.schema';

export interface CaptureChannelConfig {
  channelId: string;
  type: 'audio' | 'video';
  record: boolean;
  store?: boolean;
  transcript?: boolean;
}

interface ListedChannel {
  id: string;
  name: string;
  type: 'audio' | 'video' | string;
}

interface ListedChannelGroup extends Array<ListedChannel> {
  default?: ListedChannel;
}

export interface ListedChannels {
  all: () => ListedChannel[];
  mics: ListedChannelGroup;
  systemAudio: ListedChannel[];
  displays: ListedChannelGroup;
}

interface ChannelLogger {
  info: (dataOrMessage: unknown, maybeMessage?: string) => void;
  warn: (dataOrMessage: unknown, maybeMessage?: string) => void;
}

export function buildCaptureChannelsFromListed(
  channels: ListedChannels,
  config: CaptureConfig,
  enableTranscription: boolean | undefined,
  logger: ChannelLogger,
): CaptureChannelConfig[] {
  const captureChannels: CaptureChannelConfig[] = [];
  const allChannels = channels.all();

  logChannelInventory(channels, allChannels, logger);

  const micChannel = channels.mics.default || channels.mics[0];
  if (micChannel && config.streams?.microphone !== false) {
    captureChannels.push({
      channelId: micChannel.id,
      type: 'audio',
      record: true,
      store: true,
      transcript: enableTranscription,
    });
  } else if (config.streams?.microphone !== false) {
    logger.warn({ micCount: channels.mics.length }, 'Microphone stream enabled but no mic channel available');
  }

  if (config.streams?.systemAudio !== false) {
    addSystemAudioChannels(captureChannels, channels, allChannels, micChannel?.id, enableTranscription, logger);
  }

  const displayChannel = channels.displays.default || channels.displays[0];
  if (displayChannel && config.streams?.screen !== false) {
    captureChannels.push({
      channelId: displayChannel.id,
      type: 'video',
      record: true,
      store: true,
    });
  } else if (config.streams?.screen !== false) {
    logger.warn({ displayCount: channels.displays.length }, 'Screen stream enabled but no display channel available');
  }

  addWindowsLoopbackDisplayIfNeeded(captureChannels, config, displayChannel, logger);
  logger.info({ captureChannels }, 'Channel configs prepared from listed channels');
  return captureChannels;
}

export function buildFallbackCaptureChannels(
  config: CaptureConfig,
  enableTranscription: boolean | undefined,
): CaptureChannelConfig[] {
  const captureChannels: CaptureChannelConfig[] = [];

  if (config.streams?.microphone !== false) {
    captureChannels.push({ channelId: 'mic', type: 'audio', record: true, store: true, transcript: enableTranscription });
  }
  if (config.streams?.systemAudio !== false) {
    captureChannels.push({ channelId: 'system_audio', type: 'audio', record: true, store: true, transcript: enableTranscription });
  }
  if (config.streams?.screen !== false) {
    captureChannels.push({ channelId: 'screen', type: 'video', record: true, store: true });
  }

  return captureChannels;
}

function logChannelInventory(
  channels: ListedChannels,
  allChannels: ListedChannel[],
  logger: ChannelLogger,
): void {
  logger.info(
    {
      audioChannels: allChannels
        .filter((ch) => ch.type === 'audio')
        .map((ch) => ({ id: ch.id, name: ch.name })),
      systemAudioChannels: channels.systemAudio.map((ch) => ({ id: ch.id, name: ch.name })),
      micChannels: channels.mics.map((ch) => ({ id: ch.id, name: ch.name })),
      displayChannels: channels.displays.map((ch) => ({ id: ch.id, name: ch.name })),
    },
    'Capture channel inventory'
  );
}

function addSystemAudioChannels(
  captureChannels: CaptureChannelConfig[],
  channels: ListedChannels,
  allChannels: ListedChannel[],
  micChannelId: string | undefined,
  enableTranscription: boolean | undefined,
  logger: ChannelLogger,
): void {
  const systemAudioCandidates: Array<{ id: string; name: string }> = [];
  const pushCandidate = (id: string, name: string) => {
    if (!id || id === micChannelId) return;
    if (systemAudioCandidates.some((candidate) => candidate.id === id)) return;
    systemAudioCandidates.push({ id, name });
  };

  for (const ch of channels.systemAudio) {
    pushCandidate(ch.id, ch.name);
  }

  if (process.platform === 'win32') {
    for (const ch of allChannels) {
      if (ch.type !== 'audio') continue;
      if (/system|loopback|speaker|output|desktop|headphone|what\s*u\s*hear|stereo\s*mix|virtual\s*audio/i.test(`${ch.id} ${ch.name}`)) {
        pushCandidate(ch.id, ch.name);
      }
    }
  }

  if (systemAudioCandidates.length > 0) {
    systemAudioCandidates.forEach((candidate, index) => {
      captureChannels.push({
        channelId: candidate.id,
        type: 'audio',
        record: true,
        store: true,
        transcript: enableTranscription && index === 0,
      });
    });
    logger.info({ selectedSystemAudioChannels: systemAudioCandidates }, 'Selected system-audio capture candidates');
    return;
  }

  logger.warn(
    {
      systemAudioCount: channels.systemAudio.length,
      audioChannels: allChannels
        .filter((ch) => ch.type === 'audio')
        .map((ch) => ({ id: ch.id, name: ch.name })),
    },
    'System audio stream enabled but no system-audio channel available; using explicit system_audio fallback'
  );
  captureChannels.push({
    channelId: 'system_audio',
    type: 'audio',
    record: true,
    store: true,
    transcript: enableTranscription,
  });
}

function addWindowsLoopbackDisplayIfNeeded(
  captureChannels: CaptureChannelConfig[],
  config: CaptureConfig,
  displayChannel: ListedChannel | undefined,
  logger: ChannelLogger,
): void {
  const hasSystemAudioChannel = captureChannels.some(
    (ch) => ch.type === 'audio' && /system[_-]?audio|loopback|speaker|output|desktop/i.test(ch.channelId)
  );
  const hasDisplayChannel = captureChannels.some((ch) => ch.type === 'video');
  const wantsSystemAudio = config.streams?.systemAudio !== false;
  const screenDisabled = config.streams?.screen === false;

  if (
    process.platform === 'win32' &&
    wantsSystemAudio &&
    screenDisabled &&
    hasSystemAudioChannel &&
    !hasDisplayChannel &&
    displayChannel
  ) {
    captureChannels.push({
      channelId: displayChannel.id,
      type: 'video',
      record: true,
      store: true,
    });
    logger.info(
      { displayChannelId: displayChannel.id },
      'Added display channel automatically on Windows to support system audio loopback'
    );
  }
}
