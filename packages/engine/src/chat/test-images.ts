/** A 1x1 PNG, for tests that send the owner's images. */
export const testPng: Uint8Array = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0,
  0, 144, 119, 83, 222, 0, 0, 0, 12, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 0, 0, 3, 1, 1, 0,
  201, 254, 146, 239, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

/** The first bytes of a JPEG and of a WebP, which name their format, for format tests. */
export const testImageHeads: { readonly jpeg: Uint8Array; readonly webp: Uint8Array } = {
  jpeg: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]),
  webp: Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
};
