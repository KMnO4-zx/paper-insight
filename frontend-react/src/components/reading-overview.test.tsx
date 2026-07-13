import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  ActivityHeatmap,
  CollectionProgressList,
  HfDailyReadingStatus,
  ReadingOverviewPanel,
} from './reading-overview';
import type { ReadingOverviewResponse } from '@/types';

const OVERVIEW: ReadingOverviewResponse = {
  timezone: 'Asia/Shanghai',
  activity: {
    days: [{ date: '2026-07-13', count: 1 }],
    today_count: 1,
    month_count: 1,
    current_streak: 1,
  },
  hf_daily: null,
  collections: [
    { id: 'acl_2026', label: 'ACL 2026', read: 2, total: 5, percent: 40 },
    { id: 'iclr_2026', label: 'ICLR 2026', read: 1, total: 10, percent: 10 },
  ],
};

describe('ActivityHeatmap', () => {
  it('renders readable activity summaries for active and zero-count dates', () => {
    const html = renderToStaticMarkup(
      <ActivityHeatmap
        timezone="Asia/Shanghai"
        activity={{
          days: [
            { date: '2026-07-12', count: 0 },
            { date: '2026-07-13', count: 3 },
          ],
          today_count: 3,
          month_count: 12,
          current_streak: 2,
        }}
      />,
    );

    expect(html).toContain('今日阅读');
    expect(html).toContain('近 16 周论文阅读活动，共看过 3 篇论文，今日 3 篇');
    expect(html).toContain('class="whitespace-nowrap"');
    expect(html).toContain('2026年7月13日 · 看过 3 篇论文');
    expect(html).toContain('2026年7月12日 · 看过 0 篇论文');
    expect(html).toContain('tabindex="-1"');
    expect(html).not.toContain('2026年7月14日 · 看过');
  });
});

describe('reading progress sections', () => {
  it('renders HF Daily item status and collection progress semantics', () => {
    const hfHtml = renderToStaticMarkup(
      <HfDailyReadingStatus
        progress={{
          daily_date: '2026-07-13',
          is_today: true,
          read: 1,
          total: 2,
          items: [
            { paper_id: 'paper-1', title: 'First paper', rank: 1, viewed: true },
            { paper_id: 'paper-2', title: 'Second paper', rank: 2, viewed: false },
          ],
        }}
      />,
    );
    const collectionHtml = renderToStaticMarkup(
      <CollectionProgressList
        collections={[{ id: 'acl_2026', label: 'ACL 2026', read: 2, total: 5, percent: 40 }]}
      />,
    );

    expect(hfHtml).toContain('今日榜单');
    expect(hfHtml).toContain('第 1 名，First paper，已看过');
    expect(hfHtml).toContain('第 2 名，Second paper，未看过');
    expect(collectionHtml).toContain('ACL 2026');
    expect(collectionHtml).toContain('ACL 2026阅读进度 40%');
  });

  it('supports a collection override and hiding the collection section', () => {
    const filteredHtml = renderToStaticMarkup(
      <ReadingOverviewPanel
        overview={OVERVIEW}
        isLoading={false}
        error={null}
        isAuthenticated
        onRetry={() => undefined}
        collections={[OVERVIEW.collections[1]]}
      />,
    );
    const withoutCollectionsHtml = renderToStaticMarkup(
      <ReadingOverviewPanel
        overview={OVERVIEW}
        isLoading={false}
        error={null}
        isAuthenticated
        onRetry={() => undefined}
        showCollections={false}
      />,
    );

    expect(filteredHtml).toContain('ICLR 2026');
    expect(filteredHtml).not.toContain('ACL 2026');
    expect(filteredHtml).toContain('当前合集的阅读进度');
    expect(filteredHtml).not.toContain('所有会议合集的当前阅读进度');
    expect(withoutCollectionsHtml).not.toContain('论文合集');
  });
});
