import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Database,
  FileText,
  Loader2,
  Network,
  Search,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useState } from 'react';

import { SearchControls } from '@/components/search-controls';
import { CONFERENCES } from '@/lib/constants';
import { createArxivPaper } from '@/lib/api';
import { extractArxivId } from '@/lib/arxiv';
import { applyFilters, buildQueryString, navigate } from '@/lib/router';
import type { SearchFilters } from '@/types';

const paperSignals = [
  {
    label: 'Question',
    text: '这篇论文解决什么任务？',
  },
  {
    label: 'Signal',
    text: '指标提升来自方法还是数据？',
  },
  {
    label: 'Action',
    text: '值得进 Zotero 精读吗？',
  },
];

export function HomePage() {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<SearchFilters>({
    title: true,
    abstract: true,
    keywords: true,
  });
  const [isAddingArxiv, setIsAddingArxiv] = useState(false);
  const [arxivSubmitError, setArxivSubmitError] = useState<string | null>(null);
  const detectedArxivId = extractArxivId(query);

  const submitSearch = async () => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery || isAddingArxiv) {
      return;
    }

    const arxivId = extractArxivId(trimmedQuery);
    if (arxivId) {
      setIsAddingArxiv(true);
      setArxivSubmitError(null);
      try {
        const paper = await createArxivPaper(trimmedQuery);
        navigate(`/papers/${encodeURIComponent(paper.id)}`);
      } catch (error) {
        setArxivSubmitError(error instanceof Error ? error.message : 'arXiv 论文加载失败');
      } finally {
        setIsAddingArxiv(false);
      }
      return;
    }

    setArxivSubmitError(null);
    const params = applyFilters(new URLSearchParams(), filters);
    params.set('q', trimmedQuery);
    navigate(`/search${buildQueryString(params)}`);
  };

  return (
    <div className="mx-auto -mt-4 max-w-[104rem] animate-fade-in sm:-mt-5 lg:-mt-7">
      <section className="paper-observatory relative -mx-4 overflow-hidden rounded-[2rem] px-4 pb-8 pt-8 shadow-[0_30px_120px_rgba(15,23,42,0.18)] ring-1 ring-white/70 sm:-mx-6 sm:rounded-[3rem] sm:px-8 sm:pb-10 sm:pt-10 lg:-mx-8 lg:min-h-[calc(100vh-9rem)] lg:px-12 xl:px-16">
        <div className="paper-grid-layer" />
        <div className="paper-scan-layer" />
        <div className="paper-light-rail paper-light-rail-a" />
        <div className="paper-light-rail paper-light-rail-b" />

        <div className="relative z-10 mx-auto flex min-h-[calc(100vh-13rem)] max-w-7xl flex-col justify-center gap-8 py-4 lg:py-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <img
                src="/images/logo.svg"
                alt="Paper Insight logo"
                className="h-14 w-14 rounded-[1.25rem] object-contain shadow-[0_18px_48px_rgba(255,153,0,0.24)] ring-1 ring-white/80 sm:h-16 sm:w-16"
              />
              <div>
                <div className="text-2xl font-semibold tracking-tight text-[#172033] sm:text-3xl">Paper Insight</div>
                <div className="text-sm font-medium text-[#5d6b7c]">AI-driven paper analysis</div>
              </div>
            </div>

            <div className="hidden items-center gap-2 rounded-full border border-white/70 bg-white/70 px-4 py-2 text-sm font-medium text-[#334155] shadow-sm backdrop-blur-xl md:flex">
              <Network className="h-4 w-4 text-[#0891b2]" />
              <span>{CONFERENCES.length} 个论文合集已接入</span>
            </div>
          </div>

          <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_27rem]">
            <div className="space-y-7">
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/75 px-4 py-2 text-sm font-semibold text-[#7a4b00] shadow-sm backdrop-blur-xl">
                  <Sparkles className="h-4 w-4 text-[#ff9900]" />
                  AI 论文智能分析与检索
                </div>
                <div className="inline-flex items-center rounded-full border border-white/70 bg-white/65 px-4 py-2 text-sm font-semibold text-[#526174] shadow-sm backdrop-blur-xl">
                  v1.0.0
                </div>
              </div>

              <div className="space-y-5">
                <h1 className="max-w-5xl text-balance text-4xl font-semibold leading-[1.08] tracking-tight text-[#101827] sm:text-5xl lg:text-5xl xl:text-6xl">
                  在论文海里先看见值得精读的信号
                </h1>
                <p className="max-w-3xl text-base leading-8 text-[#526174] sm:text-lg">
                  批量浏览 AI 会议论文、粘贴 arXiv 链接并自动生成分析，把“先筛一遍”变成一个快速、稳定、可复用的研究入口。
                </p>
              </div>

              <div className="paper-search-shell">
                <SearchControls
                  query={query}
                  filters={filters}
                  onQueryChange={setQuery}
                  onFiltersChange={setFilters}
                  onSubmit={submitSearch}
                  placeholder="搜索会议论文，或粘贴 arXiv 链接 / ID..."
                  submitLabel={detectedArxivId ? (isAddingArxiv ? '准备分析' : '分析 arXiv') : '搜索'}
                  hero
                />
                {arxivSubmitError ? (
                  <div className="mt-3 rounded-2xl border border-[#fecdd3] bg-[#fff1f2]/90 px-4 py-3 text-sm text-[#b91c1c]">
                    {arxivSubmitError}
                  </div>
                ) : null}
                {isAddingArxiv ? (
                  <div className="mt-3 flex items-center gap-2 rounded-2xl bg-white/75 px-4 py-3 text-sm text-[#526174] backdrop-blur-xl">
                    <Loader2 className="h-4 w-4 animate-spin text-[#ff9900]" />
                    正在准备 arXiv:{detectedArxivId} 的 AI 分析
                  </div>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {paperSignals.map((signal, index) => (
                  <div
                    key={signal.label}
                    className="paper-signal-tile"
                    style={{ animationDelay: `${index * 0.12}s` }}
                  >
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0891b2]">{signal.label}</div>
                    <div className="mt-2 text-sm font-semibold leading-6 text-[#172033]">{signal.text}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="paper-orbit-panel">
              <div className="paper-orbit-core">
                <div className="paper-orbit-ring paper-orbit-ring-a" />
                <div className="paper-orbit-ring paper-orbit-ring-b" />
                <div className="relative z-10 flex h-full flex-col justify-between rounded-[2rem] border border-white/70 bg-white/80 p-5 shadow-[0_26px_80px_rgba(15,23,42,0.12)] backdrop-blur-xl">
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="inline-flex items-center gap-2 rounded-full bg-[#f8fafc] px-3 py-1.5 text-xs font-semibold text-[#526174] ring-1 ring-black/5">
                        <Database className="h-3.5 w-3.5 text-[#ff9900]" />
                        Research Map
                      </div>
                      <div className="h-2.5 w-2.5 rounded-full bg-[#22c55e] shadow-[0_0_0_6px_rgba(34,197,94,0.14)]" />
                    </div>
                    <div className="mt-8">
                      <div className="text-sm font-medium text-[#64748b]">Current focus</div>
                      <div className="mt-2 text-3xl font-semibold tracking-tight text-[#172033]">Find the next paper</div>
                      <div className="mt-3 text-sm leading-6 text-[#64748b]">
                        从会议列表、每日论文和 arXiv 链接进入同一个 AI 分析流程。
                      </div>
                    </div>
                  </div>

                  <div className="mt-8 space-y-3">
                    {CONFERENCES.slice(0, 4).map((conference, index) => (
                      <button
                        key={conference.id}
                        type="button"
                        onClick={() => navigate(`/conference/${conference.id}`)}
                        className="paper-orbit-row group"
                        style={{ animationDelay: `${index * 0.1}s` }}
                      >
                        <span className={`h-2.5 w-2.5 rounded-full bg-gradient-to-r ${conference.accentClass}`} />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#263244]">
                          {conference.name}
                        </span>
                        <ArrowRight className="h-4 w-4 text-[#94a3b8] transition group-hover:translate-x-1 group-hover:text-[#ff7a00]" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            <button
              type="button"
              onClick={() => navigate('/hf-daily')}
              className="paper-command-strip group"
            >
              <div className="flex min-w-0 items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#fff7ed] text-[#c2410c] ring-1 ring-[#fed7aa]">
                  <Zap className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-lg font-semibold text-[#172033]">Hugging Face Daily Papers</div>
                  <div className="mt-1 text-sm leading-6 text-[#64748b]">每天抓取热门论文并生成 AI 分析</div>
                </div>
              </div>
              <ArrowRight className="h-5 w-5 shrink-0 text-[#ff7a00] transition group-hover:translate-x-1" />
            </button>

            <button
              type="button"
              onClick={() => navigate('/arxiv')}
              className="paper-command-strip group"
            >
              <div className="flex min-w-0 items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#ecfeff] text-[#0891b2] ring-1 ring-[#bae6fd]">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-lg font-semibold text-[#172033]">最近分析的 arXiv 论文</div>
                  <div className="mt-1 text-sm leading-6 text-[#64748b]">粘贴链接后进入同一套分析与收藏流程</div>
                </div>
              </div>
              <ArrowRight className="h-5 w-5 shrink-0 text-[#0891b2] transition group-hover:translate-x-1" />
            </button>
          </div>
        </div>
      </section>

      <section className="mt-12">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-sm font-medium text-[#526174] shadow-sm ring-1 ring-black/5">
              <BookOpen className="h-4 w-4 text-[#ff9900]" />
              Collections
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-[#172033]">浏览会议论文</h2>
            <p className="mt-2 text-sm text-[#728095]">与当前后端支持的会议范围保持一致</p>
          </div>
          <div className="hidden items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-sm text-[#64748b] shadow-sm ring-1 ring-black/5 sm:flex">
            <Search className="h-4 w-4 text-[#0891b2]" />
            搜索优先，会议浏览作为第二入口
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {CONFERENCES.map((conference, index) => (
            <button
              key={conference.id}
              type="button"
              onClick={() => navigate(`/conference/${conference.id}`)}
              className="paper-conference-card group"
              style={{ animationDelay: `${index * 0.08}s` }}
            >
              <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${conference.accentClass}`} />
              <div className="flex items-start justify-between gap-4">
                <div className="inline-flex items-center gap-2 rounded-full bg-[#f8fafc] px-3 py-1 text-sm text-[#6b7280] ring-1 ring-black/5">
                  <CalendarDays className="h-4 w-4 text-[#ff9900]" />
                  {conference.year}
                </div>
                <div className="rounded-full bg-white p-2 shadow-sm ring-1 ring-black/5 transition group-hover:translate-x-1 group-hover:text-[#ff7a00]">
                  <ArrowRight className="h-4 w-4" />
                </div>
              </div>

              <div className="mt-10 space-y-3">
                <h3 className="text-2xl font-semibold text-[#1f2937]">{conference.name}</h3>
                <p className="min-h-[3rem] text-sm leading-6 text-[#6b7280]">{conference.fullName}</p>
              </div>

              <div className="mt-7 flex items-center justify-between border-t border-[#e6edf5] pt-5">
                <span className="text-sm font-semibold text-[#ff7a00]">进入会议</span>
                <span className={`h-2 w-24 rounded-full bg-gradient-to-r ${conference.accentClass} opacity-80 transition group-hover:w-32`} />
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
