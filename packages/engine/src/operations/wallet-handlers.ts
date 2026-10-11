import type { ChainRegistry, Signer } from "@binference/chain";
import { err, ok } from "@binference/core";
import { type AgentListHandlers, createAgentListHandlers } from "./agent-list-handlers.js";
import type { EngineHandler } from "./engine-call.js";
import { exportWallet, type ExportWalletOptions } from "./export-wallet.js";
import { makeWallet, type MakeWalletOptions } from "./make-wallet.js";
import { revokeSigner, type RevokeSignerOptions } from "./revoke-signer.js";
import { walletViewOf } from "./wallet-view-of.js";

/** The handlers of the agent wallets, and the agent list with each default wallet (spec, 7.2). */
export interface WalletHandlers extends AgentListHandlers {
  readonly "wallet/list": EngineHandler<"wallet/list">;
  readonly "wallet/create": EngineHandler<"wallet/create">;
  readonly "wallet/exportSealed": EngineHandler<"wallet/exportSealed">;
  readonly "signer/revoke": EngineHandler<"signer/revoke">;
}

/**
 * What the wallet handlers read and write: the agents, the install's wallets, custody for each
 * account, and what making a wallet asks custody and journals through.
 */
export interface WalletHandlersOptions
  extends MakeWalletOptions, ExportWalletOptions, RevokeSignerOptions {
  readonly custody: Signer;
  readonly chains: ChainRegistry;
}

/**
 * Creates the wallet list. `wallet/list` answers the agent's wallets, or every agent's when the
 * call names none, oldest first, so an agent's default wallet comes first; archived wallets are
 * listed with the time they were archived. Each wallet's address comes from
 * {@link walletViewOf}. An unknown agent is `agent.not_found`; a stored wallet custody holds on no
 * chain fails the call with `wallet.custody_down`. `wallet/create` makes a wallet with the
 * owner key (see {@link makeWallet}), and `wallet/exportSealed` exports one's key sealed to the
 * caller's recipient key (see {@link exportWallet}); `signer/revoke` removes a machine's agent key
 * from every live wallet with the owner key (see {@link revokeSigner}). `agent/list` lists the
 * agents with their default wallets (see {@link createAgentListHandlers}).
 */
export function createWalletHandlers(options: WalletHandlersOptions): WalletHandlers {
  return {
    ...createAgentListHandlers(options),
    "wallet/create": async (call) => makeWallet(options, call),
    "wallet/exportSealed": async (call) => exportWallet(options, call),
    "signer/revoke": async (call) => revokeSigner(options, call),
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
        records.map(async (wallet) => walletViewOf(options, wallet, signal)),
      );
      const items = views.filter((view) => view !== undefined);
      return items.length === records.length ? ok({ items }) : err("wallet.custody_down");
    },
  };
}
