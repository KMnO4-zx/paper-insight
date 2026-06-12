import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { HighlightedText } from '@/components/search-highlight';
import { RichContent } from '@/components/rich-content';

import { buildSearchHighlightTerms, splitSearchHighlightText } from './search-highlight';

describe('search result highlighting', () => {
  it('builds distinct search terms from user queries', () => {
    expect(buildSearchHighlightTerms('  "contrastive"   learning learning  A  ')).toEqual([
      'contrastive',
      'learning',
    ]);
  });

  it('splits matched text case-insensitively and escapes special characters', () => {
    const parts = splitSearchHighlightText('Graph-RAG improves graph-rag retrieval.', ['Graph-RAG']);

    expect(parts).toEqual([
      { text: 'Graph-RAG', highlighted: true },
      { text: ' improves ', highlighted: false },
      { text: 'graph-rag', highlighted: true },
      { text: ' retrieval.', highlighted: false },
    ]);
  });

  it('renders subtle mark elements for plain result text', () => {
    const html = renderToStaticMarkup(
      <HighlightedText text="Diffusion policies for robotics" terms={['policies']} />,
    );

    expect(html).toContain('class="search-match-highlight"');
    expect(html).toContain('<mark');
    expect(html).toContain('policies');
  });

  it('highlights markdown title text while keeping math rendering active', () => {
    const html = renderToStaticMarkup(
      <RichContent content={'Graph learning with $x_i$'} inline highlightTerms={['graph']} />,
    );

    expect(html).toContain('class="search-match-highlight"');
    expect(html).toContain('Graph');
    expect(html).toContain('katex');
  });
});
