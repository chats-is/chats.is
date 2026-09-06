import { describe, expect, it } from 'vitest';

import {
  allowedValues,
  chooseValue,
  defaultValue,
  optionLabel
} from '@/lib/media-settings';

describe('allowedValues', () => {
  it('reads the list an admin put on the model', () => {
    expect(allowedValues({ sizes: ['1K', '2K'] }, 'size')).toEqual([
      '1K',
      '2K'
    ]);
  });

  it('renders numeric durations as the strings a radio group compares', () => {
    expect(allowedValues({ durations: [5, 10] }, 'duration')).toEqual([
      '5',
      '10'
    ]);
  });

  it('is empty where the model gives no say, so no row is offered', () => {
    expect(allowedValues({ sizes: ['1K'] }, 'resolution')).toEqual([]);
    expect(allowedValues(null, 'size')).toEqual([]);
  });
});

describe('defaultValue', () => {
  it('reads the model default, numbers included', () => {
    expect(defaultValue({ size: '2K' }, 'size')).toBe('2K');
    expect(defaultValue({ duration: 8 }, 'duration')).toBe('8');
    expect(defaultValue({}, 'voice')).toBeUndefined();
  });
});

describe('chooseValue', () => {
  it('keeps a value both models understand', () => {
    expect(chooseValue(['1K', '2K'], '2K', '1K')).toBe('2K');
  });

  it('falls back to the model default when the value is not allowed', () => {
    expect(chooseValue(['1K', '2K'], '4K', '2K')).toBe('2K');
  });

  it('falls back to the first option when the default is not allowed either', () => {
    expect(chooseValue(['1K', '2K'], '4K', '8K')).toBe('1K');
  });

  it('has nothing to choose when the model allows nothing', () => {
    expect(chooseValue([], '1K', '2K')).toBeUndefined();
  });
});

describe('optionLabel', () => {
  it('uses the app wording where there is one', () => {
    expect(optionLabel('aspectRatio', '1:1')).toBe('Square (1:1)');
    expect(optionLabel('resolution', '1080p')).toBe('1080p (Full HD)');
  });

  it('falls back to the raw value for anything unlisted', () => {
    expect(optionLabel('size', '3000x3000')).toBe('3000x3000');
  });

  it('spells out durations and voices', () => {
    expect(optionLabel('duration', '8')).toBe('8s');
    expect(optionLabel('voice', 'marin')).toBe('Marin');
  });
});
