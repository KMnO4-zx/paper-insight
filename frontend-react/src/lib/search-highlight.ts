const MAX_HIGHLIGHT_TERMS = 12;

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isMeaningfulTerm(value: string): boolean {
  if (!value) {
    return false;
  }

  if (value.length > 1) {
    return true;
  }

  return !/^[A-Za-z0-9]$/.test(value);
}

export function buildSearchHighlightTerms(query: string): string[] {
  const terms = query
    .split(/\s+/)
    .map((term) => term.trim().replace(/^["'“”‘’]+|["'“”‘’.,;:!?，。；：！？]+$/g, ''))
    .filter(isMeaningfulTerm);

  const normalizedTerms = new Map<string, string>();
  for (const term of terms) {
    const key = term.toLocaleLowerCase();
    if (!normalizedTerms.has(key)) {
      normalizedTerms.set(key, term);
    }
  }

  return Array.from(normalizedTerms.values())
    .sort((first, second) => second.length - first.length)
    .slice(0, MAX_HIGHLIGHT_TERMS);
}

export function buildSearchHighlightPattern(terms: string[]): RegExp | null {
  const escapedTerms = terms.map(escapeRegExp).filter(Boolean);
  if (!escapedTerms.length) {
    return null;
  }

  return new RegExp(`(${escapedTerms.join('|')})`, 'gi');
}

export function splitSearchHighlightText(text: string, terms: string[]): Array<{ text: string; highlighted: boolean }> {
  const pattern = buildSearchHighlightPattern(terms);
  if (!pattern) {
    return [{ text, highlighted: false }];
  }

  const parts: Array<{ text: string; highlighted: boolean }> = [];
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const matchText = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, index), highlighted: false });
    }
    parts.push({ text: matchText, highlighted: true });
    lastIndex = index + matchText.length;
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), highlighted: false });
  }

  return parts.length ? parts : [{ text, highlighted: false }];
}

function hasClassName(node: HastNode, className: string): boolean {
  const value = node.properties?.className;
  if (Array.isArray(value)) {
    return value.includes(className);
  }
  if (typeof value === 'string') {
    return value.split(/\s+/).includes(className);
  }
  return false;
}

function shouldSkipElement(node: HastNode): boolean {
  if (node.type !== 'element') {
    return false;
  }

  if (node.tagName && ['code', 'kbd', 'mark', 'pre', 'script', 'style'].includes(node.tagName)) {
    return true;
  }

  return hasClassName(node, 'katex') || hasClassName(node, 'katex-display');
}

function highlightTextNode(value: string, terms: string[]): HastNode[] {
  return splitSearchHighlightText(value, terms).map((part) => {
    if (!part.highlighted) {
      return { type: 'text', value: part.text };
    }

    return {
      type: 'element',
      tagName: 'mark',
      properties: { className: ['search-match-highlight'] },
      children: [{ type: 'text', value: part.text }],
    };
  });
}

function highlightTree(node: HastNode, terms: string[]): void {
  if (shouldSkipElement(node) || !node.children?.length) {
    return;
  }

  const nextChildren: HastNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      nextChildren.push(...highlightTextNode(child.value, terms));
      continue;
    }

    highlightTree(child, terms);
    nextChildren.push(child);
  }

  node.children = nextChildren;
}

export function createSearchHighlightRehypePlugin(terms: string[]) {
  return function searchHighlightRehypePlugin() {
    return function transform(tree: HastNode) {
      highlightTree(tree, terms);
    };
  };
}
