import { err, type Id, ok, type Result } from "@binference/core";
import type { AgentRecord, AgentStore } from "@binference/engine";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import type { ProtocolErrorCode, ResultOf } from "@binference/protocol";
import type { RuntimeModels } from "@binference/runtime";
import { z } from "zod";

/** A model role the owner may pick a model for. */
type Role = "main" | "fast" | "vision";

/** The models the owner picked for one agent, by role (decision 0204). */
export type AgentPicks = Readonly<Partial<Record<Role, string>>>;

type ModelList = ResultOf<"model/list">;
type ModelView = ModelList["items"][number];

/** What the model operations read and change. */
export interface ModelOperationsOptions {
  /** The models the runtime runs with: the config's, keys resolved. */
  readonly models: () => RuntimeModels;
  readonly agents: Pick<AgentStore, "get" | "setModels">;
  readonly clock: { readonly now: () => number };
  /** Hears an agent's picks after each change, so the runtime gets them from its next turn. */
  readonly picked: (agent: Id<"agt">, picks: AgentPicks) => Promise<void>;
}

const picksSchema = z.looseObject({
  main: z.string().optional(),
  fast: z.string().optional(),
  vision: z.string().optional(),
});

/** The picks an agent's stored models hold; none when they hold something else. */
export function picksOf(agent: Pick<AgentRecord, "models">): AgentPicks {
  const parsed = picksSchema.safeParse(agent.models);
  if (!parsed.success) {
    return {};
  }
  const { main, fast, vision } = parsed.data;
  return {
    ...(main === undefined ? {} : { main }),
    ...(fast === undefined ? {} : { fast }),
    ...(vision === undefined ? {} : { vision }),
  };
}

// Each role's configured models, the role's own first, then its fallbacks, in config order.
function configured(
  models: RuntimeModels,
): readonly { readonly role: Role; readonly model: string }[] {
  const of = (role: Role, list: readonly (string | undefined)[]) =>
    list.flatMap((model) => (model === undefined ? [] : [{ role, model }]));
  return [
    ...of("main", [models.main, ...models.fallbacks.main]),
    ...of("fast", [models.fast, ...models.fallbacks.fast]),
    ...of("vision", [models.vision]),
  ];
}

function pricesOf(models: RuntimeModels, model: string): Pick<ModelView, "prices"> {
  const price = models.prices[model];
  return price === undefined
    ? {}
    : {
        prices: {
          inputPerMTokUsdMicros: price.inputPerMTokUsd,
          outputPerMTokUsdMicros: price.outputPerMTokUsd,
          cachedPerMTokUsdMicros: price.cachedPerMTokUsd,
        },
      };
}

// The configured models, each marked `current` when it is the one the agent's next turn uses for
// its role: the agent's pick, else the role's configured model.
function listFor(models: RuntimeModels, picks: AgentPicks | undefined): ModelList {
  const firsts = new Set<Role>();
  const items = configured(models).map(({ role, model }): ModelView => {
    const inUse = picks?.[role] ?? models[role];
    const isCurrent = picks !== undefined && model === inUse && !firsts.has(role);
    if (isCurrent) {
      firsts.add(role);
    }
    return Object.assign(
      { role, model },
      pricesOf(models, model),
      isCurrent ? { current: true } : {},
    );
  });
  return { items };
}

async function agentOf(
  options: ModelOperationsOptions,
  agent: Id<"agt">,
  signal: AbortSignal,
): Promise<Result<AgentRecord, ProtocolErrorCode>> {
  const settings = await options.agents.get(agent, { signal });
  if (settings === undefined) {
    return err("agent.not_found");
  }
  return settings.agent.archivedAtMs === undefined ? ok(settings.agent) : err("agent.archived");
}

// The picks after setting `model` for `role`: the role's own configured model clears the pick, so
// its fallbacks apply again (decision 0204).
function picksAfter(
  models: RuntimeModels,
  picks: AgentPicks,
  set: { readonly role: Role; readonly model: string },
): AgentPicks {
  const { role, model } = set;
  const { [role]: _dropped, ...rest } = picks;
  return model === models[role] ? rest : { ...rest, [role]: model };
}

// Writes the picks under the agent row's version it read; a write that lost its race reads again.
async function setPicks(
  options: ModelOperationsOptions,
  change: { readonly agent: Id<"agt">; readonly role: Role; readonly model: string },
  signal: AbortSignal,
): Promise<Result<AgentPicks, ProtocolErrorCode>> {
  for (let tries = 0; tries < 3; tries += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each try reads the row the last one lost to
    const found = await agentOf(options, change.agent, signal);
    if (!found.ok) {
      return found;
    }
    const picks = picksAfter(options.models(), picksOf(found.value), change);
    const set = {
      agentId: change.agent,
      models: { ...picks },
      atMs: options.clock.now(),
      expectedVersion: found.value.version,
    };
    // oxlint-disable-next-line eslint/no-await-in-loop -- the write of the row this try read
    const written = await options.agents.setModels(set, { signal });
    if (written.ok) {
      return ok(picks);
    }
  }
  return err("protocol.busy");
}

/**
 * `model/list` and `model/set` (protocol spec, section 7.8). The list names each configured model
 * by role, with its prices when the config sets them, and for one agent marks the model its next
 * turn uses. `model/set` takes only a configured model, keeps it as the agent's pick, or clears the
 * pick when it is the role's own configured model, and hands the picks to the runtime.
 */
export function createModelOperations(options: ModelOperationsOptions): EngineHandlerTable {
  return {
    "model/list": async ({ args, signal }) => {
      if (args.agent === undefined) {
        return ok(listFor(options.models(), undefined));
      }
      const agent = await agentOf(options, args.agent, signal);
      return agent.ok ? ok(listFor(options.models(), picksOf(agent.value))) : agent;
    },
    "model/set": async ({ args, signal }) => {
      const { agent, role, model } = args;
      const isConfigured = configured(options.models()).some((each) => each.model === model);
      if (!isConfigured) {
        return err("protocol.bad_args");
      }
      const picks = await setPicks(options, { agent, role, model }, signal);
      if (!picks.ok) {
        return picks;
      }
      await options.picked(agent, picks.value);
      return ok(listFor(options.models(), picks.value));
    },
  };
}
