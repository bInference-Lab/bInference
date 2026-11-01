import { BinferenceError, type Logger, type Secret } from "@binference/core";
import type { SecretSource } from "../config/schema/secret-source.schema.js";
import type { SecretReader } from "../config/secrets/secret-reader.js";

/**
 * The owner's Relay API key from `venues.keys.relay` (decision 0322), or `undefined` when config
 * names none or it cannot be read: Relay then runs keyless, and an unread key is logged with its
 * error code, never its source or value.
 */
export async function readRelayKey(
  named: SecretSource | undefined,
  parts: { readonly secrets: SecretReader; readonly logger: Logger },
  signal: AbortSignal,
): Promise<Secret | undefined> {
  if (named === undefined) {
    return undefined;
  }
  try {
    return await parts.secrets.read("venues.keys.relay", named, signal);
  } catch (error) {
    signal.throwIfAborted();
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    parts.logger.warn("engine.venue_key_unread", { errorCode });
    return undefined;
  }
}
