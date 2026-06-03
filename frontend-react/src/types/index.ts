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
  hf_daily?: HfDailyPaperMeta | null;
  openReviewUrl?: string;
  pdfUrl?: string;
  hasSeen?: boolean;
  isLiked?: boolean;
  isFavorited?: boolean;
}

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

export type ConferenceSlug = 'iclr_2026' | 'neurips_2025' | 'icml_2025';

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

export interface PaperListResponse {
  papers: Paper[];
  total: number;
  page: number;
  pages: number;
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

export interface PaperMark {
  viewed: boolean;
  liked: boolean;
  favorited: boolean;
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
}

export interface AdminUserListResponse {
  users: AdminUser[];
  total: number;
  page: number;
  pages: number;
}

export interface AdminInvitationCode {
  id: string;
  code_text?: string | null;
  code_prefix: string;
  max_uses: number;
  used_count: number;
  is_active: boolean;
  created_by?: string | null;
  created_by_email?: string | null;
  created_at: string;
  last_used_at?: string | null;
}

export interface AdminInvitationCodeListResponse {
  codes: AdminInvitationCode[];
}

export interface AdminInvitationCodeCreateResponse {
  code: string;
  invitation: AdminInvitationCode;
}

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
