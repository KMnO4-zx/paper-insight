import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PaginationBar } from '@/components/pagination-bar';
import { PaperCard } from '@/components/paper-card';
import { SearchControls } from '@/components/search-controls';
import { fetchConferencePapers } from '@/lib/api';
import { getConferenceDefinition } from '@/lib/constants';
import { buildQueryString, navigate, parseFilters, parsePage, useAppLocation } from '@/lib/router';
import type { PaperListResponse, SearchFilters } from '@/types';

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
  const { query, page, filters } = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return {
      query: params.get('q') ?? '',
      page: parsePage(params.get('page')),
      filters: parseFilters(params),
    };
  }, [location.search]);
  const conference = getConferenceDefinition(venue);
  const [draftQuery, setDraftQuery] = useState(query);
  const [draftFilters, setDraftFilters] = useState<SearchFilters>(filters);
  const [results, setResults] = useState<PaperListResponse>(EMPTY_RESULTS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraftQuery(query);
    setDraftFilters(filters);
  }, [query, filters]);

  useEffect(() => {
    if (!conference) {
      return;
    }

    let active = true;
    setIsLoading(true);
    setError(null);

    void fetchConferencePapers(venue, page, query, filters)
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
  }, [conference, venue, page, query, filters]);

  const submitSearch = () => {
    const next = new URLSearchParams();
    if (draftQuery.trim()) {
      next.set('q', draftQuery.trim());
      next.set('title', String(draftFilters.title));
      next.set('abstract', String(draftFilters.abstract));
      next.set('keywords', String(draftFilters.keywords));
    }
    navigate(`/conference/${venue}${buildQueryString(next)}`);
  };

  const onPageChange = (nextPage: number) => {
    const next = new URLSearchParams(location.search);
    next.set('page', String(nextPage));
    navigate(`/conference/${venue}${buildQueryString(next)}`);
  };

  if (!conference) {
    return (
      <div className="mx-auto max-w-4xl rounded-[32px] bg-white/90 p-8 text-center shadow-sm ring-1 ring-black/5">
        <h1 className="text-2xl font-semibold text-[#172033]">未找到会议</h1>
        <p className="mt-3 text-[#728095]">当前前端支持的会议入口与后端 `venue_map` 保持一致。</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl animate-fade-in">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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

      <SearchControls
        query={draftQuery}
        filters={draftFilters}
        onQueryChange={setDraftQuery}
        onFiltersChange={setDraftFilters}
        onSubmit={submitSearch}
        placeholder="搜索关键词... (Shift+Enter 搜索)"
        compact
      />

      <div className="mt-6 rounded-[28px] bg-white/70 p-4 text-sm text-[#596579] shadow-sm ring-1 ring-black/5">
        共 {results.total} 篇论文
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
            />
          ))}
        </div>
      )}

      <PaginationBar page={results.page} pages={results.pages} onPageChange={onPageChange} />
    </div>
  );
}
