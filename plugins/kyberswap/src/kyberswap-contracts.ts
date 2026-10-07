import {
  type AccountRef,
  accountRefParts,
  BinferenceError,
  type QuoteRequest,
} from "@binference/plugin-sdk";
import { parseEvmAddress } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";

/** KyberSwap's MetaAggregationRouterV2: every trade call goes to it. */
export const routerName = "meta-aggregation-router-v2";

/** KyberSwap's AggregationExecutorProxy: the router hands it the input and the executor data. */
export const executorName = "aggregation-executor-proxy";

/** The address of an EVM account, in checksum form. */
export function addressOf(account: AccountRef): Address {
  const address = parseEvmAddress(accountRefParts(account).address);
  if (!address.ok) {
    throw new BinferenceError({
      code: "kyberswap.not_evm",
      message: "KyberSwap trades only from and with EVM accounts.",
    });
  }
  return address.value;
}

/** One of the venue's registry contracts the host gave with a request, as an EVM address. */
export function contractOf(request: QuoteRequest, name: string): Address {
  const contract = request.contracts[name];
  if (contract === undefined) {
    throw new BinferenceError({
      code: "kyberswap.no_contract",
      message: `The request carries no ${name}; the venue declares it on every chain.`,
      details: { name },
    });
  }
  return addressOf(contract);
}
