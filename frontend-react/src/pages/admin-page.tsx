import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Brain,
  KeyRound,
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
  CartesianGrid,
  Line,
  LineChart,
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
  fetchAdminLlmModels,
  fetchAdminLlmProviders,
  fetchAdminOnlineMetrics,
  fetchAdminUsers,
  resetAdminUserPassword,
  setAdminActiveLlm,
  syncAdminHfDailyPapers,
  testAdminActiveLlm,
  updateAdminLlmProvider,
  updateAdminUser,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { navigate } from '@/lib/router';
import type { AdminLlmProvider, AdminOnlineMetrics, AdminUser, AdminUserListResponse } from '@/types';

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

export function AdminPage() {
  const { user, isLoading } = useAuth();
  const [range, setRange] = useState<'24h' | '7d'>('24h');
  const [metrics, setMetrics] = useState<AdminOnlineMetrics | null>(null);
  const [users, setUsers] = useState<AdminUserListResponse | null>(null);
  const [llmProviders, setLlmProviders] = useState<AdminLlmProvider[]>([]);
  const [selectedLlmProviderId, setSelectedLlmProviderId] = useState<string | null>(null);
  const [providerDrafts, setProviderDrafts] = useState<Record<string, LlmProviderDraft>>({});
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncingHfDaily, setIsSyncingHfDaily] = useState(false);
  const [hfDailyMessage, setHfDailyMessage] = useState<string | null>(null);
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
  const displayedUsers = useMemo(() => {
    return [...(users?.users ?? [])].sort((first, second) => {
      if (first.is_online !== second.is_online) {
        return first.is_online ? -1 : 1;
      }
      const firstSeenAt = first.online_last_seen_at ? new Date(first.online_last_seen_at).getTime() : 0;
      const secondSeenAt = second.online_last_seen_at ? new Date(second.online_last_seen_at).getTime() : 0;
      if (firstSeenAt !== secondSeenAt) {
        return secondSeenAt - firstSeenAt;
      }
      return new Date(second.created_at).getTime() - new Date(first.created_at).getTime();
    });
  }, [users?.users]);

  const load = useCallback(async () => {
    if (!canAccess) {
      return;
    }
    setIsRefreshing(true);
    setError(null);
    try {
      const [nextMetrics, nextUsers, nextLlmProviders] = await Promise.all([
        fetchAdminOnlineMetrics(range),
        fetchAdminUsers(page, search),
        fetchAdminLlmProviders(),
      ]);
      setMetrics(nextMetrics);
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
  }, [canAccess, page, range, search]);

  useEffect(() => {
    void load();
  }, [load]);

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
      {hfDailyMessage ? <div className="rounded-2xl bg-[#ecfdf5] p-4 text-sm text-[#047857]">{hfDailyMessage}</div> : null}
      {llmMessage ? <div className="rounded-2xl bg-[#eff6ff] p-4 text-sm text-[#1d4ed8]">{llmMessage}</div> : null}

      <section className="rounded-[32px] bg-white p-6 shadow-sm ring-1 ring-black/5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-[#ff7a00]" />
              <h2 className="text-xl font-semibold text-[#172033]">大模型配置</h2>
            </div>
            <p className="mt-1 text-sm text-[#728095]">
              当前：{activeProvider ? `${activeProvider.name} / ${activeProvider.active_model ?? '未选择模型'}` : '未配置'}
            </p>
          </div>
          <Button variant="outline" className="rounded-full" onClick={() => void testActiveLlm()} disabled={isTestingLlm || !activeProvider}>
            {isTestingLlm ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TestTube2 className="mr-2 h-4 w-4" />}
            测试当前模型
          </Button>
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
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={metrics?.trend ?? []} margin={{ top: 10, right: 18, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="4 8" stroke="#e7edf5" />
              <XAxis
                dataKey="bucket_at"
                tickFormatter={(value) => formatTrendTick(String(value), range)}
                axisLine={false}
                tickLine={false}
                tickMargin={12}
                tick={{ fill: '#728095', fontSize: 12 }}
              />
              <YAxis
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                tickMargin={10}
                tick={{ fill: '#728095', fontSize: 12 }}
              />
              <Tooltip
                labelFormatter={(value) => new Date(String(value)).toLocaleString()}
                contentStyle={{
                  border: '1px solid rgba(226, 232, 240, 0.9)',
                  borderRadius: 16,
                  boxShadow: '0 18px 40px rgba(15, 23, 42, 0.12)',
                }}
              />
              <Line
                type="natural"
                dataKey="count"
                stroke="#ff7a00"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={{ r: 5, strokeWidth: 2 }}
                name="总在线"
              />
              <Line
                type="natural"
                dataKey="authenticated_count"
                stroke="#2563eb"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={{ r: 5, strokeWidth: 2 }}
                name="登录用户"
              />
              <Line
                type="natural"
                dataKey="guest_count"
                stroke="#16a34a"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={{ r: 5, strokeWidth: 2 }}
                name="游客"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="rounded-[32px] bg-white p-6 shadow-sm ring-1 ring-black/5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold text-[#172033]">用户管理</h2>
            <p className="text-sm text-[#728095]">共 {users?.total ?? 0} 个用户，在线用户优先显示。</p>
          </div>
          <div className="flex gap-2">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索邮箱"
              className="h-10 rounded-full bg-[#f8fafc]"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setPage(1);
                  void load();
                }
              }}
            />
            <Button variant="outline" className="rounded-full" onClick={() => { setPage(1); void load(); }}>
              搜索
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-[#eef2f7] text-[#728095]">
              <tr>
                <th className="py-3">邮箱</th>
                <th>角色</th>
                <th>状态</th>
                <th>注册时间</th>
                <th>最近登录</th>
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
