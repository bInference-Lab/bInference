import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { createMemoryOwnerStore } from "@binference/engine/testing";
import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { createChatReplies } from "../chat/chat-replies.js";
import { createFakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { ownerId, strangerId } from "../testing/update-fixtures.js";
import {
  closedPush,
  createTestShellRequests,
  requestPush,
  testShellRequest,
} from "./test-shell-requests.js";

const live = { signal: new AbortController().signal };
const { request } = testShellRequest;
const done = String.fromCodePoint(0x2705);

describe("the agent's shell requests in Telegram", () => {
  it("shows the command in a code block with its folder, why it asks, and three buttons", async () => {
    const shell = await createTestShellRequests();
    await shell.requests.show(requestPush(), live);
    expect(shell.botApi.messages()).toMatchObject([
      {
        chatId: ownerId,
        text: "main asks to run a command\ngit log -1 | head -n 3\nIn /srv/project\nNo allowed command covers it.\nAnswer by 12:10:00.",
        buttons: [
          [
            { text: "Allow once", data: `bnf1:x:o:${request}` },
            { text: "Always allow", data: `bnf1:x:a:${request}` },
          ],
          [{ text: "Refuse", data: `bnf1:x:n:${request}` }],
        ],
      },
    ]);
  });

  it("leaves Always allow out where it is not offered, and says so", async () => {
    const shell = await createTestShellRequests();
    const view = { ...testShellRequest, reason: "unreadable", canAlwaysAllow: false } as const;
    await shell.requests.show(requestPush(view), live);
    const [message] = shell.botApi.messages();
    expect(message?.text).toContain("binference cannot judge this command line in full");
    expect(message?.text).toContain("Always allow is not offered");
    expect(message?.buttons).toMatchObject([[{ text: "Allow once" }, { text: "Refuse" }]]);
  });

  it("sends the owner's first press to the engine, and says a later one is closed", async () => {
    const shell = await createTestShellRequests();
    await shell.requests.show(requestPush(), live);
    expect(await shell.press(`bnf1:x:a:${request}`)).toBe(true);
    expect(await shell.press(`bnf1:x:o:${request}`)).toBe(true);
    expect(shell.answered).toStrictEqual([{ request, answer: "always", presserId: ownerId }]);
    expect(shell.botApi.answers().map((answer) => answer.text)).toStrictEqual([
      undefined,
      "This request is no longer open.",
    ]);
  });

  it("answers nothing to anyone but the owner, and leaves other data alone", async () => {
    const shell = await createTestShellRequests();
    expect(await shell.press(`bnf1:x:o:${request}`, strangerId)).toBe(true);
    expect(await shell.press("bnf1:q:0:q3Zr_x9-AbCdEfGh")).toBe(false);
    expect(await shell.press(`bnf1:x:z:${request}`)).toBe(false);
    expect([shell.answered, shell.botApi.answers()]).toStrictEqual([[], []]);
  });

  it("turns the message into how the request ended, without its buttons", async () => {
    const shell = await createTestShellRequests();
    await shell.requests.show(requestPush(), live);
    await shell.requests.show(closedPush("allowed_always"), live);
    expect(shell.botApi.messages()).toMatchObject([
      {
        text: `main asks to run a command\ngit log -1 | head -n 3\nIn /srv/project\n${done} Allowed, and kept as an allowed command.`,
        buttons: [],
      },
    ]);
  });

  it("counts the request as the turn's reply, so the chat never says no answer came", async () => {
    const botApi = createFakeBotApi();
    const api = new Api(fakeBotToken, { fetch: botApi.fetch });
    const owners = createMemoryOwnerStore();
    await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
    const replies = createChatReplies({
      api,
      owners,
      clock: createManualClock(1_760_000_000_000),
      logger: createMemoryLogger({ subsystem: "telegram" }),
      display: () => ({ locale: "en", timeZone: "UTC" }),
      replies: () => ({ stream: "progress" }),
    });
    const { agent } = testShellRequest;
    const turn = "trn_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";
    const session = "ses_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";
    await replies.show({ kind: "chat/turnStarted", data: { agent, session, turn } }, live);
    await replies.show(requestPush(), live);
    await replies.show({ kind: "chat/turnEnded", data: { agent, turn, outcome: "ok" } }, live);
    expect(botApi.messages()).toStrictEqual([]);
  });
});
