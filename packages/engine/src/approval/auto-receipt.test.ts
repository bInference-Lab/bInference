import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { IntentCommit } from "../intents/intent-change.js";
import { authorizationDocument } from "../intents/intent-documents.schema.js";
import type { IntentState } from "../intents/intent-state.js";
import { expectOk, testCoin, testSwap, testToken } from "../intents/test-intents.js";
import { startTestEngine, testCall, testCallers } from "../operations/test-engine.js";
import { autoReceiptLine, autoReceiptPushes } from "./auto-receipt.js";
import { testSnapshot } from "./test-snapshot.js";

const order = "ord_0190f1c2-3a4b-7c5d-8e6f-000000000001" as Id<"ord">;
const fill = {
  amountIn: { asset: testCoin, base: 5n },
  amountOut: { asset: testToken, base: 9n },
};
const result = {
  type: "line",
  line: {
    key: "receipt.result",
    values: {
      sold: { type: "amount", amount: fill.amountIn },
      bought: { type: "amount", amount: fill.amountOut },
    },
  },
};
const link = "https://explorer.example/tx/0x01";

// A live intent the auto mode confirmed, as the store committed it.
async function autoLiveCommit(): Promise<IntentCommit> {
  const test = await startTestEngine({ agent: { approvalMode: "auto", mode: "live" } });
  const call = testCall(testSwap(), testCallers.runtime);
  const view = expectOk(await test.engine.handlers["intent/propose"](call));
  const { record, history } = await testSnapshot(test, view.intent);
  const event = history.events.at(-1);
  if (event === undefined) {
    throw new Error("Expected the intent's events.");
  }
  return { intent: record, event };
}

function movedTo(commit: IntentCommit, state: IntentState, changes: object = {}): IntentCommit {
  return { ...commit, intent: { ...commit.intent, state, ...changes } };
}

describe("the auto receipt", () => {
  it("shows a live auto trade with its result and explorer link", () => {
    expect(autoReceiptLine({ isPaper: false, fill, explorerLink: link })).toStrictEqual({
      key: "receipt.auto",
      values: { result, explorerLink: { type: "text", text: link } },
    });
  });

  it("shows a paper auto trade as a paper fill, since nothing went on chain", () => {
    expect(autoReceiptLine({ isPaper: true, fill })).toStrictEqual({
      key: "receipt.paper",
      values: { result },
    });
  });

  it("announces a paper auto trade once it fills, naming the intent", async () => {
    const test = await startTestEngine({ agent: { approvalMode: "auto" } });
    const call = testCall(testSwap(), testCallers.runtime);
    const view = expectOk(await test.engine.handlers["intent/propose"](call));
    expect(view.state).toBe("paper_filled");
    expect(test.pushes.filter((push) => push.topic === "notice")).toStrictEqual([
      {
        topic: "notice",
        kind: "notice/new",
        data: { key: "receipt.paper", agent: view.agent, values: {}, intent: view.intent },
      },
    ]);
  });

  it("announces a live auto trade once it reconciles, and at no step before", async () => {
    const commit = await autoLiveCommit();
    const { intent } = commit;
    expect(autoReceiptPushes(commit)).toStrictEqual([]);
    expect(autoReceiptPushes(movedTo(commit, "finalized"))).toStrictEqual([]);
    expect(autoReceiptPushes(movedTo(commit, "reconciled"))).toStrictEqual([
      {
        topic: "notice",
        kind: "notice/new",
        data: { key: "receipt.auto", agent: intent.agentId, values: {}, intent: intent.id },
      },
    ]);
  });

  it("sends no receipt notice for a tapped intent or an order fill", async () => {
    const test = await startTestEngine();
    const view = expectOk(await test.engine.handlers["intent/propose"](testCall(testSwap())));
    const confirm = { intent: view.intent, card: view.card?.card as Id<"crd">, cardVersion: 1 };
    expect(expectOk(await test.engine.handlers["intent/confirm"](testCall(confirm))).state).toBe(
      "paper_filled",
    );
    expect(test.pushes.filter((push) => push.topic === "notice")).toStrictEqual([]);
    const fillAuthorization = authorizationDocument.encode({ order });
    const filled = movedTo(await autoLiveCommit(), "reconciled", {
      authorizedBy: fillAuthorization,
    });
    expect(autoReceiptPushes(filled)).toStrictEqual([]);
  });
});
