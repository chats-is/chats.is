import { describe, expect, it } from 'vitest';

import { imageDimensions } from './image-dimensions';

/** Only the bytes a header holds; the rest of each file is not read. */
const u16be = (n: number) => [n >> 8, n & 0xff];
const u32be = (n: number) => [...u16be(n >>> 16), ...u16be(n & 0xffff)];
const u16le = (n: number) => [n & 0xff, n >> 8];
const u24le = (n: number) => [n & 0xff, (n >> 8) & 0xff, n >> 16];
const ascii = (s: string) => [...s].map(c => c.charCodeAt(0));

const png = (width: number, height: number) =>
  new Uint8Array([
    0x89,
    ...ascii('PNG\r\n\x1a\n'),
    ...u32be(13),
    ...ascii('IHDR'),
    ...u32be(width),
    ...u32be(height),
    8,
    6,
    0,
    0,
    0
  ]);

const jpeg = (width: number, height: number) =>
  new Uint8Array([
    0xff,
    0xd8,
    // An APP0 segment before the frame, to be stepped over.
    0xff,
    0xe0,
    ...u16be(16),
    ...ascii('JFIF\0'),
    1,
    1,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
    0xff,
    0xc0,
    ...u16be(17),
    8,
    ...u16be(height),
    ...u16be(width),
    3,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0
  ]);

const webp = (width: number, height: number) =>
  new Uint8Array([
    ...ascii('RIFF'),
    0,
    0,
    0,
    0,
    ...ascii('WEBPVP8X'),
    10,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    ...u24le(width - 1),
    ...u24le(height - 1)
  ]);

const gif = (width: number, height: number) =>
  new Uint8Array([...ascii('GIF89a'), ...u16le(width), ...u16le(height), 0, 0]);

describe('imageDimensions', () => {
  it('reads PNG, JPEG, WebP and GIF headers', () => {
    expect(imageDimensions(png(1024, 1536))).toEqual({
      width: 1024,
      height: 1536
    });
    expect(imageDimensions(jpeg(1920, 1080))).toEqual({
      width: 1920,
      height: 1080
    });
    expect(imageDimensions(webp(800, 600))).toEqual({
      width: 800,
      height: 600
    });
    expect(imageDimensions(gif(320, 240))).toEqual({
      width: 320,
      height: 240
    });
  });

  it('has nothing to say of anything else, or of a file cut short', () => {
    expect(imageDimensions(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(imageDimensions(png(10, 10).subarray(0, 12))).toBeNull();
  });
});
