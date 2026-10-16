import { BinferenceError } from "@binference/core";
import { createRunningTurns } from "@binference/engine/chat";
import { testAgent } from "@binference/engine/testing";
import { textReply } from "@binference/runtime/testing";
import { afterEach, describe, expect, it } from "vitest";
import { skeletonCompositions, startSkeleton } from "../compose/test-skeleton.js";
import { superviseRuntime, watchChat } from "./runtime-machine.js";

// A schedule end to end: the owner sets one from the CLI in New York time, the engine's queue runs
// it at 09:00 there, the agent runtime takes the wake-up and runs a turn with the scripted model,
// and the turn's model call counts against the agent's budget of the day. The runtime starts once
// the clock reads 09:00, as after a restart, since a jump of hours would run out the deadlines of
// its connection.

const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });
const slow = { timeout: 30_000 };
const stops: (() => Promise<void>)[] = [];
// $100,000 per million input tokens: the scripted answer's 10 input tokens cost $1.
const price = { inputPerMTokUsd: 100_000_000_000n, outputPerMTokUsd: 0n, cachedPerMTokUsd: 0n };
// The skeleton's clock reads 2027-01-15T08:00:00Z, 03:00 in New York; 09:00 there is 14:00Z.
const nineInNewYork = Date.parse("2027-01-15T14:00:00Z");

const owner = () => ({ locale: "en", timezone: "America/New_York" }) as const;

afterEach(async () => {
  await Promise.all(stops.splice(0).map(async (stop) => stop()));
});

async function startMachine() {
  const [selfHosted] = skeletonCompositions;
  if (selfHosted === undefined) {
    throw new BinferenceError({ code: "test.no_composition", message: "No composition." });
  }
  const turns = createRunningTurns();
  const skeleton = await startSkeleton(selfHosted.parts(), { turns, owner });
  stops.push(async () => skeleton.close());
  const engine = { ...skeleton, stores: skeleton.parts.stores, server: skeleton.composed.server };
  const chat = watchChat(skeleton.client, testAgent);
  const replies = [textReply("Your portfolio did not move.")];
  const startRuntime = (): void => {
    const supervisor = superviseRuntime(engine, { turns, script: { replies, price } });
    stops.unshift(async () => supervisor.stop(AbortSignal.timeout(10_000)));
  };
  return { skeleton, chat, startRuntime };
}

describe("schedules end to end", () => {
  it("wakes the agent at the owner's 09:00 for one turn that spends its budget", slow, async () => {
    const { skeleton, chat, startRuntime } = await startMachine();
    const args = { agent: testAgent, when: { cron: "0 9 * * *" }, prompt: "Review my portfolio." };
    const set = await skeleton.client.call("schedule/create", args, live());
    await skeleton.composed.engine.runSchedules(live());
    await skeleton.clock.advance(nineInNewYork - skeleton.clock.now());
    await skeleton.composed.engine.runSchedules(live());
    startRuntime();
    await chat.turnsEnded(1);

    expect(set.nextAt).toBe(nineInNewYork);
    expect(chat.pushes.filter((push) => push.kind === "chat/turnEnded")).toMatchObject([
      { data: { outcome: "ok" } },
    ]);
    const today = { agent: testAgent, fromMs: nineInNewYork - 3_600_000, toMs: nineInNewYork + 1 };
    const spent = await skeleton.parts.stores.modelUsage.spent(today, live());
    expect(spent.map(({ usdMicros }) => usdMicros)).toStrictEqual([1_000_000n]);
    const [listed] = (await skeleton.client.call("schedule/list", {}, live())).items;
    expect(listed?.lastRun).toStrictEqual({
      due: nineInNewYork,
      at: nineInNewYork,
      outcome: "sent",
    });
  });
});
