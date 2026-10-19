import { testAgent } from "@binference/engine/testing";
import { callsReply, createSharedScript, textReply } from "@binference/runtime/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  type FirstChat,
  type Interview,
  interviewReplies,
  ownerTexts,
  pushed,
  runInterview,
  say,
  startFirstChat,
} from "./first-chat-machine.js";

const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });
const slow = { timeout: 30_000 };
const machines: FirstChat[] = [];

afterEach(async () => {
  await Promise.all(machines.splice(0).map(async (machine) => machine.stop()));
});

const english: Interview = {
  locale: "en",
  answers: [
    "0.5 BNB in all, at most 0.05 BNB a trade",
    "Hours, sometimes a day",
    "New launches on Flap and AI tokens",
    "Real volume and a team that ships",
    "Take profit at +50%, cut at -20%",
    "Never tokens with a tax above 5%",
    "Ask me before every buy",
    "Once a day, two lines at most",
  ],
  buttons: [
    ["Minutes", "Hours", "Days", "Weeks"],
    ["New launches", "Memes", "AI tokens", "Large caps"],
  ],
  strategy:
    "# Strategy\n\n- Budget: 0.5 BNB, at most 0.05 BNB a trade.\n- Holding time: hours, sometimes a day.\n- Exits: take profit at +50%, cut at -20%.\n",
  persona: "# Persona\n\n- Report once a day, in two lines at most.\n",
};

describe("the first chat", () => {
  it("asks in English, saves the strategy and the persona, and ends", slow, async () => {
    const script = interviewReplies(english);
    const machine = await startFirstChat("en", script);
    machines.push(machine);
    const { prefix, ...left } = await runInterview(machine, english, script);
    expect(prefix).toContain('<workspace-file name="FIRST-CHAT.md">\n# First chat\n');
    expect(left).toStrictEqual({
      strategy: english.strategy,
      persona: english.persona,
      firstChat: undefined,
      statusKeys: ["turn.firstChatDone"],
      asked: ["Q2", "Q3"],
      closed: ["answered", "answered"],
    });
    expect(prefix).toContain(
      "Ask question 2 with the answer buttons Minutes, Hours, Days and Weeks, and question 3 with New launches, Memes, AI tokens and Large caps, through ask_owner",
    );
  });

  it("goes on where it was after the runtime restarts in the middle", slow, async () => {
    const script = interviewReplies(english);
    const machine = await startFirstChat("en", script);
    machines.push(machine);
    const [first = "", second = ""] = english.answers;
    await say(machine, "hi", 1);
    await say(machine, first, 2);
    await machine.restart();
    await say(machine, second, 3);
    const afterRestart = script.requests[2];
    expect(ownerTexts(afterRestart)).toStrictEqual(["hi", first, second]);
    expect(afterRestart?.prefix).toContain('<workspace-file name="FIRST-CHAT.md">');
    expect(await machine.textOf("FIRST-CHAT.md")).toContain("1. How much of your money");
  });

  it("changes no limit when the owner asks to raise one in chat", slow, async () => {
    const pointer =
      "Your limits stay as they are. Change them with `binference limit set` in the terminal, or in the console.";
    const script = createSharedScript([
      callsReply([{ name: "limit_set", args: { dailyUsd: "1000" } }]),
      textReply(pointer),
    ]);
    const machine = await startFirstChat("en", script);
    machines.push(machine);
    const { client } = machine.skeleton;
    const before = await client.call("limit/get", { agent: testAgent }, live());
    await say(machine, "Raise my daily limit to 1000 USD", 1);
    const after = await client.call("limit/get", { agent: testAgent }, live());
    const offered = script.requests.flatMap(({ tools }) => tools.map(({ name }) => name));
    expect(offered.filter((name) => name.includes("limit"))).toStrictEqual([]);
    expect(after).toStrictEqual(before);
    expect(pushed(machine.chat, "chat/message", "text")).toStrictEqual([pointer]);
  });
});
