import { parseEvmAddress } from "@binference/chain-evm";
import { BinferenceError } from "@binference/core";
import type { Ceiling } from "../ceiling/ceiling.js";
import type { CallOptions, PrivyApi } from "../privy/privy-api.js";
import type { PrivyId } from "../privy/privy-records.js";
import type { PrivyWallet } from "../signing/privy-owner-signer.js";

/** A new agent wallet: the quorums of the owner and agent keys, and the wallet's ceiling. */
export interface AgentWalletRequest {
  /** The key quorum of the owner key, made with `createKeyQuorum`. */
  readonly ownerQuorum: PrivyId;
  /** The key quorum of the agent key, made with `createKeyQuorum`. */
  readonly signerQuorum: PrivyId;
  readonly ceiling: Ceiling;
}

/**
 * Makes an agent wallet on Privy (spec 5, section 2, step 4): the ceiling as a policy the owner
 * quorum owns, then the wallet, owned by the owner quorum, with the ceiling as its policy and the
 * agent quorum as its one added signer, bound to the ceiling too. Privy's create calls take no
 * authorization signature, so the owner key's private half is not needed here.
 */
export async function createAgentWallet(
  api: PrivyApi,
  request: AgentWalletRequest,
  options: CallOptions,
): Promise<PrivyWallet> {
  const policy = await api.createPolicy(
    { ceiling: request.ceiling, owner: request.ownerQuorum },
    options,
  );
  const wallet = await api.createWallet(
    { owner: request.ownerQuorum, signer: request.signerQuorum, policy: policy.id },
    options,
  );
  const address = parseEvmAddress(wallet.address);
  if (!address.ok) {
    throw new BinferenceError({
      code: "custody.privy_malformed",
      message: "Privy answered a wallet whose address is no EVM address.",
    });
  }
  return { id: wallet.id, address: address.value, chains: request.ceiling.chains };
}
