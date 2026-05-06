/**
 * Live Assist Panel Component
 *
 * Shows real-time AI-generated assists during recording:
 * - Tips (say_this)
 * - Analysis (ask_this)
 * - Chat — ask follow-up questions on any tip or the current position
 * - MCP Findings section
 * - Visual Analysis control button
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { Loader2, Send, X } from 'lucide-react';
import { useLiveAssist } from '../../hooks/useLiveAssist';
import { useMCP } from '../../hooks/useMCP';
import { useVisualIndexStore } from '../../stores/visual-index.store';
import { useSessionStore } from '../../stores/session.store';
import { useChatStore } from '../../stores/chat.store';
import { getElectronAPI } from '../../api/ipc';
import { trpc } from '../../api/trpc';

// ─── Icons ────────────────────────────────────────────────────────────────────

function LightbulbIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 2.5C6.54822 2.5 3.75 5.29822 3.75 8.75C3.75 10.9196 4.86607 12.8304 6.5625 13.9062V15.625C6.5625 16.3154 7.12214 16.875 7.8125 16.875H12.1875C12.8779 16.875 13.4375 16.3154 13.4375 15.625V13.9062C15.1339 12.8304 16.25 10.9196 16.25 8.75C16.25 5.29822 13.4518 2.5 10 2.5Z" stroke="#EC5B16" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 17.5H12.5" stroke="#EC5B16" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SayThisIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.5 9.58333C17.5029 10.6832 17.2459 11.7682 16.75 12.75C16.162 13.9265 15.2581 14.916 14.1395 15.6077C13.021 16.2995 11.7319 16.6661 10.4167 16.6667C9.31678 16.6695 8.23176 16.4126 7.25 15.9167L2.5 17.5L4.08333 12.75C3.58744 11.7682 3.33047 10.6832 3.33333 9.58333C3.33393 8.26813 3.70051 6.97905 4.39227 5.86045C5.08402 4.74186 6.07355 3.83797 7.25 3.25C8.23176 2.75411 9.31678 2.49713 10.4167 2.5H10.8333C12.5703 2.59583 14.2109 3.32899 15.4409 4.55905C16.671 5.7891 17.4042 7.42973 17.5 9.16667V9.58333Z" stroke="#EC5B16" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AskThisIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="10" r="7.5" stroke="#3B82F6" strokeWidth="1.5" />
      <path d="M7.5 7.5C7.5 6.11929 8.61929 5 10 5C11.3807 5 12.5 6.11929 12.5 7.5C12.5 8.88071 11.3807 10 10 10V11.25" stroke="#3B82F6" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="14" r="0.75" fill="#3B82F6" />
    </svg>
  );
}

function DisplayIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3.125 3.125H16.875V13.125H3.125V3.125Z" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 13.125V16.875" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.25 16.875H13.75" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── InsightItem — storybook style (no checkbox, no Ask button) ──────────────

interface InsightItemProps {
  text: string;
  variant: 'say' | 'ask';
}

function InsightItem({ text }: InsightItemProps) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'row', alignItems: 'center',
      padding: '8px 12px', gap: 16,
      background: '#FFFFFF', border: '1px solid #EFEFEF', borderRadius: 12,
      boxSizing: 'border-box',
    }}>
      <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 400, fontSize: 14, color: '#2D2D2D', lineHeight: '16px', flex: 1, minWidth: 0 }}>
        {text}
      </span>
    </div>
  );
}

// ─── InsightSection — storybook style empty state ────────────────────────────

interface InsightSectionProps {
  title: string;
  isLive?: boolean;
  badge?: string;
  items: string[];
  emptyHeading: string;
  emptyDetail: string;
  emptyIcon: React.ReactNode;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  className?: string;
}

function InsightSection({ title, isLive, badge, items, emptyHeading, emptyDetail, emptyIcon, scrollRef, className = '' }: InsightSectionProps) {
  return (
    <div className={`border border-[#efefef] rounded-[12px] overflow-hidden flex flex-col ${className}`}>
      {/* Header */}
      <div className="bg-[#f7f7f7] border-b border-[#efefef] px-[16px] flex items-center gap-[8px] shrink-0"
        style={{ height: 48, boxSizing: 'border-box' }}>
        <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 15, textTransform: 'uppercase', color: '#000000', flex: 1, lineHeight: '18px' }}>{title}</span>
        {isLive && (
          <div style={{ display: 'flex', alignItems: 'center', padding: '4px 12px 4px 4px', gap: 10, background: '#FFFFFF', border: '1px solid #EFEFEF', borderRadius: 20 }}>
            <div style={{ position: 'relative', width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ position: 'absolute', width: 16, height: 16, background: '#E2462C', opacity: 0.1, borderRadius: '50%' }} />
              <div style={{ width: 6, height: 6, background: '#E2462C', borderRadius: '50%' }} />
            </div>
            <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 13, color: '#C14103' }}>Live Analysis</span>
          </div>
        )}
        {badge && !isLive && (
          <div style={{ padding: '2px 10px', background: '#FFFFFF', border: '1px solid #EFEFEF', borderRadius: 20 }}>
            <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 13, color: '#1E1E1E' }}>{badge}</span>
          </div>
        )}
      </div>

      {/* Body */}
      <div ref={scrollRef} className="bg-white flex-1 min-h-0 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {items.length > 0 ? (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {items.map((item, idx) => (
              <InsightItem key={idx} text={item} variant="say" />
            ))}
          </div>
        ) : (
          /* Storybook-matching empty state: 40px circle icon + heading + detail */
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: 16, gap: 12, height: '100%' }}>
            <div style={{ width: 40, height: 40, background: '#F7F7F7', border: '1px solid #EFEFEF', borderRadius: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {emptyIcon}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 14, color: '#000000', textAlign: 'center' }}>{emptyHeading}</span>
              <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 400, fontSize: 13, color: '#464646', textAlign: 'center', lineHeight: '150%', maxWidth: 370 }}>{emptyDetail}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ChatPanel ────────────────────────────────────────────────────────────────

export interface ChatPanelProps {
  prefillQuestion?: string;
  prefillTipContext?: string;
  prefillSeq?: number;
  onPrefillConsumed: () => void;
}

export function ChatPanel({ prefillQuestion, prefillTipContext, prefillSeq, onPrefillConsumed }: ChatPanelProps) {
  const { messages, isLoading, error, addMessage, setLoading, setError } = useChatStore();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingTipContextRef = useRef<string | undefined>(undefined);

  // Auto-prefill when a tip's "Ask" button is clicked
  useEffect(() => {
    if (prefillTipContext !== undefined && prefillSeq !== undefined) {
      if (prefillQuestion) setInput(prefillQuestion);
      pendingTipContextRef.current = prefillTipContext;
      onPrefillConsumed();
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillSeq]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    const question = input.trim();
    if (!question || isLoading) return;

    const tipCtx = pendingTipContextRef.current;
    pendingTipContextRef.current = undefined;

    setInput('');
    addMessage({ role: 'user', text: question, tipContext: tipCtx });
    setLoading(true);
    setError(null);

    try {
      const api = getElectronAPI();
      if (!api) throw new Error('Electron API not available');
      const result = await api.liveAssist.chat(question, tipCtx);
      if (!result.success || !result.reply) {
        throw new Error(result.error || 'No reply received');
      }
      addMessage({ role: 'assistant', text: result.reply });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get a response');
    } finally {
      setLoading(false);
    }
  }, [input, isLoading, addMessage, setLoading, setError]);

  const hasMessages = messages.length > 0;

  // Suggested prompts shown when no messages yet
  const SUGGESTED_PROMPTS = [
    'What is the best plan now?',
    'How can I improve my accuracy?',
    'Best move for White?',
  ];

  return (
    <div style={{ flex: 1, alignSelf: 'stretch', display: 'flex', flexDirection: 'column', border: '1px solid #EFEFEF', borderRadius: 12, overflow: 'hidden', minHeight: 0, height: '100%' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 16px', gap: 16, background: '#FFFFFF', borderBottom: '1px solid #EFEFEF', borderRadius: '12px 12px 0 0', flexShrink: 0, height: 40, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path opacity="0.2" d="M15.2201 11.8303L10.9162 13.4162L9.33027 17.7201C9.28647 17.8388 9.20734 17.9412 9.10355 18.0135C8.99976 18.0858 8.8763 18.1246 8.7498 18.1246C8.6233 18.1246 8.49984 18.0858 8.39605 18.0135C8.29226 17.9412 8.21314 17.8388 8.16933 17.7201L6.5834 13.4162L2.27949 11.8303C2.16082 11.7865 2.05842 11.7073 1.9861 11.6036C1.91377 11.4998 1.875 11.3763 1.875 11.2498C1.875 11.1233 1.91377 10.9998 1.9861 10.8961C2.05842 10.7923 2.16082 10.7131 2.27949 10.6693L6.5834 9.0834L8.16933 4.77949C8.21314 4.66082 8.29226 4.55842 8.39605 4.4861C8.49984 4.41377 8.6233 4.375 8.7498 4.375C8.8763 4.375 8.99976 4.41377 9.10355 4.4861C9.20734 4.55842 9.28647 4.66082 9.33027 4.77949L10.9162 9.0834L15.2201 10.6693C15.3388 10.7131 15.4412 10.7923 15.5135 10.8961C15.5858 10.9998 15.6246 11.1233 15.6246 11.2498C15.6246 11.3763 15.5858 11.4998 15.5135 11.6036C15.4412 11.7073 15.3388 11.7865 15.2201 11.8303Z" fill="black"/>
            <path d="M15.4352 10.0828L11.4055 8.59375L9.92115 4.56094C9.83324 4.32213 9.6742 4.11604 9.46549 3.97046C9.25677 3.82488 9.00843 3.74682 8.75396 3.74682C8.49949 3.74682 8.25114 3.82488 8.04243 3.97046C7.83371 4.11604 7.67467 4.32213 7.58677 4.56094L6.09302 8.59375L2.06021 10.0781C1.8214 10.166 1.61531 10.3251 1.46973 10.5338C1.32415 10.7425 1.24609 10.9908 1.24609 11.2453C1.24609 11.4998 1.32415 11.7481 1.46973 11.9568C1.61531 12.1656 1.8214 12.3246 2.06021 12.4125L6.09302 13.9062L7.57739 17.9391C7.6653 18.1779 7.82434 18.384 8.03305 18.5295C8.24177 18.6751 8.49011 18.7532 8.74458 18.7532C8.99905 18.7532 9.2474 18.6751 9.45611 18.5295C9.66483 18.384 9.82387 18.1779 9.91177 17.9391L11.4055 13.9062L15.4383 12.4219C15.6771 12.334 15.8832 12.1749 16.0288 11.9662C16.1744 11.7575 16.2524 11.5092 16.2524 11.2547C16.2524 11.0002 16.1744 10.7519 16.0288 10.5432C15.8832 10.3344 15.6771 10.1754 15.4383 10.0875L15.4352 10.0828Z" fill="black"/>
            <path d="M11.2493 3.125C11.2493 2.95924 11.3151 2.80027 11.4323 2.68306C11.5495 2.56585 11.7085 2.5 11.8743 2.5H13.1243V1.25C13.1243 1.08424 13.1901 0.925268 13.3073 0.808058C13.4245 0.690848 13.5835 0.625 13.7493 0.625C13.915 0.625 14.074 0.690848 14.1912 0.808058C14.3084 0.925268 14.3743 1.08424 14.3743 1.25V2.5H15.6243C15.79 2.5 15.949 2.56585 16.0662 2.68306C16.1834 2.80027 16.2493 2.95924 16.2493 3.125C16.2493 3.29076 16.1834 3.44973 16.0662 3.56694C15.949 3.68415 15.79 3.75 15.6243 3.75H14.3743V5C14.3743 5.16576 14.3084 5.32473 14.1912 5.44194C14.074 5.55915 13.915 5.625 13.7493 5.625C13.5835 5.625 13.4245 5.55915 13.3073 5.44194C13.1901 5.32473 13.1243 5.16576 13.1243 5V3.75H11.8743C11.7085 3.75 11.5495 3.68415 11.4323 3.56694C11.3151 3.44973 11.2493 3.29076 11.2493 3.125ZM19.3743 6.875C19.3743 7.04076 19.3084 7.19973 19.1912 7.31694C19.074 7.43415 18.915 7.5 18.7493 7.5H18.1243V8.125C18.1243 8.29076 18.0584 8.44973 17.9412 8.56694C17.824 8.68415 17.665 8.75 17.4993 8.75C17.3335 8.75 17.1745 8.68415 17.0573 8.56694C16.9401 8.44973 16.8743 8.29076 16.8743 8.125V7.5H16.2493C16.0835 7.5 15.9245 7.43415 15.8073 7.31694C15.6901 7.19973 15.6243 7.04076 15.6243 6.875C15.6243 6.70924 15.6901 6.55027 15.8073 6.43306C15.9245 6.31585 16.0835 6.25 16.2493 6.25H16.8743V5.625C16.8743 5.45924 16.9401 5.30027 17.0573 5.18306C17.1745 5.06585 17.3335 5 17.4993 5C17.665 5 17.824 5.06585 17.9412 5.18306C18.0584 5.30027 18.1243 5.45924 18.1243 5.625V6.25H18.7493C18.915 6.25 19.074 6.31585 19.1912 6.43306C19.3084 6.55027 19.3743 6.70924 19.3743 6.875Z" fill="black"/>
          </svg>
          <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: hasMessages ? 600 : 500, fontSize: 15, color: '#000000' }}>Chat with Coach</span>
        </div>
        {isLoading && <Loader2 size={14} className="text-[#ec5b16] animate-spin" />}
      </div>

      {/* Body — flex-col justify-end so content anchors to bottom */}
      <div style={{ flex: 1, background: '#FFFFFF', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', padding: 12, gap: 16, minHeight: 0 }}>

        {!hasMessages && !isLoading ? (
          /* Suggested prompts when no messages */
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '0 20px', gap: 16, flex: 1, alignSelf: 'stretch' }}>
            {SUGGESTED_PROMPTS.map((prompt, i) => (
              <button
                key={i}
                onClick={() => { setInput(prompt); setTimeout(() => inputRef.current?.focus(), 50); }}
                style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '12px 20px', gap: 8, alignSelf: 'stretch', background: '#FFF5EC', border: '0.906px solid #FFAD6D', borderRadius: 12, cursor: 'pointer' }}
              >
                <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 14, color: '#C14103', flex: 1, textAlign: 'left' }}>{prompt}</span>
                <Send size={20} color="#C14103" />
              </button>
            ))}
          </div>
        ) : (
          /* Message thread */
          <div style={{ flex: 1, alignSelf: 'stretch', display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', minHeight: 0 }}
            className="[&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {messages.map((msg) => (
              <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                {msg.role === 'user' && msg.tipContext && (
                  <p className="text-[11px] text-[#969696] max-w-[85%] text-right line-clamp-1 italic">
                    Re: "{msg.tipContext.slice(0, 60)}{msg.tipContext.length > 60 ? '…' : ''}"
                  </p>
                )}
                <div
                  style={{
                    maxWidth: 300, fontSize: 13, lineHeight: '18px', padding: '12px',
                    fontFamily: 'Inter, sans-serif', fontWeight: msg.role === 'user' ? 500 : 400,
                    ...(msg.role === 'user' ? {
                      background: '#FFF5EC', border: '1px solid #FFAD6D',
                      borderRadius: '12px 12px 2px 12px', color: '#242424',
                    } : {
                      background: '#F8F8ED', border: '1px solid #779556',
                      borderRadius: '12px 12px 12px 2px', color: '#242424',
                    }),
                  }}
                >
                  {msg.role === 'assistant' ? (
                    <div className="prose prose-sm max-w-none text-[13px] leading-[18px] text-[#242424] [&_p]:mb-1 [&_p:last-child]:mb-0">
                      <ReactMarkdown>{msg.text}</ReactMarkdown>
                    </div>
                  ) : msg.text}
                </div>
              </div>
            ))}
            {isLoading && (
              <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                <div style={{ background: '#F8F8ED', border: '1px solid #779556', borderRadius: '12px 12px 12px 2px', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Loader2 size={12} className="text-[#779556] animate-spin" />
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#464646' }}>Thinking...</span>
                </div>
              </div>
            )}
            {error && (
              <div className="flex items-center gap-[6px] bg-[#fef2f2] border border-[#fecaca] rounded-[8px] px-[10px] py-[6px]">
                <span className="text-[12px] text-[#dc2626]">{error}</span>
                <button onClick={() => setError(null)} className="ml-auto text-[#dc2626] hover:opacity-70"><X size={12} /></button>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* Input bar */}
        <form onSubmit={handleSubmit}
          style={{
            display: 'flex', alignItems: 'center',
            padding: '4px 4px 4px 12px', gap: 4,
            alignSelf: 'stretch', flexShrink: 0,
            background: hasMessages ? '#F7F7F7' : '#FFFFFF',
            border: `1px solid ${input.trim() ? '#EC5B16' : 'rgba(13,13,13,0.1)'}`,
            borderRadius: 62, height: 42, boxSizing: 'border-box',
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask your coach..."
            disabled={isLoading}
            style={{ flex: 1, fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 13, color: '#464646', background: 'transparent', border: 'none', outline: 'none' }}
            className="placeholder:text-[#969696] disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            style={{
              width: 32, height: 32, flexShrink: 0,
              background: input.trim() ? '#EC5B16' : '#969696',
              border: `1.07px solid ${input.trim() ? '#C14103' : '#EFEFEF'}`,
              boxShadow: '0px 1.07px 12.84px rgba(0,0,0,0.05)',
              borderRadius: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}
            className="disabled:cursor-not-allowed transition-colors"
          >
            <Send size={14} className="text-white" />
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Live Win Probability Chart ───────────────────────────────────────────────

interface WinProbChartProps {
  points: Array<{ winChance: number; turn: 'w' | 'b' }>;
  playerNames: { white: string; black: string };
}

function WinProbChart({ points, playerNames }: WinProbChartProps) {
  const W = 784, H = 140;
  const n = points.length;

  if (n < 2) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: H, color: '#969696', fontSize: 13, fontFamily: 'Inter, sans-serif' }}>
        Waiting for moves…
      </div>
    );
  }

  const toY = (v: number) => H - (v / 100) * H;
  const pts = points.map((p, i) => `${(i / (n - 1)) * W},${toY(p.winChance)}`).join(' ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
      {/* Legend */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, paddingBottom: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 8h12" stroke="#C14103" strokeWidth="1.5" strokeDasharray="2 2"/></svg>
          <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 11, color: '#464646' }}>{playerNames.black}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 8h12" stroke="#009106" strokeWidth="1.5"/></svg>
          <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 11, color: '#464646' }}>{playerNames.white}</span>
        </div>
      </div>

      {/* Chart */}
      <div style={{ display: 'flex', flexDirection: 'row', gap: 4 }}>
        {/* Y-axis */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-end', width: 20, height: H, flexShrink: 0 }}>
          {[100, 75, 50, 25, 0].map(v => (
            <span key={v} style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 9, color: '#969696', lineHeight: '10px' }}>{v}</span>
          ))}
        </div>
        {/* SVG */}
        <div style={{ flex: 1, position: 'relative' }}>
          <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
            {/* Grid lines */}
            {[0, 25, 50, 75, 100].map(v => (
              <line key={v} x1={0} y1={toY(v)} x2={W} y2={toY(v)} stroke="#E5E7EB" strokeWidth={1} />
            ))}
            {/* 50% baseline dashed */}
            <line x1={0} y1={toY(50)} x2={W} y2={toY(50)} stroke="#FF4000" strokeWidth={1.2} strokeDasharray="4 3" />
            {/* Win probability line */}
            <polyline points={pts} fill="none" stroke="#53B745" strokeWidth={1.5} />
            {/* Dots per move — colored by quality */}
            {points.map((p, i) => {
              const x = (i / (n - 1)) * W;
              const y = toY(p.winChance);
              const prev = i > 0 ? points[i - 1].winChance : p.winChance;
              const delta = p.turn === 'w' ? p.winChance - prev : prev - p.winChance;
              const color = delta >= 3 ? '#009106' : delta <= -5 ? '#C14103' : '#FF7E32';
              return <circle key={i} cx={x} cy={y} r={3.4} fill={color} stroke="#FFFFFF" strokeWidth={1.2} />;
            })}
          </svg>
        </div>
      </div>

      {/* X-axis move labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 24, paddingRight: 2 }}>
        {points
          .map((_, i) => i + 1)
          .filter((_, i) => i % Math.max(1, Math.floor(n / 8)) === 0 || i === n - 1)
          .map(v => (
            <span key={v} style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 9, color: '#969696' }}>{v}</span>
          ))}
      </div>
    </div>
  );
}

// ─── LiveAssistPanel ──────────────────────────────────────────────────────────

interface LiveAssistPanelProps {
  /** Called when user clicks "Ask" on a tip — parent should pass prefill to ChatPanel */
  onAskAboutTip?: (tipText: string) => void;
}

export function LiveAssistPanel({ onAskAboutTip }: LiveAssistPanelProps = {}) {
  const { sayThis, askThis, coachingTips, moveHistory, winProbabilityHistory } = useLiveAssist();
  const { activeResults, connectedServerCount } = useMCP();
  const visualIndexStore = useVisualIndexStore();
  const { sessionId, screenWsConnectionId, status, visualIndexPrompt, selectedGameId } = useSessionStore();

  const isRecording = status === 'recording';
  const { isRunning, sceneIndexId } = visualIndexStore;

  // Scroll refs
  const sayThisScrollRef = useRef<HTMLDivElement>(null);
  const askThisScrollRef = useRef<HTMLDivElement>(null);
  const prevSayThisLengthRef = useRef(0);
  const prevAskThisLengthRef = useRef(0);

  // tRPC mutations for visual index control
  const startVisualIndexMutation = trpc.visualIndex.start.useMutation();
  const pauseVisualIndexMutation = trpc.visualIndex.pause.useMutation();
  const resumeVisualIndexMutation = trpc.visualIndex.resume.useMutation();

  const latestMCPResult = activeResults.length > 0 ? activeResults[activeResults.length - 1] : null;
  const mcpFindings = latestMCPResult?.content?.text || latestMCPResult?.content?.markdown || '';

  // Auto-scroll on new items
  useEffect(() => {
    if (sayThis.length > prevSayThisLengthRef.current && sayThisScrollRef.current) {
      sayThisScrollRef.current.scrollTop = sayThisScrollRef.current.scrollHeight;
    }
    prevSayThisLengthRef.current = sayThis.length;
  }, [sayThis.length]);

  useEffect(() => {
    if (askThis.length > prevAskThisLengthRef.current && askThisScrollRef.current) {
      askThisScrollRef.current.scrollTop = askThisScrollRef.current.scrollHeight;
    }
    prevAskThisLengthRef.current = askThis.length;
  }, [askThis.length]);

  // Visual Analysis button handler
  const handleVisualAnalysisClick = useCallback(async () => {
    if (!isRecording || !sessionId || !screenWsConnectionId) return;
    if (isRunning) {
      try {
        const result = await pauseVisualIndexMutation.mutateAsync({ sessionId });
        if (result.success) visualIndexStore.setRunning(false);
      } catch (err) {
        console.error('[VisualIndex] Failed to pause:', err);
      }
    } else if (sceneIndexId) {
      try {
        const result = await resumeVisualIndexMutation.mutateAsync({ sessionId });
        if (result.success) visualIndexStore.setRunning(true);
      } catch (err) {
        console.error('[VisualIndex] Failed to resume:', err);
      }
    } else {
      try {
        const result = await startVisualIndexMutation.mutateAsync({ sessionId, screenWsConnectionId, gameId: selectedGameId, prompt: visualIndexPrompt });
        if (result.success && result.sceneIndexId) {
          visualIndexStore.setSceneIndexId(result.sceneIndexId);
          visualIndexStore.setRunning(true);
        }
      } catch (err) {
        console.error('[VisualIndex] Failed to start:', err);
      }
    }
  }, [isRecording, sessionId, screenWsConnectionId, isRunning, sceneIndexId, selectedGameId, visualIndexStore, startVisualIndexMutation, pauseVisualIndexMutation, resumeVisualIndexMutation]);

  const isVisualAnalysisLoading = startVisualIndexMutation.isPending || pauseVisualIndexMutation.isPending || resumeVisualIndexMutation.isPending;

  return (
    <div className="flex flex-col h-full gap-[20px] pt-[8px]">

      {/* Panels */}
      <div className="flex-1 flex flex-col gap-[20px] min-h-0 overflow-hidden">

        {/* Live Analysis — shows win probability chart or empty state */}
        <div className="border border-[#efefef] rounded-[12px] overflow-hidden flex flex-col flex-1 min-h-0">
          {/* Header */}
          <div className="bg-[#f7f7f7] border-b border-[#efefef] px-[16px] flex items-center gap-[8px] shrink-0"
            style={{ height: 48, boxSizing: 'border-box' }}>
            <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 15, textTransform: 'uppercase', color: '#000000', flex: 1, lineHeight: '18px' }}>Live Analysis</span>
            {/* Pulsing live badge */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '4px 12px 4px 4px', gap: 10, background: '#FFFFFF', border: '1px solid #EFEFEF', borderRadius: 20 }}>
              <div style={{ position: 'relative', width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ position: 'absolute', width: 16, height: 16, background: '#E2462C', opacity: 0.1, borderRadius: '50%' }} />
                <div style={{ width: 6, height: 6, background: '#E2462C', borderRadius: '50%' }} />
              </div>
              <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 13, color: '#C14103' }}>Live Analysis</span>
            </div>
          </div>
          {/* Body */}
          <div className="bg-white flex-1 min-h-0 overflow-hidden">
            {winProbabilityHistory.length >= 2 ? (
              <div style={{ padding: 16 }}>
                <WinProbChart
                  points={winProbabilityHistory}
                  playerNames={{ white: 'White', black: 'Black' }}
                />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: 16, gap: 12, height: '100%' }}>
                <div style={{ width: 40, height: 40, background: '#F7F7F7', border: '1px solid #EFEFEF', borderRadius: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <AskThisIcon />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 14, color: '#000000', textAlign: 'center' }}>Waiting for gameplay signals</span>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 400, fontSize: 13, color: '#464646', textAlign: 'center', lineHeight: '150%', maxWidth: 370 }}>Win probability chart will appear as moves are played and the engine analyses the position.</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Coaching Tips — Figma row design: MOVE N + SAN + divider + tip text */}
        <div className="border border-[#efefef] rounded-[12px] overflow-hidden flex flex-col flex-1 min-h-0">
          {/* Header */}
          <div className="bg-[#f7f7f7] border-b border-[#efefef] px-[16px] flex items-center gap-[8px] shrink-0"
            style={{ height: 48, boxSizing: 'border-box' }}>
            <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 15, textTransform: 'uppercase', color: '#000000', flex: 1, lineHeight: '18px' }}>Coaching Tips</span>
            {coachingTips.length > 0 && (
              <div style={{ padding: '2px 10px', background: '#FFFFFF', border: '1px solid #EFEFEF', borderRadius: 20 }}>
                <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 13, color: '#1E1E1E' }}>
                  {coachingTips.length} tip{coachingTips.length !== 1 ? 's' : ''}
                </span>
              </div>
            )}
          </div>
          {/* Body */}
          <div ref={sayThisScrollRef} className="bg-white flex-1 min-h-0 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {coachingTips.length > 0 ? (
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {coachingTips.map((tip, idx) => (
                  <div key={idx} style={{
                    boxSizing: 'border-box',
                    display: 'flex', flexDirection: 'row', alignItems: 'center',
                    padding: '8px 12px', gap: 16,
                    background: '#FFFFFF', border: '1px solid #EFEFEF', borderRadius: 12,
                  }}>
                    {/* Left: MOVE N + SAN */}
                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start', gap: 4, width: 56, flexShrink: 0 }}>
                      <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 400, fontSize: 12, color: '#464646', lineHeight: '16px' }}>
                        MOVE {tip.moveNo}
                      </span>
                      <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 18, color: '#000000', lineHeight: '16px' }}>
                        {tip.moveSan || '—'}
                      </span>
                    </div>
                    {/* Vertical divider */}
                    <div style={{ width: 1, alignSelf: 'stretch', background: '#EFEFEF', flexShrink: 0 }} />
                    {/* Tip text */}
                    <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 400, fontSize: 14, color: '#2D2D2D', lineHeight: '16px', flex: 1, minWidth: 0 }}>
                      {tip.text}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: 16, gap: 12, height: '100%' }}>
                <div style={{ width: 40, height: 40, background: '#F7F7F7', border: '1px solid #EFEFEF', borderRadius: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <SayThisIcon />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 14, color: '#000000', textAlign: 'center' }}>No coaching tips yet</span>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 400, fontSize: 13, color: '#464646', textAlign: 'center', lineHeight: '150%', maxWidth: 370 }}>
                    Coaching tips will appear here as the game progresses.
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Move History — Figma 3-column table: Move No. | White | Black */}
        <div className="border border-[#efefef] rounded-[12px] overflow-hidden flex flex-col flex-1 min-h-0">
          {/* Header */}
          <div className="bg-[#f7f7f7] border-b border-[#efefef] px-[16px] flex items-center gap-[8px] shrink-0"
            style={{ height: 44, boxSizing: 'border-box' }}>
            <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 15, textTransform: 'uppercase', color: '#000000', flex: 1, lineHeight: '18px' }}>Move History</span>
            {moveHistory.length > 0 && (
              <div style={{ padding: '2px 10px', background: '#FFFFFF', border: '1px solid #EFEFEF', borderRadius: 20 }}>
                <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 13, color: '#1E1E1E' }}>
                  {moveHistory.reduce((n, m) => n + (m.white ? 1 : 0) + (m.black ? 1 : 0), 0)} moves
                </span>
              </div>
            )}
          </div>

          {moveHistory.length === 0 ? (
            /* Empty state */
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: 16, gap: 12, flex: 1 }}>
              <div style={{ width: 40, height: 40, background: '#F7F7F7', border: '1px solid #EFEFEF', borderRadius: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <SayThisIcon />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 14, color: '#000000', textAlign: 'center' }}>No moves yet</span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 400, fontSize: 13, color: '#464646', textAlign: 'center', lineHeight: '150%', maxWidth: 370 }}>Move history will appear here as the game progresses.</span>
              </div>
            </div>
          ) : (
            /* Scrollable table — single scroll container so all columns scroll together */
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }} className="[&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
              {/* Sticky header row */}
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
              {/* Data rows */}
              {moveHistory.map((m) => (
                <div key={m.no} style={{ display: 'flex', flexDirection: 'row', borderBottom: '1px solid #EFEFEF' }}>
                  <div style={{ width: 80, flexShrink: 0, padding: '8px 16px', display: 'flex', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 14, color: '#000000', lineHeight: '22px' }}>{m.no}</span>
                  </div>
                  <div style={{ flex: 1, padding: '8px 16px', display: 'flex', alignItems: 'center', borderLeft: '1px solid #EFEFEF' }}>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 14, color: '#000000', lineHeight: '22px' }}>{m.white ?? ''}</span>
                  </div>
                  <div style={{ flex: 1, padding: '8px 16px', display: 'flex', alignItems: 'center', borderLeft: '1px solid #EFEFEF' }}>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 14, color: '#000000', lineHeight: '22px' }}>{m.black ?? ''}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Chat — removed from here, rendered in RecordingView right panel */}

        {/* MCP Findings */}
        {connectedServerCount > 0 && (
          <div className="border border-[#efefef] rounded-[12px] overflow-hidden flex-1 min-h-0 flex flex-col">
            <div className="bg-[#f7f7f7] border-b border-[#efefef] px-[16px] py-[10px] shrink-0"
              style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 15, textTransform: 'uppercase' }}>
              <span className="text-black">MCP Findings</span>
            </div>
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
