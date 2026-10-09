/**
 * The least fee per gas a transaction that replaces another at its nonce pays: above the replaced
 * one's, and at least 10% above it, rounded up (intent-states spec, section 6). Relays refuse a
 * replacement below it.
 */
export function leastReplacementFee(replacedFeeBase: bigint): bigint {
  const tenPercentUp = (replacedFeeBase * 11n + 9n) / 10n;
  return tenPercentUp > replacedFeeBase ? tenPercentUp : replacedFeeBase + 1n;
}
