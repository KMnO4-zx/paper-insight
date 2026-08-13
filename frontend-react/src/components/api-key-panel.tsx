import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  Loader2,
  Power,
  RefreshCcw,
  Terminal,
} from 'lucide-react';

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
import { Button } from '@/components/ui/button';
import { createMyApiKey, disableMyApiKey, fetchMyApiKey } from '@/lib/api';
import type { MyApiKeyResponse } from '@/types';

function formatTime(value?: string | null): string {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString();
}

function buildCurlExample(apiKeyValue?: string | null): string {
  // The example should always point at the API origin the user is currently on:
  // vite dev (5173) proxies nothing, so swap in the backend port; every other
  // case (backend-served :8000, production HTTPS) uses the current origin as-is.
  let base = 'https://paper-insight.herobase.tech';
  if (typeof window !== 'undefined') {
    const { protocol, hostname, port, origin } = window.location;
    base = port === '5173' ? `${protocol}//${hostname}:8000` : origin;
  }
  // Shown with a placeholder; the copy button substitutes the real key.
  const apiKey = apiKeyValue || '你的_API_KEY';
  return [
    `curl "${base}/api/v1/papers/search" \\`,
    '  -G --data-urlencode "q=large language model" \\',
    '  --data-urlencode "limit=5" \\',
    `  -H "Authorization: Bearer ${apiKey}"`,
  ].join('\n');
}

// The full key only ever leaves the server once (at creation). We remember it
// in localStorage so every tab of this browser can fill it into the copied
// command; it is cleared on disable and auto-dropped when it no longer
// matches the current key (regenerated elsewhere / other browser).
const API_KEY_STORAGE = 'paper_api_key';

function buildKeyHintLocal(rawKey: string): string {
  const tail = rawKey.length >= 4 ? rawKey.slice(-4) : rawKey;
  return `${rawKey.slice(0, 8)}...${tail}`;
}

function readStoredApiKey(): string | null {
  try {
    return window.localStorage.getItem(API_KEY_STORAGE);
  } catch {
    return null;
  }
}

function storeApiKey(rawKey: string): void {
  try {
    window.localStorage.setItem(API_KEY_STORAGE, rawKey);
  } catch {
    // Storage may be unavailable; copying then falls back to the placeholder.
  }
}

function clearStoredApiKey(): void {
  try {
    window.localStorage.removeItem(API_KEY_STORAGE);
  } catch {
    // Ignore.
  }
}

/** Resolves the copyable key for this browser, dropping stale values (regenerated/disabled elsewhere). */
function resolveRememberedApiKey(apiKey: { key_hint: string; status: string } | null): string | null {
  const stored = readStoredApiKey();
  if (!stored || !apiKey) {
    if (stored) {
      clearStoredApiKey();
    }
    return null;
  }
  if (apiKey.status === 'active' && buildKeyHintLocal(stored) === apiKey.key_hint) {
    return stored;
  }
  clearStoredApiKey();
  return null;
}

function CopyButton({
  value,
  label = '复制',
  className = '',
  title,
}: {
  value: string;
  label?: string;
  className?: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard may be unavailable (non-HTTPS); the key box stays selectable as fallback.
      return;
    }
    setCopied(true);
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className={`rounded-full ${className}`}
      title={title}
      onClick={() => void copy()}
    >
      {copied ? (
        <Check className="mr-1 h-3.5 w-3.5 text-[#15803d]" />
      ) : (
        <Copy className="mr-1 h-3.5 w-3.5" />
      )}
      {copied ? '已复制' : label}
    </Button>
  );
}

export function ApiKeyPanel() {
  const [data, setData] = useState<MyApiKeyResponse | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  // Real key remembered by this browser (localStorage) for the example's copy button.
  const [rememberedKey, setRememberedKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const payload = await fetchMyApiKey();
      setData(payload);
      setRememberedKey(resolveRememberedApiKey(payload.api_key));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'API Key 信息加载失败');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = async () => {
    setIsMutating(true);
    setError(null);
    try {
      const payload = await createMyApiKey();
      const rawKey = payload.api_key?.key ?? null;
      setData(payload);
      setNewKey(rawKey);
      if (rawKey) {
        storeApiKey(rawKey);
        setRememberedKey(rawKey);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setIsMutating(false);
    }
  };

  const disable = async () => {
    setIsMutating(true);
    setError(null);
    try {
      setData(await disableMyApiKey());
      setNewKey(null);
      clearStoredApiKey();
      setRememberedKey(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '停用失败');
    } finally {
      setIsMutating(false);
    }
  };

  const apiKey = data?.api_key ?? null;
  const usage = data?.usage;
  const isActive = apiKey?.status === 'active';
  const usagePercent =
    usage && usage.daily_limit > 0
      ? Math.min(100, Math.round((usage.today_used / usage.daily_limit) * 100))
      : 0;

  return (
    <section className="rounded-[28px] bg-white/85 p-5 shadow-sm ring-1 ring-black/5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 lg:max-w-sm">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-[#7c3aed]" />
            <h2 className="text-xl font-semibold text-[#172033]">论文搜索 API</h2>
            {isLoading ? null : apiKey ? (
              apiKey.status === 'active' ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#bbf7d0] bg-[#ecfdf5] px-2.5 py-0.5 text-xs font-medium text-[#047857]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e]" />
                  正常
                </span>
              ) : (
                <span className="rounded-full border border-[#e2e8f0] bg-[#f8fafc] px-2.5 py-0.5 text-xs font-medium text-[#64748b]">
                  已停用
                </span>
              )
            ) : (
              <span className="rounded-full border border-[#e2e8f0] bg-[#f8fafc] px-2.5 py-0.5 text-xs font-medium text-[#64748b]">
                未创建
              </span>
            )}
          </div>
          <p className="mt-1 text-sm leading-6 text-[#728095]">
            用自己的 API Key 在任何项目里搜索 Paper Insight 的论文，结果与网站搜索一致。
          </p>
        </div>

        <div className="w-full min-w-0 flex-1 space-y-4 lg:max-w-xl">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-[#728095]">
              <Loader2 className="h-4 w-4 animate-spin" />
              加载 API Key 信息...
            </div>
          ) : (
            <>
              {newKey ? (
                <div className="rounded-2xl border border-[#fde68a] bg-[#fffbeb] p-4">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-[#92400e]">
                    <AlertTriangle className="h-4 w-4" />
                    完整 Key 仅此一次显示，请立即复制保存
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-xl bg-white px-3 py-2 font-mono text-sm text-[#172033] ring-1 ring-[#fde68a]">
                      {newKey}
                    </code>
                    <CopyButton value={newKey} label="复制 Key" />
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[#a16207]">
                    在下方「调用示例」点复制，命令会自动带上这个 Key（本浏览器会记住），可直接粘贴到终端测试。
                  </p>
                </div>
              ) : apiKey ? (
                <div className="flex h-10 items-stretch overflow-hidden rounded-xl border border-[#e6ebf2] bg-[#f8fafc]">
                  <div className="flex min-w-0 flex-1 items-center">
                    <KeyRound className="ml-3 h-4 w-4 shrink-0 text-[#a8b3c4]" />
                    <code className="min-w-0 flex-1 truncate px-3 font-mono text-sm text-[#364152]">
                      {apiKey.key_hint}
                    </code>
                  </div>
                  {rememberedKey ? (
                    <CopyButton
                      value={rememberedKey}
                      label="复制 Key"
                      title="复制本浏览器记住的完整 API Key"
                      className="h-full rounded-none rounded-r-xl border-0 border-l border-[#e6ebf2] bg-white px-4 shadow-none hover:bg-[#f1f5f9]"
                    />
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-[#728095]">
                  还没有 API Key。创建后即可通过 <code className="rounded bg-[#f1f5f9] px-1.5 py-0.5 font-mono text-xs">/api/v1/papers/search</code> 调用搜索。
                </p>
              )}

              {usage ? (
                <div className="rounded-2xl border border-[#e6ebf2] bg-[#f8fafc]/60 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-[#364152]">
                      今日已使用：<span className="text-[#172033]">{usage.today_used}</span>
                      <span className="text-[#728095]"> / {usage.daily_limit} 次</span>
                    </span>
                    <span className="text-xs text-[#728095]">每分钟限制 {usage.rpm_limit} 次 · 北京时间零点重置</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#e6ebf2]">
                    <div
                      className={`h-full rounded-full transition-all ${
                        usagePercent >= 90
                          ? 'bg-gradient-to-r from-[#f97316] to-[#ef4444]'
                          : 'bg-gradient-to-r from-[#ff7a00] to-[#fbbf24]'
                      }`}
                      style={{ width: `${usagePercent}%` }}
                    />
                  </div>
                  {apiKey ? (
                    <div className="mt-2 grid gap-1 text-xs text-[#728095] sm:grid-cols-2">
                      <div>创建时间：{formatTime(apiKey.created_at)}</div>
                      <div>最近调用：{formatTime(apiKey.last_used_at)}</div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {error ? <div className="text-sm text-[#b91c1c]">{error}</div> : null}

              <div className="flex flex-wrap gap-2">
                {apiKey && apiKey.status === 'active' ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button className="rounded-full" disabled={isMutating}>
                        {isMutating ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCcw className="mr-2 h-4 w-4" />
                        )}
                        重新生成 Key
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>重新生成 API Key？</AlertDialogTitle>
                        <AlertDialogDescription>
                          重新生成后旧 Key 立即失效，正在使用旧 Key 的调用会开始返回 401。额度设置不受影响。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="rounded-full">取消</AlertDialogCancel>
                        <AlertDialogAction className="rounded-full" onClick={() => void generate()}>
                          确认重新生成
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : (
                  <Button className="rounded-full" disabled={isMutating} onClick={() => void generate()}>
                    {isMutating ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <KeyRound className="mr-2 h-4 w-4" />
                    )}
                    {apiKey ? '重新创建 API Key' : '创建 API Key'}
                  </Button>
                )}

                {isActive ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        className="rounded-full border-[#fecdd3] bg-[#fff1f2] text-[#be123c] hover:bg-[#ffe4e6] hover:text-[#9f1239]"
                        disabled={isMutating}
                      >
                        <Power className="mr-2 h-4 w-4" />
                        停用
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>停用 API Key？</AlertDialogTitle>
                        <AlertDialogDescription>
                          停用后所有使用该 Key 的请求都会返回 401。之后你仍可以重新创建新 Key。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="rounded-full">取消</AlertDialogCancel>
                        <AlertDialogAction
                          className="rounded-full bg-[#e11d48] text-white hover:bg-[#be123c]"
                          onClick={() => void disable()}
                        >
                          确认停用
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : null}
              </div>

              {apiKey ? (
                <details className="group max-w-full rounded-2xl border border-[#e6ebf2] bg-[#f8fafc]/60 px-4 py-3">
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-[#364152]">
                    <Terminal className="h-4 w-4 text-[#728095]" />
                    调用示例
                    <span className="ml-auto text-xs text-[#728095] group-open:hidden">展开</span>
                    <span className="ml-auto hidden text-xs text-[#728095] group-open:inline">收起</span>
                  </summary>
                  <div className="relative mt-3">
                    <pre className="max-w-full overflow-x-auto rounded-xl border border-[#e6ebf2] bg-white px-4 py-3 pr-14 font-mono text-xs leading-5 text-[#364152]">
                      {buildCurlExample(null)}
                    </pre>
                    <div className="absolute right-2 top-2">
                      <CopyButton
                        value={buildCurlExample(rememberedKey)}
                        label="复制命令"
                        className="h-7 bg-white px-2.5 text-xs shadow-sm"
                        title={
                          rememberedKey
                            ? '复制时自动填入本浏览器记住的 API Key'
                            : '复制后请将 你的_API_KEY 替换为你自己的 Key'
                        }
                      />
                    </div>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[#728095]">
                    支持参数：<code className="font-mono">q</code>（搜索词，必填）、
                    <code className="font-mono">venue</code>（如 iclr_2026）、
                    <code className="font-mono">code_status</code>（open_source / not_open_source）、
                    <code className="font-mono">page</code>、<code className="font-mono">limit</code>（最多 100）。
                  </p>
                  {rememberedKey ? null : (
                    <p className="mt-1 text-xs leading-5 text-[#a16207]">
                      此浏览器没有记住你的 Key，复制的是占位符版本；重新生成 Key 后，本浏览器即可自动填入。
                    </p>
                  )}
                </details>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
