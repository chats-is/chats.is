import { describe, expect, it } from 'vitest';

import { buildBaseSystemPrompt } from './system-prompt';

describe('buildBaseSystemPrompt', () => {
  it('names the provider and the language when they are known', () => {
    const prompt = buildBaseSystemPrompt({
      modelId: 'grok-4.6',
      provider: 'xAI',
      date: 'Tuesday, September 22, 2026, GMT+8',
      language: 'zh-CN'
    });

    expect(prompt).toContain(
      'powered by grok-4.6, a large language model served by xAI.'
    );
    // The date, and not the time, which changed it every minute.
    expect(prompt).toContain(
      'Current date: Tuesday, September 22, 2026, GMT+8'
    );
    expect(prompt).not.toContain('Current time');
    expect(prompt).toContain('User language: zh-CN');
  });

  it('says nothing of what is not known, rather than leaving a blank', () => {
    const prompt = buildBaseSystemPrompt({
      modelId: 'grok-4.6',
      provider: '',
      date: 'Tuesday, September 22, 2026, GMT+8',
      language: undefined
    });

    expect(prompt).toContain('powered by grok-4.6, a large language model.');
    expect(prompt).not.toContain('served by');
    expect(prompt).not.toContain('User language');
    // The blank line before the conventions is the only one.
    expect(prompt.split('\n\n')).toHaveLength(2);
  });
});
