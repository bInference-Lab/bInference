import { idPrefixes } from "@binference/protocol";

// The ids a summary must keep: intents, auto orders, alerts and schedules (runtime spec, 7.3).
const keptPrefixes = [
  idPrefixes.intent,
  idPrefixes.autoOrder,
  idPrefixes.alert,
  idPrefixes.schedule,
].join("|");
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const idPattern = new RegExp(`(?<![A-Za-z0-9_])(?:${keptPrefixes})_${uuid}(?![0-9a-f])`, "gu");

// A transaction hash is 32 bytes of hex, an address 20; neither runs into more hex.
const hashPattern = /(?<![0-9A-Za-z])0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/gu;
const addressPattern = /(?<![0-9A-Za-z])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/gu;

/** One identifier a text holds, and the form it is compared in. */
interface Identifier {
  /** As the text wrote it. */
  readonly text: string;
  /** Ids and hashes compare exactly; addresses in any letter case. */
  readonly key: string;
}

function identifiersIn(text: string): readonly Identifier[] {
  const exact = [...text.matchAll(idPattern), ...text.matchAll(hashPattern)].map((match) => ({
    text: match[0],
    key: match[0],
  }));
  const addresses = [...text.matchAll(addressPattern)].map((match) => ({
    text: match[0],
    key: match[0].toLowerCase(),
  }));
  return [...exact, ...addresses];
}

function keysIn(texts: readonly string[]): ReadonlySet<string> {
  return new Set(texts.flatMap((text) => identifiersIn(text).map((found) => found.key)));
}

/** The texts the identifier rule reads: what is compacted, what is kept, and the summary. */
export interface IdentifierCheck {
  readonly compacted: readonly string[];
  readonly kept: readonly string[];
  readonly summary: string;
}

/**
 * The identifier rule (runtime spec, section 7.3): every intent, order, alert and schedule id,
 * transaction hash and address in the compacted texts that is neither in the summary nor in the
 * kept texts, once each, in the order the compacted texts first give them.
 */
export function missingIdentifiers(check: IdentifierCheck): readonly string[] {
  const present = keysIn([check.summary, ...check.kept]);
  const missing = new Map<string, string>();
  for (const found of check.compacted.flatMap(identifiersIn)) {
    if (!present.has(found.key) && !missing.has(found.key)) {
      missing.set(found.key, found.text);
    }
  }
  return [...missing.values()];
}
