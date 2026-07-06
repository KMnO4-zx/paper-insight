import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Brain,
  ChevronLeft,
  ChevronRight,
  Clock3,
  KeyRound,
  ListChecks,
  Loader2,
  Plus,
  RefreshCcw,
  Save,
  Server,
  Shield,
  TestTube2,
  Trash2,
  Users,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  changePassword,
  addAdminLlmModel,
  createAdminLlmProvider,
  deleteAdminUser,
  fetchAdminBackgroundTasks,
  fetchAdminLlmTokenUsageMetrics,
  fetchAdminLlmModels,
  fetchAdminLlmProviders,
  fetchAdminOnlineMetrics,
  fetchAdminUsers,
  resetAdminUserPassword,
  setAdminActiveLlm,
  syncAdminHfDailyPapers,
  testAdminActiveLlm,
  updateAdminPaperAnalysisTask,
  updateAdminLlmProvider,
  updateAdminUser,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { navigate } from '@/lib/router';
import type {
  AdminBackgroundTask,
  AdminBackgroundTasksResponse,
  AdminLlmProvider,
  AdminLlmTokenUsageMetrics,
  AdminOnlineMetrics,
  AdminUser,
  AdminUserListResponse,
  AdminUserSortBy,
  LlmTokenUsageDailyTotal,
  OnlineTrendPoint,
  SortDirection,
} from '@/types';

type LlmProviderDraft = {
  name: string;
  base_url: string;
  api_key: string;
  active_model: string;
};

function formatTrendTick(value: string, range: '24h' | '7d') {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return range === '7d'
    ? parsed.toLocaleDateString([], { month: 'numeric', day: 'numeric' })
    : parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const tokenFormatter = new Intl.NumberFormat('en-US');
const TOKEN_DETAIL_PAGE_SIZE = 7;
const ADMIN_TASK_DECK_STORAGE_KEY = 'paper_admin_active_background_task_id';

function readStoredAdminTaskId() {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage.getItem(ADMIN_TASK_DECK_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredAdminTaskId(taskId: string) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(ADMIN_TASK_DECK_STORAGE_KEY, taskId);
  } catch {
    // Ignore storage failures; the deck should still work in memory.
  }
}

function formatTokenCount(value: number | null | undefined) {
  return tokenFormatter.format(value ?? 0);
}

function tokenDailyStackTotal(item: LlmTokenUsageDailyTotal) {
  return item.input_tokens + item.output_tokens + item.cache_input_tokens + item.cache_output_tokens;
}

function tokenYAxisWidth(items: LlmTokenUsageDailyTotal[]) {
  const maxValue = Math.max(0, ...items.map((item) => Math.max(item.total_tokens, tokenDailyStackTotal(item))));
  const labelLength = formatTokenCount(maxValue).length;
  return Math.min(Math.max(labelLength * 8 + 26, 56), 112);
}

function formatDuration(seconds: number | null | undefined) {
  const safeSeconds = Math.max(0, Number(seconds ?? 0));
  if (safeSeconds >= 86400 && safeSeconds % 86400 === 0) {
    return `${safeSeconds / 86400} 天`;
  }
  if (safeSeconds >= 3600 && safeSeconds % 3600 === 0) {
    return `${safeSeconds / 3600} 小时`;
  }
  if (safeSeconds >= 60 && safeSeconds % 60 === 0) {
    return `${safeSeconds / 60} 分钟`;
  }
  return `${safeSeconds} 秒`;
}

function taskStatusLabel(status: string) {
  const labels: Record<string, string> = {
    disabled: '未启用',
    stopped: '已停止',
    running: '运行中',
    failed: '异常',
    idle: '空闲',
  };
  return labels[status] ?? status;
}

function taskStatusClass(status: string) {
  if (status === 'running') {
    return 'border-[#bbf7d0] bg-[#ecfdf5] text-[#047857]';
  }
  if (status === 'failed') {
    return 'border-[#fecdd3] bg-[#fff1f2] text-[#be123c]';
  }
  if (status === 'disabled') {
    return 'border-[#e2e8f0] bg-[#f8fafc] text-[#64748b]';
  }
  return 'border-[#fed7aa] bg-[#fff7ed] text-[#c2410c]';
}

function metadataNumber(task: AdminBackgroundTask | null | undefined, key: string) {
  const value = task?.metadata?.[key];
  return typeof value === 'number' ? value : null;
}

function metadataString(task: AdminBackgroundTask | null | undefined, key: string) {
  const value = task?.metadata?.[key];
  return typeof value === 'string' ? value : null;
}

function formatUsageDate(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
}

type OnlineTrendTooltipProps = {
  active?: boolean;
  label?: string | number;
  payload?: Array<{
    payload?: OnlineTrendPoint;
  }>;
};

function OnlineTrendTooltip({ active, label, payload }: OnlineTrendTooltipProps) {
  if (!active || !payload?.length) {
    return null;
  }

  const point = payload[0]?.payload;
  if (!point) {
    return null;
  }

  return (
    <div className="min-w-40 rounded-2xl border border-slate-200/90 bg-white/95 p-3 text-sm shadow-[0_18px_40px_rgba(15,23,42,0.12)] backdrop-blur">
      <div className="font-medium text-[#172033]">{new Date(String(label)).toLocaleString()}</div>
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center justify-between gap-5 text-[#ff7a00]">
          <span>总在线</span>
          <span className="font-semibold">{point.count}</span>
        </div>
        <div className="flex items-center justify-between gap-5 text-[#2563eb]">
          <span>登录用户</span>
          <span className="font-semibold">{point.authenticated_count}</span>
        </div>
        <div className="flex items-center justify-between gap-5 text-[#16a34a]">
          <span>游客</span>
          <span className="font-semibold">{point.guest_count}</span>
        </div>
      </div>
    </div>
  );
}

type TokenUsageTooltipProps = {
  active?: boolean;
  label?: string | number;
  payload?: Array<{
    payload?: LlmTokenUsageDailyTotal;
  }>;
};

function TokenUsageTooltip({ active, label, payload }: TokenUsageTooltipProps) {
  if (!active || !payload?.length) {
    return null;
  }

  const point = payload[0]?.payload;
  if (!point) {
    return null;
  }

  return (
    <div className="min-w-48 rounded-2xl border border-slate-200/90 bg-white/95 p-3 text-sm shadow-[0_18px_40px_rgba(15,23,42,0.12)] backdrop-blur">
      <div className="font-medium text-[#172033]">{formatUsageDate(String(label))}</div>
      <div className="mt-2 space-y-1.5 text-[#475569]">
        <div className="flex items-center justify-between gap-5">
          <span>总 tokens</span>
          <span className="font-semibold text-[#172033]">{formatTokenCount(point.total_tokens)}</span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span>Input</span>
          <span>{formatTokenCount(point.input_tokens)}</span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span>Output</span>
          <span>{formatTokenCount(point.output_tokens)}</span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span>Cache in</span>
          <span>{formatTokenCount(point.cache_input_tokens)}</span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span>Cache out</span>
          <span>{formatTokenCount(point.cache_output_tokens)}</span>
        </div>
      </div>
    </div>
  );
}

export function AdminPage() {
  const { user, isLoading } = useAuth();
  const [range, setRange] = useState<'24h' | '7d'>('24h');
  const [tokenUsageRange, setTokenUsageRange] = useState<'weekly' | 'monthly'>('weekly');
  const [tokenDetailPage, setTokenDetailPage] = useState(1);
  const [metrics, setMetrics] = useState<AdminOnlineMetrics | null>(null);
  const [tokenUsage, setTokenUsage] = useState<AdminLlmTokenUsageMetrics | null>(null);
  const [backgroundTasks, setBackgroundTasks] = useState<AdminBackgroundTasksResponse | null>(null);
  const [paperAnalysisEnabled, setPaperAnalysisEnabled] = useState(false);
  const [paperAnalysisIntervalMinutes, setPaperAnalysisIntervalMinutes] = useState('');
  const [activeAdminTaskIndex, setActiveAdminTaskIndex] = useState(0);
  const [users, setUsers] = useState<AdminUserListResponse | null>(null);
  const [llmProviders, setLlmProviders] = useState<AdminLlmProvider[]>([]);
  const [selectedLlmProviderId, setSelectedLlmProviderId] = useState<string | null>(null);
  const [providerDrafts, setProviderDrafts] = useState<Record<string, LlmProviderDraft>>({});
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [userSortBy, setUserSortBy] = useState<AdminUserSortBy>('online');
  const [userSortDirection, setUserSortDirection] = useState<SortDirection>('desc');
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRefreshingUsers, setIsRefreshingUsers] = useState(false);
  const [isUpdatingPaperAnalysis, setIsUpdatingPaperAnalysis] = useState(false);
  const [isSyncingHfDaily, setIsSyncingHfDaily] = useState(false);
  const [hfDailyMessage, setHfDailyMessage] = useState<string | null>(null);
  const [backgroundTaskMessage, setBackgroundTaskMessage] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [llmMessage, setLlmMessage] = useState<string | null>(null);
  const [updatingProviderId, setUpdatingProviderId] = useState<string | null>(null);
  const [fetchingProviderId, setFetchingProviderId] = useState<string | null>(null);
  const [addingModelProviderId, setAddingModelProviderId] = useState<string | null>(null);
  const [activatingProviderId, setActivatingProviderId] = useState<string | null>(null);
  const [isTestingLlm, setIsTestingLlm] = useState(false);
  const [isCreatingProvider, setIsCreatingProvider] = useState(false);
  const [newProvider, setNewProvider] = useState({
    name: '',
    base_url: '',
    api_key: '',
    models: '',
  });

  const canAccess = user?.role === 'admin';
  const displayedUsers = users?.users ?? [];

  const load = useCallback(async () => {
    if (!canAccess) {
      return;
    }
    setIsRefreshing(true);
    setError(null);
    try {
      const [nextMetrics, nextTokenUsage, nextBackgroundTasks, nextUsers, nextLlmProviders] = await Promise.all([
        fetchAdminOnlineMetrics(range),
        fetchAdminLlmTokenUsageMetrics(),
        fetchAdminBackgroundTasks(),
        fetchAdminUsers(page, search, userSortBy, userSortDirection),
        fetchAdminLlmProviders(),
      ]);
      setMetrics(nextMetrics);
      setTokenUsage(nextTokenUsage);
      setBackgroundTasks(nextBackgroundTasks);
      const nextPaperAnalysisTask = nextBackgroundTasks.tasks.find((task) => task.id === 'paper_analysis');
      const nextIntervalSeconds = metadataNumber(nextPaperAnalysisTask, 'check_interval_seconds') ?? 86400;
      setPaperAnalysisEnabled(Boolean(nextPaperAnalysisTask?.enabled));
      setPaperAnalysisIntervalMinutes(String(Math.max(1, Math.round(nextIntervalSeconds / 60))));
      setUsers(nextUsers);
      setLlmProviders(nextLlmProviders.providers);
      setSelectedLlmProviderId((current) => {
        if (current && nextLlmProviders.providers.some((provider) => provider.id === current)) {
          return current;
        }
        return nextLlmProviders.providers.find((provider) => provider.is_active)?.id
          ?? nextLlmProviders.providers[0]?.id
          ?? null;
      });
      setProviderDrafts(Object.fromEntries(
        nextLlmProviders.providers.map((provider) => [
          provider.id,
          {
            name: provider.name,
            base_url: provider.base_url,
            api_key: '',
            active_model: provider.active_model ?? provider.models[0]?.model_name ?? '',
          },
        ]),
      ));
      setModelDrafts(Object.fromEntries(nextLlmProviders.providers.map((provider) => [provider.id, ''])));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setIsRefreshing(false);
    }
  }, [canAccess, page, range, search, userSortBy, userSortDirection]);

  const refreshUsers = useCallback(async (nextPage = page) => {
    if (!canAccess) {
      return;
    }
    setIsRefreshingUsers(true);
    setError(null);
    try {
      const [nextMetrics, nextUsers] = await Promise.all([
        fetchAdminOnlineMetrics(range),
        fetchAdminUsers(nextPage, search, userSortBy, userSortDirection),
      ]);
      setMetrics(nextMetrics);
      setUsers(nextUsers);
    } catch (err) {
      setError(err instanceof Error ? err.message : '刷新用户列表失败');
    } finally {
      setIsRefreshingUsers(false);
    }
  }, [canAccess, page, range, search, userSortBy, userSortDirection]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleUserSort = (sortBy: AdminUserSortBy) => {
    setPage(1);
    if (userSortBy === sortBy) {
      setUserSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setUserSortBy(sortBy);
    setUserSortDirection('desc');
  };

  const runUserSearch = () => {
    setPage(1);
    void refreshUsers(1);
  };

  const renderUserDateSortButton = (sortBy: Extract<AdminUserSortBy, 'created_at' | 'last_login_at'>) => {
    const isActive = userSortBy === sortBy;
    const isAscending = isActive && userSortDirection === 'asc';
    return (
      <Button
        type="button"
        variant={isActive ? 'default' : 'outline'}
        size="sm"
        className="h-7 rounded-full px-2 text-xs"
        onClick={() => toggleUserSort(sortBy)}
        title={isActive ? (isAscending ? '切换为倒序' : '切换为正序') : '按此列排序'}
      >
        {isAscending ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
        {isActive ? (isAscending ? '正序' : '倒序') : '排序'}
      </Button>
    );
  };

  const onlineSortLabel = userSortBy === 'online' && userSortDirection === 'asc' ? '离线优先' : '在线优先';

  const activeProvider = llmProviders.find((provider) => provider.is_active) ?? null;
  const selectedProvider = llmProviders.find((provider) => provider.id === selectedLlmProviderId)
    ?? activeProvider
    ?? llmProviders[0]
    ?? null;
  const selectedProviderDraft = selectedProvider
    ? (providerDrafts[selectedProvider.id] ?? {
      name: selectedProvider.name,
      base_url: selectedProvider.base_url,
      api_key: '',
      active_model: selectedProvider.active_model ?? selectedProvider.models[0]?.model_name ?? '',
    })
    : null;
  const paperAnalysisTask = useMemo(
    () => backgroundTasks?.tasks.find((task) => task.id === 'paper_analysis') ?? null,
    [backgroundTasks],
  );
  const adminTasks = useMemo(
    () => backgroundTasks?.tasks.filter((task) => task.owner === 'admin') ?? [],
    [backgroundTasks],
  );
  const systemTasks = useMemo(
    () => backgroundTasks?.tasks.filter((task) => task.owner === 'system') ?? [],
    [backgroundTasks],
  );
  const paperLibraryTotal = metadataNumber(paperAnalysisTask, 'total_paper_count')
    ?? metadataNumber(adminTasks.find((task) => task.id === 'code_availability'), 'total_paper_count')
    ?? metadataNumber(adminTasks.find((task) => task.id === 'keyword_enrichment'), 'total_paper_count')
    ?? 0;
  const activeAdminTask = adminTasks[activeAdminTaskIndex] ?? adminTasks[0] ?? null;
  const trendData = metrics?.trend ?? [];
  const selectedTokenUsage = tokenUsageRange === 'weekly' ? tokenUsage?.weekly : tokenUsage?.monthly;
  const tokenDailyTotals = selectedTokenUsage?.daily_totals ?? [];
  const tokenDailyRows = selectedTokenUsage?.daily ?? [];
  const tokenTotals = selectedTokenUsage?.totals;
  const tokenAxisWidth = tokenYAxisWidth(tokenDailyTotals);
  const tokenDetailPages = Math.max(1, Math.ceil(tokenDailyRows.length / TOKEN_DETAIL_PAGE_SIZE));
  const currentTokenDetailPage = Math.min(tokenDetailPage, tokenDetailPages);
  const pagedTokenDailyRows = tokenDailyRows.slice(
    (currentTokenDetailPage - 1) * TOKEN_DETAIL_PAGE_SIZE,
    currentTokenDetailPage * TOKEN_DETAIL_PAGE_SIZE,
  );

  useEffect(() => {
    setTokenDetailPage((current) => Math.min(current, tokenDetailPages));
  }, [tokenDetailPages]);

  useEffect(() => {
    setActiveAdminTaskIndex((current) => {
      if (adminTasks.length === 0) {
        return 0;
      }
      const storedTaskId = readStoredAdminTaskId();
      const storedIndex = storedTaskId
        ? adminTasks.findIndex((task) => task.id === storedTaskId)
        : -1;
      if (storedIndex >= 0) {
        return storedIndex;
      }
      const nextIndex = Math.min(current, adminTasks.length - 1);
      const nextTask = adminTasks[nextIndex];
      if (nextTask) {
        writeStoredAdminTaskId(nextTask.id);
      }
      return nextIndex;
    });
  }, [adminTasks]);

  if (isLoading) {
    return (
      <div className="mx-auto flex max-w-5xl items-center gap-2 rounded-[32px] bg-white p-8 text-[#728095]">
        <Loader2 className="h-5 w-5 animate-spin" />
        加载账号状态...
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="mx-auto max-w-2xl rounded-[32px] bg-white p-8 shadow-sm ring-1 ring-black/5">
        <h1 className="text-2xl font-semibold text-[#172033]">需要管理员权限</h1>
        <p className="mt-3 text-sm leading-6 text-[#728095]">请使用管理员账号登录后访问后台。</p>
        <Button className="mt-6 rounded-full" onClick={() => navigate('/login')}>去登录</Button>
      </div>
    );
  }

  const submitPasswordChange = async () => {
    setPasswordMessage(null);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setPasswordMessage('密码已更新');
    } catch (err) {
      setPasswordMessage(err instanceof Error ? err.message : '密码更新失败');
    }
  };

  const saveProvider = async (provider: AdminLlmProvider) => {
    const draft = providerDrafts[provider.id];
    if (!draft) {
      return;
    }
    setError(null);
    setLlmMessage(null);
    setUpdatingProviderId(provider.id);
    try {
      const payload: Parameters<typeof updateAdminLlmProvider>[1] = {
        name: draft.name,
        base_url: draft.base_url,
      };
      if (draft.api_key.trim()) {
        payload.api_key = draft.api_key.trim();
      }
      await updateAdminLlmProvider(provider.id, payload);
      setLlmMessage('供应商配置已保存');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存供应商失败');
    } finally {
      setUpdatingProviderId(null);
    }
  };

  const fetchModels = async (provider: AdminLlmProvider) => {
    setError(null);
    setLlmMessage(null);
    setFetchingProviderId(provider.id);
    try {
      const payload = await fetchAdminLlmModels(provider.id);
      setLlmMessage(`已获取 ${payload.fetched} 个模型，新增 ${payload.added} 个。`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取模型列表失败');
    } finally {
      setFetchingProviderId(null);
    }
  };

  const addModel = async (provider: AdminLlmProvider) => {
    const modelName = (modelDrafts[provider.id] ?? '').trim();
    if (!modelName) {
      setError('模型名称不能为空');
      return;
    }
    setError(null);
    setLlmMessage(null);
    setAddingModelProviderId(provider.id);
    try {
      await addAdminLlmModel(provider.id, modelName);
      setLlmMessage('模型已添加');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加模型失败');
    } finally {
      setAddingModelProviderId(null);
    }
  };

  const activateProvider = async (provider: AdminLlmProvider) => {
    const modelName = providerDrafts[provider.id]?.active_model
      ?? provider.active_model
      ?? provider.models[0]?.model_name
      ?? null;
    setError(null);
    setLlmMessage(null);
    setActivatingProviderId(provider.id);
    try {
      await setAdminActiveLlm(provider.id, modelName);
      setLlmMessage('当前大模型已切换');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '切换大模型失败');
    } finally {
      setActivatingProviderId(null);
    }
  };

  const testActiveLlm = async () => {
    setError(null);
    setLlmMessage(null);
    setIsTestingLlm(true);
    try {
      const payload = await testAdminActiveLlm();
      setLlmMessage(`测试通过：${payload.provider_name} / ${payload.model_name} 输出 “${payload.output || '(空)'}”`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '模型测试失败');
    } finally {
      setIsTestingLlm(false);
    }
  };

  const createProvider = async () => {
    const models = newProvider.models
      .split(/[\n,，]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    setError(null);
    setLlmMessage(null);
    setIsCreatingProvider(true);
    try {
      await createAdminLlmProvider({
        name: newProvider.name,
        base_url: newProvider.base_url,
        api_key: newProvider.api_key,
        models,
        active_model: models[0],
      });
      setNewProvider({ name: '', base_url: '', api_key: '', models: '' });
      setLlmMessage('自定义供应商已添加');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加自定义供应商失败');
    } finally {
      setIsCreatingProvider(false);
    }
  };

  const toggleUserActive = async (target: AdminUser) => {
    setError(null);
    try {
      await updateAdminUser(target.id, { is_active: !target.is_active });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新用户状态失败');
    }
  };

  const resetPassword = async (target: AdminUser) => {
    const nextPassword = window.prompt(`输入 ${target.email} 的新密码（至少 8 位）`);
    if (!nextPassword) {
      return;
    }
    setError(null);
    try {
      await resetAdminUserPassword(target.id, nextPassword);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '重置密码失败');
    }
  };

  const deleteUser = async (target: AdminUser) => {
    setError(null);
    try {
      await deleteAdminUser(target.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除用户失败');
    }
  };

  const savePaperAnalysisTask = async () => {
    const intervalMinutes = Number(paperAnalysisIntervalMinutes);
    if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1) {
      setError('后台分析间隔至少需要 1 分钟');
      return;
    }

    setError(null);
    setBackgroundTaskMessage(null);
    setIsUpdatingPaperAnalysis(true);
    try {
      const payload = await updateAdminPaperAnalysisTask({
        enabled: paperAnalysisEnabled,
        check_interval_seconds: Math.round(intervalMinutes * 60),
      });
      setBackgroundTasks(payload);
      setBackgroundTaskMessage('论文后台分析配置已更新');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新后台分析配置失败');
    } finally {
      setIsUpdatingPaperAnalysis(false);
    }
  };

  const syncHfDailyPapers = async () => {
    setError(null);
    setHfDailyMessage(null);
    setIsSyncingHfDaily(true);
    try {
      const payload = await syncAdminHfDailyPapers();
      setHfDailyMessage(`已同步 ${payload.selected} 篇 HF Daily Papers，后台将自动分析待分析论文。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '同步 HF Daily Papers 失败');
    } finally {
      setIsSyncingHfDaily(false);
    }
  };

  const selectAdminTaskIndex = (nextIndex: number) => {
    if (adminTasks.length === 0) {
      setActiveAdminTaskIndex(0);
      return;
    }
    const normalizedIndex = (nextIndex + adminTasks.length) % adminTasks.length;
    const nextTask = adminTasks[normalizedIndex];
    setActiveAdminTaskIndex(normalizedIndex);
    if (nextTask) {
      writeStoredAdminTaskId(nextTask.id);
    }
  };

  const showPreviousAdminTask = () => {
    selectAdminTaskIndex(activeAdminTaskIndex - 1);
  };

  const showNextAdminTask = () => {
    selectAdminTaskIndex(activeAdminTaskIndex + 1);
  };

  return (
    <div className="mx-auto max-w-7xl animate-fade-in space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-[#172033]">管理员后台</h1>
          <p className="mt-1 text-sm text-[#728095]">大模型配置、在线趋势、用户管理和管理员密码维护。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="rounded-full" onClick={() => void syncHfDailyPapers()} disabled={isSyncingHfDaily}>
            {isSyncingHfDaily ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
            同步 HF Daily
          </Button>
          <Button variant="outline" className="rounded-full" onClick={() => void load()} disabled={isRefreshing}>
            {isRefreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
            刷新
          </Button>
        </div>
      </div>

      {error ? <div className="rounded-2xl bg-[#fff1f2] p-4 text-sm text-[#b91c1c]">{error}</div> : null}
      {backgroundTaskMessage ? <div className="rounded-2xl bg-[#eff6ff] p-4 text-sm text-[#1d4ed8]">{backgroundTaskMessage}</div> : null}
      {hfDailyMessage ? <div className="rounded-2xl bg-[#ecfdf5] p-4 text-sm text-[#047857]">{hfDailyMessage}</div> : null}

      <section className="rounded-[32px] bg-white p-5 shadow-sm ring-1 ring-black/5">
        <div className="mb-3.5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-[#2563eb]" />
              <h2 className="text-xl font-semibold text-[#172033]">后台任务</h2>
            </div>
            <p className="mt-1 text-sm text-[#728095]">
              论文分析可由管理员管理；系统任务保持配置驱动。
            </p>
          </div>
          <div className="rounded-full bg-[#f8fafc] px-3 py-1.5 text-xs font-medium text-[#64748b] ring-1 ring-[#e5eaf2]">
            LLM {backgroundTasks?.llm_configured ? '已配置' : '未配置'}
          </div>
        </div>

        <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
          <div className="min-w-0 rounded-[24px] border border-[#e5eaf2] bg-[#f8fafc] p-3.5">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[#172033]">管理员任务</h3>
                <p className="mt-0.5 text-xs text-[#728095]">{adminTasks.length} 个任务</p>
              </div>
              <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-medium text-[#475569] ring-1 ring-[#e5eaf2]">
                论文库 {formatTokenCount(paperLibraryTotal)} 篇
              </span>
            </div>

            {!activeAdminTask ? (
              <div className="rounded-2xl border border-dashed border-[#dbe3ee] px-4 py-6 text-sm text-[#728095]">
                暂无管理员任务状态
              </div>
            ) : (
              <div className="relative min-h-[27rem] overflow-hidden rounded-[24px] bg-[#f8fafc] p-2 sm:min-h-[25rem]">
                {adminTasks.map((task, index) => {
                  const relativeIndex = (index - activeAdminTaskIndex + adminTasks.length) % adminTasks.length;
                  const isActiveTask = relativeIndex === 0;
                  const isHiddenTask = relativeIndex > 2;
                  const isPaperAnalysisTask = task.id === 'paper_analysis';
                  const isCodeAvailabilityTask = task.id === 'code_availability';
                  const isKeywordEnrichmentTask = task.id === 'keyword_enrichment';
                  const totalCount = metadataNumber(task, 'total_paper_count') ?? paperLibraryTotal;
                  const uncheckedCodeCount = metadataNumber(task, 'unchecked_code_availability_count');
                  const missingKeywordCount = metadataNumber(task, 'missing_keyword_count');
                  const uncheckedKeywordCount = metadataNumber(task, 'unchecked_keyword_enrichment_count');
                  const pendingCount = isCodeAvailabilityTask
                    ? metadataNumber(task, 'pending_code_availability_count') ?? uncheckedCodeCount
                    : isKeywordEnrichmentTask
                      ? metadataNumber(task, 'pending_keyword_enrichment_count') ?? missingKeywordCount
                      : metadataNumber(task, 'unanalyzed_count');
                  const pendingLabel = isCodeAvailabilityTask
                    ? '待判断代码'
                    : isKeywordEnrichmentTask
                      ? '待补关键词'
                      : '待分析论文';
                  const currentLabel = isCodeAvailabilityTask
                    ? '当前判断'
                    : isKeywordEnrichmentTask
                      ? '当前补全'
                      : '当前处理';
                  const latestLabel = isCodeAvailabilityTask
                    ? '最近判断'
                    : isKeywordEnrichmentTask
                      ? '最近补全'
                      : '最近分析';
                  const latestPaperId = isCodeAvailabilityTask
                    ? metadataString(task, 'last_checked_paper_id')
                    : isKeywordEnrichmentTask
                      ? metadataString(task, 'last_enriched_paper_id')
                      : metadataString(task, 'last_analyzed_paper_id');
                  const lastRunStartedAt = metadataString(task, 'last_run_started_at');
                  const lastRunFinishedAt = metadataString(task, 'last_run_finished_at');
                  const transformByDepth = [
                    'translate3d(0, 0, 0) scale(1) rotate(0deg)',
                    'translate3d(46px, 18px, 0) scale(0.96) rotate(1deg)',
                    'translate3d(78px, 36px, 0) scale(0.92) rotate(2deg)',
                  ];
                  const deckTransform = transformByDepth[Math.min(relativeIndex, 2)];
                  const deckOpacity = isHiddenTask ? 0 : 1 - relativeIndex * 0.12;

                  return (
                    <div
                      key={task.id}
                      className={`absolute left-2 right-2 top-2 rounded-[22px] border border-[#e5eaf2] bg-white p-3.5 transition-[transform,opacity,box-shadow,border-color] duration-500 ease-out sm:right-8 lg:right-20 ${
                        isActiveTask
                          ? 'shadow-[0_18px_42px_rgba(15,23,42,0.08)]'
                          : 'cursor-pointer shadow-sm hover:border-[#cbd5e1] hover:shadow-[0_14px_30px_rgba(15,23,42,0.08)] [&_*]:pointer-events-none'
                      }`}
                      style={{
                        transform: deckTransform,
                        opacity: deckOpacity,
                        zIndex: 30 - relativeIndex,
                        pointerEvents: isHiddenTask ? 'none' : 'auto',
                        transformOrigin: 'right center',
                      }}
                      aria-hidden={isHiddenTask}
                      onClick={() => {
                        if (!isActiveTask) {
                          selectAdminTaskIndex(index);
                        }
                      }}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-semibold text-[#172033]">{task.name}</h3>
                            <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${taskStatusClass(task.status)}`}>
                              {taskStatusLabel(task.status)}
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-sm text-[#728095]">{task.description}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <div className="hidden rounded-full bg-[#f8fafc] px-2.5 py-1 text-xs font-medium text-[#64748b] ring-1 ring-[#e5eaf2] sm:block">
                            {index + 1}/{adminTasks.length}
                          </div>
                          {isPaperAnalysisTask ? (
                            <label className="inline-flex items-center gap-2 rounded-full bg-[#f8fafc] px-3 py-2 text-sm font-medium text-[#475569] ring-1 ring-[#e5eaf2]">
                              <input
                                type="checkbox"
                                checked={paperAnalysisEnabled}
                                onChange={(event) => setPaperAnalysisEnabled(event.target.checked)}
                                className="h-4 w-4 rounded border-[#cbd5e1] text-[#2563eb]"
                              />
                              启用
                            </label>
                          ) : (
                            <span className="w-fit rounded-full bg-[#f8fafc] px-3 py-2 text-sm font-medium text-[#64748b] ring-1 ring-[#e5eaf2]">
                              跟随调度
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
                        <div className="rounded-2xl bg-[#f8fafc] px-3.5 py-2.5 ring-1 ring-[#e5eaf2]">
                          <div className="text-xs font-medium text-[#728095]">论文总数</div>
                          <div className="mt-1.5 text-2xl font-semibold text-[#172033]">
                            {formatTokenCount(totalCount)}
                          </div>
                        </div>
                        <div className="rounded-2xl bg-[#f8fafc] px-3.5 py-2.5 ring-1 ring-[#e5eaf2]">
                          <div className="text-xs font-medium text-[#728095]">{pendingLabel}</div>
                          <div className="mt-1.5 text-2xl font-semibold text-[#172033]">
                            {formatTokenCount(pendingCount ?? 0)}
                          </div>
                        </div>
                        <div className="rounded-2xl bg-[#f8fafc] px-3.5 py-2.5 ring-1 ring-[#e5eaf2]">
                          <div className="text-xs font-medium text-[#728095]">上一轮结果</div>
                          <div className="mt-1.5 text-sm font-semibold text-[#172033]">
                            成功 {metadataNumber(task, 'last_run_success_count') ?? 0}
                            <span className="mx-1 text-[#cbd5e1]">/</span>
                            失败 {metadataNumber(task, 'last_run_failed_count') ?? 0}
                          </div>
                        </div>
                      </div>

                      {isPaperAnalysisTask ? (
                        <div className="mt-3 grid gap-2.5 lg:grid-cols-[minmax(0,1fr)_auto]">
                          <label className="space-y-1.5">
                            <span className="text-sm font-medium text-[#475569]">检查间隔（分钟）</span>
                            <div className="flex items-center gap-2">
                              <Clock3 className="h-4 w-4 shrink-0 text-[#94a3b8]" />
                              <Input
                                type="number"
                                min={1}
                                step={1}
                                value={paperAnalysisIntervalMinutes}
                                onChange={(event) => setPaperAnalysisIntervalMinutes(event.target.value)}
                                className="h-10 rounded-2xl bg-[#f8fafc]"
                              />
                            </div>
                          </label>
                          <div className="flex items-end">
                            <Button
                              className="h-10 rounded-2xl bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
                              onClick={() => void savePaperAnalysisTask()}
                              disabled={isUpdatingPaperAnalysis}
                            >
                              {isUpdatingPaperAnalysis ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                              保存任务配置
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 rounded-2xl bg-[#f8fafc] px-3.5 py-3 text-sm text-[#728095] ring-1 ring-[#e5eaf2]">
                          <span className="font-medium text-[#475569]">当前间隔：</span>
                          {formatDuration(metadataNumber(task, 'check_interval_seconds'))}
                          {isCodeAvailabilityTask && typeof uncheckedCodeCount === 'number' ? (
                            <span className="ml-3 inline-flex rounded-full bg-white px-2 py-0.5 text-xs font-medium text-[#64748b] ring-1 ring-[#e5eaf2]">
                              未检查总数 {formatTokenCount(uncheckedCodeCount)}
                            </span>
                          ) : null}
                          {isKeywordEnrichmentTask && typeof uncheckedKeywordCount === 'number' ? (
                            <span className="ml-3 inline-flex rounded-full bg-white px-2 py-0.5 text-xs font-medium text-[#64748b] ring-1 ring-[#e5eaf2]">
                              未检查总数 {formatTokenCount(uncheckedKeywordCount)}
                            </span>
                          ) : null}
                          {isKeywordEnrichmentTask && typeof missingKeywordCount === 'number' ? (
                            <span className="ml-2 inline-flex rounded-full bg-white px-2 py-0.5 text-xs font-medium text-[#64748b] ring-1 ring-[#e5eaf2]">
                              缺失关键词 {formatTokenCount(missingKeywordCount)}
                            </span>
                          ) : null}
                        </div>
                      )}

                      <div className="mt-3 grid min-w-0 gap-1.5 text-xs text-[#728095] sm:grid-cols-2">
                        <div className="min-w-0 truncate" title={metadataString(task, 'current_paper_id') ?? undefined}>
                          {currentLabel}：{metadataString(task, 'current_paper_id') ?? '-'}
                        </div>
                        <div className="min-w-0 truncate" title={latestPaperId ?? undefined}>
                          {latestLabel}：{latestPaperId ?? '-'}
                        </div>
                        <div className="min-w-0 truncate">
                          上次开始：{lastRunStartedAt ? new Date(lastRunStartedAt).toLocaleString() : '-'}
                        </div>
                        <div className="min-w-0 truncate">
                          上次结束：{lastRunFinishedAt ? new Date(lastRunFinishedAt).toLocaleString() : '-'}
                        </div>
                      </div>

                      {isActiveTask && adminTasks.length > 1 ? (
                        <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#edf2f7] pt-3">
                          <div className="flex gap-1.5">
                            {adminTasks.map((dotTask, dotIndex) => (
                              <button
                                key={dotTask.id}
                                type="button"
                                className={`h-2.5 rounded-full transition-all ${
                                  dotIndex === activeAdminTaskIndex ? 'w-6 bg-[#2563eb]' : 'w-2.5 bg-[#cbd5e1] hover:bg-[#94a3b8]'
                                }`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  selectAdminTaskIndex(dotIndex);
                                }}
                                aria-label={`切换到${dotTask.name}`}
                              />
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-9 w-9 rounded-full"
                              onClick={(event) => {
                                event.stopPropagation();
                                showPreviousAdminTask();
                              }}
                              title="上一张任务卡"
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-9 w-9 rounded-full"
                              onClick={(event) => {
                                event.stopPropagation();
                                showNextAdminTask();
                              }}
                              title="下一张任务卡"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ) : null}
                      {!isActiveTask ? (
                        <div className="pointer-events-none absolute inset-0 rounded-[22px] bg-white/80 backdrop-blur-[1px]">
                          <div className="absolute inset-y-0 right-0 flex w-28 flex-col justify-center border-l border-[#edf2f7] bg-white/85 p-3 text-right">
                            <div className="text-xs font-medium text-[#94a3b8]">下一张</div>
                            <div className="mt-2 line-clamp-3 text-sm font-semibold leading-5 text-[#172033]">
                              {task.name}
                            </div>
                            <span className={`mt-3 inline-flex self-end rounded-full border px-2 py-0.5 text-xs font-medium ${taskStatusClass(task.status)}`}>
                              {taskStatusLabel(task.status)}
                            </span>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex h-full flex-col rounded-[24px] border border-[#e5eaf2] bg-white p-3.5">
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-[#172033]">系统内置任务</h3>
              <span className="text-xs text-[#728095]">{systemTasks.length} 个任务</span>
            </div>
            <div className="grid flex-1 auto-rows-fr gap-2.5 2xl:grid-cols-2">
              {systemTasks.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[#dbe3ee] px-4 py-6 text-sm text-[#728095]">
                  暂无系统任务状态
                </div>
              ) : (
                systemTasks.map((task) => (
                  <div key={task.id} className="flex h-full flex-col justify-between rounded-2xl border border-[#edf2f7] bg-[#f8fafc] px-3 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[#172033]">{task.name}</div>
                        <div className="mt-0.5 truncate text-xs text-[#728095]">{task.description}</div>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${taskStatusClass(task.status)}`}>
                        {taskStatusLabel(task.status)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-[#728095]">
                      <span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-[#e5eaf2]">
                        {task.enabled ? '已启用' : '未启用'}
                      </span>
                      {metadataNumber(task, 'interval_seconds') ? (
                        <span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-[#e5eaf2]">
                          间隔 {formatDuration(metadataNumber(task, 'interval_seconds'))}
                        </span>
                      ) : null}
                      {metadataString(task, 'fetch_time') ? (
                        <span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-[#e5eaf2]">
                          {metadataString(task, 'fetch_time')}
                        </span>
                      ) : null}
                      {metadataString(task, 'push_time') ? (
                        <span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-[#e5eaf2]">
                          {metadataString(task, 'push_time')}
                        </span>
                      ) : null}
                      {metadataNumber(task, 'active_jobs') ? (
                        <span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-[#e5eaf2]">
                          活跃 {metadataNumber(task, 'active_jobs')}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[32px] bg-white p-6 shadow-sm ring-1 ring-black/5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="shrink-0">
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-[#ff7a00]" />
              <h2 className="text-xl font-semibold text-[#172033]">大模型配置</h2>
            </div>
            <p className="mt-1 text-sm text-[#728095]">
              当前：{activeProvider ? `${activeProvider.name} / ${activeProvider.active_model ?? '未选择模型'}` : '未配置'}
            </p>
          </div>
          <div className="flex flex-1 flex-col gap-3 lg:flex-row lg:items-start lg:justify-end">
            {llmMessage ? (
              <div className="min-w-0 flex-1 rounded-2xl bg-[#eff6ff] px-4 py-3 text-sm text-[#1d4ed8]">
                {llmMessage}
              </div>
            ) : null}
            <Button variant="outline" className="shrink-0 rounded-full" onClick={() => void testActiveLlm()} disabled={isTestingLlm || !activeProvider}>
              {isTestingLlm ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TestTube2 className="mr-2 h-4 w-4" />}
              测试当前模型
            </Button>
          </div>
        </div>

        <div className="grid items-start gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-[#728095]">供应商</div>
            <div className="max-h-[24rem] space-y-2 overflow-y-auto pr-1">
              {llmProviders.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[#dbe3ee] px-4 py-6 text-sm text-[#728095]">
                  暂无供应商配置
                </div>
              ) : (
                llmProviders.map((provider) => {
                  const isSelected = selectedProvider?.id === provider.id;
                  const modelName = provider.active_model ?? provider.models[0]?.model_name ?? '未选择模型';
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      className={`w-full rounded-2xl border px-3 py-2.5 text-left transition ${
                        isSelected
                          ? 'border-[#ff9900] bg-[#fff7ed] shadow-sm'
                          : 'border-[#e5eaf2] bg-[#f8fafc] hover:border-[#cbd5e1] hover:bg-white'
                      }`}
                      onClick={() => setSelectedLlmProviderId(provider.id)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-[#172033]">{provider.name}</div>
                          <div className="mt-0.5 truncate text-xs text-[#728095]">{modelName}</div>
                        </div>
                        {provider.is_active ? (
                          <span className="shrink-0 rounded-full bg-[#ecfdf5] px-2 py-1 text-xs text-[#047857]">当前</span>
                        ) : null}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-[#728095]">
                        <span className="rounded-full bg-white px-2 py-1 ring-1 ring-[#e5eaf2]">
                          {provider.is_builtin ? '内置' : '自定义'}
                        </span>
                        <span>{provider.has_api_key ? 'Key 已配置' : 'Key 未配置'}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="min-w-0">
            {selectedProvider && selectedProviderDraft ? (
              <div className="space-y-5">
                <div className="flex flex-col gap-3 border-b border-[#edf2f7] pb-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-lg font-semibold text-[#172033]">{selectedProvider.name}</h3>
                      {selectedProvider.is_active ? <span className="rounded-full bg-[#ecfdf5] px-2 py-1 text-xs text-[#047857]">当前使用中</span> : null}
                      <span className="rounded-full bg-[#f1f5f9] px-2 py-1 text-xs text-[#475569]">
                        {selectedProvider.is_builtin ? '内置供应商' : '自定义供应商'}
                      </span>
                    </div>
                    <div className="mt-1 truncate font-mono text-xs text-[#728095]">{selectedProvider.base_url}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                      onClick={() => void saveProvider(selectedProvider)}
                      disabled={updatingProviderId === selectedProvider.id}
                    >
                      {updatingProviderId === selectedProvider.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
                      保存配置
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                      onClick={() => void fetchModels(selectedProvider)}
                      disabled={fetchingProviderId === selectedProvider.id}
                    >
                      {fetchingProviderId === selectedProvider.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="mr-1 h-3.5 w-3.5" />}
                      获取模型
                    </Button>
                    <Button
                      size="sm"
                      className="rounded-full bg-[#ff9900] text-white hover:bg-[#f08300]"
                      onClick={() => void activateProvider(selectedProvider)}
                      disabled={activatingProviderId === selectedProvider.id || !selectedProviderDraft.active_model}
                    >
                      {activatingProviderId === selectedProvider.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                      设为当前
                    </Button>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-[#475569]">供应商名称</span>
                    <Input
                      value={selectedProviderDraft.name}
                      onChange={(event) => setProviderDrafts((drafts) => ({
                        ...drafts,
                        [selectedProvider.id]: { ...selectedProviderDraft, name: event.target.value },
                      }))}
                      className="h-11 rounded-2xl bg-[#f8fafc] font-medium text-[#172033]"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-[#475569]">Base URL</span>
                    <div className="flex items-center gap-2">
                      <Server className="h-4 w-4 shrink-0 text-[#94a3b8]" />
                      <Input
                        value={selectedProviderDraft.base_url}
                        onChange={(event) => setProviderDrafts((drafts) => ({
                          ...drafts,
                          [selectedProvider.id]: { ...selectedProviderDraft, base_url: event.target.value },
                        }))}
                        className="h-11 rounded-2xl bg-[#f8fafc] font-mono text-sm"
                      />
                    </div>
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-[#475569]">API Key</span>
                    <Input
                      type="password"
                      value={selectedProviderDraft.api_key}
                      onChange={(event) => setProviderDrafts((drafts) => ({
                        ...drafts,
                        [selectedProvider.id]: { ...selectedProviderDraft, api_key: event.target.value },
                      }))}
                      placeholder={selectedProvider.has_api_key ? '留空则不修改 Key' : '粘贴 API Key'}
                      className="h-11 rounded-2xl bg-[#f8fafc]"
                    />
                  </label>
                  <div className="space-y-2">
                    <span className="text-sm font-medium text-[#475569]">Key 状态</span>
                    <div className="flex h-11 items-center gap-2 rounded-2xl bg-[#f8fafc] px-4 text-sm text-[#728095] ring-1 ring-[#e5eaf2]">
                      <KeyRound className="h-4 w-4" />
                      {selectedProvider.has_api_key ? selectedProvider.api_key_masked : '未配置'}
                    </div>
                  </div>
                </div>

                <div className="border-t border-[#edf2f7] pt-5">
                  <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h4 className="text-sm font-semibold text-[#172033]">模型</h4>
                      <p className="text-xs text-[#728095]">
                        已配置 {selectedProvider.models.length} 个模型
                        {selectedProvider.models_fetched_at ? `，最近获取 ${new Date(selectedProvider.models_fetched_at).toLocaleString()}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.8fr)_auto]">
                    <select
                      value={selectedProviderDraft.active_model}
                      onChange={(event) => setProviderDrafts((drafts) => ({
                        ...drafts,
                        [selectedProvider.id]: { ...selectedProviderDraft, active_model: event.target.value },
                      }))}
                      className="h-11 min-w-0 rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-3 text-sm text-[#172033]"
                    >
                      {selectedProvider.models.length === 0 ? <option value="">暂无模型</option> : null}
                      {selectedProvider.models.map((model) => (
                        <option key={model.id} value={model.model_name}>
                          {model.display_name ?? model.model_name}
                        </option>
                      ))}
                    </select>
                    <Input
                      value={modelDrafts[selectedProvider.id] ?? ''}
                      onChange={(event) => setModelDrafts((drafts) => ({ ...drafts, [selectedProvider.id]: event.target.value }))}
                      placeholder="手动添加模型名"
                      className="h-11 rounded-2xl bg-[#f8fafc]"
                    />
                    <Button
                      variant="outline"
                      className="h-11 rounded-2xl"
                      onClick={() => void addModel(selectedProvider)}
                      disabled={addingModelProviderId === selectedProvider.id}
                    >
                      {addingModelProviderId === selectedProvider.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                      添加模型
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-80 items-center justify-center rounded-2xl border border-dashed border-[#dbe3ee] text-sm text-[#728095]">
                请选择或添加一个供应商
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 border-t border-[#edf2f7] pt-5">
          <div className="mb-3 flex items-center gap-2">
            <Plus className="h-4 w-4 text-[#ff9900]" />
            <h3 className="text-sm font-semibold text-[#172033]">添加自定义供应商</h3>
          </div>
          <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr_1fr_1fr_auto]">
          <Input
            value={newProvider.name}
            onChange={(event) => setNewProvider((current) => ({ ...current, name: event.target.value }))}
            placeholder="自定义供应商名称"
            className="h-11 rounded-2xl bg-[#f8fafc]"
          />
          <Input
            value={newProvider.base_url}
            onChange={(event) => setNewProvider((current) => ({ ...current, base_url: event.target.value }))}
            placeholder="Base URL，例如 https://api.example.com/v1"
            className="h-11 rounded-2xl bg-[#f8fafc]"
          />
          <Input
            type="password"
            value={newProvider.api_key}
            onChange={(event) => setNewProvider((current) => ({ ...current, api_key: event.target.value }))}
            placeholder="API Key"
            className="h-11 rounded-2xl bg-[#f8fafc]"
          />
          <Input
            value={newProvider.models}
            onChange={(event) => setNewProvider((current) => ({ ...current, models: event.target.value }))}
            placeholder="模型名，可用逗号分隔"
            className="h-11 rounded-2xl bg-[#f8fafc]"
          />
          <Button className="h-11 rounded-2xl bg-[#ff9900] text-white hover:bg-[#f08300]" onClick={() => void createProvider()} disabled={isCreatingProvider}>
            {isCreatingProvider ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            添加供应商
          </Button>
          </div>
        </div>
      </section>

      <section className="rounded-[32px] bg-white p-6 shadow-sm ring-1 ring-black/5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-[#0f766e]" />
              <h2 className="text-xl font-semibold text-[#172033]">Token 消耗</h2>
            </div>
            <p className="mt-1 text-sm text-[#728095]">
              {tokenUsage ? `时区：${tokenUsage.timezone}` : '暂无 token 记录'}
            </p>
          </div>
          <div className="flex gap-2">
            {(['weekly', 'monthly'] as const).map((item) => (
              <Button
                key={item}
                variant={tokenUsageRange === item ? 'default' : 'outline'}
                className="rounded-full"
                onClick={() => setTokenUsageRange(item)}
              >
                {item === 'weekly' ? '最近一周' : '最近一个月'}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ['总 tokens', tokenTotals?.total_tokens],
            ['Input', tokenTotals?.input_tokens],
            ['Output', tokenTotals?.output_tokens],
            ['Cache in', tokenTotals?.cache_input_tokens],
            ['Cache out', tokenTotals?.cache_output_tokens],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-2xl bg-[#f8fafc] px-4 py-3 ring-1 ring-[#e5eaf2]">
              <div className="text-xs font-medium text-[#728095]">{label}</div>
              <div className="mt-2 truncate text-2xl font-semibold text-[#172033]">
                {formatTokenCount(Number(value ?? 0))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5">
          <div className="min-w-0">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm font-semibold text-[#172033]">每日总量</div>
              <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-[#728095]">
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#2563eb]" />
                  Input
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#10b981]" />
                  Output
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#f59e0b]" />
                  Cache in
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#8b5cf6]" />
                  Cache out
                </span>
              </div>
            </div>
            <div className="h-72">
              {tokenDailyTotals.every((item) => item.total_tokens === 0) ? (
                <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-[#728095]">
                  暂无 token 消耗
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={tokenDailyTotals}
                    margin={{ top: 8, right: 18, left: 8, bottom: 0 }}
                    barCategoryGap={tokenUsageRange === 'weekly' ? '42%' : '30%'}
                  >
                    <CartesianGrid vertical={false} strokeDasharray="4 8" stroke="#e7edf5" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatUsageDate}
                      axisLine={false}
                      tickLine={false}
                      tickMargin={12}
                      minTickGap={18}
                      tick={{ fill: '#728095', fontSize: 12 }}
                    />
                    <YAxis
                      allowDecimals={false}
                      axisLine={false}
                      tickLine={false}
                      tickMargin={10}
                      width={tokenAxisWidth}
                      tickFormatter={(value) => formatTokenCount(Number(value))}
                      tick={{ fill: '#728095', fontSize: 12 }}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(15, 118, 110, 0.06)' }}
                      content={<TokenUsageTooltip />}
                    />
                    <Bar dataKey="input_tokens" stackId="tokens" fill="#2563eb" name="Input" maxBarSize={30} />
                    <Bar dataKey="output_tokens" stackId="tokens" fill="#10b981" name="Output" maxBarSize={30} />
                    <Bar dataKey="cache_input_tokens" stackId="tokens" fill="#f59e0b" name="Cache in" maxBarSize={30} />
                    <Bar dataKey="cache_output_tokens" stackId="tokens" fill="#8b5cf6" name="Cache out" maxBarSize={30} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm font-semibold text-[#172033]">每日模型明细</div>
            <div className="text-xs text-[#728095]">
              共 {tokenDailyRows.length} 条，每页 {TOKEN_DETAIL_PAGE_SIZE} 条
            </div>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-[#e5eaf2]">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-[#f8fafc] text-xs text-[#728095]">
                <tr>
                  <th className="px-3 py-2">日期</th>
                  <th className="px-3 py-2">模型</th>
                  <th className="px-3 py-2">供应商</th>
                  <th className="px-3 py-2 text-right">调用</th>
                  <th className="px-3 py-2 text-right">Input</th>
                  <th className="px-3 py-2 text-right">Output</th>
                  <th className="px-3 py-2 text-right">Cache in</th>
                  <th className="px-3 py-2 text-right">Cache out</th>
                  <th className="px-3 py-2 text-right">总 tokens</th>
                </tr>
              </thead>
              <tbody>
                {tokenDailyRows.length === 0 ? (
                  <tr>
                    <td className="px-3 py-4 text-[#728095]" colSpan={9}>暂无 token 消耗</td>
                  </tr>
                ) : (
                  pagedTokenDailyRows.map((item) => (
                    <tr key={`${item.date}:${item.provider_key ?? item.provider_name}:${item.model_name}`} className="border-t border-[#eef2f7]">
                      <td className="px-3 py-2 text-[#475569]">{formatUsageDate(item.date)}</td>
                      <td className="px-3 py-2">
                        <div className="max-w-80 truncate font-medium text-[#172033]">{item.model_name}</div>
                      </td>
                      <td className="px-3 py-2 text-[#475569]">{item.provider_name}</td>
                      <td className="px-3 py-2 text-right text-[#475569]">{formatTokenCount(item.request_count)}</td>
                      <td className="px-3 py-2 text-right text-[#475569]">{formatTokenCount(item.input_tokens)}</td>
                      <td className="px-3 py-2 text-right text-[#475569]">{formatTokenCount(item.output_tokens)}</td>
                      <td className="px-3 py-2 text-right text-[#475569]">{formatTokenCount(item.cache_input_tokens)}</td>
                      <td className="px-3 py-2 text-right text-[#475569]">{formatTokenCount(item.cache_output_tokens)}</td>
                      <td className="px-3 py-2 text-right font-medium text-[#172033]">{formatTokenCount(item.total_tokens)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {tokenDailyRows.length > TOKEN_DETAIL_PAGE_SIZE ? (
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                className="rounded-full"
                disabled={currentTokenDetailPage <= 1}
                onClick={() => setTokenDetailPage((current) => Math.max(1, current - 1))}
              >
                上一页
              </Button>
              <span className="text-sm text-[#728095]">{currentTokenDetailPage} / {tokenDetailPages}</span>
              <Button
                variant="outline"
                className="rounded-full"
                disabled={currentTokenDetailPage >= tokenDetailPages}
                onClick={() => setTokenDetailPage((current) => Math.min(tokenDetailPages, current + 1))}
              >
                下一页
              </Button>
            </div>
          ) : null}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-black/5">
          <div className="flex items-center gap-2 text-sm text-[#728095]">
            <Users className="h-4 w-4 text-[#16a34a]" />
            当前在线
          </div>
          <div className="mt-3 text-3xl font-semibold text-[#172033]">{metrics?.current.count ?? 0}</div>
        </div>
        <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-black/5">
          <div className="text-sm text-[#728095]">登录用户</div>
          <div className="mt-3 text-3xl font-semibold text-[#2563eb]">{metrics?.current.authenticated_count ?? 0}</div>
        </div>
        <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-black/5">
          <div className="text-sm text-[#728095]">游客</div>
          <div className="mt-3 text-3xl font-semibold text-[#ff7a00]">{metrics?.current.guest_count ?? 0}</div>
        </div>
      </section>

      <section className="rounded-[32px] bg-white p-6 shadow-sm ring-1 ring-black/5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-[#172033]">在线人数趋势</h2>
          <div className="flex gap-2">
            {(['24h', '7d'] as const).map((item) => (
              <Button
                key={item}
                variant={range === item ? 'default' : 'outline'}
                className="rounded-full"
                onClick={() => setRange(item)}
              >
                {item === '24h' ? '24 小时' : '7 天'}
              </Button>
            ))}
          </div>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-4 text-xs font-medium text-[#728095]">
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm bg-[#2563eb]" />
            登录用户
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm bg-[#16a34a]" />
            游客
          </span>
        </div>
        <div className="h-72">
          {trendData.length === 0 ? (
            <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-[#728095]">
              暂无趋势数据
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={trendData}
                margin={{ top: 8, right: 18, left: -12, bottom: 0 }}
                barCategoryGap={range === '24h' ? '36%' : '28%'}
              >
                <CartesianGrid vertical={false} strokeDasharray="4 8" stroke="#e7edf5" />
                <XAxis
                  dataKey="bucket_at"
                  tickFormatter={(value) => formatTrendTick(String(value), range)}
                  axisLine={false}
                  tickLine={false}
                  tickMargin={12}
                  minTickGap={28}
                  tick={{ fill: '#728095', fontSize: 12 }}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  tickMargin={10}
                  domain={[0, 'dataMax + 1']}
                  tick={{ fill: '#728095', fontSize: 12 }}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(37, 99, 235, 0.06)' }}
                  content={<OnlineTrendTooltip />}
                />
                <Bar
                  dataKey="authenticated_count"
                  stackId="online"
                  fill="#2563eb"
                  name="登录用户"
                  maxBarSize={28}
                />
                <Bar
                  dataKey="guest_count"
                  stackId="online"
                  fill="#16a34a"
                  name="游客"
                  maxBarSize={28}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <section className="rounded-[32px] bg-white p-6 shadow-sm ring-1 ring-black/5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold text-[#172033]">用户管理</h2>
            <p className="text-sm text-[#728095]">
              共 {users?.total ?? 0} 个用户，当前在线 {metrics?.current.authenticated_count ?? 0} 个登录用户。
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant={userSortBy === 'online' ? 'default' : 'outline'}
              className="rounded-full"
              onClick={() => toggleUserSort('online')}
              title={userSortBy === 'online' ? '切换在线状态排序方向' : '按在线状态排序'}
            >
              <Users className="h-4 w-4" />
              {onlineSortLabel}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              onClick={() => void refreshUsers()}
              disabled={isRefreshingUsers}
            >
              {isRefreshingUsers ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
              刷新在线
            </Button>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索邮箱"
              className="h-10 w-[220px] rounded-full bg-[#f8fafc]"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  runUserSearch();
                }
              }}
            />
            <Button variant="outline" className="rounded-full" onClick={runUserSearch}>
              搜索
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="border-b border-[#eef2f7] text-[#728095]">
              <tr>
                <th className="py-3">邮箱</th>
                <th>角色</th>
                <th>状态</th>
                <th>
                  <div className="flex items-center gap-2">
                    <span>注册时间</span>
                    {renderUserDateSortButton('created_at')}
                  </div>
                </th>
                <th>
                  <div className="flex items-center gap-2">
                    <span>最近登录</span>
                    {renderUserDateSortButton('last_login_at')}
                  </div>
                </th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {displayedUsers.length === 0 ? (
                <tr>
                  <td className="py-4 text-[#728095]" colSpan={6}>暂无用户</td>
                </tr>
              ) : (
                displayedUsers.map((target) => (
                  <tr key={target.id} className="border-b border-[#f1f5f9]">
                    <td className="py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-[#172033]">{target.email}</span>
                        {target.is_online ? (
                          <span
                            className="inline-flex items-center gap-1.5 rounded-full border border-[#bbf7d0] bg-[#ecfdf5] px-2 py-0.5 text-xs font-medium text-[#047857]"
                            title={target.online_last_seen_at ? `最近在线：${new Date(target.online_last_seen_at).toLocaleString()}` : '当前在线'}
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e] shadow-[0_0_0_3px_rgba(34,197,94,0.16)]" />
                            在线
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>{target.role === 'admin' ? '管理员' : '用户'}</td>
                    <td>{target.is_active ? '启用' : '停用'}</td>
                    <td>{new Date(target.created_at).toLocaleDateString()}</td>
                    <td>{target.last_login_at ? new Date(target.last_login_at).toLocaleString() : '-'}</td>
                    <td className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" className="rounded-full" onClick={() => void toggleUserActive(target)}>
                          {target.is_active ? '停用' : '启用'}
                        </Button>
                        <Button variant="outline" size="sm" className="rounded-full" onClick={() => void resetPassword(target)}>
                          重置密码
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="rounded-full border-[#fecdd3] bg-[#fff1f2] text-[#be123c] hover:border-[#fda4af] hover:bg-[#ffe4e6] hover:text-[#9f1239]"
                              disabled={target.id === user?.id}
                              title={target.id === user?.id ? '不能删除当前登录管理员' : undefined}
                            >
                              <Trash2 className="mr-1 h-4 w-4" />
                              删除
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>确认删除用户？</AlertDialogTitle>
                              <AlertDialogDescription>
                                将删除 {target.email} 的账号、登录会话、论文标记和已归属的聊天记录。此操作无法撤销。
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="rounded-full">取消</AlertDialogCancel>
                              <AlertDialogAction
                                className="rounded-full bg-[#e11d48] text-white hover:bg-[#be123c]"
                                onClick={() => void deleteUser(target)}
                              >
                                确认删除
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="outline" className="rounded-full" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
            上一页
          </Button>
          <span className="text-sm text-[#728095]">{users?.page ?? page} / {users?.pages ?? 1}</span>
          <Button variant="outline" className="rounded-full" disabled={page >= (users?.pages ?? 1)} onClick={() => setPage((current) => current + 1)}>
            下一页
          </Button>
        </div>
      </section>

      <section className="rounded-[32px] bg-white p-6 shadow-sm ring-1 ring-black/5">
        <div className="mb-4 flex items-center gap-2">
          <Shield className="h-5 w-5 text-[#ff7a00]" />
          <h2 className="text-xl font-semibold text-[#172033]">修改管理员密码</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <Input
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            placeholder="当前密码"
            className="h-11 rounded-2xl bg-[#f8fafc]"
          />
          <Input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder="新密码"
            className="h-11 rounded-2xl bg-[#f8fafc]"
          />
          <Button className="rounded-2xl" onClick={() => void submitPasswordChange()}>更新密码</Button>
        </div>
        {passwordMessage ? <div className="mt-3 text-sm text-[#728095]">{passwordMessage}</div> : null}
      </section>
    </div>
  );
}
