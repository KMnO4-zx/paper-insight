interface MarkdownNormalizationOptions {
  analysisMode?: boolean;
}

interface StreamingMarkdownSplit {
  stableContent: string;
  unstableContent: string;
}

const CODE_SEGMENT_PATTERN = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;
const SAME_LINE_BLOCK_MATH_PATTERN = /^([ \t]*)\$\$[ \t]*(\S(?:.*?\S)?)[ \t]*\$\$[ \t]*$/gm;

function maskCodeSegments(content: string): { masked: string; segments: string[] } {
  const segments: string[] = [];
  const masked = content.replace(CODE_SEGMENT_PATTERN, (segment) => {
    const token = `__CODE_SEGMENT_${segments.length}__`;
    segments.push(segment);
    return token;
  });

  return { masked, segments };
}

function unmaskCodeSegments(content: string, segments: string[]): string {
  return content.replace(/__CODE_SEGMENT_(\d+)__/g, (_, index) => segments[Number(index)] ?? '');
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n?/g, '\n');
}

function looksLikeInlineMath(expression: string): boolean {
  const value = expression.trim();
  if (!value) {
    return false;
  }

  if (/\\[A-Za-z]+|[_^{}]/.test(value)) {
    return true;
  }

  if (/\s/.test(value)) {
    return false;
  }

  if (!/[A-Za-z]/.test(value) && !/[=<>+\-*/]/.test(value)) {
    return false;
  }

  return /^[A-Za-z0-9()[\].,:;+\-*/=<>|]+$/.test(value);
}

function normalizeEscapedInlineMath(content: string): string {
  return content
    .replace(/\\\$([^\n]*?)(\\\$|\$)/g, (match, expression) =>
      looksLikeInlineMath(expression) ? `$${expression}$` : match,
    )
    .replace(/\$([^\n]*?)\\\$/g, (match, expression) =>
      looksLikeInlineMath(expression) ? `$${expression}$` : match,
    );
}

function normalizeBracketMath(content: string): string {
  return content
    .replace(/\\\[\s*([\s\S]+?)\s*\\\]/g, (_, expression) => `$$\n${String(expression).trim()}\n$$`)
    .replace(/\\\((.+?)\\\)/g, (match, expression) =>
      looksLikeInlineMath(String(expression)) ? `$${String(expression).trim()}$` : match,
    );
}

function normalizeSameLineBlockMath(content: string): string {
  return content.replace(
    SAME_LINE_BLOCK_MATH_PATTERN,
    (_, indentation: string, expression: string) => (
      `${indentation}$$\n${indentation}${expression.trim()}\n${indentation}$$`
    ),
  );
}

function normalizeHeadingMarkerPrefix(line: string): string {
  return line.replace(/^([ \t]{0,3})([＃#]{1,6})(?=\s*\S)/, (_, leading, hashes: string) => (
    `${leading}${'#'.repeat(hashes.length)}`
  ));
}

function isLikelyHeadingFragment(fragment: string): boolean {
  const normalized = normalizeHeadingMarkerPrefix(fragment).trim();
  const match = normalized.match(/^(#{1,6})\s*(.+)$/);
  if (!match) {
    return false;
  }

  const title = match[2].trim();
  if (!title || title.length > 120 || /https?:\/\//.test(title)) {
    return false;
  }

  return true;
}

function expandInlineHeadingLine(line: string): string[] {
  const normalizedLine = normalizeHeadingMarkerPrefix(line);
  const inlineHeadingMatch = normalizedLine.match(/^(.+\S)\s+(#{1,6}\s*.+)$/);

  if (!inlineHeadingMatch) {
    return [normalizedLine];
  }

  const [, prefix, headingFragment] = inlineHeadingMatch;
  if (!isLikelyHeadingFragment(headingFragment)) {
    return [normalizedLine];
  }

  return [prefix, '', headingFragment.trimStart()];
}

function normalizeMarkdownLine(line: string): string {
  const normalizedLine = line
    .replace(/^([ \t]{0,3})\\([＃#]{1,6})(?=\s|\S)/, (_, leading, hashes: string) => `${leading}${'#'.repeat(hashes.length)}`)
    .replace(/^(#{1,6})(\S)/, '$1 $2');

  const duplicateHeading = normalizedLine.match(
    /^([ \t]{0,3})(#{1,6})[ \t]+#{1,6}(?:[ \t]+(.*?))?[ \t]*$/,
  );
  if (duplicateHeading) {
    const [, leading, marker, title = ''] = duplicateHeading;
    return title.trim() ? `${leading}${marker} ${title.trim()}` : '';
  }

  if (/^[ \t]{0,3}#{1,6}[ \t]*$/.test(normalizedLine)) {
    return '';
  }

  return normalizedLine
    .replace(/^([ \t]{0,3}[-*+])(\S)/, '$1 $2')
    .replace(/^([ \t]{0,3}\d+[.)、])(\S)/, '$1 $2');
}

function shouldAddBlockSpacing(line: string, options: MarkdownNormalizationOptions): boolean {
  if (!line) {
    return false;
  }

  if (/^#{1,6}\s/.test(line)) {
    return true;
  }

  if (options.analysisMode && /^[-*+]\s/.test(line)) {
    return true;
  }

  return false;
}

function countUnescapedDoubleDollar(line: string): number {
  let count = 0;

  for (let index = 0; index < line.length - 1; index += 1) {
    if (line[index] !== '$' || line[index + 1] !== '$') {
      continue;
    }

    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && line[cursor] === '\\'; cursor -= 1) {
      backslashes += 1;
    }

    if (backslashes % 2 === 0) {
      count += 1;
      index += 1;
    }
  }

  return count;
}

function findUnclosedFenceStart(content: string): number | null {
  const lines = content.split('\n');
  let inFence: '```' | '~~~' | null = null;
  let fenceStart: number | null = null;
  let offset = 0;

  for (const line of lines) {
    const trimmed = line.trimStart();
    const marker = trimmed.startsWith('```') ? '```' : trimmed.startsWith('~~~') ? '~~~' : null;

    if (!marker) {
      offset += line.length + 1;
      continue;
    }

    if (!inFence) {
      inFence = marker;
      fenceStart = offset;
    } else if (marker === inFence) {
      inFence = null;
      fenceStart = null;
    }

    offset += line.length + 1;
  }

  return inFence ? fenceStart : null;
}

function findUnclosedBlockMathStart(content: string): number | null {
  const lines = content.split('\n');
  let inFence: '```' | '~~~' | null = null;
  let inBlockMath = false;
  let blockMathStart: number | null = null;
  let offset = 0;

  for (const line of lines) {
    const trimmed = line.trimStart();
    const marker = trimmed.startsWith('```') ? '```' : trimmed.startsWith('~~~') ? '~~~' : null;

    if (marker) {
      if (!inFence) {
        inFence = marker;
      } else if (marker === inFence) {
        inFence = null;
      }
      offset += line.length + 1;
      continue;
    }

    if (!inFence) {
      const delimiterCount = countUnescapedDoubleDollar(line);
      if (delimiterCount % 2 === 1) {
        if (!inBlockMath) {
          inBlockMath = true;
          blockMathStart = offset;
        } else {
          inBlockMath = false;
          blockMathStart = null;
        }
      }
    }

    offset += line.length + 1;
  }

  return inBlockMath ? blockMathStart : null;
}

function hasUnclosedInlineDelimiter(line: string, delimiter: '$' | '`'): boolean {
  let count = 0;

  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== delimiter) {
      continue;
    }

    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && line[cursor] === '\\'; cursor -= 1) {
      backslashes += 1;
    }

    if (backslashes % 2 === 1) {
      continue;
    }

    if (delimiter === '$') {
      const previousIsDollar = index > 0 && line[index - 1] === '$';
      const nextIsDollar = index + 1 < line.length && line[index + 1] === '$';
      if (previousIsDollar || nextIsDollar) {
        continue;
      }
    }

    count += 1;
  }

  return count % 2 === 1;
}

function moveTrailingLineToUnstable(stableContent: string, unstableContent: string): StreamingMarkdownSplit {
  const boundary = stableContent.lastIndexOf('\n');
  if (boundary < 0) {
    return {
      stableContent: '',
      unstableContent: stableContent + unstableContent,
    };
  }

  return {
    stableContent: stableContent.slice(0, boundary + 1),
    unstableContent: stableContent.slice(boundary + 1) + unstableContent,
  };
}

export function normalizeMathContent(content: string): string {
  if (!content) {
    return '';
  }

  const { masked, segments } = maskCodeSegments(normalizeLineEndings(content));
  const normalized = normalizeSameLineBlockMath(
    normalizeEscapedInlineMath(
      normalizeBracketMath(
        masked
          .replace(/\\\$\$([\s\S]+?)\\\$\$/g, (_, expression) => `$$${expression}$$`)
          .replace(/\\\$\$([\s\S]+?)\$\$/g, (_, expression) => `$$${expression}$$`)
          .replace(/\$\$([\s\S]+?)\\\$\$/g, (_, expression) => `$$${expression}$$`),
      ),
    ),
  );

  return unmaskCodeSegments(normalized, segments);
}

function normalizeMarkdownSyntax(content: string, options: MarkdownNormalizationOptions = {}): string {
  if (!content) {
    return '';
  }

  const { masked, segments } = maskCodeSegments(content);
  const lines = masked
    .split('\n')
    .flatMap(expandInlineHeadingLine)
    .map(normalizeMarkdownLine);
  const normalizedLines: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const previousTrimmed = normalizedLines.at(-1)?.trim() ?? '';
    const nextTrimmed = lines[index + 1]?.trim() ?? '';
    const needsSpacing = shouldAddBlockSpacing(trimmed, options);

    if (needsSpacing && previousTrimmed) {
      normalizedLines.push('');
    }

    normalizedLines.push(line);

    if (needsSpacing && nextTrimmed) {
      normalizedLines.push('');
    }
  }

  return unmaskCodeSegments(normalizedLines.join('\n').replace(/\n{3,}/g, '\n\n'), segments).trimEnd();
}

export function normalizeMarkdownContent(
  content: string,
  options: MarkdownNormalizationOptions = {},
): string {
  return normalizeMarkdownSyntax(normalizeMathContent(content), options);
}

export function splitStreamingMarkdown(
  content: string,
  options: MarkdownNormalizationOptions = {},
): StreamingMarkdownSplit {
  const normalized = normalizeMarkdownContent(content, options);
  if (!normalized) {
    return { stableContent: '', unstableContent: '' };
  }

  let boundary = normalized.length;
  const openFenceStart = findUnclosedFenceStart(normalized);
  const openBlockMathStart = findUnclosedBlockMathStart(normalized);

  if (openFenceStart !== null) {
    boundary = Math.min(boundary, openFenceStart);
  }

  if (openBlockMathStart !== null) {
    boundary = Math.min(boundary, openBlockMathStart);
  }

  let split: StreamingMarkdownSplit = {
    stableContent: normalized.slice(0, boundary),
    unstableContent: normalized.slice(boundary),
  };

  if (!split.stableContent) {
    return split;
  }

  const lastLine = split.stableContent.slice(split.stableContent.lastIndexOf('\n') + 1);
  if (hasUnclosedInlineDelimiter(lastLine, '$') || hasUnclosedInlineDelimiter(lastLine, '`')) {
    split = moveTrailingLineToUnstable(split.stableContent, split.unstableContent);
  }

  return split;
}

export function normalizeKeywords(keywords: string[] | undefined | null): string[] {
  if (!keywords?.length) {
    return [];
  }

  const flattened = keywords.flatMap((keyword) =>
    keyword
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean),
  );

  return [...new Set(flattened)];
}

export function getVenueParts(venue?: string | null): { label: string; conference: string; type: string } {
  if (!venue) {
    return { label: 'Unknown venue', conference: 'Unknown', type: '' };
  }

  const lower = venue.toLowerCase();
  const conference = lower.includes('neurips')
    ? 'NeurIPS'
    : lower.includes('iclr')
      ? 'ICLR'
      : lower.includes('icml')
        ? 'ICML'
        : lower.includes('cvpr')
          ? 'CVPR'
          : /\bchi\b/.test(lower)
            ? 'CHI'
            : lower.includes('hugging face')
              ? 'Hugging Face'
              : lower.includes('arxiv')
                ? 'arXiv'
                : venue.split(' ')[0];

  const type = lower.includes('oral')
    ? 'Oral'
    : lower.includes('spotlight')
      ? 'Spotlight'
      : lower.includes('poster')
        ? 'Poster'
        : '';

  return {
    label: venue,
    conference,
    type,
  };
}
