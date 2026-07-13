import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, Bookmark, BookMarked, ChevronLeft, Eye, Heart, Loader2, Send } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PaginationBar } from '@/components/pagination-bar';
import { ReadingOverviewPanel } from '@/components/reading-overview';
import { RichContent } from '@/components/rich-content';
import { useReadingOverview } from '@/hooks/use-reading-overview';
import {
  fetchFeishuWebhookSettings,
  fetchMyPapers,
  testFeishuWebhook,
  updateFeishuWebhookSettings,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { getVenueParts, normalizeKeywords } from '@/lib/content';
import { buildQueryString, navigate, parsePage, useAppLocation } from '@/lib/router';
import type {
  MarkedPaperItem,
  MarkedPaperListResponse,
  MyPaperFilter,
  MyPaperSort,
  PaperMark,
  FeishuWebhookSettings,
} from '@/types';

const EMPTY_RESULTS: MarkedPaperListResponse = {
  items: [],
  total: 0,
  page: 1,
  pages: 1,
};

const FILTERS: Array<{ value: MyPaperFilter; label: string }> = [
  { value: 'all', label: '全部记录' },
  { value: 'viewed', label: '看过' },
  { value: 'liked', label: '已点赞' },
  { value: 'favorited', label: '已收藏' },
];

const SORTS: Array<{ value: MyPaperSort; label: string }> = [
  { value: 'viewed_at', label: '最近看过' },
  { value: 'liked_at', label: '最近点赞' },
  { value: 'favorited_at', label: '最近收藏' },
  { value: 'favorited_first', label: '收藏优先' },
  { value: 'updated_at', label: '最近操作' },
  { value: 'title', label: '标题 A-Z' },
];

function parseFilter(value: string | null): MyPaperFilter {
  return value === 'viewed' || value === 'liked' || value === 'favorited' ? value : 'all';
}

function parseSort(value: string | null): MyPaperSort {
  if (value === 'favorited_first' || value === 'liked_first') {
    return 'favorited_first';
  }
  if (value === 'liked_at' || value === 'favorited_at' || value === 'updated_at' || value === 'title') {
    return value;
  }
  return 'viewed_at';
}

function formatTime(value?: string | null): string {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString();
}

function formatFeishuTestStatus(settings?: FeishuWebhookSettings | null): string {
  if (!settings?.last_test_status) {
    return '尚未测试';
  }
  const time = formatTime(settings.last_tested_at);
  if (settings.last_test_status === 'success') {
    return `最近测试成功：${time}`;
  }
  return `最近测试失败：${settings.last_test_error || '未知错误'}（${time}）`;
}

function getConferenceColor(conference: string) {
  switch (conference) {
    case 'ICLR':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'NeurIPS':
      return 'bg-violet-50 text-violet-700 border-violet-200';
    case 'ICML':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'CHI':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    case 'CVPR':
      return 'bg-teal-50 text-teal-700 border-teal-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

function updateQuery(next: { filter?: MyPaperFilter; sort?: MyPaperSort; page?: number }) {
  const params = new URLSearchParams(window.location.search);
  if (next.filter) {
    params.set('filter', next.filter);
    params.delete('page');
  }
  if (next.sort) {
    params.set('sort', next.sort);
    params.delete('page');
  }
  if (next.page) {
    params.set('page', String(next.page));
  }
  navigate(`/me${buildQueryString(params)}`);
}

function PaperHistoryCard({ item }: { item: MarkedPaperItem }) {
  const { paper, mark } = item;
  const venue = getVenueParts(paper.venue);
  const keywords = normalizeKeywords(paper.keywords).slice(0, 5);

  return (
    <article
      className="cursor-pointer rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-lg"
      onClick={() => navigate(`/papers/${paper.id}`)}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={getConferenceColor(venue.conference)}>
          {venue.label}
        </Badge>
        {paper.primary_area ? (
          <Badge
            variant="outline"
            className="max-w-full min-w-0 truncate border-[#e6ebf2] bg-[#f8fafc] text-[#516072]"
            title={paper.primary_area}
          >
            {paper.primary_area}
          </Badge>
        ) : null}
        <MarkBadge mark={mark} />
      </div>

      <h2 className="text-xl font-semibold leading-snug text-[#1f2937] hover:text-[#ff7a00]">
        <RichContent content={paper.title} inline className="paper-title-math" />
      </h2>

      {keywords.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {keywords.map((keyword) => (
            <span
              key={`${paper.id}-${keyword}`}
              className="rounded-full border border-[#e6ebf2] bg-[#f8fafc] px-2.5 py-1 text-xs text-[#516072]"
            >
              {keyword}
            </span>
          ))}
        </div>
      ) : null}

      <p className="mt-4 line-clamp-2 text-sm leading-6 text-[#67758a]">
        {paper.abstract || '暂无摘要'}
      </p>

      <div className="mt-4 grid gap-2 text-xs text-[#728095] sm:grid-cols-4">
        <div>看过：{formatTime(mark.viewed_at)}</div>
        <div>点赞：{formatTime(mark.liked_at)}</div>
        <div>收藏：{formatTime(mark.favorited_at)}</div>
        <div>更新：{formatTime(mark.updated_at)}</div>
      </div>
    </article>
  );
}

function MarkBadge({ mark }: { mark: PaperMark }) {
  if (mark.favorited) {
    return (
      <Badge variant="outline" className="border-[#fed7aa] bg-[#fff7ed] text-[#ea580c]">
        <Bookmark className="mr-1 h-3 w-3 fill-current" />
        已收藏
      </Badge>
    );
  }
  if (mark.liked) {
    return (
      <Badge variant="outline" className="border-[#fecaca] bg-[#fff1f2] text-[#e11d48]">
        <Heart className="mr-1 h-3 w-3 fill-current" />
        已点赞
      </Badge>
    );
  }
  if (mark.viewed) {
    return (
      <Badge variant="outline" className="border-[#bfdbfe] bg-[#eff6ff] text-[#2563eb]">
        <Eye className="mr-1 h-3 w-3 fill-current" />
        已看过
      </Badge>
    );
  }
  return null;
}

export function ProfilePage() {
  const location = useAppLocation();
  const { user, isLoading: isAuthLoading } = useAuth();
  const [results, setResults] = useState<MarkedPaperListResponse>(EMPTY_RESULTS);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feishuSettings, setFeishuSettings] = useState<FeishuWebhookSettings | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [dailyPushCount, setDailyPushCount] = useState(3);
  const [isFeishuEnabled, setIsFeishuEnabled] = useState(false);
  const [isFeishuLoading, setIsFeishuLoading] = useState(false);
  const [isFeishuSaving, setIsFeishuSaving] = useState(false);
  const [isFeishuTesting, setIsFeishuTesting] = useState(false);
  const [feishuMessage, setFeishuMessage] = useState<string | null>(null);
  const [feishuError, setFeishuError] = useState<string | null>(null);
  const readingOverview = useReadingOverview();

  const { filter, sort, page } = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return {
      filter: parseFilter(params.get('filter')),
      sort: parseSort(params.get('sort')),
      page: parsePage(params.get('page')),
    };
  }, [location.search]);

  const load = useCallback(async () => {
    if (!user) {
      setResults(EMPTY_RESULTS);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const payload = await fetchMyPapers(filter, sort, page);
      setResults(payload);
    } catch (err) {
      setResults(EMPTY_RESULTS);
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setIsLoading(false);
    }
  }, [filter, page, sort, user]);

  const loadFeishuSettings = useCallback(async () => {
    if (!user) {
      setFeishuSettings(null);
      return;
    }
    setIsFeishuLoading(true);
    setFeishuError(null);
    try {
      const payload = await fetchFeishuWebhookSettings();
      setFeishuSettings(payload);
      setDailyPushCount(payload.daily_push_count || 3);
      setIsFeishuEnabled(payload.enabled);
    } catch (err) {
      setFeishuError(err instanceof Error ? err.message : '飞书设置加载失败');
    } finally {
      setIsFeishuLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!isAuthLoading) {
      void load();
      void loadFeishuSettings();
    }
  }, [isAuthLoading, load, loadFeishuSettings]);

  const saveFeishuSettings = async () => {
    setIsFeishuSaving(true);
    setFeishuMessage(null);
    setFeishuError(null);
    try {
      const payload = await updateFeishuWebhookSettings({
        ...(webhookUrl.trim() ? { webhook_url: webhookUrl.trim() } : {}),
        enabled: isFeishuEnabled,
        daily_push_count: dailyPushCount,
      });
      setFeishuSettings(payload);
      setWebhookUrl('');
      setFeishuMessage('飞书每日推送设置已保存');
    } catch (err) {
      setFeishuError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setIsFeishuSaving(false);
    }
  };

  const sendFeishuTest = async () => {
    setIsFeishuTesting(true);
    setFeishuMessage(null);
    setFeishuError(null);
    try {
      await testFeishuWebhook();
      await loadFeishuSettings();
      setFeishuMessage('测试消息已发送，请查看飞书群');
    } catch (err) {
      await loadFeishuSettings();
      setFeishuError(err instanceof Error ? err.message : '测试发送失败');
    } finally {
      setIsFeishuTesting(false);
    }
  };

  if (isAuthLoading) {
    return (
      <div className="mx-auto flex max-w-5xl items-center gap-2 rounded-[32px] bg-white p-8 text-[#728095]">
        <Loader2 className="h-5 w-5 animate-spin" />
        加载账号状态...
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl rounded-[32px] bg-white p-8 shadow-sm ring-1 ring-black/5">
        <h1 className="text-2xl font-semibold text-[#172033]">需要登录</h1>
        <p className="mt-3 text-sm leading-6 text-[#728095]">
          登录后可以查看你的看过记录、点赞和收藏，并按时间排序。
        </p>
        <Button className="mt-6 rounded-full" onClick={() => navigate('/login')}>
          去登录
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl animate-fade-in">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Button variant="ghost" className="rounded-full px-0 text-[#728095]" onClick={() => navigate('/')}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            返回首页
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <BookMarked className="h-6 w-6 text-[#ff7a00]" />
              <h1 className="text-3xl font-semibold text-[#172033]">我的论文</h1>
            </div>
            <p className="mt-1 text-sm text-[#728095]">
              {user.email} 的阅读、点赞和收藏记录，后续推荐系统会基于这些数据工作。
            </p>
          </div>
        </div>
        <div className="rounded-full bg-white/80 px-4 py-2 text-sm text-[#586578] shadow-sm ring-1 ring-black/5">
          共 {results.total} 条记录
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
      <section className="rounded-[28px] bg-white/85 p-5 shadow-sm ring-1 ring-black/5 xl:col-start-1 xl:row-start-1">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-[#2563eb]" />
              <h2 className="text-xl font-semibold text-[#172033]">飞书每日推送</h2>
            </div>
            <p className="mt-1 text-sm leading-6 text-[#728095]">
              每天 10:00 推送前一天 Hugging Face Daily Papers 中点赞最多的论文，每篇一张 AI 分析卡片。
            </p>
            {feishuSettings?.configured ? (
              <p className="mt-2 text-xs text-[#728095]">当前 webhook：{feishuSettings.webhook_url_masked}</p>
            ) : (
              <p className="mt-2 text-xs text-[#b45309]">尚未配置 webhook URL。</p>
            )}
            <p className="mt-1 text-xs text-[#728095]">{formatFeishuTestStatus(feishuSettings)}</p>
          </div>

          <div className="w-full space-y-3 lg:max-w-xl">
            <label className="block text-sm font-medium text-[#364152]">
              飞书 webhook URL
              <input
                value={webhookUrl}
                onChange={(event) => setWebhookUrl(event.target.value)}
                placeholder={feishuSettings?.configured ? '留空则保留当前 webhook，粘贴新 URL 可覆盖' : 'https://open.feishu.cn/open-apis/bot/v2/hook/...'}
                className="mt-1 w-full rounded-2xl border border-[#e6ebf2] bg-white px-4 py-2 text-sm text-[#172033] outline-none transition focus:border-[#2563eb] focus:ring-2 focus:ring-[#bfdbfe]"
              />
            </label>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <label className="flex items-center gap-2 text-sm text-[#364152]">
                <input
                  type="checkbox"
                  checked={isFeishuEnabled}
                  onChange={(event) => setIsFeishuEnabled(event.target.checked)}
                  className="h-4 w-4 rounded border-[#cbd5e1]"
                />
                启用每日推送
              </label>

              <label className="flex items-center gap-2 text-sm text-[#364152]">
                每日篇数
                <select
                  value={dailyPushCount}
                  onChange={(event) => setDailyPushCount(Number(event.target.value))}
                  className="rounded-full border border-[#e6ebf2] bg-white px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
                >
                  {[1, 2, 3, 4, 5].map((count) => (
                    <option key={count} value={count}>
                      {count} 篇
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {feishuError ? <div className="text-sm text-[#b91c1c]">{feishuError}</div> : null}
            {feishuMessage ? <div className="text-sm text-[#15803d]">{feishuMessage}</div> : null}

            <div className="flex flex-wrap gap-2">
              <Button
                className="rounded-full"
                disabled={isFeishuLoading || isFeishuSaving}
                onClick={saveFeishuSettings}
              >
                {isFeishuSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                保存设置
              </Button>
              <Button
                variant="outline"
                className="rounded-full"
                disabled={!feishuSettings?.configured || isFeishuTesting}
                onClick={sendFeishuTest}
              >
                {isFeishuTesting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                发送测试消息
              </Button>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-sm xl:sticky xl:top-28 xl:col-start-2 xl:row-start-1 xl:row-span-2 xl:mx-0 xl:max-h-[calc(100dvh-8rem)] xl:max-w-none xl:self-start xl:overflow-y-auto xl:overscroll-contain">
        <ReadingOverviewPanel
          overview={readingOverview.overview}
          isLoading={readingOverview.isLoading}
          error={readingOverview.error}
          isAuthenticated={readingOverview.isAuthenticated}
          onRetry={() => void readingOverview.refresh()}
        />
      </div>

      <div className="min-w-0 xl:col-start-1 xl:row-start-2">

      <section className="rounded-[28px] bg-white/80 p-4 shadow-sm ring-1 ring-black/5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((item) => (
              <Button
                key={item.value}
                variant={filter === item.value ? 'default' : 'outline'}
                className="rounded-full"
                onClick={() => updateQuery({ filter: item.value })}
              >
                {item.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {SORTS.map((item) => (
              <Button
                key={item.value}
                variant={sort === item.value ? 'default' : 'outline'}
                className="rounded-full"
                onClick={() => updateQuery({ sort: item.value })}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>
      </section>

      {error ? (
        <div className="mt-6 rounded-[28px] bg-white p-6 text-[#b91c1c] shadow-sm ring-1 ring-black/5">
          {error}
        </div>
      ) : null}

      {isLoading ? (
        <div className="mt-6 flex items-center justify-center gap-2 rounded-[28px] bg-white p-8 text-[#728095] shadow-sm ring-1 ring-black/5">
          <Loader2 className="h-5 w-5 animate-spin" />
          加载我的论文...
        </div>
      ) : results.items.length === 0 ? (
        <div className="mt-6 rounded-[28px] bg-white p-8 text-center text-[#728095] shadow-sm ring-1 ring-black/5">
          暂无记录。打开论文详情、点赞或收藏后，这里就会出现。
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {results.items.map((item) => (
            <PaperHistoryCard key={item.paper.id} item={item} />
          ))}
        </div>
      )}

      <PaginationBar page={results.page} pages={results.pages} onPageChange={(nextPage) => updateQuery({ page: nextPage })} />
      </div>
      </div>
    </div>
  );
}
