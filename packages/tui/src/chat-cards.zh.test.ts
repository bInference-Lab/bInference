import { afterEach, describe, expect, it } from "vitest";
import {
  type ChatAnswers,
  type ChatHarness,
  harnessAgent,
  harnessNowMs,
  startChat,
} from "./testing/chat-harness.js";

const intent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000009";
const card = "crd_0190f1c2-3a4b-7c5d-8e6f-000000000009";
const order = "ord_0190f1c2-3a4b-7c5d-8e6f-000000000005";
const ctrlC = "\u0003";
const ctrlY = "\u0019";
const chats: ChatHarness[] = [];

afterEach(async () => {
  for (const chat of chats.splice(0)) {
    chat.press(ctrlC);
    // oxlint-disable-next-line eslint/no-await-in-loop -- each chat ends before the next test
    await chat.ended;
  }
});

const waiting = {
  intent,
  agent: harnessAgent,
  state: "awaiting_confirmation",
  paper: false,
  card: { card, version: 1, opensAt: harnessNowMs, expiresAt: harnessNowMs + 600_000 },
};
const drawn = {
  card,
  version: 1,
  expiresAt: harnessNowMs + 600_000,
  assets: {},
  lines: [{ key: "card.reason", values: { reason: { type: "text", text: "解除冻结" } } }],
};

// A Chinese chat with one card that waits, which a Confirm leaves as `confirmedAs`.
async function confirmedIn(confirmedAs: object, more: ChatAnswers = {}): Promise<string> {
  const listed = { items: [waiting] };
  const chat = startChat(
    {
      "intent/list": () => ({ items: listed.items }),
      "intent/card": () => drawn,
      "intent/confirm": () => {
        listed.items = [];
        return { ...waiting, ...confirmedAs };
      },
      ...more,
    },
    "zh",
  );
  chats.push(chat);
  await chat.settle();
  chat.press(ctrlY);
  await chat.settle();
  chat.push("intent", "intent/changed", { intent });
  await chat.settle();
  return chat.rows().at(-2) ?? "";
}

describe("a confirmed card that sends nothing, in Chinese", () => {
  it("says the unfreeze took effect, for one agent or every agent", async () => {
    const one = await confirmedIn({
      state: "reconciled",
      request: { kind: "unfreeze", agent: harnessAgent },
    });
    const every = await confirmedIn({ state: "reconciled", request: { kind: "unfreeze" } });
    expect([one, every]).toStrictEqual([
      "已解除冻结。该 Agent 可以在交易限额内再次交易。",
      "已解除冻结。全部 Agent 可以在交易限额内再次交易，新建的 Agent 也不再冻结。",
    ]);
  });

  it("says a paper sale that could not fill was not sent, and why", async () => {
    const short = { state: "failed_check", outcome: { reason: "nothing_to_sell" } };
    expect(await confirmedIn(short)).toBe(
      `${String.fromCodePoint(0x274c)} 未发送：钱包中这种代币不足`,
    );
  });

  it("says whether the auto order became active", async () => {
    const confirmed = { state: "reconciled", request: { kind: "autoOrder", order } };
    const active = await confirmedIn(confirmed, { "order/get": () => ({ state: "active" }) });
    const expired = await confirmedIn(confirmed, { "order/get": () => ({ state: "expired" }) });
    expect([active, expired]).toStrictEqual([
      "已确认。自动订单已生效。",
      "已确认。自动订单未生效：确认之前它已过期。",
    ]);
  });
});
