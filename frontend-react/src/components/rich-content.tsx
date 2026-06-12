import type { Components } from 'react-markdown';
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import { normalizeMarkdownContent, splitStreamingMarkdown } from '@/lib/content';
import { createSearchHighlightRehypePlugin } from '@/lib/search-highlight';

interface RichContentProps {
  content: string;
  className?: string;
  inline?: boolean;
  analysisMode?: boolean;
  isStreaming?: boolean;
  highlightTerms?: string[];
}

const blockComponents: Components = {
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

const inlineComponents: Components = {
  ...blockComponents,
  p: ({ node: _node, children }) => {
    void _node;
    return <>{children}</>;
  },
};

function MarkdownAst({
  content,
  components,
  highlightTerms = [],
}: {
  content: string;
  components: Components;
  highlightTerms?: string[];
}) {
  const rehypePlugins = useMemo(
    () => (
      highlightTerms.length
        ? [rehypeKatex, createSearchHighlightRehypePlugin(highlightTerms)]
        : [rehypeKatex]
    ),
    [highlightTerms],
  );

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={rehypePlugins}
      skipHtml
      components={components}
    >
      {content}
    </ReactMarkdown>
  );
}

export function RichContent({
  content,
  className,
  inline = false,
  analysisMode = false,
  isStreaming = false,
  highlightTerms = [],
}: RichContentProps) {
  const normalizedContent = useMemo(
    () => normalizeMarkdownContent(content, { analysisMode }),
    [analysisMode, content],
  );
  const splitContent = useMemo(
    () => (isStreaming ? splitStreamingMarkdown(content, { analysisMode }) : null),
    [analysisMode, content, isStreaming],
  );

  if (inline) {
    return (
      <span className={className}>
        <MarkdownAst content={normalizedContent} components={inlineComponents} highlightTerms={highlightTerms} />
      </span>
    );
  }

  const stableContent = splitContent?.stableContent ?? normalizedContent;
  const unstableContent = splitContent?.unstableContent ?? '';

  return (
    <div className={className}>
      {stableContent ? (
        <MarkdownAst content={stableContent} components={blockComponents} highlightTerms={highlightTerms} />
      ) : null}
      {unstableContent ? <pre className="rich-content-tail">{unstableContent}</pre> : null}
    </div>
  );
}
