import { BinferenceError, err, ok, type Result, type Secret } from "@binference/core";
import {
  buildCeiling,
  type Ceiling,
  type CeilingProblem,
  createAgentWallet,
  createDayCaps,
  createPrivyApi,
  type PrivyApi,
  type PrivyId,
  type PrivyPolicy,
  type PrivyWallet,
} from "@binference/custody-privy";
import type { CeilingDraft } from "./ceiling-request.js";
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
  readonly draft: CeilingDraft;
}

// The labels Privy's dashboard shows for the two key quorums.
const ownerQuorumName = "binference owner key";
/** The label Privy's dashboard shows for the key quorum of an agent key. */
export const agentQuorumName = "binference agent key";

/**
 * The policy Privy holds for a wallet it made and read back a moment ago: its ceiling as Privy
 * reports it now, which the install store mirrors. A wallet whose policy Privy no longer gives is
 * a fault.
 */
export async function walletPolicyOf(
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
 * The ceiling a draft gives once Privy holds its caps' aggregations, made now and owned by the
 * owner key's quorum (decision 0149); every later wallet of the install names the same ones.
 */
async function ceilingWithCaps(
  api: PrivyApi,
  draft: CeilingDraft,
  input: { readonly owner: PrivyId; readonly signal: AbortSignal },
): Promise<Result<Ceiling, CeilingProblem>> {
  const caps = await createDayCaps(api, { plans: draft.capPlans, owner: input.owner }, input);
  if (!caps.ok) {
    return caps;
  }
  const chains = draft.chains.flatMap((plan, index) => {
    const held = caps.value[index];
    return held === undefined ? [] : [{ ...plan, caps: held }];
  });
  if (chains.length !== draft.chains.length) {
    return err("too_many_caps");
  }
  return buildCeiling({ chains, rescue: draft.rescue, saved: draft.saved });
}

/**
 * Makes the first wallet on Privy (keys spec, section 2, steps 4 and 5): a key quorum for the
 * owner key and one for the agent key, the aggregations of the ceiling's 24-hour caps and the
 * ceiling as a policy, both owned by the owner quorum, and the wallet, owned by the owner quorum with the agent quorum as its signer bound to the ceiling.
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
  const ceiling = await ceilingWithCaps(api, inputs.draft, { owner: owner.id, signal });
  if (!ceiling.ok) {
    return refused("init.bad_ceiling", "refused.badCeiling", { problem: ceiling.error });
  }
  const expected = {
    ownerKey: inputs.ownerKey,
    agentKey: inputs.agentKey,
    ceiling: ceiling.value,
  };
  const made = await createAgentWallet(
    api,
    { ownerQuorum: owner.id, signerQuorum: agent.id, expected },
    call,
  );
  if (!made.ok) {
    return refused("init.read_back_failed", "refused.readBack", { problem: made.error });
  }
  const policy = await walletPolicyOf(api, made.value, signal);
  context.prompter.say(words("wallet.made", { address: made.value.address }));
  return ok({ wallet: made.value, ownerQuorum: owner.id, agentQuorum: agent.id, policy });
}
