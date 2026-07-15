import type { ChatSessionSummary } from '@/types';

export type ChatWidgetView = 'chat' | 'history';

export interface ChatWidgetState {
  isOpen: boolean;
  view: ChatWidgetView;
}

export type ChatWidgetAction =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'show-history' }
  | { type: 'show-chat' }
  | { type: 'reset' };

export const INITIAL_CHAT_WIDGET_STATE: ChatWidgetState = {
  isOpen: false,
  view: 'chat',
};

export function chatWidgetReducer(
  state: ChatWidgetState,
  action: ChatWidgetAction,
): ChatWidgetState {
  switch (action.type) {
    case 'open':
      return { isOpen: true, view: 'chat' };
    case 'close':
      return { ...state, isOpen: false };
    case 'reset':
      return INITIAL_CHAT_WIDGET_STATE;
    case 'show-history':
      return state.isOpen ? { ...state, view: 'history' } : state;
    case 'show-chat':
      return state.isOpen ? { ...state, view: 'chat' } : state;
    default:
      return state;
  }
}

export interface ChatSessionGroup {
  id: 'today' | 'recent' | 'older';
  label: string;
  sessions: ChatSessionSummary[];
}

const SESSION_GROUPS: Array<Pick<ChatSessionGroup, 'id' | 'label'>> = [
  { id: 'today', label: '今天' },
  { id: 'recent', label: '最近 7 天' },
  { id: 'older', label: '更早' },
];

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function groupChatSessionsByAge(
  sessions: ChatSessionSummary[],
  now = new Date(),
): ChatSessionGroup[] {
  const todayStart = startOfLocalDay(now).getTime();
  const recentStart = todayStart - 6 * 24 * 60 * 60 * 1000;
  const grouped = new Map<ChatSessionGroup['id'], ChatSessionSummary[]>([
    ['today', []],
    ['recent', []],
    ['older', []],
  ]);

  sessions.forEach((session) => {
    const createdAt = new Date(session.created_at);
    const createdTime = Number.isNaN(createdAt.getTime())
      ? Number.NEGATIVE_INFINITY
      : createdAt.getTime();
    const groupId: ChatSessionGroup['id'] = createdTime >= todayStart
      ? 'today'
      : createdTime >= recentStart
        ? 'recent'
        : 'older';
    grouped.get(groupId)?.push(session);
  });

  return SESSION_GROUPS.flatMap((group) => {
    const groupedSessions = grouped.get(group.id) ?? [];
    return groupedSessions.length ? [{ ...group, sessions: groupedSessions }] : [];
  });
}

export function formatChatSessionDate(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '时间未知';
  }

  if (startOfLocalDay(date).getTime() === startOfLocalDay(now).getTime()) {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}
