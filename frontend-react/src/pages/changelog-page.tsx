import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Loader2, RefreshCw } from 'lucide-react';
import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Button } from '@/components/ui/button';
import { fetchChangelogMarkdown } from '@/lib/api';

const changelogMarkdownComponents: Components = {
  a: ({ node: _node, href, children, ...props }) => {
    void _node;
    const isExternal = Boolean(href && !href.startsWith('#'));
    return (
      <a
        {...props}
        href={href}
        target={isExternal ? '_blank' : undefined}
        rel={isExternal ? 'noreferrer' : undefined}
      >
        {children}
      </a>
    );
  },
};

export function ChangelogPage() {
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadChangelog = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const markdown = await fetchChangelogMarkdown();
      setContent(markdown);
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新日志加载失败');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadChangelog();
  }, [loadChangelog]);

  return (
    <div className="mx-auto max-w-5xl">
      <section className="rounded-[2rem] border border-white/72 bg-white/72 px-5 py-6 shadow-[0_24px_90px_rgba(15,23,42,0.10)] backdrop-blur-xl sm:px-8 sm:py-8">
        <div className="flex flex-col gap-4 border-b border-[#e2e8f0] pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/78 px-3 py-1.5 text-xs font-semibold text-[#64748b] shadow-sm">
              <CalendarDays className="h-4 w-4 text-[#ff9900]" />
              Paper Insight 动态
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-[#172033] sm:text-4xl">
              更新日志
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#64748b] sm:text-base">
              这里记录 Paper Insight 的功能更新、修复和使用体验调整。
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-10 rounded-full border-[#d8e0ea] bg-white/78 px-4 text-sm font-semibold text-[#425166] shadow-sm transition hover:bg-white"
            onClick={() => void loadChangelog()}
            disabled={isLoading}
          >
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            刷新
          </Button>
        </div>

        <div className="pt-6">
          {isLoading ? (
            <div className="flex min-h-64 items-center justify-center text-sm font-medium text-[#64748b]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#ff9900]" />
              加载更新日志...
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-[#fecaca] bg-[#fff1f2] px-4 py-3 text-sm text-[#b42318]">
              {error}
            </div>
          ) : content.trim() ? (
            <div className="markdown-body changelog-markdown text-base leading-7 text-[#334155]">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                skipHtml
                components={changelogMarkdownComponents}
              >
                {content}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="rounded-2xl border border-[#e2e8f0] bg-white/62 px-4 py-5 text-sm text-[#64748b]">
              暂无更新日志内容。
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
