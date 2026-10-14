import { describe, expect, it } from 'vitest';

import { createArtifactInputSchema } from './chat-tools';

describe('createArtifactInputSchema', () => {
  it('takes what the model writes, its content given', () => {
    expect(
      createArtifactInputSchema.safeParse({
        title: 'Counter',
        type: 'code',
        language: 'tsx',
        fileName: 'index.tsx',
        content: 'export default function App() { return null; }'
      }).success
    ).toBe(true);
  });

  it('refuses a call that leaves the content out', () => {
    // As a model sent it, filling in a field it was offered instead.
    expect(
      createArtifactInputSchema.safeParse({
        title: 'Counter',
        type: 'code',
        language: 'tsx',
        fileName: 'index.tsx',
        size: 0
      }).success
    ).toBe(false);
  });

  it('offers no image or file, which the model cannot make', () => {
    expect(
      createArtifactInputSchema.safeParse({
        title: 'Picture',
        type: 'image',
        content: 'x'
      }).success
    ).toBe(false);
  });
});
