import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { requestDocument } from "../intents/intent-documents.schema.js";
import { intentKinds } from "../intents/intent-kind.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { expectOk, testAgent, testNowMs, testSwap } from "../intents/test-intents.js";
import {
  startTestEngine,
  type TestEngine,
  testCall,
  testCallers,
} from "../operations/test-engine.js";
import { autoModeGrantOf, autoModeTermsHash } from "./auto-mode-grant-of.js";
import { testSnapshot } from "./test-snapshot.js";

const order = "ord_0190f1c2-3a4b-7c5d-8e6f-000000000001" as Id<"ord">;

async function proposed(test: TestEngine): Promise<IntentSnapshot> {
  const call = testCall(testSwap(), testCallers.runtime);
  const view = expectOk(await test.engine.handlers["intent/propose"](call));
  return testSnapshot(test, view.intent);
}

function withStatus(snapshot: IntentSnapshot, status: object): IntentSnapshot {
  const { stored } = snapshot;
  return { ...snapshot, stored: { ...stored, status: { ...stored.status, ...status } } };
}

const chain = { networkFeeCapNativeBase: 7n };

describe("the auto grant of a stored intent", () => {
  it("grants an auto trade from its move to confirmed for a trade card's lifetime", async () => {
    const test = await startTestEngine({ agent: { approvalMode: "auto", mode: "live" } });
    await test.clock.advance(2_000);
    const snapshot = await proposed(test);
    expect(autoModeGrantOf(snapshot, chain)).toStrictEqual({
      approvalMode: "auto",
      agent: testAgent,
      intent: snapshot.record.id,
      kind: "swap",
      modeVersion: 0,
      termsHash: autoModeTermsHash(snapshot.record, 0),
      grantedAtMs: testNowMs + 2_000,
      expiresAtMs: testNowMs + 62_000,
      networkFeeCapNativeBase: 7n,
    });
  });

  it("grants nothing for an intent waiting for a tap, tapped, or filled for an order", async () => {
    const manual = await startTestEngine({ agent: { mode: "live" } });
    const waiting = await proposed(manual);
    expect(autoModeGrantOf(waiting, chain)).toBeUndefined();
    const card = waiting.history.cards[0]?.id as Id<"crd">;
    const confirm = { intent: waiting.record.id, card, cardVersion: 1 };
    expectOk(await manual.engine.handlers["intent/confirm"](testCall(confirm)));
    const tapped = await testSnapshot(manual, waiting.record.id);
    expect(tapped.record.state).toBe("confirmed");
    expect(autoModeGrantOf(tapped, chain)).toBeUndefined();
    const auto = await startTestEngine({ agent: { approvalMode: "auto", mode: "live" } });
    const filled = withStatus(await proposed(auto), { authorizedBy: { order } });
    expect(autoModeGrantOf(filled, chain)).toBeUndefined();
  });

  it("grants nothing for a kind the auto mode never authorizes, or before confirmed", async () => {
    const test = await startTestEngine({ agent: { approvalMode: "auto", mode: "live" } });
    const snapshot = await proposed(test);
    const granted = intentKinds.filter((kind) =>
      autoModeGrantOf({ ...snapshot, record: { ...snapshot.record, kind } }, chain),
    );
    expect(granted).toStrictEqual(["swap", "buy", "sell", "lend", "stake"]);
    const events = snapshot.history.events.filter((event) => event.toState !== "confirmed");
    const unconfirmed = { ...snapshot, history: { ...snapshot.history, events } };
    expect(autoModeGrantOf(unconfirmed, chain)).toBeUndefined();
  });

  it("hashes the auto terms as the signer's known answer", () => {
    const record = {
      id: "int_0190f1c2-3a4b-7c5d-8e6f-000000000001",
      request: { kind: "swap", amount: { base: "5" } },
      quote: { minOut: { base: "9" } },
    } as unknown as IntentRecord;
    // The SHA-256 of {"approvalMode":"auto","intent":"int_0190f1c2-3a4b-7c5d-8e6f-000000000001",
    // "modeVersion":3,"quote":{"minOut":{"base":"9"}},"request":{"amount":{"base":"5"},"kind":"swap"}}
    expect(autoModeTermsHash(record, 3)).toBe(
      "c0765930400e7b06b24af8da613783887162484400f974501e59238c5f37e95a",
    );
  });

  it("binds the terms hash to the intent, its mode version, request and quote", async () => {
    const test = await startTestEngine({ agent: { approvalMode: "auto", mode: "live" } });
    const { record } = await proposed(test);
    const hashes = new Set([
      autoModeTermsHash(record, 0),
      autoModeTermsHash(record, 1),
      autoModeTermsHash(
        { ...record, id: "int_0190f1c2-3a4b-7c5d-8e6f-00000000000f" as Id<"int"> },
        0,
      ),
      autoModeTermsHash(
        { ...record, request: requestDocument.encode(testSwap({ amount: { base: 2n } })) },
        0,
      ),
      autoModeTermsHash({ ...record, quote: null }, 0),
    ]);
    expect(hashes.size).toBe(5);
    expect(autoModeTermsHash(record, 0)).toBe(autoModeTermsHash({ ...record }, 0));
  });
});
