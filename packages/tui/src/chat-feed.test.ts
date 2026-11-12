import { afterEach, describe, expect, it } from "vitest";
import { type ChatHarness, harnessAgent, startChat } from "./testing/chat-harness.js";

const ctrlC = "\u0003";
const turn = "trn_0190f1c2-3a4b-7c5d-8e6f-000000000004";
const chats: ChatHarness[] = [];

afterEach(async () => {
  for (const chat of chats.splice(0)) {
    chat.press(ctrlC);
    // oxlint-disable-next-line eslint/no-await-in-loop -- each chat ends before the next test
    await chat.ended;
  }
});

describe("the terminal chat's feed", () => {
  it("ends the answer it showed and says so when the agent's chats are deleted", async () => {
    const chat = startChat({});
    chats.push(chat);
    await chat.settle();
    chat.push(`chat:${harnessAgent}`, "chat/turnStarted", { agent: harnessAgent, turn });
    await chat.clock.advance(3_000);
    await chat.settle();
    expect(chat.rows().slice(-2)).toStrictEqual(["Working on it · 3 s", "› "]);
    chat.push(`chat:${harnessAgent}`, "chat/deleted", { agent: harnessAgent });
    await chat.settle();
    expect(chat.rows().slice(-2)).toStrictEqual([
      "The agent's chats were deleted. Your next message starts a new chat; its notes and files stay.",
      "› ",
    ]);
  });
});
