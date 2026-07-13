export interface Paper {
  id: string;
  title: string;
  conference?: string;
  conferenceType?: 'Oral' | 'Poster' | 'Spotlight' | '';
  keywords: string[];
  abstract: string;
  venue?: string | null;
  primary_area?: string | null;
  authors?: string[];
  pdf?: string | null;
  llm_response?: string | null;
  created_at?: string;
  sort_order?: number | null;
  code_status?: PaperCodeStatus | null;
  code_url?: string | null;
  code_evidence?: string | null;
  code_checked_at?: string | null;
  hf_daily?: HfDailyPaperMeta | null;
  arxiv?: ArxivPaperMeta | null;
  openReviewUrl?: string;
  pdfUrl?: string;
  hasSeen?: boolean;
  isLiked?: boolean;
  isFavorited?: boolean;
}

export type PaperCodeStatus = 'open_source' | 'unavailable' | 'not_found' | 'unknown';

export interface HfDailyPaperMeta {
  daily_date?: string | null;
  rank?: number | null;
  upvotes?: number | null;
  thumbnail?: string | null;
  discussion_id?: string | null;
  project_page?: string | null;
  github_repo?: string | null;
  github_stars?: number | null;
  num_comments?: number | null;
}

export interface ArxivPaperMeta {
  arxiv_id?: string | null;
  arxiv_url?: string | null;
  pdf_url?: string | null;
  published_at?: string | null;
  updated_at?: string | null;
  added_at?: string | null;
  added_by_user_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface Conference {
  id: string;
  name: string;
  fullName: string;
  year: number;
  paperCount?: number;
}

export interface ConferenceDefinition extends Conference {
  accentClass: string;
}

export type ConferenceSlug = 'iclr_2026' | 'acl_2026' | 'neurips_2025' | 'icml_2025' | 'chi_2026' | 'cvpr_2026';

export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: Date;
  created_at?: string;
}

export interface SearchFilters {
  title: boolean;
  abstract: boolean;
  keywords: boolean;
}

export type PaperReadFilter = 'all' | 'unread' | 'read';

export type PaperCodeFilter = 'all' | 'open_source' | 'not_open_source';

export interface PaperReadCounts {
  all: number;
  unread: number;
  read: number;
}

export interface PaperListResponse {
  papers: Paper[];
  total: number;
  page: number;
  pages: number;
  read_counts?: PaperReadCounts | null;
}

export interface ChatSessionSummary {
  id: string;
  user_id?: string;
  paper_id?: string;
  title: string | null;
  created_at: string;
}

export interface OnlineCount {
  count: number;
  authenticated_count?: number;
  guest_count?: number;
}

export interface ActiveLlmModel {
  configured: boolean;
  provider_key?: string | null;
  provider_name?: string | null;
  model_name?: string | null;
}

export interface PaperMark {
  viewed: boolean;
  liked: boolean;
  favorited: boolean;
  first_viewed_at?: string | null;
  viewed_at?: string | null;
  liked_at?: string | null;
  favorited_at?: string | null;
  updated_at?: string | null;
}

export type MyPaperFilter = 'all' | 'viewed' | 'liked' | 'favorited';
export type MyPaperSort = 'viewed_at' | 'liked_at' | 'favorited_at' | 'favorited_first' | 'updated_at' | 'title';

export interface MarkedPaperItem {
  paper: Paper;
  mark: PaperMark;
}

export interface MarkedPaperListResponse {
  items: MarkedPaperItem[];
  total: number;
  page: number;
  pages: number;
}

export interface ReadingActivityDay {
  date: string;
  count: number;
}

export interface ReadingActivitySummary {
  days: ReadingActivityDay[];
  today_count: number;
  month_count: number;
  current_streak: number;
}

export interface HfDailyReadingItem {
  paper_id: string;
  title: string;
  rank: number;
  viewed: boolean;
}

export interface HfDailyReadingProgress {
  daily_date: string;
  is_today: boolean;
  read: number;
  total: number;
  items: HfDailyReadingItem[];
}

export interface CollectionReadingProgress {
  id: string;
  label: string;
  read: number;
  total: number;
  percent: number;
}

export interface ReadingOverviewResponse {
  timezone: string;
  activity: ReadingActivitySummary;
  hf_daily: HfDailyReadingProgress | null;
  collections: CollectionReadingProgress[];
}

export interface AuthUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
  is_active: boolean;
  email_verified: boolean;
  created_at?: string;
  last_login_at?: string | null;
}

export interface AuthResponse {
  user: AuthUser;
}

export interface FeishuWebhookSettings {
  configured: boolean;
  webhook_url_masked?: string | null;
  enabled: boolean;
  daily_push_count: number;
  last_tested_at?: string | null;
  last_test_status?: string | null;
  last_test_error?: string | null;
}

export interface FeishuWebhookSettingsPayload {
  webhook_url?: string;
  enabled: boolean;
  daily_push_count: number;
}

export interface FeishuWebhookTestResponse {
  ok: boolean;
  result: Record<string, unknown>;
}

export interface AdminUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
  is_active: boolean;
  email_verified: boolean;
  created_at: string;
  last_login_at?: string | null;
  is_online: boolean;
  online_last_seen_at?: string | null;
}

export interface AdminUserListResponse {
  users: AdminUser[];
  total: number;
  page: number;
  pages: number;
}

export type AdminUserSortBy = 'online' | 'created_at' | 'last_login_at';

export type SortDirection = 'asc' | 'desc';

export interface OnlineTrendPoint {
  bucket_at: string;
  count: number;
  authenticated_count: number;
  guest_count: number;
}

export interface AdminOnlineMetrics {
  current: OnlineCount;
  trend: OnlineTrendPoint[];
}

export interface LlmTokenUsageStats {
  request_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_input_tokens: number;
  cache_output_tokens: number;
  total_tokens: number;
}

export interface LlmTokenUsageDailyTotal extends LlmTokenUsageStats {
  date: string;
}

export interface LlmTokenUsageModelTotal extends LlmTokenUsageStats {
  provider_key?: string | null;
  provider_name: string;
  model_name: string;
}

export interface LlmTokenUsageDailyRow extends LlmTokenUsageModelTotal {
  date: string;
}

export interface LlmTokenUsageWindow {
  days: string[];
  totals: LlmTokenUsageStats;
  daily_totals: LlmTokenUsageDailyTotal[];
  model_totals: LlmTokenUsageModelTotal[];
  daily: LlmTokenUsageDailyRow[];
}

export interface AdminLlmTokenUsageMetrics {
  timezone: string;
  generated_at: string;
  weekly: LlmTokenUsageWindow;
  monthly: LlmTokenUsageWindow;
}

export type AdminBackgroundTaskOwner = 'admin' | 'system';

export type AdminBackgroundTaskStatus = 'disabled' | 'stopped' | 'running' | 'failed' | 'idle';

export interface AdminBackgroundTask {
  id: string;
  name: string;
  owner: AdminBackgroundTaskOwner;
  status: AdminBackgroundTaskStatus | string;
  enabled: boolean;
  manageable: boolean;
  description: string;
  metadata: Record<string, unknown>;
}

export interface AdminBackgroundTasksResponse {
  generated_at: string;
  llm_configured: boolean;
  tasks: AdminBackgroundTask[];
}

export interface HfDailySyncResponse {
  daily_date: string;
  selected: number;
  paper_ids: string[];
  analyzable_paper_ids: string[];
}

export interface AdminLlmModel {
  id: string;
  provider_id: string;
  model_name: string;
  display_name?: string | null;
  is_enabled: boolean;
  source?: 'seed' | 'manual' | 'fetched';
  created_at?: string;
  updated_at?: string;
}

export interface AdminLlmProvider {
  id: string;
  provider_key?: string;
  name: string;
  base_url: string;
  has_api_key: boolean;
  api_key_masked?: string | null;
  is_active: boolean;
  is_enabled: boolean;
  is_builtin: boolean;
  active_model?: string | null;
  default_parameters?: Record<string, unknown>;
  models_fetched_at?: string | null;
  created_at?: string;
  updated_at?: string;
  models: AdminLlmModel[];
}

export interface AdminLlmProviderListResponse {
  providers: AdminLlmProvider[];
}

export interface AdminLlmFetchModelsResponse {
  provider: AdminLlmProvider;
  models: AdminLlmModel[];
  fetched: number;
  added: number;
}

export interface AdminLlmTestResponse {
  ok: boolean;
  provider_id: string;
  provider_name: string;
  model_name: string;
  output: string;
}
