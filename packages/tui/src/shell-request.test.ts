import { afterEach, describe, expect, it } from "vitest";
import {
  type ChatAnswers,
  type ChatHarness,
  harnessAgent,
  harnessNowMs,
  startChat,
} from "./testing/chat-harness.js";

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
  reason: "unlisted",
  canAlwaysAllow: true,
  createdAt: harnessNowMs,
  closesAt: harnessNowMs + 600_000,
};

// A chat whose engine holds `open` as the agent's open shell request, which a test may change.
async function chatWith(answers: ChatAnswers = {}) {
  const open = { items: [] as object[] };
  const chat = startChat({
    "shell/requests": () => ({ items: open.items }),
    "shell/answer": () => ({ outcome: "allowed_always" }),
    ...answers,
  });
  chats.push(chat);
  await chat.settle();
  return { chat, open };
}

function answersOf(chat: ChatHarness): readonly object[] {
  return chat.calls.filter((call) => call.op === "shell/answer").map((call) => call.args);
}

describe("the agent's shell request in terminal chat", () => {
  it("prints the request with its keys, and answers Always allow with the key 2", async () => {
    const { chat, open } = await chatWith();
    open.items = [view];
    chat.push(`chat:${harnessAgent}`, "chat/shellRequest", view);
    await chat.settle();
    expect(chat.rows().slice(-7)).toStrictEqual([
      "main asks to run a command",
      "git status",
      "In /srv/project",
      "No allowed command covers it.",
      "Answer by 09:40:00.",
      "Press 1 to allow once, 2 to always allow, 3 to refuse.",
      "› ",
    ]);
    chat.press("2");
    await chat.settle();
    expect(answersOf(chat)).toStrictEqual([{ request, answer: "always" }]);
    open.items = [];
    const closed = { agent: harnessAgent, request, outcome: "allowed_always" };
    chat.push(`chat:${harnessAgent}`, "chat/shellRequestClosed", closed);
    await chat.settle();
    expect(chat.rows().slice(-2)).toStrictEqual([
      `${String.fromCodePoint(0x2705)} Allowed, and kept as an allowed command.`,
      "› ",
    ]);
  });

  it("offers two keys where Always allow is not, the second refusing", async () => {
    const { chat, open } = await chatWith();
    const unread = { ...view, reason: "unreadable", canAlwaysAllow: false };
    open.items = [unread];
    chat.push(`chat:${harnessAgent}`, "chat/shellRequest", unread);
    await chat.settle();
    expect(chat.rows()).toContain("Press 1 to allow once, 2 to refuse.");
    expect(chat.rows()).toContain(
      "Always allow is not offered: this command runs other code, or binference cannot judge it in full.",
    );
    chat.press("2");
    await chat.settle();
    expect(answersOf(chat)).toStrictEqual([{ request, answer: "refuse" }]);
  });

  it("says a request another surface answered first is no longer open", async () => {
    const closedError = Object.assign(new Error("closed"), { code: "shell.request_closed" });
    const { chat, open } = await chatWith({
      "shell/answer": () => {
        throw closedError;
      },
    });
    open.items = [view];
    chat.push(`chat:${harnessAgent}`, "chat/shellRequest", view);
    await chat.settle();
    chat.press("1");
    await chat.settle();
    expect(chat.rows()).toContain("This request is no longer open.");
  });
});
