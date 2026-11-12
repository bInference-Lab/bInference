import { idSchema } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createInboxHold } from "./inbox-hold.js";

const agent = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const other = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000002");
const clock = createManualClock();

// Whether a wait has not settled once every await chain queued before had its turns.
async function isWaiting(wait: Promise<void>): Promise<boolean> {
  const state = { isSettled: false };
  const settled = (): void => {
    state.isSettled = true;
  };
  void wait.then(settled, settled);
  await clock.advance(0);
  return !state.isSettled;
}

const live = (): AbortSignal => new AbortController().signal;

describe("createInboxHold", () => {
  it("holds a write of a held agent until the release, and lets every other agent's through", async () => {
    const hold = createInboxHold();
    const release = hold.hold([agent]);
    const held = hold.passed(agent, live());
    expect([hold.isHeld(agent), hold.isHeld(other)]).toStrictEqual([true, false]);
    expect(await isWaiting(held)).toBe(true);
    expect(await isWaiting(hold.passed(other, live()))).toBe(false);
    release();
    expect(await isWaiting(held)).toBe(false);
    expect(hold.isHeld(agent)).toBe(false);
  });

  it("waits for a second deletion that holds the agent as the first lets go", async () => {
    const hold = createInboxHold();
    const first = hold.hold([agent]);
    const held = hold.passed(agent, live());
    const second = hold.hold([agent]);
    first();
    expect(await isWaiting(held)).toBe(true);
    second();
    expect(await isWaiting(held)).toBe(false);
  });

  it("refuses a held write whose call is aborted, with its reason", async () => {
    const hold = createInboxHold();
    hold.hold([agent]);
    const call = new AbortController();
    const held = hold.passed(agent, call.signal);
    call.abort(new Error("The call timed out."));
    await expect(held).rejects.toThrow("The call timed out.");
    const aborted = AbortSignal.abort(new Error("Already aborted."));
    await expect(hold.passed(agent, aborted)).rejects.toThrow("Already aborted.");
  });
});
