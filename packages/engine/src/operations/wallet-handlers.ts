import type { ChainRegistry, Signer } from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode, WalletView } from "@binference/protocol";
import { z } from "zod";
import type { WalletRecord } from "../install/install-record.js";
import { launchWalletIn } from "../install/launch-wallet.js";
import { callsOutsideCeiling } from "../limits/limit-ceiling.js";
import type { VenueHost } from "../venues/venue-host.js";
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
  /** The launch calls of every launchpad, and the calls a launch wallet makes on each venue. */
  readonly host: Pick<VenueHost, "launchCalls" | "launchWalletCalls">;
}

const abiNameSchema = z.object({ name: z.string().min(1) });

// The functions of the calls the agent's launchpads declare that its launch wallet's ceiling does
// not allow (decision 0271); none for a wallet of an agent the store no longer holds.
async function missingCallsOf(
  options: WalletHandlersOptions,
  wallet: WalletRecord,
  signal: AbortSignal,
): Promise<readonly string[]> {
  const agent = await options.agents.get(wallet.agentId, { signal });
  const calls = options.host.launchWalletCalls(agent?.limits.venues ?? []);
  const names = callsOutsideCeiling(wallet, calls).flatMap((abi) => {
    const parsed = abiNameSchema.safeParse(abi);
    return parsed.success ? [parsed.data.name] : [];
  });
  return [...new Set(names)];
}

// A wallet's view: an extra launch wallet is marked, since nothing trades from it and the owner
// rescues it; the agent's launch wallet names the calls its ceiling lacks.
async function listedView(
  options: WalletHandlersOptions,
  listed: { readonly wallet: WalletRecord; readonly wallets: readonly WalletRecord[] },
  signal: AbortSignal,
): Promise<WalletView | undefined> {
  const { wallet, wallets } = listed;
  const view = await walletViewOf(options, wallet, signal);
  const isLive = wallet.role === "launch" && wallet.archivedAtMs === undefined;
  const isExtra = isLive && launchWalletIn(wallets, wallet.agentId)?.id !== wallet.id;
  if (view === undefined || !isLive) {
    return view;
  }
  if (isExtra) {
    return { ...view, extra: true };
  }
  const missingCalls = await missingCallsOf(options, wallet, signal);
  return missingCalls.length === 0 ? view : { ...view, missingCalls };
}

/**
 * Creates the wallet list. `wallet/list` answers the agent's wallets, or every agent's when the
 * call names none, oldest first, so an agent's default wallet comes first; archived wallets are
 * listed with the time they were archived. Each wallet's address comes from
 * {@link walletViewOf}; a live launch wallet that is not its agent's launch wallet, as a rebuild
 * may adopt, is marked `extra` (decision 0218), and the agent's launch wallet names in
 * `missingCalls` the functions its agent's launchpads call that its ceiling does not allow
 * (decision 0271). An unknown agent is `agent.not_found`; a stored
 * wallet custody holds on no chain fails the call with `wallet.custody_down`. `wallet/create`
 * makes a wallet with the owner key (see {@link makeWallet}), one call at a time, so a second
 * launch wallet of an agent is refused before custody makes it; and `wallet/exportSealed` exports one's key sealed to the
 * caller's recipient key (see {@link exportWallet}); `signer/revoke` removes a machine's agent key
 * from every live wallet with the owner key (see {@link revokeSigner}). `agent/list` lists the
 * agents with their default wallets (see {@link createAgentListHandlers}).
 */
export function createWalletHandlers(options: WalletHandlersOptions): WalletHandlers {
  let queue: Promise<void> = Promise.resolve();
  return {
    ...createAgentListHandlers(options),
    async "wallet/create"(call): Promise<Result<WalletView, ProtocolErrorCode>> {
      const turn = queue.then(async () => makeWallet(options, call));
      queue = turn.then(
        () => undefined,
        () => undefined,
      );
      return turn;
    },
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
        records.map(async (wallet) => listedView(options, { wallet, wallets }, signal)),
      );
      const items = views.filter((view) => view !== undefined);
      return items.length === records.length ? ok({ items }) : err("wallet.custody_down");
    },
  };
}
