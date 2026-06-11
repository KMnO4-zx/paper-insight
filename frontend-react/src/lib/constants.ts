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
