import { describe, expect, it } from 'vitest';

import { normalizeMath } from '@/components/message-markdown';

describe('normalizeMath', () => {
  it('rewrites LaTeX delimiters into double dollars', () => {
    expect(normalizeMath('area is \\(x^2\\) here')).toBe(
      'area is $$x^2$$ here'
    );
    expect(normalizeMath('so \\[e=mc^2\\] holds')).toBe('so $$e=mc^2$$ holds');
  });

  it('makes a formula alone on its line a display', () => {
    expect(normalizeMath('Formula:\n$$P = \\frac{a}{b}$$\nwhere')).toBe(
      'Formula:\n$$\nP = \\frac{a}{b}\n$$\nwhere'
    );
    expect(normalizeMath('\\[e=mc^2\\]')).toBe('$$\ne=mc^2\n$$');
    expect(normalizeMath('> $$x$$')).toBe('> $$\n> x\n> $$');
  });

  it('keeps a formula inline when it was written inline', () => {
    // Single dollars and \( \) mean inline, even alone on a line.
    expect(normalizeMath('$x^2$')).toBe('$$x^2$$');
    expect(normalizeMath('\\(x^2\\)')).toBe('$$x^2$$');
    // A line that goes on from code, or into it, has more than the formula.
    expect(normalizeMath('`a` $$x$$')).toBe('`a` $$x$$');
    expect(normalizeMath('$$x$$ `a`')).toBe('$$x$$ `a`');
  });

  it('makes a pair of single dollars around a formula double', () => {
    expect(normalizeMath('$x^2$ and $$e=mc^2$$')).toBe(
      '$$x^2$$ and $$e=mc^2$$'
    );
    expect(normalizeMath('复杂度为 $O(1)$，费用约 $0.00。')).toBe(
      '复杂度为 $$O(1)$$，费用约 $0.00。'
    );
  });

  it('leaves prices as they are', () => {
    for (const text of [
      '国际现货金价约为 **$4,138.40美元/盎司**，今日上涨$33.90。',
      'It costs $5 and the deluxe one $10.',
      'Prices range from $5-$10, or $1,200 for the bundle.',
      '| $0.25 |\n| $3.00 |'
    ]) {
      expect(normalizeMath(text)).toBe(text);
    }
  });

  it('pairs no dollars across a paragraph break', () => {
    expect(normalizeMath('Pay $x\n\nthen y$ more')).toBe(
      'Pay $x\n\nthen y$ more'
    );
  });

  it('leaves an escaped dollar alone', () => {
    expect(normalizeMath('\\$5 and $x$')).toBe('\\$5 and $$x$$');
  });

  it('leaves code alone, where a backslash is just a backslash', () => {
    expect(normalizeMath('`\\(x\\)` and `$a$`')).toBe('`\\(x\\)` and `$a$`');
    expect(normalizeMath('```js\nre = /\\(a\\)/\n```')).toBe(
      '```js\nre = /\\(a\\)/\n```'
    );
  });

  it('rewrites around code rather than giving up on the line', () => {
    expect(normalizeMath('\\(a\\) then `\\(b\\)` then \\(c\\)')).toBe(
      '$$a$$ then `\\(b\\)` then $$c$$'
    );
  });

  it('spans lines, as a display block does', () => {
    expect(normalizeMath('\\[\na + b\n\\]')).toBe('$$\na + b\n$$');
    expect(normalizeMath('$$\n\\int x\\,dx\n$$')).toBe('$$\n\\int x\\,dx\n$$');
  });
});
