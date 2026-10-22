import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { generate, OUTPUT } from './gen-provider-options';

describe('gen-provider-options', () => {
  it('matches the AI SDK packages installed now', () => {
    // Behind after an upgrade: run `pnpm gen:provider-options`.
    expect(readFileSync(OUTPUT, 'utf8')).toBe(generate());
  }, 60_000);
});
