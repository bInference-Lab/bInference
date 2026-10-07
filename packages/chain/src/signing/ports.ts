import type { Result } from "@binference/core";
import type { AuthorizeInput } from "./authorize-input.js";
import type { SignerRefusal } from "./signer-refusal.js";

/**
 * The signer as custody reaches it (keys spec, section 5): it holds the agent key and nothing
 * else, reads no config, database or network, and checks the hard rules before it signs. Custody
 * and the signer share this port without importing each other. Adapters: the client of
 * `@binference/signer`'s child process, and a signer service whose key sits in a KMS.
 */
export interface SignerProcess {
  /**
   * The agent key's public half, DER SubjectPublicKeyInfo in base64, as Privy's key quorums take
   * it. Rejects with the signal's reason once the signal aborts.
   */
  publicKey(options: { readonly signal: AbortSignal }): Promise<string>;
  /**
   * Privy's authorization signature over `input.request`, DER in base64, once every hard rule
   * holds; otherwise why the signer refused, which it logs by rule number and raises as a notice.
   * Requests for one wallet go one at a time. Rejects with the signal's reason once the signal
   * aborts, and signs nothing for a signal aborted before the call.
   */
  authorize(
    input: AuthorizeInput,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<string, SignerRefusal>>;
}
