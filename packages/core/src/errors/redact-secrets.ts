const secretPatterns: readonly RegExp[] = [
  // A private key: 0x and 64 hex digits.
  /\b0x[0-9a-fA-F]{64}\b/g,
  // A recovery phrase: 12 to 24 lowercase words in a row.
  /\b[a-z]{3,8}(?: [a-z]{3,8}){11,23}\b/g,
  // A Telegram bot token.
  /\b\d{6,12}:[A-Za-z0-9_-]{30,}/g,
  // A binference API key or protocol token.
  /\b(?:binf|bnt)_[A-Za-z0-9_-]{16,}/g,
];

/** What a secret is replaced with. */
export const redactedMark = "[redacted]";

/**
 * Masks private keys, recovery phrases, bot tokens and binference keys in a text. Run it on every
 * value that leaves the process in a log record or an error's details.
 */
export function redactSecrets(text: string): string {
  return secretPatterns.reduce(
    (masked: string, pattern: Readonly<RegExp>) => masked.replace(pattern, redactedMark),
    text,
  );
}
