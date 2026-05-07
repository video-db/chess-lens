/**
 * RecordingView Stories
 *
 * Storybook for the in-game recording page (ActiveRecordingLayout).
 *
 * Run with:  npm run storybook   →   http://localhost:6006
 * Navigate to:  Recording / RecordingView
 */

import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import {
  ArrowLeft,
  Calendar,
  Clock,
  Settings,
  LogOut,
  MessageCircle,
  Send,
  Swords,
} from 'lucide-react';

// ── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_TIMER = '28:01';
const MOCK_TITLE = 'Magnus Carlsen vs. Gaurav Tyagi';
const MOCK_DATE = 'May 06, 2026';

const MOCK_LIVE_ANALYSIS = {
  heading: 'Knight on f3 controls key central squares',
  detail: "The knight on f3 is extremely well-placed, controlling d4, e5, g5 and h4. Consider supporting it with pawns on e4 and d4 to build a strong center. Your opponent's bishop pair can become dangerous if the position opens up.",
};

const MOCK_COACHING_TIPS = [
  { moveNo: 4, move: 'Bc4', tip: 'Excellent piece placement — targets f7, stakes central claim.' },
  { moveNo: 6, move: 'O-O', tip: 'King safety secured early — now build the attack on the queenside.' },
  { moveNo: 9, move: 'Nf3', tip: 'Knight centralised — controls key squares and supports future e5 push.' },
  { moveNo: 12, move: 'd3', tip: 'Solid pawn structure — avoids early weaknesses while preparing piece activity.' },
];

const MOCK_MOVE_HISTORY = [
  { no: 1, white: 'e4',  black: 'e6'  },
  { no: 2, white: 'c3',  black: 'b6'  },
  { no: 3, white: 'Nf3', black: 'Bb7' },
  { no: 4, white: 'Bc4', black: 'd6'  },
  { no: 5, white: 'd3',  black: 'Nf6' },
  { no: 6, white: 'h3',  black: 'Be7' },
  { no: 7, white: 'O-O', black: 'O-O' },
];

const MOCK_WIN_PROB_POINTS = [52, 55, 53, 58, 62, 59, 65, 61, 68, 64, 70, 67, 63, 72, 69, 74, 71, 76, 73, 78, 75, 80, 77, 82, 79, 84, 81, 86];

const MOCK_SUGGESTED_PROMPTS = [
  'What is the best plan now?',
  'How can Magnus improve the accuracy?',
  'Best move for White?',
];

// ── Shared style helpers ───────────────────────────────────────────────────────

const S = {
  panelHeading: {
    display: 'flex', flexDirection: 'row' as const, alignItems: 'center',
    padding: '10px 16px', gap: 8,
    background: '#F7F7F7', borderBottom: '1px solid #EFEFEF',
    borderRadius: '12px 12px 0 0', flexShrink: 0,
  },
  panelTitle: {
    fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 15,
    textTransform: 'uppercase' as const, color: '#000000', flex: 1,
    lineHeight: '18px',
  },
  badge: {
    padding: '2px 10px', background: '#FFFFFF',
    border: '1px solid #EFEFEF', borderRadius: 20, flexShrink: 0,
    fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 13,
    color: '#1E1E1E', lineHeight: '150%',
  },
};

// ── Mock Sidebar ──────────────────────────────────────────────────────────────

function MockSidebar() {
  return (
    <div style={{ width: 72, height: '100%', background: '#FFFFFF', borderRight: '1px solid rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 0 20px', flexShrink: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: 20, flex: 1 }}>
        <div style={{ width: 32, height: 32, background: '#000000', borderRadius: 5.46, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="5" fill="white" opacity="0.9"/>
            <circle cx="9" cy="9" r="2" fill="#FF4000"/>
          </svg>
        </div>
        <div style={{ width: 32, height: 32, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Clock size={20} color="#000000" />
        </div>
        <div style={{ width: 32, height: 32, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Settings size={20} color="#000000" style={{ opacity: 0.2 }} />
        </div>
      </div>
      <div style={{ width: 32, height: 32, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LogOut size={20} color="#000000" />
      </div>
    </div>
  );
}

// ── Mock Recording Header ─────────────────────────────────────────────────────

function MockRecordingHeader({ onBack }: { onBack: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', padding: '30px 20px 20px', gap: 12, alignSelf: 'stretch' }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 16, flex: 1 }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', paddingTop: 2 }}>
          <button onClick={onBack} style={{ width: 28, height: 28, background: '#FFFFFF', border: '0.933px solid rgba(0,0,0,0.2)', borderRadius: 6.53, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <ArrowLeft size={15} color="#000000" />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 24, letterSpacing: '0.005em', color: '#000000', lineHeight: '29px' }}>{MOCK_TITLE}</span>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Calendar size={16} color="#464646" style={{ opacity: 0.2 }} />
              <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 400, fontSize: 13, color: '#464646', letterSpacing: '0.005em' }}>{MOCK_DATE}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Clock size={16} color="#464646" style={{ opacity: 0.2 }} />
              <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 400, fontSize: 13, color: '#464646', letterSpacing: '0.005em' }}>10:00 AM</span>
            </div>
          </div>
        </div>
      </div>
      {/* Timer + Stop — top-right */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 2, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 8, height: 8, background: '#D1242F', borderRadius: 4, flexShrink: 0 }} />
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 500, fontSize: 24, letterSpacing: '0.005em', color: '#000000', lineHeight: '32px' }}>{MOCK_TIMER}</span>
        </div>
        <button style={{ display: 'flex', alignItems: 'center', padding: '12px 20px', gap: 4, background: '#EF4444', boxShadow: '0px 1.27px 15.27px rgba(0,0,0,0.05)', borderRadius: 12, border: 'none', cursor: 'pointer' }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="4" y="4" width="12" height="12" rx="2" fill="white" /></svg>
          <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 14, letterSpacing: '-0.02em', color: '#FFFFFF' }}>Stop</span>
        </button>
      </div>
    </div>
  );
}

// ── Win Probability Chart ─────────────────────────────────────────────────────

function MockWinProbChart() {
  const CHART_W = 691;
  const CHART_H = 168;

  const Y_LABELS: { val: number; y: number }[] = [
    { val: 100, y: 0   },
    { val: 75,  y: 42  },
    { val: 50,  y: 84  },
    { val: 25,  y: 126 },
    { val: 0,   y: 168 },
  ];

  const toY = (wc: number) => ((100 - wc) / 100) * CHART_H;
  const n = MOCK_WIN_PROB_POINTS.length;
  const midY = toY(50);

  const pts = MOCK_WIN_PROB_POINTS
    .map((v, i) => `${((i / (n - 1)) * CHART_W).toFixed(2)},${toY(v).toFixed(2)}`)
    .join(' ');

  const labelEvery = Math.max(1, Math.ceil(n / 10));

  return (
    <div style={{ display: 'flex', gap: 8 }}>

      {/* Y-axis labels */}
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-end', width: 22, flexShrink: 0, height: CHART_H + 20 }}>
        {Y_LABELS.map(({ val }) => (
          <span key={val} style={{ fontSize: 10, fontWeight: 500, color: '#969696', fontFamily: 'Inter, sans-serif', letterSpacing: '0.005em', lineHeight: 1 }}>
            {val}
          </span>
        ))}
        <span style={{ fontSize: 10, color: 'transparent', lineHeight: 1 }}>0</span>
      </div>

      {/* SVG */}
      <div style={{ flex: 1, height: CHART_H + 20 }}>
        <svg
          width="100%"
          height={CHART_H + 20}
          viewBox={`0 0 ${CHART_W} ${CHART_H + 20}`}
          preserveAspectRatio="none"
          style={{ display: 'block', overflow: 'visible' }}
        >
          {/* Grid lines */}
          {Y_LABELS.map(({ y }) => (
            <line key={y} x1={0} y1={y} x2={CHART_W} y2={y} stroke="#E5E7EB" strokeWidth={0.8} />
          ))}
          {/* 50% dashed baseline */}
          <line x1={0} y1={midY} x2={CHART_W} y2={midY} stroke="#FF4000" strokeWidth={1.23} strokeLinecap="round" strokeDasharray="2.47 2.47" />
          {/* Win probability line */}
          <polyline points={pts} fill="none" stroke="#464646" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" strokeOpacity={0.5} />
          {/* X-axis move numbers */}
          {MOCK_WIN_PROB_POINTS.map((_, i) => {
            if (i % labelEvery !== 0 && i !== n - 1) return null;
            const x = (i / (n - 1)) * CHART_W;
            const moveNum = Math.floor(i / 2) + 1;
            return (
              <text key={`lbl-${i}`} x={x} y={CHART_H + 14} textAnchor="middle" fontSize={9} fill="#969696" fontFamily="Inter, sans-serif">
                {moveNum}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ── Live Analysis Panel (with data) ──────────────────────────────────────────

function MockLiveAnalysisPanelData() {
  return (
    <div style={{ border: '1px solid #EFEFEF', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
      {/* Heading — title + live badge + legend */}
      <div style={{ ...S.panelHeading, height: 48 }}>
        <span style={S.panelTitle}>Live Analysis</span>
        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginRight: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="20" height="8" viewBox="0 0 20 8" style={{ flexShrink: 0 }}>
              <line x1="0" y1="4" x2="20" y2="4" stroke="#464646" strokeWidth="1.5" strokeOpacity="0.5" strokeLinecap="round" />
            </svg>
            <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 11, color: '#464646' }}>White's win %</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="20" height="8" viewBox="0 0 20 8" style={{ flexShrink: 0 }}>
              <line x1="0" y1="4" x2="20" y2="4" stroke="#FF4000" strokeWidth="1.23" strokeDasharray="2.47 2.47" strokeLinecap="round" />
            </svg>
            <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 11, color: '#464646' }}>Equal (50%)</span>
          </div>
        </div>
        {/* Live badge */}
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', padding: '4px 12px 4px 4px', gap: 10, background: '#FFFFFF', border: '1px solid #EFEFEF', borderRadius: 20 }}>
          <div style={{ position: 'relative', width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ position: 'absolute', width: 16, height: 16, background: '#E2462C', opacity: 0.1, borderRadius: '50%' }} />
            <div style={{ width: 6, height: 6, background: '#E2462C', borderRadius: '50%' }} />
          </div>
          <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 13, color: '#C14103' }}>Live Analysis</span>
        </div>
      </div>
      {/* Chart body */}
      <div style={{ background: '#FFFFFF', padding: 16 }}>
        <MockWinProbChart />
      </div>
    </div>
  );
}

// ── Coaching Tips Panel (with data) ──────────────────────────────────────────

function MockCoachingTipsPanelData() {
  return (
    <div style={{ border: '1px solid #EFEFEF', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
      {/* Heading */}
      <div style={S.panelHeading}>
        <span style={S.panelTitle}>Coaching Tips</span>
        <span style={S.badge}>{MOCK_COACHING_TIPS.length} tips</span>
      </div>
      {/* Tips list */}
      <div style={{ background: '#FFFFFF', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {MOCK_COACHING_TIPS.map((t, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', padding: '8px 12px', gap: 16, background: '#FFFFFF', border: '1px solid #EFEFEF', borderRadius: 12, boxSizing: 'border-box' }}>
            {/* Move label */}
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start', gap: 4, width: 56, flexShrink: 0 }}>
              <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 400, fontSize: 12, color: '#464646', lineHeight: '16px' }}>MOVE {t.moveNo}</span>
              <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 18, color: '#000000', lineHeight: '16px' }}>{t.move}</span>
            </div>
            {/* Divider */}
            <div style={{ width: 1, alignSelf: 'stretch', background: '#EFEFEF', flexShrink: 0 }} />
            {/* Tip text */}
            <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 400, fontSize: 14, color: '#2D2D2D', lineHeight: '16px', flex: 1, minWidth: 0 }}>{t.tip}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Move History Panel (with data) ────────────────────────────────────────────

function MockMoveHistoryPanelData() {
  return (
    <div style={{ border: '1px solid #EFEFEF', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
      {/* Heading */}
      <div style={S.panelHeading}>
        <span style={S.panelTitle}>Move History</span>
        <span style={S.badge}>{MOCK_MOVE_HISTORY.length * 2} moves</span>
      </div>
      {/* Opening name banner */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 16px', background: '#FFE9D3', borderBottom: '1px solid #FFCFA5', borderTop: '1px solid #FFCFA5', flexShrink: 0 }}>
        <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 13, color: '#000000', lineHeight: '16px', textTransform: 'capitalize' }}>Magnus Opening: Queenside Fianchetto</span>
      </div>
      {/* Table */}
      <div style={{ background: '#FFFFFF', display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
        {/* Move No column */}
        <div style={{ display: 'flex', flexDirection: 'column', width: 119, flexShrink: 0 }}>
          <div style={{ padding: '8px 20px', borderBottom: '1px solid #EFEFEF', height: 38, boxSizing: 'border-box', display: 'flex', alignItems: 'center' }}>
            <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 14, color: '#464646', lineHeight: '22px' }}>Move No.</span>
          </div>
          {MOCK_MOVE_HISTORY.map(m => (
            <div key={m.no} style={{ padding: '8px 20px', borderBottom: '1px solid #EFEFEF', height: 38, boxSizing: 'border-box', display: 'flex', alignItems: 'center' }}>
              <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 14, color: '#000000', lineHeight: '22px' }}>{m.no}</span>
            </div>
          ))}
        </div>
        {/* White column */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <div style={{ padding: '8px 20px', borderBottom: '1px solid #EFEFEF', height: 38, boxSizing: 'border-box', display: 'flex', alignItems: 'center' }}>
            <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 14, color: '#464646', lineHeight: '22px' }}>White</span>
          </div>
          {MOCK_MOVE_HISTORY.map(m => (
            <div key={m.no} style={{ padding: '8px 20px', borderBottom: '1px solid #EFEFEF', height: 38, boxSizing: 'border-box', display: 'flex', alignItems: 'center' }}>
              <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 14, color: '#000000', lineHeight: '22px' }}>{m.white}</span>
            </div>
          ))}
        </div>
        {/* Black column */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <div style={{ padding: '8px 20px', borderBottom: '1px solid #EFEFEF', height: 38, boxSizing: 'border-box', display: 'flex', alignItems: 'center' }}>
            <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 14, color: '#464646', lineHeight: '22px' }}>Black</span>
          </div>
          {MOCK_MOVE_HISTORY.map(m => (
            <div key={m.no} style={{ padding: '8px 20px', borderBottom: '1px solid #EFEFEF', height: 38, boxSizing: 'border-box', display: 'flex', alignItems: 'center' }}>
              <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 14, color: '#000000', lineHeight: '22px' }}>{m.black}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Mock Empty Panel ──────────────────────────────────────────────────────────

function MockPanelEmpty({ icon, heading, detail }: { icon: React.ReactNode; heading: string; detail: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: 16, gap: 12, flex: 1 }}>
      <div style={{ width: 40, height: 40, background: '#F7F7F7', border: '1px solid #EFEFEF', borderRadius: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 14, color: '#000000', textAlign: 'center' }}>{heading}</span>
        <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 400, fontSize: 13, color: '#464646', textAlign: 'center', lineHeight: '150%', maxWidth: 370 }}>{detail}</span>
      </div>
    </div>
  );
}

function MockEmptyPanel({ title, badge, isLive, icon, heading, detail }: { title: string; badge?: string; isLive?: boolean; icon: React.ReactNode; heading: string; detail: string }) {
  return (
    <div style={{ border: '1px solid #EFEFEF', borderRadius: 12, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <div style={{ ...S.panelHeading, height: isLive ? 48 : undefined }}>
        <span style={S.panelTitle}>{title}</span>
        {isLive && (
          <div style={{ display: 'flex', alignItems: 'center', padding: '4px 12px 4px 4px', gap: 10, background: '#FFFFFF', border: '1px solid #EFEFEF', borderRadius: 20 }}>
            <div style={{ position: 'relative', width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ position: 'absolute', width: 16, height: 16, background: '#E2462C', opacity: 0.1, borderRadius: '50%' }} />
              <div style={{ width: 6, height: 6, background: '#E2462C', borderRadius: '50%' }} />
            </div>
            <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 13, color: '#C14103' }}>Live Analysis</span>
          </div>
        )}
        {badge && !isLive && <span style={S.badge}>{badge}</span>}
      </div>
      <div style={{ flex: 1, background: '#FFFFFF', display: 'flex', flexDirection: 'column' }}>
        <MockPanelEmpty icon={icon} heading={heading} detail={detail} />
      </div>
    </div>
  );
}

// ── Mock Chat Panel ───────────────────────────────────────────────────────────

const COACH_ICON = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path opacity="0.2" d="M15.2201 11.8303L10.9162 13.4162L9.33027 17.7201C9.28647 17.8388 9.20734 17.9412 9.10355 18.0135C8.99976 18.0858 8.8763 18.1246 8.7498 18.1246C8.6233 18.1246 8.49984 18.0858 8.39605 18.0135C8.29226 17.9412 8.21314 17.8388 8.16933 17.7201L6.5834 13.4162L2.27949 11.8303C2.16082 11.7865 2.05842 11.7073 1.9861 11.6036C1.91377 11.4998 1.875 11.3763 1.875 11.2498C1.875 11.1233 1.91377 10.9998 1.9861 10.8961C2.05842 10.7923 2.16082 10.7131 2.27949 10.6693L6.5834 9.0834L8.16933 4.77949C8.21314 4.66082 8.29226 4.55842 8.39605 4.4861C8.49984 4.41377 8.6233 4.375 8.7498 4.375C8.8763 4.375 8.99976 4.41377 9.10355 4.4861C9.20734 4.55842 9.28647 4.66082 9.33027 4.77949L10.9162 9.0834L15.2201 10.6693C15.3388 10.7131 15.4412 10.7923 15.5135 10.8961C15.5858 10.9998 15.6246 11.1233 15.6246 11.2498C15.6246 11.3763 15.5858 11.4998 15.5135 11.6036C15.4412 11.7073 15.3388 11.7865 15.2201 11.8303Z" fill="black"/>
    <path d="M15.4352 10.0828L11.4055 8.59375L9.92115 4.56094C9.83324 4.32213 9.6742 4.11604 9.46549 3.97046C9.25677 3.82488 9.00843 3.74682 8.75396 3.74682C8.49949 3.74682 8.25114 3.82488 8.04243 3.97046C7.83371 4.11604 7.67467 4.32213 7.58677 4.56094L6.09302 8.59375L2.06021 10.0781C1.8214 10.166 1.61531 10.3251 1.46973 10.5338C1.32415 10.7425 1.24609 10.9908 1.24609 11.2453C1.24609 11.4998 1.32415 11.7481 1.46973 11.9568C1.61531 12.1656 1.8214 12.3246 2.06021 12.4125L6.09302 13.9062L7.57739 17.9391C7.6653 18.1779 7.82434 18.384 8.03305 18.5295C8.24177 18.6751 8.49011 18.7532 8.74458 18.7532C8.99905 18.7532 9.2474 18.6751 9.45611 18.5295C9.66483 18.384 9.82387 18.1779 9.91177 17.9391L11.4055 13.9062L15.4383 12.4219C15.6771 12.334 15.8832 12.1749 16.0288 11.9662C16.1744 11.7575 16.2524 11.5092 16.2524 11.2547C16.2524 11.0002 16.1744 10.7519 16.0288 10.5432C15.8832 10.3344 15.6771 10.1754 15.4383 10.0875L15.4352 10.0828Z" fill="black"/>
    <path d="M11.2493 3.125C11.2493 2.95924 11.3151 2.80027 11.4323 2.68306C11.5495 2.56585 11.7085 2.5 11.8743 2.5H13.1243V1.25C13.1243 1.08424 13.1901 0.925268 13.3073 0.808058C13.4245 0.690848 13.5835 0.625 13.7493 0.625C13.915 0.625 14.074 0.690848 14.1912 0.808058C14.3084 0.925268 14.3743 1.08424 14.3743 1.25V2.5H15.6243C15.79 2.5 15.949 2.56585 16.0662 2.68306C16.1834 2.80027 16.2493 2.95924 16.2493 3.125C16.2493 3.29076 16.1834 3.44973 16.0662 3.56694C15.949 3.68415 15.79 3.75 15.6243 3.75H14.3743V5C14.3743 5.16576 14.3084 5.32473 14.1912 5.44194C14.074 5.55915 13.915 5.625 13.7493 5.625C13.5835 5.625 13.4245 5.55915 13.3073 5.44194C13.1901 5.32473 13.1243 5.16576 13.1243 5V3.75H11.8743C11.7085 3.75 11.5495 3.68415 11.4323 3.56694C11.3151 3.44973 11.2493 3.29076 11.2493 3.125ZM19.3743 6.875C19.3743 7.04076 19.3084 7.19973 19.1912 7.31694C19.074 7.43415 18.915 7.5 18.7493 7.5H18.1243V8.125C18.1243 8.29076 18.0584 8.44973 17.9412 8.56694C17.824 8.68415 17.665 8.75 17.4993 8.75C17.3335 8.75 17.1745 8.68415 17.0573 8.56694C16.9401 8.44973 16.8743 8.29076 16.8743 8.125V7.5H16.2493C16.0835 7.5 15.9245 7.43415 15.8073 7.31694C15.6901 7.19973 15.6243 7.04076 15.6243 6.875C15.6243 6.70924 15.6901 6.55027 15.8073 6.43306C15.9245 6.31585 16.0835 6.25 16.2493 6.25H16.8743V5.625C16.8743 5.45924 16.9401 5.30027 17.0573 5.18306C17.1745 5.06585 17.3335 5 17.4993 5C17.665 5 17.824 5.06585 17.9412 5.18306C18.0584 5.30027 18.1243 5.45924 18.1243 5.625V6.25H18.7493C18.915 6.25 19.074 6.31585 19.1912 6.43306C19.3084 6.55027 19.3743 6.70924 19.3743 6.875Z" fill="black"/>
  </svg>
);

type ChatState = 'prompts' | 'typing' | 'response';

function MockChatPanel({ initialState = 'prompts' }: { initialState?: ChatState; suggestedPrompts?: string[] }) {
  const [chatState, setChatState] = useState<ChatState>(initialState);
  const [input, setInput] = useState(initialState === 'typing' ? 'Explain the strategy behind last move' : '');

  const hasInput = input.trim().length > 0;
  const showOrange = chatState !== 'response' && hasInput;

  const handleSend = () => {
    if (hasInput) setChatState('response');
  };

  return (
    <div style={{ width: 460, flexShrink: 0, display: 'flex', flexDirection: 'column', padding: 12, gap: 16, background: '#F7F7F7', border: '1px solid #EFEFEF', borderRadius: 16, overflow: 'hidden', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ flex: 1, alignSelf: 'stretch', display: 'flex', flexDirection: 'column', border: '1px solid #EFEFEF', borderRadius: 12, overflow: 'hidden', minHeight: 0 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 16px', gap: 16, background: '#FFFFFF', borderBottom: '1px solid #EFEFEF', borderRadius: '12px 12px 0 0', flexShrink: 0, height: 40, boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            {COACH_ICON}
            <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: chatState === 'response' ? 600 : 500, fontSize: 15, color: '#000000' }}>Chat with Coach</span>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, background: '#FFFFFF', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', padding: 12, gap: 16, minHeight: 0 }}>

          {chatState === 'response' ? (
            /* ── Response state: chat bubbles ── */
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 16, flex: 1, alignSelf: 'stretch', minHeight: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignSelf: 'stretch' }}>
                {/* User message — right-aligned */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10, alignSelf: 'stretch' }}>
                  <div style={{ boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 12, gap: 10, background: '#FFF5EC', border: '1px solid #FFAD6D', borderRadius: '12px 12px 2px 12px', maxWidth: 300 }}>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 13, color: '#242424', lineHeight: '18px' }}>
                      Explain the strategy behind this
                    </span>
                  </div>
                </div>
                {/* AI response — left-aligned */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10, alignSelf: 'stretch' }}>
                  <div style={{ boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: 12, gap: 10, background: '#F8F8ED', border: '1px solid #779556', borderRadius: '12px 12px 12px 2px', maxWidth: 324 }}>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 400, fontSize: 13, color: '#242424', lineHeight: '18px' }}>
                      Good question. In this position the key factor is piece activity — every move should contribute to your plan of queenside pressure via ...b5 and ...a5.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* ── Prompts state: suggested prompts ── */
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '0 20px', gap: 16, flex: 1, alignSelf: 'stretch' }}>
              {MOCK_SUGGESTED_PROMPTS.map((prompt, i) => (
                <button key={i} onClick={() => { setInput(prompt); setChatState('typing'); }} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '12px 20px', gap: 8, alignSelf: 'stretch', background: '#FFF5EC', border: '0.906px solid #FFAD6D', borderRadius: 12, cursor: 'pointer' }}>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 14, color: '#C14103', flex: 1, textAlign: 'left' }}>{prompt}</span>
                  <Send size={20} color="#C14103" />
                </button>
              ))}
            </div>
          )}

          {/* Input bar */}
          <div style={{
            display: 'flex', alignItems: 'center',
            padding: '4px 4px 4px 12px', gap: 4,
            alignSelf: 'stretch',
            background: chatState === 'response' ? '#F7F7F7' : '#FFFFFF',
            border: `1px solid ${showOrange ? '#EC5B16' : 'rgba(13,13,13,0.1)'}`,
            borderRadius: 62, flexShrink: 0, height: 42, boxSizing: 'border-box',
          }}>
            <input
              value={input}
              onChange={e => { setInput(e.target.value); if (chatState !== 'response') setChatState('typing'); }}
              placeholder="Ask your coach..."
              style={{ flex: 1, fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 13, color: '#464646', background: 'transparent', border: 'none', outline: 'none' }}
            />
            <button
              onClick={handleSend}
              style={{
                width: 32, height: 32,
                background: showOrange ? '#EC5B16' : '#969696',
                border: `1.07px solid ${showOrange ? '#C14103' : '#EFEFEF'}`,
                boxShadow: '0px 1.07px 12.84px rgba(0,0,0,0.05)',
                borderRadius: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
              }}
            >
              <Send size={16} color="#FFFFFF" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Full page wrappers ────────────────────────────────────────────────────────

function MockInGamePage({ onBack, withData }: { onBack: () => void; withData: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', width: '100%', height: '100vh', background: '#FFFFFF', overflow: 'hidden' }}>
      <MockSidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '10px 10px 0', gap: 10, background: '#F7F7F7', overflow: 'hidden', minWidth: 0 }}>
        <MockRecordingHeader onBack={onBack} />
        <div style={{ flex: 1, alignSelf: 'stretch', display: 'flex', flexDirection: 'row', alignItems: 'flex-start', padding: 16, gap: 20, background: '#FFFFFF', border: '1px solid #EFEFEF', borderRadius: '20px 20px 0 0', overflow: 'hidden', minHeight: 0 }}>
          {/* Left panel */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 20, height: '100%', minWidth: 0, overflowY: 'auto', paddingRight: 2 }}>
            {withData ? (
              <>
                <MockLiveAnalysisPanelData />
                <MockCoachingTipsPanelData />
                <MockMoveHistoryPanelData />
              </>
            ) : (
              <>
                <MockEmptyPanel title="Live Analysis" isLive icon={<Swords size={19} color="#464646" style={{ opacity: 0.2 }} />} heading={MOCK_LIVE_ANALYSIS.heading} detail={MOCK_LIVE_ANALYSIS.detail} />
                <MockEmptyPanel title="Coaching Tips" badge="0 tips" icon={<MessageCircle size={19} color="#464646" style={{ opacity: 0.2 }} />} heading="No tips yet" detail="Coaching tips will appear here as the game progresses." />
                <MockEmptyPanel title="Move History" badge="0 moves" icon={<Swords size={19} color="#464646" style={{ opacity: 0.2 }} />} heading="No moves yet" detail="Move history will appear here as the game progresses." />
              </>
            )}
          </div>
          {/* Right panel */}
          <MockChatPanel initialState={withData ? 'response' : 'prompts'} />
        </div>
      </div>
    </div>
  );
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta: Meta = {
  title: 'Recording/RecordingView',
  parameters: {
    layout: 'fullscreen',
    backgrounds: { default: 'white', values: [{ name: 'white', value: '#FFFFFF' }] },
  },
};

export default meta;
type Story = StoryObj;

// ── Stories ───────────────────────────────────────────────────────────────────

/**
 * In-Game (empty) — active recording, no data captured yet.
 * All three left panels show empty states.
 */
export const InGame: Story = {
  name: 'In Game (Empty State)',
  render: () => <MockInGamePage onBack={() => {}} withData={false} />,
};

/**
 * In-Game (with data) — active recording with win probability chart,
 * coaching tips with move labels, and move history table.
 */
export const InGameWithData: Story = {
  name: 'In Game (With Data)',
  render: () => <MockInGamePage onBack={() => {}} withData={true} />,
};
