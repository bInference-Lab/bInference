import { holdsRecoveryPhrase, type JsonValue, secretKindsIn } from "@binference/core";

/** The most bytes a listed tool's arguments may take as JSON (decision 0429). */
const maxListedArgumentsBytes = 8 * 1_024;

/** Why arguments are not sent: too long, or holding what looks like a secret. */
export type ArgumentsRefusal = "too_large" | "secret";

// A PEM block of a private key, of any kind.
const privateKeyBlock = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
const encoder = new TextEncoder();

function isList(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

// Every text of the arguments a secret could hide in: each string, and each list's strings joined
// one a line, so a phrase sent word by word in a list reads as one.
function textsIn(value: JsonValue): readonly string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (isList(value)) {
    const items = value.filter((item) => typeof item === "string").join("\n");
    return [items, ...value.flatMap((item) => textsIn(item))];
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap((item) => textsIn(item));
  }
  return [];
}

// A recovery phrase of the BIP-39 list in any case or width, a PEM private key block, a binference
// key, a bot token or an owner key code. The log redaction's wide phrase pattern is for logs only,
// and a bare `0x` and 64 hex digits is a transaction hash as often as a key.
function holdsSecret(text: string): boolean {
  const kinds = secretKindsIn(text).filter(
    (kind) => kind !== "privateKey" && kind !== "recoveryPhrase",
  );
  const plain = text.normalize("NFKC").toLowerCase();
  return kinds.length > 0 || privateKeyBlock.test(text) || holdsRecoveryPhrase(plain);
}

/**
 * Why a listed tool's arguments, already checked by the listing's input schema, are not sent: more
 * than 8 KiB as JSON, or, in any of their strings or a list's strings read together, a recovery
 * phrase of the BIP-39 list in any case or letter width, a PEM private key block, a binference key,
 * a Telegram bot token or an owner key code. A bare `0x` and 64 hex digits passes, since a
 * transaction hash looks the same.
 */
export function argumentsRefusal(args: JsonValue): ArgumentsRefusal | undefined {
  if (encoder.encode(JSON.stringify(args)).byteLength > maxListedArgumentsBytes) {
    return "too_large";
  }
  return textsIn(args).some((text) => holdsSecret(text)) ? "secret" : undefined;
}
