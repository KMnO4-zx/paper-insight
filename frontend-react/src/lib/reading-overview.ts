import type { CollectionReadingProgress, ReadingActivityDay } from '@/types';

export interface ActivityCalendarCell {
  date: string | null;
  count: number;
  isFuture: boolean;
}

export interface ActivityCalendarWeek {
  key: string;
  monthLabel: string | null;
  cells: ActivityCalendarCell[];
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function parseIsoDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== Number(match[1])
    || parsed.getUTCMonth() !== Number(match[2]) - 1
    || parsed.getUTCDate() !== Number(match[3])
  ) {
    return null;
  }
  return timestamp;
}

function toIsoDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function startOfMondayWeek(timestamp: number): number {
  const day = new Date(timestamp).getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  return timestamp - daysSinceMonday * DAY_IN_MS;
}

export function buildActivityCalendar(
  days: ReadingActivityDay[],
  weekCount = 16,
): ActivityCalendarWeek[] {
  if (weekCount <= 0) {
    return [];
  }

  const validDays = days
    .map((day) => ({ ...day, timestamp: parseIsoDate(day.date) }))
    .filter((day): day is ReadingActivityDay & { timestamp: number } => day.timestamp !== null);
  if (!validDays.length) {
    return [];
  }

  const countByDate = new Map(validDays.map((day) => [day.date, Math.max(0, day.count)]));
  const latestTimestamp = Math.max(...validDays.map((day) => day.timestamp));
  const firstWeekTimestamp = startOfMondayWeek(latestTimestamp) - (weekCount - 1) * 7 * DAY_IN_MS;

  return Array.from({ length: weekCount }, (_, weekIndex) => {
    const weekTimestamp = firstWeekTimestamp + weekIndex * 7 * DAY_IN_MS;
    const cells = Array.from({ length: 7 }, (_, dayIndex): ActivityCalendarCell => {
      const timestamp = weekTimestamp + dayIndex * DAY_IN_MS;
      const date = toIsoDate(timestamp);
      const isFuture = timestamp > latestTimestamp;
      return {
        date: isFuture ? null : date,
        count: isFuture ? 0 : (countByDate.get(date) ?? 0),
        isFuture,
      };
    });
    const firstDate = cells.find((cell) => cell.date)?.date ?? null;
    const monthStart = cells.find((cell) => cell.date?.endsWith('-01'))?.date ?? null;
    const labelDate = weekIndex === 0 ? firstDate : monthStart;

    return {
      key: toIsoDate(weekTimestamp),
      monthLabel: labelDate ? `${Number(labelDate.slice(5, 7))}月` : null,
      cells,
    };
  });
}

export function getActivityLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) {
    return 0;
  }
  if (count === 1) {
    return 1;
  }
  if (count === 2) {
    return 2;
  }
  if (count <= 4) {
    return 3;
  }
  return 4;
}

export function formatActivityDate(date: string): string {
  const timestamp = parseIsoDate(date);
  if (timestamp === null) {
    return date;
  }
  const parsed = new Date(timestamp);
  return `${parsed.getUTCFullYear()}年${parsed.getUTCMonth() + 1}月${parsed.getUTCDate()}日`;
}

export function formatActivityTooltip(date: string, count: number): string {
  return `${formatActivityDate(date)} · 看过 ${Math.max(0, count)} 篇论文`;
}

export function getCollectionProgress(
  collections: CollectionReadingProgress[],
  collectionId: string,
): CollectionReadingProgress | null {
  return collections.find((collection) => collection.id === collectionId) ?? null;
}

export function normalizeProgressPercent(
  read: number,
  total: number,
  percent?: number | null,
): number {
  const computed = total > 0 ? (read / total) * 100 : 0;
  const value = typeof percent === 'number' && Number.isFinite(percent) ? percent : computed;
  return Math.min(100, Math.max(0, value));
}
