import { describe, expect, it } from 'vitest';

import { buildBaseSystemPrompt } from './system-prompt';

describe('buildBaseSystemPrompt', () => {
  it('names the provider and the language when they are known', () => {
    const prompt = buildBaseSystemPrompt({
      modelId: 'grok-4.6',
      provider: 'xAI',
      datetime: '2026-09-22 10:00',
      language: 'zh-CN'
    });

    expect(prompt).toContain(
      'powered by grok-4.6, a large language model served by xAI.'
    );
    expect(prompt).toContain('Current time: 2026-09-22 10:00');
    expect(prompt).toContain('User language: zh-CN');
  });

  it('says nothing of what is not known, rather than leaving a blank', () => {
    const prompt = buildBaseSystemPrompt({
      modelId: 'grok-4.6',
      provider: '',
      datetime: '2026-09-22 10:00',
      language: undefined
    });

    expect(prompt).toContain('powered by grok-4.6, a large language model.');
    expect(prompt).not.toContain('served by');
    expect(prompt).not.toContain('User language');
    // The blank line before the conventions is the only one.
    expect(prompt.split('\n\n')).toHaveLength(2);
  });
});
