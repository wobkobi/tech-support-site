// src/shared/lib/jpeg-size.ts
// Reads a JPEG's pixel size from its header so the server stores the file's real size, without
// bundling an image library.

/**
 * Finds width and height in a JPEG's first SOF segment (C0-CF except C4, C8, CC). Segments are
 * `FF xx` plus a self-counting 2-byte length; D0-D7 and 01 stand alone. SOF holds precision (1),
 * height (2), width (2).
 * @param bytes - The file's bytes.
 * @returns Width and height, or null when it isn't a readable JPEG.
 */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  // i + 8 is the last byte an SOF read touches.
  while (i + 8 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1]!;
    // Fill bytes: any number of FFs may pad between segments.
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof) {
      const height = (bytes[i + 5]! << 8) | bytes[i + 6]!;
      const width = (bytes[i + 7]! << 8) | bytes[i + 8]!;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += 2 + length;
  }
  return null;
}

/**
 * Downloads a picture and reads its JPEG size.
 * @param url - Public image URL.
 * @returns Width and height, or null when it can't be fetched or isn't a JPEG.
 */
export async function fetchJpegSize(
  url: string,
): Promise<{ width: number; height: number } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return jpegSize(new Uint8Array(await res.arrayBuffer()));
  } catch {
    return null;
  }
}
