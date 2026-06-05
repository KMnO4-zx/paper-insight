import type {
  AdminLlmFetchModelsResponse,
  AdminLlmProvider,
  AdminLlmProviderListResponse,
  AdminLlmTestResponse,
  AdminOnlineMetrics,
  AdminUserListResponse,
  AuthResponse,
  ChatMessage,
  ChatSessionSummary,
  FeishuWebhookSettings,
  FeishuWebhookSettingsPayload,
  FeishuWebhookTestResponse,
  MarkedPaperListResponse,
  MyPaperFilter,
  MyPaperSort,
  OnlineCount,
  Paper,
  PaperMark,
  PaperListResponse,
  HfDailySyncResponse,
  SearchFilters,
} from '@/types';

const DEV_API_BASE =
  typeof window === 'undefined'
    ? 'http://127.0.0.1:8000'
    : `${window.location.protocol}//${window.location.hostname}:8000`;

const API_BASE = import.meta.env.DEV ? DEV_API_BASE : '';

export function apiUrl(path: string): string {
  return path.startsWith('/') ? `${API_BASE}${path}` : path;
}

export function githubAuthUrl(nextPath = '/'): string {
  const params = new URLSearchParams({ next: nextPath });
  return apiUrl(`/auth/github/start?${params.toString()}`);
}

interface StreamOptions {
  onChunk?: (chunk: string) => void;
  onEvent?: (event: string, data: string) => void;
}

function buildSearchRequestParams(
  page: number,
  query: string,
  filters: SearchFilters,
): URLSearchParams {
  const params = new URLSearchParams({
    page: String(page),
    limit: '8',
  });

  if (query.trim()) {
    params.set('search', query.trim());
    params.set('search_title', String(filters.title));
    params.set('search_abstract', String(filters.abstract));
    params.set('search_keywords', String(filters.keywords));
  }

  return params;
}

async function readJson<T>(response: Response): Promise<T> {
  if (response.ok) {
    return (await response.json()) as T;
  }

  let detail = 'Request failed';
  try {
    const parsed = (await response.json()) as { detail?: string };
    detail = parsed.detail ?? detail;
  } catch {
    detail = response.statusText || detail;
  }
  throw new Error(detail);
}

async function apiRequest(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const request = typeof input === 'string' ? apiUrl(input) : input;
  return fetch(request, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
}

async function apiFetch<T>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
  const response = await apiRequest(input, init);
  return readJson<T>(response);
}

export async function fetchPaperInfo(paperId: string): Promise<Paper> {
  return apiFetch<Paper>(`/paper/${paperId}/info`);
}

export async function fetchConferencePapers(
  venue: string,
  page: number,
  query: string,
  filters: SearchFilters,
): Promise<PaperListResponse> {
  const params = buildSearchRequestParams(page, query, filters);
  return apiFetch<PaperListResponse>(`/conference/${venue}/papers?${params.toString()}`);
}

export async function fetchSearchPapers(
  page: number,
  query: string,
  filters: SearchFilters,
): Promise<PaperListResponse> {
  const params = buildSearchRequestParams(page, query, filters);
  return apiFetch<PaperListResponse>(`/search/papers?${params.toString()}`);
}

export async function fetchHfDailyPapers(
  page: number,
  query: string,
  filters: SearchFilters,
): Promise<PaperListResponse> {
  const params = buildSearchRequestParams(page, query, filters);
  return apiFetch<PaperListResponse>(`/hf-daily-papers?${params.toString()}`);
}

export async function fetchChatSessions(paperId: string): Promise<ChatSessionSummary[]> {
  const response = await apiRequest(`/paper/${paperId}/chat/sessions`);
  if (response.status === 401) {
    return [];
  }
  return readJson<ChatSessionSummary[]>(response);
}

export async function fetchChatMessages(sessionId: string): Promise<ChatMessage[]> {
  return apiFetch<ChatMessage[]>(`/chat/${sessionId}/messages`);
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/chat/${sessionId}`, { method: 'DELETE' });
}

export async function fetchOnlineCount(): Promise<number> {
  const payload = await apiFetch<OnlineCount>('/online/count');
  return payload.count;
}

export async function sendHeartbeat(clientId: string): Promise<void> {
  await apiFetch<{ status: string }>('/online/heartbeat', {
    method: 'POST',
    body: JSON.stringify({ client_id: clientId }),
  });
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function logout(): Promise<void> {
  await apiFetch<{ ok: boolean }>('/auth/logout', { method: 'POST' });
}

export async function fetchMe(): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/me');
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiFetch<{ ok: boolean }>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}

export async function migrateAnonymousData(
  anonymousUserId: string | null,
  paperMarks: Record<string, PaperMark>,
): Promise<void> {
  await apiFetch<{ sessions: number; marks: number }>('/auth/migrate-anonymous', {
    method: 'POST',
    body: JSON.stringify({ anonymous_user_id: anonymousUserId, paper_marks: paperMarks }),
  });
}

export async function fetchPaperMarks(paperIds: string[]): Promise<Record<string, PaperMark>> {
  if (paperIds.length === 0) {
    return {};
  }
  const params = new URLSearchParams({ paper_ids: paperIds.join(',') });
  const response = await apiRequest(`/me/paper-marks?${params.toString()}`);
  if (response.status === 401) {
    return {};
  }
  const payload = await readJson<{ marks: Record<string, PaperMark> }>(response);
  return payload.marks;
}

export async function fetchMyPapers(
  filter: MyPaperFilter,
  sort: MyPaperSort,
  page: number,
): Promise<MarkedPaperListResponse> {
  const params = new URLSearchParams({
    filter,
    sort,
    page: String(page),
    limit: '12',
  });
  return apiFetch<MarkedPaperListResponse>(`/me/papers?${params.toString()}`);
}

export async function fetchFeishuWebhookSettings(): Promise<FeishuWebhookSettings> {
  return apiFetch<FeishuWebhookSettings>('/me/feishu-webhook');
}

export async function updateFeishuWebhookSettings(
  payload: FeishuWebhookSettingsPayload,
): Promise<FeishuWebhookSettings> {
  return apiFetch<FeishuWebhookSettings>('/me/feishu-webhook', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function testFeishuWebhook(): Promise<FeishuWebhookTestResponse> {
  return apiFetch<FeishuWebhookTestResponse>('/me/feishu-webhook/test', { method: 'POST' });
}

export async function updatePaperMark(
  paperId: string,
  mark: Partial<PaperMark>,
): Promise<PaperMark> {
  return apiFetch<PaperMark>(`/papers/${paperId}/mark`, {
    method: 'PUT',
    body: JSON.stringify(mark),
  });
}

export async function fetchAdminOnlineMetrics(range: '24h' | '7d'): Promise<AdminOnlineMetrics> {
  return apiFetch<AdminOnlineMetrics>(`/admin/metrics/online?range=${range}`);
}

export async function syncAdminHfDailyPapers(): Promise<HfDailySyncResponse> {
  return apiFetch<HfDailySyncResponse>('/admin/hf-daily-papers/sync', { method: 'POST' });
}

export async function fetchAdminUsers(
  page: number,
  search: string,
): Promise<AdminUserListResponse> {
  const params = new URLSearchParams({ page: String(page), limit: '10' });
  if (search.trim()) {
    params.set('search', search.trim());
  }
  return apiFetch<AdminUserListResponse>(`/admin/users?${params.toString()}`);
}

export async function fetchAdminLlmProviders(): Promise<AdminLlmProviderListResponse> {
  return apiFetch<AdminLlmProviderListResponse>('/admin/llm/providers');
}

export async function createAdminLlmProvider(payload: {
  name: string;
  base_url: string;
  api_key?: string;
  models?: string[];
  active_model?: string;
}): Promise<AdminLlmProvider> {
  return apiFetch<AdminLlmProvider>('/admin/llm/providers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateAdminLlmProvider(
  providerId: string,
  payload: {
    name?: string;
    base_url?: string;
    api_key?: string | null;
    is_enabled?: boolean;
  },
): Promise<AdminLlmProvider> {
  return apiFetch<AdminLlmProvider>(`/admin/llm/providers/${providerId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function addAdminLlmModel(
  providerId: string,
  modelName: string,
): Promise<void> {
  await apiFetch(`/admin/llm/providers/${providerId}/models`, {
    method: 'POST',
    body: JSON.stringify({ model_name: modelName }),
  });
}

export async function fetchAdminLlmModels(providerId: string): Promise<AdminLlmFetchModelsResponse> {
  return apiFetch<AdminLlmFetchModelsResponse>(`/admin/llm/providers/${providerId}/fetch-models`, {
    method: 'POST',
  });
}

export async function setAdminActiveLlm(
  providerId: string,
  modelName?: string | null,
): Promise<AdminLlmProvider> {
  return apiFetch<AdminLlmProvider>('/admin/llm/active', {
    method: 'POST',
    body: JSON.stringify({ provider_id: providerId, model_name: modelName }),
  });
}

export async function testAdminActiveLlm(): Promise<AdminLlmTestResponse> {
  return apiFetch<AdminLlmTestResponse>('/admin/llm/test', { method: 'POST' });
}

export async function updateAdminUser(
  userId: string,
  patch: { role?: 'user' | 'admin'; is_active?: boolean },
): Promise<void> {
  await apiFetch(`/admin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function resetAdminUserPassword(userId: string, password: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/admin/users/${userId}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export async function deleteAdminUser(userId: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/admin/users/${userId}`, { method: 'DELETE' });
}

function dispatchEvent(block: string, handlers: StreamOptions): void {
  if (!block.trim()) {
    return;
  }

  let eventName = 'message';
  const dataLines: string[] = [];

  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim() || 'message';
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  const payload = dataLines.join('\n');
  if (eventName === 'message' && payload) {
    handlers.onChunk?.(payload);
  }
  handlers.onEvent?.(eventName, payload);
}

export async function streamSse(
  input: RequestInfo | URL,
  init: RequestInit,
  handlers: StreamOptions,
): Promise<void> {
  const request = typeof input === 'string' ? apiUrl(input) : input;
  const response = await fetch(request, { credentials: 'include', ...init });
  if (!response.ok) {
    throw new Error(response.statusText || 'Stream request failed');
  }

  if (!response.body) {
    throw new Error('Streaming is not supported in this browser');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n');
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      dispatchEvent(part, handlers);
    }
  }

  if (buffer.trim()) {
    dispatchEvent(buffer, handlers);
  }
}
