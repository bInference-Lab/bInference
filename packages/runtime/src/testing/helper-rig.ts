import { createIdSource, type Id } from "@binference/core";
import { createManualClock, createSeededRandom, type ManualClock } from "@binference/core/testing";
import type { HelperStore } from "@binference/store";
import {
  createMemoryAgentDatabase,
  createMemoryHelperStore,
  type MemoryAgentDatabase,
} from "@binference/store/testing";
import { type BudgetMemory, createBudgetMemory } from "../helpers/budget-memory.js";
import { createHelperDesk, type HelperRunner } from "../helpers/helper-desk.js";
import { type TestTool, testToolBox } from "../loop/test-turns.js";
import { turnLimits } from "../loop/turn-run.js";
import type { AgentStores } from "../sessions/agent-stores.js";
import type { TurnPlace } from "../sessions/turn-place.js";
import { createFakeToolClient, type FakeToolClient } from "./fake-tool-client.js";
import { createMemoryAgentStores, nthTestId } from "./memory-agent-stores.js";
import { createMemoryContextSource } from "./memory-context-source.js";
import { createMemoryEngineChat, type MemoryEngineChat } from "./memory-engine-chat.js";
import {
  createScriptedTransport,
  oneModelChain,
  type ScriptedReply,
  type ScriptedTransport,
} from "./scripted-transport.js";

/** A helper desk on in-memory stores, a fake engine, a scripted model and test tools. */
export interface HelperRig {
  readonly agent: Id<"agt">;
  /** The agent's session the helpers are started from. */
  readonly parent: Id<"ses">;
  readonly desk: HelperRunner;
  readonly helpers: HelperStore;
  readonly stores: AgentStores;
  readonly database: MemoryAgentDatabase;
  readonly engine: MemoryEngineChat;
  readonly client: FakeToolClient;
  readonly transport: ScriptedTransport;
  readonly budgets: BudgetMemory;
  readonly clock: ManualClock;
  /** Where each helper turn's setup was asked for. */
  readonly places: readonly TurnPlace[];
  readonly lifetime: AbortController;
}

/** What a helper rig starts from. */
export interface HelperRigOptions {
  readonly replies: readonly ScriptedReply[];
  readonly tools?: readonly TestTool[];
  /** The agent database of a runtime that ran before; an empty one by default. */
  readonly database?: MemoryAgentDatabase;
}

// The engine takes every helper's end.
const answers = { "helper/ended": {} };

// The agent's session on Telegram, as its own turn opened it; one a runtime before opened stays.
async function openParent(
  stores: AgentStores,
  place: { readonly agent: Id<"agt">; readonly parent: Id<"ses"> },
): Promise<void> {
  const opened = { id: place.parent, agentId: place.agent, surface: "telegram" };
  const draft = { ...opened, conversation: "telegram", startedAtMs: 1, fence: stores.fence };
  await stores.sessions.open(draft, { signal: new AbortController().signal });
}

/** Starts a helper rig whose agent has its session open, as its own turn opened it. */
export async function startHelperRig(options: HelperRigOptions): Promise<HelperRig> {
  const agent = nthTestId("agt", 1);
  const parent = nthTestId("ses", 1);
  const database = options.database ?? createMemoryAgentDatabase();
  const { stores } = await createMemoryAgentStores(database);
  const lifetime = new AbortController();
  await openParent(stores, { agent, parent });
  const helpers = createMemoryHelperStore(database);
  const [engine, client] = [createMemoryEngineChat([agent]), createFakeToolClient(answers)];
  const transport = createScriptedTransport(options.replies);
  const clock = createManualClock(10_000);
  const budgets = createBudgetMemory();
  const places: TurnPlace[] = [];
  const desk = createHelperDesk({
    stores,
    helpers,
    engine,
    context: createMemoryContextSource({ now: () => clock.now() }),
    client,
    setup: (place) => {
      places.push(place);
      return {
        models: oneModelChain(transport, clock),
        tools: testToolBox(options.tools ?? []),
        instructions: "You are a test helper.",
        limits: turnLimits,
      };
    },
    budgets,
    clock,
    ids: createIdSource({ clock, random: createSeededRandom(3) }),
    lifetime: lifetime.signal,
    providers: () => ["test"],
  });
  return {
    agent,
    parent,
    desk,
    helpers,
    stores,
    database,
    engine,
    client,
    transport,
    budgets,
    clock,
    places,
    lifetime,
  };
}
