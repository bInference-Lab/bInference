import { err, type Id, ok } from "@binference/core";
import { describe, expect, it } from "vitest";
import { expectOk, testCoin, testNowMs, testSwap, testToken } from "../intents/test-intents.js";
import type { AnswerCard } from "../operations/answer-card.js";
import {
  startTestEngine,
  type TestEngine,
  type TestEngineOptions,
  testCall,
  testCallers,
  testChains,
} from "../operations/test-engine.js";
import type { CardPress } from "./card-press.js";
import { type CardPresses, createCardPresses } from "./create-card-presses.js";
import { downAfterFirstQuote, worseAfterFirstQuote } from "./test-venues.js";

const live = { signal: new AbortController().signal };
const ownerId = 7_012_345_678;
const strangerId = 7_099_999_999;
const unknownRef = "ZZZZZZZZZZZZZZZZ";

interface Pressing {
  readonly test: TestEngine;
  readonly presses: CardPresses;
  readonly intent: Id<"int">;
  /** The callback reference of the intent's first card version. */
  readonly ref: string;
}

async function refsOf(test: TestEngine, intent: Id<"int">): Promise<readonly string[]> {
  const cards = await test.stores.intents.cards(intent, live);
  return cards.map((card) => card.callbackRef ?? "");
}

// An MCP proposal of the test swap, with its first card open for the owner's tap.
async function pressing(options: TestEngineOptions = {}, owner?: number): Promise<Pressing> {
  const test = await startTestEngine(options);
  const view = expectOk(
    await test.engine.handlers["intent/propose"](testCall(testSwap(), testCallers.mcp)),
  );
  const presses = createCardPresses({
    intents: test.stores.intents,
    answer: test.engine.answer,
    ownerId: async () => Promise.resolve(owner ?? ownerId),
    chains: testChains(),
  });
  const [ref = ""] = await refsOf(test, view.intent);
  return { test, presses, intent: view.intent, ref };
}

function press(ref: string, decision: CardPress["decision"], presserId = ownerId): CardPress {
  return { ref, decision, presserId };
}

async function stateOf({ test, intent }: Pressing): Promise<string | undefined> {
  return (await test.stores.intents.get(intent, live))?.state;
}

// The answer step of an engine that lost the intent between the lookup and the answer.
const lost: AnswerCard = async () => Promise.resolve(err("not_found"));

describe("the card presses", () => {
  it("store the owner's Confirm through the confirmations, then fill the paper intent", async () => {
    const subject = await pressing();
    const standing = await subject.presses.answer(press(subject.ref, "confirm"), live);
    const answeredBy = { surface: "telegram", by: `tg:${String(ownerId)}` };
    const fill = {
      amountIn: { asset: testCoin, base: 1_000_000n },
      amountOut: { asset: testToken, base: 2_000_000n },
    };
    expect(standing).toStrictEqual({
      status: "closed",
      closing: { outcome: "confirmed", answeredBy, atMs: testNowMs },
      paper: {
        fill,
        assets: {
          [testCoin]: { symbol: "FAKE", name: "Fake", decimals: 18, verified: true },
          [testToken]: { symbol: "TKN", name: "Token", decimals: 6, verified: true },
        },
      },
    });
    const view = expectOk(
      await subject.test.engine.handlers["intent/get"](testCall({ intent: subject.intent })),
    );
    expect([view.state, view.outcome?.executions]).toStrictEqual([
      "paper_filled",
      [
        {
          amountIn: { asset: testCoin, base: 1_000_000n },
          amountOut: { asset: testToken, base: 2_000_000n },
          at: testNowMs,
        },
      ],
    ]);
    const confirmation = await subject.test.stores.intents.confirmation(subject.intent, live);
    expect(confirmation).toMatchObject({ bySurface: "telegram", byRef: answeredBy.by });
  });

  it("close the card on Cancel, and answer every later press with the first closing", async () => {
    const subject = await pressing();
    const denied = await subject.presses.answer(press(subject.ref, "deny"), live);
    expect(denied).toMatchObject({ status: "closed", closing: { outcome: "denied" } });
    const later = await subject.presses.answer(press(subject.ref, "confirm"), live);
    expect(later).toStrictEqual(denied);
    expect(await stateOf(subject)).toBe("denied");
  });

  it("answer nothing for a stranger, a reference no card has, or before the owner pairs", async () => {
    const subject = await pressing();
    const stranger = press(subject.ref, "confirm", strangerId);
    expect(await subject.presses.answer(stranger, live)).toStrictEqual({ status: "unknown" });
    const unknown = press(unknownRef, "confirm");
    expect(await subject.presses.answer(unknown, live)).toStrictEqual({ status: "unknown" });
    const unpaired = createCardPresses({
      intents: subject.test.stores.intents,
      answer: subject.test.engine.answer,
      ownerId: async () => Promise.resolve(undefined),
      chains: testChains(),
    });
    const fromOwner = press(subject.ref, "confirm");
    expect(await unpaired.answer(fromOwner, live)).toStrictEqual({ status: "unknown" });
    expect(await stateOf(subject)).toBe("awaiting_confirmation");
  });

  it("keep the card open with the reason when the re-quote fails", async () => {
    const subject = await pressing({ venues: [downAfterFirstQuote()] });
    await subject.test.clock.advance(11_000);
    const standing = await subject.presses.answer(press(subject.ref, "confirm"), live);
    expect(standing).toStrictEqual({ status: "open", reason: "venue_down" });
    expect(await stateOf(subject)).toBe("awaiting_confirmation");
  });

  it("keep a live intent's card open as locked while the engine is locked", async () => {
    const subject = await pressing({ agent: { mode: "live" }, isLocked: () => true });
    const standing = await subject.presses.answer(press(subject.ref, "confirm"), live);
    expect(standing).toStrictEqual({ status: "locked" });
    expect(await stateOf(subject)).toBe("awaiting_confirmation");
  });

  it("keep the card open on a worse re-quote, and on a Confirm of the older version", async () => {
    const subject = await pressing({ venues: [worseAfterFirstQuote()] });
    await subject.test.clock.advance(11_000);
    const reopened = await subject.presses.answer(press(subject.ref, "confirm"), live);
    expect(reopened).toStrictEqual({ status: "open" });
    const refs = await refsOf(subject.test, subject.intent);
    expect(refs).toHaveLength(2);
    const older = await subject.presses.answer(press(subject.ref, "confirm"), live);
    expect(older).toStrictEqual({ status: "open" });
    expect(await stateOf(subject)).toBe("awaiting_confirmation");
  });

  it("answer nothing for a card that closed without a closing, such as a cancel", async () => {
    const subject = await pressing();
    const answered = await subject.test.engine.answer(
      {
        intent: subject.intent,
        decision: "deny",
        cardVersion: 1,
        answeredBy: { surface: "cli", by: testCallers.cli.credential },
      },
      live,
    );
    const snapshot = expectOk(answered).intent;
    const { closing: _closing, ...withoutClosing } = snapshot.stored;
    const cancelled: AnswerCard = async () =>
      Promise.resolve(
        ok({
          outcome: { verdict: "closed" },
          intent: { ...snapshot, stored: withoutClosing },
        }),
      );
    const presses = createCardPresses({
      intents: subject.test.stores.intents,
      answer: cancelled,
      ownerId: async () => Promise.resolve(ownerId),
      chains: testChains(),
    });
    expect(await presses.answer(press(subject.ref, "confirm"), live)).toStrictEqual({
      status: "unknown",
    });
    const forLost = createCardPresses({
      intents: subject.test.stores.intents,
      answer: lost,
      ownerId: async () => Promise.resolve(ownerId),
      chains: testChains(),
    });
    expect(await forLost.answer(press(subject.ref, "confirm"), live)).toStrictEqual({
      status: "unknown",
    });
  });

  it("refuse a press on an aborted signal and answer nothing", async () => {
    const subject = await pressing();
    const reason = new Error("stopped by the caller");
    const aborted = { signal: AbortSignal.abort(reason) };
    await expect(subject.presses.answer(press(subject.ref, "confirm"), aborted)).rejects.toBe(
      reason,
    );
    expect(await stateOf(subject)).toBe("awaiting_confirmation");
  });
});
