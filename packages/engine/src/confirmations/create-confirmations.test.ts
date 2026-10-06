import type { AccountRef, AssetRef, ChainRef } from "@binference/chain";
import { type Bps, err, type Id, ok, type Result } from "@binference/core";
import { createManualClock, type ManualClock } from "@binference/core/testing";
import type { SimulationView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createFakeConfirmationStore } from "../fakes/fake-confirmation-store.js";
import { createFakeQuoteSource, type FakeQuoteSource } from "../fakes/fake-quote-source.js";
import { createFakeSimulator } from "../fakes/fake-simulator.js";
import type { QuoteFailure, SimulationFailure } from "../intents/intent-reason.js";
import type { ConfirmationStore, QuoteSource } from "../ports.js";
import type { CardAnswer } from "./card-answer.js";
import {
  type AnswerResult,
  type Confirmations,
  createConfirmations,
} from "./create-confirmations.js";
import type { BuiltQuote, StoredIntent } from "./stored-intent.js";

const intent = "int_0190f1c2-3b4c-7d5e-8f60-718293a4b5c6" as Id<"int">;
const unknown = "int_0190f1c2-3b4c-7d5e-8f60-000000000000" as Id<"int">;
const coin = "fake:1/slip44:1" as AssetRef;
const token = "fake:1/token:a" as AssetRef;
const telegram = { surface: "telegram", by: "tg_1" } as const;
const desk = { surface: "console", by: "dev_1" } as const;
const live = { signal: new AbortController().signal };

// Card version 1, opened at 10 s on a quote from 9 s, expiring at 70 s; the quote is stale after
// 19 s, and a re-quote may lose 0.5% of the minimum out before a new card opens.
const awaiting: StoredIntent = {
  intent,
  version: 4,
  status: {
    state: "awaiting_confirmation",
    kind: "swap",
    proposer: "agent_runtime",
    isPaper: false,
    hasOutsideContent: false,
    changedAtMs: 10_000,
    quote: { quotedAtMs: 9_000, minOutBase: 1_000_000n },
    card: { version: 1, openedAtMs: 10_000, expiresAtMs: 70_000 },
  },
  cards: {
    tradeExpiryMs: 60_000,
    otherExpiryMs: 600_000,
    requoteAfterMs: 10_000,
    requoteToleranceBps: 50 as Bps,
  },
};

function builtAt(quotedAt: number, minOutBase: bigint): BuiltQuote {
  return {
    quote: {
      route: [{ venue: "venue-a", shareBps: 10_000 as Bps }],
      amountIn: { asset: coin, base: 10n ** 17n },
      expectedOut: { asset: token, base: minOutBase + 10_000n },
      minOut: { asset: token, base: minOutBase },
      priceImpactBps: 8 as Bps,
      gas: { asset: coin, base: 10n ** 13n },
      quotedAt,
      expiresAt: quotedAt + 60_000,
    },
    steps: [{ chain: "fake:1" as ChainRef, from: "fake:1:wallet" as AccountRef, payload: "0x02" }],
  };
}

const simulation: SimulationView = {
  spent: [{ asset: coin, base: 10n ** 17n }],
  received: [{ asset: token, base: 1_000_500n }],
  simulatedAt: 29_800,
};

interface Setup {
  readonly nowMs: number;
  readonly stored?: StoredIntent;
  readonly requote?: Result<BuiltQuote, QuoteFailure>;
  readonly simulated?: Result<SimulationView, SimulationFailure>;
  readonly wrap?: (quotes: QuoteSource, clock: ManualClock) => QuoteSource;
}

function setup(options: Setup) {
  const clock = createManualClock(options.nowMs);
  const store = createFakeConfirmationStore([options.stored ?? awaiting]);
  const quotes: FakeQuoteSource = createFakeQuoteSource(
    new Map(options.requote === undefined ? [] : [[intent, options.requote]]),
  );
  const simulator = createFakeSimulator(new Map([[intent, options.simulated ?? ok(simulation)]]));
  const wrapped = options.wrap?.(quotes, clock) ?? quotes;
  const confirmations = createConfirmations({ clock, store, quotes: wrapped, simulator });
  return { clock, store, quotes, confirmations };
}

function confirmOn(answeredBy: CardAnswer["answeredBy"], cardVersion = 1): CardAnswer {
  return { intent, decision: "confirm", cardVersion, answeredBy };
}

function denyOn(answeredBy: CardAnswer["answeredBy"]): CardAnswer {
  return { intent, decision: "deny", cardVersion: 1, answeredBy };
}

async function answered(confirmations: Confirmations, answer: CardAnswer): Promise<AnswerResult> {
  const result = await confirmations.answer(answer, live);
  if (!result.ok) {
    throw new Error(`Expected an answer, got ${result.error}.`);
  }
  return result.value;
}

const secondCard = { version: 2, openedAtMs: 30_000, expiresAtMs: 90_000 };

const freshAtExpiry: StoredIntent = {
  ...awaiting,
  status: { ...awaiting.status, quote: { quotedAtMs: 65_000, minOutBase: 1_000_000n } },
};

describe("answering a card", () => {
  it("confirms the current card version while its quote is fresh", async () => {
    const { confirmations, quotes, store } = setup({ nowMs: 15_000 });
    const result = await answered(confirmations, confirmOn(telegram));
    expect(result.verdict).toBe("confirmed");
    expect(result.intent.status.state).toBe("confirmed");
    expect(result.intent.closing).toStrictEqual({
      outcome: "confirmed",
      answeredBy: telegram,
      atMs: 15_000,
    });
    expect(result.intent.confirmation).toStrictEqual({ cardVersion: 1, expiresAtMs: 70_000 });
    expect(quotes.asked()).toStrictEqual([]);
    expect(store.landed().map((write) => "requote" in write)).toStrictEqual([false]);
  });

  it("cancels the card on Cancel from any surface", async () => {
    const { confirmations } = setup({ nowMs: 15_000 });
    const result = await answered(confirmations, denyOn(desk));
    expect([result.verdict, result.intent.status.state]).toStrictEqual(["denied", "denied"]);
    expect(result.intent.closing).toStrictEqual({
      outcome: "denied",
      answeredBy: desk,
      atMs: 15_000,
    });
  });

  it("confirms up to the last millisecond and never once the card has expired", async () => {
    const before = setup({ nowMs: 69_999, stored: freshAtExpiry });
    const at = setup({ nowMs: 70_000, stored: freshAtExpiry });
    expect((await answered(before.confirmations, confirmOn(telegram))).verdict).toBe("confirmed");
    const late = await answered(at.confirmations, confirmOn(telegram));
    expect([late.verdict, late.intent.status.state]).toStrictEqual(["expired", "expired"]);
    expect(late.intent.confirmation).toBeUndefined();
    expect(late.intent.closing).toStrictEqual({ outcome: "expired", atMs: 70_000 });
  });

  it("closes the card as expired when Cancel comes after the expiry", async () => {
    const { confirmations } = setup({ nowMs: 70_000 });
    const result = await answered(confirmations, denyOn(desk));
    expect([result.verdict, result.intent.status.state]).toStrictEqual(["expired", "expired"]);
  });

  it("refuses a Confirm on an older card version and keeps the current one open", async () => {
    const second = { ...awaiting, status: { ...awaiting.status, card: { ...secondCard } } };
    const { confirmations, store } = setup({ nowMs: 15_000, stored: second });
    const result = await answered(confirmations, confirmOn(telegram, 1));
    expect(result.verdict).toBe("card_changed");
    expect(store.landed()).toStrictEqual([]);
  });

  it("expires the current card when a tap on an older one comes after its expiry", async () => {
    const second = { ...awaiting, status: { ...awaiting.status, card: { ...secondCard } } };
    const { confirmations } = setup({ nowMs: 90_000, stored: second });
    const result = await answered(confirmations, confirmOn(telegram, 1));
    expect([result.verdict, result.intent.status.state]).toStrictEqual(["expired", "expired"]);
  });

  it("changes nothing for an answer to a card that is already closed", async () => {
    const { confirmations, store } = setup({ nowMs: 15_000 });
    await answered(confirmations, confirmOn(telegram));
    const results = [
      await answered(confirmations, denyOn(desk)),
      await answered(confirmations, confirmOn(desk)),
      await answered(confirmations, confirmOn(desk, 2)),
    ];
    expect(results.map((result) => result.verdict)).toStrictEqual(["closed", "closed", "closed"]);
    expect(store.landed()).toHaveLength(1);
  });

  it("answers an unknown intent as not found", async () => {
    const { confirmations } = setup({ nowMs: 15_000 });
    const answer = { ...confirmOn(telegram), intent: unknown };
    await expect(confirmations.answer(answer, live)).resolves.toStrictEqual(err("not_found"));
  });

  it("stops with a retryable error after three writes that each lost a race", async () => {
    const { stale, reads } = alwaysStale(createFakeConfirmationStore([awaiting]));
    const crowded = createConfirmations({
      clock: createManualClock(15_000),
      store: stale,
      quotes: createFakeQuoteSource(new Map()),
      simulator: createFakeSimulator(new Map()),
    });
    await expect(crowded.answer(confirmOn(telegram), live)).rejects.toMatchObject({
      code: "confirmation.contended",
      retryable: true,
      details: { intent },
    });
    expect(reads()).toStrictEqual([intent, intent, intent]);
  });

  it("closes as expired an open intent that lost its card", async () => {
    const { card: _card, ...cardless } = awaiting.status;
    const { confirmations } = setup({ nowMs: 15_000, stored: { ...awaiting, status: cardless } });
    const result = await answered(confirmations, confirmOn(telegram));
    expect([result.verdict, result.intent.status.state]).toStrictEqual(["expired", "expired"]);
  });
});

// A store whose every write lost a race, and the reads it was asked for.
function alwaysStale(store: ConfirmationStore) {
  const reads: Id<"int">[] = [];
  const stale: ConfirmationStore = {
    read: async (id, options) => {
      reads.push(id);
      return store.read(id, options);
    },
    write: async () => Promise.resolve(err("stale")),
  };
  return { stale, reads: (): readonly Id<"int">[] => [...reads] };
}

describe("a tap on an old quote", () => {
  it("re-quotes and re-simulates, then confirms on a minimum out within the tolerance", async () => {
    const built = builtAt(29_500, 995_000n);
    const { confirmations, quotes, store } = setup({ nowMs: 30_000, requote: ok(built) });
    const result = await answered(confirmations, confirmOn(telegram));
    expect(result.verdict).toBe("confirmed");
    expect(result.intent.status.quote).toStrictEqual({ quotedAtMs: 29_500, minOutBase: 995_000n });
    expect(store.landed()[0]?.requote).toStrictEqual({ ...built, simulation });
    expect(quotes.asked()).toStrictEqual([intent]);
  });

  it("opens the next card version when the new minimum out is past the tolerance", async () => {
    const built = builtAt(29_500, 994_999n);
    const { confirmations, store } = setup({ nowMs: 30_000, requote: ok(built) });
    const result = await answered(confirmations, confirmOn(telegram));
    expect([result.verdict, result.intent.status.state]).toStrictEqual([
      "reopened",
      "awaiting_confirmation",
    ]);
    expect(result.intent.status.card).toStrictEqual(secondCard);
    expect([result.intent.closing, result.intent.confirmation]).toStrictEqual([
      undefined,
      undefined,
    ]);
    expect(store.landed()[0]?.requote).toStrictEqual({ ...built, simulation });
  });

  it("asks again on the new card version and refuses the old one", async () => {
    const { confirmations } = setup({ nowMs: 30_000, requote: ok(builtAt(29_500, 900_000n)) });
    await answered(confirmations, confirmOn(telegram));
    const old = await answered(confirmations, confirmOn(telegram, 1));
    const current = await answered(confirmations, confirmOn(desk, 2));
    expect([old.verdict, current.verdict]).toStrictEqual(["card_changed", "confirmed"]);
    expect(current.intent.confirmation).toStrictEqual({ cardVersion: 2, expiresAtMs: 90_000 });
  });

  it("keeps the card open when the venue gives no new quote", async () => {
    const { confirmations, store } = setup({ nowMs: 30_000, requote: err("no_route") });
    const result = await answered(confirmations, confirmOn(telegram));
    expect(result).toStrictEqual({
      verdict: "requote_failed",
      reason: "no_route",
      intent: awaiting,
    });
    expect(store.landed()).toStrictEqual([]);
  });

  it("keeps the card open when the new steps fail their simulation", async () => {
    const { confirmations } = setup({
      nowMs: 30_000,
      requote: ok(builtAt(29_500, 1_000_000n)),
      simulated: err("effects_differ"),
    });
    const result = await answered(confirmations, confirmOn(telegram));
    expect(result).toMatchObject({ verdict: "requote_failed", reason: "effects_differ" });
  });

  it("counts a new quote that is already old as a venue that did not answer", async () => {
    const { confirmations } = setup({ nowMs: 30_000, requote: ok(builtAt(15_000, 1_000_000n)) });
    const result = await answered(confirmations, confirmOn(telegram));
    expect(result).toMatchObject({ verdict: "requote_failed", reason: "venue_down" });
  });

  it("closes the card as expired when the new quote lands after the expiry", async () => {
    const { confirmations } = setup({
      nowMs: 30_000,
      requote: ok(builtAt(69_000, 1_000_000n)),
      wrap: (quotes, clock) => ({
        requote: async (id, options) => {
          await clock.advance(40_000);
          return quotes.requote(id, options);
        },
      }),
    });
    const result = await answered(confirmations, confirmOn(telegram));
    expect([result.verdict, result.intent.status.state]).toStrictEqual(["expired", "expired"]);
    expect(result.intent.confirmation).toBeUndefined();
  });
});

describe("the card timer", () => {
  it("leaves a card open until its expiry, then closes it as expired", async () => {
    const early = setup({ nowMs: 69_999 });
    const due = setup({ nowMs: 70_000 });
    const open = await early.confirmations.expire(intent, live);
    const closed = await due.confirmations.expire(intent, live);
    expect(open).toStrictEqual(ok({ verdict: "open", intent: awaiting }));
    expect(closed).toMatchObject(
      ok({ verdict: "expired", intent: { closing: { outcome: "expired", atMs: 70_000 } } }),
    );
  });

  it("finds a card an answer already closed, and an unknown intent", async () => {
    const { confirmations, clock } = setup({ nowMs: 15_000 });
    await answered(confirmations, confirmOn(telegram));
    await clock.advance(60_000);
    const late = await confirmations.expire(intent, live);
    expect(late).toMatchObject(ok({ verdict: "closed" }));
    await expect(confirmations.expire(unknown, live)).resolves.toStrictEqual(err("not_found"));
  });
});
