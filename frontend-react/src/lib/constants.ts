import type { ConferenceDefinition, ConferenceSlug } from '@/types';

export const CONFERENCES: ConferenceDefinition[] = [
  {
    id: 'iclr_2026',
    name: 'ICLR 2026',
    fullName: 'International Conference on Learning Representations',
    year: 2026,
    accentClass: 'from-[#ffb347] via-[#ffd56b] to-[#ff8f5a]',
  },
  {
    id: 'chi_2026',
    name: 'CHI 2026',
    fullName: 'Conference on Human Factors in Computing Systems',
    year: 2026,
    accentClass: 'from-[#f26d6d] via-[#ff9f7a] to-[#ffd166]',
  },
  {
    id: 'cvpr_2026',
    name: 'CVPR 2026',
    fullName: 'Conference on Computer Vision and Pattern Recognition',
    year: 2026,
    accentClass: 'from-[#0ea5e9] via-[#22c55e] to-[#facc15]',
  },
  {
    id: 'neurips_2025',
    name: 'NeurIPS 2025',
    fullName: 'Neural Information Processing Systems',
    year: 2025,
    accentClass: 'from-[#7c6cff] via-[#9c8cff] to-[#5f8bff]',
  },
  {
    id: 'icml_2025',
    name: 'ICML 2025',
    fullName: 'International Conference on Machine Learning',
    year: 2025,
    accentClass: 'from-[#4cb782] via-[#8fd694] to-[#cde77f]',
  },
];

export const CONFERENCE_MAP = CONFERENCES.reduce<Record<ConferenceSlug, ConferenceDefinition>>(
  (acc, conference) => {
    acc[conference.id as ConferenceSlug] = conference;
    return acc;
  },
  {} as Record<ConferenceSlug, ConferenceDefinition>,
);

export function getConferenceDefinition(venue: string): ConferenceDefinition | null {
  return CONFERENCE_MAP[venue as ConferenceSlug] ?? null;
}

export function getConferenceSlugFromVenue(venue?: string | null): ConferenceSlug | null {
  if (!venue) {
    return null;
  }

  const normalizedVenue = venue.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const year = normalizedVenue.match(/\b(20\d{2})\b/)?.[1] ?? null;

  const conference = CONFERENCES.find((candidate) => {
    const normalizedName = candidate.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const acronym = normalizedName.split(' ')[0];

    return normalizedVenue.includes(normalizedName) || (
      year === String(candidate.year) && normalizedVenue.split(' ').includes(acronym)
    );
  });

  return (conference?.id as ConferenceSlug | undefined) ?? null;
}

export function buildConferenceKeywordSearchPath(venue: string | null | undefined, keyword: string): string | null {
  const conferenceSlug = getConferenceSlugFromVenue(venue);
  const query = keyword.trim();

  if (!conferenceSlug || !query) {
    return null;
  }

  const params = new URLSearchParams({
    q: query,
    title: 'false',
    abstract: 'false',
    keywords: 'true',
  });

  return `/conference/${conferenceSlug}?${params.toString()}`;
}

export function buildPaperKeywordSearchPath(venue: string | null | undefined, keyword: string): string | null {
  const query = keyword.trim();
  if (!query) {
    return null;
  }

  const conferenceSearchPath = buildConferenceKeywordSearchPath(venue, query);
  if (conferenceSearchPath) {
    return conferenceSearchPath;
  }

  if (venue?.toLowerCase().includes('hugging face')) {
    const params = new URLSearchParams({
      q: query,
      title: 'false',
      abstract: 'false',
      keywords: 'true',
    });

    return `/hf-daily?${params.toString()}`;
  }

  return null;
}
