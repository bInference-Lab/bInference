import { err, type Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { expectOk, testAgent, testNowMs, testSwap } from "../intents/test-intents.js";
import { startTestEngine, testCall } from "./test-engine.js";

const otherAgent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000009" as Id<"agt">;

async function proposedTwice() {
  const test = await startTestEngine();
  await test.engine.handlers["intent/propose"](testCall(testSwap()));
  await test.engine.handlers["intent/propose"](testCall(testSwap()));
  return test;
}

describe("the ledger handlers", () => {
  it("lists the ledger's entries in order with their hashes, a page at a time", async () => {
    const test = await proposedTwice();
    const list = test.engine.handlers["ledger/list"];
    const first = expectOk(await list(testCall({ limit: 3 })));
    expect(first.items.map((item) => [item.seq, item.kind])).toStrictEqual([
      [1, "proposed"],
      [2, "awaiting_confirmation"],
      [3, "proposed"],
    ]);
    expect(first.next).toBe("3");
    expect(first.items[1]?.prevHash).toBe(first.items[0]?.hash);
    const rest = expectOk(await list(testCall({ cursor: "3", limit: 3 })));
    expect(rest.items.map((item) => [item.seq, item.agent])).toStrictEqual([[4, testAgent]]);
    expect(rest.next).toBeUndefined();
  });

  it("filters each page by agent and time", async () => {
    const test = await proposedTwice();
    const list = test.engine.handlers["ledger/list"];
    const pages = [
      await list(testCall({ agent: otherAgent })),
      await list(testCall({ from: testNowMs + 1 })),
      await list(testCall({ to: testNowMs })),
      await list(testCall({ agent: testAgent })),
    ];
    expect(pages.map((page) => expectOk(page).items.length)).toStrictEqual([0, 0, 4, 4]);
  });

  it("shows an install entry with an empty subject and data that is not an object", async () => {
    const test = await startTestEngine();
    test.stores.ledger.appendNow({
      id: "led_0190f1c2-3a4b-7c5d-8e6f-000000000001" as Id<"led">,
      atMs: 1,
      kind: "freeze",
      data: 7,
    });
    const page = expectOk(await test.engine.handlers["ledger/list"](testCall({})));
    expect(page.items).toStrictEqual([
      expect.objectContaining({ subject: "", data: { value: 7 } }),
    ]);
    expect(page.items[0]).not.toHaveProperty("agent");
  });

  it("refuses a cursor that is not an entry's number", async () => {
    const test = await startTestEngine();
    await expect(
      test.engine.handlers["ledger/list"](testCall({ cursor: "x" })),
    ).resolves.toStrictEqual(err("protocol.bad_args"));
  });
});
