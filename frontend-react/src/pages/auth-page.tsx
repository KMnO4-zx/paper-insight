import { useMemo, useState } from 'react';
import { Github, Loader2, Mail } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { navigate, useAppLocation } from '@/lib/router';

interface AuthPageProps {
  mode: 'login' | 'register';
}

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  github_cancelled: 'GitHub 授权已取消',
  github_database_unavailable: '数据库暂时不可用，请稍后再试',
  github_email_conflict: '该邮箱已绑定到其他 GitHub 账号',
  github_login_failed: 'GitHub 登录失败，请稍后再试',
  github_not_configured: 'GitHub 登录尚未配置',
  github_state_invalid: 'GitHub 登录状态已失效，请重新尝试',
  github_user_disabled: '账号已被停用',
};

function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return '/';
  }
  return value;
}

export function AuthPage({ mode }: AuthPageProps) {
  const location = useAppLocation();
  const { login, loginWithGithub } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGithubSubmitting, setIsGithubSubmitting] = useState(false);
  const isRegister = mode === 'register';

  const { nextPath, oauthError } = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const rawOauthError = params.get('oauth_error');
    return {
      nextPath: safeNextPath(params.get('next')),
      oauthError: rawOauthError ? (OAUTH_ERROR_MESSAGES[rawOauthError] ?? 'GitHub 登录失败') : null,
    };
  }, [location.search]);

  const startGithub = () => {
    setError(null);
    setIsGithubSubmitting(true);
    loginWithGithub(nextPath);
  };

  const submitPasswordLogin = async () => {
    if (isSubmitting) {
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
      navigate(nextPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const visibleError = error ?? oauthError;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-12rem)] max-w-md items-center">
      <section className="w-full rounded-[32px] bg-white p-8 shadow-sm ring-1 ring-black/5">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[#172033]">
            {isRegister ? '注册账号' : '登录账号'}
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#728095]">
            {isRegister ? '新账号通过 GitHub 创建。' : '支持 GitHub 登录，旧账号可继续使用邮箱密码。'}
          </p>
        </div>

        <div className="space-y-4">
          <Button
            className="h-11 w-full rounded-2xl bg-[#172033] text-white hover:bg-[#0f172a]"
            onClick={startGithub}
            disabled={isGithubSubmitting}
          >
            {isGithubSubmitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Github className="mr-2 h-4 w-4" />
            )}
            {isRegister ? '使用 GitHub 注册' : '使用 GitHub 登录'}
          </Button>

          {!isRegister ? (
            <>
              <div className="flex items-center gap-3 text-xs text-[#94a3b8]">
                <div className="h-px flex-1 bg-[#e6ebf2]" />
                <span>原有账号</span>
                <div className="h-px flex-1 bg-[#e6ebf2]" />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#334155]">邮箱</label>
                <Input
                  value={email}
                  type="email"
                  autoComplete="email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  className="h-11 rounded-2xl bg-[#f8fafc]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#334155]">密码</label>
                <Input
                  value={password}
                  type="password"
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="原有账号密码"
                  className="h-11 rounded-2xl bg-[#f8fafc]"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      void submitPasswordLogin();
                    }
                  }}
                />
              </div>

              <Button
                variant="outline"
                className="h-11 w-full rounded-2xl border-[#d7dde8] bg-[#f8fafc] text-[#243047]"
                onClick={() => void submitPasswordLogin()}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="mr-2 h-4 w-4" />
                )}
                使用邮箱密码登录
              </Button>
            </>
          ) : null}

          {visibleError ? (
            <div className="rounded-2xl bg-[#fff1f2] p-3 text-sm text-[#b91c1c]">
              {visibleError}
            </div>
          ) : null}
        </div>

        <div className="mt-6 text-center text-sm text-[#728095]">
          {isRegister ? '已有账号？' : '还没有账号？'}
          <button
            type="button"
            className="ml-1 font-medium text-[#ff7a00]"
            onClick={() => {
              const target = isRegister ? '/login' : '/register';
              navigate(`${target}?next=${encodeURIComponent(nextPath)}`);
            }}
          >
            {isRegister ? '去登录' : '去注册'}
          </button>
        </div>
      </section>
    </div>
  );
}
