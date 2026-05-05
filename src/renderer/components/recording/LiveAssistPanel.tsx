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
import { Loader2, MessageCircle, Send, X, ChevronDown, ChevronUp } from 'lucide-react';
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

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M11.6667 3.5L5.25 9.91667L2.33333 7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── InsightItem ──────────────────────────────────────────────────────────────

interface InsightItemProps {
  text: string;
  checked: boolean;
  onToggle: () => void;
  onAsk: () => void;
  variant: 'say' | 'ask';
}

function InsightItem({ text, checked, onToggle, onAsk, variant }: InsightItemProps) {
  const isSay = variant === 'say';
  const bgColor = isSay ? 'bg-[#fff5ec]' : 'bg-[#d8e6fd]';
  const borderColor = isSay ? 'border-[rgba(236,91,22,0.2)]' : 'border-[rgba(59,130,246,0.2)]';
  const checkboxBg = checked
    ? isSay ? 'bg-[#ec5b16] border-[#ec5b16]' : 'bg-[#3b82f6] border-[#3b82f6]'
    : 'bg-white border-[#969696]';
  const askColor = isSay ? 'text-[#ec5b16] hover:bg-[#fff0e6]' : 'text-[#3b82f6] hover:bg-[#e0ecff]';

  return (
    <div className={`${bgColor} border ${borderColor} rounded-[10px] px-[13px] py-[9px] flex gap-[10px] items-start`}>
      {/* Checkbox */}
      <div
        className={`w-[16px] h-[16px] rounded-[4px] flex items-center justify-center shrink-0 border ${checkboxBg} mt-[3px] cursor-pointer`}
        onClick={onToggle}
      >
        {checked && <CheckIcon />}
      </div>
      {/* Text */}
      <p className="flex-1 text-[14px] text-black leading-[22px] cursor-pointer" onClick={onToggle}>{text}</p>
      {/* Ask button */}
      <button
        onClick={onAsk}
        title="Ask a question about this tip"
        className={`shrink-0 flex items-center gap-[3px] px-[7px] py-[3px] rounded-[6px] text-[11px] font-medium transition-colors mt-[1px] ${askColor}`}
      >
        <MessageCircle size={12} />
        Ask
      </button>
    </div>
  );
}

// ─── InsightSection ───────────────────────────────────────────────────────────

interface InsightSectionProps {
  title: string;
  icon: React.ReactNode;
  items: string[];
  checkedItems: Set<number>;
  onToggleItem: (index: number) => void;
  onAskItem: (text: string) => void;
  variant: 'say' | 'ask';
  emptyText: string;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  className?: string;
}

function InsightSection({ title, icon, items, checkedItems, onToggleItem, onAskItem, variant, emptyText, scrollRef, className = '' }: InsightSectionProps) {
  return (
    <div className={`border border-[#efefef] rounded-[12px] overflow-hidden flex flex-col ${className}`}>
      <div className="bg-[#f7f7f7] border-b border-[#efefef] px-[16px] py-[10px] flex items-center gap-[8px] shrink-0">
        {icon}
        <span className="font-medium text-[15px] text-black">{title}</span>
      </div>
      <div ref={scrollRef} className="bg-white p-[16px] flex-1 min-h-0 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {items.length > 0 ? (
          <div className="flex flex-col gap-[10px]">
            {items.map((item, idx) => (
              <InsightItem
                key={`${variant}-${idx}`}
                text={item}
                checked={checkedItems.has(idx)}
                onToggle={() => onToggleItem(idx)}
                onAsk={() => onAskItem(item)}
                variant={variant}
              />
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center py-[20px]">
            <p className="text-[13px] text-[#969696] text-center">{emptyText}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ChatPanel ────────────────────────────────────────────────────────────────

interface ChatPanelProps {
  prefillQuestion?: string;
  prefillTipContext?: string;
  prefillSeq?: number;
  onPrefillConsumed: () => void;
}

function ChatPanel({ prefillQuestion, prefillTipContext, prefillSeq, onPrefillConsumed }: ChatPanelProps) {
  const { messages, isLoading, error, addMessage, setLoading, setError } = useChatStore();
  const [input, setInput] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Track the tip context for the current pending user message
  const pendingTipContextRef = useRef<string | undefined>(undefined);

  // Auto-expand and pre-fill when a tip's "Ask" button is clicked
  useEffect(() => {
    if (prefillTipContext !== undefined && prefillSeq !== undefined) {
      setIsExpanded(true);
      if (prefillQuestion) setInput(prefillQuestion);
      pendingTipContextRef.current = prefillTipContext;
      onPrefillConsumed();
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillSeq]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (isExpanded) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isExpanded]);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    const question = input.trim();
    if (!question || isLoading) return;

    const tipCtx = pendingTipContextRef.current;
    pendingTipContextRef.current = undefined;

    setInput('');
    setIsExpanded(true); // ensure the panel is open so the user sees the response
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

  return (
    <div className="border border-[#efefef] rounded-[12px] overflow-hidden flex flex-col shrink-0">
      {/* Header — always visible, click to expand/collapse */}
      <button
        className="bg-[#f7f7f7] border-b border-[#efefef] px-[16px] py-[10px] flex items-center gap-[8px] w-full text-left hover:bg-[#f0f0f5] transition-colors"
        onClick={() => setIsExpanded((v) => !v)}
      >
        <MessageCircle size={18} className="text-[#ec5b16] shrink-0" />
        <span className="font-medium text-[15px] text-black flex-1">Ask the Coach</span>
        {hasMessages && !isExpanded && (
          <span className="text-[11px] text-[#969696] bg-white border border-[#ededf3] rounded-full px-[6px] py-[1px]">
            {messages.length} message{messages.length !== 1 ? 's' : ''}
          </span>
        )}
        {isLoading && <Loader2 size={14} className="text-[#ec5b16] animate-spin" />}
        {isExpanded ? <ChevronUp size={16} className="text-[#969696]" /> : <ChevronDown size={16} className="text-[#969696]" />}
      </button>

      {isExpanded && (
        <>
          {/* Message thread */}
          <div className="bg-white flex flex-col gap-[10px] p-[14px] max-h-[280px] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {messages.length === 0 && !isLoading ? (
              <p className="text-[13px] text-[#969696] text-center py-[12px]">
                Ask any question about the current position or a coaching tip.
              </p>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className={`flex flex-col gap-[4px] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  {/* Tip context badge */}
                  {msg.role === 'user' && msg.tipContext && (
                    <p className="text-[11px] text-[#969696] max-w-[85%] text-right line-clamp-1 italic">
                      Re: "{msg.tipContext.slice(0, 60)}{msg.tipContext.length > 60 ? '…' : ''}"
                    </p>
                  )}
                  <div
                    className={`rounded-[10px] px-[12px] py-[8px] max-w-[85%] text-[13px] leading-[20px] ${
                      msg.role === 'user'
                        ? 'bg-[#ec5b16] text-white'
                        : 'bg-[#f7f7f7] border border-[#ededf3] text-black'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      <div className="prose prose-sm max-w-none text-[13px] leading-[20px] text-black [&_p]:mb-1 [&_p:last-child]:mb-0">
                        <ReactMarkdown>{msg.text}</ReactMarkdown>
                      </div>
                    ) : (
                      msg.text
                    )}
                  </div>
                </div>
              ))
            )}
            {isLoading && (
              <div className="flex items-start gap-[8px]">
                <div className="bg-[#f7f7f7] border border-[#ededf3] rounded-[10px] px-[12px] py-[8px] flex items-center gap-[6px]">
                  <Loader2 size={12} className="text-[#ec5b16] animate-spin" />
                  <span className="text-[13px] text-[#969696]">Thinking...</span>
                </div>
              </div>
            )}
            {error && (
              <div className="flex items-center gap-[6px] bg-[#fef2f2] border border-[#fecaca] rounded-[8px] px-[10px] py-[6px]">
                <span className="text-[12px] text-[#dc2626]">{error}</span>
                <button onClick={() => setError(null)} className="ml-auto text-[#dc2626] hover:opacity-70">
                  <X size={12} />
                </button>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="bg-white border-t border-[#efefef] p-[10px]">
            <form onSubmit={handleSubmit} className="flex items-center gap-[8px]">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about this position or a tip..."
                disabled={isLoading}
                className="flex-1 px-[12px] py-[8px] bg-[#f7f7f7] border border-[#ededf3] rounded-[8px] text-[13px] text-black placeholder:text-[#969696] focus:outline-none focus:border-[#ec5b16] focus:ring-1 focus:ring-[#ec5b16]/20 disabled:opacity-50 transition-colors"
              />
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="flex items-center justify-center w-[34px] h-[34px] bg-[#ec5b16] hover:bg-[#d9520f] rounded-[8px] disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
              >
                <Send size={14} className="text-white" />
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

// ─── LiveAssistPanel ──────────────────────────────────────────────────────────

export function LiveAssistPanel() {
  const { sayThis, askThis } = useLiveAssist();
  const { activeResults, connectedServerCount } = useMCP();
  const visualIndexStore = useVisualIndexStore();
  const { sessionId, screenWsConnectionId, status, visualIndexPrompt, selectedGameId } = useSessionStore();

  const isRecording = status === 'recording';
  const { isRunning, sceneIndexId } = visualIndexStore;

  // Checkbox state
  const [checkedSayThis, setCheckedSayThis] = useState<Set<number>>(new Set());
  const [checkedAskThis, setCheckedAskThis] = useState<Set<number>>(new Set());

  // Chat pre-fill state — set when user clicks "Ask" on a tip
  // Use a counter so clicking the same tip twice still triggers the effect
  const [chatPrefill, setChatPrefill] = useState<{ question: string; tipContext: string; seq: number } | null>(null);
  const chatPrefillSeqRef = useRef(0);

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

  const handleToggleSayThis = useCallback((index: number) => {
    setCheckedSayThis((prev) => {
      const s = new Set(prev);
      s.has(index) ? s.delete(index) : s.add(index);
      return s;
    });
  }, []);

  const handleToggleAskThis = useCallback((index: number) => {
    setCheckedAskThis((prev) => {
      const s = new Set(prev);
      s.has(index) ? s.delete(index) : s.add(index);
      return s;
    });
  }, []);

  // "Ask" button on an insight card — pre-fill chat with the tip as context
  const handleAskAboutTip = useCallback((tipText: string) => {
    chatPrefillSeqRef.current += 1;
    setChatPrefill({ question: '', tipContext: tipText, seq: chatPrefillSeqRef.current });
  }, []);

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

  const getVisualAnalysisButtonText = () => {
    if (isVisualAnalysisLoading) return 'Loading...';
    if (isRunning) return 'Stop Visual Analysis';
    if (sceneIndexId) return 'Restart Visual Analysis';
    return 'Turn On Visual Analysis';
  };

  const showVisualAnalysisButton = isRecording && screenWsConnectionId;

  return (
    <div className="flex flex-col h-full gap-[20px] pt-[8px]">
      {/* Header */}
      <div className="flex items-center gap-[8px] shrink-0">
        <LightbulbIcon />
        <h2 className="flex-1 font-semibold text-[18px] text-black tracking-[0.09px]">Coaching Panel</h2>
        {showVisualAnalysisButton && (
          <button
            onClick={handleVisualAnalysisClick}
            disabled={isVisualAnalysisLoading}
            className={`flex items-center gap-[4px] px-[20px] py-[12px] rounded-[12px] shadow-[0px_1.272px_15.267px_0px_rgba(0,0,0,0.05)] transition-colors ${isVisualAnalysisLoading ? 'bg-[#ff4000]/70 cursor-not-allowed' : 'bg-[#ff4000] hover:bg-[#e63900]'}`}
          >
            {isVisualAnalysisLoading ? <Loader2 className="w-[20px] h-[20px] text-white animate-spin" /> : <DisplayIcon />}
            <span className="font-semibold text-[14px] text-white tracking-[-0.28px]">{getVisualAnalysisButtonText()}</span>
          </button>
        )}
      </div>

      {/* Panels */}
      <div className="flex-1 flex flex-col gap-[20px] min-h-0 overflow-hidden">
        {/* Tips */}
        <InsightSection
          title="Tips"
          icon={<SayThisIcon />}
          items={sayThis}
          checkedItems={checkedSayThis}
          onToggleItem={handleToggleSayThis}
          onAskItem={handleAskAboutTip}
          variant="say"
          emptyText="No gameplay tips yet - keep visual analysis running"
          scrollRef={sayThisScrollRef}
          className="flex-1 min-h-0"
        />

        {/* Analysis */}
        <InsightSection
          title="Analysis"
          icon={<AskThisIcon />}
          items={askThis}
          checkedItems={checkedAskThis}
          onToggleItem={handleToggleAskThis}
          onAskItem={handleAskAboutTip}
          variant="ask"
          emptyText="No tactical analysis yet - waiting for stronger gameplay signals"
          scrollRef={askThisScrollRef}
          className="flex-1 min-h-0"
        />

        {/* Chat */}
        <ChatPanel
          prefillQuestion={chatPrefill?.question ?? undefined}
          prefillTipContext={chatPrefill?.tipContext ?? undefined}
          prefillSeq={chatPrefill?.seq ?? undefined}
          onPrefillConsumed={() => setChatPrefill(null)}
        />

        {/* MCP Findings */}
        {connectedServerCount > 0 && (
          <div className="border border-[#efefef] rounded-[12px] overflow-hidden flex-1 min-h-0 flex flex-col">
            <div className="bg-[#f7f7f7] border-b border-[#efefef] px-[16px] py-[10px] shrink-0">
              <span className="font-medium text-[14px] text-black tracking-[0.07px]">MCP Findings</span>
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
