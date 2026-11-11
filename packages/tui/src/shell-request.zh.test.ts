import { afterEach, describe, expect, it } from "vitest";
import { type ChatHarness, harnessAgent, harnessNowMs, startChat } from "./testing/chat-harness.js";

const ctrlC = "\u0003";
const request = "shq_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const chats: ChatHarness[] = [];

afterEach(async () => {
  for (const chat of chats.splice(0)) {
    chat.press(ctrlC);
    // oxlint-disable-next-line eslint/no-await-in-loop -- each chat ends before the next test
    await chat.ended;
  }
});

const view = {
  request,
  agent: harnessAgent,
  job: "shj_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  command: "git status",
  folder: "/srv/project",
  reason: "always",
  canAlwaysAllow: true,
  createdAt: harnessNowMs,
  closesAt: harnessNowMs + 600_000,
};

describe("the agent's shell request in terminal chat, in Chinese", () => {
  it("prints the request and its keys in Chinese, and says how it ended", async () => {
    const open = { items: [view] as object[] };
    const chat = startChat(
      {
        "shell/requests": () => ({ items: open.items }),
        "shell/answer": () => ({ outcome: "refused" }),
      },
      "zh",
    );
    chats.push(chat);
    await chat.settle();
    expect(chat.rows().slice(-7)).toStrictEqual([
      "main 请求运行一条命令",
      "git status",
      "目录：/srv/project",
      "每条命令运行前都会询问你（shell.ask 为 always）。",
      "请在 09:40:00 前回答。",
      "按 1 允许一次，按 2 始终允许，按 3 拒绝。",
      "› ",
    ]);
    chat.press("3");
    await chat.settle();
    open.items = [];
    const closed = { agent: harnessAgent, request, outcome: "refused" };
    chat.push(`chat:${harnessAgent}`, "chat/shellRequestClosed", closed);
    await chat.settle();
    expect(chat.rows().slice(-2)).toStrictEqual([
      `${String.fromCodePoint(0x274c)} 已拒绝，没有运行任何命令。`,
      "› ",
    ]);
  });
});
