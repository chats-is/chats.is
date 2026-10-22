/**
 * How wide and tall an image is, read from its header: PNG, JPEG, WebP and
 * GIF, the formats an upload or a generation comes in. Null for any other,
 * or for a file too short to say.
 */
export function imageDimensions(
  data: Uint8Array
): { width: number; height: number } | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const ascii = (at: number, length: number) =>
    String.fromCharCode(...data.subarray(at, at + length));

  if (data.length >= 24 && ascii(1, 3) === 'PNG') {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (data.length >= 10 && ascii(0, 3) === 'GIF') {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (data.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    switch (ascii(12, 4)) {
      case 'VP8 ':
        return {
          width: view.getUint16(26, true) & 0x3fff,
          height: view.getUint16(28, true) & 0x3fff
        };
      case 'VP8L': {
        const bits = view.getUint32(21, true);
        return {
          width: (bits & 0x3fff) + 1,
          height: ((bits >> 14) & 0x3fff) + 1
        };
      }
      case 'VP8X':
        return {
          width: 1 + (data[24] | (data[25] << 8) | (data[26] << 16)),
          height: 1 + (data[27] | (data[28] << 8) | (data[29] << 16))
        };
      default:
        return null;
    }
  }
  if (data[0] === 0xff && data[1] === 0xd8) {
    // The segments before the frame each say how long they are; the frame's
    // header holds the size. C4, C8 and CC share its range but are not one.
    let at = 2;
    while (at + 9 < data.length && data[at] === 0xff) {
      const marker = data[at + 1];
      if (marker === 0xff) {
        at++;
        continue;
      }
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return {
          height: view.getUint16(at + 5),
          width: view.getUint16(at + 7)
        };
      }
      at += 2 + view.getUint16(at + 2);
    }
  }
  return null;
}
