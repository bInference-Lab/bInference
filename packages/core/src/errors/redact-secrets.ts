/** A kind of secret {@link redactSecrets} masks. */
export type SecretKind =
  | "privateKey"
  | "recoveryPhrase"
  | "botToken"
  | "binferenceKey"
  | "ownerKeyCode";

const secretPatterns: Readonly<Record<SecretKind, Readonly<RegExp>>> = {
  // A private key: 0x and 64 hex digits.
  privateKey: /\b0x[0-9a-fA-F]{64}\b/g,
  // A recovery phrase: 12 to 24 lowercase words in a row.
  recoveryPhrase: /\b[a-z]{3,8}(?: [a-z]{3,8}){11,23}\b/g,
  // A Telegram bot token.
  botToken: /\b\d{6,12}:[A-Za-z0-9_-]{30,}/g,
  // A binference API key or protocol token.
  binferenceKey: /\b(?:binf|bnt)_[A-Za-z0-9_-]{16,}/g,
  // An owner key code: bnok1 and base32, whole or in groups of up to five split by spaces or dashes.
  ownerKeyCode: /\bbnok1[A-Za-z2-7]+(?:[ -][A-Za-z2-7]{1,5})*/g,
};

const secretKinds: readonly SecretKind[] = [
  "privateKey",
  "recoveryPhrase",
  "botToken",
  "binferenceKey",
  "ownerKeyCode",
];

/** What a secret is replaced with. */
export const redactedMark = "[redacted]";

/**
 * Masks private keys, recovery phrases, bot tokens, binference keys and owner key codes in a text.
 * Run it on every value that leaves the process in a log record or an error's details.
 */
export function redactSecrets(text: string): string {
  return secretKinds.reduce(
    (masked: string, kind: SecretKind) => masked.replace(secretPatterns[kind], redactedMark),
    text,
  );
}

/**
 * The kinds of secret {@link redactSecrets} would mask in a text, in a fixed order; empty when it
 * would mask nothing. Its recovery-phrase pattern is wide on purpose, for logs.
 */
export function secretKindsIn(text: string): readonly SecretKind[] {
  return secretKinds.filter((kind) => text.search(secretPatterns[kind]) !== -1);
}
