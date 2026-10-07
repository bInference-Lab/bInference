import { idSchema, type Id } from "@binference/core";
import type { AgentRecord } from "@binference/engine";
import { describe, expect, it } from "vitest";
import { createEngineOperations } from "./engine-operations.js";

function agentId(n: number): Id<"agt"> {
  return idSchema("agt").parse(`agt_0190f1c2-3a4b-7c5d-8e6f-${String(n).padStart(12, "0")}`);
}

function agent(n: number, extra: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: agentId(n),
    name: `agent${String(n)}`,
    mode: "paper",
    locale: "en",
    models: {},
    notifications: {},
    createdAtMs: 1,
    changedAtMs: 1,
    version: 1,
    ...extra,
  };
}

const call = { caller: undefined as never, signal: new AbortController().signal };

function operationsWith(records: readonly AgentRecord[]) {
  const stops = { count: 0 };
  const handlers = createEngineOperations({
    agents: { list: async () => Promise.resolve(records) },
    version: "2026.10.0",
    state: () => "ready",
    health: () => [{ signal: "memory", state: "ok" }],
    stop: () => {
      stops.count += 1;
    },
  });
  return { handlers, stops };
}

describe("the engine's own operations", () => {
  it("answers engine/status with the agents that are not archived", async () => {
    const { handlers } = operationsWith([
      agent(1),
      agent(2, { mode: "live", frozenAtMs: 5 }),
      agent(3, { archivedAtMs: 9 }),
    ]);
    await expect(handlers["engine/status"]?.({ ...call, args: {} })).resolves.toStrictEqual({
      ok: true,
      value: {
        state: "ready",
        version: "2026.10.0",
        protocol: 1,
        frozen: false,
        agents: [
          { id: agentId(1), mode: "paper", frozen: false },
          { id: agentId(2), mode: "live", frozen: true },
        ],
        health: [{ signal: "memory", state: "ok" }],
      },
    });
  });

  it("counts the engine as frozen only when it has agents and all of them are", async () => {
    const all = operationsWith([agent(1, { frozenAtMs: 2 })]).handlers;
    const none = operationsWith([]).handlers;
    await expect(all["engine/status"]?.({ ...call, args: {} })).resolves.toMatchObject({
      value: { frozen: true },
    });
    await expect(none["engine/status"]?.({ ...call, args: {} })).resolves.toMatchObject({
      value: { frozen: false, agents: [] },
    });
  });

  it("starts the shutdown on engine/stop and answers at once", async () => {
    const { handlers, stops } = operationsWith([]);
    await expect(handlers["engine/stop"]?.({ ...call, args: {} })).resolves.toStrictEqual({
      ok: true,
      value: {},
    });
    expect(stops.count).toBe(1);
  });
});
