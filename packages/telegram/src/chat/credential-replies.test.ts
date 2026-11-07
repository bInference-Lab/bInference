import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { createMemoryOwnerStore } from "@binference/engine/testing";
import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { createFakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { ownerId } from "../testing/update-fixtures.js";
import { createBotThrottlers } from "../throttle/create-bot-throttlers.js";
import { createChatReplies } from "./chat-replies.js";

const live = { signal: new AbortController().signal };
const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";
const turn = "trn_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";
const session = "ses_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";
const display = () => ({ locale: "en", timeZone: "UTC" }) as const;

async function setUp() {
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
    replies: () => ({ stream: "progress" }),
  });
  return { botApi, replies };
}

const request = {
  kind: "chat/credentialRequest",
  data: {
    request: "crq_0190f1c2-3a4b-7c5d-8e6f-000000000001",
    agent,
    session,
    turn,
    name: "DUNE_API_KEY",
    reason: "Holder history.",
    allowedHosts: ["api.dune.com"],
    createdAt: 1,
    closesAt: 2,
  },
};

describe("a credential request in Telegram", () => {
  it("names the credential, the reason and the hosts, and sends the owner to the masked prompt", async () => {
    const { botApi, replies } = await setUp();
    await replies.show({ kind: "chat/turnStarted", data: { agent, session, turn } }, live);
    await replies.show(request, live);
    await replies.show({ kind: "chat/turnEnded", data: { agent, turn, outcome: "ok" } }, live);
    const texts = botApi.messages().map((message) => message.text);
    expect(texts).toHaveLength(1);
    expect(texts[0]?.split("\n").slice(0, 3)).toStrictEqual([
      "The agent asks for a credential: DUNE_API_KEY",
      "Why: Holder history.",
      "Hosts it may be sent to: api.dune.com",
    ]);
    expect(texts[0]).toContain("Never send a credential in this chat.");
  });

  it("sends nothing for the request's close", async () => {
    const { botApi, replies } = await setUp();
    await replies.show(
      {
        kind: "chat/credentialRequestClosed",
        data: { agent, request: request.data.request, outcome: "stored" },
      },
      live,
    );
    expect(botApi.messages()).toStrictEqual([]);
  });
});
