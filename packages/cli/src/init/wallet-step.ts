import { BinferenceError, ok, type Secret } from "@binference/core";
import {
  type Ceiling,
  createAgentWallet,
  createPrivyApi,
  type PrivyApi,
  type PrivyId,
  type PrivyPolicy,
  type PrivyWallet,
} from "@binference/custody-privy";
import { type InitContext, type InitStep, refused } from "./init-context.js";

/** The first wallet as Privy holds it, read back, with what the store mirrors. */
export interface FirstWallet {
  readonly wallet: PrivyWallet;
  readonly ownerQuorum: PrivyId;
  readonly agentQuorum: PrivyId;
  /** The wallet's ceiling as Privy reports it now. */
  readonly policy: PrivyPolicy;
}

/** What the first wallet is made from. */
export interface WalletInputs {
  readonly appId: string;
  readonly appSecret: Secret;
  readonly ownerKey: string;
  readonly agentKey: string;
  readonly ceiling: Ceiling;
}

// The labels Privy's dashboard shows for the two key quorums.
const ownerQuorumName = "binference owner key";
const agentQuorumName = "binference agent key";

async function policyOf(
  api: PrivyApi,
  wallet: PrivyWallet,
  signal: AbortSignal,
): Promise<PrivyPolicy> {
  const record = await api.wallet(wallet.id, { signal });
  const policyId = record.ok ? record.value.policyIds[0] : undefined;
  const policy = policyId === undefined ? undefined : await api.policy(policyId, { signal });
  if (policy?.ok !== true) {
    throw new BinferenceError({
      code: "custody.privy_malformed",
      message: "Privy gave the new wallet's policy back, then no longer did.",
      details: { path: "/v1/policies" },
    });
  }
  return policy.value;
}

/**
 * Makes the first wallet on Privy (keys spec, section 2, steps 4 and 5): a key quorum for the
 * owner key and one for the agent key, the ceiling as a policy the owner quorum owns, and the
 * wallet, owned by the owner quorum with the agent quorum as its signer bound to the ceiling.
 * Then it reads the wallet back and refuses to go on unless the owner, the signer and the policy
 * are exactly what it asked for.
 */
export async function makeFirstWallet(
  context: InitContext,
  inputs: WalletInputs,
): Promise<InitStep<FirstWallet>> {
  const { host, signal, words } = context;
  const api = createPrivyApi({
    http: host.http,
    clock: host.clock,
    appId: inputs.appId,
    appSecret: inputs.appSecret,
  });
  context.prompter.say(words("wallet.making"));
  const call = { signal };
  const owner = await api.createKeyQuorum(
    { publicKey: inputs.ownerKey, displayName: ownerQuorumName },
    call,
  );
  const agent = await api.createKeyQuorum(
    { publicKey: inputs.agentKey, displayName: agentQuorumName },
    call,
  );
  const expected = {
    ownerKey: inputs.ownerKey,
    agentKey: inputs.agentKey,
    ceiling: inputs.ceiling,
  };
  const made = await createAgentWallet(
    api,
    { ownerQuorum: owner.id, signerQuorum: agent.id, expected },
    call,
  );
  if (!made.ok) {
    return refused("init.read_back_failed", "refused.readBack", { problem: made.error });
  }
  const policy = await policyOf(api, made.value, signal);
  context.prompter.say(words("wallet.made", { address: made.value.address }));
  return ok({ wallet: made.value, ownerQuorum: owner.id, agentQuorum: agent.id, policy });
}
