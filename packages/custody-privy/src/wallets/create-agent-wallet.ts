import type { Result } from "@binference/core";
import type { CallOptions, PrivyApi } from "../privy/privy-api.js";
import type { PrivyId } from "../privy/privy-records.js";
import type { PrivyWallet } from "../signing/privy-owner-signer.js";
import { type ReadBackProblem, readBackWallet, type WalletExpectation } from "./read-back.js";

/** A new agent wallet: the quorums of the owner and agent keys, and what the wallet must be. */
export interface AgentWalletRequest {
  /** The key quorum of the owner key, made with `createKeyQuorum`. */
  readonly ownerQuorum: PrivyId;
  /** The key quorum of the agent key, made with `createKeyQuorum`. */
  readonly signerQuorum: PrivyId;
  readonly expected: WalletExpectation;
}

/**
 * Makes an agent wallet on Privy (spec 5, section 2, step 4): the ceiling as a policy the owner
 * quorum owns, then the wallet, owned by the owner quorum, with the ceiling as its policy and the
 * agent quorum as its one added signer, bound to the ceiling too. Then it reads the wallet back
 * and answers it only when the owner, the signer and the policy are exactly what was asked.
 * Privy's create calls take no authorization signature, so the owner key's private half is not
 * needed here.
 */
export async function createAgentWallet(
  api: PrivyApi,
  request: AgentWalletRequest,
  options: CallOptions,
): Promise<Result<PrivyWallet, ReadBackProblem>> {
  const policy = await api.createPolicy(
    { ceiling: request.expected.ceiling, owner: request.ownerQuorum },
    options,
  );
  const wallet = await api.createWallet(
    { owner: request.ownerQuorum, signer: request.signerQuorum, policy: policy.id },
    options,
  );
  return readBackWallet(api, { wallet: wallet.id, expected: request.expected }, options);
}
