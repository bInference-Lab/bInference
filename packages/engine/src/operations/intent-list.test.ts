import { err } from "@binference/core";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { expectOk, testSwap } from "../intents/test-intents.js";
import { startTestEngine, testCall } from "./test-engine.js";

async function engineWithIntents(count: number) {
  const test = await startTestEngine();
  const propose = test.engine.handlers["intent/propose"];
  const intents = [];
  for (let index = 0; index < count; index += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each intent changes after the one before
    intents.push(expectOk(await propose(testCall(testSwap({ reason: `idea ${String(index)}` })))));
    // oxlint-disable-next-line eslint/no-await-in-loop -- each intent changes after the one before
    await test.clock.advance(1_000);
  }
  return { list: test.engine.handlers["intent/list"], intents };
}

describe("intent/list", () => {
  it("lists the intents that wait for the owner, the oldest first, with their cards", async () => {
    const { list, intents } = await engineWithIntents(2);
    const page = expectOk(await list(testCall({ state: "awaiting_confirmation" })));
    expect(page.items.map((item) => item.intent)).toStrictEqual(intents.map((item) => item.intent));
    expect(page.items[0]?.card?.version).toBe(1);
    expect(page.next).toBeUndefined();
  });

  it("pages on from the last intent of the page before", async () => {
    const { list, intents } = await engineWithIntents(3);
    const first = expectOk(await list(testCall({ limit: 2 })));
    expect(first.items.map((item) => item.intent)).toStrictEqual(
      intents.slice(0, 2).map((item) => item.intent),
    );
    const second = expectOk(await list(testCall({ limit: 2, cursor: first.next as string })));
    expect(second.items.map((item) => item.intent)).toStrictEqual([intents[2]?.intent]);
    expect(second.next).toBeUndefined();
  });

  it("keeps only the kind and the agent asked for", async () => {
    const { list } = await engineWithIntents(1);
    const sends = expectOk(await list(testCall({ kind: "send" })));
    expect(sends.items).toStrictEqual([]);
    const other = fixtureId("agt", 99);
    expect(expectOk(await list(testCall({ agent: other }))).items).toStrictEqual([]);
  });

  it("refuses a cursor it did not give", async () => {
    const { list } = await engineWithIntents(0);
    await expect(list(testCall({ cursor: "not-a-cursor" }))).resolves.toStrictEqual(
      err("protocol.bad_args"),
    );
  });
});
