// RFC 4648, section 6: five bits per character, written here in lowercase.
const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
const upperAlphabet = alphabet.toUpperCase();
const bitsPerCharacter = 5;

/** Encodes bytes in RFC 4648 base32, lowercase and without padding. */
export function encodeBase32(bytes: Uint8Array): string {
  let text = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = ((buffer << 8) | byte) & 0xfff;
    bits += 8;
    while (bits >= bitsPerCharacter) {
      bits -= bitsPerCharacter;
      text += alphabet.charAt((buffer >> bits) & 0x1f);
    }
  }
  return bits > 0 ? text + alphabet.charAt((buffer << (bitsPerCharacter - bits)) & 0x1f) : text;
}

/**
 * Decodes RFC 4648 base32 without padding, in either case. Returns `undefined` for a character
 * outside the alphabet, a length no byte count encodes to, or set bits after the last whole byte:
 * each byte sequence has one encoding, so a typo never decodes to the same bytes.
 */
export function decodeBase32(text: string): Uint8Array | undefined {
  const bytes = new Uint8Array(Math.floor((text.length * bitsPerCharacter) / 8));
  let buffer = 0;
  let bits = 0;
  let written = 0;
  for (const character of text) {
    // ASCII letters only: toLowerCase would also turn the Kelvin sign into a k.
    const value = Math.max(alphabet.indexOf(character), upperAlphabet.indexOf(character));
    if (value === -1) {
      return undefined;
    }
    buffer = ((buffer << bitsPerCharacter) | value) & 0xfff;
    bits += bitsPerCharacter;
    if (bits >= 8) {
      bits -= 8;
      bytes[written] = (buffer >> bits) & 0xff;
      written += 1;
    }
  }
  const isCanonical = bits < bitsPerCharacter && (buffer & ((1 << bits) - 1)) === 0;
  return isCanonical ? bytes : undefined;
}
