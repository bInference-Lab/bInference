import { BinferenceError } from "@binference/core";
import type { CallsRefusal as PrivyCallsRefusal } from "@binference/custody-privy";
import type { CallsRefusal } from "@binference/engine/install";

/**
 * What the engine hears when custody refuses a change of calls: the owner key's refusal, an
 * address its bridge rules cannot list, no such ceiling, a ceiling past what Privy keeps, a bridge
 * deposit no ceiling holds, or a bridge route with no cap on its token. Any other refusal means
 * binference built a ceiling Privy cannot take, a fault.
 */
export function callsRefusalOf(error: PrivyCallsRefusal): CallsRefusal {
  if (error === "refused") {
    return "bad_owner_key";
  }
  if (error === "malformed_address" || error === "too_many_addresses") {
    return "bad_recipients";
  }
  if (
    error === "not_found" ||
    error === "too_large" ||
    error === "bad_bridge" ||
    error === "uncapped_token"
  ) {
    return error;
  }
  // The registry's contracts and a cap the engine checked are a ceiling Privy takes.
  throw new BinferenceError({
    code: "cli.ceiling_unbuilt",
    message: "The venues give no contract calls a ceiling can have.",
    details: { problem: error },
  });
}
