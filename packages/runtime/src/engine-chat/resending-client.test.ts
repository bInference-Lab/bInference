import { BinferenceError, type Clock } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { type CallClient, createCallSlots } from "./call-slots.js";
import { createResendingClient } from "./resending-client.js";

/** One attempt the scripted client took: its operation, its key and when. */
interface Attempt {
  readonly op: string;
  readonly key?: string;
  readonly atMs: number;
}

const live = (): AbortSignal => new AbortController().signal;

function refusal(code: `${string}.${string}`): BinferenceError {
  return new BinferenceError({ code, message: code, retryable: true });
}

// A client that answers each attempt with the next outcome: a refusal it throws, or `{}` once the
// script has none left.
function scripted(clock: Clock, outcomes: readonly Error[]) {
  const attempts: Attempt[] = [];
  const client: CallClient = {
    async call(op, _args, options) {
      const outcome = outcomes[attempts.length];
      const key = options.key === undefined ? {} : { key: options.key };
      attempts.push({ op, ...key, atMs: clock.now() });
      if (outcome !== undefined) {
        throw outcome;
      }
      return {};
    },
  };
  return { client, attempts };
}

// Settles to the value or the rejection reason, so a test can move the clock first.
async function settled(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    (value) => value,
    (error: unknown) => error,
  );
}

function setup(outcomes: readonly Error[]) {
  const clock = createManualClock(0);
  const { client, attempts } = scripted(clock, outcomes);
  const slots = createCallSlots(client, clock);
  const resending = createResendingClient(slots, { clock, random: createSeededRandom(9) });
  return { clock, slots, resending, attempts };
}

const busy = refusal("protocol.busy");

// A client with room for one call: a second, while the first waits, is refused `client.busy`;
// the first waits until the test releases it.
function fullClient() {
  const sent: string[] = [];
  const held = { release: (): void => undefined, isHeld: false };
  const client: CallClient = {
    async call(op) {
      if (held.isHeld) {
        sent.push(`${op} refused`);
        throw refusal("client.busy");
      }
      sent.push(op);
      if (op !== "turn/status") {
        return {};
      }
      held.isHeld = true;
      await new Promise<void>((resolve) => {
        held.release = resolve;
      });
      held.isHeld = false;
      return {};
    },
  };
  return { client, sent, release: () => held.release() };
}

// Lets every chain of promises started so far run, with no timer.
async function settledTurns(): Promise<void> {
  for (let round = 0; round < 20; round += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one turn of the microtask queue each
    await Promise.resolve();
  }
}
const turn = { agent: "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001", turn: "trn_1" } as const;

describe("createResendingClient", () => {
  it("sends a write the engine refused busy again under the key of its first attempt", async () => {
    const { clock, resending, attempts } = setup([busy, busy]);
    const start = { ...turn, session: "ses_1", messages: [], outsideContent: false } as never;
    const answer = settled(resending.call("turn/start", start, { signal: live() }));
    await clock.advance(8_000);
    expect(await answer).toStrictEqual({});
    expect(attempts).toHaveLength(3);
    expect(new Set(attempts.map(({ key }) => key)).size).toBe(1);
    expect(attempts[0]?.key).toMatch(/^key_/);
  });

  it("keeps the key its caller named across the attempts", async () => {
    const { clock, resending, attempts } = setup([busy]);
    const end = { ...turn, outcome: "ok" } as never;
    const answer = settled(resending.call("turn/end", end, { signal: live(), key: "trn_1.end" }));
    await clock.advance(8_000);
    expect(await answer).toStrictEqual({});
    expect(attempts.map(({ key }) => key)).toStrictEqual(["trn_1.end", "trn_1.end"]);
  });

  it("sends a call again while the engine starts and while its own client is busy", async () => {
    const { clock, resending, attempts } = setup([
      refusal("engine.starting"),
      refusal("client.busy"),
    ]);
    const status = { ...turn, statusKey: "turn.failed" } as never;
    const answer = settled(resending.call("turn/status", status, { signal: live() }));
    await clock.advance(8_000);
    expect(await answer).toStrictEqual({});
    expect(attempts.map(({ key }) => key)).toStrictEqual([undefined, undefined, undefined]);
  });

  it.each<readonly [string, `${string}.${string}`]>([
    ["a timeout", "engine.timeout"],
    ["the engine stopping", "engine.stopping"],
    ["the runtime unavailable", "runtime.unavailable"],
  ])("never sends again a call refused for %s, which may have run", async (_name, code) => {
    const failure = refusal(code);
    const { clock, resending, attempts } = setup([failure]);
    const end = { ...turn, outcome: "ok" } as never;
    const answer = settled(resending.call("turn/end", end, { signal: live() }));
    await clock.advance(8_000);
    expect(await answer).toBe(failure);
    expect(attempts).toHaveLength(1);
  });

  it("gives up after 5 attempts the engine refused, after waits under 4 seconds in all", async () => {
    const { clock, resending, attempts } = setup([busy, busy, busy, busy, busy, busy]);
    const end = { ...turn, outcome: "ok" } as never;
    const answer = settled(resending.call("turn/end", end, { signal: live() }));
    await clock.advance(60_000);
    expect(await answer).toBe(busy);
    expect(attempts).toHaveLength(5);
    expect(attempts.at(-1)?.atMs).toBeLessThanOrEqual(3_750);
  });

  it("sends a call its client had no room for again as soon as a call of the link settles", async () => {
    const { client, sent, release } = fullClient();
    const clock = createManualClock(0);
    const slots = createCallSlots(client, clock);
    const resending = createResendingClient(slots, { clock, random: createSeededRandom(9) });
    const status = { ...turn, statusKey: "turn.failed" } as never;
    const held = slots.call("turn/status", status, { signal: live() });
    const end = { ...turn, outcome: "ok" } as never;
    const answer = resending.call("turn/end", end, { signal: live(), key: "trn_1.end" });
    await settledTurns();
    const before = [...sent];
    release();
    await Promise.all([held, answer]);
    expect([before, sent]).toStrictEqual([
      ["turn/status", "turn/end refused"],
      ["turn/status", "turn/end refused", "turn/end"],
    ]);
  });

  it("waits for room as long as its signal allows, never counting it as an attempt", async () => {
    const clientBusy = refusal("client.busy");
    const { clock, resending, attempts } = setup(Array.from({ length: 12 }, () => clientBusy));
    const stop = new AbortController();
    const status = { ...turn, statusKey: "turn.failed" } as never;
    const answer = settled(resending.call("turn/status", status, { signal: stop.signal }));
    await clock.advance(9_000);
    const before = attempts.length;
    stop.abort(new Error("the end write's time is up"));
    expect([before, await answer]).toStrictEqual([10, stop.signal.reason]);
  });
});
