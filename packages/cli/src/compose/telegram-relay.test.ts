import { ok } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import type { CardShowings, CardVersionRef } from "@binference/engine/surfaces";
import type { ChatReplies, NoticeOutbox, OutboxPass, TelegramCards } from "@binference/telegram";
import { describe, expect, it } from "vitest";
import { createTelegramRelay } from "./telegram-relay.js";

const nowMs = 1_760_000_000_000;
const intent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const card = (n: number) => `crd_0190f1c2-3a4b-7c5d-8e6f-00000000000${String(n)}`;
const notice = (n: number) => `ntc_0190f1c2-3a4b-7c5d-8e6f-00000000000${String(n)}`;

const opened = (n: number) =>
  ({
    topic: "intent",
    kind: "card/opened",
    data: { intent, card: card(n) },
  }) as const;
const noticed = (n: number) =>
  ({
    topic: "notice",
    kind: "notice/new",
    data: { id: notice(n), at: nowMs, key: "notice.locked", values: {} },
  }) as const;

const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const answered = {
  topic: `chat:${agent}`,
  kind: "chat/message",
  data: { agent, turn: "trn_0190f1c2-3a4b-7c5d-8e6f-000000000001", text: "Done.", final: true },
} as const;

// A relay whose cards, outbox and chat replies write what they were asked into `events`.
function setUp(passes: OutboxPass[] = []) {
  const events: string[] = [];
  const clock = createManualClock(nowMs);
  const showings = {
    opened: async (ref: CardVersionRef) => Promise.resolve(ref),
  } as unknown as CardShowings;
  const cards = {
    show: async (showing: CardVersionRef) => {
      events.push(`show ${showing.card}`);
      return Promise.resolve(ok(undefined));
    },
  } as unknown as TelegramCards;
  const outbox: NoticeOutbox = {
    send: async (call) => {
      events.push(`send ${call.through ?? "all"}`);
      return Promise.resolve(passes.shift() ?? { kind: "done" });
    },
  };
  const chat: ChatReplies = {
    show: async (push) => {
      events.push(`chat ${push.kind}`);
      return Promise.resolve();
    },
    idle: async () => Promise.resolve(),
    close: () => {
      events.push("chat closed");
    },
  };
  const relay = createTelegramRelay({
    showings,
    cards,
    outbox,
    chat,
    stored: async () => Promise.resolve(),
    clock,
    logger: createMemoryLogger({ subsystem: "telegram" }),
  });
  return { relay, events, clock };
}

describe("the relay to the owner's chat", () => {
  it("keeps cards and notices in the order their pushes came", async () => {
    const test = setUp();
    test.relay.start();
    test.relay.relay(opened(1));
    test.relay.relay(noticed(1));
    test.relay.relay(opened(2));
    await test.relay.idle();
    expect(test.events).toStrictEqual([
      "send all",
      `show ${card(1)}`,
      `send ${notice(1)}`,
      `show ${card(2)}`,
    ]);
    await test.relay.close();
  });

  it("shows the agent's answer after the card its turn opened", async () => {
    const test = setUp();
    test.relay.relay(opened(1));
    test.relay.relay(answered);
    await test.relay.idle();
    await test.relay.close();
    expect(test.events).toStrictEqual([`show ${card(1)}`, "chat chat/message", "chat closed"]);
  });

  it("sends no notice before it starts, then all that waited", async () => {
    const test = setUp();
    test.relay.relay(noticed(1));
    await test.relay.idle();
    expect(test.events).toStrictEqual([]);
    test.relay.start();
    await test.relay.idle();
    expect(test.events).toStrictEqual(["send all"]);
    await test.relay.close();
  });

  it("passes the outbox again once a waiting delivery is due", async () => {
    const test = setUp([{ kind: "waiting", atMs: nowMs + 7_000 }]);
    test.relay.start();
    await test.relay.idle();
    await test.clock.advance(6_999);
    await test.relay.idle();
    expect(test.events).toStrictEqual(["send all"]);
    await test.clock.advance(1);
    await test.relay.idle();
    expect(test.events).toStrictEqual(["send all", "send all"]);
    await test.relay.close();
  });

  it("sends what waited for the owner once the owner pairs", async () => {
    const test = setUp([{ kind: "noOwner" }]);
    test.relay.start();
    test.relay.paired();
    await test.relay.idle();
    expect(test.events).toStrictEqual(["send all", "send all"]);
    await test.relay.close();
  });
});
