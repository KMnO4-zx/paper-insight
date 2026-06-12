import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, FileText, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PaginationBar } from '@/components/pagination-bar';
import { PaperCard } from '@/components/paper-card';
import { SearchControls } from '@/components/search-controls';
import { createArxivPaper, fetchArxivPapers } from '@/lib/api';
import { extractArxivId } from '@/lib/arxiv';
import { applyFilters, buildQueryString, navigate, parseFilters, parsePage, useAppLocation } from '@/lib/router';
import type { Paper, PaperListResponse, SearchFilters } from '@/types';

const EMPTY_RESULTS: PaperListResponse = {
  papers: [],
  total: 0,
  page: 1,
  pages: 1,
};

const ADDED_DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  month: 'short',
  day: 'numeric',
  weekday: 'short',
});

interface TimelineItem {
  date: string;
  count: number;
}

function getArxivAddedDate(paper: Paper): string {
  const value = paper.arxiv?.added_at ?? paper.created_at ?? '';
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match?.[1] ?? 'unknown';
}

function parseAddedDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatAddedDate(value: string | null): string {
  if (!value || value === 'unknown') {
    return '日期未知';
  }
  const parsed = parseAddedDate(value);
  if (!parsed) {
    return value;
  }
  return `${value} · ${ADDED_DATE_FORMATTER.format(parsed)}`;
}

function getAddedDateParts(value: string | null): { primary: string; secondary: string } {
  if (!value || value === 'unknown') {
    return { primary: '日期未知', secondary: '' };
  }

  const parsed = parseAddedDate(value);
  return {
    primary: value,
    secondary: parsed ? ADDED_DATE_FORMATTER.format(parsed) : '',
  };
}

function buildTimelineItems(papers: Paper[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const paper of papers) {
    const date = getArxivAddedDate(paper);
    const latest = items[items.length - 1];
    if (latest?.date === date) {
      latest.count += 1;
    } else {
      items.push({ date, count: 1 });
    }
  }
  return items;
}

interface ArxivTimelineProps {
  items: TimelineItem[];
  activeDate: string | null;
  onSelectDate: (date: string) => void;
  compact?: boolean;
}

function ArxivTimeline({ items, activeDate, onSelectDate, compact = false }: ArxivTimelineProps) {
  if (!items.length) {
    return null;
  }

  const currentDate = activeDate ?? items[0].date;

  if (compact) {
    return (
      <div className="border-y border-[#dfe5ed] bg-[#f3f4f6]/85 py-3 backdrop-blur">
        <div className="flex items-center gap-2 text-xs font-medium text-[#728095]">
          <CalendarDays className="h-4 w-4 text-[#0891b2]" />
          当前添加日期
          <span className="font-semibold text-[#172033]">{formatAddedDate(currentDate)}</span>
        </div>
        <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
          {items.map((item) => {
            const isActive = item.date === currentDate;
            const dateParts = getAddedDateParts(item.date);
            return (
              <button
                key={item.date}
                type="button"
                onClick={() => onSelectDate(item.date)}
                className={`relative shrink-0 pl-4 pr-2 text-left text-xs transition ${
                  isActive ? 'text-[#0e7490]' : 'text-[#66768b]'
                }`}
              >
                <span
                  className={`absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full ${
                    isActive ? 'bg-[#0891b2]' : 'bg-[#cbd5e1]'
                  }`}
                />
                <span className="block font-semibold">{dateParts.primary}</span>
                {dateParts.secondary ? <span className="block text-[11px] text-[#8a96a8]">{dateParts.secondary}</span> : null}
                <span className="block text-[11px] text-[#8a96a8]">{item.count} 篇</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const currentParts = getAddedDateParts(currentDate);

  return (
    <nav className="pr-2" aria-label="arXiv added dates">
      <div className="mb-5 flex items-center gap-2 text-xs font-medium text-[#728095]">
        <CalendarDays className="h-4 w-4 text-[#0891b2]" />
        当前添加日期
      </div>
      <div className="mb-5 text-sm font-semibold leading-5 text-[#172033]">
        <span className="block">{currentParts.primary}</span>
        {currentParts.secondary ? <span className="block text-xs font-medium text-[#728095]">{currentParts.secondary}</span> : null}
      </div>

      <div className="relative space-y-7">
        <div className="absolute left-[5px] top-2 bottom-2 w-px bg-[#d5dde8]" />
        {items.map((item) => {
          const isActive = item.date === currentDate;
          const dateParts = getAddedDateParts(item.date);
          return (
            <button
              key={item.date}
              type="button"
              onClick={() => onSelectDate(item.date)}
              className={`relative grid w-full grid-cols-[0.875rem_minmax(0,1fr)] gap-3 text-left text-xs transition ${
                isActive ? 'text-[#0e7490]' : 'text-[#66768b] hover:text-[#172033]'
              }`}
            >
              <span
                className={`relative z-10 mt-1 h-3 w-3 rounded-full ring-4 ring-[#f3f4f6] ${
                  isActive ? 'bg-[#0891b2]' : 'bg-[#cbd5e1]'
                }`}
              />
              <span>
                <span className="block font-semibold leading-5">{dateParts.primary}</span>
                {dateParts.secondary ? <span className="block leading-4 text-[#8a96a8]">{dateParts.secondary}</span> : null}
                <span className="block leading-4 text-[#8a96a8]">{item.count} 篇</span>
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function ArxivPage() {
  const location = useAppLocation();
  const listRef = useRef<HTMLDivElement | null>(null);
  const { query, page, filters } = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return {
      query: params.get('q') ?? '',
      page: parsePage(params.get('page')),
      filters: parseFilters(params),
    };
  }, [location.search]);

  const [draftQuery, setDraftQuery] = useState(query);
  const [draftFilters, setDraftFilters] = useState<SearchFilters>(filters);
  const [results, setResults] = useState<PaperListResponse>(EMPTY_RESULTS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddingArxiv, setIsAddingArxiv] = useState(false);
  const [arxivSubmitError, setArxivSubmitError] = useState<string | null>(null);
  const timelineItems = useMemo(() => buildTimelineItems(results.papers), [results.papers]);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const detectedArxivId = extractArxivId(draftQuery);

  useEffect(() => {
    setDraftQuery(query);
    setDraftFilters(filters);
  }, [query, filters]);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError(null);

    void fetchArxivPapers(page, query, filters)
      .then((payload) => {
        if (active) {
          setResults(payload);
        }
      })
      .catch((requestError) => {
        if (active) {
          setError(requestError instanceof Error ? requestError.message : '加载失败');
          setResults(EMPTY_RESULTS);
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [page, query, filters]);

  useEffect(() => {
    setActiveDate(timelineItems[0]?.date ?? null);
  }, [timelineItems]);

  useEffect(() => {
    if (!timelineItems.length) {
      return;
    }

    let frame = 0;
    const updateActiveDate = () => {
      frame = 0;
      const nodes = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-arxiv-added-date]') ?? []);
      if (!nodes.length) {
        return;
      }

      const anchorY = Math.min(window.innerHeight * 0.4, 280);
      let nextDate = nodes[0].dataset.arxivAddedDate ?? timelineItems[0].date;

      for (const node of nodes) {
        const date = node.dataset.arxivAddedDate;
        if (!date) {
          continue;
        }
        if (node.getBoundingClientRect().top <= anchorY) {
          nextDate = date;
        } else {
          break;
        }
      }

      setActiveDate((current) => (current === nextDate ? current : nextDate));
    };

    const requestUpdate = () => {
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame(updateActiveDate);
    };

    requestUpdate();
    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate);
    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      window.removeEventListener('scroll', requestUpdate);
      window.removeEventListener('resize', requestUpdate);
    };
  }, [results.papers, timelineItems]);

  const onPageChange = (nextPage: number) => {
    const next = new URLSearchParams(location.search);
    next.set('page', String(nextPage));
    navigate(`/arxiv${buildQueryString(next)}`);
  };

  const submitSearch = async () => {
    const trimmedQuery = draftQuery.trim();
    if (isAddingArxiv) {
      return;
    }

    const arxivId = extractArxivId(trimmedQuery);
    if (arxivId) {
      setIsAddingArxiv(true);
      setArxivSubmitError(null);
      try {
        const paper = await createArxivPaper(trimmedQuery);
        navigate(`/papers/${encodeURIComponent(paper.id)}`);
      } catch (submitError) {
        setArxivSubmitError(submitError instanceof Error ? submitError.message : 'arXiv 论文加载失败');
      } finally {
        setIsAddingArxiv(false);
      }
      return;
    }

    setArxivSubmitError(null);
    const next = new URLSearchParams();
    if (trimmedQuery) {
      next.set('q', trimmedQuery);
      applyFilters(next, draftFilters);
    }
    navigate(`/arxiv${buildQueryString(next)}`);
  };

  const scrollToDate = (date: string) => {
    const target = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-arxiv-added-date]') ?? []).find(
      (node) => node.dataset.arxivAddedDate === date,
    );
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setActiveDate(date);
  };

  const hasTimeline = timelineItems.length > 0;

  return (
    <div className={hasTimeline ? 'mx-auto max-w-7xl animate-fade-in' : 'mx-auto max-w-6xl animate-fade-in'}>
      <div className={hasTimeline ? 'lg:grid lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-6' : ''}>
        {hasTimeline ? <div className="hidden lg:block" /> : null}

        <div className="min-w-0">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
              <Button variant="ghost" className="rounded-full px-0 text-[#728095]" onClick={() => navigate('/')}>
                <ChevronLeft className="mr-1 h-4 w-4" />
                返回首页
              </Button>
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-sm text-[#075985] shadow-sm ring-1 ring-black/5">
                  <FileText className="h-4 w-4 text-[#0891b2]" />
                  arXiv Papers
                </div>
                <h1 className="text-3xl font-semibold text-[#172033]">最近分析的 arXiv 论文</h1>
                <p className="text-sm text-[#728095]">按用户添加时间倒序展示，卡片保留 arXiv 原始发布时间</p>
              </div>
            </div>
          </div>

          <SearchControls
            query={draftQuery}
            filters={draftFilters}
            onQueryChange={setDraftQuery}
            onFiltersChange={setDraftFilters}
            onSubmit={submitSearch}
            placeholder="搜索 arXiv 论文，或粘贴 arXiv 链接 / ID..."
            submitLabel={detectedArxivId ? (isAddingArxiv ? '准备分析' : '分析 arXiv') : '搜索'}
            compact
          />

          {arxivSubmitError ? (
            <div className="mt-3 rounded-2xl bg-[#fff1f2] px-4 py-3 text-sm text-[#b91c1c] shadow-sm ring-1 ring-black/5">
              {arxivSubmitError}
            </div>
          ) : null}

          {isAddingArxiv ? (
            <div className="mt-3 flex items-center gap-2 px-2 text-sm text-[#728095]">
              <Loader2 className="h-4 w-4 animate-spin text-[#0891b2]" />
              正在准备 arXiv:{detectedArxivId} 的 AI 分析
            </div>
          ) : null}

          <div className="mt-6 rounded-[28px] bg-white/70 p-4 text-sm text-[#596579] shadow-sm ring-1 ring-black/5">
            共 {results.total} 篇论文
          </div>

          <div className="sticky top-24 z-20 mt-4 lg:hidden">
            <ArxivTimeline items={timelineItems} activeDate={activeDate} onSelectDate={scrollToDate} compact />
          </div>
        </div>

        {isLoading ? (
          <div className={hasTimeline ? 'mt-8 lg:col-start-2' : 'mt-8'}>
            <div className="flex items-center justify-center gap-2 rounded-[28px] bg-white/90 p-8 text-[#728095] shadow-sm ring-1 ring-black/5">
              <Loader2 className="h-5 w-5 animate-spin" />
              加载 arXiv 论文中...
            </div>
          </div>
        ) : error ? (
          <div className={hasTimeline ? 'mt-8 lg:col-start-2' : 'mt-8'}>
            <div className="rounded-[28px] bg-white/90 p-8 text-center text-[#b91c1c] shadow-sm ring-1 ring-black/5">
              {error}
            </div>
          </div>
        ) : results.papers.length === 0 ? (
          <div className={hasTimeline ? 'mt-8 lg:col-start-2' : 'mt-8'}>
            <div className="rounded-[28px] bg-white/90 p-8 text-center text-[#728095] shadow-sm ring-1 ring-black/5">
              暂无已分析的 arXiv 论文
            </div>
          </div>
        ) : (
          <>
            <aside className="mt-8 hidden lg:block">
              <div className="sticky top-32">
                <ArxivTimeline items={timelineItems} activeDate={activeDate} onSelectDate={scrollToDate} />
              </div>
            </aside>
            <div ref={listRef} className="mt-8 min-w-0 space-y-4">
              {results.papers.map((paper, index) => {
                const addedDate = getArxivAddedDate(paper);
                const previousDate = index > 0 ? getArxivAddedDate(results.papers[index - 1]) : null;
                const showDateDivider = addedDate !== previousDate;
                const dateCount = timelineItems.find((item) => item.date === addedDate)?.count ?? 1;

                return (
                  <div key={`${addedDate}-${paper.id}-${index}`} data-arxiv-added-date={addedDate} className="scroll-mt-36">
                    {showDateDivider ? (
                      <div className="mb-4 flex items-center gap-3 text-sm text-[#596579]">
                        <div className="flex items-center gap-2">
                          <CalendarDays className="h-4 w-4 text-[#0891b2]" />
                          <span className="font-semibold text-[#172033]">{formatAddedDate(addedDate)}</span>
                          <span className="text-xs text-[#8a96a8]">{dateCount} 篇</span>
                        </div>
                        <div className="h-px flex-1 bg-[#dfe5ed]" />
                      </div>
                    ) : null}
                    <PaperCard
                      paper={paper}
                      index={index}
                      onOpen={(nextPaper) => navigate(`/papers/${encodeURIComponent(nextPaper.id)}`)}
                      searchQuery={query}
                      searchFilters={filters}
                    />
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className={hasTimeline ? 'lg:col-start-2' : ''}>
          <PaginationBar page={results.page} pages={results.pages} onPageChange={onPageChange} />
        </div>
      </div>
    </div>
  );
}
