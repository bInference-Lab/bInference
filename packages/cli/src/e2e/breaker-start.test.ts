import { BinferenceError } from "@binference/core";
import type { BreakerSource } from "@binference/engine";
import { afterEach, describe, expect, it } from "vitest";
import type { StartSigner } from "../compose/start-signer.js";
import { seedConfirmedTrade } from "./state-fixtures.js";
import { connectClient } from "./test-host.js";
import { createTestSigner } from "./test-signer.js";
import { createRunningEngines, stateOf } from "./unlock-fixtures.js";

const slow = { timeout: 60_000 };
const engines = createRunningEngines();
const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

afterEach(async () => {
  await engines.stopAll();
});

// The start's steps in the order they ran: each look at the breaker, and the signer's start,
// which the unlock asks for once the keys open.
function startWatcher(answer: BreakerSource["read"]) {
  const steps: string[] = [];
  const signer = createTestSigner();
  const startSigner: StartSigner = async (begin) => {
    steps.push("signer");
    return signer.start(begin);
  };
  const testBreaker: BreakerSource = {
    read: async (call) => {
      steps.push("breaker");
      return answer(call);
    },
  };
  return { steps, parts: { startSigner, testBreaker } };
}

describe("the start of an engine the breaker holds", () => {
  it(
    "cancels a confirmed trade a stop left before the keys open, so the queue never takes it",
    slow,
    async () => {
      const machine = await engines.setUp();
      const intent = await seedConfirmedTrade(machine);
      const watcher = startWatcher(async () => Promise.resolve({ pulled: true, version: 1 }));
      await engines.start(machine, { parts: watcher.parts });
      await expect(stateOf(machine)).resolves.toBe("ready");
      const client = await connectClient(machine);
      try {
        const view = await client.call("intent/get", { intent }, live());
        expect(view).toMatchObject({ state: "cancelled" });
      } finally {
        client.close();
      }
      expect(watcher.steps.slice(0, 2)).toStrictEqual(["breaker", "signer"]);
    },
  );

  it("goes on to ready when the breaker cannot be read at the start", slow, async () => {
    const machine = await engines.setUp();
    const down = new BinferenceError({ code: "breaker.unreadable", message: "No copy." });
    const watcher = startWatcher(async () => Promise.reject(down));
    await engines.start(machine, { parts: watcher.parts });
    await expect(stateOf(machine)).resolves.toBe("ready");
    expect(watcher.steps.slice(0, 2)).toStrictEqual(["breaker", "signer"]);
  });
});
