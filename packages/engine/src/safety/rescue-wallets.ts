import type { RegisteredChain, Signer } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import type { WalletRecord } from "../install/install-record.js";
import { policyLimitsOf } from "../money-path/policy-facts-of.js";
import type { AgentStore, PositionStore, WalletFactsSource } from "../ports.js";
import { heldAssetsOf } from "../positions/held-assets.js";
import type { RescueWallet } from "./rescue-moves.js";

/** What a rescue reads about the install's wallets: custody, their agents, positions, balances. */
export interface RescueWalletsParts {
  readonly custody: Signer;
  readonly agents: AgentStore;
  readonly positions: PositionStore;
  /** The wallets' live facts; never paper balances. */
  readonly wallets: WalletFactsSource;
}

async function gasReserveOf(
  parts: RescueWalletsParts,
  wallet: WalletRecord,
  call: { readonly chain: RegisteredChain; readonly signal: AbortSignal },
): Promise<bigint> {
  const settings = await parts.agents.get(wallet.agentId, { signal: call.signal });
  if (settings === undefined) {
    throw new BinferenceError({
      code: "engine.agent_missing",
      message: `The agent of wallet ${wallet.id} is not stored.`,
      details: { wallet: wallet.id },
    });
  }
  return policyLimitsOf(settings.limits, call.chain.ref).gasReserveBase;
}

async function rescueWallet(
  parts: RescueWalletsParts,
  wallet: WalletRecord,
  call: { readonly chain: RegisteredChain; readonly signal: AbortSignal },
): Promise<RescueWallet | undefined> {
  const { chain, signal } = call;
  const account = await parts.custody.account(wallet.id, chain.ref, { signal });
  if (!account.ok) {
    return undefined;
  }
  const assets = await heldAssetsOf(parts.positions, wallet.id, call);
  const holdings = await parts.wallets.balances({ account: account.value, assets }, { signal });
  const gasReserveBase = await gasReserveOf(parts, wallet, call);
  const { id, agentId } = wallet;
  return { wallet: id, agentId, account: account.value, holdings, gasReserveBase };
}

/**
 * Every wallet of the install a rescue empties on `chain`, oldest first: each wallet that is not
 * archived, of the chain's family, that custody holds an account for there, whatever its agent's
 * mode or freeze. Each comes with what it holds now of the chain's coin, of every registry token
 * and of every asset it holds a live position in, and with its agent's gas reserve on the chain.
 * A token known to none of these is not looked for.
 */
export async function rescueWallets(
  parts: RescueWalletsParts,
  call: {
    readonly wallets: readonly WalletRecord[];
    readonly chain: RegisteredChain;
    readonly signal: AbortSignal;
  },
): Promise<readonly RescueWallet[]> {
  const { chain, signal } = call;
  const live = call.wallets.filter(
    (wallet) => wallet.archivedAtMs === undefined && wallet.family === chain.definition.family,
  );
  const found = await Promise.all(
    live.map(async (wallet) => rescueWallet(parts, wallet, { chain, signal })),
  );
  return found.filter((wallet) => wallet !== undefined);
}
