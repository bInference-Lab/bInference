const alphabet = /^[A-Za-z0-9_-]*$/;

/**
 * The bytes a base64url text writes (RFC 4648 section 5, no padding), or none when it holds more
 * than `maxBytes`, a character outside the alphabet, padding, a length no bytes give, or set bits
 * past its last byte. Only the one text that writes its bytes decodes, so two texts never name the
 * same bytes. The length is checked before anything is decoded.
 */
export function base64urlBytes(text: string, maxBytes: number): Uint8Array | undefined {
  if (
    text.length > Math.ceil((maxBytes * 4) / 3) ||
    text.length % 4 === 1 ||
    !alphabet.test(text)
  ) {
    return undefined;
  }
  const bytes = Buffer.from(text, "base64url");
  if (bytes.length > maxBytes || bytes.toString("base64url") !== text) {
    return undefined;
  }
  return new Uint8Array(bytes);
}
