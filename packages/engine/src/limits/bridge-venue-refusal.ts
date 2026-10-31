import type { Id } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { WalletRecord } from "../install/install-record.js";
import { roleWalletIn } from "../install/role-wallet.js";
import type { VenueHost } from "../venues/venue-host.js";
import { callsOutsideCeiling } from "./limit-ceiling.js";

/**
 * Why a live agent cannot use the venues among `venues` that only a bridge wallet uses, such as
 * Relay (decision 0307): it has no live bridge wallet (`limit.needs_bridge_wallet`), or that
 * wallet's ceiling, as last read back from custody, lacks one of their calls
 * (`limit.over_ceiling`), which only the owner key adds. `undefined` when none of the venues is a
 * bridge wallet's alone, or the bridge wallet allows every call they mark.
 */
export function bridgeVenueRefusal(
  host: Pick<VenueHost, "bridgesOnly" | "roleWalletCalls">,
  check: {
    readonly venues: readonly string[];
    readonly wallets: readonly WalletRecord[];
    readonly agent: Id<"agt">;
  },
): ProtocolErrorCode | undefined {
  const bridged = check.venues.filter((venue) => host.bridgesOnly(venue));
  if (bridged.length === 0) {
    return undefined;
  }
  const bridgeWallet = roleWalletIn(check.wallets, check.agent, "bridge");
  if (bridgeWallet === undefined) {
    return "limit.needs_bridge_wallet";
  }
  const calls = host.roleWalletCalls("bridge", bridged);
  return callsOutsideCeiling(bridgeWallet, calls).length > 0 ? "limit.over_ceiling" : undefined;
}
