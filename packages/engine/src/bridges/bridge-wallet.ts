import type { WalletRole } from "@binference/chain";
import { err, type Id, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { WalletRecord } from "../install/install-record.js";
import { defaultWalletIn, roleWalletIn } from "../install/role-wallet.js";
import type { BridgeCandidate } from "./bridge-routes.js";

/** The wallet a bridge runs from, and the routes that wallet may take. */
export interface BridgeWallet {
  readonly wallet: Id<"wal">;
  readonly candidates: readonly BridgeCandidate[];
}

/** What picks a bridge's wallet: the install's wallets, the agent's, and the routes for it. */
export interface BridgeWalletAsk {
  readonly wallets: readonly WalletRecord[];
  /** The agent's live wallets, the one it uses by default first. */
  readonly owned: readonly Id<"wal">[];
  readonly agent: Id<"agt">;
  readonly named?: Id<"wal">;
  readonly candidates: readonly BridgeCandidate[];
}

// A request that names no wallet: a main wallet's route from the default wallet, else a bridge
// venue's route from the agent's bridge wallet (decision 0319).
function unnamed(
  ask: BridgeWalletAsk,
  split: {
    readonly main: readonly BridgeCandidate[];
    readonly bridged: readonly BridgeCandidate[];
  },
): Result<BridgeWallet, ProtocolErrorCode> {
  if (split.main.length > 0 || split.bridged.length === 0) {
    const fallback = defaultWalletIn(ask.wallets, ask.owned);
    return fallback === undefined
      ? err("wallet.not_found")
      : ok({ wallet: fallback, candidates: split.main });
  }
  const bridgeWallet = roleWalletIn(ask.wallets, ask.agent, "bridge");
  return bridgeWallet === undefined
    ? err("intent.bridge_wallet_missing")
    : ok({ wallet: bridgeWallet.id, candidates: split.bridged });
}

// The role of the wallet a request names: `extra` for a live launch or bridge wallet beyond the
// agent's wallet of that role, which runs nothing (decision 0218).
function namedRole(
  ask: BridgeWalletAsk & { readonly named: Id<"wal"> },
): WalletRole | "extra" | undefined {
  const { wallets, agent } = ask;
  const record = wallets.find(
    (wallet) =>
      wallet.id === ask.named && wallet.agentId === agent && wallet.archivedAtMs === undefined,
  );
  if (record?.role === undefined) {
    return undefined;
  }
  return roleWalletIn(wallets, agent, record.role)?.id === ask.named ? record.role : "extra";
}

// A request that names a wallet: the agent's bridge wallet takes only bridge venues' routes, any
// other wallet only a main wallet's, and an extra launch or bridge wallet nothing (decision 0319).
function named(
  ask: BridgeWalletAsk & { readonly named: Id<"wal"> },
  split: {
    readonly main: readonly BridgeCandidate[];
    readonly bridged: readonly BridgeCandidate[];
  },
): Result<BridgeWallet, ProtocolErrorCode> {
  const role = namedRole(ask);
  if (role === "extra") {
    return err("intent.extra_wallet");
  }
  if (role === "bridge") {
    return split.bridged.length > 0
      ? ok({ wallet: ask.named, candidates: split.bridged })
      : err("intent.bridge_wallet_only");
  }
  if (split.main.length === 0 && split.bridged.length > 0) {
    return err("intent.bridge_wallet_only");
  }
  return ask.owned.includes(ask.named)
    ? ok({ wallet: ask.named, candidates: split.main })
    : err("wallet.not_found");
}

/**
 * The wallet a bridge runs from (decisions 0307 and 0319). With no wallet named, the default
 * wallet takes a main wallet's route, else the agent's bridge wallet a bridge venue's route, else
 * `intent.bridge_wallet_missing`. The agent's bridge wallet, named, takes only bridge venues'
 * routes, and is `intent.bridge_wallet_only` where none serves; any other wallet named is
 * `intent.bridge_wallet_only` where only bridge venues serve, an extra launch or bridge wallet
 * `intent.extra_wallet`, and a wallet that is not the agent's `wallet.not_found`.
 */
export function bridgeWalletOf(ask: BridgeWalletAsk): Result<BridgeWallet, ProtocolErrorCode> {
  const split = {
    main: ask.candidates.filter((candidate) => !candidate.isBridgeWallets),
    bridged: ask.candidates.filter((candidate) => candidate.isBridgeWallets),
  };
  return ask.named === undefined ? unnamed(ask, split) : named({ ...ask, named: ask.named }, split);
}
