import { describe, expect, it } from 'vitest';

import {
  buildActivityCalendar,
  formatActivityDate,
  formatActivityTooltip,
  getActivityLevel,
  getCollectionProgress,
  normalizeProgressPercent,
} from './reading-overview';

describe('buildActivityCalendar', () => {
  it('builds sixteen Monday-first calendar weeks ending at the latest activity date', () => {
    const calendar = buildActivityCalendar([
      { date: '2026-07-12', count: 2 },
      { date: '2026-07-13', count: 3 },
    ]);

    expect(calendar).toHaveLength(16);
    expect(calendar.at(-1)?.cells[0]).toMatchObject({ date: '2026-07-13', count: 3 });
    expect(calendar.at(-1)?.cells[1]).toMatchObject({ date: null, isFuture: true });
    expect(calendar.flatMap((week) => week.cells).find((cell) => cell.date === '2026-07-12')?.count).toBe(2);
  });

  it('ignores invalid dates and clamps negative counts', () => {
    const calendar = buildActivityCalendar([
      { date: 'not-a-date', count: 8 },
      { date: '2026-07-13', count: -2 },
    ], 1);

    expect(calendar).toHaveLength(1);
    expect(calendar[0].cells[0]).toMatchObject({ date: '2026-07-13', count: 0 });
  });
});

describe('reading overview helpers', () => {
  it('maps counts to stable heat levels', () => {
    expect([0, 1, 2, 3, 5].map(getActivityLevel)).toEqual([0, 1, 2, 3, 4]);
  });

  it('formats ISO dates without timezone shifts', () => {
    expect(formatActivityDate('2026-07-13')).toBe('2026年7月13日');
    expect(formatActivityDate('unknown')).toBe('unknown');
    expect(formatActivityTooltip('2026-07-13', 3)).toBe('2026年7月13日 · 看过 3 篇论文');
    expect(formatActivityTooltip('2026-07-12', 0)).toBe('2026年7月12日 · 看过 0 篇论文');
  });

  it('finds collection progress and keeps percentages in range', () => {
    const collections = [{ id: 'acl_2026', label: 'ACL 2026', read: 2, total: 5, percent: 40 }];

    expect(getCollectionProgress(collections, 'acl_2026')?.read).toBe(2);
    expect(getCollectionProgress(collections, 'iclr_2026')).toBeNull();
    expect(normalizeProgressPercent(2, 5, null)).toBe(40);
    expect(normalizeProgressPercent(20, 5, 200)).toBe(100);
    expect(normalizeProgressPercent(0, 0, -1)).toBe(0);
  });
});
