import { classifyStoredMove, MOVE_BADGE, type MoveQuality } from '../../../shared/lib/moveClassification';
import {
  formatTipTimestamp,
  getDisplayKeyMomentTips,
  getMoveLabel,
  getMoveNumber,
} from './recording-analysis-utils';

export { computeKeyMomentIndices, formatTipTimestamp } from './recording-analysis-utils';
export { BadgesRow } from './BadgesRow';

export function WinProbabilitySection({
  tips,
  keyMomentIndices,
}: {
  tips: { winChance?: number; winChanceBefore?: number; turn?: 'w' | 'b'; centipawnLoss?: number; engineEval?: number }[];
  keyMomentIndices: Set<number>;
}) {
  // ── Layout constants (match Figma SVG: 743×252 card) ──────────────────────
  // Chart canvas within the SVG viewBox
  const CHART_W = 691;   // matches rect width in Figma (726.831 - 35.573 ≈ 691)
  const CHART_H = 168;   // y range: 53 → 221 = 168px

  // Y coordinates for each percentage label (Figma: 100→y=0, 75→y=42, 50→y=84, 25→y=126, 0→y=168)
  const Y_LABELS: { val: number; y: number }[] = [
    { val: 100, y: 0   },
    { val: 75,  y: 42  },
    { val: 50,  y: 84  },
    { val: 25,  y: 126 },
    { val: 0,   y: 168 },
  ];

  const toY = (wc: number) => ((100 - wc) / 100) * CHART_H;

  // ── Data ────────────────────────────────────────────────────────────────────
  const tipData    = tips.filter((t) => typeof t.winChance === 'number');
  const dataPoints = tipData.map((t) => t.winChance as number);
  const hasData    = dataPoints.length >= 2;

  // Classify so key-moment dots can be coloured by quality
  const pointQualities = tipData.map((t) =>
    classifyStoredMove({
      winChance: t.winChance, winChanceBefore: t.winChanceBefore,
      turn: t.turn, centipawnLoss: t.centipawnLoss, engineEval: t.engineEval,
    }) as MoveQuality
  );

  const points = dataPoints.map((wc, i) => ({
    x: dataPoints.length === 1 ? 0 : (i / (dataPoints.length - 1)) * CHART_W,
    y: toY(wc),
    wc,
  }));

  const polylinePoints = points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const midY = toY(50);

  return (
    <div style={{ background: '#F7F7F7', border: '0.617px solid #EFEFEF', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#000000', fontFamily: 'Inter, sans-serif', textTransform: 'uppercase', letterSpacing: '0.005em' }}>
          Win Probability
        </span>
        {/* Legend — explains the single line and the 50% baseline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="20" height="8" viewBox="0 0 20 8" style={{ flexShrink: 0 }}>
              <line x1="0" y1="4" x2="20" y2="4" stroke="#464646" strokeWidth="1.5" strokeOpacity="0.5" strokeLinecap="round" />
            </svg>
            <span style={{ fontSize: 12, fontWeight: 500, color: '#464646', fontFamily: 'Inter, sans-serif' }}>White's win %</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="20" height="8" viewBox="0 0 20 8" style={{ flexShrink: 0 }}>
              <line x1="0" y1="4" x2="20" y2="4" stroke="#FF4000" strokeWidth="1.23" strokeDasharray="2.47 2.47" strokeLinecap="round" />
            </svg>
            <span style={{ fontSize: 12, fontWeight: 500, color: '#464646', fontFamily: 'Inter, sans-serif' }}>Equal (50%)</span>
          </div>
        </div>
      </div>

      {/* ── Chart ── */}
      <div style={{ display: 'flex', gap: 8 }}>

        {/* Y-axis labels — fixed height matching chart */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-end', width: 22, flexShrink: 0, height: CHART_H + 20 }}>
          {Y_LABELS.map(({ val }) => (
            <span key={val} style={{ fontSize: 10, fontWeight: 500, color: '#969696', fontFamily: 'Inter, sans-serif', letterSpacing: '0.005em', lineHeight: 1 }}>
              {val}
            </span>
          ))}
          {/* spacer for x-axis label row */}
          <span style={{ fontSize: 10, color: 'transparent', lineHeight: 1 }}>0</span>
        </div>

        {/* SVG chart area — explicit height so the SVG renders */}
        <div style={{ flex: 1, height: CHART_H + 20 }}>
          <svg
            width="100%"
            height={CHART_H + 20}
            viewBox={`0 0 ${CHART_W} ${CHART_H + 20}`}
            preserveAspectRatio="none"
            style={{ display: 'block', overflow: 'visible' }}
          >
            {/* Grid lines at 0/25/50/75/100 */}
            {Y_LABELS.map(({ y }) => (
              <line key={y} x1={0} y1={y} x2={CHART_W} y2={y} stroke="#E5E7EB" strokeWidth={0.8} />
            ))}

            {!hasData ? (
              <text x={CHART_W / 2} y={CHART_H / 2} textAnchor="middle" dominantBaseline="middle" fontSize={12} fill="#969696" fontFamily="Inter, sans-serif">
                Game data not available
              </text>
            ) : (
              <>
                {/* 50% dashed baseline */}
                <line
                  x1={0} y1={midY} x2={CHART_W} y2={midY}
                  stroke="#FF4000"
                  strokeWidth={1.23}
                  strokeLinecap="round"
                  strokeDasharray="2.47 2.47"
                />

                {/* Win probability line */}
                <polyline
                  points={polylinePoints}
                  fill="none"
                  stroke="#464646"
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeOpacity={0.5}
                />

                {/* Dots — only at positions that appear in the Key Moments card */}
                {points.map((p, i) => {
                  if (!keyMomentIndices.has(i)) return null;
                  const badge = MOVE_BADGE[pointQualities[i]];
                  return (
                    <circle
                      key={i}
                      cx={p.x}
                      cy={p.y}
                      r={3.5}
                      fill={badge.color}
                      stroke="white"
                      strokeWidth={1.23}
                    />
                  );
                })}

                {/* X-axis move numbers */}
                {points.map((p, i) => (
                  <text
                    key={`lbl-${i}`}
                    x={p.x}
                    y={CHART_H + 14}
                    textAnchor="middle"
                    fontSize={9}
                    fill="#969696"
                    fontFamily="Inter, sans-serif"
                  >
                    {i + 1}
                  </text>
                ))}
              </>
            )}
          </svg>
        </div>
      </div>
    </div>
  );
}

// ── Match Summary Card ────────────────────────────────────────────────────────
// ── Key Moments Card ──────────────────────────────────────────────────────────

export function KeyMomentsCard({
  tips,
  playerUrl,
  onJumpTo,
}: {
  tips: {
    id: string;
    startTime: number;
    tip: string;
    centipawnLoss?: number;
    winChance?: number;
    winChanceBefore?: number;
    engineEval?: number;
    turn?: 'w' | 'b';
  }[];
  playerUrl: string | null | undefined;
  onJumpTo?: (seconds: number) => void;
}) {
  const displayTips = getDisplayKeyMomentTips(tips);

  if (!displayTips.length) return null;

  const openAtTimestamp = (seconds: number) => {
    if (!playerUrl) return;
    onJumpTo?.(Math.max(0, Math.floor(seconds)));
  };

  return (
    <div
      style={{
        background: '#F7F7F7',
        border: '1px solid #EFEFEF',
        borderRadius: 16,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* Section title */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: '#000000',
            letterSpacing: '0.005em',
            textTransform: 'uppercase',
          }}
        >
          Key Moments
        </span>
        <span style={{ fontSize: 12, color: '#464646', opacity: 0.5, letterSpacing: '0.005em' }}>
          {displayTips.length} move{displayTips.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Rows table */}
      <div
        style={{
          background: '#FFFFFF',
          border: '1px solid #EFEFEF',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        {displayTips.map((tip, index) => {
          const cfg = MOVE_BADGE[tip.quality];
          const moveLabel = getMoveLabel(tip.tip);
          const moveNumber = getMoveNumber(tip.originalIndex);
          const shortDesc = tip.tip.length > 110 ? tip.tip.slice(0, 107) + '…' : tip.tip;
          const isLast = index === displayTips.length - 1;

          return (
            <div
              key={tip.id}
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                padding: 16,
                gap: 20,
                height: 72,
                background: '#FFFFFF',
                borderBottom: isLast ? 'none' : '1px solid #EFEFEF',
                boxSizing: 'border-box',
              }}
            >
              {/* left — "MOVE 4" label + "Bc4" SAN, flex-col, 56×40 */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'flex-start',
                  gap: 8,
                  width: 56,
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: 400,
                    fontSize: 12,
                    lineHeight: '16px',
                    color: '#464646',
                  }}
                >
                  MOVE {moveNumber}
                </span>
                <span
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: 600,
                    fontSize: 20,
                    lineHeight: '16px',
                    color: '#000000',
                  }}
                >
                  {moveLabel}
                </span>
              </div>

              {/* vertical divider — rotated border, aligns via alignSelf stretch */}
              <div style={{ width: 1, alignSelf: 'stretch', background: '#EFEFEF', flexShrink: 0 }} />

              {/* title column — description text + play row, flex-col, flex-grow 1 */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'flex-start',
                  gap: 8,
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {/* description */}
                <p
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: 400,
                    fontSize: 14,
                    lineHeight: '16px',
                    color: '#464646',
                    margin: 0,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    width: '100%',
                  }}
                  title={tip.tip}
                >
                  {shortDesc}
                </p>

                {/* play row — triangle icon + "Jump to X:XX" */}
                <button
                  onClick={() => openAtTimestamp(tip.startTime)}
                  disabled={!playerUrl}
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    padding: 0,
                    background: 'none',
                    border: 'none',
                    cursor: playerUrl ? 'pointer' : 'not-allowed',
                    opacity: playerUrl ? 1 : 0.4,
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M11 6C11 6.152 10.962 6.303 10.886 6.436C10.811 6.569 10.703 6.68 10.573 6.759L2.168 11.718C2.031 11.801 1.875 11.847 1.715 11.850C1.554 11.852 1.396 11.813 1.257 11.735C1.118 11.657 1.002 11.543 0.922 11.407C0.843 11.271 0.800 11.116 0.800 10.958V1.042C0.800 0.884 0.843 0.729 0.922 0.593C1.002 0.457 1.118 0.343 1.257 0.265C1.396 0.187 1.554 0.148 1.715 0.150C1.875 0.153 2.031 0.199 2.168 0.282L10.573 5.241C10.703 5.320 10.811 5.431 10.886 5.564C10.962 5.697 11 5.848 11 6Z"
                      fill="#C14103"
                    />
                  </svg>
                  <span
                    style={{
                      fontFamily: 'Inter, sans-serif',
                      fontWeight: 500,
                      fontSize: 13,
                      lineHeight: '16px',
                      color: '#464646',
                    }}
                  >
                    Jump to {formatTipTimestamp(tip.startTime)}
                  </span>
                </button>
              </div>

              {/* badge */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: 6,
                  gap: 1,
                  background: cfg.bg,
                  borderRadius: 6,
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: 500,
                    fontSize: 13,
                    lineHeight: '16px',
                    letterSpacing: '0.005em',
                    color: cfg.color,
                  }}
                >
                  {cfg.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Insights & Patterns Card ──────────────────────────────────────────────────

export function InsightsPatternsCard({
  keyPoints,
  recordingStatus,
}: {
  keyPoints: Array<{ topic: string; points: string[] }> | null | undefined;
  recordingStatus: string;
}) {
  const hasData = keyPoints && keyPoints.length > 0;
  const isProcessing = recordingStatus === 'processing' || recordingStatus === 'recording';
  const placeholderText = isProcessing ? 'Analysis in progress…' : 'No insights available for this session.';

  return (
    <div
      style={{
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        padding: 16,
        gap: 20,
        background: '#F7F7F7',
        border: '1px solid #EFEFEF',
        borderRadius: 16,
        alignSelf: 'stretch',
      }}
    >
      {/* Header */}
      <span
        style={{
          fontFamily: 'Inter, sans-serif',
          fontWeight: 600,
          fontSize: 14,
          lineHeight: '17px',
          textTransform: 'uppercase',
          color: '#000000',
        }}
      >
        Insights &amp; Patterns
      </span>

      {/* Content list or placeholder */}
      {hasData ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 10,
            alignSelf: 'stretch',
          }}
        >
          {keyPoints.map((kp, idx) => (
            <div
              key={idx}
              style={{
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                padding: '8px 16px',
                gap: 16,
                background: '#FFFFFF',
                border: '1px solid #EFEFEF',
                borderRadius: 12,
                alignSelf: 'stretch',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 2,
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: 500,
                    fontSize: 13,
                    lineHeight: '24px',
                    letterSpacing: '0.005em',
                    color: '#C14103',
                    alignSelf: 'stretch',
                  }}
                >
                  {kp.topic}
                </span>
                {kp.points[0] && (
                  <span
                    style={{
                      fontFamily: 'Inter, sans-serif',
                      fontWeight: 400,
                      fontSize: 13,
                      lineHeight: '20px',
                      letterSpacing: '0.005em',
                      color: '#1E1E1E',
                      alignSelf: 'stretch',
                    }}
                  >
                    {kp.points[0]}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            alignSelf: 'stretch',
            padding: '24px 0',
          }}
        >
          <span
            style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: 13,
              color: '#464646',
              opacity: 0.5,
            }}
          >
            {placeholderText}
          </span>
        </div>
      )}
    </div>
  );
}
