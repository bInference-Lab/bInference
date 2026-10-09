import { err, idSchema, type Id, ok } from "@binference/core";
import type { AgentRecord } from "@binference/engine";
import { describe, expect, it } from "vitest";
import { createEngineOperations, type EngineOperationsOptions } from "./engine-operations.js";

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

// A lock that opens only with the passphrase, and keeps every passphrase it was handed.
function passphraseLock() {
  const typed: (string | undefined)[] = [];
  const lock: EngineOperationsOptions["lock"] = {
    unlock: async ({ passphrase }) => {
      typed.push(passphrase?.reveal());
      if (passphrase === undefined) {
        return Promise.resolve(err("needs_passphrase"));
      }
      return Promise.resolve(
        passphrase.reveal() === "right" ? ok(undefined) : err("wrong_passphrase"),
      );
    },
  };
  return { lock, typed };
}

function operationsWith(records: readonly AgentRecord[], lock = passphraseLock().lock) {
  const stops = { count: 0 };
  const handlers = createEngineOperations({
    lock,
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

  it("unlocks the engine with the owner's passphrase on engine/unlock", async () => {
    const { lock, typed } = passphraseLock();
    const { handlers } = operationsWith([], lock);
    const unlock = handlers["engine/unlock"];
    await expect(unlock?.({ ...call, args: { passphrase: "right" } })).resolves.toStrictEqual(
      ok({}),
    );
    expect(typed).toStrictEqual(["right"]);
  });

  it("fails engine/unlock as locked with the reason, retryable only when a retry can pass", async () => {
    const { handlers } = operationsWith([]);
    const unlock = handlers["engine/unlock"];
    await expect(unlock?.({ ...call, args: { passphrase: "wrong" } })).rejects.toMatchObject({
      code: "engine.locked",
      retryable: false,
      details: { reason: "wrong_passphrase" },
    });
    await expect(unlock?.({ ...call, args: {} })).rejects.toMatchObject({
      code: "engine.locked",
      retryable: false,
      details: { reason: "needs_passphrase" },
    });
    const missing = operationsWith([], { unlock: async () => err("keychain_failed") }).handlers;
    await expect(missing["engine/unlock"]?.({ ...call, args: {} })).rejects.toMatchObject({
      code: "engine.locked",
      retryable: true,
      details: { reason: "keychain_failed" },
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
