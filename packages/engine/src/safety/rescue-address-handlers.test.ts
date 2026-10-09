import { type AccountRef, accountRefSchema } from "@binference/chain";
import { err } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testNowMs } from "../intents/test-intents.js";
import type { EngineCaller } from "../operations/engine-call.js";
import { startTestEngine, type TestEngine, testCall } from "../operations/test-engine.js";
import { rescueAt } from "../policy/rescue-change.js";
import { looseningWaitMs } from "../policy/send-level-change.js";

const live = { signal: new AbortController().signal };
const owner: AccountRef = accountRefSchema.parse("fake:1:0x000000a1");
const thief: AccountRef = accountRefSchema.parse("fake:1:0x000000b2");
const console: EngineCaller = {
  credential: "dev_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  client: { kind: "console", version: "test" },
  scopes: ["read", "confirm", "admin"],
};

function setRescue(test: TestEngine, address: AccountRef) {
  return test.engine.handlers["safety/setRescueAddress"](testCall({ address }, console));
}

function cancelChange(test: TestEngine) {
  return test.engine.handlers["safety/cancelRescueChange"](testCall({}, console));
}

// The test engine with the owner's rescue address in effect since a day before the test.
async function withRescue(): Promise<TestEngine> {
  const test = await startTestEngine();
  await test.stores.install.changeRescue(
    { address: owner, atMs: testNowMs - looseningWaitMs },
    live,
  );
  return test;
}

async function rescueNow(test: TestEngine) {
  return rescueAt(await test.stores.install.read(live), test.clock.now());
}

describe("a change of the rescue address", () => {
  it("pays the new address only 24 hours later, announced with that time", async () => {
    const test = await withRescue();
    const effectiveAt = testNowMs + looseningWaitMs;

    expect(await setRescue(test, thief)).toStrictEqual({ ok: true, value: { effectiveAt } });
    await test.clock.advance(looseningWaitMs - 1);
    expect((await rescueNow(test)).rescueAddress).toBe(owner);
    await test.clock.advance(1);
    expect((await rescueNow(test)).rescueAddress).toBe(thief);
    expect(test.pushes.filter((push) => push.topic === "notice")).toStrictEqual([
      {
        topic: "notice",
        kind: "notice/new",
        data: {
          key: "notice.rescueAddress",
          values: { address: "0x000000b2" },
          times: { when: effectiveAt },
        },
      },
    ]);
  });

  it("is cancelled from any surface that brakes, and the owner's address stays", async () => {
    const test = await withRescue();
    await setRescue(test, thief);

    expect(await cancelChange(test)).toStrictEqual({ ok: true, value: {} });
    await test.clock.advance(looseningWaitMs);
    expect(await rescueNow(test)).toStrictEqual({ rescueAddress: owner });
  });

  it("is journaled and pushed as a config change, both ways", async () => {
    const test = await withRescue();
    await setRescue(test, thief);
    await cancelChange(test);

    const entries = await test.stores.configJournal.list({ after: 0, limit: 10 }, live);
    const pendingRescue = { address: thief, atMs: testNowMs + looseningWaitMs };
    expect(
      entries.map(({ path, surface, before, after }) => ({ path, surface, before, after })),
    ).toStrictEqual([
      {
        path: "safety.rescueAddress",
        surface: "console",
        before: { rescueAddress: owner },
        after: { rescueAddress: owner, pendingRescue },
      },
      {
        path: "safety.rescueAddress",
        surface: "console",
        before: { rescueAddress: owner, pendingRescue },
        after: { rescueAddress: owner },
      },
    ]);
    expect(test.pushes.filter((push) => push.kind === "config/changed")).toHaveLength(2);
  });

  it("keeps its time when asked again, and answers now for the address in effect", async () => {
    const test = await withRescue();
    await setRescue(test, thief);
    await test.clock.advance(60_000);

    expect(await setRescue(test, thief)).toStrictEqual({
      ok: true,
      value: { effectiveAt: testNowMs + looseningWaitMs },
    });
    expect(await setRescue(test, owner)).toStrictEqual({
      ok: true,
      value: { effectiveAt: testNowMs + 60_000 },
    });
    expect(await rescueNow(test)).toStrictEqual({ rescueAddress: owner });
    expect(test.pushes.filter((push) => push.topic === "notice")).toHaveLength(1);
  });

  it("stores the address in its family's canonical form", async () => {
    const test = await withRescue();
    await setRescue(test, accountRefSchema.parse("fake:1:0x000000B2"));

    expect((await rescueNow(test)).pendingRescue?.address).toBe(thief);
  });

  it("refuses an address on an unknown chain or one its family cannot read", async () => {
    const test = await withRescue();

    expect(await setRescue(test, accountRefSchema.parse("fake:9:0x000000b2"))).toStrictEqual(
      err("protocol.bad_args"),
    );
    expect(await setRescue(test, accountRefSchema.parse("fake:1:nowhere"))).toStrictEqual(
      err("protocol.bad_args"),
    );
    expect(test.pushes).toStrictEqual([]);
  });

  it("changes nothing when nothing waits to be cancelled", async () => {
    const test = await withRescue();

    expect(await cancelChange(test)).toStrictEqual({ ok: true, value: {} });
    expect(test.pushes).toStrictEqual([]);
  });
});
