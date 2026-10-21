import { describe, expect, it, vi } from 'vitest';

import {
  attachedMediaKind,
  choosePromptSettings,
  fitsMediaKind,
  mediaKindOptions,
  promptMediaKinds
} from './prompt';

describe('promptMediaKinds', () => {
  it('is the entry for the type, and with a reference the one that works from it', () => {
    expect(promptMediaKinds('chat', false)).toEqual([]);
    expect(promptMediaKinds('chat', true)).toEqual([]);
    expect(promptMediaKinds('image', false)).toEqual(['image']);
    expect(promptMediaKinds('image', true)).toEqual(['imageEdit']);
    expect(promptMediaKinds('video', false)).toEqual(['video']);
    expect(promptMediaKinds('video', true)).toEqual([
      'videoImage',
      'videoEdit'
    ]);
    expect(promptMediaKinds('audio', false)).toEqual(['audio']);
    expect(promptMediaKinds('audio', true)).toEqual(['stt']);
  });
});

describe('fitsMediaKind', () => {
  const model = (fields: Parameters<typeof fitsMediaKind>[1]) => fields;

  it('draws the lines the media generation settings draw', () => {
    const painter = model({ capability: 'image' });
    const editor = model({ capability: 'image', supportsImageEdit: true });
    const ears = model({ capability: 'audio', supportsTranscription: true });
    expect(fitsMediaKind('image', painter)).toBe(true);
    expect(fitsMediaKind('imageEdit', painter)).toBe(false);
    expect(fitsMediaKind('imageEdit', editor)).toBe(true);
    expect(fitsMediaKind('stt', ears)).toBe(true);
    expect(fitsMediaKind('audio', ears)).toBe(false);
  });
});

describe('attachedMediaKind', () => {
  const video = promptMediaKinds('video', true);

  it('animates an image and edits a video, as the chat does', () => {
    expect(attachedMediaKind(video, [{ contentType: 'image/png' }])).toBe(
      'videoImage'
    );
    expect(attachedMediaKind(video, [{ contentType: 'video/mp4' }])).toBe(
      'videoEdit'
    );
    expect(attachedMediaKind(video, [])).toBeNull();
  });

  it('is the only entry a prompt has, whatever is attached', () => {
    expect(attachedMediaKind(['imageEdit'], [])).toBe('imageEdit');
    expect(attachedMediaKind([], [])).toBeNull();
  });
});

describe('the options and choosePromptSettings', () => {
  it('reads an edit in the Image settings, as the chat edits with them', () => {
    const preferences = {
      imageAspectRatio: '16:9',
      imageSize: '',
      imageResolution: '2K'
    } as Parameters<typeof mediaKindOptions>[0];
    expect(mediaKindOptions(preferences, 'imageEdit')).toEqual([
      { key: 'aspectRatio', value: '16:9' },
      { key: 'size', value: '' },
      { key: 'resolution', value: '2K' }
    ]);
    expect(mediaKindOptions(preferences, 'videoEdit')).toEqual([]);
  });

  it('makes what was chosen the user’s own, a duration in seconds', () => {
    const setPreference = vi.fn();
    choosePromptSettings(setPreference, 'talker', {
      kind: 'videoImage',
      modelId: 'director',
      options: { aspectRatio: '9:16', duration: '8' }
    });
    expect(setPreference.mock.calls).toEqual([
      ['chatModelId', 'talker'],
      ['videoImageModelId', 'director'],
      ['videoAspectRatio', '9:16'],
      ['videoDuration', 8],
      ['mediaGeneration', true]
    ]);
  });

  it('sets only the chat model for a chat prompt', () => {
    const setPreference = vi.fn();
    choosePromptSettings(setPreference, 'talker', null);
    expect(setPreference.mock.calls).toEqual([['chatModelId', 'talker']]);
  });
});
