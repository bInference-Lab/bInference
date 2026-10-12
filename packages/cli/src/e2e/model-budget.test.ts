import { BinferenceError } from "@binference/core";
import { createRunningTurns } from "@binference/engine/chat";
import { testAgent } from "@binference/engine/testing";
import { textReply } from "@binference/runtime/testing";
import { afterEach, describe, expect, it } from "vitest";
import { skeletonCompositions, startSkeleton } from "../compose/test-skeleton.js";
import { ownerBot, ownerText, superviseRuntime, watchChat } from "./runtime-machine.js";

// The model budget end to end: the owner writes in Telegram (the synthetic Bot API), the agent's
// one answer costs more than its $5 budget of the day, so its turn ends with the paused status
// line and the owner gets notice.budget once; the owner's next message starts no turn and gets the
// line again, and no model is called for it. The owner lives in Shanghai, so chat resumes at its
// midnight.

const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });
const slow = { timeout: 30_000 };
const stops: (() => Promise<void>)[] = [];
// $600,000 per million input tokens: the scripted answer's 10 input tokens cost $6.
const price = { inputPerMTokUsd: 600_000_000_000n, outputPerMTokUsd: 0n, cachedPerMTokUsd: 0n };
// The skeleton's clock reads 2027-01-15T08:00:00Z, 16:00 in Shanghai.
const midnight = Date.parse("2027-01-15T16:00:00Z");
const paused =
  "Chat paused until Jan 16, 2027, 00:00:00: today's model budget is spent. Orders keep running.";
const told =
  "main used today's model budget ($5.00). Chat resumes Jan 16, 2027, 00:00:00; orders keep running.";

// The owner reads English in Shanghai.
const owner = () => ({ locale: "en", timezone: "Asia/Shanghai" }) as const;

afterEach(async () => {
  await Promise.all(stops.splice(0).map(async (stop) => stop()));
});

async function startMachine() {
  const [selfHosted] = skeletonCompositions;
  if (selfHosted === undefined) {
    throw new BinferenceError({ code: "test.no_composition", message: "No composition." });
  }
  const { botApi, telegram } = await ownerBot();
  const turns = createRunningTurns();
  const skeleton = await startSkeleton(selfHosted.parts(), { telegram, turns, owner });
  stops.push(async () => skeleton.close());
  const engine = { ...skeleton, stores: skeleton.parts.stores, server: skeleton.composed.server };
  const chat = watchChat(skeleton.client, testAgent);
  const replies = [textReply("Hello from the agent.")];
  const supervisor = superviseRuntime(engine, { turns, script: { replies, price } });
  stops.unshift(async () => supervisor.stop(AbortSignal.timeout(10_000)));
  const composed = skeleton.composed.telegram;
  if (composed === undefined) {
    throw new BinferenceError({ code: "test.no_bot", message: "The skeleton serves the bot." });
  }
  // The bot sends notices from the outbox once it started.
  composed.start();
  return { skeleton, botApi, chat, telegram: composed };
}

describe("the model budget end to end", () => {
  it(
    "pauses chat once the day's budget is spent: the status line, one notice and no model call",
    slow,
    async () => {
      const { skeleton, botApi, chat, telegram } = await startMachine();
      await telegram.ingress.receive(ownerText("Hello", 1), live());
      await skeleton.clock.advance(300);
      await telegram.chat.idle();
      await chat.turnsEnded(1);
      await telegram.ingress.receive(ownerText("Are you there?", 2), live());
      await skeleton.clock.advance(300);
      await chat.pushed("chat/status", 2);
      await telegram.chat.idle();
      await telegram.idle();
      await skeleton.composed.notices.idle();
      await telegram.idle();

      const statuses = chat.pushes.filter((push) => push.kind === "chat/status");
      expect(statuses.map(({ data }) => data)).toMatchObject([
        { statusKey: "turn.budget", values: { when: midnight } },
        { statusKey: "turn.budget", values: { when: midnight } },
      ]);
      expect(chat.pushes.filter((push) => push.kind === "chat/turnEnded")).toMatchObject([
        { data: { outcome: "budget" } },
      ]);
      const texts = botApi.sent().map(({ text }) => text);
      expect(texts.filter((text) => text === paused)).toHaveLength(2);
      expect(texts.filter((text) => text === told)).toHaveLength(1);
      const today = { agent: testAgent, fromMs: midnight - 86_400_000, toMs: midnight };
      const spent = await skeleton.parts.stores.modelUsage.spent(today, live());
      expect(spent.map(({ usdMicros }) => usdMicros)).toStrictEqual([6_000_000n]);
    },
  );
});
