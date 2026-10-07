import type { Result } from "@binference/core";
import type {
  AgentPublicKey,
  AuthorizationSignature,
  AuthorizeRequest,
} from "./signer-process/authorize-request.js";

/**
 * The signer process as the engine reaches it over its private IPC endpoint (spec 5, section 5):
 * it holds the agent key and nothing else, reads no config, database or network, and answers one
 * request at a time per wallet. Adapters: the IPC client of `@binference/signer`'s child process,
 * and a signer service whose key sits in a KMS.
 */
export interface SignerProcess {
  /** The agent key's public half. Rejects with the signal's reason once the signal aborts. */
  publicKey(options: { readonly signal: AbortSignal }): Promise<AgentPublicKey>;
  /**
   * Signs Privy's authorization payload of the request with the agent key, after its hard rules
   * pass. `refused` when one fails; the signer logs the rule's number and raises a notice. Rejects
   * with the signal's reason once the signal aborts, and signs nothing.
   */
  authorize(
    request: AuthorizeRequest,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<AuthorizationSignature, "refused">>;
}
