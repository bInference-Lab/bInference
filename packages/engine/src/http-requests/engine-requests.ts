import type { Http, Logger } from "@binference/core";
import type { CredentialStore } from "../credentials/ports.js";

/**
 * The agent's API calls as the composition root gives them (decision 0411): the outbound HTTP
 * they go by, the owner's proxy route in force; the one read of a stored credential's value,
 * which the composition root fills from `CredentialStore.reveal`; the hosts of binference's own
 * that a call never reaches, such as `remote.publicUrl`'s, read at each call; and the log each
 * call's line goes to. Without them `http/request` is `request.unavailable`.
 */
export interface EngineRequests {
  readonly http: Http;
  readonly reveal: CredentialStore["reveal"];
  readonly ownHosts: () => readonly string[];
  readonly logger?: Logger;
}
