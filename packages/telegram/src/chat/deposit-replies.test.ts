import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { createMemoryOwnerStore } from "@binference/engine/testing";
import { qrPng } from "@binference/qr";
import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { testChains } from "../commands/test-command-bot.js";
import { createFakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { ownerId } from "../testing/update-fixtures.js";
import { createBotThrottlers } from "../throttle/create-bot-throttlers.js";
import { createChatReplies } from "./chat-replies.js";

const live = { signal: new AbortController().signal };
const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";
const turn = "trn_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";
const at = { agent, session: "ses_0190f1c2-3a4b-7c5d-8e6f-0123456789ab", turn };
const paper = String.fromCodePoint(0x1f9ea);
const wallet = {
  wallet: "wal_0190f1c2-3a4b-7c5d-8e6f-000000000010",
  agent,
  address: "fake:1:0x00000010",
  label: "Main",
  createdAt: 1,
};

const display = () => ({ locale: "en", timeZone: "UTC" }) as const;

async function setUp(stream: "progress" | "partial" = "progress") {
  const botApi = createFakeBotApi();
  const clock = createManualClock(1_760_000_000_000);
  const logger = createMemoryLogger({ subsystem: "telegram" });
  const api = new Api(fakeBotToken, { fetch: botApi.fetch });
  createBotThrottlers({ clock, logger }).install(api);
  const owners = createMemoryOwnerStore();
  await owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
  const replies = createChatReplies({
    api,
    owners,
    clock,
    logger,
    display,
    chains: testChains(),
    replies: () => ({ stream }),
  });
  return { botApi, clock, replies };
}

const deposit = ({ frozen }: { readonly frozen: boolean }) => ({
  kind: "chat/deposit",
  data: { agent, turn, mode: "paper", frozen, wallets: [wallet] },
});

describe("the deposit the agent shows in Telegram", () => {
  it("sends the QR code of the address the engine pushed, captioned as /wallet captions it", async () => {
    const { botApi, replies } = await setUp();
    await replies.show({ kind: "chat/turnStarted", data: at }, live);
    await replies.show(deposit({ frozen: true }), live);
    const [photo] = botApi.messages();
    expect(photo?.file?.bytes).toStrictEqual(qrPng("0x00000010"));
    expect(photo?.text.split("\n")).toStrictEqual([
      `Main · agent wallet · Fake One · ${paper} Paper`,
      "0x00000010",
      "Send only Fake One assets to this address. An asset sent on another network can be lost.",
      "This agent trades on paper: what you send here is real money, and it waits in this wallet until you switch the agent to live.",
      "This agent is frozen: what you send arrives, but it trades nothing until you unfreeze it.",
      "View on scan.example.invalid",
    ]);
  });

  it("counts the photos as the turn's answer, so the turn ends with no other message", async () => {
    const { botApi, replies } = await setUp();
    await replies.show({ kind: "chat/turnStarted", data: at }, live);
    await replies.show(deposit({ frozen: false }), live);
    await replies.show({ kind: "chat/turnEnded", data: { agent, turn, outcome: "ok" } }, live);
    expect(botApi.messages()).toHaveLength(1);
  });

  it("ignores a deposit push with no wallet, which no engine sends", async () => {
    const { botApi, replies } = await setUp();
    await replies.show(
      { kind: "chat/deposit", data: { agent, turn, mode: "live", frozen: false, wallets: [] } },
      live,
    );
    expect(botApi.messages()).toStrictEqual([]);
  });

  it("puts the deposit before the answer when a partial draft already showed, the draft gone", async () => {
    const { botApi, clock, replies } = await setUp("partial");
    await replies.show({ kind: "chat/turnStarted", data: at }, live);
    const draft = "Let me get your deposit address and its QR code for you.";
    await replies.show({ kind: "chat/message", data: { ...at, text: draft, final: false } }, live);
    await clock.advance(1_000);
    await replies.idle();
    await replies.show(deposit({ frozen: false }), live);
    const answer = "Tell me when the funds arrive.";
    const shown = replies.show(
      { kind: "chat/message", data: { ...at, text: answer, final: true } },
      live,
    );
    await clock.advance(5_000);
    await shown;
    await replies.show({ kind: "chat/turnEnded", data: { agent, turn, outcome: "ok" } }, live);
    await clock.advance(10_000);
    await replies.idle();
    const messages = botApi.messages();
    expect(messages.map((message) => message.file?.kind)).toStrictEqual(["photo", undefined]);
    expect(messages[1]?.text).toBe(answer);
  });
});
