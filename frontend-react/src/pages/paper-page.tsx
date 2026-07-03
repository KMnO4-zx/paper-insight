import { useCallback, useEffect, useRef, useState } from 'react';
import { Bookmark, ChevronDown, ChevronLeft, ExternalLink, Eye, FileText, Heart, Loader2, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ActiveModelBadge } from '@/components/active-model-badge';
import { ChatPanel } from '@/components/chat-panel';
import { CodeAvailabilityBadge } from '@/components/code-availability-badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ReasoningStreamPanel } from '@/components/reasoning-stream-panel';
import { RichContent } from '@/components/rich-content';
import { fetchOpenInAiPrompt, fetchPaperInfo, fetchPaperMarks, paperApiPath, streamSse, updatePaperMark } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { buildPaperKeywordSearchPath } from '@/lib/constants';
import { getVenueParts, normalizeKeywords } from '@/lib/content';
import { useZoteroPaperMetadata } from '@/hooks/use-zotero-paper-metadata';
import { navigate } from '@/lib/router';
import type { Paper } from '@/types';

interface PaperPageProps {
  paperId: string;
}

const BACK_BUTTON_FADE_DISTANCE = 72;
const BACK_BUTTON_MAX_TRANSLATE_Y = 8;
const AUTO_VIEWED_DELAY_MS = 10_000;
const EMPTY_MARKS = { viewed: false, liked: false, favorited: false };

function buildChatGptUrl(prompt: string) {
  const params = new URLSearchParams({
    hints: 'search',
    q: prompt,
  });
  return `https://chatgpt.com/?${params.toString()}`;
}

export function PaperPage({ paperId }: PaperPageProps) {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [paper, setPaper] = useState<Paper | null>(null);
  const [paperError, setPaperError] = useState<string | null>(null);
  const [paperLoading, setPaperLoading] = useState(true);
  const [analysisText, setAnalysisText] = useState('');
  const [analysisReasoning, setAnalysisReasoning] = useState('');
  const [analysisStatus, setAnalysisStatus] = useState('正在获取论文信息...');
  const [analysisLoading, setAnalysisLoading] = useState(true);
  const [analysisStreaming, setAnalysisStreaming] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [openInAiPrompt, setOpenInAiPrompt] = useState('');
  const [openInAiPromptError, setOpenInAiPromptError] = useState<string | null>(null);
  const [marks, setMarks] = useState(EMPTY_MARKS);
  const [isLikeAnimating, setIsLikeAnimating] = useState(false);
  const [backButtonProgress, setBackButtonProgress] = useState(0);
  const analysisRequestIdRef = useRef(0);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const zoteroMetadataPaper = paper?.id === paperId ? paper : null;

  useZoteroPaperMetadata(zoteroMetadataPaper);

  useEffect(() => {
    let active = true;
    setMarks(EMPTY_MARKS);
    if (isAuthLoading || !user) {
      return () => {
        active = false;
      };
    }
    void fetchPaperMarks([paperId])
      .then((nextMarks) => {
        if (active) {
          setMarks(nextMarks[paperId] ?? EMPTY_MARKS);
        }
      })
      .catch(() => {
        if (active) {
          setMarks(EMPTY_MARKS);
        }
      });
    return () => {
      active = false;
    };
  }, [isAuthLoading, paperId, user]);

  useEffect(() => {
    if (isAuthLoading || !user || !paper || paperError || marks.viewed) {
      return;
    }

    let active = true;
    const timerId = window.setTimeout(() => {
      void updatePaperMark(paperId, { viewed: true })
        .then((nextMarks) => {
          if (active) {
            setMarks(nextMarks);
          }
        })
        .catch(() => {
          // Keep the page quiet; manual marking still remains available.
        });
    }, AUTO_VIEWED_DELAY_MS);

    return () => {
      active = false;
      window.clearTimeout(timerId);
    };
  }, [isAuthLoading, marks.viewed, paper, paperError, paperId, user]);

  useEffect(() => {
    const handleScroll = () => {
      const nextProgress = Math.min(Math.max(window.scrollY / BACK_BUTTON_FADE_DISTANCE, 0), 1);
      setBackButtonProgress(nextProgress);
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    let active = true;
    setPaperLoading(true);
    setPaperError(null);

    void fetchPaperInfo(paperId)
      .then((payload) => {
        if (active) {
          setPaper(payload);
        }
      })
      .catch((error) => {
        if (active) {
          setPaperError(error instanceof Error ? error.message : '加载失败');
          setPaper(null);
        }
      })
      .finally(() => {
        if (active) {
          setPaperLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [paperId]);

  const loadAnalysis = useCallback(async (reanalyze = false) => {
    analysisAbortRef.current?.abort();
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    const requestId = analysisRequestIdRef.current + 1;
    analysisRequestIdRef.current = requestId;

    setAnalysisText('');
    setAnalysisReasoning('');
    setAnalysisError(null);
    setAnalysisLoading(true);
    setAnalysisStreaming(true);
    setAnalysisStatus(reanalyze ? '正在重新分析论文...' : '正在获取论文信息...');

    try {
      await streamSse(
        paperApiPath(paperId, reanalyze ? '?reanalyze=true' : ''),
        { method: 'GET', signal: controller.signal },
        {
          onChunk: (chunk) => {
            if (analysisRequestIdRef.current !== requestId) {
              return;
            }
            setAnalysisLoading(false);
            setAnalysisText((current) => current + chunk);
          },
          onEvent: (event, data) => {
            if (analysisRequestIdRef.current !== requestId) {
              return;
            }
            if (event === 'status') {
              setAnalysisStatus(data);
            }
            if (event === 'reasoning') {
              setAnalysisLoading(false);
              setAnalysisReasoning((current) => current + data);
            }
            if (event === 'error') {
              setAnalysisLoading(false);
              setAnalysisStreaming(false);
              setAnalysisReasoning('');
              setAnalysisError(data || '分析失败');
            }
            if (event === 'done') {
              setAnalysisLoading(false);
              setAnalysisStreaming(false);
              setAnalysisReasoning('');
              setAnalysisStatus('');
              void fetchPaperInfo(paperId).then(setPaper).catch(() => {
                // The analysis result is already available; keep the existing metadata if refresh fails.
              });
            }
          },
        },
      );
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      setAnalysisLoading(false);
      setAnalysisStreaming(false);
      setAnalysisReasoning('');
      setAnalysisError(error instanceof Error ? error.message : '分析失败');
    } finally {
      if (analysisAbortRef.current === controller) {
        analysisAbortRef.current = null;
      }
    }
  }, [paperId]);

  useEffect(() => {
    void loadAnalysis(false);
    return () => {
      analysisAbortRef.current?.abort();
      analysisAbortRef.current = null;
    };
  }, [loadAnalysis]);

  useEffect(() => {
    let active = true;
    setOpenInAiPrompt('');
    setOpenInAiPromptError(null);

    void fetchOpenInAiPrompt(paperId)
      .then((prompt) => {
        if (active) {
          setOpenInAiPrompt(prompt);
        }
      })
      .catch((error) => {
        if (active) {
          setOpenInAiPromptError(error instanceof Error ? error.message : '提示词加载失败');
        }
      });

    return () => {
      active = false;
    };
  }, [paperId]);

  const venue = getVenueParts(paper?.venue);
  const keywords = normalizeKeywords(paper?.keywords);
  const pdfUrl = paper?.pdf || `https://openreview.net/pdf?id=${paperId}`;
  const aiTutorTargets = openInAiPrompt ? [
    {
      id: 'kimi',
      label: 'Kimi',
      description: '使用相同提示词并自动发送',
      url: `https://www.kimi.com/?prefill_prompt=${encodeURIComponent(openInAiPrompt)}&send_immediately=true`,
    },
    {
      id: 'openai',
      label: 'OpenAI ChatGPT',
      description: '使用 ChatGPT Search 深链',
      url: buildChatGptUrl(openInAiPrompt),
    },
  ] : [];
  const isBackButtonHidden = backButtonProgress >= 1;
  const backButtonOpacity = 1 - backButtonProgress;
  const requireLogin = () => {
    if (isAuthLoading) {
      return false;
    }
    if (!user) {
      navigate('/login');
      return false;
    }
    return true;
  };
  const openKeywordSearch = (keyword: string) => {
    const keywordSearchPath = buildPaperKeywordSearchPath(paper?.venue, keyword);
    if (keywordSearchPath) {
      navigate(keywordSearchPath);
    }
  };

  return (
    <div className="mx-auto max-w-[96rem] animate-fade-in">
      <div
        className="mb-4 origin-left transition-[opacity,transform] duration-150"
        style={{
          opacity: backButtonOpacity,
          transform: `translateY(${-BACK_BUTTON_MAX_TRANSLATE_Y * backButtonProgress}px)`,
          pointerEvents: isBackButtonHidden ? 'none' : 'auto',
        }}
      >
        <Button
          variant="ghost"
          className="rounded-full px-0 text-[#728095]"
          tabIndex={isBackButtonHidden ? -1 : 0}
          onClick={() => {
            if (window.history.length > 1) {
              window.history.back();
              return;
            }
            navigate('/');
          }}
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          返回
        </Button>
      </div>

      <div className="grid gap-6 xl:items-start xl:grid-cols-[minmax(0,1.55fr)_minmax(24rem,0.95fr)] 2xl:grid-cols-[minmax(0,1.7fr)_minmax(26rem,1.02fr)]">
        <div className="space-y-6">
          <section className="rounded-[32px] bg-white p-6 shadow-sm ring-1 ring-black/5">
            {paperLoading ? (
              <div className="flex items-center gap-2 text-[#728095]">
                <Loader2 className="h-5 w-5 animate-spin" />
                加载论文信息...
              </div>
            ) : paperError ? (
              <div className="text-[#b91c1c]">{paperError}</div>
            ) : paper ? (
              <div className="space-y-6">
                <div>
                  <h1 className="text-3xl font-semibold leading-tight text-[#172033]">
                    <RichContent content={paper.title} inline className="paper-title-math" />
                  </h1>
                  <div className="mt-4 flex flex-wrap gap-2.5">
                    <Badge variant="outline" className="border-blue-200 bg-blue-50 px-3 py-1 text-sm text-blue-700">
                      {venue.label}
                    </Badge>
                    {paper.primary_area ? (
                      <Badge
                        variant="outline"
                        className="border-[#e6ebf2] bg-[#f8fafc] px-3 py-1 text-sm text-[#516072]"
                      >
                        {paper.primary_area}
                      </Badge>
                    ) : null}
                    <CodeAvailabilityBadge
                      status={paper.code_status}
                      codeUrl={paper.code_url}
                      className="px-3 py-1 text-sm"
                    />
                    {keywords.slice(0, 6).map((keyword, index) => {
                      const className =
                        index % 2 === 0
                          ? 'border-orange-100 bg-orange-50 px-3 py-1 text-sm text-orange-700'
                          : 'border-violet-100 bg-violet-50 px-3 py-1 text-sm text-violet-700';
                      const keywordSearchPath = buildPaperKeywordSearchPath(paper.venue, keyword);

                      if (!keywordSearchPath) {
                        return (
                          <Badge key={`${paper.id}-${keyword}`} variant="outline" className={className}>
                            {keyword}
                          </Badge>
                        );
                      }

                      return (
                        <Badge
                          key={`${paper.id}-${keyword}`}
                          asChild
                          variant="outline"
                          className={`${className} cursor-pointer transition hover:-translate-y-0.5 hover:shadow-sm`}
                        >
                          <button
                            type="button"
                            aria-label={`搜索关键词 ${keyword}`}
                            title={`搜索关键词：${keyword}`}
                            onClick={() => openKeywordSearch(keyword)}
                          >
                            {keyword}
                          </button>
                        </Badge>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-[#8a98ac]">Abstract</h2>
                  <RichContent content={paper.abstract || '暂无摘要'} className="markdown-body text-base leading-7 text-[#475569]" />
                </div>

                <div className="flex flex-wrap gap-2">
                  <a href={pdfUrl} target="_blank" rel="noreferrer">
                    <Button variant="outline" className="rounded-full border-[#bfdbfe] bg-[#eff6ff] text-[#2563eb]">
                      <FileText className="mr-1.5 h-4 w-4" />
                      PDF
                    </Button>
                  </a>
	                <DropdownMenu>
	                  <DropdownMenuTrigger asChild>
	                      <Button
	                        variant="outline"
	                        className="rounded-full border-[#d8b4fe] bg-[#faf5ff] text-[#9333ea]"
	                        disabled={!openInAiPrompt}
	                        title={openInAiPromptError ?? (openInAiPrompt ? 'Open in AI' : '正在加载 AI 提示词')}
	                      >
	                        <Sparkles className="mr-1.5 h-4 w-4" />
	                        {openInAiPrompt ? 'Open in AI' : '加载 AI 提示词'}
	                        <ChevronDown className="ml-0.5 h-4 w-4" />
	                      </Button>
	                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      className="w-56 overflow-hidden rounded-2xl border border-white/55 bg-[linear-gradient(135deg,rgba(255,255,255,0.42),rgba(248,245,255,0.30)_46%,rgba(219,234,254,0.24))] p-1.5 shadow-[0_18px_50px_rgba(37,99,235,0.16),inset_0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-3xl backdrop-saturate-150"
                    >
                      {aiTutorTargets.map((target) => (
                        <DropdownMenuItem
                          key={target.id}
                          asChild
                          className="rounded-xl border border-transparent px-3 py-2.5 transition-[background-color,border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-white/55 hover:bg-white/32 hover:shadow-[0_10px_26px_rgba(37,99,235,0.14),inset_0_1px_0_rgba(255,255,255,0.70)] focus:-translate-y-0.5 focus:border-white/60 focus:bg-white/38 focus:text-[#172033] focus:shadow-[0_10px_26px_rgba(37,99,235,0.16),inset_0_1px_0_rgba(255,255,255,0.74)] focus:outline-none focus-visible:outline-none data-[highlighted]:-translate-y-0.5 data-[highlighted]:border-white/60 data-[highlighted]:bg-white/38 data-[highlighted]:text-[#172033] data-[highlighted]:shadow-[0_10px_26px_rgba(37,99,235,0.16),inset_0_1px_0_rgba(255,255,255,0.74)] data-[highlighted]:outline-none"
                        >
                          <a href={target.url} target="_blank" rel="noreferrer" className="cursor-pointer">
                            <div className="flex min-w-0 flex-1 flex-col">
                              <span className="font-medium text-[#172033]">{target.label}</span>
                              <span className="truncate text-xs text-[#728095]">{target.description}</span>
                            </div>
                            <ExternalLink className="h-3.5 w-3.5 text-[#8a98ac]" />
                          </a>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    variant="outline"
                    className={`rounded-full ${
                      marks.viewed
                        ? 'border-[#bfdbfe] bg-[#eff6ff] text-[#2563eb]'
                        : 'border-[#dbe2ea] text-[#66768b]'
                    }`}
                    onClick={() => {
                      if (!requireLogin()) {
                        return;
                      }
                      void updatePaperMark(paperId, { viewed: !marks.viewed }).then(setMarks);
                    }}
                  >
                    <Eye className={`mr-1.5 h-4 w-4 ${marks.viewed ? 'fill-current' : ''}`} />
                    {marks.viewed ? '已看过' : '看过'}
                  </Button>
                  <Button
                    variant="outline"
                    className={`rounded-full ${
                      marks.liked
                        ? 'border-[#fecaca] bg-[#fff1f2] text-[#e11d48]'
                        : 'border-[#dbe2ea] text-[#66768b]'
                    }`}
                    onClick={() => {
                      if (!requireLogin()) {
                        return;
                      }
                      setIsLikeAnimating(true);
                      void updatePaperMark(paperId, { liked: !marks.liked }).then(setMarks);
                      window.setTimeout(() => setIsLikeAnimating(false), 400);
                    }}
                  >
                    <Heart className={`mr-1.5 h-4 w-4 ${isLikeAnimating ? 'animate-heart-beat' : ''} ${marks.liked ? 'fill-current' : ''}`} />
                    {marks.liked ? '已点赞' : '点赞'}
                  </Button>
                  <Button
                    variant="outline"
                    className={`rounded-full ${
                      marks.favorited
                        ? 'border-[#fed7aa] bg-[#fff7ed] text-[#ea580c]'
                        : 'border-[#dbe2ea] text-[#66768b]'
                    }`}
                    onClick={() => {
                      if (!requireLogin()) {
                        return;
                      }
                      void updatePaperMark(paperId, { favorited: !marks.favorited }).then(setMarks);
                    }}
                  >
                    <Bookmark className={`mr-1.5 h-4 w-4 ${marks.favorited ? 'fill-current' : ''}`} />
                    {marks.favorited ? '已收藏' : '收藏'}
                  </Button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="rounded-[32px] bg-white p-6 shadow-sm ring-1 ring-black/5">
            <div className="flex flex-col gap-3 border-b border-[#eef2f7] pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex shrink-0 items-center gap-2">
                <Sparkles className="h-5 w-5 text-[#ff9900]" />
                <div>
                  <h2 className="whitespace-nowrap text-xl font-semibold text-[#172033]">AI 分析</h2>
                  {analysisStatus ? <p className="text-sm text-[#728095]">{analysisStatus}</p> : null}
                </div>
              </div>
              <div className="flex max-w-full flex-wrap items-center gap-2">
                <ActiveModelBadge className="max-w-[18rem]" />
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={() => void loadAnalysis(true)}
                >
                  重新分析
                </Button>
              </div>
            </div>

            {analysisLoading ? (
              <div className="mt-6 flex items-center gap-2 text-[#728095]">
                <Loader2 className="h-5 w-5 animate-spin" />
                {analysisStatus || '正在分析论文...'}
              </div>
            ) : analysisError ? (
              <div className="mt-6 rounded-2xl bg-[#fff1f2] p-4 text-[#b91c1c]">{analysisError}</div>
            ) : (
              <div className="mt-6 space-y-4">
                <ReasoningStreamPanel reasoning={analysisStreaming ? analysisReasoning : ''} />
                {analysisText ? (
                  <RichContent
                    content={analysisText}
                    analysisMode
                    isStreaming={analysisStreaming}
                    className="markdown-body analysis-markdown text-base leading-7 text-[#334155]"
                  />
                ) : null}
              </div>
            )}
          </section>
        </div>

        <div className="min-h-0 xl:sticky xl:top-6 xl:self-start">
          <ChatPanel paperId={paperId} />
        </div>
      </div>
    </div>
  );
}
