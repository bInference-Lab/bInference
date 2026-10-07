import type { Venue } from "@binference/chain";
import { createFakeVenue } from "@binference/chain/testing";
import { err, type Id } from "@binference/core";
import type { IntentView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { expectOk, testCoin, testNowMs, testSwap, testToken } from "../intents/test-intents.js";
import {
  startTestEngine,
  type TestEngine,
  type TestEngineOptions,
  testCall,
  testCallers,
} from "./test-engine.js";

const live = { signal: new AbortController().signal };
const unknownIntent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000009" as Id<"int">;
const unknownCard = "crd_0190f1c2-3a4b-7c5d-8e6f-000000000009" as Id<"crd">;

interface Proposed {
  readonly test: TestEngine;
  readonly view: IntentView;
  readonly card: Id<"crd">;
}

async function proposed(options: TestEngineOptions = {}): Promise<Proposed> {
  const test = await startTestEngine(options);
  const answer = await test.engine.handlers["intent/propose"](testCall(testSwap()));
  if (!answer.ok || answer.value.card === undefined) {
    throw new Error("Expected an intent with a card.");
  }
  return { test, view: answer.value, card: answer.value.card.card };
}

async function confirm({ test, view, card }: Proposed, caller = testCallers.cli, cardVersion = 1) {
  const args = { intent: view.intent, card, cardVersion };
  return test.engine.handlers["intent/confirm"](testCall(args, caller));
}

// A venue that quotes once, then throws, as a venue that went down after the first quote.
function failingAfterFirstQuote(): Venue {
  const venue = createFakeVenue();
  let quotes = 0;
  return {
    ...venue,
    async quote(request, options) {
      quotes += 1;
      if (quotes > 1) {
        throw new Error("The venue is down.");
      }
      return venue.quote(request, options);
    },
  };
}

describe("the intent handlers", () => {
  it("confirms the current card, closes it and fills the paper intent at the quote", async () => {
    const intent = await proposed();
    const answer = expectOk(await confirm(intent));
    expect(answer.state).toBe("paper_filled");
    expect(answer.outcome).toStrictEqual({
      executions: [
        {
          amountIn: { asset: testCoin, base: 1_000_000n },
          amountOut: { asset: testToken, base: 2_000_000n },
          at: testNowMs,
        },
      ],
    });
    const cards = await intent.test.stores.intents.cards(intent.view.intent, live);
    const stored = await intent.test.stores.intents.confirmation(intent.view.intent, live);
    expect(cards.map((card) => card.closeReason)).toStrictEqual(["confirmed"]);
    expect(stored).toMatchObject({
      cardId: intent.card,
      cardVersion: 1,
      termsHash: cards[0]?.termsHash,
      bySurface: "cli",
      byRef: testCallers.cli.credential,
      expiresAtMs: testNowMs + 60_000,
    });
  });

  it("names the console or the Mini App as the surface a device answered on", async () => {
    const consoleIntent = await proposed();
    const device = { ...testCallers.cli, credential: "dev_0190f1c2-3a4b-7c5d-8e6f-000000000001" };
    await confirm(consoleIntent, { ...device, client: { kind: "console", version: "test" } });
    const miniIntent = await proposed();
    await confirm(miniIntent, { ...device, client: { kind: "mini", version: "test" } });
    const surfaces = await Promise.all(
      [consoleIntent, miniIntent].map(async ({ test, view }) =>
        test.stores.intents.confirmation(view.intent, live),
      ),
    );
    expect(surfaces.map((stored) => stored?.bySurface)).toStrictEqual(["console", "mini"]);
  });

  it("cancels the intent on deny and closes its card", async () => {
    const intent = await proposed();
    const args = { intent: intent.view.intent, card: intent.card };
    const answer = expectOk(await intent.test.engine.handlers["intent/deny"](testCall(args)));
    expect(answer.state).toBe("denied");
    expect(intent.test.pushes.map((push) => push.kind).slice(-3)).toStrictEqual([
      "intent/changed",
      "card/closed",
      "ledger/appended",
    ]);
  });

  it("refuses a card that is not the intent's, or a version the card does not have", async () => {
    const intent = await proposed();
    const { handlers } = intent.test.engine;
    const answers = [
      await confirm({ ...intent, card: unknownCard }),
      await confirm(intent, testCallers.cli, 2),
      await handlers["intent/deny"](testCall({ intent: intent.view.intent, card: unknownCard })),
    ];
    expect(answers).toStrictEqual([
      err("intent.card_changed"),
      err("intent.card_changed"),
      err("intent.card_changed"),
    ]);
  });

  it("answers an intent it does not hold as not found", async () => {
    const { test } = await proposed();
    const { handlers } = test.engine;
    const args = { intent: unknownIntent, card: unknownCard };
    expect([
      await handlers["intent/get"](testCall({ intent: unknownIntent })),
      await handlers["intent/confirm"](testCall({ ...args, cardVersion: 1 })),
      await handlers["intent/deny"](testCall(args)),
    ]).toStrictEqual([err("intent.not_found"), err("intent.not_found"), err("intent.not_found")]);
  });

  it("refuses a Confirm once the card has expired, and a second answer after the first", async () => {
    const late = await proposed();
    await late.test.clock.advance(60_000);
    expect(await confirm(late)).toStrictEqual(err("intent.expired"));
    const twice = await proposed();
    await confirm(twice);
    expect(await confirm(twice)).toStrictEqual(err("intent.wrong_state"));
  });

  it("quotes a stale card again before the Confirm counts", async () => {
    const intent = await proposed();
    await intent.test.clock.advance(11_000);
    const answer = expectOk(await confirm(intent));
    expect(answer.state).toBe("paper_filled");
    expect(answer.quote?.quotedAt).toBe(testNowMs + 11_000);
  });

  it("keeps the card open when the re-quote fails", async () => {
    const intent = await proposed({ venues: [failingAfterFirstQuote()] });
    await intent.test.clock.advance(11_000);
    expect(await confirm(intent)).toStrictEqual(err("quote.venue_down"));
    const view = await intent.test.engine.handlers["intent/get"](
      testCall({ intent: intent.view.intent }),
    );
    expect(expectOk(view).state).toBe("awaiting_confirmation");
  });

  it("answers a card of an intent it does not hold as not found when a surface taps it", async () => {
    const { test } = await proposed();
    const answeredBy = { surface: "telegram", by: "1" } as const;
    const answer = {
      intent: unknownIntent,
      decision: "confirm",
      cardVersion: 1,
      answeredBy,
    } as const;
    await expect(test.engine.answer(answer, live)).resolves.toStrictEqual(err("not_found"));
  });
});
