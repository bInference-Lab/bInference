import { afterEach, describe, expect, it } from "vitest";
import {
  type ChatAnswers,
  type ChatHarness,
  harnessAgent,
  startChat,
} from "./testing/chat-harness.js";

const session = "ses_0190f1c2-3a4b-7c5d-8e6f-000000000002";
const turn = "trn_0190f1c2-3a4b-7c5d-8e6f-000000000004";
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

function opsOf(chat: ChatHarness, op: string): readonly object[] {
  return chat.calls.filter((call) => call.op === op).map((call) => call.args);
}

// The live area's last row: the line the owner types.
function lastRow(chat: ChatHarness): string {
  return chat.rows().at(-1) ?? "";
}

describe("terminal chat", () => {
  it("sends the typed line and prints it under the owner's name", async () => {
    const chat = await opened({ "chat/post": () => ({ session, turn }) });
    chat.press("Buy some TKN\r");
    await chat.settle();
    expect(opsOf(chat, "chat/post")).toStrictEqual([{ agent: harnessAgent, text: "Buy some TKN" }]);
    expect(chat.rows().slice(-2)).toStrictEqual(["You: Buy some TKN", "› "]);
  });

  it("keeps a pasted text with new lines as one message", async () => {
    const chat = await opened({ "chat/post": () => ({ session, turn }) });
    chat.press("\u001b[200~line one\rline two\u001b[201~");
    await chat.settle();
    expect(lastRow(chat)).toBe("› line one ↵ line two");
    chat.press("\r");
    await chat.settle();
    expect(opsOf(chat, "chat/post")).toStrictEqual([
      { agent: harnessAgent, text: "line one\nline two" },
    ]);
  });

  it("says images go through Telegram or the console when the owner asks to send one", async () => {
    const chat = await opened();
    chat.press("/image\r");
    await chat.settle();
    expect(chat.rows().slice(-2)).toStrictEqual([
      "Images cannot be sent from the terminal. Send them in Telegram or the console.",
      "› ",
    ]);
    expect(opsOf(chat, "chat/post")).toStrictEqual([]);
  });

  it("leaves on Ctrl+C with every topic unsubscribed and the terminal given back", async () => {
    const chat = startChat({});
    await chat.settle();
    expect(chat.isRaw()).toBe(true);
    chat.press(ctrlC);
    await expect(chat.ended).resolves.toBe("left");
    expect(chat.topics()).toStrictEqual([]);
    expect(chat.isRaw()).toBe(false);
    expect(chat.rows().slice(-2)).toStrictEqual(["Chat closed.", ""]);
  });

  it("leaves on a stop signal, and says so when the engine stops answering for good", async () => {
    const stopped = startChat({});
    await stopped.settle();
    stopped.stop();
    await expect(stopped.ended).resolves.toBe("left");
    const lost = startChat({});
    await lost.settle();
    lost.setStatus({ state: "connecting" });
    await lost.clock.advance(1_000);
    expect(lost.rows().at(-2)).toBe("The link to binference dropped. Reconnecting…");
    lost.setStatus({ state: "closed", error: new Error("gone") });
    await lost.clock.advance(1_000);
    await expect(lost.ended).resolves.toBe("lost");
    expect(lost.rows()).toContain(
      "binference stopped answering, so the chat closed. Run `binference status`, then `binference chat` again.",
    );
  });

  it("starts a new chat on /clear and lists the keys on /help", async () => {
    const chat = await opened({ "chat/clear": () => ({ session }) });
    chat.press("/clear\r/help\r");
    await chat.settle();
    expect(opsOf(chat, "chat/clear")).toStrictEqual([{ agent: harnessAgent }]);
    expect(chat.rows()).toContain(
      "A new chat has started. The agent forgets this conversation; its notes and files stay.",
    );
    expect(chat.rows()).toContain("Ctrl+C, or Ctrl+D on an empty line, leaves the chat.");
  });
});
