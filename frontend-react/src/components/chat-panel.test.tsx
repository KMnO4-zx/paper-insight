import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AuthContext, type AuthContextValue } from '@/lib/auth';
import { ChatPanel } from './chat-panel';

const AUTH: AuthContextValue = {
  user: null,
  isLoading: false,
  login: async () => undefined,
  loginWithGithub: () => undefined,
  logout: async () => undefined,
  refresh: async () => undefined,
};

describe('ChatPanel', () => {
  it('renders only the fixed launcher in its default closed state', () => {
    const html = renderToStaticMarkup(
      <AuthContext.Provider value={AUTH}>
        <ChatPanel paperId="paper-1" />
      </AuthContext.Provider>,
    );

    expect(html).toContain('data-chat-widget="launcher"');
    expect(html).toContain('aria-label="打开论文对话"');
    expect(html).toContain('data-state="closed"');
    expect(html).toContain('paper-chat-corner');
    expect(html).toContain('fixed');
    expect(html).not.toContain('data-chat-widget="panel"');
  });
});
