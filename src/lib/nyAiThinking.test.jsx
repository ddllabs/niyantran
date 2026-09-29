import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import NyAiThinking from '../ai/NyAiThinking.jsx';

describe('CR-13 — NyAI Thinking Animation', () => {
  it('renders with accessible status role and polite live region', () => {
    const html = renderToStaticMarkup(<NyAiThinking lang="en" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('NyAI is thinking');
    expect(html).toContain('nyai-thinking-root');
    expect(html).toContain('nyai-thinking-badge');
  });

  it('provides Hindi localization when lang="hi"', () => {
    const html = renderToStaticMarkup(<NyAiThinking lang="hi" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('NyAI विचार कर रहा है');
  });

  it('renders model subtext when model name is provided', () => {
    const html = renderToStaticMarkup(<NyAiThinking model="Claude 3.5 Sonnet" lang="en" />);
    expect(html).toContain('Analyzing with Claude 3.5 Sonnet...');
  });

  it('renders animated wave processing indicator when no subtext is specified', () => {
    const html = renderToStaticMarkup(<NyAiThinking lang="en" />);
    expect(html).toContain('nyai-thinking-wave');
    expect(html).toContain('nyai-wave-bar');
  });
});
