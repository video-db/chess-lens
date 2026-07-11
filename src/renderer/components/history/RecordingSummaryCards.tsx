export function AccuracyCard({ label, value, color }: { label: string; value: number | null; color: string }) {
  const barWidth = value !== null ? `${Math.min(100, value)}%` : '0%';

  return (
    <div className="flex-1 flex flex-col gap-[24px]" style={{ background: '#F7F7F7', border: '1px solid #EFEFEF', borderRadius: 16, padding: 16 }}>
      <span className="text-[14px] font-semibold text-black" style={{ textTransform: 'capitalize' }}>{label}</span>

      <div className="flex flex-col gap-[20px]">
        <div className="flex items-flex-end gap-[4px]">
          {value !== null ? (
            <>
              <span className="text-[36px] font-bold leading-none" style={{ color }}>
                {value}
              </span>
              <span className="text-[20px] font-semibold text-text-body" style={{ lineHeight: '28px', alignSelf: 'flex-end' }}>%</span>
            </>
          ) : (
            <span className="text-[14px] font-medium" style={{ color: '#464646', opacity: 0.4, lineHeight: '36px' }}>
              Pending
            </span>
          )}
        </div>
        <div className="relative h-[4px] rounded-[30px] bg-white overflow-hidden">
          <div className="absolute left-0 top-0 h-full rounded-[30px]" style={{ width: barWidth, background: value !== null ? color : 'transparent' }} />
        </div>
      </div>
    </div>
  );
}

export function MatchSummaryCard({ summary }: { summary: string | null | undefined }) {
  if (!summary) return null;

  return (
    <div className="flex flex-col gap-[20px]" style={{ background: '#F7F7F7', border: '1px solid #EFEFEF', borderRadius: 16, padding: 20 }}>
      <div className="flex items-center gap-[8px]">
        <span className="text-[14px] font-semibold text-black" style={{ textTransform: 'capitalize' }}>Match Summary</span>
      </div>
      <p className="text-[13px] text-[#2D2D2D]" style={{ lineHeight: '20px', letterSpacing: '0.005em' }}>
        {summary}
      </p>
    </div>
  );
}
