import { OverlayHeader } from './OverlayHeader';

interface StartupOverlayPanelProps {
  connectingError?: string | null;
  forceStartupUi?: boolean;
  statusText?: string;
  elapsed: string;
  onCollapse: () => void;
  onStop: () => void;
  stopDisabled?: boolean;
}

export function StartupOverlayPanel({
  connectingError,
  forceStartupUi,
  statusText,
  elapsed,
  onCollapse,
  onStop,
  stopDisabled = false,
}: StartupOverlayPanelProps) {
  return (
    <div style={{ width: '100%', height: 'auto', display: 'flex', flexDirection: 'column', padding: '0 0 10px 0', boxSizing: 'border-box' }}>
      <div style={{
        background: '#FFFFFF',
        borderRadius: 16,
        overflow: 'hidden',
        boxShadow: '0px 4px 24px rgba(0,0,0,0.08)',
      }}>
        <OverlayHeader onCollapse={onCollapse} />

        <div style={{
          background: '#FFFFFF',
          padding: '16.82px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20.18,
          borderTop: '1px solid rgba(0,0,0,0.05)',
          borderBottom: '1px solid rgba(0,0,0,0.05)',
          boxSizing: 'border-box',
        }}>
          {connectingError ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                  <circle cx="7" cy="7" r="6.3" stroke="#E53935" strokeWidth="1.4"/>
                  <line x1="7" y1="4" x2="7" y2="8" stroke="#E53935" strokeWidth="1.4" strokeLinecap="round"/>
                  <circle cx="7" cy="10" r="0.7" fill="#E53935"/>
                </svg>
                <span style={{ fontSize: 12, fontWeight: 500, color: '#E53935', lineHeight: '13px', fontFamily: 'Inter, sans-serif' }}>
                  FAILED TO START
                </span>
              </div>

              <div style={{
                background: '#FFF3F3',
                borderRadius: 12.84,
                padding: '6.73px 10.09px',
                boxShadow: '0px 1.07px 12.84px rgba(0,0,0,0.05)',
                border: '1px solid rgba(229,57,53,0.15)',
              }}>
                <span style={{
                  fontSize: 13,
                  fontWeight: 400,
                  color: '#E53935',
                  lineHeight: '18px',
                  fontFamily: 'Inter, sans-serif',
                  display: 'block',
                  wordBreak: 'break-word',
                }}>
                  {connectingError}
                </span>
              </div>
            </>
          ) : forceStartupUi ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                  <path d="M1 1L13 13M5.5 5.56A2 2 0 0 0 8.44 8.5M2.5 2.76C1.5 3.6 0.75 4.72 0.5 7c.67 3 3.5 5 6.5 5 1.3 0 2.5-.38 3.5-1.02M4 2.27A6.7 6.7 0 0 1 7 2c3 0 5.83 2 6.5 5-.3 1.35-.97 2.52-1.9 3.44" stroke="#464646" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span style={{ fontSize: 12, fontWeight: 500, color: '#464646', lineHeight: '13px', fontFamily: 'Inter, sans-serif' }}>
                  NO BOARD DETECTED
                </span>
              </div>

              <div style={{ background: '#EFEFEF', borderRadius: 12.84, padding: '6.73px 10.09px', boxShadow: '0px 1.07px 12.84px rgba(0,0,0,0.05)' }}>
                <span style={{ fontSize: 13, fontWeight: 400, color: '#464646', lineHeight: '18px', fontFamily: 'Inter, sans-serif', display: 'block' }}>
                  {statusText}
                </span>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: 'conic-gradient(from 180deg at 50% 50%, #FF4000 0deg, rgba(196,196,196,0) 360deg)',
                  animation: 'spin 1s linear infinite',
                  flexShrink: 0,
                }} />
                <span style={{ fontSize: 12, fontWeight: 500, color: '#464646', lineHeight: '13px', fontFamily: 'Inter, sans-serif' }}>
                  STARTING RECORDING...
                </span>
              </div>

              <div style={{ background: '#EFEFEF', borderRadius: 12.84, padding: '6.73px 10.09px', boxShadow: '0px 1.07px 12.84px rgba(0,0,0,0.05)' }}>
                <span style={{ fontSize: 13, fontWeight: 400, color: '#464646', lineHeight: '18px', fontFamily: 'Inter, sans-serif', display: 'block' }}>
                  {statusText}
                </span>
              </div>
            </>
          )}
        </div>

        <div style={{
          background: '#F7F7F7',
          height: 50.82,
          padding: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxSizing: 'border-box',
          gap: 6.73,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6.73, flexShrink: 0 }}>
            <div style={{
              width: 8.41,
              height: 8.41,
              borderRadius: '50%',
              background: '#FB4425',
              animation: 'pulse 1s infinite',
              flexShrink: 0,
            }} />
            <span style={{ fontSize: 15.136, fontWeight: 500, color: '#FB4425', letterSpacing: '-0.02em', fontFamily: 'Inter, sans-serif' }}>
              {elapsed}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6.73, flex: 1 }}>
            <button
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 3.36,
                padding: 8,
                height: 34.82,
                background: '#FFFFFF',
                border: '1px solid #EFEFEF',
                borderRadius: 10.09,
                boxShadow: '0px 1.07px 12.84px rgba(0,0,0,0.05)',
                cursor: 'default',
                fontSize: 13,
                fontWeight: 600,
                color: '#1E1E1E',
                letterSpacing: '-0.02em',
                fontFamily: 'Inter, sans-serif',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6A1.5 1.5 0 0 1 12.5 11H9l-3 3v-3H3.5A1.5 1.5 0 0 1 2 9.5v-6Z" stroke="#1E1E1E" strokeWidth="1.2" strokeLinejoin="round"/>
              </svg>
              Chat
            </button>

            <button
              onClick={onStop}
              disabled={stopDisabled}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 3.36,
                padding: 8,
                height: 34.82,
                background: '#1C1C1C',
                border: 'none',
                borderRadius: 10.09,
                boxShadow: '0px 1.07px 12.84px rgba(0,0,0,0.05)',
                cursor: stopDisabled ? 'not-allowed' : 'pointer',
                opacity: stopDisabled ? 0.5 : 1,
                fontSize: 13,
                fontWeight: 600,
                color: '#FFFFFF',
                letterSpacing: '-0.02em',
                fontFamily: 'Inter, sans-serif',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                <rect x="2.5" y="2.5" width="10" height="10" rx="1.5" fill="white"/>
              </svg>
              Stop
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
