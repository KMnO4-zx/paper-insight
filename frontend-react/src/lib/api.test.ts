import { afterEach, describe, expect, it, vi } from 'vitest';

import { streamSse } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('streamSse', () => {
  it('removes only the protocol space and preserves content indentation', async () => {
    const chunks: string[] = [];
    const body = 'data: top\ndata:   nested\n\ndata:  \n\n';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));

    await streamSse('/test-stream', { method: 'GET' }, {
      onChunk: (chunk) => chunks.push(chunk),
    });

    expect(chunks).toEqual(['top\n  nested', ' ']);
  });

  it('delivers the canonical final event without appending it as another chunk', async () => {
    const chunks: string[] = [];
    const events: Array<[string, string]> = [];
    const body = 'data: partial\n\nevent: final\ndata: # Heading\ndata:   indented\n\nevent: done\ndata: \n\n';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));

    await streamSse('/test-stream', { method: 'GET' }, {
      onChunk: (chunk) => chunks.push(chunk),
      onEvent: (event, data) => events.push([event, data]),
    });

    expect(chunks).toEqual(['partial']);
    expect(events).toContainEqual(['final', '# Heading\n  indented']);
    expect(events).toContainEqual(['done', '']);
  });
});
