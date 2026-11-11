import type { Http, Logger } from "@binference/core";
import type { CredentialStore } from "@binference/engine/chat";
import type { EngineRequests } from "@binference/engine/shell";
import type { BinferenceConfig } from "../config/schema/config.schema.js";

/** What the agent's API calls are built from on this machine. */
export interface RequestParts {
  /** The outbound HTTP, by the owner's proxy route in force (decision 0347). */
  readonly http: Http;
  /** The engine's stored credentials, whose `reveal` alone reads a value back. */
  readonly credentials: Pick<CredentialStore, "reveal">;
  /** The config as it is now, whose `remote.publicUrl` a call never reaches. */
  readonly config: () => BinferenceConfig;
  readonly logger: Logger;
}

function publicHostsOf(config: BinferenceConfig): readonly string[] {
  const url = config.remote.publicUrl;
  return url === undefined ? [] : [new URL(url).hostname];
}

/**
 * The agent's API calls on this machine (decision 0411): through the outbound HTTP the engine's
 * other requests take, each stored credential's value read by `CredentialStore.reveal` for the one
 * request that names it, never the host of `remote.publicUrl` as it is now, and one log line each
 * under `requests`.
 */
export function engineRequestsOf(parts: RequestParts): EngineRequests {
  const { http, credentials, config, logger } = parts;
  return {
    http,
    reveal: async (name, call) => credentials.reveal(name, call),
    ownHosts: () => publicHostsOf(config()),
    logger: logger.child("requests"),
  };
}
