import { createHmac } from "node:crypto";
import type { OkxKeys } from "../okx-options.js";

/** What a GET request to OKX's API is signed over. */
interface SignedGet {
  /** The path and query exactly as the request sends them, such as `/api/v6/dex/…?chainIndex=56`. */
  readonly pathAndQuery: string;
  /** Epoch milliseconds when the request leaves. */
  readonly atMs: number;
}

/**
 * The headers that sign a GET request to OKX's API: the key, the passphrase, an ISO timestamp,
 * and the Base64 HMAC-SHA256, under the secret key, of the timestamp, the method and the path with
 * its query. OKX refuses a timestamp more than 30 s from its own clock.
 */
export function signedHeaders(keys: OkxKeys, request: SignedGet): Record<string, string> {
  const timestamp = new Date(request.atMs).toISOString();
  const signature = createHmac("sha256", keys.secretKey.reveal())
    .update(`${timestamp}GET${request.pathAndQuery}`)
    .digest("base64");
  return {
    "OK-ACCESS-KEY": keys.apiKey.reveal(),
    "OK-ACCESS-SIGN": signature,
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": keys.passphrase.reveal(),
  };
}
