import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Loader2, Send, X } from 'lucide-react';
import { getElectronAPI } from '../../api/ipc';
import { useChatStore } from '../../stores/chat.store';

export interface ChatPanelProps {
  prefillQuestion?: string;
  prefillTipContext?: string;
  prefillSeq?: number;
  onPrefillConsumed: () => void;
}

const SUGGESTED_PROMPTS = [
  'What is the best plan now?',
  'How can I improve my accuracy?',
  'Best move for White?',
];

export function ChatPanel({ prefillQuestion, prefillTipContext, prefillSeq, onPrefillConsumed }: ChatPanelProps) {
  const { messages, isLoading, error, addMessage, setLoading, setError } = useChatStore();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingTipContextRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (prefillTipContext !== undefined && prefillSeq !== undefined) {
      if (prefillQuestion) setInput(prefillQuestion);
      pendingTipContextRef.current = prefillTipContext;
      onPrefillConsumed();
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [onPrefillConsumed, prefillQuestion, prefillSeq, prefillTipContext]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = useCallback(async (event?: React.FormEvent) => {
    event?.preventDefault();
    const question = input.trim();
    if (!question || isLoading) return;

    const tipContext = pendingTipContextRef.current;
    pendingTipContextRef.current = undefined;

    setInput('');
    addMessage({ role: 'user', text: question, tipContext });
    setLoading(true);
    setError(null);

    try {
      const api = getElectronAPI();
      if (!api) throw new Error('Electron API not available');
      const result = await api.liveAssist.chat(question, tipContext);
      if (!result.success || !result.reply) {
        throw new Error(result.error || 'No reply received');
      }
      addMessage({ role: 'assistant', text: result.reply });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get a response');
    } finally {
      setLoading(false);
    }
  }, [addMessage, input, isLoading, setError, setLoading]);

  const hasMessages = messages.length > 0;

  return (
    <div style={{ flex: 1, alignSelf: 'stretch', display: 'flex', flexDirection: 'column', border: '1px solid #EFEFEF', borderRadius: 12, overflow: 'hidden', minHeight: 0, height: '100%' }}>
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

      <div style={{ flex: 1, background: '#FFFFFF', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', padding: 12, gap: 16, minHeight: 0 }}>
        {!hasMessages && !isLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '0 20px', gap: 16, flex: 1, alignSelf: 'stretch' }}>
            {SUGGESTED_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                onClick={() => { setInput(prompt); setTimeout(() => inputRef.current?.focus(), 50); }}
                style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '12px 20px', gap: 8, alignSelf: 'stretch', background: '#FFF5EC', border: '0.906px solid #FFAD6D', borderRadius: 12, cursor: 'pointer' }}
              >
                <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 14, color: '#C14103', flex: 1, textAlign: 'left' }}>{prompt}</span>
                <Send size={20} color="#C14103" />
              </button>
            ))}
          </div>
        ) : (
          <div style={{ flex: 1, alignSelf: 'stretch', display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', minHeight: 0 }}
            className="[&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {messages.map((message) => (
              <div key={message.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: message.role === 'user' ? 'flex-end' : 'flex-start' }}>
                {message.role === 'user' && message.tipContext && (
                  <p className="text-[11px] text-[#969696] max-w-[85%] text-right line-clamp-1 italic">
                    Re: "{message.tipContext.slice(0, 60)}{message.tipContext.length > 60 ? '...' : ''}"
                  </p>
                )}
                <div
                  style={{
                    maxWidth: 300, fontSize: 13, lineHeight: '18px', padding: '12px',
                    fontFamily: 'Inter, sans-serif', fontWeight: message.role === 'user' ? 500 : 400,
                    ...(message.role === 'user' ? {
                      background: '#FFF5EC', border: '1px solid #FFAD6D',
                      borderRadius: '12px 12px 2px 12px', color: '#242424',
                    } : {
                      background: '#F8F8ED', border: '1px solid #779556',
                      borderRadius: '12px 12px 12px 2px', color: '#242424',
                    }),
                  }}
                >
                  {message.role === 'assistant' ? (
                    <div className="prose prose-sm max-w-none text-[13px] leading-[18px] text-[#242424] [&_p]:mb-1 [&_p:last-child]:mb-0">
                      <ReactMarkdown>{message.text}</ReactMarkdown>
                    </div>
                  ) : message.text}
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

        <form
          onSubmit={handleSubmit}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '4px 4px 4px 12px',
            gap: 4,
            alignSelf: 'stretch',
            flexShrink: 0,
            background: hasMessages ? '#F7F7F7' : '#FFFFFF',
            border: `1px solid ${input.trim() ? '#EC5B16' : 'rgba(13,13,13,0.1)'}`,
            borderRadius: 62,
            height: 42,
            boxSizing: 'border-box',
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask your coach..."
            disabled={isLoading}
            style={{ flex: 1, fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 13, color: '#464646', background: 'transparent', border: 'none', outline: 'none' }}
            className="placeholder:text-[#969696] disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            style={{
              width: 32,
              height: 32,
              flexShrink: 0,
              background: input.trim() ? '#EC5B16' : '#969696',
              border: `1.07px solid ${input.trim() ? '#C14103' : '#EFEFEF'}`,
              boxShadow: '0px 1.07px 12.84px rgba(0,0,0,0.05)',
              borderRadius: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
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
