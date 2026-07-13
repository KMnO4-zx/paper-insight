import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PaginationBar } from '@/components/pagination-bar';
import { PaperCard } from '@/components/paper-card';
import { PaperReadFilterBar } from '@/components/paper-read-filter-bar';
import { ReadingOverviewPanel } from '@/components/reading-overview';
import { SearchControls } from '@/components/search-controls';
import { useReadingOverview } from '@/hooks/use-reading-overview';
import { fetchConferencePapers } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { getConferenceDefinition } from '@/lib/constants';
import { getCollectionProgress } from '@/lib/reading-overview';
import { applyCodeFilter, applyReadFilter, buildQueryString, navigate, parseCodeFilter, parseFilters, parsePage, parseReadFilter, useAppLocation } from '@/lib/router';
import type { PaperCodeFilter, PaperListResponse, PaperReadFilter, SearchFilters } from '@/types';

interface ConferencePageProps {
  venue: string;
}

const EMPTY_RESULTS: PaperListResponse = {
  papers: [],
  total: 0,
  page: 1,
  pages: 1,
};

export function ConferencePage({ venue }: ConferencePageProps) {
  const location = useAppLocation();
  const { user, isLoading: isAuthLoading } = useAuth();
  const { query, page, filters, readFilter, codeFilter } = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return {
      query: params.get('q') ?? '',
      page: parsePage(params.get('page')),
      filters: parseFilters(params),
      readFilter: parseReadFilter(params.get('read')),
      codeFilter: parseCodeFilter(params.get('code')),
    };
  }, [location.search]);
  const conference = getConferenceDefinition(venue);
  const [draftQuery, setDraftQuery] = useState(query);
  const [draftFilters, setDraftFilters] = useState<SearchFilters>(filters);
  const [results, setResults] = useState<PaperListResponse>(EMPTY_RESULTS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const readingOverview = useReadingOverview();
  const collectionProgress = getCollectionProgress(readingOverview.overview?.collections ?? [], venue);

  useEffect(() => {
    setDraftQuery(query);
    setDraftFilters(filters);
  }, [query, filters]);

  useEffect(() => {
    if (isAuthLoading) {
      return;
    }
    if (!conference) {
      return;
    }

    let active = true;
    setIsLoading(true);
    setError(null);
    const effectiveReadFilter = user ? readFilter : 'all';

    void fetchConferencePapers(venue, page, query, filters, effectiveReadFilter, codeFilter)
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
  }, [codeFilter, conference, isAuthLoading, venue, page, query, filters, readFilter, refreshVersion, user]);

  const submitSearch = () => {
    const next = new URLSearchParams();
    if (draftQuery.trim()) {
      next.set('q', draftQuery.trim());
      next.set('title', String(draftFilters.title));
      next.set('abstract', String(draftFilters.abstract));
      next.set('keywords', String(draftFilters.keywords));
    }
    applyReadFilter(next, user ? readFilter : 'all');
    applyCodeFilter(next, codeFilter);
    navigate(`/conference/${venue}${buildQueryString(next)}`);
  };

  const onPageChange = (nextPage: number) => {
    const next = new URLSearchParams(location.search);
    next.set('page', String(nextPage));
    navigate(`/conference/${venue}${buildQueryString(next)}`);
  };

  const onReadFilterChange = (nextReadFilter: PaperReadFilter) => {
    const next = new URLSearchParams(location.search);
    applyReadFilter(next, nextReadFilter);
    next.delete('page');
    navigate(`/conference/${venue}${buildQueryString(next)}`);
  };

  const onCodeFilterChange = (nextCodeFilter: PaperCodeFilter) => {
    const next = new URLSearchParams(location.search);
    applyCodeFilter(next, nextCodeFilter);
    next.delete('page');
    navigate(`/conference/${venue}${buildQueryString(next)}`);
  };

  const activeReadFilter = user ? readFilter : 'all';
  const resultSummary =
    activeReadFilter === 'unread'
      ? `未读 ${results.total} 篇论文`
      : activeReadFilter === 'read'
        ? `已读 ${results.total} 篇论文`
        : `共 ${results.total} 篇论文`;

  if (!conference) {
    return (
      <div className="mx-auto max-w-4xl rounded-[32px] bg-white/90 p-8 text-center shadow-sm ring-1 ring-black/5">
        <h1 className="text-2xl font-semibold text-[#172033]">未找到会议</h1>
        <p className="mt-3 text-[#728095]">当前前端支持的会议入口与后端 `venue_map` 保持一致。</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl animate-fade-in">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
      <div className="xl:col-start-1 xl:row-start-1">
        <div className="space-y-2">
          <Button variant="ghost" className="rounded-full px-0 text-[#728095]" onClick={() => navigate('/')}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            返回首页
          </Button>
          <div>
            <h1 className="text-3xl font-semibold text-[#172033]">{conference.name}</h1>
            <p className="text-sm text-[#728095]">{conference.fullName}</p>
          </div>
        </div>
      </div>

      <div className="min-w-0 xl:col-start-1 xl:row-start-2">
        <SearchControls
          query={draftQuery}
          filters={draftFilters}
          onQueryChange={setDraftQuery}
          onFiltersChange={setDraftFilters}
          onSubmit={submitSearch}
          placeholder="搜索关键词... (Shift+Enter 搜索)"
          compact
        />
      </div>

      <div className="mx-auto w-full max-w-sm xl:sticky xl:top-28 xl:col-start-2 xl:row-start-2 xl:row-span-2 xl:mx-0 xl:max-w-none xl:self-start">
        <ReadingOverviewPanel
          overview={readingOverview.overview}
          isLoading={readingOverview.isLoading}
          error={readingOverview.error}
          isAuthenticated={readingOverview.isAuthenticated}
          onRetry={() => void readingOverview.refresh()}
          collections={collectionProgress ? [collectionProgress] : []}
        />
      </div>

      <div className="min-w-0 xl:col-start-1 xl:row-start-3">
      <div>
        <PaperReadFilterBar
          value={activeReadFilter}
          counts={results.read_counts}
          codeValue={codeFilter}
          disabled={!user || isAuthLoading}
          onChange={onReadFilterChange}
          onCodeChange={onCodeFilterChange}
        />
      </div>

      <div className="mt-4 rounded-[28px] bg-white/70 p-4 text-sm text-[#596579] shadow-sm ring-1 ring-black/5">
        {resultSummary}
      </div>

      {isLoading ? (
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
          暂无论文数据
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
      </div>
    </div>
  );
}
