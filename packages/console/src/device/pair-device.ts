import type { Fetcher } from "../app/console-browser";
import type { NewDeviceKey } from "./device-key";
import { parseJson, readPairAnswer } from "./pair-answer.schema";

/** Why the engine refused a pairing: the link was used, expired, or the page is not trusted. */
export type PairRefusal = "used" | "expired" | "refused";

/** The engine's answer to `POST /pair`. */
export type PairOutcome =
  | { readonly ok: true; readonly deviceId: string }
  | { readonly ok: false; readonly refusal: PairRefusal };

/** One pairing to send. */
export interface PairRequest {
  /** The code from the link's `#pair=` part. */
  readonly code: string;
  readonly key: NewDeviceKey;
  /** What the owner sees the device called, 1 to 64 characters. */
  readonly label: string;
  readonly signal: AbortSignal;
}

// The pairing route answers in a few milliseconds; past this the engine is not answering.
const pairTimeoutMs = 15_000;

/**
 * Sends `POST /pair` to the page's own origin with the device's public key (protocol spec,
 * section 4.2). A 201 gives the device id; a 401 says the link was used or expired; any other
 * refusal is `refused`. Throws when the engine does not answer in time.
 */
export async function pairDevice(fetcher: Fetcher, request: PairRequest): Promise<PairOutcome> {
  const { code, key, label } = request;
  const answer = await fetcher("/pair", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, publicKey: key.publicKey, alg: key.alg, label }),
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(pairTimeoutMs)]),
  });
  const text = await answer.text();
  return readPairAnswer(answer.status, parseJson(text));
}
