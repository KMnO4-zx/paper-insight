import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, RefreshCcw, Search, Settings2, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  fetchAdminApiSearchUsers,
  updateAdminApiSearchSettings,
  updateAdminApiSearchUser,
} from '@/lib/api';
import type { AdminApiSearchUser, AdminApiSearchUsersResponse } from '@/types';

function formatTime(value?: string | null): string {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString();
}

function KeyStatusDot({ user }: { user: AdminApiSearchUser }) {
  const active = user.key_status === 'active';
  return (
    <span
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
        active ? 'bg-[#22c55e] shadow-[0_0_0_3px_rgba(34,197,94,0.16)]' : 'bg-[#cbd5e1]'
      }`}
      title={active ? 'API Key 正常' : 'API Key 已停用'}
    />
  );
}

function QuotaValue({ override, fallback }: { override: number | null; fallback: number }) {
  if (override === null) {
    return (
      <span>
        {fallback}
        <span className="ml-1 text-xs text-[#a8b3c4]">默认</span>
      </span>
    );
  }
  return (
    <span className="font-medium text-[#7c3aed]">
      {override}
      <span className="ml-1 text-xs text-[#a8b3c4]">自定义</span>
    </span>
  );
}

function EditQuotaDialog({
  user,
  onSaved,
}: {
  user: AdminApiSearchUser;
  onSaved: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [rpm, setRpm] = useState(String(user.effective_rpm_limit));
  const [daily, setDaily] = useState(String(user.effective_daily_limit));
  const [useDefaults, setUseDefaults] = useState(user.rpm_limit === null && user.daily_limit === null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setRpm(String(user.effective_rpm_limit));
      setDaily(String(user.effective_daily_limit));
      setUseDefaults(user.rpm_limit === null && user.daily_limit === null);
      setError(null);
    }
  }, [open, user]);

  const save = async () => {
    const rpmValue = Number.parseInt(rpm, 10);
    const dailyValue = Number.parseInt(daily, 10);
    if (!useDefaults && (!Number.isFinite(rpmValue) || rpmValue < 1 || !Number.isFinite(dailyValue) || dailyValue < 1)) {
      setError('额度必须是不小于 1 的整数');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await updateAdminApiSearchUser(user.id, useDefaults ? {
        rpm_limit: null,
        daily_limit: null,
      } : {
        rpm_limit: rpmValue,
        daily_limit: dailyValue,
      });
      setOpen(false);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-full">
          <Settings2 className="mr-1 h-3.5 w-3.5" />
          调整额度
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>调整 {user.email} 的搜索额度</DialogTitle>
          <DialogDescription>
            修改后立即生效。当前生效：每分钟 {user.effective_rpm_limit} 次，每日 {user.effective_daily_limit} 次。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="block text-sm font-medium text-[#364152]">
            每分钟上限（RPM）
            <Input
              type="number"
              min={1}
              value={rpm}
              disabled={useDefaults}
              onChange={(event) => setRpm(event.target.value)}
              className="mt-1 block rounded-2xl bg-[#f8fafc]"
            />
          </label>
          <label className="block text-sm font-medium text-[#364152]">
            每日搜索上限
            <Input
              type="number"
              min={1}
              value={daily}
              disabled={useDefaults}
              onChange={(event) => setDaily(event.target.value)}
              className="mt-1 block rounded-2xl bg-[#f8fafc]"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-[#364152]">
            <input
              type="checkbox"
              checked={useDefaults}
              onChange={(event) => setUseDefaults(event.target.checked)}
              className="h-4 w-4 rounded border-[#cbd5e1]"
            />
            跟随全局默认额度
          </label>
          {error ? <div className="text-sm text-[#b91c1c]">{error}</div> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-full" onClick={() => setOpen(false)} disabled={isSaving}>
            取消
          </Button>
          <Button className="rounded-full" onClick={() => void save()} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AdminApiSearchSection() {
  const [payload, setPayload] = useState<AdminApiSearchUsersResponse | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [defaultRpm, setDefaultRpm] = useState('20');
  const [defaultDaily, setDefaultDaily] = useState('1000');

  const load = useCallback(async (nextPage: number, nextSearch: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchAdminApiSearchUsers(nextPage, nextSearch);
      setPayload(result);
      setDefaultRpm(String(result.defaults.default_rpm_limit));
      setDefaultDaily(String(result.defaults.default_daily_limit));
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜索 API 数据加载失败');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(page, appliedSearch);
  }, [appliedSearch, load, page]);

  const saveDefaults = async () => {
    const rpmValue = Number.parseInt(defaultRpm, 10);
    const dailyValue = Number.parseInt(defaultDaily, 10);
    if (!Number.isFinite(rpmValue) || rpmValue < 1 || !Number.isFinite(dailyValue) || dailyValue < 1) {
      setError('默认额度必须是不小于 1 的整数');
      return;
    }
    setIsMutating(true);
    setMessage(null);
    setError(null);
    try {
      await updateAdminApiSearchSettings({ default_rpm_limit: rpmValue, default_daily_limit: dailyValue });
      setMessage('全局默认额度已更新，立即生效');
      await load(page, appliedSearch);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setIsMutating(false);
    }
  };

  const toggleKey = async (user: AdminApiSearchUser) => {
    setIsMutating(true);
    setMessage(null);
    setError(null);
    try {
      const nextStatus = user.key_status === 'active' ? 'disabled' : 'active';
      await updateAdminApiSearchUser(user.id, { key_status: nextStatus });
      setMessage(nextStatus === 'disabled' ? `已停用 ${user.email} 的 API Key` : `已启用 ${user.email} 的 API Key`);
      await load(page, appliedSearch);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setIsMutating(false);
    }
  };

  const refresh = () => void load(page, appliedSearch);
  const users = payload?.users ?? [];

  return (
    <section className="rounded-[32px] bg-white p-6 shadow-sm ring-1 ring-black/5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-[#7c3aed]" />
            <h2 className="text-xl font-semibold text-[#172033]">搜索 API 管理</h2>
          </div>
          <p className="text-sm text-[#728095]">
            管理论文搜索 API 的全局默认额度和每位用户的 Key 状态，共 {payload?.total ?? 0} 个用户。
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="搜索邮箱"
            className="h-10 w-[220px] rounded-full bg-[#f8fafc]"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                setPage(1);
                setAppliedSearch(searchInput.trim());
              }
            }}
          />
          <Button
            variant="outline"
            className="rounded-full"
            onClick={() => {
              setPage(1);
              setAppliedSearch(searchInput.trim());
            }}
          >
            <Search className="mr-1 h-4 w-4" />
            搜索
          </Button>
          <Button variant="outline" className="rounded-full" onClick={refresh} disabled={isLoading}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
            刷新
          </Button>
        </div>
      </div>

      <div className="mb-5 flex flex-col gap-4 rounded-2xl border border-[#e6ebf2] bg-[#f8fafc]/60 p-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-8">
          <label className="block text-sm font-medium text-[#364152]">
            全局默认 RPM
            <Input
              type="number"
              min={1}
              value={defaultRpm}
              onChange={(event) => setDefaultRpm(event.target.value)}
              className="mt-1 block h-9 w-36 rounded-full bg-white"
            />
          </label>
          <label className="block text-sm font-medium text-[#364152]">
            全局默认每日上限
            <Input
              type="number"
              min={1}
              value={defaultDaily}
              onChange={(event) => setDefaultDaily(event.target.value)}
              className="mt-1 block h-9 w-36 rounded-full bg-white"
            />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-4 w-4 text-[#15803d]" />
          <span className="text-xs text-[#728095]">新用户和未单独设置额度的用户使用以上默认值</span>
          <Button className="rounded-full" onClick={() => void saveDefaults()} disabled={isMutating}>
            {isMutating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            保存默认额度
          </Button>
        </div>
      </div>

      {message ? <div className="mb-4 text-sm text-[#15803d]">{message}</div> : null}
      {error ? <div className="mb-4 text-sm text-[#b91c1c]">{error}</div> : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="border-b border-[#eef2f7] text-[#728095]">
            <tr>
              <th className="py-3">用户</th>
              <th>API Key</th>
              <th>今日已使用</th>
              <th>RPM 上限</th>
              <th>每日上限</th>
              <th>最近调用</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td className="py-4 text-[#728095]" colSpan={7}>
                  {isLoading ? '加载中...' : '暂无用户'}
                </td>
              </tr>
            ) : (
              users.map((target) => (
                <tr key={target.id} className="border-b border-[#f1f5f9]">
                  <td className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-[#172033]">{target.email}</span>
                      {target.role === 'admin' ? (
                        <span className="rounded-full border border-[#fed7aa] bg-[#fff7ed] px-2 py-0.5 text-xs text-[#ea580c]">
                          管理员
                        </span>
                      ) : null}
                      {!target.is_active ? (
                        <span className="rounded-full border border-[#fecdd3] bg-[#fff1f2] px-2 py-0.5 text-xs text-[#be123c]">
                          账号已停用
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    {target.key_hint ? (
                      <div
                        className="flex items-center gap-1.5"
                        title={target.key_status === 'active' ? 'API Key 正常' : 'API Key 已停用'}
                      >
                        <KeyStatusDot user={target} />
                        <code className="min-w-0 truncate font-mono text-xs text-[#728095]">
                          {target.key_hint}
                        </code>
                      </div>
                    ) : (
                      <span className="text-xs text-[#728095]">未创建</span>
                    )}
                  </td>
                  <td>
                    {target.today_used} / {target.effective_daily_limit}
                  </td>
                  <td>
                    <QuotaValue override={target.rpm_limit} fallback={target.effective_rpm_limit} />
                  </td>
                  <td>
                    <QuotaValue override={target.daily_limit} fallback={target.effective_daily_limit} />
                  </td>
                  <td>{formatTime(target.key_last_used_at)}</td>
                  <td className="text-right">
                    <div className="flex justify-end gap-2">
                      <EditQuotaDialog user={target} onSaved={refresh} />
                      {target.key_status ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className={
                            target.key_status === 'active'
                              ? 'rounded-full border-[#fecdd3] bg-[#fff1f2] text-[#be123c] hover:bg-[#ffe4e6] hover:text-[#9f1239]'
                              : 'rounded-full'
                          }
                          disabled={isMutating}
                          onClick={() => void toggleKey(target)}
                        >
                          {target.key_status === 'active' ? '停用 Key' : '启用 Key'}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button
          variant="outline"
          className="rounded-full"
          disabled={page <= 1}
          onClick={() => setPage((current) => current - 1)}
        >
          上一页
        </Button>
        <span className="text-sm text-[#728095]">
          {payload?.page ?? page} / {payload?.pages ?? 1}
        </span>
        <Button
          variant="outline"
          className="rounded-full"
          disabled={page >= (payload?.pages ?? 1)}
          onClick={() => setPage((current) => current + 1)}
        >
          下一页
        </Button>
      </div>
    </section>
  );
}
