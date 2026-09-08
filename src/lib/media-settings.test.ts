import { describe, expect, it } from 'vitest';

import {
  allowedValues,
  chooseValue,
  defaultValue,
  optionLabel,
  optionShape
} from '@/lib/media-settings';

describe('allowedValues', () => {
  it('reads the list an admin put on the model, behind an Auto', () => {
    expect(allowedValues({ sizes: ['1K', '2K'] }, 'size')).toEqual([
      'auto',
      '1K',
      '2K'
    ]);
  });

  it('renders numeric durations as the strings a radio group compares', () => {
    expect(allowedValues({ durations: [5, 10] }, 'duration')).toEqual([
      'auto',
      '5',
      '10'
    ]);
  });

  it('offers one Auto, whatever a model configured earlier still carries', () => {
    expect(allowedValues({ sizes: ['auto', '1K'] }, 'size')).toEqual([
      'auto',
      '1K'
    ]);
  });

  it('is empty where the model gives no say, so no row is offered', () => {
    expect(allowedValues({ sizes: ['1K'] }, 'resolution')).toEqual([]);
    expect(allowedValues(null, 'size')).toEqual([]);
    // An Auto with nothing to be an alternative to is not a row either.
    expect(allowedValues({ sizes: ['auto'] }, 'size')).toEqual([]);
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

  it("reads auto as Auto, not 'autos'", () => {
    expect(optionLabel('duration', 'auto')).toBe('Auto');
    expect(optionLabel('size', 'auto')).toBe('Auto');
    expect(optionLabel('voice', 'auto')).toBe('Auto');
  });
});

describe('optionShape', () => {
  it('reads the way round from a ratio', () => {
    expect(optionShape('aspectRatio', '1:1')).toBe('square');
    expect(optionShape('aspectRatio', '16:9')).toBe('landscape');
    expect(optionShape('aspectRatio', '9:16')).toBe('portrait');
  });

  it('reads it from a pixel size too', () => {
    expect(optionShape('size', '1024x1024')).toBe('square');
    expect(optionShape('size', '1536x1024')).toBe('landscape');
    expect(optionShape('size', '1024x1536')).toBe('portrait');
  });

  it('leaves a quantity alone — the label already carries the number', () => {
    // A size that names a tier rather than two sides says nothing about which
    // way round the output comes out.
    expect(optionShape('size', '2K')).toBe('plain');
    expect(optionShape('resolution', '1080p')).toBe('plain');
    expect(optionShape('duration', '8')).toBe('plain');
    expect(optionShape('voice', 'marin')).toBe('plain');
  });

  it('has no shape for auto, or for anything unparseable', () => {
    expect(optionShape('aspectRatio', 'auto')).toBe('plain');
    expect(optionShape('aspectRatio', 'wide')).toBe('plain');
    expect(optionShape('aspectRatio', '0:1')).toBe('plain');
  });
});
