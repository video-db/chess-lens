import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { useLiveAssist } from '../../hooks/useLiveAssist';
import { useMCP } from '../../hooks/useMCP';
import { AskThisIcon, SayThisIcon } from './LiveAssistIcons';
import { WinProbChart } from './LiveAssistWinProbChart';

interface LiveAssistPanelProps {
  onAskAboutTip?: (tipText: string) => void;
}

function LivePanelHeader({
  title,
  badge,
  height = 48,
  children,
}: {
  title: string;
  badge?: string;
  height?: number;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="bg-[#f7f7f7] border-b border-[#efefef] px-[16px] flex items-center gap-[8px] shrink-0"
      style={{ height, boxSizing: 'border-box' }}
    >
      <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 15, textTransform: 'uppercase', color: '#000000', flex: 1, lineHeight: '18px' }}>
        {title}
      </span>
      {children}
      {badge && (
        <div style={{ padding: '2px 10px', background: '#FFFFFF', border: '1px solid #EFEFEF', borderRadius: 20 }}>
          <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 13, color: '#1E1E1E' }}>
            {badge}
          </span>
        </div>
      )}
    </div>
  );
}

function EmptyPanelState({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: 16, gap: 12, height: '100%' }}>
      <div style={{ width: 40, height: 40, background: '#F7F7F7', border: '1px solid #EFEFEF', borderRadius: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {icon}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 14, color: '#000000', textAlign: 'center' }}>
          {title}
        </span>
        <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 400, fontSize: 13, color: '#464646', textAlign: 'center', lineHeight: '150%', maxWidth: 370 }}>
          {body}
        </span>
      </div>
    </div>
  );
}

function AnalysisLegend() {
  return (
    <>
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
      <div style={{ display: 'flex', alignItems: 'center', padding: '4px 12px 4px 4px', gap: 10, background: '#FFFFFF', border: '1px solid #EFEFEF', borderRadius: 20 }}>
        <div style={{ position: 'relative', width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', width: 16, height: 16, background: '#E2462C', opacity: 0.1, borderRadius: '50%' }} />
          <div style={{ width: 6, height: 6, background: '#E2462C', borderRadius: '50%' }} />
        </div>
        <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 13, color: '#C14103' }}>Live Analysis</span>
      </div>
    </>
  );
}

export function LiveAssistPanel({ onAskAboutTip: _onAskAboutTip }: LiveAssistPanelProps = {}) {
  const { coachingTips, moveHistory, winProbabilityHistory } = useLiveAssist();
  const { activeResults, connectedServerCount } = useMCP();

  const tipsScrollRef = useRef<HTMLDivElement>(null);
  const prevTipsLengthRef = useRef(0);

  const latestMCPResult = activeResults.length > 0 ? activeResults[activeResults.length - 1] : null;
  const mcpFindings = latestMCPResult?.content?.text || latestMCPResult?.content?.markdown || '';

  useEffect(() => {
    if (coachingTips.length > prevTipsLengthRef.current && tipsScrollRef.current) {
      tipsScrollRef.current.scrollTop = tipsScrollRef.current.scrollHeight;
    }
    prevTipsLengthRef.current = coachingTips.length;
  }, [coachingTips.length]);

  return (
    <div className="flex flex-col h-full gap-[20px] pt-[8px]">
      <div className="flex-1 flex flex-col gap-[20px] min-h-0 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <div className="border border-[#efefef] rounded-[12px] overflow-hidden flex flex-col shrink-0" style={{ height: 268 }}>
          <LivePanelHeader title="Live Analysis">
            <AnalysisLegend />
          </LivePanelHeader>
          <div className="bg-white flex-1 min-h-0 overflow-hidden">
            {winProbabilityHistory.length >= 1 ? (
              <div style={{ padding: 16 }}>
                <WinProbChart points={winProbabilityHistory} />
              </div>
            ) : (
              <EmptyPanelState
                icon={<AskThisIcon />}
                title="Waiting for gameplay signals"
                body="Win probability chart will appear as moves are played and the engine analyses the position."
              />
            )}
          </div>
        </div>

        <div className="border border-[#efefef] rounded-[12px] overflow-hidden flex flex-col min-h-0" style={{ flex: 2, minHeight: 220 }}>
          <LivePanelHeader
            title="Coaching Tips"
            badge={coachingTips.length > 0 ? `${coachingTips.length} tip${coachingTips.length !== 1 ? 's' : ''}` : undefined}
          />
          <div ref={tipsScrollRef} className="bg-white flex-1 min-h-0 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {coachingTips.length > 0 ? (
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {coachingTips.map((tip, index) => (
                  <div
                    key={`${tip.moveNo}-${tip.moveSan}-${index}`}
                    style={{
                      boxSizing: 'border-box',
                      display: 'flex',
                      flexDirection: 'row',
                      alignItems: 'center',
                      padding: '8px 12px',
                      gap: 16,
                      background: '#FFFFFF',
                      border: '1px solid #EFEFEF',
                      borderRadius: 12,
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start', gap: 4, width: 56, flexShrink: 0 }}>
                      <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 400, fontSize: 12, color: '#464646', lineHeight: '16px' }}>
                        MOVE {tip.moveNo}
                      </span>
                      <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 18, color: '#000000', lineHeight: '16px' }}>
                        {tip.moveSan || '-'}
                      </span>
                    </div>
                    <div style={{ width: 1, alignSelf: 'stretch', background: '#EFEFEF', flexShrink: 0 }} />
                    <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 400, fontSize: 14, color: '#2D2D2D', lineHeight: '16px', flex: 1, minWidth: 0 }}>
                      {tip.text}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyPanelState
                icon={<SayThisIcon />}
                title="No coaching tips yet"
                body="Coaching tips will appear here as the game progresses."
              />
            )}
          </div>
        </div>

        <div className="border border-[#efefef] rounded-[12px] overflow-hidden flex flex-col min-h-0" style={{ flex: 3, minHeight: 300 }}>
          <LivePanelHeader
            title="Move History"
            height={44}
            badge={moveHistory.length > 0 ? `${moveHistory.reduce((count, move) => count + (move.white ? 1 : 0) + (move.black ? 1 : 0), 0)} moves` : undefined}
          />

          {moveHistory.length === 0 ? (
            <EmptyPanelState
              icon={<SayThisIcon />}
              title="No moves yet"
              body="Move history will appear here as the game progresses."
            />
          ) : (
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }} className="[&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
              <div style={{ display: 'flex', flexDirection: 'row', position: 'sticky', top: 0, background: '#FFFFFF', zIndex: 1, borderBottom: '1px solid #EFEFEF' }}>
                <div style={{ width: 80, flexShrink: 0, padding: '8px 16px', display: 'flex', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 14, color: '#464646', lineHeight: '22px' }}>No.</span>
                </div>
                <div style={{ flex: 1, padding: '8px 16px', display: 'flex', alignItems: 'center', borderLeft: '1px solid #EFEFEF' }}>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 14, color: '#464646', lineHeight: '22px' }}>White</span>
                </div>
                <div style={{ flex: 1, padding: '8px 16px', display: 'flex', alignItems: 'center', borderLeft: '1px solid #EFEFEF' }}>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 14, color: '#464646', lineHeight: '22px' }}>Black</span>
                </div>
              </div>
              {moveHistory.map((move) => (
                <div key={move.no} style={{ display: 'flex', flexDirection: 'row', borderBottom: '1px solid #EFEFEF' }}>
                  <div style={{ width: 80, flexShrink: 0, padding: '8px 16px', display: 'flex', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 14, color: '#000000', lineHeight: '22px' }}>{move.no}</span>
                  </div>
                  <div style={{ flex: 1, padding: '8px 16px', display: 'flex', alignItems: 'center', borderLeft: '1px solid #EFEFEF' }}>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 14, color: '#000000', lineHeight: '22px' }}>{move.white ?? ''}</span>
                  </div>
                  <div style={{ flex: 1, padding: '8px 16px', display: 'flex', alignItems: 'center', borderLeft: '1px solid #EFEFEF' }}>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 14, color: '#000000', lineHeight: '22px' }}>{move.black ?? ''}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {connectedServerCount > 0 && (
          <div className="border border-[#efefef] rounded-[12px] overflow-hidden flex-1 min-h-0 flex flex-col">
            <LivePanelHeader title="MCP Findings" height={42} />
            <div className="bg-white p-[16px] flex-1 min-h-0 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
              {mcpFindings ? (
                <div className="prose prose-sm max-w-none text-[14px] text-black leading-[22px]">
                  <ReactMarkdown
                    components={{
                      p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                      a: ({ href, children }) => <a href={href} className="text-[#ec5b16] underline decoration-solid" target="_blank" rel="noopener noreferrer">{children}</a>,
                      ul: ({ children }) => <ul className="list-disc ml-5 mb-2">{children}</ul>,
                      li: ({ children }) => <li className="mb-1">{children}</li>,
                    }}
                  >
                    {mcpFindings}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="flex items-center justify-center py-[14px]">
                  <p className="text-[13px] text-[#969696] text-center">
                    See live results triggered by position keywords
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default LiveAssistPanel;
