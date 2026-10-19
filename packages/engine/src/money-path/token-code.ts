import type { AssetRef } from "@binference/chain";

/**
 * Whether a token's address holds contract code on its chain now: a token a launch is about to
 * make holds none (decision 0238). Rejects when its chain cannot be read, and with the signal's
 * reason once it aborts.
 */
export type ReadTokenCode = (
  token: AssetRef,
  call: { readonly signal: AbortSignal },
) => Promise<boolean>;
