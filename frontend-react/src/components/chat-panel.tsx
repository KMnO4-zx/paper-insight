import { useEffect, useRef, useState } from 'react';
import {
  History,
  Keyboard,
  Loader2,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCcw,
  Send,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { deleteChatSession, fetchChatMessages, fetchChatSessions, paperApiPath, streamSse } from '@/lib/api';
import { useAuth } from '@/lib/auth';
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
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [messages, setMessages] = useState<LocalChatMessage[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [streamingAssistantId, setStreamingAssistantId] = useState<string | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [desktopHistoryMode, setDesktopHistoryMode] = useState<'compact' | 'hidden'>('hidden');
  const [lastUserMessage, setLastUserMessage] = useState<string | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const hasRegenerateTarget = Boolean(currentSessionId && lastUserMessage);

  useEffect(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) {
      return;
    }
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'auto' });
  }, [messages, isSending]);

  useEffect(() => {
    setCurrentSessionId(null);
    setMessages([]);
    setLastUserMessage(null);
    setStreamingAssistantId(null);
    setShowHistory(false);
    setDesktopHistoryMode('hidden');

    if (isAuthLoading || !user) {
      setSessions([]);
      setIsLoadingSessions(false);
      return;
    }

    let active = true;
    const loadSessions = async () => {
      setIsLoadingSessions(true);
      try {
        const nextSessions = await fetchChatSessions(paperId);
        if (active) {
          setSessions(nextSessions);
        }
      } catch {
        if (active) {
          setSessions([]);
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
    try {
      const nextSessions = await fetchChatSessions(paperId);
      setSessions(nextSessions);
    } catch {
      setSessions([]);
    }
  };

  const newChatSession = () => {
    setCurrentSessionId(window.crypto.randomUUID());
    setMessages([]);
    setLastUserMessage(null);
    setStreamingAssistantId(null);
  };

  const switchSession = async (sessionId: string) => {
    setCurrentSessionId(sessionId);
    setIsLoadingMessages(true);
    setShowHistory(false);
    setStreamingAssistantId(null);
    try {
      const nextMessages = await fetchChatMessages(sessionId);
      setMessages(toLocalMessages(nextMessages));
      const lastUser = [...nextMessages].reverse().find((message) => message.role === 'user');
      setLastUserMessage(lastUser?.content ?? null);
    } catch {
      setMessages([]);
      setLastUserMessage(null);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const removeSession = async (sessionId: string) => {
    try {
      await deleteChatSession(sessionId);
    } catch {
      return;
    }

    if (currentSessionId === sessionId) {
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

  if (isAuthLoading) {
    return (
      <section className="flex min-h-[min(22rem,calc(100dvh-12rem))] flex-col rounded-[28px] bg-white p-6 shadow-sm ring-1 ring-black/5">
        <div className="flex items-center gap-2 text-sm text-[#728095]">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载账号状态...
        </div>
      </section>
    );
  }

  if (!user) {
    return (
      <section className="flex min-h-[min(22rem,calc(100dvh-12rem))] flex-col rounded-[28px] bg-white p-6 shadow-sm ring-1 ring-black/5">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-[#ff9900]" />
          <div className="text-sm font-semibold text-[#1e293b]">论文对话</div>
        </div>
        <div className="mt-6 rounded-2xl border border-dashed border-[#d8e0ea] bg-[#f8fafc] p-6 text-sm leading-6 text-[#728095]">
          登录后可以与论文对话，并同步历史会话。
        </div>
        <Button
          className="mt-4 w-fit rounded-full bg-gradient-to-r from-[#ff9900] to-[#ff7a00] text-white"
          onClick={() => navigate('/login')}
        >
          登录后使用
        </Button>
      </section>
    );
  }

  return (
    <section className="flex h-[calc(100dvh-12rem)] min-h-[min(22rem,calc(100dvh-12rem))] flex-col overflow-hidden rounded-[28px] bg-white shadow-sm ring-1 ring-black/5">
      <div className="border-b border-[#eef2f7] px-4 py-4 [@media(max-height:720px)]:py-3">
        <div className="flex min-h-12 items-center justify-between gap-3 [@media(max-height:720px)]:min-h-10">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[#fff7ed] text-[#ff9900] ring-1 ring-[#fed7aa]">
              <MessageSquare className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-[#1e293b]">论文对话</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full text-[#1f2a3a] hover:bg-[#fff7ed] hover:text-[#c2410c]"
              onClick={newChatSession}
              title="新对话"
              aria-label="新对话"
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full text-[#1f2a3a] hover:bg-[#f8fafc] lg:hidden"
              onClick={() => setShowHistory((visible) => !visible)}
              title="历史对话"
              aria-label="历史对话"
            >
              <History className="h-4 w-4" />
            </Button>
            <div className="hidden items-center gap-1 lg:flex">
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full text-[#1f2a3a] hover:bg-[#f8fafc]"
                onClick={() =>
                  setDesktopHistoryMode((mode) => (mode === 'hidden' ? 'compact' : 'hidden'))
                }
                title={desktopHistoryMode === 'hidden' ? '显示历史对话' : '隐藏历史对话'}
              >
                {desktopHistoryMode === 'hidden' ? (
                  <PanelRightOpen className="h-4 w-4" />
                ) : (
                  <PanelRightClose className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
        <div className="mt-1 flex justify-end [@media(max-height:720px)]:hidden">
          <div className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-[#8a98ac]">
            <Keyboard className="h-3.5 w-3.5" />
            <span>Shift + Enter 发送消息</span>
          </div>
        </div>
      </div>

      <div
        className={`grid min-h-0 flex-1 gap-0 ${
          desktopHistoryMode === 'hidden'
            ? 'lg:grid-cols-[minmax(0,1fr)]'
            : 'lg:grid-cols-[minmax(0,1fr)_12rem]'
        }`}
      >
        <div className="flex min-h-0 flex-col">
          <div ref={messagesViewportRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 [@media(max-height:720px)]:py-3">
            {isLoadingMessages ? (
              <div className="flex items-center gap-2 text-sm text-[#728095]">
                <Loader2 className="h-4 w-4 animate-spin" />
                加载聊天记录...
              </div>
            ) : messages.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#d8e0ea] bg-[#f8fafc] p-6 text-sm leading-6 text-[#728095] [@media(max-height:720px)]:p-4">
                输入问题，开始与论文对话。你可以让它解释方法、实验设置、结论，或者直接总结论文的贡献。
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
                            ? 'bg-gradient-to-r from-[#ff9900] to-[#ff7a00] text-white'
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

          <div className="shrink-0 border-t border-[#eef2f7] p-4 [@media(max-height:720px)]:p-3">
            {hasRegenerateTarget ? (
              <div className="flex flex-wrap items-center gap-2 pb-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={regenerate}
                  disabled={isSending}
                >
                  <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
                  重新回复
                </Button>
              </div>
            ) : null}

            <div className="flex gap-3">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && event.shiftKey) {
                    event.preventDefault();
                    void submitMessage();
                  }
                }}
                rows={3}
                placeholder="输入你的问题..."
                className="min-h-[88px] flex-1 resize-none rounded-2xl border border-[#d6deea] bg-[#f8fafc] px-4 py-3 text-sm leading-6 text-[#1e293b] outline-none transition focus:border-[#ff9900] focus:bg-white [@media(max-height:720px)]:min-h-[72px]"
              />
              <Button
                onClick={() => void submitMessage()}
                disabled={isSending}
                className="h-auto rounded-2xl bg-gradient-to-r from-[#ff9900] to-[#ff7a00] px-5 py-3 text-white"
              >
                {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>

        <aside
          className={`fixed inset-x-4 bottom-4 top-28 z-20 overflow-hidden rounded-[28px] border border-[#eef2f7] bg-white shadow-xl lg:static lg:inset-auto lg:top-auto lg:z-auto lg:rounded-none lg:border-0 lg:border-l lg:shadow-none ${
            showHistory ? 'block' : 'hidden'
          } ${desktopHistoryMode === 'hidden' ? 'lg:hidden' : 'lg:block'}`}
        >
          <div className="border-b border-[#eef2f7] px-4 py-3 text-sm font-semibold text-[#223045]">
            <div className="flex items-center justify-between gap-3">
              <span>历史对话</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full lg:hidden"
                onClick={() => setShowHistory(false)}
              >
                <PanelRightClose className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="h-[calc(100%-3.25rem)] overflow-y-auto overscroll-contain p-3">
            {isLoadingSessions ? (
              <div className="flex items-center gap-2 text-sm text-[#728095]">
                <Loader2 className="h-4 w-4 animate-spin" />
                加载中...
              </div>
            ) : sessions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#d8e0ea] p-4 text-sm text-[#728095]">
                暂无历史会话
              </div>
            ) : (
              <div className="space-y-2">
                {sessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => void switchSession(session.id)}
                    className={`w-full rounded-2xl border px-3 py-3 text-left text-sm transition ${
                      session.id === currentSessionId
                        ? 'border-[#ffcc80] bg-[#fff7ed] text-[#9a5600]'
                        : 'border-[#e3eaf2] bg-white text-[#475569]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className={`flex-1 font-medium ${desktopHistoryMode === 'compact' ? 'line-clamp-3 break-all' : 'line-clamp-2'}`}>
                        {session.title || '未命名对话'}
                      </div>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation();
                          void removeSession(session.id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            event.stopPropagation();
                            void removeSession(session.id);
                          }
                        }}
                        className="rounded-full p-1 text-[#94a3b8] transition hover:bg-[#fff1f2] hover:text-[#e11d48]"
                      >
                        <Trash2 className="h-4 w-4" />
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
