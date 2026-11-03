import { err, type Id, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import { namedWalletRefusal } from "../install/role-wallet.js";
import { routedWalletOf } from "../money-path/launch-routing.js";
import type { OrderParts } from "./create-order.js";
import type { CheckedOrder } from "./order-rules.js";

/**
 * The wallet a new order or webhook rule runs from: the one its request names, or the one its trades route to,
 * the agent's launch wallet for a token on a launch's curve or one it holds, else its default
 * wallet (decision 0217); with an account in custody on the token's chain (else
 * `wallet.not_found`). A curve read that failed picks none (`quote.venue_down`, decision 0218). A
 * named bridge wallet is `intent.bridge_wallet_only`, and a named extra launch or bridge wallet
 * `intent.extra_wallet` (decision 0307), before anything is stored.
 */
export async function orderWalletOf(
  parts: Pick<OrderParts, "wallets" | "custody" | "launches" | "install">,
  asked: {
    readonly request: Pick<CheckedOrder["request"], "agent" | "wallet" | "side" | "token">;
    readonly chain: CheckedOrder["chain"];
    readonly isPaper: boolean;
  },
  signal: AbortSignal,
): Promise<Result<Id<"wal">, ProtocolErrorCode>> {
  const { request, chain } = asked;
  const owned = await parts.wallets.wallets(request.agent, { signal });
  const sold = request.side === "sell" ? { sold: request.token } : {};
  const trade = {
    agent: request.agent,
    chain,
    isPaper: asked.isPaper,
    owned,
    placed: request.token,
  };
  if (request.wallet !== undefined) {
    const { wallets } = await parts.install.read({ signal });
    const refusal = namedWalletRefusal(wallets, { agent: request.agent, wallet: request.wallet });
    if (refusal !== undefined) {
      return err(refusal);
    }
  }
  const routed =
    request.wallet === undefined
      ? await routedWalletOf(parts.launches, { ...trade, ...sold }, signal)
      : ok(request.wallet);
  if (!routed.ok) {
    return err("quote.venue_down");
  }
  const wallet = routed.value;
  if (wallet === undefined || !owned.includes(wallet)) {
    return err("wallet.not_found");
  }
  const account = await parts.custody.account(wallet, chain.ref, { signal });
  return account.ok ? ok(wallet) : err("wallet.not_found");
}
