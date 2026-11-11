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

async function opened(): Promise<ChatHarness> {
  const chat = startChat({ "chat/stop": () => ({}) }, "zh");
  chats.push(chat);
  await chat.settle();
  return chat;
}

describe("the terminal chat's /stop, in Chinese", () => {
  it("says no answer ran when the agent is idle, and still stops it", async () => {
    const chat = await opened();
    chat.press("/stop\r");
    await chat.settle();
    expect(chat.calls.filter((call) => call.op === "chat/stop")).toHaveLength(1);
    expect(chat.rows().slice(-2)).toStrictEqual([
      "没有正在进行的回答。它的助手和命令都已结束，目标已暂停。你已确认的操作仍会执行。",
      "› ",
    ]);
  });

  it("says the answer stopped while one runs", async () => {
    const chat = await opened();
    chat.push(`chat:${harnessAgent}`, "chat/turnStarted", { agent: harnessAgent, turn });
    chat.press("/stop\r");
    await chat.settle();
    expect(chat.rows()).toContain(
      "Agent 的回答已停止。它的助手和命令都已结束，目标已暂停。你已确认的操作仍会执行。",
    );
  });
});
