import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { turnEngineContract } from "../contracts/turn-engine-contract.js";
import { createMemoryAgentStores, nthTestId } from "../testing/memory-agent-stores.js";
import { createHelperRunLog } from "./helper-run-log.js";
import { createHelperTurnEngine } from "./helper-turn-engine.js";

const agent = nthTestId("agt", 1);
const session = nthTestId("ses", 1);
const live = (): AbortSignal => new AbortController().signal;

async function subject(given: {
  readonly refuse?: "archived" | "not_found" | undefined;
  readonly budgetLeft?: bigint;
}) {
  const { stores } = await createMemoryAgentStores();
  const draft = { id: session, agentId: agent, surface: "helper", conversation: "helper" };
  await stores.sessions.open({ ...draft, startedAtMs: 1, fence: stores.fence }, { signal: live() });
  const message = nthTestId("msg", 1);
  const log = createHelperRunLog();
  const usages: string[] = [];
  const engine = createHelperTurnEngine({
    stores,
    place: { agent, session, turn: nthTestId("trn", 1) },
    taken: [{ id: message, text: "Find BNB news.", outside: false }],
    clock: createManualClock(1_000),
    log,
    admit: async (signal) => {
      signal.throwIfAborted();
      return Promise.resolve(given.refuse);
    },
    budgetLeft: () => given.budgetLeft,
    recordUsage: async (usage) => {
      usages.push(usage.key);
      return Promise.resolve({ budgetLeftMicros: 4n });
    },
  });
  return { engine, messages: [message], log, stores, usages };
}

describe("a helper's turn without the engine's running turn", () => {
  it.each(
    turnEngineContract({
      create: async ({ refuse }) => {
        const { engine, messages, log } = await subject({ budgetLeft: 5n, refuse });
        return { engine, messages, read: async () => Promise.resolve(log.read()) };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("refuses a run once the engine last answered the budget as spent, and starts nothing", async () => {
    const { engine, messages, stores } = await subject({ budgetLeft: 0n });
    const started = await engine.start({ messages, outsideContent: false }, live());
    expect(started).toStrictEqual({ ok: false, error: "budget" });
    expect(await stores.sessions.turn(nthTestId("trn", 1), { signal: live() })).toBeUndefined();
  });

  it("starts with no budget figure before the engine answered one, and records usage", async () => {
    const { engine, messages, usages } = await subject({});
    expect(await engine.start({ messages, outsideContent: true }, live())).toStrictEqual({
      ok: true,
      value: {},
    });
    const usage = { model: "p/m", inputTokens: 1, outputTokens: 1, cachedTokens: 0, usdMicros: 1n };
    await engine.recordUsage({ ...usage, key: "h.usage.1" }, live());
    expect(usages).toStrictEqual(["h.usage.1"]);
  });
});
