const pairPattern = /^#pair=([A-Za-z0-9_-]{1,64})$/;

/** The pairing code in a page address's hash, `#pair=<code>`, or `undefined` when it has none. */
export function pairCodeIn(hash: string): string | undefined {
  return pairPattern.exec(hash)?.[1];
}
