/**
 * PairCompactOverlay Stories
 *
 * Visual regression / design review stories for the chess coaching overlay.
 * Run with:  npm run storybook
 *
 * These stories mock all Electron IPC — window.widgetAPI is never called
 * during render, only on button clicks, so no special setup is needed.
 */
import type { Meta, StoryObj } from '@storybook/react';
import { PairCompactOverlay, CoachingChatView } from './PairCompactOverlay';

// ── Shared fixtures ─────────────────────────────────────────────────────────

const RECORDING_STATE = {
  isRecording: true,
  isPaused: false,
  isMicMuted: false,
  startTime: Date.now() - 65_000,
  gameId: 'chess',
};

const PAUSED_STATE = { ...RECORDING_STATE, isPaused: true };

// A mid-game FEN (Ruy López)
const SAMPLE_FEN = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';

// Engine-prefixed interim tip — raw engineSummary (real format from continuationArr)
const ENGINE_TEXT_CARD = {
  id: 'eng-1',
  text: 'engine: Best move SAN: c5 | Best move LAN: c7c5 | Eval: -0.18 | Top lines: 1. c5 (eval -0.18) | 2. d4c5 | 3. d8a5',
  timestamp: Date.now() - 4000,
};

// LLM coaching tip — arrives after the engine text
const COACHING_TIP_CARD = {
  id: 'say-1',
  text: 'Consider castling kingside to connect your rooks and improve king safety before launching a central attack.',
  timestamp: Date.now() - 2000,
};

const noop = () => {};

// ── Meta ─────────────────────────────────────────────────────────────────────

const meta: Meta<typeof PairCompactOverlay> = {
  title: 'Widget/PairCompactOverlay',
  component: PairCompactOverlay,
  parameters: {
    layout: 'centered',
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark', value: '#1a1a2e' },
        { name: 'light', value: '#f0f0f0' },
      ],
    },
  },
  decorators: [
    (Story) => (
      <div style={{ width: 400, fontFamily: 'Inter, sans-serif' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    sessionState: RECORDING_STATE,
    sayThis: [],
    askThis: [],
    visualDescription: '',
    nudge: null,
    currentFen: null,
    displayFen: null,
    currentTurn: null,
    onStop: noop,
    onPause: noop,
    onResume: noop,
    onMuteMic: noop,
    onUnmuteMic: noop,
    onDismissCard: noop,
    onDismissNudge: noop,
    stopDisabled: false,
    statusText: undefined,
    connectingError: null,
  },
};

export default meta;
type Story = StoryObj<typeof PairCompactOverlay>;

// ── Stories ──────────────────────────────────────────────────────────────────

/**
 * Scanning — recording started, no FEN/engine data yet.
 */
export const Scanning: Story = {
  name: 'Scanning (no content yet)',
};

/**
 * Board only — FEN received, no engine data.
 */
export const BoardOnly: Story = {
  name: 'Board only (no engine yet)',
  args: {
    currentFen: SAMPLE_FEN,
    displayFen: SAMPLE_FEN,
    currentTurn: 'w',
  },
};

/**
 * BEST MOVE above, coaching tip spinner below.
 * Engine result arrived but LLM tip is still loading.
 * Expected layout:
 *   1. Chess board
 *   2. BEST MOVE block (green Nc3, +0.42 badge)   ← above tip
 *   3. Coaching tip card (spinner "COACHING TIP INCOMING...")
 *   (no engine text yet — tip not arrived)
 */
export const BestMoveWhileTipLoading: Story = {
  name: 'Best move above tip (tip loading)',
  args: {
    currentFen: SAMPLE_FEN,
    displayFen: SAMPLE_FEN,
    currentTurn: 'w',
    sayThis: [ENGINE_TEXT_CARD], // engine: card only, no LLM tip yet
    engineSan: 'Nc3',
    engineEval: 0.42,
    engineMate: null,
  },
};

/**
 * KEY STORY — Full layout after LLM tip arrives.
 * Expected layout:
 *   1. Chess board
 *   2. BEST MOVE block (green Nc3, +0.42 badge)
 *   3. Coaching tip card (LLM text)
 *   4. Engine card: gear icon + "Engine" label + analysis text   ← matches SVG design
 */
export const FullLayoutAfterTipArrives: Story = {
  name: 'Full layout: best move → tip → engine text',
  args: {
    currentFen: SAMPLE_FEN,
    displayFen: SAMPLE_FEN,
    currentTurn: 'w',
    // Both cards present: LLM tip first (newer timestamp), engine card second
    sayThis: [COACHING_TIP_CARD, ENGINE_TEXT_CARD],
    engineSan: 'Nc3',
    engineEval: 0.42,
    engineMate: null,
  },
};

/**
 * No engine text card — only the LLM coaching tip arrived.
 * The engine output section should NOT appear.
 * Expected layout:
 *   1. Chess board
 *   2. BEST MOVE block
 *   3. Coaching tip card
 *   (no engine text card below)
 */
export const TipWithoutEngineText: Story = {
  name: 'Tip arrived, no engine text card',
  args: {
    currentFen: SAMPLE_FEN,
    displayFen: SAMPLE_FEN,
    currentTurn: 'w',
    sayThis: [COACHING_TIP_CARD], // LLM tip only, no engine: prefixed card
    engineSan: 'Nc3',
    engineEval: 0.42,
    engineMate: null,
  },
};

/**
 * Mate in N — engineMate badge shows "M3".
 */
export const MateInThree: Story = {
  name: 'Mate in 3 (M3 badge)',
  args: {
    currentFen: SAMPLE_FEN,
    displayFen: SAMPLE_FEN,
    currentTurn: 'w',
    sayThis: [
      { id: 'say-m3', text: 'You have a forced checkmate in three moves. Queen to h5 starts the sequence.', timestamp: Date.now() - 1000 },
      { id: 'eng-m3', text: 'engine: Best move SAN: Qh5 | Best move LAN: d1h5 | Mate: 3 | Top lines: 1. Qh5 (mate 3) | 2. h7h6 | 3. h5f7', timestamp: Date.now() - 5000 },
    ],
    engineSan: 'Qh5',
    engineEval: undefined,
    engineMate: 3,
  },
};

/**
 * Pre-recording: Connecting…
 */
export const Connecting: Story = {
  name: 'Pre-recording: Connecting…',
  args: {
    sessionState: { ...RECORDING_STATE, isRecording: false, startTime: null },
    statusText: 'Connecting to VideoDB and starting screen capture...',
    connectingError: null,
  },
};

/**
 * Pre-recording: Start error (red error card).
 */
export const StartError: Story = {
  name: 'Pre-recording: Start error',
  args: {
    sessionState: { ...RECORDING_STATE, isRecording: false, startTime: null },
    statusText: 'Connecting to VideoDB and starting screen capture...',
    connectingError: 'CaptureClient.startSession failed: session not found or expired. Please regenerate the session.',
  },
};

/**
 * Paused state.
 */
export const Paused: Story = {
  name: 'Paused',
  args: {
    sessionState: PAUSED_STATE,
    currentFen: SAMPLE_FEN,
    displayFen: SAMPLE_FEN,
    currentTurn: 'b',
    sayThis: [
      { id: 'say-p', text: 'Game paused. Consider your next moves carefully.', timestamp: Date.now() - 10_000 },
    ],
    engineSan: 'd5',
    engineEval: -0.3,
    engineMate: null,
  },
};

// ── CoachingChatView stories ─────────────────────────────────────────────────

const chatMeta: Meta<typeof CoachingChatView> = {
  title: 'Widget/CoachingChatView',
  component: CoachingChatView,
  parameters: {
    layout: 'centered',
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark', value: '#1a1a2e' },
        { name: 'light', value: '#f0f0f0' },
      ],
    },
  },
  decorators: [
    (Story) => (
      <div style={{ width: 400, fontFamily: 'Inter, sans-serif' }}>
        <Story />
      </div>
    ),
  ],
};

// We can't export two default exports from one module, so we export the
// CoachingChatView stories as named exports attached to the main meta.
// Storybook picks them up automatically.

type ChatStory = StoryObj<typeof CoachingChatView>;

/**
 * Chat panel just opened — coach greeting, no user messages yet.
 * Matches the Figma "Coaching – chat opened" spec.
 */
export const ChatOpenInitial: ChatStory = {
  name: 'Chat — initial greeting',
  render: (args) => <CoachingChatView {...args} />,
  args: {
    displayFen: SAMPLE_FEN,
    engineSan: 'c7c5',
    engineEvalLabel: 'Best',
    suggestionText:
      'If White pushes d4, you can trade into a balanced structure and activate your queenside pieces.',
    coachGreeting: 'Position loaded. What do you want to know about c7c5?',
    chatMessages: [],
    chatLoading: false,
    chatInputValue: '',
    elapsed: '01:05',
    stopDisabled: false,
  },
};

/**
 * User asked a question, coach is replying.
 */
export const ChatWithConversation: ChatStory = {
  name: 'Chat — with conversation',
  render: (args) => <CoachingChatView {...args} />,
  args: {
    displayFen: SAMPLE_FEN,
    engineSan: 'c7c5',
    engineEvalLabel: '-0.18',
    suggestionText:
      'If White pushes d4, you can trade into a balanced structure and activate your queenside pieces.',
    coachGreeting: 'Position loaded. What do you want to know about c7c5?',
    chatMessages: [
      { role: 'user', text: 'Why is c7c5 the best move here?' },
      {
        role: 'assistant',
        text: 'c7-c5 challenges White\'s central pawn on d4, prevents e4-d5 space gains, and opens the c-file for your rook. It\'s the Sicilian setup — fighting for central control from the flank.',
      },
    ],
    chatLoading: false,
    chatInputValue: '',
    elapsed: '02:14',
    stopDisabled: false,
  },
};

/**
 * Coach reply loading (three dots).
 */
export const ChatLoading: ChatStory = {
  name: 'Chat — coach reply loading',
  render: (args) => <CoachingChatView {...args} />,
  args: {
    displayFen: SAMPLE_FEN,
    engineSan: 'c7c5',
    engineEvalLabel: '-0.18',
    suggestionText: 'If White pushes d4, you can trade into a balanced structure.',
    coachGreeting: 'Position loaded. What do you want to know about c7c5?',
    chatMessages: [{ role: 'user', text: 'Why is c7c5 the best move here?' }],
    chatLoading: true,
    chatInputValue: '',
    elapsed: '01:42',
    stopDisabled: false,
  },
};

/**
 * Input bar has text typed — send button turns dark.
 */
export const ChatWithInputTyped: ChatStory = {
  name: 'Chat — text typed in input',
  render: (args) => <CoachingChatView {...args} />,
  args: {
    displayFen: SAMPLE_FEN,
    engineSan: 'c7c5',
    engineEvalLabel: 'Best',
    suggestionText: 'If White pushes d4, you can trade into a balanced structure.',
    coachGreeting: 'Position loaded. What do you want to know about c7c5?',
    chatMessages: [],
    chatLoading: false,
    chatInputValue: 'What if my opponent plays d4?',
    elapsed: '01:05',
    stopDisabled: false,
  },
};

