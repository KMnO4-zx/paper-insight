import { describe, expect, it } from 'vitest';

import { buildConferenceKeywordSearchPath, buildPaperKeywordSearchPath, getConferenceSlugFromVenue } from './constants';

describe('getConferenceSlugFromVenue', () => {
  it('maps paper venue labels back to conference collection slugs', () => {
    expect(getConferenceSlugFromVenue('ICLR 2026 Oral')).toBe('iclr_2026');
    expect(getConferenceSlugFromVenue('ACL 2026 Long')).toBe('acl_2026');
    expect(getConferenceSlugFromVenue('NeurIPS 2025 poster')).toBe('neurips_2025');
    expect(getConferenceSlugFromVenue('ICML 2025')).toBe('icml_2025');
    expect(getConferenceSlugFromVenue('CHI 2026')).toBe('chi_2026');
    expect(getConferenceSlugFromVenue('CVPR 2026')).toBe('cvpr_2026');
  });

  it('returns null for non-conference paper sources', () => {
    expect(getConferenceSlugFromVenue('Hugging Face Daily')).toBeNull();
    expect(getConferenceSlugFromVenue('arXiv cs.AI')).toBeNull();
    expect(getConferenceSlugFromVenue(null)).toBeNull();
  });

  it('builds keyword-only search URLs for the current conference collection', () => {
    expect(buildConferenceKeywordSearchPath('ICLR 2026 Oral', 'Video Generation')).toBe(
      '/conference/iclr_2026?q=Video+Generation&title=false&abstract=false&keywords=true',
    );
    expect(buildConferenceKeywordSearchPath('ACL 2026 Long', 'Retrieval Augmented Generation')).toBe(
      '/conference/acl_2026?q=Retrieval+Augmented+Generation&title=false&abstract=false&keywords=true',
    );
    expect(buildConferenceKeywordSearchPath('ICLR 2026 Oral', '  Video Evaluation  ')).toBe(
      '/conference/iclr_2026?q=Video+Evaluation&title=false&abstract=false&keywords=true',
    );
  });

  it('does not build keyword search URLs without a known collection or keyword', () => {
    expect(buildConferenceKeywordSearchPath('Hugging Face Daily', 'Video Generation')).toBeNull();
    expect(buildConferenceKeywordSearchPath('ICLR 2026 Oral', '   ')).toBeNull();
  });

  it('builds keyword-only search URLs for paper source collections', () => {
    expect(buildPaperKeywordSearchPath('ICLR 2026 Oral', 'Video Generation')).toBe(
      '/conference/iclr_2026?q=Video+Generation&title=false&abstract=false&keywords=true',
    );
    expect(buildPaperKeywordSearchPath('Hugging Face Daily', 'Video Generation')).toBe(
      '/hf-daily?q=Video+Generation&title=false&abstract=false&keywords=true',
    );
  });

  it('does not build paper keyword search URLs for unsupported sources or empty keywords', () => {
    expect(buildPaperKeywordSearchPath('arXiv cs.AI', 'Video Generation')).toBeNull();
    expect(buildPaperKeywordSearchPath('Hugging Face Daily', '   ')).toBeNull();
  });
});
