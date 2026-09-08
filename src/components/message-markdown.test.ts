import { describe, expect, it } from 'vitest';

import { normalizeMath } from '@/components/message-markdown';

describe('normalizeMath', () => {
  it('rewrites LaTeX delimiters into the ones remark-math reads', () => {
    expect(normalizeMath('area is \\(x^2\\) here')).toBe('area is $x^2$ here');
    expect(normalizeMath('\\[e=mc^2\\]')).toBe('$$e=mc^2$$');
  });

  it('leaves the dollar form alone', () => {
    expect(normalizeMath('$x^2$ and $$e=mc^2$$')).toBe('$x^2$ and $$e=mc^2$$');
  });

  it('leaves code alone, where a backslash is just a backslash', () => {
    expect(normalizeMath('`\\(x\\)`')).toBe('`\\(x\\)`');
    expect(normalizeMath('```js\nre = /\\(a\\)/\n```')).toBe(
      '```js\nre = /\\(a\\)/\n```'
    );
  });

  it('rewrites around code rather than giving up on the line', () => {
    expect(normalizeMath('\\(a\\) then `\\(b\\)` then \\(c\\)')).toBe(
      '$a$ then `\\(b\\)` then $c$'
    );
  });

  it('spans lines, as a display block does', () => {
    expect(normalizeMath('\\[\na + b\n\\]')).toBe('$$\na + b\n$$');
  });
});
