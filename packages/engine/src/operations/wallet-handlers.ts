import type { AccountRef, ChainRegistry, Signer } from "@binference/chain";
import { err, type Ok, ok, type Result } from "@binference/core";
import type { WalletView } from "@binference/protocol";
import type { WalletRecord } from "../install/install-record.js";
import type { EngineHandler } from "./engine-call.js";
import { makeWallet, type MakeWalletOptions } from "./make-wallet.js";

/** The handlers of the agent wallets (protocol spec, section 7.2). */
export interface WalletHandlers {
  readonly "wallet/list": EngineHandler<"wallet/list">;
  readonly "wallet/create": EngineHandler<"wallet/create">;
}

/**
 * What the wallet handlers read and write: the agents, the install's wallets, custody for each
 * account, and what making a wallet asks custody and journals through.
 */
export interface WalletHandlersOptions extends MakeWalletOptions {
  readonly custody: Signer;
  readonly chains: ChainRegistry;
}

function isHeld(account: Result<AccountRef, "unknown_wallet">): account is Ok<AccountRef> {
  return account.ok;
}

// The wallet's account on the first registered chain where custody holds it.
async function viewOf(
  options: WalletHandlersOptions,
  wallet: WalletRecord,
  signal: AbortSignal,
): Promise<WalletView | undefined> {
  const accounts = await Promise.all(
    options.chains
      .list()
      .map(async (chain) => options.custody.account(wallet.id, chain.ref, { signal })),
  );
  const account = accounts.find(isHeld);
  return account === undefined
    ? undefined
    : {
        wallet: wallet.id,
        agent: wallet.agentId,
        address: account.value,
        label: wallet.label,
        createdAt: wallet.createdAtMs,
        ...(wallet.archivedAtMs === undefined ? {} : { archivedAt: wallet.archivedAtMs }),
      };
}

/**
 * Creates the wallet list. `wallet/list` answers the agent's wallets, or every agent's when the
 * call names none, oldest first, so an agent's default wallet comes first; archived wallets are
 * listed with the time they were archived. Each wallet's address is its account from custody on
 * the first registered chain where custody holds it. An unknown agent is `agent.not_found`; a
 * stored wallet custody holds on no chain fails the call with `wallet.custody_down`, so no wallet
 * is ever shown without the address custody signs for. `wallet/create` makes a wallet with the
 * owner key (see {@link makeWallet}).
 */
export function createWalletHandlers(options: WalletHandlersOptions): WalletHandlers {
  return {
    "wallet/create": async (call) => makeWallet(options, call),
    async "wallet/list"({ args, signal }) {
      if (
        args.agent !== undefined &&
        (await options.agents.get(args.agent, { signal })) === undefined
      ) {
        return err("agent.not_found");
      }
      const { wallets } = await options.install.read({ signal });
      const records = wallets.filter(
        (wallet) => args.agent === undefined || wallet.agentId === args.agent,
      );
      const views = await Promise.all(
        records.map(async (wallet) => viewOf(options, wallet, signal)),
      );
      const items = views.filter((view) => view !== undefined);
      return items.length === records.length ? ok({ items }) : err("wallet.custody_down");
    },
  };
}
