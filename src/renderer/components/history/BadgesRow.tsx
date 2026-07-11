import { classifyStoredMove, KEY_MOMENT_QUALITIES, MOVE_BADGE, type MoveQuality } from '../../../shared/lib/moveClassification';

interface BadgesRowProps {
  tips: {
    winChance?: number;
    winChanceBefore?: number;
    turn?: 'w' | 'b';
    centipawnLoss?: number;
    engineEval?: number;
  }[];
  keyMomentIndices: Set<number>;
}

export function BadgesRow({ tips, keyMomentIndices }: BadgesRowProps) {
  const qualityOrder: MoveQuality[] = [
    'brilliant', 'great', 'best', 'inaccuracy', 'mistake', 'blunder',
  ];

  const presentQualities = new Set<MoveQuality>();
  keyMomentIndices.forEach((idx) => {
    const tip = tips[idx];
    if (!tip) return;
    const q = classifyStoredMove({
      winChance: tip.winChance,
      winChanceBefore: tip.winChanceBefore,
      turn: tip.turn,
      centipawnLoss: tip.centipawnLoss,
      engineEval: tip.engineEval,
    }) as MoveQuality;
    if (KEY_MOMENT_QUALITIES.has(q)) presentQualities.add(q);
  });

  const badges = qualityOrder.filter((q) => presentQualities.has(q));
  if (!badges.length) return null;

  return (
    <div className="flex items-center gap-[8px] flex-wrap">
      {badges.map((q) => {
        const b = MOVE_BADGE[q];
        return (
          <div
            key={q}
            className="flex items-center gap-[5px]"
            style={{ background: b.bg, border: `1px solid ${b.color}`, borderRadius: 6, padding: '4px 10px' }}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" style={{ flexShrink: 0 }}>
              <circle cx="4" cy="4" r="3.5" fill={b.color} />
            </svg>
            <span style={{ fontSize: 12, fontWeight: 600, color: b.color, fontFamily: 'Inter, sans-serif', letterSpacing: '0.005em' }}>
              {b.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

