export interface WinProbChartProps {
  points: Array<{ winChance: number; turn: 'w' | 'b' }>;
}

export function WinProbChart({ points }: WinProbChartProps) {
  const CHART_W = 691;
  const CHART_H = 168;

  const Y_LABELS: { val: number; y: number }[] = [
    { val: 100, y: 0 },
    { val: 75, y: 42 },
    { val: 50, y: 84 },
    { val: 25, y: 126 },
    { val: 0, y: 168 },
  ];

  const toY = (winChance: number) => ((100 - winChance) / 100) * CHART_H;
  const n = points.length;
  const hasData = n >= 1;
  const pts = hasData
    ? points.map((point, index) => {
        const x = n === 1 ? CHART_W / 2 : (index / (n - 1)) * CHART_W;
        return `${x.toFixed(2)},${toY(point.winChance).toFixed(2)}`;
      }).join(' ')
    : '';

  const midY = toY(50);
  const labelEvery = Math.max(1, Math.ceil(n / 10));

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-end', width: 22, flexShrink: 0, height: CHART_H + 20 }}>
        {Y_LABELS.map(({ val }) => (
          <span key={val} style={{ fontSize: 10, fontWeight: 500, color: '#969696', fontFamily: 'Inter, sans-serif', letterSpacing: '0.005em', lineHeight: 1 }}>
            {val}
          </span>
        ))}
        <span style={{ fontSize: 10, color: 'transparent', lineHeight: 1 }}>0</span>
      </div>

      <div style={{ flex: 1, height: CHART_H + 20 }}>
        <svg
          width="100%"
          height={CHART_H + 20}
          viewBox={`0 0 ${CHART_W} ${CHART_H + 20}`}
          preserveAspectRatio="none"
          style={{ display: 'block', overflow: 'visible' }}
        >
          {Y_LABELS.map(({ y }) => (
            <line key={y} x1={0} y1={y} x2={CHART_W} y2={y} stroke="#E5E7EB" strokeWidth={0.8} />
          ))}

          {!hasData ? (
            <text x={CHART_W / 2} y={CHART_H / 2} textAnchor="middle" dominantBaseline="middle" fontSize={12} fill="#969696" fontFamily="Inter, sans-serif">
              Waiting for moves...
            </text>
          ) : (
            <>
              <line
                x1={0}
                y1={midY}
                x2={CHART_W}
                y2={midY}
                stroke="#FF4000"
                strokeWidth={1.23}
                strokeLinecap="round"
                strokeDasharray="2.47 2.47"
              />

              <polyline
                points={pts}
                fill="none"
                stroke="#464646"
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeOpacity={0.5}
              />

              {points.map((_, index) => {
                if (index % labelEvery !== 0 && index !== n - 1) return null;
                const x = n === 1 ? CHART_W / 2 : (index / (n - 1)) * CHART_W;
                const moveNum = Math.floor(index / 2) + 1;
                return (
                  <text
                    key={`lbl-${index}`}
                    x={x}
                    y={CHART_H + 14}
                    textAnchor="middle"
                    fontSize={9}
                    fill="#969696"
                    fontFamily="Inter, sans-serif"
                  >
                    {moveNum}
                  </text>
                );
              })}
            </>
          )}
        </svg>
      </div>
    </div>
  );
}
