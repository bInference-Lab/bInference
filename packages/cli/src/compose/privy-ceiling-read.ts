import {
  type AccountRef,
  accountRefSchema,
  type ChainRef,
  chainRefSchema,
} from "@binference/chain";
import { type JsonValue, jsonValueSchema } from "@binference/core";
import { type CeilingHeld, type ChainAddresses, readCeiling } from "@binference/custody-privy";
import type { CeilingRead } from "@binference/engine/install";
import { z } from "zod";
import type { CapAssets } from "../init/ceiling-request.js";
import { bridgedAccountsOf, type CeilingAddressParts } from "./ceiling-addresses.js";
import { dayCapViewsOf } from "./day-cap-views.js";

/** What a ceiling read is shown with: each chain's cap assets, and how its addresses read back. */
export interface CeilingReadParts {
  readonly capAssetsOn: (chain: ChainRef) => CapAssets | undefined;
  readonly addresses: CeilingAddressParts;
}

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
 * contract on every chain it enables, each send recipient on the chain whose send rule lists it,
 * and each account its bridge rules pay on the chain they reach (decision 0313).
 */
export function privyCeilingRead(
  held: { readonly policy: JsonValue; readonly rules: CeilingHeld },
  parts: CeilingReadParts,
): CeilingRead {
  const { rules, policy } = held;
  const chains = rules.chainIds.map(refOf);
  const sends = ({ chainId, addresses }: ChainAddresses) => accountsOn([refOf(chainId)], addresses);
  return {
    chains,
    contracts: accountsOn(chains, rules.contracts),
    perTxNativeBase: rules.perTxNativeCapBase,
    recipients: rules.recipients.flatMap(sends),
    bridged: bridgedAccountsOf(rules.bridges, parts.addresses),
    dayCaps: dayCapViewsOf(rules.caps, parts.capAssetsOn),
    launchCalls: rules.launchCalls,
    functions: rules.functions,
    ...(rules.ownCaps === undefined ? {} : { ownCaps: rules.ownCaps }),
    policy: jsonValueSchema.parse(policy),
  };
}

const storedPolicySchema = z.object({ rules: z.array(z.json()) });

/**
 * A wallet's stored copy of its Privy policy read as {@link privyCeilingRead} reads the policy,
 * with no call to Privy; `undefined` for a copy that holds no ceiling binference can read.
 */
export function readStoredPrivyCeiling(
  policy: JsonValue,
  parts: CeilingReadParts,
): CeilingRead | undefined {
  const stored = storedPolicySchema.safeParse(policy);
  const rules = stored.success ? readCeiling(stored.data.rules) : undefined;
  return rules === undefined ? undefined : privyCeilingRead({ policy, rules }, parts);
}
