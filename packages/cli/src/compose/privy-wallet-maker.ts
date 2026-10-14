import { accountRefParts, accountRefSchema } from "@binference/chain";
import {
  BinferenceError,
  type Clock,
  err,
  type Id,
  jsonValueSchema,
  ok,
  type Result,
  type Secret,
} from "@binference/core";
import {
  buildCeiling,
  type CeilingChain,
  type ChainCaps,
  createAgentWallet,
  createDayCaps,
  type HeldCaps,
  isPrivyId,
  type PrivyApi,
  type PrivyId,
  type PrivyPolicy,
  type PrivyWallet,
} from "@binference/custody-privy";
import type {
  CustodyRecord,
  MadeWallet,
  WalletMaker,
  WalletRefusal,
  WalletRequest,
} from "@binference/engine/install";
import { parseOwnerKeyCode } from "@binference/signer";
import type { CeilingDraft } from "../init/ceiling-request.js";
import { walletPolicyOf } from "../init/wallet-step.js";

/** What the Privy wallet maker reaches Privy with, and what each new ceiling is built from. */
export interface PrivyWalletMakerOptions {
  readonly api: PrivyApi;
  readonly clock: Clock;
  /** The install's custody on Privy; undefined before `binference init`. */
  readonly custody: (signal: AbortSignal) => Promise<CustodyRecord | undefined>;
  /**
   * The ceiling of each enabled chain, first chain first, for the venues named: their declared
   * calls and spenders, the per-transaction cap of `defaults.ceiling.perTxBnb`, and the plan of
   * each chain's 24-hour caps; for a launch wallet, with the launch rules of every launchpad the
   * install runs (decision 0217).
   */
  readonly ceilingChains: (
    wallet: Pick<WalletRequest, "venues" | "isLaunch">,
  ) => Pick<CeilingDraft, "chains" | "capPlans">;
  /** The 24-hour caps the install's live ceilings name now, which a new ceiling names too. */
  readonly heldCaps: (signal: AbortSignal) => Promise<readonly HeldCaps[]>;
  /** Signs for each wallet made from then on, under the engine's id. */
  readonly onMade: (wallet: Id<"wal">, made: PrivyWallet) => void;
}

/** The install's key quorums, when custody is set up and the code is the install's owner key. */
interface Quorums {
  readonly custody: CustodyRecord;
  readonly owner: PrivyId;
  readonly agent: PrivyId;
}

async function quorumsOf(
  options: PrivyWalletMakerOptions,
  ownerKey: Secret,
  signal: AbortSignal,
): Promise<Result<Quorums, WalletRefusal>> {
  signal.throwIfAborted();
  const pair = parseOwnerKeyCode(ownerKey);
  const custody = await options.custody(signal);
  if (!pair.ok || custody === undefined || pair.value.publicKey !== custody.ownerKeyPublic) {
    return err("bad_owner_key");
  }
  const { ownerQuorumId: owner, agentQuorumId: agent } = custody;
  if (!isPrivyId(owner) || !isPrivyId(agent)) {
    throw new BinferenceError({
      code: "custody.privy_malformed",
      message: "The install keeps a key quorum id that is not one of Privy's.",
    });
  }
  return ok({ custody, owner, agent });
}

// A fault: the config gives no ceiling a wallet can have, whatever the request.
function unbuilt(problem: string): BinferenceError {
  return new BinferenceError({
    code: "cli.ceiling_unbuilt",
    message: "The config gives no ceiling a wallet can have.",
    details: { problem },
  });
}

function ceilingOf(chains: readonly CeilingChain[], request: WalletRequest) {
  const addresses = request.recipients.map((account) => accountRefParts(account).address);
  const [rescue = "", ...saved] = addresses;
  const ceiling = buildCeiling({ chains, rescue, saved });
  if (ceiling.ok) {
    return ok(ceiling.value);
  }
  const { error } = ceiling;
  if (error === "malformed_address" || error === "too_many_addresses") {
    return err("bad_recipients" as const);
  }
  throw unbuilt(error);
}

function madeOf(
  options: PrivyWalletMakerOptions,
  made: { readonly wallet: PrivyWallet; readonly policy: PrivyPolicy; readonly agent: PrivyId },
  first: CeilingChain,
): MadeWallet {
  const { wallet, policy, agent } = made;
  return {
    record: {
      family: "evm",
      custody: "privy",
      custodyWalletId: wallet.id,
      policyId: policy.id,
      signerId: agent,
      address: wallet.address,
      ceiling: {
        policyId: policy.id,
        policy: jsonValueSchema.parse(policy),
        perTxNativeBase: first.perTxNativeCapBase,
        readAtMs: options.clock.now(),
      },
    },
    account: accountRefSchema.parse(`${first.chain.ref}:${wallet.address}`),
  };
}

// Each chain's caps: those the install's ceilings name already, since Privy keeps at most 10
// aggregations for an app and sums each over every wallet, and new ones for a chain none names.
async function capsOf(
  options: PrivyWalletMakerOptions,
  draft: Pick<CeilingDraft, "chains" | "capPlans">,
  input: { readonly owner: PrivyId; readonly signal: AbortSignal },
): Promise<readonly CeilingChain[]> {
  const held = await options.heldCaps(input.signal);
  const heldOn = (plan: CeilingDraft["chains"][number]) =>
    held.find((item) => item.chainId === String(plan.chain.chainId))?.caps;
  const missing = draft.capPlans.filter((_, index) => {
    const plan = draft.chains[index];
    return plan === undefined || heldOn(plan) === undefined;
  });
  const made = await createDayCaps(options.api, { plans: missing, owner: input.owner }, input);
  if (!made.ok) {
    throw unbuilt(made.error);
  }
  const fresh = [...made.value];
  return draft.chains.map((plan) => {
    const caps: ChainCaps | undefined = heldOn(plan) ?? fresh.shift();
    if (caps === undefined) {
      throw unbuilt("no_caps");
    }
    return { ...plan, caps };
  });
}

async function make(
  options: PrivyWalletMakerOptions,
  request: WalletRequest,
  signal: AbortSignal,
): Promise<Result<MadeWallet, WalletRefusal>> {
  const quorums = await quorumsOf(options, request.ownerKey, signal);
  if (!quorums.ok) {
    return quorums;
  }
  const draft = options.ceilingChains(request);
  const chains = await capsOf(options, draft, { owner: quorums.value.owner, signal });
  const [first] = chains;
  const ceiling = ceilingOf(chains, request);
  if (!ceiling.ok) {
    return ceiling;
  }
  if (first === undefined) {
    throw unbuilt("no_chain");
  }
  const { custody, owner, agent } = quorums.value;
  const { ownerKeyPublic: ownerKey, agentKeyPublic: agentKey } = custody;
  const expected = { ownerKey, agentKey, ceiling: ceiling.value };
  const asked = { ownerQuorum: owner, signerQuorum: agent, expected };
  const made = await createAgentWallet(options.api, asked, { signal });
  if (!made.ok) {
    throw new BinferenceError({
      code: "custody.read_back_failed",
      message: "Privy read the new wallet back otherwise than it was asked to make it.",
      details: { problem: made.error },
    });
  }
  const policy = await walletPolicyOf(options.api, made.value, signal);
  options.onMade(request.wallet, request.isLaunch ? { ...made.value, role: "launch" } : made.value);
  return ok(madeOf(options, { wallet: made.value, policy, agent }, first));
}

/**
 * The {@link WalletMaker} on the owner's Privy app (spec 5, section 2; decision 0130): it reads the
 * owner key from its code and checks it is the key that owns the install, though Privy asks no
 * signature to make a wallet, then makes the wallet as `binference init` makes the first one:
 * owned by the owner key's quorum, with the agent key's quorum as its signer, under a new ceiling
 * that names the 24-hour caps the install's ceilings name, made first when none does.
 * It reads the wallet back and refuses to go on unless it is exactly what it asked for. The key
 * serves this request alone and is kept nowhere.
 */
export function createPrivyWalletMaker(options: PrivyWalletMakerOptions): WalletMaker {
  return { make: async (request, { signal }) => make(options, request, signal) };
}
