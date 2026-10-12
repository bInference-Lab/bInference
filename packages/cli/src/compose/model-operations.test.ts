import { type Id, idSchema } from "@binference/core";
import { createMemoryAgentStore, testAgent, testAgentDraft } from "@binference/engine/testing";
import type { RuntimeModels } from "@binference/runtime";
import { describe, expect, it } from "vitest";
import { type AgentPicks, createModelOperations } from "./model-operations.js";

const live = { signal: new AbortController().signal };
const caller = { credential: "tg:1", client: { kind: "telegram" }, scopes: ["confirm"] } as const;

const models: RuntimeModels = {
  providers: { router: { kind: "binference" } },
  main: "router/large",
  fast: "router/small",
  fallbacks: { main: ["router/backup"], fast: [] },
  idleTimeoutMs: 120_000,
  cooldownMs: 60_000,
  maxToolCallsPerTurn: 25,
  loopDetection: true,
  prices: {
    "router/large": {
      inputPerMTokUsd: 3_000_000n,
      outputPerMTokUsd: 15_000_000n,
      cachedPerMTokUsd: 300_000n,
    },
  },
};

async function operations() {
  const agents = createMemoryAgentStore();
  await agents.create(testAgentDraft(), live);
  const heard: (readonly [Id<"agt">, AgentPicks])[] = [];
  const handlers = createModelOperations({
    models: () => models,
    agents,
    clock: { now: () => 5_000 },
    picked: async (agent, picks) => {
      heard.push([agent, picks]);
      return Promise.resolve();
    },
  });
  const list = handlers["model/list"];
  const set = handlers["model/set"];
  if (list === undefined || set === undefined) {
    throw new Error("Both model operations are composed.");
  }
  return {
    agents,
    heard,
    list: async (args: { readonly agent?: Id<"agt"> }) => list({ args, caller, ...live }),
    set: async (role: "main" | "fast", model: string) =>
      set({ args: { agent: testAgent, role, model }, caller, ...live }),
  };
}

const current = (role: string, model: string) => ({ role, model, current: true });

// The models a list marks as in use; a refusal fails the test.
function inUse(listed: Awaited<ReturnType<Awaited<ReturnType<typeof operations>>["list"]>>) {
  if (!listed.ok) {
    throw new Error(`The list was refused: ${listed.error}.`);
  }
  return listed.value.items.filter((item) => item.current === true);
}

describe("the model operations", () => {
  it("lists each configured model by role, the role's own first, with its prices", async () => {
    const test = await operations();
    expect(await test.list({})).toStrictEqual({
      ok: true,
      value: {
        items: [
          {
            role: "main",
            model: "router/large",
            prices: {
              inputPerMTokUsdMicros: 3_000_000n,
              outputPerMTokUsdMicros: 15_000_000n,
              cachedPerMTokUsdMicros: 300_000n,
            },
          },
          { role: "main", model: "router/backup" },
          { role: "fast", model: "router/small" },
        ],
      },
    });
  });

  it("marks the models an agent's next turn uses, the configured ones until it picks", async () => {
    const test = await operations();
    const listed = await test.list({ agent: testAgent });
    expect(inUse(listed)).toStrictEqual([
      expect.objectContaining(current("main", "router/large")),
      current("fast", "router/small"),
    ]);
  });

  it("keeps a configured model as the agent's pick and hands it to the runtime", async () => {
    const test = await operations();
    const set = await test.set("main", "router/backup");
    expect(inUse(set)).toStrictEqual([
      current("main", "router/backup"),
      current("fast", "router/small"),
    ]);
    expect(test.heard).toStrictEqual([[testAgent, { main: "router/backup" }]]);
    expect((await test.agents.get(testAgent, live))?.agent.models).toStrictEqual({
      main: "router/backup",
    });
  });

  it("clears the pick when the role's own configured model is picked again", async () => {
    const test = await operations();
    await test.set("main", "router/backup");
    await test.set("main", "router/large");
    expect(test.heard.at(-1)).toStrictEqual([testAgent, {}]);
    expect((await test.agents.get(testAgent, live))?.agent.models).toStrictEqual({});
  });

  it("refuses a model the config does not name, and an unknown agent", async () => {
    const test = await operations();
    expect(await test.set("main", "router/unknown")).toStrictEqual({
      ok: false,
      error: "protocol.bad_args",
    });
    const stranger = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000099");
    expect(await test.list({ agent: stranger })).toStrictEqual({
      ok: false,
      error: "agent.not_found",
    });
    expect(test.heard).toStrictEqual([]);
  });
});
