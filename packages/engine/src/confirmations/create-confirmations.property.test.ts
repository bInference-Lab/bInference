import type { AccountRef, AssetRef, ChainRef } from "@binference/chain";
import { type Bps, type Id, ok, type Result } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  createFakeConfirmationStore,
  type FakeConfirmationStore,
} from "../fakes/fake-confirmation-store.js";
import { createFakeSimulator } from "../fakes/fake-simulator.js";
import type { ConfirmationRecord } from "../intents/intent-trigger.js";
import type { ConfirmationStore, QuoteSource } from "../ports.js";
import type { CardAnswer, Surface } from "./card-answer.js";
import type { CardClosing } from "./card-closing.js";
import {
  type AnswerResult,
  createConfirmations,
  type ExpiryResult,
} from "./create-confirmations.js";
import type { IntentWrite, StoredIntent } from "./stored-intent.js";

const intent = "int_0190f1c2-3b4c-7d5e-8f60-718293a4b5c6" as Id<"int">;
const coin = "fake:1/slip44:1" as AssetRef;
const token = "fake:1/token:a" as AssetRef;
const live = { signal: new AbortController().signal };
const expiresAtMs = 70_000;

// Card version 1 on a quote from 9 s: fresh until 19 s, expired from 70 s.
const awaiting: StoredIntent = {
  intent,
  version: 1,
  status: {
    state: "awaiting_confirmation",
    kind: "swap",
    proposer: "agent_runtime",
    isPaper: false,
    hasOutsideContent: false,
    changedAtMs: 10_000,
    quote: { quotedAtMs: 9_000, minOutBase: 1_000_000n },
    card: { version: 1, openedAtMs: 10_000, expiresAtMs },
  },
  cards: {
    tradeExpiryMs: 60_000,
    otherExpiryMs: 600_000,
    requoteAfterMs: 10_000,
    requoteToleranceBps: 50 as Bps,
  },
};

const simulation = { spent: [], received: [{ asset: token, base: 1n }], simulatedAt: 0 };

interface Race {
  readonly answers: readonly CardAnswer[];
  readonly hasTimer: boolean;
  readonly nowMs: number;
  /** The minimum out a re-quote finds: within the tolerance, or past it. */
  readonly requoteMinOutBase: bigint;
}

const answerArbitrary: fc.Arbitrary<CardAnswer> = fc.record({
  intent: fc.constant(intent),
  decision: fc.constantFrom("confirm", "deny"),
  cardVersion: fc.constantFrom(1, 2),
  answeredBy: fc.record({
    surface: fc.constantFrom<Surface>("telegram", "console", "mini", "cli"),
    by: fc.constantFrom("tg_1", "dev_1", "tok_1"),
  }),
});

const raceArbitrary: fc.Arbitrary<Race> = fc.record({
  answers: fc.array(answerArbitrary, { minLength: 2, maxLength: 4 }),
  hasTimer: fc.boolean(),
  nowMs: fc.integer({ min: 11_000, max: 80_000 }),
  requoteMinOutBase: fc.constantFrom(995_000n, 900_000n),
});

// Every port call waits for the scheduler, which releases them in an order it picks.
function scheduledStore(
  scheduler: Readonly<fc.Scheduler>,
  store: ConfirmationStore,
): ConfirmationStore {
  return {
    read: async (id, options) => {
      await scheduler.schedule(Promise.resolve(), "read");
      return store.read(id, options);
    },
    write: async (write, options) => {
      await scheduler.schedule(Promise.resolve(), "write");
      return store.write(write, options);
    },
  };
}

function scheduledQuotes(scheduler: Readonly<fc.Scheduler>, race: Race): QuoteSource {
  return {
    requote: async () => {
      await scheduler.schedule(Promise.resolve(), "requote");
      return ok({
        quote: {
          route: [{ venue: "venue-a", shareBps: 10_000 as Bps }],
          amountIn: { asset: coin, base: 10n ** 17n },
          expectedOut: { asset: token, base: race.requoteMinOutBase },
          minOut: { asset: token, base: race.requoteMinOutBase },
          priceImpactBps: 8 as Bps,
          gas: { asset: coin, base: 10n ** 13n },
          quotedAt: race.nowMs - 100,
          expiresAt: race.nowMs + 60_000,
        },
        steps: [
          { chain: "fake:1" as ChainRef, from: "fake:1:wallet" as AccountRef, payload: "0x" },
        ],
      });
    },
  };
}

interface Settled {
  readonly results: readonly (AnswerResult | ExpiryResult)[];
  readonly closings: readonly CardClosing[];
  readonly confirmed: readonly ConfirmedWrite[];
  readonly writeCount: number;
  readonly final: StoredIntent;
}

interface ConfirmedWrite {
  readonly closing: CardClosing;
  readonly confirmation: ConfirmationRecord;
}

const closingVerdicts: ReadonlySet<string> = new Set(["confirmed", "denied", "expired"]);

function confirmedOf(write: IntentWrite): readonly ConfirmedWrite[] {
  const { closing, confirmation } = write;
  return closing === undefined || confirmation === undefined ? [] : [{ closing, confirmation }];
}

type Outcome = Result<AnswerResult | ExpiryResult, "not_found">;

async function settle(
  store: FakeConfirmationStore,
  runs: Promise<readonly Outcome[]>,
): Promise<Settled> {
  const results = await runs;
  const landed = store.landed();
  const final = await store.read(intent, live);
  if (final === undefined) {
    throw new Error("The intent is gone.");
  }
  return {
    results: results.flatMap((result) => (result.ok ? [result.value] : [])),
    closings: landed.flatMap((write) => (write.closing === undefined ? [] : [write.closing])),
    confirmed: landed.flatMap((write) => confirmedOf(write)),
    writeCount: landed.length,
    final,
  };
}

async function runRace(scheduler: Readonly<fc.Scheduler>, race: Race): Promise<Settled> {
  const store = createFakeConfirmationStore([awaiting]);
  const confirmations = createConfirmations({
    clock: createManualClock(race.nowMs),
    store: scheduledStore(scheduler, store),
    quotes: scheduledQuotes(scheduler, race),
    simulator: createFakeSimulator(new Map([[intent, ok(simulation)]])),
  });
  const runs = [
    ...race.answers.map(async (answer) => confirmations.answer(answer, live)),
    ...(race.hasTimer ? [confirmations.expire(intent, live)] : []),
  ];
  return settle(store, scheduler.waitFor(Promise.all(runs)));
}

function actorCount(race: Race): number {
  return race.answers.length + (race.hasTimer ? 1 : 0);
}

function winnerCount(settled: Settled): number {
  return settled.results.filter((result) => closingVerdicts.has(result.verdict)).length;
}

// A Cancel always closes the card, and so does the timer once the card has expired; otherwise the
// card may stay open, for example when every Confirm names a version that is not on show.
function wantedClosings(race: Race, found: number): number {
  const hasDeny = race.answers.some((answer) => answer.decision === "deny");
  return hasDeny || (race.hasTimer && race.nowMs >= expiresAtMs) ? 1 : found;
}

function isBeforeExpiry({ closing, confirmation }: ConfirmedWrite): boolean {
  return closing.outcome === "confirmed" && closing.atMs < confirmation.expiresAtMs;
}

describe("answers that race", () => {
  it.each([
    ["Confirm on Telegram first", 0],
    ["Cancel in the console first", 1],
  ])("give one decision when two surfaces answer at once: %s", async (_order, first) => {
    const store = createFakeConfirmationStore([awaiting]);
    const confirmations = createConfirmations({
      clock: createManualClock(15_000),
      store,
      quotes: { requote: async () => Promise.reject(new Error("The quote is fresh.")) },
      simulator: createFakeSimulator(new Map()),
    });
    const answers: readonly CardAnswer[] = [
      {
        intent,
        decision: "confirm",
        cardVersion: 1,
        answeredBy: { surface: "telegram", by: "tg_1" },
      },
      { intent, decision: "deny", cardVersion: 1, answeredBy: { surface: "console", by: "dev_1" } },
    ];
    const ordered = [...answers.slice(first), ...answers.slice(0, first)];
    const settled = await settle(
      store,
      Promise.all(ordered.map(async (answer) => confirmations.answer(answer, live))),
    );
    expect(settled.results.filter((result) => result.verdict === "closed")).toHaveLength(1);
    expect(settled.closings).toHaveLength(1);
    expect(winnerCount(settled)).toBe(1);
    expect([settled.final.status.state]).toStrictEqual(
      settled.closings.map((closing) => closing.outcome),
    );
  });

  it("close the card at most once, in any order, with one winner", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.scheduler(),
        raceArbitrary,
        async (scheduler: Readonly<fc.Scheduler>, race: Race) => {
          const settled = await runRace(scheduler, race);
          expect(settled.results).toHaveLength(actorCount(race));
          expect(settled.closings.length).toBeLessThanOrEqual(1);
          expect(settled.closings).toHaveLength(wantedClosings(race, settled.closings.length));
          expect(winnerCount(settled)).toBe(settled.closings.length);
          expect(settled.final.closing).toStrictEqual(settled.closings[0]);
          expect(settled.final.version).toBe(awaiting.version + settled.writeCount);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("never confirm a card version after its expiry", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.scheduler(),
        raceArbitrary,
        async (scheduler: Readonly<fc.Scheduler>, race: Race) => {
          const { confirmed } = await runRace(scheduler, race);
          expect(confirmed.length).toBeLessThanOrEqual(1);
          expect(confirmed.every((write) => isBeforeExpiry(write))).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });
});
