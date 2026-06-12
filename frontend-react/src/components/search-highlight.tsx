import type { ReactNode } from 'react';

import { splitSearchHighlightText } from '@/lib/search-highlight';

interface HighlightedTextProps {
  text: string;
  terms: string[];
}

export function HighlightedText({ text, terms }: HighlightedTextProps) {
  const parts = splitSearchHighlightText(text, terms);

  return (
    <>
      {parts.map((part, index): ReactNode => (
        part.highlighted ? (
          <mark key={`${part.text}-${index}`} className="search-match-highlight">
            {part.text}
          </mark>
        ) : (
          <span key={`${part.text}-${index}`}>{part.text}</span>
        )
      ))}
    </>
  );
}
