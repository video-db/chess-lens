/**
 * RecordingDetailPage Stories
 *
 * Storybook for the post-game summary / analysis page.
 *
 * Because RecordingDetailPage fetches all its data via tRPC hooks, it cannot
 * be used directly in Storybook. Instead these stories render the individual
 * pure-presentational sub-components that make up the page, composed into a
 * realistic full-page layout using the same structure as RecordingDetailPage.
 *
 * Run with:  npm run storybook   →   http://localhost:6006
 * Navigate to:  History / RecordingDetailPage
 *
 * ── How to use these stories when making design changes ──
 * 1. Pick the story that most closely matches your target state.
 * 2. Make your changes to RecordingDetailPage.tsx.
 * 3. Refresh Storybook — no need to run the full Electron app.
 * 4. Once the story looks right, the real page will match automatically
 *    because it uses the same components.
 */

import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import {
  ArrowLeft,
  Calendar,
  Clock,
  MessageCircle,
  Upload,
  Link2,
  Send,
  Check,
} from 'lucide-react';
import { classifyStoredMove, MOVE_BADGE, KEY_MOMENT_QUALITIES } from '../../../shared/lib/moveClassification';

// ── Shared mock data ─────────────────────────────────────────────────────────

const MOCK_RECORDING_BASE = {
  id: 1,
  meetingName: 'Magnus Carlsen vs. Gaurav Tyagi',
  createdAt: '2026-05-06T05:30:00.000Z',
  duration: 3840, // 64 minutes
  status: 'available' as const,
  videoId: 'mock-video-id-abc123',
  collectionId: 'mock-collection-id-xyz',
  playerUrl: 'https://console.videodb.io/player?url=mock',
};

const MOCK_SHORT_OVERVIEW = `In this game, Magnus opened with 1.e4 and Gaurav responded with the Sicilian Defense (1...c5). The game quickly transitioned into a Najdorf variation. Magnus demonstrated excellent positional understanding in the middlegame, gradually building pressure on the queenside. A critical moment occurred around move 24 when Gaurav missed a tactical opportunity with ...Rxc3, allowing Magnus to consolidate his advantage. The endgame was converted cleanly with precise rook technique.`;

const MOCK_KEY_POINTS = [
  {
    topic: 'Opening Preparation',
    points: [
      'Gaurav successfully navigated the Najdorf variation showing strong theoretical knowledge up to move 15.',
      'The 9...Nbd7 system was an interesting choice, avoiding the sharper 9...b5 lines.',
    ],
  },
  {
    topic: 'Middlegame Tactics',
    points: [
      'Move 24 presented a missed tactical shot: ...Rxc3! would have equalized immediately.',
      'The exchange sacrifice on move 28 was objectively the best practical try but insufficient against optimal play.',
    ],
  },
  {
    topic: 'Endgame Technique',
    points: [
      'Magnus converted the R+P ending with textbook technique, centralizing the king before advancing pawns.',
      'The king march to e5 on move 42 was the decisive moment of the endgame.',
    ],
  },
  {
    topic: 'Time Management',
    points: [
      'Gaurav spent excessive time in the early middlegame (moves 18–22) leading to time pressure.',
    ],
  },
];

const MOCK_GAMEPLAY_TIPS = [
  { id: 'tip-1',  startTime: 120,  tip: 'Excellent Sicilian Najdorf choice — keeps the position flexible.', winChance: 50.0, turn: 'w' as const, centipawnLoss: 8   },
  { id: 'tip-2',  startTime: 360,  tip: 'Strong knight development to c6.', winChance: 46.2, turn: 'b' as const, centipawnLoss: 5   },
  { id: 'tip-3',  startTime: 580,  tip: 'Good pawn structure — Najdorf 9...Nbd7 avoids sharp lines.', winChance: 43.8, turn: 'w' as const, centipawnLoss: 15  },
  { id: 'tip-4',  startTime: 820,  tip: 'Solid defensive resource.', winChance: 47.0, turn: 'b' as const, centipawnLoss: 22  },
  { id: 'tip-5',  startTime: 1050, tip: 'Missed tactic: ...Rxc3! wins material here. The knight on c3 is undefended.', winChance: 34.2, turn: 'w' as const, centipawnLoss: 185 },
  { id: 'tip-6',  startTime: 1250, tip: 'Slightly passive — the active ...b4 push would have created counterplay.', winChance: 35.7, turn: 'b' as const, centipawnLoss: 62  },
  { id: 'tip-7',  startTime: 1480, tip: 'Best defensive try in a difficult position.', winChance: 44.0, turn: 'w' as const, centipawnLoss: 7   },
  { id: 'tip-8',  startTime: 1700, tip: 'Blunder — walking into a discovered attack. Nd5 was the only move to maintain balance.', winChance: 33.3, turn: 'b' as const, centipawnLoss: 312 },
  { id: 'tip-9',  startTime: 1920, tip: 'Endgame technique is critical here — activate the rook before advancing.', winChance: 28.6, turn: 'w' as const, centipawnLoss: 95  },
  { id: 'tip-10', startTime: 2160, tip: 'Best move — centralises the king efficiently.', winChance: 38.2, turn: 'b' as const, centipawnLoss: 3   },
  { id: 'tip-11', startTime: 2390, tip: 'Strong defensive resource: Kf8 prevents the rook from entering via the 7th rank.', winChance: 44.0, turn: 'w' as const, centipawnLoss: 9   },
  { id: 'tip-12', startTime: 2600, tip: 'Inaccuracy — this allows the opponent to activate their bishop with tempo.', winChance: 36.9, turn: 'b' as const, centipawnLoss: 78  },
  { id: 'tip-13', startTime: 2820, tip: 'Equal position reached after precise play.', winChance: 50.0, turn: 'w' as const, centipawnLoss: 18  },
  { id: 'tip-14', startTime: 3050, tip: 'Mistake — this concedes the f5 outpost unnecessarily.', winChance: 42.3, turn: 'b' as const, centipawnLoss: 143 },
  { id: 'tip-15', startTime: 3260, tip: 'Solid continuation.', winChance: 39.9, turn: 'w' as const, centipawnLoss: 30  },
  { id: 'tip-16', startTime: 3480, tip: 'Active defence — well-timed rook lift.', winChance: 45.2, turn: 'b' as const, centipawnLoss: 12  },
  { id: 'tip-17', startTime: 3700, tip: 'Strong attacking resource — opens the h-file with gain of tempo.', winChance: 33.9, turn: 'w' as const, centipawnLoss: 6   },
  { id: 'tip-18', startTime: 3920, tip: 'Blunder — leaves the queen en prise after the knight fork on e5.', winChance: 35.1, turn: 'b' as const, centipawnLoss: 287 },
  { id: 'tip-19', startTime: 4140, tip: 'Best defensive try — the only move that holds the position.', winChance: 43.5, turn: 'w' as const, centipawnLoss: 4   },
  { id: 'tip-20', startTime: 4360, tip: 'Clear advantage obtained — rook dominates the 7th rank.', winChance: 33.3, turn: 'b' as const, centipawnLoss: 45  },
  { id: 'tip-21', startTime: 4580, tip: 'Clean endgame technique — king centralisation before advancing the passed pawn.', winChance: 27.4, turn: 'w' as const, centipawnLoss: 11  },
  { id: 'tip-22', startTime: 4800, tip: 'Final consolidation — accurate technique to convert the endgame.', winChance: 38.1, turn: 'b' as const, centipawnLoss: 19  },
];

// ── Helpers (copied from RecordingDetailPage to make stories self-contained) ──

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDurationMinutes(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m} min`;
}

function formatTipTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function extractPlayerNames(title: string | null | undefined): { white: string; black: string } {
  if (!title) return { white: 'White', black: 'Black' };
  const match = title.match(/^(.+?)\s+vs\.?\s+(.+)$/i);
  if (match) return { white: match[1].trim(), black: match[2].trim() };
  return { white: 'White', black: 'Black' };
}

// ── Pure presentational sub-components (mirrors RecordingDetailPage) ──────────

function MockHeader({
  title,
  createdAt,
  duration,
  hasVideo = true,
  onBack,
}: {
  title: string;
  createdAt: string;
  duration: number | null;
  hasVideo?: boolean;
  onBack: () => void;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

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
          <h1 className="text-[24px] font-semibold text-black" style={{ letterSpacing: '0.005em' }}>{title}</h1>
          <div className="flex items-center gap-[20px]">
            <div className="flex items-center gap-[4px]">
              <Calendar className="h-4 w-4 text-text-body opacity-20" />
              <span className="text-[13px] text-text-body">{formatDate(createdAt)}</span>
            </div>
            {duration && (
              <div className="flex items-center gap-[4px]">
                <Clock className="h-4 w-4 text-text-body opacity-20" />
                <span className="text-[13px] text-text-body">{formatDurationMinutes(duration)}</span>
              </div>
            )}
            <div className="flex items-center gap-[4px]">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="opacity-20"><path d="M2 8h12M8 2v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              <span className="text-[13px] text-text-body">— Moves</span>
            </div>
          </div>
        </div>
      </div>
      <div className="flex gap-[12px] items-start">
        <button
          className="flex items-center gap-[6px] bg-white border border-border-default hover:bg-surface-muted transition-colors"
          style={{ borderRadius: 12, padding: '12px 20px 12px 16px', boxShadow: '0px 1.27px 15.27px rgba(0,0,0,0.05)' }}
        >
          <Upload className="h-5 w-5 text-black" />
          <span className="text-[14px] font-semibold text-black" style={{ letterSpacing: '-0.02em' }}>Export</span>
        </button>
        <button
          onClick={() => setCopyState('copied')}
          disabled={!hasVideo}
          className={`flex items-center gap-[4px] transition-colors ${copyState === 'copied' ? 'bg-[#007657]' : 'bg-brand-cta hover:bg-brand-cta-hover'} ${!hasVideo ? 'opacity-50 cursor-not-allowed' : ''}`}
          style={{ borderRadius: 12, padding: '12px 20px', boxShadow: '0px 1.27px 15.27px rgba(0,0,0,0.05)' }}
        >
          {copyState === 'copied' ? <Check className="h-5 w-5 text-white" /> : <Link2 className="h-5 w-5 text-white" />}
          <span className="text-[14px] font-semibold text-white" style={{ letterSpacing: '-0.02em' }}>
            {copyState === 'copied' ? 'Link copied!' : 'Copy video link'}
          </span>
        </button>
      </div>
    </div>
  );
}

function MockAccuracyCard({ label, value, color }: { label: string; value: number | null; color: string }) {
  const barWidth = value !== null ? `${Math.min(100, value)}%` : '0%';
  return (
    <div className="flex-1 flex flex-col gap-[24px]" style={{ background: '#F7F7F7', border: '1px solid #EFEFEF', borderRadius: 16, padding: 16 }}>
      <span className="text-[14px] font-semibold text-black">{label}</span>
      <div className="flex flex-col gap-[20px]">
        <div className="flex items-end gap-[4px]">
          <span className="text-[36px] font-bold leading-none" style={{ color: value !== null ? color : '#000000' }}>
            {value !== null ? value : '—'}
          </span>
          {value !== null && <span className="text-[20px] font-semibold text-text-body" style={{ lineHeight: '28px' }}>%</span>}
        </div>
        <div className="relative h-[4px] rounded-[30px] bg-white overflow-hidden">
          <div className="absolute left-0 top-0 h-full rounded-[30px]" style={{ width: barWidth, background: value !== null ? color : 'transparent' }} />
        </div>
      </div>
    </div>
  );
}

function MockWinProbabilitySection({ players, tips }: { players: { white: string; black: string }; tips: { winChance?: number; turn?: 'w' | 'b' }[] }) {
  const CHART_W = 691;
  const CHART_H = 168;
  const Y_LABELS = [{ val: 100, y: 0 }, { val: 75, y: 42 }, { val: 50, y: 84 }, { val: 25, y: 126 }, { val: 0, y: 168 }];
  const tipData = tips.filter((t) => typeof t.winChance === 'number');
  const dataPoints = tipData.map((t) => t.winChance as number);
  const turns = tipData.map((t) => t.turn);
  const hasData = dataPoints.length >= 2;
  const toY = (wc: number) => ((100 - wc) / 100) * CHART_H;
  const midY = toY(50);
  const points = dataPoints.map((wc, i) => ({
    x: dataPoints.length === 1 ? 0 : (i / (dataPoints.length - 1)) * CHART_W,
    y: toY(wc),
    wc,
  }));
  const polylinePoints = points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const getDotColor = (i: number) => {
    if (i === 0) return '#009106';
    const delta = dataPoints[i] - dataPoints[i - 1];
    const turn = turns[i];
    const cpLoss = Math.abs(delta);
    if (cpLoss < 3) return '#009106';
    let goodForMover: boolean;
    if (turn === 'w') { goodForMover = delta > 0; }
    else if (turn === 'b') { goodForMover = delta < 0; }
    else { return cpLoss >= 15 ? '#C14103' : cpLoss >= 7 ? '#FF7E32' : '#009106'; }
    if (!goodForMover) { return cpLoss >= 15 ? '#C14103' : '#FF7E32'; }
    return '#009106';
  };

  return (
    <div style={{ background: '#F7F7F7', border: '0.617px solid #EFEFEF', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#000', textTransform: 'uppercase', letterSpacing: '0.005em' }}>Win Probability</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="4" fill="#C14103" fillOpacity="0.2"/><circle cx="8" cy="8" r="2.5" fill="#C14103"/></svg>
            <span style={{ fontSize: 13, fontWeight: 500, color: '#242424', letterSpacing: '0.005em' }}>{players.white}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="4" fill="#009106" fillOpacity="0.2"/><circle cx="8" cy="8" r="2.5" fill="#009106"/></svg>
            <span style={{ fontSize: 13, fontWeight: 500, color: '#242424', letterSpacing: '0.005em' }}>{players.black}</span>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-end', width: 22, flexShrink: 0, height: CHART_H + 20 }}>
          {Y_LABELS.map(({ val }) => <span key={val} style={{ fontSize: 10, fontWeight: 500, color: '#969696', lineHeight: 1 }}>{val}</span>)}
          <span style={{ fontSize: 10, color: 'transparent', lineHeight: 1 }}>0</span>
        </div>
        <div style={{ flex: 1, height: CHART_H + 20 }}>
          <svg width="100%" height={CHART_H + 20} viewBox={`0 0 ${CHART_W} ${CHART_H + 20}`} preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
            {Y_LABELS.map(({ y }) => <line key={y} x1={0} y1={y} x2={CHART_W} y2={y} stroke="#E5E7EB" strokeWidth={0.8} />)}
            {!hasData ? (
              <text x={CHART_W / 2} y={CHART_H / 2} textAnchor="middle" dominantBaseline="middle" fontSize={12} fill="#969696">Game data not available</text>
            ) : (
              <>
                <line x1={0} y1={midY} x2={CHART_W} y2={midY} stroke="#FF4000" strokeWidth={1.23} strokeLinecap="round" strokeDasharray="2.47 2.47" />
                <polyline points={polylinePoints} fill="none" stroke="#464646" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" strokeOpacity={0.5} />
                {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={2.78} fill={getDotColor(i)} stroke="white" strokeWidth={1.23} />)}
                {points.map((p, i) => <text key={`l${i}`} x={p.x} y={CHART_H + 14} textAnchor="middle" fontSize={9} fill="#969696">{i + 1}</text>)}
              </>
            )}
          </svg>
        </div>
      </div>
    </div>
  );
}

function MockBadgesRow({ badges }: { badges: { label: string; bg: string; color: string }[] }) {
  if (!badges.length) return null;
  return (
    <div className="flex items-center gap-[12px] flex-wrap">
      {badges.map((b, i) => (
        <div key={i} style={{ background: b.bg, borderRadius: 6, padding: '6px 10px' }}>
          <span className="text-[13px] font-medium" style={{ color: b.color }}>{b.label}</span>
        </div>
      ))}
    </div>
  );
}

function MockMatchSummaryCard({ summary }: { summary: string | null | undefined }) {
  if (!summary) return null;
  const normalized = summary.replace(/\bmeeting\b/gi, 'session');
  return (
    <div className="flex flex-col gap-[20px]" style={{ background: '#F7F7F7', border: '1px solid #EFEFEF', borderRadius: 16, padding: 20 }}>
      <span className="text-[14px] font-semibold text-black">Match Summary</span>
      <p className="text-[13px] text-[#2D2D2D]" style={{ lineHeight: '20px' }}>{normalized}</p>
    </div>
  );
}

function MockKeyMomentsCard({ tips }: { tips: { id: string; startTime: number; tip: string; centipawnLoss?: number; winChance?: number; winChanceBefore?: number; engineEval?: number; turn?: 'w' | 'b' }[] }) {
  const classified = tips.map((t) => ({
    ...t,
    quality: classifyStoredMove({ winChance: t.winChance, winChanceBefore: t.winChanceBefore, engineEval: t.engineEval, centipawnLoss: t.centipawnLoss, turn: t.turn }),
  }));
  const keyMoments = classified.filter((t) => KEY_MOMENT_QUALITIES.has(t.quality));
  const displayTips = keyMoments.length > 0 ? keyMoments : classified.slice(0, 5);
  if (!displayTips.length) return null;

  return (
    <div className="flex flex-col gap-[20px]" style={{ background: '#F7F7F7', border: '1px solid #EFEFEF', borderRadius: 16, padding: 16 }}>
      <div className="flex items-center justify-between">
        <span className="text-[14px] font-semibold text-black">Key Moments</span>
        <span className="text-[12px] text-text-body opacity-60">{displayTips.length} moves</span>
      </div>
      <div className="flex flex-col gap-[12px]">
        {displayTips.map((tip) => {
          const cfg = MOVE_BADGE[tip.quality];
          const moveMatch = tip.tip.match(/\b([NBRQK]?[a-h]?[1-8]?x?[a-h][1-8](?:=[NBRQ])?[+#]?)\b/);
          const moveLabel = moveMatch ? moveMatch[1] : '—';
          return (
            <div key={tip.id} className="flex items-center gap-[16px] bg-white rounded-[12px]" style={{ padding: '12px 16px' }}>
              <div style={{ background: cfg.bg, borderRadius: 8, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, minWidth: 90, justifyContent: 'center' }}>
                {cfg.symbol && <span style={{ fontSize: 11, fontWeight: 700, color: cfg.color }}>{cfg.symbol}</span>}
                <span style={{ fontSize: 12, fontWeight: 600, color: cfg.color }}>{cfg.label}</span>
              </div>
              <div style={{ width: 1, height: 36, background: '#EFEFEF', flexShrink: 0 }} />
              <div className="flex-1 flex flex-col gap-[4px] min-w-0">
                {moveLabel !== '—' && <span className="text-[16px] font-semibold text-black" style={{ lineHeight: 1 }}>{moveLabel}</span>}
                <p className="text-[13px] text-text-body" style={{ margin: 0, lineHeight: '18px' }}>
                  {tip.tip.length > 120 ? tip.tip.slice(0, 117) + '…' : tip.tip}
                </p>
              </div>
              <div className="flex flex-col items-center gap-[2px]" style={{ minWidth: 44 }}>
                <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
                  <path d="M3 6L9 2M9 2V8M9 2H3" stroke="#C14103" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-[11px] font-medium" style={{ color: '#C14103' }}>{formatTipTimestamp(tip.startTime)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MockInsightsPatternsCard({ keyPoints }: { keyPoints: Array<{ topic: string; points: string[] }> | null | undefined }) {
  if (!keyPoints || keyPoints.length === 0) return null;
  return (
    <div className="flex flex-col gap-[20px]" style={{ background: '#F7F7F7', border: '1px solid #EFEFEF', borderRadius: 16, padding: 16 }}>
      <span className="text-[14px] font-semibold text-black uppercase tracking-[0.005em]">Insights &amp; Patterns</span>
      <div className="flex flex-col gap-[10px]">
        {keyPoints.map((kp, idx) => (
          <div key={idx} className="flex items-center gap-[16px] bg-white" style={{ border: '1px solid #EFEFEF', borderRadius: 12, padding: '8px 16px' }}>
            <div className="flex flex-col gap-[2px] flex-1">
              <span className="text-[13px] font-medium" style={{ color: '#C14103', lineHeight: '24px' }}>{kp.topic}</span>
              {kp.points[0] && (
                <span className="text-[13px] text-[#1E1E1E]" style={{ lineHeight: '20px' }}>{kp.points[0]}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MockVideoPlayerSection({ hasVideo }: { hasVideo: boolean }) {
  return (
    <div style={{ border: '0.79px solid #EFEFEF', borderRadius: 14.23 }}>
      <div className="aspect-video overflow-hidden bg-[#262522] flex items-center justify-center" style={{ borderRadius: 9.48 }}>
        {hasVideo ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
            </div>
            <span className="text-white/60 text-[13px]">Video player (mock)</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 rounded-full border-2 border-white/40 border-t-transparent animate-spin" />
            <span className="text-white/40 text-[13px]">Exporting video...</span>
          </div>
        )}
      </div>
    </div>
  );
}

function MockChatWithVideoButton({ disabled }: { disabled: boolean }) {
  return (
    <button
      disabled={disabled}
      className={`relative overflow-hidden ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      style={{ width: 248, height: 52, borderRadius: 32 }}
    >
      <div className="absolute inset-0" style={{ background: 'linear-gradient(267.98deg, #000000 4.66%, #1E1E1E 99.38%)', borderRadius: 32, border: '2px solid #494949' }} />
      <div className="absolute inset-0 flex items-center justify-center gap-[6px]">
        <MessageCircle className="h-5 w-5 text-white" />
        <span className="text-[16px] font-medium text-white">Chat with video</span>
      </div>
    </button>
  );
}

function MockCoachNotesSection({ tips }: { tips: { id: string; startTime: number; tip: string }[] }) {
  const [input, setInput] = useState('');

  return (
    <div className="flex flex-col gap-[20px]">
      <span className="text-[14px] font-semibold text-black uppercase tracking-[0.005em]">Coach Notes</span>
      {tips.length === 0 ? (
        <p className="text-[13px] text-text-muted-brand italic">No coaching notes were captured for this session.</p>
      ) : (
        <div className="flex flex-col gap-[16px]">
          {tips.map((tip) => (
            <div key={tip.id} className="flex flex-col gap-[10px]" style={{ background: '#FFF5EC', border: '1px solid #FFCFA5', borderRadius: 10, padding: 12 }}>
              <div className="flex items-center gap-[12px]">
                <div style={{ background: '#FFFFFF', borderRadius: 7, padding: '4px 8px' }}>
                  <span className="text-[13px] font-semibold" style={{ color: '#EC5B16' }}>{formatTipTimestamp(tip.startTime)}</span>
                </div>
              </div>
              <p className="text-[13px] text-black" style={{ lineHeight: '20px' }}>{tip.tip}</p>
            </div>
          ))}
        </div>
      )}
      <form className="flex items-center gap-[4px]" style={{ background: '#F7F7F7', border: '1px solid rgba(13,13,13,0.1)', borderRadius: 9999, padding: '2px 6px 2px 12px' }} onSubmit={(e) => e.preventDefault()}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask your coach..."
          className="flex-1 bg-transparent text-[13px] font-medium text-text-label placeholder:text-text-muted-brand outline-none"
          style={{ height: 40 }}
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="flex items-center justify-center disabled:opacity-40"
          style={{ width: 32, height: 32, borderRadius: 40, background: input.trim() ? '#000000' : '#969696', border: '1px solid #EFEFEF', flexShrink: 0 }}
        >
          <Send size={14} className="text-white" />
        </button>
      </form>
    </div>
  );
}

// ── Full-page layout wrapper ──────────────────────────────────────────────────

interface MockPageProps {
  title: string;
  createdAt: string;
  duration: number | null;
  shortOverview: string | null;
  keyPoints: Array<{ topic: string; points: string[] }> | null;
  gameplayTips: { id: string; startTime: number; tip: string; winChance?: number; winChanceBefore?: number; engineEval?: number; turn?: 'w' | 'b'; centipawnLoss?: number }[];
  hasVideo: boolean;
  badges: { label: string; bg: string; color: string }[];
  accuracyWhite: number | null;
  accuracyBlack: number | null;
}

function MockRecordingDetailPage({
  title,
  createdAt,
  duration,
  shortOverview,
  keyPoints,
  gameplayTips,
  hasVideo,
  badges,
  accuracyWhite,
  accuracyBlack,
}: MockPageProps) {
  const players = extractPlayerNames(title);

  return (
    <div className="bg-surface-muted h-full flex flex-col overflow-hidden" style={{ padding: '0 10px', minHeight: '100vh' }}>
      <MockHeader title={title} createdAt={createdAt} duration={duration} hasVideo={hasVideo} onBack={() => {}} />
      <div
        className="flex-1 bg-white border border-border-default overflow-hidden"
        style={{ borderRadius: 20, padding: 20, gap: 30, display: 'flex', flexDirection: 'row', alignItems: 'flex-start', marginBottom: 0 }}
      >
        {/* Left panel */}
        <div className="flex flex-col gap-[16px] overflow-y-auto" style={{ width: 743, flexShrink: 0, height: '100%', paddingRight: 8 }}>
          <div className="flex gap-[16px]">
            <MockAccuracyCard label={`${players.white} Accuracy`} value={accuracyWhite} color="#009106" />
            <MockAccuracyCard label={`${players.black} Accuracy`} value={accuracyBlack} color="#EF4444" />
          </div>
          <div className="flex items-center justify-between" style={{ background: '#F7F7F7', border: '1px solid #EFEFEF', borderRadius: 12, padding: '16px', gap: 30 }}>
            <span className="text-[14px] font-semibold text-black">Opening</span>
            <span className="text-[14px] font-semibold text-text-body text-right">—</span>
          </div>
          <MockWinProbabilitySection players={players} tips={gameplayTips} />
          <MockBadgesRow badges={badges} />
          <MockMatchSummaryCard summary={shortOverview} />
          <MockKeyMomentsCard tips={gameplayTips} />
          <MockInsightsPatternsCard keyPoints={keyPoints} />
        </div>

        {/* Vertical divider */}
        <div style={{ width: 1, background: 'rgba(0,0,0,0.05)', alignSelf: 'stretch', flexShrink: 0 }} />

        {/* Right panel */}
        <div className="flex flex-col gap-[24px] overflow-y-auto flex-1" style={{ height: '100%' }}>
          <MockVideoPlayerSection hasVideo={hasVideo} />
          <div className="flex justify-center">
            <MockChatWithVideoButton disabled={!hasVideo} />
          </div>
          <MockCoachNotesSection tips={gameplayTips} />
        </div>
      </div>
    </div>
  );
}

// ── "Analysis in Progress" state layout ──────────────────────────────────────

function MockAnalysisInProgress({ title, createdAt, duration }: { title: string; createdAt: string; duration: number | null }) {
  return (
    <div className="bg-surface-muted h-full flex flex-col overflow-hidden" style={{ padding: '0 10px', minHeight: '100vh' }}>
      <div className="flex gap-[12px] items-start" style={{ padding: '30px 20px 20px' }}>
        <div className="flex-1 flex gap-[16px] items-start">
          <button className="flex items-center justify-center bg-white hover:bg-gray-50 transition-colors" style={{ width: 28, height: 28, border: '0.933px solid rgba(0,0,0,0.2)', borderRadius: 6.53, flexShrink: 0, marginTop: 2 }}>
            <ArrowLeft className="h-[15px] w-[15px] text-black" />
          </button>
          <div className="flex flex-col gap-[10px]">
            <h1 className="text-[24px] font-semibold text-black" style={{ letterSpacing: '0.005em' }}>{title}</h1>
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
            </div>
          </div>
        </div>
        {/* No badge in the processing state */}
      </div>
      <div className="flex-1 flex items-center justify-center overflow-hidden" style={{ background: '#FFFFFF', border: '1px solid #EFEFEF', borderRadius: '20px 20px 0px 0px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 30, gap: 20, width: 550, background: '#FFFFFF', borderRadius: 16 }}>
          {/* Chess piece SVG icon */}
          <svg width="68" height="68" viewBox="0 0 68 68" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="0.85" y="0.85" width="66.3" height="66.3" rx="33.15" fill="#F7F7F7"/>
            <rect x="0.85" y="0.85" width="66.3" height="66.3" rx="33.15" stroke="#EFEFEF" strokeWidth="1.7"/>
            <path opacity="0.2" d="M46 34.1712C45.91 40.6062 40.6787 45.87 34.2437 45.9975C32.6289 46.0341 31.0227 45.7511 29.5175 45.165L34 39C30.67 37 26.8462 37.5875 24.6625 37.9575C24.1087 38.0515 23.5397 37.9882 23.0202 37.7747C22.5006 37.5612 22.0514 37.2062 21.7238 36.75L20 34L33 26V22H34C35.5904 21.9998 37.1649 22.3158 38.6321 22.9295C40.0993 23.5433 41.4298 24.4425 42.5464 25.575C43.663 26.7076 44.5433 28.0507 45.1362 29.5264C45.7291 31.0022 46.0227 32.581 46 34.1712Z" fill="#464646"/>
            <path d="M35 30.5C35 30.7967 34.912 31.0867 34.7472 31.3334C34.5824 31.58 34.3481 31.7723 34.074 31.8858C33.7999 31.9994 33.4983 32.0291 33.2073 31.9712C32.9164 31.9133 32.6491 31.7704 32.4393 31.5607C32.2295 31.3509 32.0867 31.0836 32.0288 30.7926C31.9709 30.5017 32.0006 30.2001 32.1142 29.926C32.2277 29.6519 32.4199 29.4176 32.6666 29.2528C32.9133 29.088 33.2033 29 33.5 29C33.8978 29 34.2793 29.158 34.5606 29.4393C34.8419 29.7206 35 30.1022 35 30.5ZM47 34.185C46.9437 37.5528 45.586 40.7682 43.2115 43.1572C40.837 45.5461 37.6299 46.9233 34.2625 47H33.9912C30.8032 47.0224 27.7195 45.8648 25.3337 43.75C25.1348 43.5731 25.0143 43.3245 24.9987 43.0588C24.991 42.9272 25.0093 42.7954 25.0525 42.6709C25.0957 42.5464 25.163 42.4316 25.2506 42.3331C25.3382 42.2346 25.4443 42.1544 25.5629 42.0969C25.6815 42.0394 25.8102 42.0058 25.9418 41.9981C26.2075 41.9825 26.4686 42.0731 26.6675 42.25C27.4209 42.9242 28.267 43.487 29.18 43.9212L32.5 39.355C29.6525 38.1262 26.5662 38.6488 24.825 38.9438C24.088 39.071 23.3301 38.9881 22.6381 38.7044C21.9461 38.4208 21.3481 37.9479 20.9125 37.34L20.875 37.2862L19.1525 34.5362C19.0826 34.4244 19.0356 34.2999 19.014 34.1698C18.9925 34.0397 18.9969 33.9066 19.027 33.7783C19.0571 33.6499 19.1123 33.5287 19.1894 33.4218C19.2665 33.3148 19.3639 33.2241 19.4762 33.155L32 25.4412V22C32 21.7348 32.1053 21.4804 32.2929 21.2929C32.4804 21.1054 32.7348 21 33 21H34C35.7228 20.9998 37.4285 21.3421 39.018 22.007C40.6074 22.6718 42.0488 23.646 43.2584 24.8728C44.468 26.0996 45.4217 27.5546 46.064 29.1533C46.7063 30.7519 47.0245 32.4623 47 34.185ZM45 34.1575C45.0208 32.6998 44.7517 31.2524 44.2083 29.8996C43.6648 28.5468 42.8579 27.3155 41.8344 26.2773C40.8108 25.2391 39.5911 24.4148 38.2462 23.8521C36.9012 23.2895 35.4579 22.9999 34 23V26C33.9999 26.1707 33.956 26.3386 33.8727 26.4876C33.7893 26.6366 33.6692 26.7618 33.5237 26.8512L21.3825 34.3237L22.5525 36.1987C22.7731 36.4959 23.0723 36.7256 23.4163 36.862C23.7604 36.9985 24.1356 37.0363 24.5 36.9713C26.5 36.6338 30.5962 35.9412 34.2587 37.9937C35.5377 37.9256 36.742 37.37 37.6239 36.4412C38.5058 35.5123 38.9983 34.2808 39 33C39 32.7348 39.1053 32.4804 39.2929 32.2929C39.4804 32.1054 39.7348 32 40 32C40.2652 32 40.5195 32.1054 40.7071 32.2929C40.8946 32.4804 41 32.7348 41 33C40.9975 34.7648 40.3294 36.4637 39.1291 37.7574C37.9288 39.0511 36.2846 39.8444 34.525 39.9788L31.1362 44.6388C32.1436 44.8999 33.182 45.0215 34.2225 45C37.0712 44.9336 39.7838 43.768 41.7926 41.7471C43.8014 39.7261 44.9507 37.0065 45 34.1575Z" fill="#464646"/>
          </svg>
          {/* Text */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <h2 style={{ fontFamily: 'Inter, sans-serif', fontSize: 22, fontWeight: 500, color: '#000000', textAlign: 'center', margin: 0 }}>
              Analysing game...
            </h2>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 400, color: '#464646', textAlign: 'center', margin: 0, lineHeight: '150%', width: 370 }}>
              Your coach is hard at work! The game analysis and match replay will be ready in a few minutes.
            </p>
          </div>
          {/* CTA */}
          <button
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '12px 20px',
              background: '#FF4000',
              border: 'none',
              borderRadius: 12,
              boxShadow: '0px 1.27px 15.27px rgba(0,0,0,0.05)',
              cursor: 'pointer',
              fontFamily: 'Inter, sans-serif',
              fontSize: 14,
              fontWeight: 600,
              color: '#FFFFFF',
              letterSpacing: '-0.02em',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path fillRule="evenodd" clipRule="evenodd" d="M10 2.125C5.65076 2.125 2.125 5.65076 2.125 10C2.125 14.3492 5.65076 17.875 10 17.875C14.3492 17.875 17.875 14.3492 17.875 10C17.875 5.65076 14.3492 2.125 10 2.125ZM0.875 10C0.875 4.96043 4.96043 0.875 10 0.875C15.0396 0.875 19.125 4.96043 19.125 10C19.125 15.0396 15.0396 19.125 10 19.125C4.96043 19.125 0.875 15.0396 0.875 10Z" fill="white"/>
              <circle cx="10" cy="10" r="3.5" fill="white"/>
            </svg>
            <span>Start New Recording</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta: Meta = {
  title: 'History/RecordingDetailPage',
  parameters: {
    layout: 'fullscreen',
    backgrounds: { default: 'light', values: [{ name: 'light', value: '#f5f5f5' }] },
  },
};

export default meta;
type Story = StoryObj;

// ── Stories ───────────────────────────────────────────────────────────────────

/**
 * Analysis in Progress — recording just ended, summary not yet generated.
 * Shows the centered dialog with spinner badge and "Start New Recording" CTA.
 */
export const AnalysisInProgress: Story = {
  name: 'Analysis in Progress',
  render: () => (
    <MockAnalysisInProgress
      title="Magnus Carlsen vs. Gaurav Tyagi"
      createdAt={MOCK_RECORDING_BASE.createdAt}
      duration={MOCK_RECORDING_BASE.duration}
    />
  ),
};

/**
 * Full analysis — all data available.
 * The main state after analysis completes.
 * - Accuracy: both placeholders (—)
 * - Win Probability: placeholder chart
 * - Match Summary: full narrative paragraph
 * - Key Moments: 5 gameplay tips with quality badges
 * - Insights & Patterns: 4 topics
 * - Video: mock player
 * - Coach Notes: tips + chat input
 */
export const FullAnalysis: Story = {
  name: 'Full Analysis (all data)',
  render: () => (
    <MockRecordingDetailPage
      title={MOCK_RECORDING_BASE.meetingName}
      createdAt={MOCK_RECORDING_BASE.createdAt}
      duration={MOCK_RECORDING_BASE.duration}
      shortOverview={MOCK_SHORT_OVERVIEW}
      keyPoints={MOCK_KEY_POINTS}
      gameplayTips={MOCK_GAMEPLAY_TIPS}
      hasVideo={true}
      badges={[
        { label: 'Sicilian Najdorf', bg: '#FFE9D3', color: '#EC5B16' },
        { label: 'Good Game', bg: '#DFFBE0', color: '#009106' },
      ]}
      accuracyWhite={null}
      accuracyBlack={null}
    />
  ),
};

/**
 * With accuracy scores — accuracy cards showing real numbers with progress bars.
 */
export const WithAccuracyScores: Story = {
  name: 'With Accuracy Scores',
  render: () => (
    <MockRecordingDetailPage
      title={MOCK_RECORDING_BASE.meetingName}
      createdAt={MOCK_RECORDING_BASE.createdAt}
      duration={MOCK_RECORDING_BASE.duration}
      shortOverview={MOCK_SHORT_OVERVIEW}
      keyPoints={MOCK_KEY_POINTS}
      gameplayTips={MOCK_GAMEPLAY_TIPS}
      hasVideo={true}
      badges={[
        { label: 'Sicilian Najdorf', bg: '#FFE9D3', color: '#EC5B16' },
        { label: 'Best', bg: '#DFFBE0', color: '#009106' },
      ]}
      accuracyWhite={87}
      accuracyBlack={62}
    />
  ),
};

/**
 * No video yet — video still processing/exporting.
 * Video player shows spinner, Chat with video button is disabled.
 */
export const VideoProcessing: Story = {
  name: 'Video Processing (no player URL)',
  render: () => (
    <MockRecordingDetailPage
      title={MOCK_RECORDING_BASE.meetingName}
      createdAt={MOCK_RECORDING_BASE.createdAt}
      duration={MOCK_RECORDING_BASE.duration}
      shortOverview={MOCK_SHORT_OVERVIEW}
      keyPoints={MOCK_KEY_POINTS}
      gameplayTips={MOCK_GAMEPLAY_TIPS}
      hasVideo={false}
      badges={[]}
      accuracyWhite={null}
      accuracyBlack={null}
    />
  ),
};

/**
 * No coaching tips — tips section shows empty state message.
 */
export const NoCoachingTips: Story = {
  name: 'No Coaching Tips',
  render: () => (
    <MockRecordingDetailPage
      title={MOCK_RECORDING_BASE.meetingName}
      createdAt={MOCK_RECORDING_BASE.createdAt}
      duration={MOCK_RECORDING_BASE.duration}
      shortOverview={MOCK_SHORT_OVERVIEW}
      keyPoints={MOCK_KEY_POINTS}
      gameplayTips={[]}
      hasVideo={true}
      badges={[{ label: 'Italian Game', bg: '#FFE9D3', color: '#EC5B16' }]}
      accuracyWhite={null}
      accuracyBlack={null}
    />
  ),
};

/**
 * Minimal data — only shortOverview, no key points, no tips.
 */
export const MinimalData: Story = {
  name: 'Minimal Data (summary only)',
  render: () => (
    <MockRecordingDetailPage
      title="Unknown vs. Unknown"
      createdAt={MOCK_RECORDING_BASE.createdAt}
      duration={null}
      shortOverview="A quick 15-move game that ended in a draw by repetition after both players entered a known theoretical endgame."
      keyPoints={null}
      gameplayTips={[]}
      hasVideo={false}
      badges={[]}
      accuracyWhite={null}
      accuracyBlack={null}
    />
  ),
};
