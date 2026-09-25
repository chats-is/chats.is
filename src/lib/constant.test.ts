import { describe, expect, it } from 'vitest';

import { buildMediaToolsSystemPrompt } from '@/lib/constant';

describe('buildMediaToolsSystemPrompt', () => {
  it('says nothing when there are no media tools', () => {
    expect(buildMediaToolsSystemPrompt([])).toBe('');
  });

  it('with only transcription, speaks of transcripts and not of generated media', () => {
    const prompt = buildMediaToolsSystemPrompt(['transcribe_audio']);
    expect(prompt).toContain('A transcript is not displayed');
    expect(prompt).toContain('If the tool returns an error');
    expect(prompt).not.toContain('generated media renders');
    expect(prompt).not.toContain('map it to one of the values');
  });

  it('with generating tools, covers formats and how generated media shows', () => {
    const prompt = buildMediaToolsSystemPrompt([
      'generate_image',
      'edit_image',
      'transcribe_audio'
    ]);
    expect(prompt).toContain('map it to one of the values');
    expect(prompt).toContain('generated media renders');
    expect(prompt).toContain('A transcript is not displayed');
  });

  it('with only editing tools, leaves out formats, which they take none of', () => {
    const prompt = buildMediaToolsSystemPrompt(['edit_image', 'edit_video']);
    expect(prompt).toContain('generated media renders');
    expect(prompt).not.toContain('map it to one of the values');
    expect(prompt).not.toContain('A transcript is not displayed');
  });
});
