import type { ChainRegistry } from "@binference/chain";
import { type Clock, err, type Id, type IdSource, ok } from "@binference/core";
import type { StoredIntents } from "../intents/create-stored-intents.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { type EngineHandler, proposerOf } from "../operations/engine-call.js";
import { intentViewOf } from "../operations/intent-view-of.js";
import type { AgentStore, IntentStore, WalletFactsSource } from "../ports.js";
import type { ConfigChanges } from "./config-change-parts.js";
import type { ConfigChangeRequest } from "./config-change-quote.js";
import { proposeConfigChange } from "./propose-config-change.js";
import { writeConfigChange } from "./write-config-change.js";

/** The handlers of `config/view` and `config/propose` (decision 0393). */
export interface ConfigChangeHandlers {
  readonly "config/view": EngineHandler<"config/view">;
  readonly "config/propose": EngineHandler<"config/propose">;
}

/** What the config change handlers read, store and apply through. */
export interface ConfigChangeHandlersOptions {
  readonly stored: StoredIntents;
  readonly intents: IntentStore;
  readonly agents: AgentStore;
  readonly wallets: Pick<WalletFactsSource, "wallets">;
  readonly configChanges: ConfigChanges;
  readonly isLocked: () => boolean;
  readonly chains: ChainRegistry;
  readonly clock: Clock;
  readonly ids: IdSource;
}

// A change a stop left `confirmed` is applied before the next one is proposed, so two changes of
// the same key never cross.
async function finishConfirmed(
  options: ConfigChangeHandlersOptions,
  signal: AbortSignal,
): Promise<void> {
  const confirmed = await options.stored.list(
    { states: ["confirmed"], isPaper: false, limit: 50 },
    { signal },
  );
  const left = confirmed.filter((record: IntentRecord) => record.kind === "configChange");
  await left.reduce(async (previous, record) => {
    await previous;
    const snapshot = await options.stored.snapshot(record.id, { signal });
    if (snapshot !== undefined) {
      await writeConfigChange(options, snapshot, signal);
    }
  }, Promise.resolve());
}

/**
 * Creates the config change handlers (decision 0393): `config/view` reads the config and the rules
 * of its keys for any caller with `read`; `config/propose` opens a card for a JSON merge patch over
 * `config.json5`, which only the owner's tap applies. The owner and the agent runtime propose; an
 * MCP client is `auth.scope`. Proposals wait their turn, so two calls never open their cards out
 * of order.
 */
export function createConfigChangeHandlers(
  options: ConfigChangeHandlersOptions,
): ConfigChangeHandlers {
  let queue: Promise<void> = Promise.resolve();
  return {
    "config/view": async ({ args, signal }) => options.configChanges.view(args.path, { signal }),
    async "config/propose"({ args, caller, signal }) {
      const proposer = proposerOf(caller);
      if (proposer === undefined || proposer.role === "mcp_client") {
        return err("auth.scope");
      }
      const { patch, reason, baseHash, replacePaths } = args;
      const asked = {
        ...(baseHash === undefined ? {} : { baseHash }),
        ...(replacePaths === undefined ? {} : { replacePaths }),
      };
      const agent: Id<"agt"> | undefined = args.agent;
      const request: ConfigChangeRequest = {
        kind: "configChange",
        patch,
        ...(reason === undefined ? {} : { reason }),
      };
      const turn = queue.then(async () => {
        await finishConfirmed(options, signal);
        return proposeConfigChange(options, {
          request,
          asked,
          ...(agent === undefined ? {} : { agent }),
          proposer,
          signal,
        });
      });
      queue = turn.then(
        () => undefined,
        () => undefined,
      );
      const proposed = await turn;
      return proposed.ok ? ok(intentViewOf(proposed.value, options.chains)) : proposed;
    },
  };
}
