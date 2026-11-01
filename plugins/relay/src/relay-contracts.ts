import {
  type AccountRef,
  accountRefParts,
  BinferenceError,
  type ChainRef,
  type JsonValue,
  type VenueCall,
  type VenueContracts,
} from "@binference/plugin-sdk";
import { parseEvmAddress } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";
import { depositErc20Json } from "./deposit/deposit-call.js";

/** Relay's depository on the source chain: every deposit goes to it, and it is the one spender. */
const depositoryName = "depository";

// One deposit on the depository, its depositor pinned to the wallet, a bridge wallet's alone.
function depositCall(abi: JsonValue): VenueCall {
  return { contract: depositoryName, abi, walletInputs: ["depositor"], onlyWallet: "bridge" };
}

/**
 * What the bridge declares on a source chain (decision 0303): the depository's token deposit, its
 * depositor pinned to the wallet and a bridge wallet's alone, and the depository as a spender only
 * a bridge wallet approves. No other call: no route leaves as a coin, so no coin deposit.
 */
export function relayContractsOn(chain: ChainRef): VenueContracts {
  return {
    chain,
    names: [depositoryName],
    calls: [depositCall(depositErc20Json)],
    onlyWalletSpenders: { bridge: [depositoryName] },
  };
}

/** The EVM address of an account the bridge deposits from or through, in checksum form. */
export function evmAddressOf(account: AccountRef): Address {
  const parsed = parseEvmAddress(accountRefParts(account).address);
  if (parsed.ok) {
    return parsed.value;
  }
  throw new BinferenceError({
    code: "relay.not_evm",
    message: "Relay's depository on this chain takes EVM accounts only.",
  });
}

/** The depository's address from the request the host gave. */
export function depositoryOf(contracts: Readonly<Record<string, AccountRef>>): AccountRef {
  const depository = contracts[depositoryName];
  if (depository !== undefined) {
    return depository;
  }
  throw new BinferenceError({
    code: "relay.no_contract",
    message: "The host gave no depository; the bridge declares it on every chain it leaves from.",
  });
}
