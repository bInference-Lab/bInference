import { afterEach, describe, expect, it } from "vitest";
import {
  type ChatAnswers,
  type ChatHarness,
  harnessAgent,
  startChat,
} from "./testing/chat-harness.js";

const session = "ses_0190f1c2-3a4b-7c5d-8e6f-000000000002";
const ctrlC = "\u0003";
const chats: ChatHarness[] = [];

afterEach(async () => {
  for (const chat of chats.splice(0)) {
    chat.press(ctrlC);
    // oxlint-disable-next-line eslint/no-await-in-loop -- each chat ends before the next test
    await chat.ended;
  }
});

async function opened(answers: ChatAnswers = {}): Promise<ChatHarness> {
  const chat = startChat(answers);
  chats.push(chat);
  await chat.settle();
  return chat;
}

const goal = {
  agent: harnessAgent,
  session,
  objective: "Find three tokens",
  status: "active",
  spentUsdMicros: "500000",
  goalTurns: 3,
  startedAt: 1,
  updatedAt: 2,
};

const note = {
  agent: harnessAgent,
  session,
  markdown: "2 of 3 found.",
  plan: [
    { text: "Scan", state: "done" },
    { text: "Report", state: "todo" },
  ],
  updatedAt: 3,
};

describe("a chat's goal in terminal chat", () => {
  it("reads the goal and its note on /goal, and sets, pauses and clears it", async () => {
    const chat = await opened({
      "goal/get": () => ({ goal, note }),
      "goal/set": () => ({ goal }),
      "goal/change": () => ({}),
    });
    chat.press("/goal\r/goal Find three tokens\r/goal pause\r/goal clear\r");
    await chat.settle();
    expect(chat.rows()).toContain("Goal (active): Find three tokens");
    expect(chat.rows()).toContain("Spent: $0.50.");
    expect(chat.rows()).toContain("1. Scan (done)");
    const ops = chat.calls.filter((call) => call.op.startsWith("goal/")).map((call) => call.args);
    expect(ops).toStrictEqual([
      { agent: harnessAgent },
      { agent: harnessAgent, objective: "Find three tokens" },
      { agent: harnessAgent, action: "pause" },
      { agent: harnessAgent, action: "clear" },
    ]);
    expect(chat.calls.filter((call) => call.op === "chat/post")).toStrictEqual([]);
  });

  it("prints each change of the goal and the progress note when it changes", async () => {
    const chat = await opened();
    const topic = `chat:${harnessAgent}` as const;
    chat.push(topic, "chat/goal", { agent: harnessAgent, session, change: "set", goal });
    chat.push(topic, "chat/goal", { agent: harnessAgent, session, change: "note", goal, note });
    await chat.settle();
    expect(chat.rows().slice(-6)).toStrictEqual([
      "Goal set: Find three tokens. The agent works on it turn after turn; /goal pause stops it.",
      "Progress note",
      "2 of 3 found.",
      "1. Scan (done)",
      "2. Report (to do)",
      "› ",
    ]);
  });
});
