import {
  Activity,
  BookOpenCheck,
  CalendarDays,
  Check,
  Circle,
  Clock3,
  Flame,
  LibraryBig,
  RefreshCw,
} from 'lucide-react';

import huggingFaceLogo from '@/assets/hugging-face.svg';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  buildActivityCalendar,
  formatActivityTooltip,
  getActivityLevel,
  normalizeProgressPercent,
} from '@/lib/reading-overview';
import { navigate } from '@/lib/router';
import type {
  CollectionReadingProgress,
  HfDailyReadingProgress,
  ReadingActivitySummary,
  ReadingOverviewResponse,
} from '@/types';

const ACTIVITY_COLORS = [
  'bg-[#edf0f3] ring-[#e5e7eb]',
  'bg-[#dcfce7] ring-[#bbf7d0]',
  'bg-[#86efac] ring-[#4ade80]',
  'bg-[#4ade80] ring-[#22c55e]',
  'bg-[#16a34a] ring-[#15803d]',
] as const;

function formatDailyDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    return date;
  }
  return `${Number(match[2])}月${Number(match[3])}日`;
}

function OverviewSectionTitle({
  icon: Icon,
  imageSrc,
  title,
  description,
  id,
}: {
  icon?: typeof Activity;
  imageSrc?: string;
  title: string;
  description?: string;
  id?: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${imageSrc ? 'bg-[#fff8d6]' : 'bg-[#f0fdf4] text-[#16a34a]'}`}>
        {imageSrc ? (
          <img src={imageSrc} alt="" className="h-5 w-5" aria-hidden="true" />
        ) : Icon ? (
          <Icon className="h-4 w-4" aria-hidden="true" />
        ) : null}
      </span>
      <div className="min-w-0">
        <h3 id={id} className="text-sm font-semibold text-[#172033]">{title}</h3>
        {description ? <p className="mt-0.5 text-xs leading-5 text-[#7a8798]">{description}</p> : null}
      </div>
    </div>
  );
}

export function ActivityHeatmap({
  activity,
  timezone,
}: {
  activity: ReadingActivitySummary;
  timezone: string;
}) {
  const weeks = buildActivityCalendar(activity.days);
  const totalCount = weeks
    .flatMap((week) => week.cells)
    .reduce((total, day) => total + Math.max(0, day.count), 0);

  return (
    <section aria-labelledby="reading-activity-heading">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#f0fdf4] text-[#16a34a]">
            <Activity className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h3 id="reading-activity-heading" className="text-sm font-semibold text-[#172033]">阅读活动</h3>
            <p className="mt-0.5 text-xs text-[#7a8798]">近 16 周首次看过的论文</p>
          </div>
        </div>
        <span className="rounded-full bg-[#f8fafc] px-2 py-1 text-[10px] text-[#8a96a8]" title={timezone}>
          {timezone === 'Asia/Shanghai' ? '北京时间' : timezone}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl bg-[#f8fafc] px-2 py-2.5">
          <dt className="flex items-center justify-center gap-1 text-[10px] text-[#8793a5]">
            <Flame className="h-3 w-3 text-[#f97316]" aria-hidden="true" />
            连续阅读
          </dt>
          <dd className="mt-1 text-sm font-semibold text-[#172033]">{activity.current_streak} 天</dd>
        </div>
        <div className="rounded-2xl bg-[#f8fafc] px-2 py-2.5">
          <dt className="flex items-center justify-center gap-1 text-[10px] text-[#8793a5]">
            <CalendarDays className="h-3 w-3 text-[#2563eb]" aria-hidden="true" />
            本月阅读
          </dt>
          <dd className="mt-1 text-sm font-semibold text-[#172033]">{activity.month_count} 篇</dd>
        </div>
        <div className="rounded-2xl bg-[#f8fafc] px-2 py-2.5">
          <dt className="flex items-center justify-center gap-1 text-[10px] text-[#8793a5]">
            <Clock3 className="h-3 w-3 text-[#16a34a]" aria-hidden="true" />
            今日阅读
          </dt>
          <dd className="mt-1 text-sm font-semibold text-[#172033]">{activity.today_count} 篇</dd>
        </div>
      </dl>

      {weeks.length ? (
        <div className="mt-4">
          <div className="grid grid-cols-[1.4rem_minmax(0,1fr)] gap-2">
            <div aria-hidden="true" />
            <div
              className="grid h-4 gap-[3px] text-[9px] leading-none text-[#9aa5b4]"
              style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}
              aria-hidden="true"
            >
              {weeks.map((week) => <span key={week.key} className="whitespace-nowrap">{week.monthLabel}</span>)}
            </div>
            <div className="grid grid-rows-7 gap-[3px] text-[9px] text-[#9aa5b4]" aria-hidden="true">
              {['一', '', '三', '', '五', '', '日'].map((label, index) => (
                <span key={`${label}-${index}`} className="flex items-center">{label}</span>
              ))}
            </div>
            <div
              className="grid gap-[3px]"
              style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}
              role="grid"
              aria-label={`近 16 周论文阅读活动，共看过 ${totalCount} 篇论文，今日 ${activity.today_count} 篇`}
            >
              {weeks.map((week) => (
                <div key={week.key} className="grid grid-rows-7 gap-[3px]" role="row">
                  {week.cells.map((cell, dayIndex) => {
                    if (!cell.date) {
                      return <span key={`${week.key}-${dayIndex}`} className="aspect-square" aria-hidden="true" />;
                    }
                    const label = formatActivityTooltip(cell.date, cell.count);
                    return (
                      <Tooltip key={cell.date}>
                        <TooltipTrigger asChild>
                          <span
                            role="gridcell"
                            tabIndex={cell.count > 0 ? 0 : -1}
                            aria-label={label}
                            className={`aspect-square rounded-[3px] ring-1 ring-inset outline-none transition focus-visible:ring-2 focus-visible:ring-[#2563eb] ${ACTIVITY_COLORS[getActivityLevel(cell.count)]}`}
                          />
                        </TooltipTrigger>
                        <TooltipContent side="top" sideOffset={6}>{label}</TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-end gap-1 text-[10px] text-[#9aa5b4]" aria-label="颜色越深表示当天阅读论文越多">
            <span>少</span>
            {ACTIVITY_COLORS.map((color, index) => (
              <span key={color} className={`h-2.5 w-2.5 rounded-[3px] ring-1 ring-inset ${color}`} aria-label={`活跃度 ${index}`} />
            ))}
            <span>多</span>
          </div>
        </div>
      ) : (
        <p className="mt-4 rounded-2xl bg-[#f8fafc] px-3 py-5 text-center text-xs text-[#8793a5]">
          暂无阅读活动，标记第一篇“看过”后这里就会亮起来。
        </p>
      )}
    </section>
  );
}

export function HfDailyReadingStatus({ progress }: { progress: HfDailyReadingProgress | null }) {
  if (!progress) {
    return (
      <section aria-labelledby="hf-reading-heading">
        <OverviewSectionTitle id="hf-reading-heading" imageSrc={huggingFaceLogo} title="HF Daily Paper" description="暂无可统计的最新榜单" />
      </section>
    );
  }

  const items = [...progress.items].sort((first, second) => first.rank - second.rank).slice(0, 5);
  const dateLabel = progress.is_today ? '今日榜单' : `最近一期 · ${formatDailyDate(progress.daily_date)}`;

  return (
    <section aria-labelledby="hf-reading-heading">
      <div className="flex items-start justify-between gap-3">
        <OverviewSectionTitle id="hf-reading-heading" imageSrc={huggingFaceLogo} title="HF Daily Paper" description={dateLabel} />
        <span className="shrink-0 rounded-full bg-[#f0fdf4] px-2.5 py-1 text-xs font-semibold text-[#15803d]">
          {progress.read}/{progress.total}
        </span>
      </div>
      {items.length ? (
        <ol className="mt-3 grid grid-cols-5 gap-2" aria-label={`${dateLabel}阅读状态`}>
          {items.map((item) => {
            const label = `第 ${item.rank} 名，${item.title}，${item.viewed ? '已看过' : '未看过'}`;
            return (
              <li key={item.paper_id}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={label}
                      onClick={() => navigate(`/papers/${encodeURIComponent(item.paper_id)}`)}
                      className={`flex aspect-square w-full items-center justify-center rounded-lg border outline-none transition hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-[#2563eb] ${
                        item.viewed
                          ? 'border-[#86efac] bg-[#dcfce7] text-[#16a34a]'
                          : 'border-[#e2e8f0] bg-[#f8fafc] text-[#94a3b8]'
                      }`}
                    >
                      {item.viewed ? <Check className="h-4 w-4" aria-hidden="true" /> : <Circle className="h-3.5 w-3.5" aria-hidden="true" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={6} className="max-w-64">{label}</TooltipContent>
                </Tooltip>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-3 text-xs text-[#8793a5]">本期榜单还没有论文。</p>
      )}
    </section>
  );
}

export function CollectionProgressList({ collections }: { collections: CollectionReadingProgress[] }) {
  const description = collections.length === 1
    ? '当前合集的阅读进度'
    : '所有会议合集的当前阅读进度';

  return (
    <section aria-labelledby="collection-progress-heading">
      <OverviewSectionTitle id="collection-progress-heading" icon={LibraryBig} title="论文合集" description={description} />
      {collections.length ? (
        <ul className="mt-4 space-y-3">
          {collections.map((collection) => {
            const percent = normalizeProgressPercent(collection.read, collection.total, collection.percent);
            return (
              <li key={collection.id}>
                <button
                  type="button"
                  className="group w-full rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                  onClick={() => navigate(`/conference/${encodeURIComponent(collection.id)}`)}
                  aria-label={`${collection.label}，已阅读 ${collection.read} 篇，共 ${collection.total} 篇，${Math.round(percent)}%`}
                >
                  <span className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                    <span className="font-medium text-[#526174] transition group-hover:text-[#ff7a00]">{collection.label}</span>
                    <span className="tabular-nums text-[#8a96a8]">{collection.read}/{collection.total}</span>
                  </span>
                  <Progress
                    value={percent}
                    aria-label={`${collection.label}阅读进度 ${Math.round(percent)}%`}
                    className="h-1.5 bg-[#edf0f3] [&_[data-slot=progress-indicator]]:bg-[#4ade80]"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 rounded-2xl bg-[#f8fafc] px-3 py-5 text-center text-xs text-[#8793a5]">
          暂无可统计的论文合集。
        </p>
      )}
    </section>
  );
}

function ReadingOverviewSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="阅读概览加载中">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 animate-pulse rounded-xl bg-[#edf0f3]" />
        <div className="space-y-2">
          <div className="h-3 w-20 animate-pulse rounded bg-[#e2e8f0]" />
          <div className="h-2.5 w-32 animate-pulse rounded bg-[#edf0f3]" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[0, 1, 2].map((item) => <div key={item} className="h-14 animate-pulse rounded-2xl bg-[#f1f5f9]" />)}
      </div>
      <div className="h-32 animate-pulse rounded-2xl bg-[#f8fafc]" />
      <span className="sr-only">加载中</span>
    </div>
  );
}

export interface ReadingOverviewPanelProps {
  overview: ReadingOverviewResponse | null;
  isLoading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  onRetry: () => void;
  collections?: CollectionReadingProgress[];
  showCollections?: boolean;
}

export function ReadingOverviewPanel({
  overview,
  isLoading,
  error,
  isAuthenticated,
  onRetry,
  collections,
  showCollections = true,
}: ReadingOverviewPanelProps) {
  const visibleCollections = collections ?? overview?.collections ?? [];

  return (
    <aside className="rounded-[28px] bg-white/90 p-5 shadow-sm ring-1 ring-black/5" aria-label="阅读概览">
      <div className="mb-5 flex items-center gap-2">
        <BookOpenCheck className="h-5 w-5 text-[#16a34a]" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-[#172033]">阅读概览</h2>
      </div>
      {!isAuthenticated && !isLoading ? (
        <div className="rounded-2xl bg-[#f8fafc] p-4 text-center">
          <p className="text-sm text-[#66768b]">登录后查看你的阅读活动与合集进度。</p>
          <Button size="sm" className="mt-3 rounded-full" onClick={() => navigate('/login')}>去登录</Button>
        </div>
      ) : isLoading && !overview ? (
        <ReadingOverviewSkeleton />
      ) : error && !overview ? (
        <div className="rounded-2xl bg-[#fff7ed] p-4 text-center">
          <p className="text-sm text-[#9a3412]">{error}</p>
          <Button variant="outline" size="sm" className="mt-3 rounded-full" onClick={onRetry}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            重新加载
          </Button>
        </div>
      ) : overview ? (
        <div className="divide-y divide-[#edf0f3]">
          <div className="pb-5">
            <ActivityHeatmap activity={overview.activity} timezone={overview.timezone} />
          </div>
          <div className="py-5">
            <HfDailyReadingStatus progress={overview.hf_daily} />
          </div>
          {showCollections ? (
            <div className="pt-5">
              <CollectionProgressList collections={visibleCollections} />
            </div>
          ) : null}
          {error ? (
            <div className="mt-4 flex items-center justify-between gap-2 pt-4 text-xs text-[#b45309]">
              <span>刷新失败，当前显示上次结果。</span>
              <button type="button" className="font-medium hover:underline" onClick={onRetry}>重试</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
