import { err, ok } from "@binference/core";
import type { Clock } from "@binference/core";
import type { EngineHandler } from "../operations/engine-call.js";
import type { CredentialEntry } from "./credential-record.js";
import type { CredentialStore } from "./ports.js";

/** The handlers that read and change the stored credentials (protocol spec, section 7.7). */
export interface CredentialStoreHandlers {
  readonly "credential/list": EngineHandler<"credential/list">;
  readonly "credential/delete": EngineHandler<"credential/delete">;
}

function viewOf(entry: CredentialEntry) {
  return { name: entry.name, allowedHosts: entry.allowedHosts, updatedAt: entry.updatedAtMs };
}

/**
 * Creates the stored credentials' handlers (decision 0388): `credential/list` reads every name and
 * its hosts, never a value; `credential/delete` removes one with its value. Without a store, the
 * list is empty and a removal is `credential.unavailable`.
 */
export function createCredentialStoreHandlers(options: {
  readonly credentials?: CredentialStore;
  readonly clock: Clock;
}): CredentialStoreHandlers {
  const { credentials, clock } = options;
  return {
    async "credential/list"(call) {
      const items = credentials === undefined ? [] : await credentials.list(call);
      return ok({ items: items.map(viewOf) });
    },
    async "credential/delete"(call) {
      if (credentials === undefined) {
        return err("credential.unavailable");
      }
      const { name } = call.args;
      const removed = await credentials.remove(name, { atMs: clock.now(), signal: call.signal });
      return removed ? ok({ name }) : err("credential.not_found");
    },
  };
}
