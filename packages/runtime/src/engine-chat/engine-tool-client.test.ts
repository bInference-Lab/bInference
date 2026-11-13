import type { CallableName } from "@binference/client";
import { BinferenceError } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import type { OperationShapes } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { type CallClient, createCallSlots } from "./call-slots.js";
import { createEngineToolClient } from "./engine-tool-client.js";
import { createReadLimit } from "./read-limit.js";
import { createResendingClient } from "./resending-client.js";

type Op = CallableName<OperationShapes>;

const busy = new BinferenceError({ code: "protocol.busy", message: "busy", retryable: true });
const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

// The tools' client over a client, with room for `reads` reads at once.
function toolsOver(client: CallClient, reads = 40) {
  const clock = createManualClock(0);
  const slots = createCallSlots(client, clock);
  const resending = createResendingClient(slots, { clock, random: createSeededRandom(3) });
  const tools = createEngineToolClient({ client: slots, resending, reads: createReadLimit(reads) });
  return { clock, tools };
}

// The attempts one call of the operation took through the tools' client before it gave up, on a
// client that refuses every call busy.
async function attemptsOf(op: Op): Promise<number> {
  const attempts: Op[] = [];
  const { clock, tools } = toolsOver({
    async call(called) {
      attempts.push(called);
      return Promise.reject(busy);
    },
  });
  const sent = tools.call(op, {}, live()).catch(() => 0);
  await clock.advance(10_000);
  await sent;
  return attempts.length;
}

// A client whose calls wait until the test answers them, oldest first.
function heldCalls() {
  const waiting: { readonly op: Op; readonly answer: () => void }[] = [];
  const client: CallClient = {
    async call(op) {
      return new Promise((resolve) => {
        waiting.push({ op, answer: () => resolve({}) });
      });
    },
  };
  return { client, waiting };
}

// Lets every chain of promises started so far run, with no timer.
async function chainsRun(): Promise<void> {
  for (let round = 0; round < 30; round += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one turn of the microtask queue each
    await Promise.resolve();
  }
}

describe("createEngineToolClient", () => {
  it.each<Op>([
    "portfolio/get",
    "quote/get",
    "asset/get",
    "agent/readFile",
    "facts/get",
    "inbox/readImage",
  ])("sends the read %s again when the engine refused it busy", async (op) => {
    expect(await attemptsOf(op)).toBe(5);
  });

  it.each<Op>(["helper/ended", "goal/continue", "goal/show", "image/made", "media/made"])(
    "sends the wake-up or goal line %s again when the engine refused it busy",
    async (op) => {
      expect(await attemptsOf(op)).toBe(5);
    },
  );

  it.each<Op>(["intent/propose", "order/create", "shell/run", "turn/chart", "notes/write"])(
    "sends %s once, as a proposal or a call other than a read",
    async (op) => {
      expect(await attemptsOf(op)).toBe(1);
    },
  );

  it("runs at most its reads at once, and each read past them once an earlier one ends", async () => {
    const { client, waiting } = heldCalls();
    const { tools } = toolsOver(client, 2);
    const reads = (["portfolio/get", "asset/get", "quote/get"] as const).map(async (op) =>
      tools.call(op, {}, live()),
    );
    const report = tools.call("helper/ended", {} as never, live());
    await chainsRun();
    const before = waiting.map(({ op }) => op).toSorted();
    waiting.find(({ op }) => op === "portfolio/get")?.answer();
    await chainsRun();
    expect([before, waiting.map(({ op }) => op).toSorted()]).toStrictEqual([
      ["asset/get", "helper/ended", "portfolio/get"],
      ["asset/get", "helper/ended", "portfolio/get", "quote/get"],
    ]);
    waiting.forEach(({ answer }) => answer());
    await Promise.all([...reads, report]);
  });
});
