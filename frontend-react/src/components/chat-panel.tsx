import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ArrowLeft,
  History,
  Keyboard,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCcw,
  Send,
  Trash2,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { deleteChatSession, fetchChatMessages, fetchChatSessions, paperApiPath, streamSse } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  chatWidgetReducer,
  formatChatSessionDate,
  groupChatSessionsByAge,
  INITIAL_CHAT_WIDGET_STATE,
} from '@/lib/chat-widget';
import { navigate } from '@/lib/router';
import { ReasoningStreamPanel } from '@/components/reasoning-stream-panel';
import { RichContent } from '@/components/rich-content';
import type { ChatMessage, ChatSessionSummary } from '@/types';

interface ChatPanelProps {
  paperId: string;
}

interface LocalChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
}

function toLocalMessages(messages: ChatMessage[]): LocalChatMessage[] {
  return messages.map((message, index) => ({
    id: `${message.created_at ?? index}-${message.role}`,
    role: message.role,
    content: message.content,
  }));
}

export function ChatPanel({ paperId }: ChatPanelProps) {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [widgetState, dispatchWidget] = useReducer(chatWidgetReducer, INITIAL_CHAT_WIDGET_STATE);
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [messages, setMessages] = useState<LocalChatMessage[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [streamingAssistantId, setStreamingAssistantId] = useState<string | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [lastUserMessage, setLastUserMessage] = useState<string | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const historyBackButtonRef = useRef<HTMLButtonElement | null>(null);
  const sessionRequestIdRef = useRef(0);
  const hasRegenerateTarget = Boolean(currentSessionId && lastUserMessage);
  const groupedSessions = useMemo(() => groupChatSessionsByAge(sessions), [sessions]);
  const focusComposer = () => {
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  useEffect(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) {
      return;
    }
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'auto' });
  }, [isSending, messages, widgetState.isOpen, widgetState.view]);

  useEffect(() => {
    setCurrentSessionId(null);
    setMessages([]);
    setLastUserMessage(null);
    setStreamingAssistantId(null);
    setSessionsError(null);
    sessionRequestIdRef.current += 1;
    dispatchWidget({ type: 'reset' });

    if (isAuthLoading || !user) {
      setSessions([]);
      setIsLoadingSessions(false);
      return;
    }

    let active = true;
    const loadSessions = async () => {
      setIsLoadingSessions(true);
      setSessionsError(null);
      try {
        const nextSessions = await fetchChatSessions(paperId);
        if (active) {
          setSessions(nextSessions);
        }
      } catch {
        if (active) {
          setSessions([]);
          setSessionsError('历史对话加载失败，请稍后重试。');
        }
      } finally {
        if (active) {
          setIsLoadingSessions(false);
        }
      }
    };

    void loadSessions();
    return () => {
      active = false;
    };
  }, [isAuthLoading, paperId, user]);

  const refreshSessions = async () => {
    if (isAuthLoading || !user) {
      setSessions([]);
      return;
    }
    setIsLoadingSessions(true);
    setSessionsError(null);
    try {
      const nextSessions = await fetchChatSessions(paperId);
      setSessions(nextSessions);
    } catch {
      setSessions([]);
      setSessionsError('历史对话加载失败，请稍后重试。');
    } finally {
      setIsLoadingSessions(false);
    }
  };

  const newChatSession = () => {
    if (isSending) {
      return;
    }
    sessionRequestIdRef.current += 1;
    setCurrentSessionId(window.crypto.randomUUID());
    setMessages([]);
    setLastUserMessage(null);
    setStreamingAssistantId(null);
    setIsLoadingMessages(false);
    dispatchWidget({ type: 'show-chat' });
    focusComposer();
  };

  const switchSession = async (sessionId: string) => {
    if (isSending) {
      return;
    }
    const requestId = sessionRequestIdRef.current + 1;
    sessionRequestIdRef.current = requestId;
    setCurrentSessionId(sessionId);
    setIsLoadingMessages(true);
    setStreamingAssistantId(null);
    dispatchWidget({ type: 'show-chat' });
    focusComposer();
    try {
      const nextMessages = await fetchChatMessages(sessionId);
      if (sessionRequestIdRef.current !== requestId) {
        return;
      }
      setMessages(toLocalMessages(nextMessages));
      const lastUser = [...nextMessages].reverse().find((message) => message.role === 'user');
      setLastUserMessage(lastUser?.content ?? null);
    } catch {
      if (sessionRequestIdRef.current !== requestId) {
        return;
      }
      setMessages([]);
      setLastUserMessage(null);
    } finally {
      if (sessionRequestIdRef.current === requestId) {
        setIsLoadingMessages(false);
      }
    }
  };

  const removeSession = async (sessionId: string) => {
    if (isSending) {
      return;
    }
    setSessionsError(null);
    try {
      await deleteChatSession(sessionId);
    } catch {
      setSessionsError('删除会话失败，请稍后重试。');
      return;
    }

    if (currentSessionId === sessionId) {
      sessionRequestIdRef.current += 1;
      setCurrentSessionId(null);
      setMessages([]);
      setLastUserMessage(null);
      setStreamingAssistantId(null);
    }
    await refreshSessions();
  };

  const sendStream = async (url: string, body: object, assistantId: string) => {
    let didReceiveDone = false;
    await streamSse(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      {
        onChunk: (chunk) => {
          setMessages((currentMessages) =>
            currentMessages.map((message) =>
              message.id === assistantId ? { ...message, content: message.content + chunk } : message,
            ),
          );
        },
        onEvent: (event, data) => {
          if (event === 'reasoning') {
            setMessages((currentMessages) =>
              currentMessages.map((message) =>
                message.id === assistantId
                  ? { ...message, reasoning: `${message.reasoning ?? ''}${data}` }
                  : message,
              ),
            );
          }
          if (event === 'error') {
            throw new Error(data || '对话流中断');
          }
          if (event === 'done') {
            didReceiveDone = true;
            setMessages((currentMessages) =>
              currentMessages.map((message) =>
                message.id === assistantId ? { ...message, reasoning: '' } : message,
              ),
            );
          }
        },
      },
    );

    if (!didReceiveDone) {
      throw new Error('对话未正常完成');
    }
  };

  const submitMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || isSending) {
      return;
    }
    if (!user) {
      navigate('/login');
      return;
    }

    const sessionId = currentSessionId ?? window.crypto.randomUUID();
    if (!currentSessionId) {
      setCurrentSessionId(sessionId);
    }

    const userMessage: LocalChatMessage = {
      id: window.crypto.randomUUID(),
      role: 'user',
      content: trimmed,
    };
    const assistantId = window.crypto.randomUUID();
    setMessages((currentMessages) => [
      ...currentMessages,
      userMessage,
      { id: assistantId, role: 'assistant', content: '', reasoning: '' },
    ]);
    setInput('');
    setIsSending(true);
    setStreamingAssistantId(assistantId);

    try {
      await sendStream(paperApiPath(paperId, '/chat'), {
        message: trimmed,
        session_id: sessionId,
      }, assistantId);
      setLastUserMessage(trimmed);
      await refreshSessions();
    } catch (error) {
      const message = error instanceof Error ? error.message : '发送失败';
      setMessages((currentMessages) =>
        currentMessages.map((currentMessage) =>
          currentMessage.id === assistantId
            ? { ...currentMessage, content: `发送失败: ${message}`, reasoning: '' }
            : currentMessage,
        ),
      );
    } finally {
      setIsSending(false);
      setStreamingAssistantId(null);
    }
  };

  const regenerate = async () => {
    if (!currentSessionId || !lastUserMessage || isSending) {
      return;
    }
    if (!user) {
      navigate('/login');
      return;
    }

    const assistantId = window.crypto.randomUUID();
    setMessages((currentMessages) => {
      const lastAssistantIndex = [...currentMessages]
        .map((message, index) => ({ message, index }))
        .reverse()
        .find((entry) => entry.message.role === 'assistant')?.index;

      const pruned =
        lastAssistantIndex === undefined
          ? currentMessages
          : currentMessages.filter((_, index) => index !== lastAssistantIndex);

      return [...pruned, { id: assistantId, role: 'assistant', content: '', reasoning: '' }];
    });
    setIsSending(true);
    setStreamingAssistantId(assistantId);

    try {
      await sendStream(paperApiPath(paperId, '/chat/regenerate'), {
        message: lastUserMessage,
        session_id: currentSessionId,
      }, assistantId);
      await refreshSessions();
    } catch (error) {
      const message = error instanceof Error ? error.message : '重新生成失败';
      setMessages((currentMessages) =>
        currentMessages.map((currentMessage) =>
          currentMessage.id === assistantId
            ? { ...currentMessage, content: `重新生成失败: ${message}`, reasoning: '' }
            : currentMessage,
        ),
      );
    } finally {
      setIsSending(false);
      setStreamingAssistantId(null);
    }
  };

  const closeWidget = () => dispatchWidget({ type: 'close' });
  const showConversation = () => {
    dispatchWidget({ type: 'show-chat' });
    focusComposer();
  };
  const openHistory = () => {
    if (!isSending && user) {
      dispatchWidget({ type: 'show-history' });
      window.requestAnimationFrame(() => historyBackButtonRef.current?.focus());
    }
  };
  const selectSuggestedQuestion = (question: string) => {
    setInput(question);
    focusComposer();
  };

  const conversationView = (
    <section
      key="chat"
      className="paper-chat-view paper-chat-view-chat flex min-h-0 flex-1 flex-col"
      aria-labelledby="paper-chat-title"
      data-chat-view="chat"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#f1e8dc] bg-[linear-gradient(135deg,#fffaf0_0%,#ffffff_72%)] px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#fff0cf] text-[#e87900] ring-1 ring-[#ffd99a]">
            <MessageSquare className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="paper-chat-title" className="truncate text-base font-semibold text-[#172033]">论文对话</h2>
            <p className="truncate text-[11px] text-[#8a7b68]">围绕当前论文继续追问</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full text-[#5f6877] hover:bg-[#fff1d6] hover:text-[#c45f00]"
            onClick={openHistory}
            disabled={isAuthLoading || !user || isSending}
            aria-label="查看历史对话"
            title={isSending ? '回复完成后可查看历史对话' : '历史对话'}
          >
            <History className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full text-[#5f6877] hover:bg-[#fff1f2] hover:text-[#dc2626]"
            onClick={closeWidget}
            aria-label="关闭论文对话"
            title="关闭论文对话"
          >
            <X className="h-[18px] w-[18px]" aria-hidden="true" />
          </Button>
        </div>
      </header>

      {isAuthLoading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-sm text-[#728095]">
          <div className="flex items-center gap-2 rounded-full bg-[#f8fafc] px-4 py-2.5">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            加载账号状态...
          </div>
        </div>
      ) : !user ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-7 py-8 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-[22px] bg-[#fff4db] text-[#f08a00] ring-1 ring-[#ffdda3]">
            <MessageSquare className="h-6 w-6" aria-hidden="true" />
          </span>
          <h3 className="mt-5 text-lg font-semibold text-[#172033]">登录后与论文对话</h3>
          <p className="mt-2 max-w-sm text-sm leading-6 text-[#728095]">
            登录后可以继续追问论文内容，并在不同设备间同步历史会话。
          </p>
          <Button
            className="mt-5 rounded-full bg-gradient-to-r from-[#ffad1f] to-[#ff7a00] px-5 text-white shadow-[0_10px_24px_rgba(255,122,0,0.22)]"
            onClick={() => navigate('/login')}
          >
            登录后使用
          </Button>
        </div>
      ) : (
        <>
          <div
            ref={messagesViewportRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 [@media(max-height:720px)]:py-3"
            aria-live="polite"
            aria-busy={isSending}
          >
            {isLoadingMessages ? (
              <div className="flex items-center gap-2 text-sm text-[#728095]">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                加载聊天记录...
              </div>
            ) : messages.length === 0 ? (
              <div className="flex min-h-full flex-col items-center justify-center py-4 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-[20px] bg-[#fff4db] text-[#ef8600] ring-1 ring-[#ffe0a8]">
                  <MessageSquare className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-base font-semibold text-[#172033]">从这篇论文开始问</h3>
                <p className="mt-1.5 max-w-xs text-xs leading-5 text-[#7a8798]">
                  可以让它解释方法、实验设置、主要结论，或梳理论文的核心贡献。
                </p>
                <div className="mt-5 grid w-full max-w-sm gap-2 text-left">
                  {[
                    '这篇论文主要解决了什么问题？',
                    '核心方法相比已有工作有哪些创新？',
                    '实验结果支持了哪些关键结论？',
                  ].map((question) => (
                    <button
                      key={question}
                      type="button"
                      className="rounded-2xl border border-[#e8edf3] bg-[#fbfcfe] px-3.5 py-2.5 text-xs leading-5 text-[#526174] transition hover:-translate-y-0.5 hover:border-[#ffd18a] hover:bg-[#fffaf0] hover:text-[#a95300] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffb23f]"
                      onClick={() => selectSuggestedQuestion(question)}
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message) => {
                  const isStreamingAssistant = isSending && message.id === streamingAssistantId;
                  const showReasoning = message.role === 'assistant' && isStreamingAssistant && message.reasoning;
                  const showAssistantContent = message.content || !showReasoning;

                  return (
                    <div
                      key={message.id}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 ${
                          message.role === 'user'
                            ? 'bg-gradient-to-r from-[#ff9f0a] to-[#ff7a00] text-white shadow-[0_8px_20px_rgba(255,122,0,0.16)]'
                            : 'border border-[#edf2f7] bg-[#fbfcfe] text-[#223045]'
                        }`}
                      >
                        {message.role === 'assistant' ? (
                          <>
                            {showReasoning ? (
                              <ReasoningStreamPanel reasoning={message.reasoning ?? ''} className={message.content ? 'mb-3' : ''} />
                            ) : null}
                            {showAssistantContent ? (
                              <RichContent
                                content={message.content || '...'}
                                isStreaming={isStreamingAssistant}
                                className="markdown-body text-sm"
                              />
                            ) : null}
                          </>
                        ) : (
                          message.content
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-[#eef2f7] bg-white/95 p-3.5 backdrop-blur [@media(max-height:720px)]:p-3">
            {hasRegenerateTarget ? (
              <div className="flex flex-wrap items-center gap-2 pb-2.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-full border-[#e3e8ef] bg-white text-xs text-[#64748b]"
                  onClick={regenerate}
                  disabled={isSending}
                >
                  <RefreshCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  重新回复
                </Button>
              </div>
            ) : null}

            <div className="flex items-end gap-2 rounded-[22px] border border-[#dce3ec] bg-[#f8fafc] p-2 shadow-[0_8px_24px_rgba(15,23,42,0.06)] transition focus-within:border-[#ffb23f] focus-within:bg-white focus-within:shadow-[0_10px_30px_rgba(255,153,0,0.12)]">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-10 w-10 shrink-0 rounded-full text-[#7b8798] hover:bg-[#fff2d8] hover:text-[#c45f00]"
                onClick={newChatSession}
                disabled={isSending}
                aria-label="新建对话"
                title="新建对话"
              >
                <Plus className="h-[18px] w-[18px]" aria-hidden="true" />
              </Button>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && event.shiftKey) {
                    event.preventDefault();
                    void submitMessage();
                  }
                }}
                rows={2}
                placeholder="向这篇论文提问..."
                aria-label="向这篇论文提问"
                className="max-h-36 min-h-[52px] min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-sm leading-5 text-[#1e293b] outline-none placeholder:text-[#9aa5b4]"
              />
              <Button
                type="button"
                size="icon"
                onClick={() => void submitMessage()}
                disabled={isSending || !input.trim()}
                className="h-10 w-10 shrink-0 rounded-full bg-gradient-to-br from-[#ffad1f] to-[#ff7a00] text-white shadow-[0_8px_18px_rgba(255,122,0,0.24)] hover:from-[#ff9d00] hover:to-[#f36b00]"
                aria-label="发送消息"
                title="发送消息"
              >
                {isSending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
              </Button>
            </div>
            <div className="mt-2 flex items-center justify-center gap-1.5 text-[10px] text-[#9aa5b4] [@media(max-height:680px)]:hidden">
              <Keyboard className="h-3 w-3" aria-hidden="true" />
              <span>Shift + Enter 发送，回答仅供参考</span>
            </div>
          </div>
        </>
      )}
    </section>
  );

  const historyView = (
    <section
      key="history"
      className="paper-chat-view paper-chat-view-history flex min-h-0 flex-1 flex-col"
      aria-labelledby="paper-chat-history-title"
      data-chat-view="history"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#f1e8dc] bg-[linear-gradient(135deg,#fffaf0_0%,#ffffff_72%)] px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            ref={historyBackButtonRef}
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-full text-[#5f6877] hover:bg-[#fff1d6] hover:text-[#c45f00]"
            onClick={showConversation}
            aria-label="返回论文对话"
            title="返回论文对话"
          >
            <ArrowLeft className="h-[18px] w-[18px]" aria-hidden="true" />
          </Button>
          <div className="min-w-0">
            <h2 id="paper-chat-history-title" className="truncate text-base font-semibold text-[#172033]">历史对话</h2>
            <p className="truncate text-[11px] text-[#8a7b68]">当前论文的会话记录</p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-full text-[#5f6877] hover:bg-[#fff1f2] hover:text-[#dc2626]"
          onClick={closeWidget}
          aria-label="关闭论文对话"
          title="关闭论文对话"
        >
          <X className="h-[18px] w-[18px]" aria-hidden="true" />
        </Button>
      </header>

      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#eef2f7] px-4 py-3">
        <div>
          <div className="text-xs font-medium text-[#526174]">{sessions.length} 个历史会话</div>
          <div className="mt-0.5 text-[10px] text-[#9aa5b4]">选择一条即可继续追问</div>
        </div>
        <Button
          type="button"
          size="sm"
          className="h-8 rounded-full bg-[#fff2d8] px-3 text-xs text-[#b65a00] shadow-none hover:bg-[#ffe7b4]"
          onClick={newChatSession}
          disabled={isSending}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          新对话
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        {sessionsError && sessions.length ? (
          <div className="mb-3 rounded-2xl border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-xs text-[#9a5600]">
            {sessionsError}
          </div>
        ) : null}

        {isLoadingSessions ? (
          <div className="space-y-3" aria-label="历史对话加载中">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-16 animate-pulse rounded-2xl bg-[#f1f5f9]" />
            ))}
          </div>
        ) : sessionsError && sessions.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center text-center">
            <div className="rounded-2xl border border-[#fed7aa] bg-[#fff7ed] px-4 py-3 text-sm text-[#9a5600]">
              {sessionsError}
            </div>
            <Button variant="outline" size="sm" className="mt-3 rounded-full" onClick={() => void refreshSessions()}>
              <RefreshCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              重新加载
            </Button>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center px-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-[20px] bg-[#f8fafc] text-[#94a3b8] ring-1 ring-[#e2e8f0]">
              <History className="h-5 w-5" aria-hidden="true" />
            </span>
            <h3 className="mt-4 text-sm font-semibold text-[#334155]">还没有历史对话</h3>
            <p className="mt-1.5 text-xs leading-5 text-[#8a96a8]">发送第一条问题后，会话会自动保存到这里。</p>
          </div>
        ) : (
          <div className="space-y-5">
            {groupedSessions.map((group) => (
              <section key={group.id} aria-labelledby={`chat-session-group-${group.id}`}>
                <h3 id={`chat-session-group-${group.id}`} className="mb-2 px-1 text-[11px] font-semibold tracking-wide text-[#8a96a8]">
                  {group.label}
                </h3>
                <div className="space-y-2">
                  {group.sessions.map((session) => {
                    const isCurrent = session.id === currentSessionId;
                    const title = session.title || '未命名对话';
                    return (
                      <div
                        key={session.id}
                        className={`group flex items-center rounded-2xl border transition ${
                          isCurrent
                            ? 'border-[#ffc76f] bg-[#fff9ed] shadow-[0_8px_20px_rgba(255,153,0,0.08)]'
                            : 'border-[#e6ebf2] bg-white hover:border-[#ffd69a] hover:bg-[#fffdf8]'
                        }`}
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 rounded-l-2xl px-3.5 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#ffb23f] disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => void switchSession(session.id)}
                          disabled={isSending}
                          aria-current={isCurrent ? 'true' : undefined}
                        >
                          <span className={`block line-clamp-2 text-sm font-medium leading-5 ${isCurrent ? 'text-[#9a5600]' : 'text-[#334155]'}`}>
                            {title}
                          </span>
                          <span className="mt-1 flex items-center gap-2 text-[10px] text-[#94a3b8]">
                            <span>{formatChatSessionDate(session.created_at)}</span>
                            {isCurrent ? <span className="rounded-full bg-[#ffedc7] px-1.5 py-0.5 font-medium text-[#b65a00]">当前</span> : null}
                          </span>
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="mr-2 h-9 w-9 shrink-0 rounded-full text-[#a0aabc] opacity-70 hover:bg-[#fff1f2] hover:text-[#e11d48] group-hover:opacity-100"
                          onClick={() => void removeSession(session.id)}
                          disabled={isSending}
                          aria-label={`删除对话：${title}`}
                          title="删除对话"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  );

  return (
    <Popover
      open={widgetState.isOpen}
      onOpenChange={(isOpen) => dispatchWidget({ type: isOpen ? 'open' : 'close' })}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="paper-chat-corner paper-chat-launcher group fixed z-[60] flex h-[3.75rem] w-[3.75rem] items-center justify-center rounded-full bg-[linear-gradient(135deg,#ffc84a_0%,#ff9900_50%,#ff7600_100%)] text-white shadow-[0_16px_38px_rgba(234,106,0,0.34),0_4px_12px_rgba(15,23,42,0.12)] ring-4 ring-white/80 transition-[opacity,transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-[0_20px_44px_rgba(234,106,0,0.40),0_6px_14px_rgba(15,23,42,0.14)] focus-visible:outline-none focus-visible:ring-[5px] focus-visible:ring-[#ffe1a8] data-[state=open]:pointer-events-none data-[state=open]:opacity-0 motion-reduce:transition-none"
          aria-label="打开论文对话"
          title="打开论文对话"
          data-chat-widget="launcher"
        >
          <MessageSquare className="h-6 w-6 transition-transform duration-300 group-hover:scale-110" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={-60}
        avoidCollisions={false}
        onInteractOutside={(event) => event.preventDefault()}
        className="paper-chat-window z-[60] flex h-[min(44rem,calc(100dvh-6.5rem))] w-[calc(var(--radix-popover-content-available-width)-1rem)] max-w-[30rem] origin-bottom-right overflow-hidden rounded-[30px] border border-white/80 bg-white p-0 text-[#172033] shadow-[0_32px_90px_rgba(15,23,42,0.20),0_8px_24px_rgba(255,122,0,0.10)] outline-none ring-1 ring-black/5 motion-reduce:animate-none"
        aria-label="论文对话"
        data-chat-widget="panel"
        data-chat-view={widgetState.view}
      >
        <div className="paper-chat-window-content flex min-h-0 w-full flex-1 flex-col bg-white">
          {widgetState.view === 'history' ? historyView : conversationView}
        </div>
      </PopoverContent>
    </Popover>
  );
}
