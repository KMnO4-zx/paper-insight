import { Bookmark, CalendarDays, Eye, Heart, Star, ThumbsUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { HighlightedText } from '@/components/search-highlight';
import { RichContent } from '@/components/rich-content';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { fetchPaperMarks, updatePaperMark } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { getVenueParts, normalizeKeywords } from '@/lib/content';
import { navigate } from '@/lib/router';
import { buildSearchHighlightTerms } from '@/lib/search-highlight';
import type { Paper, PaperMark, SearchFilters } from '@/types';

interface PaperCardProps {
  paper: Paper;
  index: number;
  onOpen: (paper: Paper) => void;
  searchQuery?: string;
  searchFilters?: SearchFilters;
  onMarkChange?: (paper: Paper, mark: PaperMark) => void;
}

const EMPTY_MARKS = { viewed: false, liked: false, favorited: false };

function getConferenceColor(conference: string) {
  switch (conference) {
    case 'ICLR':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'NeurIPS':
      return 'bg-violet-50 text-violet-700 border-violet-200';
    case 'ICML':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'CHI':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    case 'CVPR':
      return 'bg-teal-50 text-teal-700 border-teal-200';
    case 'Hugging Face':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'arXiv':
      return 'bg-cyan-50 text-cyan-700 border-cyan-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

function getKeywordColor(index: number) {
  const colors = [
    'bg-orange-50 text-orange-700 border-orange-100',
    'bg-sky-50 text-sky-700 border-sky-100',
    'bg-emerald-50 text-emerald-700 border-emerald-100',
    'bg-violet-50 text-violet-700 border-violet-100',
    'bg-rose-50 text-rose-700 border-rose-100',
  ];
  return colors[index % colors.length];
}

function formatDate(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value.slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

export function PaperCard({
  paper,
  index,
  onOpen,
  searchQuery = '',
  searchFilters,
  onMarkChange,
}: PaperCardProps) {
  const { user, isLoading } = useAuth();
  const [marks, setMarks] = useState(EMPTY_MARKS);
  const [isLikeAnimating, setIsLikeAnimating] = useState(false);
  const keywords = normalizeKeywords(paper.keywords).slice(0, 6);
  const highlightTerms = useMemo(() => buildSearchHighlightTerms(searchQuery), [searchQuery]);
  const titleHighlightTerms = searchFilters?.title ? highlightTerms : [];
  const abstractHighlightTerms = searchFilters?.abstract ? highlightTerms : [];
  const keywordHighlightTerms = searchFilters?.keywords ? highlightTerms : [];
  const venue = getVenueParts(paper.venue);
  const isHfDaily = venue.conference === 'Hugging Face';
  const isArxiv = venue.conference === 'arXiv';
  const hfDailyDateLabel = paper.hf_daily?.daily_date ?? null;
  const arxivPublishedLabel = formatDate(paper.arxiv?.published_at);

  useEffect(() => {
    let active = true;
    setMarks(EMPTY_MARKS);
    if (isLoading || !user) {
      return () => {
        active = false;
      };
    }
    void fetchPaperMarks([paper.id])
      .then((nextMarks) => {
        if (active) {
          setMarks(nextMarks[paper.id] ?? EMPTY_MARKS);
        }
      })
      .catch(() => {
        if (active) {
          setMarks(EMPTY_MARKS);
        }
      });
    return () => {
      active = false;
    };
  }, [isLoading, paper.id, user]);

  const requireLogin = () => {
    if (isLoading) {
      return false;
    }
    if (!user) {
      navigate('/login');
      return false;
    }
    return true;
  };

  return (
    <article
      onClick={() => onOpen(paper)}
      className="group cursor-pointer rounded-3xl bg-white/95 p-5 shadow-sm ring-1 ring-black/5 transition duration-300 hover:-translate-y-1 hover:shadow-xl"
      style={{ animationDelay: `${index * 0.04}s` }}
    >
      <div className="mb-4 flex flex-wrap items-start gap-2">
        <Badge variant="outline" className={getConferenceColor(venue.conference)}>
          {venue.label}
        </Badge>
        {paper.primary_area ? (
          <Badge variant="outline" className="border-[#e6ebf2] bg-[#f8fafc] text-[#516072]">
            {paper.primary_area}
          </Badge>
        ) : null}
        {isHfDaily && typeof paper.hf_daily?.upvotes === 'number' ? (
          <Badge variant="outline" className="border-[#fed7aa] bg-[#fff7ed] text-[#c2410c]">
            <ThumbsUp className="mr-1 h-3 w-3" />
            {paper.hf_daily.upvotes}
          </Badge>
        ) : null}
        {isHfDaily && typeof paper.hf_daily?.github_stars === 'number' ? (
          <Badge variant="outline" className="border-[#dbeafe] bg-[#eff6ff] text-[#2563eb]">
            <Star className="mr-1 h-3 w-3" />
            {paper.hf_daily.github_stars}
          </Badge>
        ) : null}
      </div>

      <h3 className="mb-3 text-xl font-semibold leading-snug text-[#1f2937] transition-colors group-hover:text-[#ff7a00]">
        <RichContent content={paper.title} inline className="paper-title-math" highlightTerms={titleHighlightTerms} />
      </h3>

      {keywords.length ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {keywords.map((keyword, keywordIndex) => (
            <span
              key={`${paper.id}-${keyword}`}
              className={`rounded-full border px-2.5 py-1 text-xs ${getKeywordColor(keywordIndex)}`}
            >
              <HighlightedText text={keyword} terms={keywordHighlightTerms} />
            </span>
          ))}
        </div>
      ) : null}

      <p className="mb-5 line-clamp-3 text-sm leading-6 text-[#67758a]">
        <HighlightedText text={paper.abstract || '暂无摘要'} terms={abstractHighlightTerms} />
      </p>

      {isHfDaily && hfDailyDateLabel ? (
        <div className="mb-4 flex items-center gap-1.5 text-xs text-[#728095]">
          <CalendarDays className="h-3.5 w-3.5 text-[#ff9900]" />
          HF Daily 日期：{hfDailyDateLabel}
        </div>
      ) : null}

      {isArxiv && arxivPublishedLabel ? (
        <div className="mb-4 flex items-center gap-1.5 text-xs text-[#728095]">
          <CalendarDays className="h-3.5 w-3.5 text-[#0891b2]" />
          arXiv 首发：{arxivPublishedLabel}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              if (!requireLogin()) {
                return;
              }
              void updatePaperMark(paper.id, { viewed: !marks.viewed }).then((nextMark) => {
                setMarks(nextMark);
                onMarkChange?.(paper, nextMark);
              });
            }}
            className={`rounded-full ${
              marks.viewed
                ? 'border-[#bfdbfe] bg-[#eff6ff] text-[#2563eb]'
                : 'border-[#dbe2ea] text-[#66768b]'
            }`}
          >
            <Eye className={`mr-1.5 h-3.5 w-3.5 ${marks.viewed ? 'fill-current' : ''}`} />
            {marks.viewed ? '已看过' : '看过'}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              if (!requireLogin()) {
                return;
              }
              setIsLikeAnimating(true);
              void updatePaperMark(paper.id, { liked: !marks.liked }).then((nextMark) => {
                setMarks(nextMark);
                onMarkChange?.(paper, nextMark);
              });
              window.setTimeout(() => setIsLikeAnimating(false), 400);
            }}
            className={`rounded-full ${
              marks.liked
                ? 'border-[#fecaca] bg-[#fff1f2] text-[#e11d48]'
                : 'border-[#dbe2ea] text-[#66768b]'
            }`}
          >
            <Heart className={`mr-1.5 h-3.5 w-3.5 ${isLikeAnimating ? 'animate-heart-beat' : ''} ${marks.liked ? 'fill-current' : ''}`} />
            {marks.liked ? '已点赞' : '点赞'}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              if (!requireLogin()) {
                return;
              }
              void updatePaperMark(paper.id, { favorited: !marks.favorited }).then((nextMark) => {
                setMarks(nextMark);
                onMarkChange?.(paper, nextMark);
              });
            }}
            className={`rounded-full ${
              marks.favorited
                ? 'border-[#fed7aa] bg-[#fff7ed] text-[#ea580c]'
                : 'border-[#dbe2ea] text-[#66768b]'
            }`}
          >
            <Bookmark className={`mr-1.5 h-3.5 w-3.5 ${marks.favorited ? 'fill-current' : ''}`} />
            {marks.favorited ? '已收藏' : '收藏'}
          </Button>
        </div>
      </div>
    </article>
  );
}
