import { BinferenceError } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { type CallClient, createCallSlots } from "./call-slots.js";

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const clientBusy = new BinferenceError({ code: "client.busy", message: "full", retryable: true });
const status = { agent: "agt_1", turn: "trn_1", statusKey: "turn.failed" } as never;

// A client whose calls wait until the test settles them: answered, or refused `client.busy`.
function heldClient() {
  const settles: ((outcome: "answer" | "busy") => void)[] = [];
  const client: CallClient = {
    async call() {
      return new Promise((resolve, reject) => {
        settles.push((outcome) => (outcome === "answer" ? resolve({}) : reject(clientBusy)));
      });
    },
  };
  return { client, settle: (outcome: "answer" | "busy") => settles.shift()?.(outcome) };
}

// Whether the promise settled once every chain started so far ran, with no timer.
async function hasSettled(promise: Promise<void>): Promise<boolean> {
  const state = { isSettled: false };
  const mark = (): boolean => {
    state.isSettled = true;
    return true;
  };
  void promise.then(mark, mark);
  for (let round = 0; round < 20; round += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one turn of the microtask queue each
    await Promise.resolve();
  }
  return state.isSettled;
}

describe("createCallSlots", () => {
  it("frees a slot once a call that went out settles, and no sooner", async () => {
    const { client, settle } = heldClient();
    const slots = createCallSlots(client, createManualClock(0));
    const sent = slots.call("turn/status", status, live()).catch(() => undefined);
    const freed = slots.freed(new AbortController().signal);
    const early = await hasSettled(freed);
    settle("answer");
    await sent;
    expect([early, await hasSettled(freed)]).toStrictEqual([false, true]);
  });

  it("frees no slot when a call its client refused busy ends, since it held none", async () => {
    const { client, settle } = heldClient();
    const slots = createCallSlots(client, createManualClock(0));
    const refused = slots.call("turn/status", status, live()).catch(() => undefined);
    const freed = slots.freed(new AbortController().signal);
    settle("busy");
    await refused;
    expect(await hasSettled(freed)).toBe(false);
  });

  it("looks again after a second, for a slot a call of the client's own held", async () => {
    const clock = createManualClock(0);
    const slots = createCallSlots(heldClient().client, clock);
    const freed = slots.freed(new AbortController().signal);
    await clock.advance(999);
    const early = await hasSettled(freed);
    await clock.advance(1);
    expect([early, await hasSettled(freed)]).toStrictEqual([false, true]);
  });

  it("stops waiting with its signal's reason when the signal aborts", async () => {
    const slots = createCallSlots(heldClient().client, createManualClock(0));
    const stop = new AbortController();
    const freed = slots.freed(stop.signal).catch((error: unknown) => error);
    stop.abort(new Error("the end write's time is up"));
    expect(await freed).toBe(stop.signal.reason);
  });
});
