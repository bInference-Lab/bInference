import {
  type AssetRef,
  assetRefParts,
  type ChainRegistry,
  canonicalAsset,
  type RegisteredChain,
} from "@binference/chain";
import { err, ok } from "@binference/core";
import type { WalletRecord } from "../install/install-record.js";
import { searchAssets } from "../market/search-assets.js";
import type { AgentStore, InstallStore, PositionStore } from "../ports.js";
import type { EngineHandler } from "./engine-call.js";

/** The handler of `asset/search` (protocol spec, section 7.3). */
export interface AssetSearchHandlers {
  readonly "asset/search": EngineHandler<"asset/search">;
}

/** What the asset search reads: the registry, the agents, their wallets and their positions. */
export interface AssetSearchOptions {
  readonly agents: AgentStore;
  readonly install: InstallStore;
  readonly store: PositionStore;
  readonly chains: ChainRegistry;
}

interface HeldQuery {
  readonly wallets: readonly WalletRecord[];
  readonly chain: RegisteredChain;
}

// Every asset of the chain a wallet holds some of, live or on paper, in its canonical form.
async function heldOn(
  options: AssetSearchOptions,
  query: HeldQuery,
  signal: AbortSignal,
): Promise<ReadonlySet<AssetRef>> {
  const reads = query.wallets.flatMap((wallet) =>
    [false, true].map(async (isPaper) =>
      options.store.positions({ walletId: wallet.id, isPaper }, { signal }),
    ),
  );
  const positions = (await Promise.all(reads)).flat();
  return new Set(
    positions
      .filter(
        ({ asset, quantityBase }) =>
          quantityBase > 0n && assetRefParts(asset).chain === query.chain.ref,
      )
      .flatMap(({ asset }) => {
        const canonical = canonicalAsset(options.chains, asset);
        return canonical.ok ? [canonical.value] : [];
      }),
  );
}

/**
 * Creates the asset search. `asset/search` finds a token's id on one chain in the registry and in
 * what the agent's wallets hold, or every agent's when the call names none (see
 * {@link searchAssets}); it reads nothing outside the engine. A chain the registry does not hold
 * is `protocol.bad_args`, an unknown agent `agent.not_found`.
 */
export function createAssetSearchHandlers(options: AssetSearchOptions): AssetSearchHandlers {
  return {
    async "asset/search"({ args, signal }) {
      const chain = options.chains.get(args.chain);
      if (!chain.ok) {
        return err("protocol.bad_args");
      }
      if (
        args.agent !== undefined &&
        (await options.agents.get(args.agent, { signal })) === undefined
      ) {
        return err("agent.not_found");
      }
      const { wallets } = await options.install.read({ signal });
      const owned = wallets.filter(
        (wallet) => args.agent === undefined || wallet.agentId === args.agent,
      );
      const held = await heldOn(options, { wallets: owned, chain: chain.value }, signal);
      return ok(searchAssets(options.chains, { chain: chain.value, query: args.query, held }));
    },
  };
}
