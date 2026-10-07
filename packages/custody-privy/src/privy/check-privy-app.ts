import { err, ok, type Result } from "@binference/core";
import type { PrivyClient } from "@privy-io/node";
import type { CallOptions } from "./privy-api.js";
import { callPrivy, privyFault, statusFault } from "./privy-call.js";
import { type PrivyApiOptions, privySettings } from "./privy-client.js";
import { readWalletPage } from "./privy-wire.schema.js";

// The statuses that mean Privy did not take the app id and secret: Basic auth that does not match
// an app, or an app the secret does not open.
const credentialStatuses: ReadonlySet<number> = new Set([401, 403, 404]);

// One page of one Ethereum wallet: the REST setup page's own example call, which needs both the
// app id and the app secret and changes nothing.
const listCall = {
  kind: "read" as const,
  path: "/v1/wallets",
  run: async (client: PrivyClient) => client.wallets().list({ limit: 1, chain_type: "ethereum" }),
};

/**
 * Checks a Privy app's id and secret with one read: the first page of the app's Ethereum wallets,
 * at most one wallet, through Privy's official Node SDK. Answers `rejected` when Privy refuses the
 * credentials (401, 403 or 404). Any other failure throws as every Privy read does:
 * `custody.privy_busy` (429), `custody.privy_failed` (5xx), `custody.privy_refused`,
 * `custody.privy_unreachable` and `custody.privy_malformed`; the read ones are retryable, and
 * Privy's guide asks for an exponential backoff on 429. Rejects with the signal's reason once the
 * signal aborts. The secret never reaches a fault.
 */
export async function checkPrivyApp(
  options: PrivyApiOptions,
  call: CallOptions,
): Promise<Result<void, "rejected">> {
  const settings = privySettings(options);
  const outcome = await callPrivy(settings, listCall, call.signal);
  if (!outcome.ok) {
    if (credentialStatuses.has(outcome.status)) {
      return err("rejected");
    }
    throw statusFault(listCall, outcome);
  }
  if (!readWalletPage(outcome.value)) {
    throw privyFault("custody.privy_malformed", listCall);
  }
  return ok(undefined);
}
