import type { AssetRef, PriceFeedDefinition, RegisteredChain } from "@binference/chain";
import { erc20AssetRef, evmChainOf, parseEvmAddress } from "@binference/chain-evm";

/**
 * The chain's wrapped coin, such as WBNB on BSC: the first registry token its coin's price feed
 * names as wrapping it one for one. `undefined` when no feed names one the registry lists.
 */
export function wrappedCoinOf(
  chain: RegisteredChain,
  feeds: readonly PriceFeedDefinition[],
): AssetRef | undefined {
  const evm = evmChainOf(chain.definition);
  const symbol = feeds.find((feed) => feed.symbol === evm.nativeSymbol)?.wrappers?.[0];
  const token = chain.definition.tokens.find((item) => item.symbol === symbol);
  const address = token === undefined ? undefined : parseEvmAddress(token.address);
  return address?.ok === true ? erc20AssetRef(evm, address.value) : undefined;
}
