import {
  type AccountRef,
  accountRefParts,
  BinferenceError,
  type ChainRef,
  type VenueContracts,
} from "@binference/plugin-sdk";
import { parseEvmAddress } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";
import { depositV3Json } from "./deposit/deposit-call.js";

/** Across's SpokePool on the source chain: every deposit goes to it, and it is the one spender. */
const spokePoolName = "spoke-pool";

/**
 * What the bridge declares on a source chain: the SpokePool, its `depositV3` with the inputs a
 * ceiling binds, and the SpokePool as the spender of an exact approval. No other call.
 */
export function acrossContractsOn(chain: ChainRef): VenueContracts {
  return {
    chain,
    names: [spokePoolName],
    calls: [
      {
        contract: spokePoolName,
        abi: depositV3Json,
        walletInputs: ["depositor"],
        bridge: {
          recipient: "recipient",
          destinationChain: "destinationChainId",
          tokenIn: "inputToken",
          tokenOut: "outputToken",
          minOut: "outputAmount",
          emptyInputs: ["message"],
        },
      },
    ],
    spenders: [spokePoolName],
  };
}

/** The EVM address of an account the bridge deposits from, to or through, in checksum form. */
export function evmAddressOf(account: AccountRef): Address {
  const parsed = parseEvmAddress(accountRefParts(account).address);
  if (parsed.ok) {
    return parsed.value;
  }
  throw new BinferenceError({
    code: "across.not_evm",
    message: "Across's SpokePool on this chain takes EVM accounts only.",
  });
}

/** The SpokePool's address from the request the host gave. */
export function spokePoolOf(contracts: Readonly<Record<string, AccountRef>>): AccountRef {
  const spokePool = contracts[spokePoolName];
  if (spokePool !== undefined) {
    return spokePool;
  }
  throw new BinferenceError({
    code: "across.no_contract",
    message: "The host gave no SpokePool; the bridge declares it on every chain it leaves from.",
  });
}
