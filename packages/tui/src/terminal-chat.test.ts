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

// What a session read answers while the agent runtime is down.
function runtimeDown(): object {
  throw Object.assign(new Error("down"), { code: "runtime.unavailable" });
}

describe("terminal chat", () => {
  it("opens with its keys, the line about images and the newest messages of the session", async () => {
    const chat = await opened({
      "chat/messages": () => ({
        items: [
          { session, turn, seq: 1, role: "owner", kind: "text", text: "hi", at: 1 },
          { session, turn, seq: 2, role: "agent", kind: "tool_call", at: 2 },
          { session, turn, seq: 3, role: "agent", kind: "text", text: "Hello.\nAsk away.", at: 3 },
        ],
      }),
    });
    expect(chat.rows()).toStrictEqual([
      "Chat with main. Enter sends, Esc stops the agent's answer, /clear starts a new chat, /help shows the keys, Ctrl+C leaves.",
      "Images cannot be sent from the terminal. Send them in Telegram or the console.",
      "You: hi",
      "main: Hello.",
      "  Ask away.",
      "› ",
    ]);
  });

  it("says once that the chat so far could not load, and reads it again at the next turn", async () => {
    const reads = { answer: runtimeDown };
    const chat = await opened({ "chat/messages": () => reads.answer() });
    chat.push(`chat:${harnessAgent}`, "chat/turnStarted", { agent: harnessAgent, turn });
    await chat.settle();
    reads.answer = () => ({
      items: [{ session, turn, seq: 4, role: "owner", kind: "text", text: "hi", at: 1 }],
    });
    chat.push(`chat:${harnessAgent}`, "chat/turnStarted", { agent: harnessAgent, turn });
    await chat.settle();
    const failed = chat.rows().filter((row) => row.startsWith("The chat so far could not load."));
    expect(failed).toHaveLength(1);
    expect(chat.rows().slice(-3)).toStrictEqual(["You: hi", "Working on it · 0 s", "› "]);
  });

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

  it("shows the answer so far in the live area, then prints the final answer and status", async () => {
    const chat = await opened();
    chat.push(`chat:${harnessAgent}`, "chat/turnStarted", { agent: harnessAgent, turn });
    await chat.clock.advance(3_000);
    await chat.settle();
    expect(chat.rows().slice(-2)).toStrictEqual(["Working on it · 3 s", "› "]);
    const draft = { agent: harnessAgent, turn, text: "Checking the\nprice now", final: false };
    chat.push(`chat:${harnessAgent}`, "chat/message", draft);
    await chat.settle();
    expect(chat.rows().slice(-2)).toStrictEqual(["main: price now", "› "]);
    chat.push(`chat:${harnessAgent}`, "chat/message", {
      ...draft,
      text: "TKN is $1.",
      final: true,
    });
    chat.push(`chat:${harnessAgent}`, "chat/status", {
      agent: harnessAgent,
      turn,
      statusKey: "turn.stopped",
    });
    chat.push(`chat:${harnessAgent}`, "chat/turnEnded", { agent: harnessAgent, turn });
    await chat.settle();
    expect(chat.rows().slice(-3)).toStrictEqual([
      "main: TKN is $1.",
      "Stopped. Anything you already confirmed still goes through.",
      "› ",
    ]);
  });

  it("writes out the characters of a model's words that would steer the terminal", async () => {
    const chat = await opened();
    const text = "Red \u001b[31mtext\u0007";
    chat.push(`chat:${harnessAgent}`, "chat/message", {
      agent: harnessAgent,
      turn,
      text,
      final: true,
    });
    await chat.settle();
    expect(chat.rows()).toContain("main: Red \\u{1B}[31mtext\\u{7}");
  });

  it("starts a new chat on /clear, stops the answer on /stop, and lists the keys on /help", async () => {
    const chat = await opened({ "chat/clear": () => ({ session }), "chat/stop": () => ({}) });
    chat.push(`chat:${harnessAgent}`, "chat/turnStarted", { agent: harnessAgent, turn });
    chat.press("/clear\r/stop\r/help\r");
    await chat.settle();
    expect(opsOf(chat, "chat/clear")).toStrictEqual([{ agent: harnessAgent }]);
    expect(opsOf(chat, "chat/stop")).toStrictEqual([{ agent: harnessAgent }]);
    expect(chat.rows()).toContain(
      "A new chat has started. The agent forgets this conversation; its notes and files stay.",
    );
    expect(chat.rows()).toContain("Ctrl+C, or Ctrl+D on an empty line, leaves the chat.");
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
});
