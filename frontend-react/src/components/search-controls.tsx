import { Search } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import type { SearchFilters } from '@/types';

interface SearchControlsProps {
  query: string;
  filters: SearchFilters;
  onQueryChange: (value: string) => void;
  onFiltersChange: (value: SearchFilters) => void;
  onSubmit: () => void;
  placeholder: string;
  submitLabel?: string;
  compact?: boolean;
  hero?: boolean;
}

export function SearchControls({
  query,
  filters,
  onQueryChange,
  onFiltersChange,
  onSubmit,
  placeholder,
  submitLabel = '搜索',
  compact = false,
  hero = false,
}: SearchControlsProps) {
  const [isComposing, setIsComposing] = useState(false);

  const toggleFilter = (key: keyof SearchFilters) => {
    const next = { ...filters, [key]: !filters[key] };
    if (!next.title && !next.abstract && !next.keywords) {
      return;
    }
    onFiltersChange(next);
  };

  const panelClassName = hero
    ? 'rounded-[28px] bg-white/90 p-5 shadow-sm ring-1 ring-black/5 sm:p-6 lg:p-6'
    : `rounded-2xl bg-white/90 shadow-sm ring-1 ring-black/5 ${compact ? 'p-4' : 'p-8'}`;
  const filtersClassName = hero
    ? 'mb-5 flex flex-wrap items-center justify-center gap-x-7 gap-y-3'
    : `mb-4 flex flex-wrap items-center gap-5 ${compact ? 'justify-start' : 'justify-center'}`;
  const rowClassName = hero
    ? 'flex flex-col items-stretch gap-4 sm:flex-row'
    : `flex ${compact ? 'flex-col gap-3 sm:flex-row' : 'gap-3'} items-stretch`;
  const inputClassName = hero
    ? 'h-14 rounded-[1.25rem] border-2 border-[#ff9900] bg-[#f6f8fb] pl-14 text-base shadow-none transition hover:border-[#ff7a00] focus-visible:border-[#ff7a00] focus-visible:ring-0'
    : 'h-12 rounded-xl border-2 border-transparent bg-[#f6f8fb] pl-11 text-base shadow-none transition hover:border-[#d7dfe8] focus-visible:border-[#ff9900] focus-visible:ring-0';
  const searchIconClassName = hero
    ? 'pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-[#7a8799]'
    : 'pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7a8799]';
  const buttonClassName = hero
    ? 'h-14 rounded-[1.25rem] bg-gradient-to-r from-[#ff9900] to-[#ff7a00] px-8 text-base font-semibold text-white hover:from-[#ff7a00] hover:to-[#ff9900] sm:min-w-[8rem]'
    : 'h-12 rounded-xl bg-gradient-to-r from-[#ff9900] to-[#ff7a00] px-6 font-semibold text-white hover:from-[#ff7a00] hover:to-[#ff9900]';

  return (
    <div className={panelClassName}>
      <div className={filtersClassName}>
        {(['title', 'abstract', 'keywords'] as Array<keyof SearchFilters>).map((field) => (
          <label key={field} className={`flex cursor-pointer items-center gap-2 text-[#3f4a5a] ${hero ? 'text-base' : 'text-sm'}`}>
            <Checkbox
              checked={filters[field]}
              onCheckedChange={() => toggleFilter(field)}
              className={`${hero ? 'h-5 w-5 rounded-md' : ''} border-[#c6d0dc] data-[state=checked]:border-[#ff9900] data-[state=checked]:bg-[#ff9900]`}
            />
            <span className={filters[field] ? 'font-semibold text-[#172033]' : ''}>
              {field === 'title' ? 'Title' : field === 'abstract' ? 'Abstract' : 'Keywords'}
            </span>
          </label>
        ))}
      </div>

      <div className={rowClassName}>
        <div className="relative flex-1">
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                if (isComposing || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
                  return;
                }
                event.preventDefault();
                onSubmit();
              }
            }}
            className={inputClassName}
            placeholder={placeholder}
          />
          <Search className={searchIconClassName} />
        </div>
        <Button
          onClick={onSubmit}
          className={buttonClassName}
        >
          <Search className={`${hero ? 'h-5 w-5' : 'h-4 w-4'} mr-2`} />
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
