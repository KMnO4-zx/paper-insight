import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PaginationBar } from '@/components/pagination-bar';
import { PaperCard } from '@/components/paper-card';
import { PaperReadFilterBar } from '@/components/paper-read-filter-bar';
import { SearchControls } from '@/components/search-controls';
import { fetchSearchPapers } from '@/lib/api';
import { applyReadFilter, buildQueryString, navigate, parseFilters, parsePage, parseReadFilter, useAppLocation } from '@/lib/router';
import { useAuth } from '@/lib/auth';
import type { PaperListResponse, PaperReadFilter, SearchFilters } from '@/types';

const EMPTY_RESULTS: PaperListResponse = {
  papers: [],
  total: 0,
  page: 1,
  pages: 1,
};

export function SearchPage() {
  const location = useAppLocation();
  const { user, isLoading: isAuthLoading } = useAuth();
  const { query, page, filters, readFilter } = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return {
      query: params.get('q') ?? '',
      page: parsePage(params.get('page')),
      filters: parseFilters(params),
      readFilter: parseReadFilter(params.get('read')),
    };
  }, [location.search]);
  const [draftQuery, setDraftQuery] = useState(query);
  const [draftFilters, setDraftFilters] = useState<SearchFilters>(filters);
  const [results, setResults] = useState<PaperListResponse>(EMPTY_RESULTS);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    setDraftQuery(query);
    setDraftFilters(filters);
  }, [query, filters]);

  useEffect(() => {
    if (isAuthLoading) {
      return;
    }
    if (!query.trim()) {
      setResults(EMPTY_RESULTS);
      setIsLoading(false);
      setError(null);
      return;
    }

    let active = true;
    setIsLoading(true);
    setError(null);
    const effectiveReadFilter = user ? readFilter : 'all';

    void fetchSearchPapers(page, query, filters, effectiveReadFilter)
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
  }, [isAuthLoading, page, query, filters, readFilter, refreshVersion, user]);

  const submitSearch = () => {
    if (!draftQuery.trim()) {
      navigate('/search');
      return;
    }

    const next = new URLSearchParams();
    next.set('q', draftQuery.trim());
    next.set('title', String(draftFilters.title));
    next.set('abstract', String(draftFilters.abstract));
    next.set('keywords', String(draftFilters.keywords));
    applyReadFilter(next, user ? readFilter : 'all');
    navigate(`/search${buildQueryString(next)}`);
  };

  const onPageChange = (nextPage: number) => {
    const next = new URLSearchParams(location.search);
    next.set('page', String(nextPage));
    navigate(`/search${buildQueryString(next)}`);
  };

  const onReadFilterChange = (nextReadFilter: PaperReadFilter) => {
    const next = new URLSearchParams(location.search);
    applyReadFilter(next, nextReadFilter);
    next.delete('page');
    navigate(`/search${buildQueryString(next)}`);
  };

  const activeReadFilter = user ? readFilter : 'all';
  const resultSummary =
    activeReadFilter === 'unread'
      ? `未读 ${results.total} 篇论文`
      : activeReadFilter === 'read'
        ? `已读 ${results.total} 篇论文`
        : `共 ${results.total} 篇论文`;

  return (
    <div className="mx-auto max-w-6xl animate-fade-in">
      <div className="mb-6 space-y-2">
        <Button variant="ghost" className="rounded-full px-0 text-[#728095]" onClick={() => navigate('/')}>
          <ChevronLeft className="mr-1 h-4 w-4" />
          返回首页
        </Button>
        <div>
          <h1 className="text-3xl font-semibold text-[#172033]">全局搜索</h1>
          <p className="text-sm text-[#728095]">{query ? `关键词: "${query}"` : '跨会议检索论文标题、摘要与关键词'}</p>
        </div>
      </div>

      <SearchControls
        query={draftQuery}
        filters={draftFilters}
        onQueryChange={setDraftQuery}
        onFiltersChange={setDraftFilters}
        onSubmit={submitSearch}
        placeholder="搜索关键词... (Shift+Enter 搜索)"
        compact
      />

      {query ? (
        <>
          <div className="mt-6">
            <PaperReadFilterBar
              value={activeReadFilter}
              counts={results.read_counts}
              disabled={!user || isAuthLoading}
              onChange={onReadFilterChange}
            />
          </div>
          <div className="mt-4 rounded-[28px] bg-white/70 p-4 text-sm text-[#596579] shadow-sm ring-1 ring-black/5">
            {resultSummary}
          </div>
        </>
      ) : null}

      {!query ? (
        <div className="mt-8 rounded-[28px] bg-white/90 p-8 text-center text-[#728095] shadow-sm ring-1 ring-black/5">
          输入关键词后开始搜索。
        </div>
      ) : isLoading ? (
        <div className="mt-8 flex items-center justify-center gap-2 rounded-[28px] bg-white/90 p-8 text-[#728095] shadow-sm ring-1 ring-black/5">
          <Loader2 className="h-5 w-5 animate-spin" />
          加载论文中...
        </div>
      ) : error ? (
        <div className="mt-8 rounded-[28px] bg-white/90 p-8 text-center text-[#b91c1c] shadow-sm ring-1 ring-black/5">
          {error}
        </div>
      ) : results.papers.length === 0 ? (
        <div className="mt-8 rounded-[28px] bg-white/90 p-8 text-center text-[#728095] shadow-sm ring-1 ring-black/5">
          没有找到匹配结果
        </div>
      ) : (
        <div className="mt-8 space-y-4">
          {results.papers.map((paper, index) => (
            <PaperCard
              key={paper.id}
              paper={paper}
              index={index}
              onOpen={(nextPaper) => navigate(`/papers/${nextPaper.id}`)}
              searchQuery={query}
              searchFilters={filters}
              onMarkChange={() => setRefreshVersion((version) => version + 1)}
            />
          ))}
        </div>
      )}

      <PaginationBar page={results.page} pages={results.pages} onPageChange={onPageChange} />
    </div>
  );
}
