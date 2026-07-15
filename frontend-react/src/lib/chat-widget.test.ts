import { describe, expect, it } from 'vitest';

import type { ChatSessionSummary } from '@/types';
import {
  chatWidgetReducer,
  formatChatSessionDate,
  groupChatSessionsByAge,
  INITIAL_CHAT_WIDGET_STATE,
} from './chat-widget';

function session(id: string, createdAt: Date): ChatSessionSummary {
  return {
    id,
    title: `会话 ${id}`,
    created_at: createdAt.toISOString(),
  };
}

describe('chatWidgetReducer', () => {
  it('opens on the conversation view and preserves the visible view while closing', () => {
    const opened = chatWidgetReducer(INITIAL_CHAT_WIDGET_STATE, { type: 'open' });
    const history = chatWidgetReducer(opened, { type: 'show-history' });
    const closed = chatWidgetReducer(history, { type: 'close' });

    expect(opened).toEqual({ isOpen: true, view: 'chat' });
    expect(history).toEqual({ isOpen: true, view: 'history' });
    expect(closed).toEqual({ isOpen: false, view: 'history' });
    expect(chatWidgetReducer(closed, { type: 'open' })).toEqual({ isOpen: true, view: 'chat' });
  });

  it('does not switch hidden views and resets all widget state', () => {
    expect(chatWidgetReducer(INITIAL_CHAT_WIDGET_STATE, { type: 'show-history' }))
      .toBe(INITIAL_CHAT_WIDGET_STATE);
    expect(chatWidgetReducer({ isOpen: true, view: 'history' }, { type: 'reset' }))
      .toBe(INITIAL_CHAT_WIDGET_STATE);
  });
});

describe('chat session history helpers', () => {
  it('groups sessions into today, the previous six days, and older dates', () => {
    const now = new Date(2026, 6, 15, 12, 0, 0);
    const groups = groupChatSessionsByAge([
      session('today', new Date(2026, 6, 15, 8, 30, 0)),
      session('recent', new Date(2026, 6, 10, 18, 0, 0)),
      session('older', new Date(2026, 6, 8, 23, 59, 0)),
    ], now);

    expect(groups.map((group) => [group.id, group.sessions.map((item) => item.id)]))
      .toEqual([
        ['today', ['today']],
        ['recent', ['recent']],
        ['older', ['older']],
      ]);
  });

  it('formats today as a time and reports invalid timestamps safely', () => {
    const now = new Date(2026, 6, 15, 12, 0, 0);
    const today = formatChatSessionDate(new Date(2026, 6, 15, 8, 5, 0).toISOString(), now);

    expect(today).toMatch(/08:05/);
    expect(formatChatSessionDate('invalid', now)).toBe('时间未知');
  });
});
