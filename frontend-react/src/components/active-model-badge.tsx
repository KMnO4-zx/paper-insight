import { useEffect, useMemo, useState } from 'react';
import { Cpu, Loader2 } from 'lucide-react';

import { fetchActiveLlmModel } from '@/lib/api';
import type { ActiveLlmModel } from '@/types';

const MODEL_REFRESH_INTERVAL_MS = 15000;

interface ActiveModelBadgeProps {
  compact?: boolean;
  variant?: 'pill' | 'inline';
  className?: string;
}

function formatModelLabel(model: ActiveLlmModel | null): string {
  if (!model) {
    return '读取模型...';
  }
  if (!model.configured || !model.model_name) {
    return '模型未配置';
  }
  return model.provider_name ? `${model.provider_name} / ${model.model_name}` : model.model_name;
}

export function ActiveModelBadge({ compact = false, variant = 'pill', className = '' }: ActiveModelBadgeProps) {
  const [model, setModel] = useState<ActiveLlmModel | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let active = true;

    const loadModel = async () => {
      try {
        const payload = await fetchActiveLlmModel();
        if (active) {
          setModel(payload);
          setHasError(false);
        }
      } catch {
        if (active) {
          setHasError(true);
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void loadModel();
    const interval = window.setInterval(() => {
      void loadModel();
    }, MODEL_REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const modelLabel = useMemo(() => formatModelLabel(model), [model]);
  const isConfigured = Boolean(model?.configured && model.model_name && !hasError);
  const title = hasError ? '模型状态读取失败' : modelLabel;

  if (variant === 'inline') {
    return (
      <div
        className={`inline-flex min-w-0 max-w-full items-center gap-1.5 text-xs ${className}`}
        title={title}
      >
        {isLoading ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[#94a3b8]" />
        ) : (
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              isConfigured ? 'bg-[#16a34a]' : 'bg-[#cbd5e1]'
            }`}
          />
        )}
        <span className="shrink-0 text-[11px] font-medium text-[#8a98ac]">当前模型</span>
        <span className="min-w-0 truncate font-semibold text-[#56657a]">
          {hasError ? '读取失败' : modelLabel}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border px-3 py-1.5 shadow-sm ${
        isConfigured
          ? 'border-[#fed7aa] bg-gradient-to-r from-[#fff7ed] via-white to-[#eef6ff] text-[#8a4a0a]'
          : 'border-[#e2e8f0] bg-white/80 text-[#64748b]'
      } ${className}`}
      title={title}
    >
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          isConfigured ? 'bg-[#ff9900]/12 text-[#f08300]' : 'bg-[#f1f5f9] text-[#94a3b8]'
        }`}
      >
        {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cpu className="h-3.5 w-3.5" />}
      </span>
      <span className={`shrink-0 text-[11px] font-semibold ${compact ? 'hidden sm:inline' : ''}`}>
        当前模型
      </span>
      <span className="min-w-0 truncate text-xs font-semibold text-[#243047]">
        {hasError ? '读取失败' : modelLabel}
      </span>
      {isConfigured ? (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22c55e] opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#16a34a]" />
        </span>
      ) : null}
    </div>
  );
}
