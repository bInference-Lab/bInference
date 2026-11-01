import {
  type AccountRef,
  accountRefSchema,
  type ChainRef,
  chainRefSchema,
} from "@binference/chain";
import { jsonValueSchema } from "@binference/core";
import type { CeilingHeld, ChainAddresses, PrivyPolicy } from "@binference/custody-privy";
import type { CeilingRead } from "@binference/engine/install";
import type { CapAssets } from "../init/ceiling-request.js";
import { dayCapViewsOf } from "./day-cap-views.js";

// Each address on each chain given, as custody's accounts.
function accountsOn(
  chains: readonly ChainRef[],
  addresses: readonly string[],
): readonly AccountRef[] {
  return chains.flatMap((chain) =>
    addresses.map((address) => accountRefSchema.parse(`${chain}:${address}`)),
  );
}

// The chain an EIP-155 id the rules name stands for.
function refOf(chainId: string): ChainRef {
  return chainRefSchema.parse(`eip155:${chainId}`);
}

/**
 * A ceiling as the engine reads it, from its policy as Privy holds it and its rules read: each
 * contract on every chain it enables, and each send recipient on the chain whose send rule lists
 * it (decision 0313).
 */
export function privyCeilingRead(
  held: { readonly policy: PrivyPolicy; readonly rules: CeilingHeld },
  capAssetsOn: (chain: ChainRef) => CapAssets | undefined,
): CeilingRead {
  const { rules, policy } = held;
  const chains = rules.chainIds.map(refOf);
  const sends = ({ chainId, addresses }: ChainAddresses) => accountsOn([refOf(chainId)], addresses);
  return {
    chains,
    contracts: accountsOn(chains, rules.contracts),
    perTxNativeBase: rules.perTxNativeCapBase,
    recipients: rules.recipients.flatMap(sends),
    dayCaps: dayCapViewsOf(rules.caps, capAssetsOn),
    launchCalls: rules.launchCalls,
    functions: rules.functions,
    policy: jsonValueSchema.parse(policy),
  };
}
