import { err, type Id, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import { roleWalletIn } from "../install/role-wallet.js";
import type { InstallStore } from "../ports.js";
import type { VenueHost } from "../venues/venue-host.js";

/** What picks the wallet a bridge's deposit leaves from: the install's wallets and the venues. */
export interface BridgeWalletPicking {
  readonly install: Pick<InstallStore, "read">;
  readonly host: Pick<VenueHost, "roleWalletCalls">;
}

/** A bridge route to place: the agent, the venue whose deposit it makes, and the wallet named. */
export interface BridgeRouteAsk {
  readonly agent: Id<"agt">;
  readonly venue: string;
  /** The wallet the request names; absent, the engine picks. */
  readonly wallet?: Id<"wal">;
}

/** Why a bridge route has no wallet to leave from (decision 0307). */
export type BridgeWalletRefusal = Extract<
  ProtocolErrorCode,
  "intent.bridge_wallet_missing" | "intent.bridge_wallet_only"
>;

/**
 * The wallet a bridge route's deposit leaves from (decision 0307), checked before any card. A
 * route whose venue marks its deposit a bridge wallet's, as Relay does, leaves from the agent's
 * live bridge wallet: with none, `intent.bridge_wallet_missing`; a request that names any other
 * wallet, `intent.bridge_wallet_only`. A route of any other venue never leaves from a bridge
 * wallet: a request that names one of the agent's is `intent.bridge_wallet_only`, and otherwise
 * the wallet named, or `undefined` for the agent's default wallet. Each refusal's words name the
 * next step: make the bridge wallet with `binference wallet create --bridge`, or fund it.
 */
export async function bridgeWalletOf(
  picking: BridgeWalletPicking,
  ask: BridgeRouteAsk,
  options: { readonly signal: AbortSignal },
): Promise<Result<Id<"wal"> | undefined, BridgeWalletRefusal>> {
  const { wallets } = await picking.install.read(options);
  const isBridgeOnly = picking.host.roleWalletCalls("bridge", [ask.venue]).length > 0;
  if (isBridgeOnly) {
    const bridge = roleWalletIn(wallets, ask.agent, "bridge");
    if (bridge === undefined) {
      return err("intent.bridge_wallet_missing");
    }
    return ask.wallet === undefined || ask.wallet === bridge.id
      ? ok(bridge.id)
      : err("intent.bridge_wallet_only");
  }
  const named = wallets.find((wallet) => wallet.id === ask.wallet && wallet.agentId === ask.agent);
  return named?.role === "bridge" ? err("intent.bridge_wallet_only") : ok(ask.wallet);
}
