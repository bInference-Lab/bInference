import {
  type AccountRef,
  accountRefParts,
  BinferenceError,
  type QuoteRequest,
} from "@binference/plugin-sdk";
import { parseEvmAddress } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";

/** OKX's DEX router: every trade call goes to it. */
export const routerName = "dex-router";

/**
 * OKX's TokenApprove: the spender of every token input. The router pulls the input through
 * OKX's TokenApproveProxy, which only TokenApprove obeys.
 */
export const approverName = "token-approve";

/** The EVM address of an account the venue trades from or calls, in checksum form. */
export function evmAddressOf(account: AccountRef): Address {
  const parsed = parseEvmAddress(accountRefParts(account).address);
  if (parsed.ok) {
    return parsed.value;
  }
  throw new BinferenceError({
    code: "okx.not_evm",
    message: "OKX's router trades only from and with EVM accounts.",
  });
}

/** The address of one of the venue's registry contracts, from the request the host gave. */
export function registryAddressOf(request: QuoteRequest, name: string): Address {
  const contract = request.contracts[name];
  if (contract !== undefined) {
    return evmAddressOf(contract);
  }
  throw new BinferenceError({
    code: "okx.no_contract",
    message: `The host gave no ${name}; the venue declares it on every chain it trades on.`,
    details: { name },
  });
}
