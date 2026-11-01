import { type ChainDefinition, createFamilyRegistry, type FamilyRegistry } from "@binference/chain";
import { createEvmAddressCodec } from "@binference/chain-evm";
import { createSolanaAddressCodec } from "@binference/chain-solana";
import { arbitrum, baseMainnet, ethereum, robinhood, solana } from "@binference/chains";
import { ruleChainIds } from "@binference/custody-privy";
import type { CeilingAddressParts } from "./ceiling-addresses.js";

// The chains a bridge delivers to from the chains this binference serves (decision 0297), where
// the address book may save an address besides the wallets' chains.
function selfHostedDestinations(): readonly ChainDefinition[] {
  return [ethereum, baseMainnet, arbitrum, robinhood, solana];
}

// The address codec of each chain family this binference reads (decision 0298).
function selfHostedFamilies(): FamilyRegistry {
  return createFamilyRegistry([createEvmAddressCodec(), createSolanaAddressCodec()]);
}

/**
 * How the engine's accounts become each ceiling's addresses (decision 0313): through each family's
 * codec, listed for the ids the rules bind on the chains given and on each chain a bridge delivers
 * to.
 */
export function selfHostedCeilingAddresses(
  chains: readonly ChainDefinition[],
): CeilingAddressParts {
  return {
    families: selfHostedFamilies(),
    chainIdsOf: ruleChainIds([...chains, ...selfHostedDestinations()]),
  };
}
