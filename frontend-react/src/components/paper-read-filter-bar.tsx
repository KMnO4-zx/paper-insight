import { Eye, EyeOff, Filter, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { PaperReadCounts, PaperReadFilter } from '@/types';

interface PaperReadFilterBarProps {
  value: PaperReadFilter;
  counts?: PaperReadCounts | null;
  disabled?: boolean;
  onChange: (value: PaperReadFilter) => void;
}

const FILTERS: Array<{ value: PaperReadFilter; label: string; icon?: LucideIcon }> = [
  { value: 'all', label: '全部' },
  { value: 'unread', label: '未读', icon: EyeOff },
  { value: 'read', label: '已读', icon: Eye },
];

function countLabel(value: PaperReadFilter, counts?: PaperReadCounts | null): string {
  if (!counts) {
    return '';
  }
  return `${counts[value]} 篇`;
}

export function PaperReadFilterBar({
  value,
  counts,
  disabled = false,
  onChange,
}: PaperReadFilterBarProps) {
  return (
    <div className="flex flex-col gap-3 rounded-[24px] bg-white/75 p-3 text-sm text-[#596579] shadow-sm ring-1 ring-black/5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 font-medium">
        <Filter className="h-4 w-4 text-[#0891b2]" />
        筛选
        {disabled ? <span className="text-xs font-normal text-[#8a96a8]">登录后可按阅读状态筛选</span> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((item) => {
          const Icon = item.icon;
          const isActive = value === item.value;
          return (
            <Button
              key={item.value}
              type="button"
              variant={isActive ? 'default' : 'outline'}
              size="sm"
              disabled={disabled && item.value !== 'all'}
              className="rounded-full"
              onClick={() => onChange(item.value)}
            >
              {Icon ? <Icon className="mr-1.5 h-3.5 w-3.5" /> : null}
              {item.label}
              {counts ? <span className="ml-1.5 text-xs opacity-80">{countLabel(item.value, counts)}</span> : null}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
