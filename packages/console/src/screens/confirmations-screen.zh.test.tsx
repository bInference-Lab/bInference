// @vitest-environment jsdom
import type { ProtocolClient } from "@binference/client";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderSignedIn, settle } from "../testing/render-signed-in";
import { ConfirmationsScreen } from "./confirmations-screen";

afterEach(cleanup);

const intent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000003";
const card = "crd_0190f1c2-3a4b-7c5d-8e6f-000000000003";

// One waiting card whose only lines are the header, why auto mode asks and the expiry.
const engineAnswers: Readonly<Record<string, () => object>> = {
  "intent/list": () => ({
    items: [
      {
        intent,
        agent: "agt_1",
        kind: "swap",
        paper: false,
        card: { card, version: 1, opensAt: 1_800_000_000_000, expiresAt: 1_800_000_060_000 },
      },
    ],
  }),
  "intent/card": () => ({
    card,
    version: 1,
    expiresAt: 1_800_000_060_000,
    assets: {},
    lines: [
      {
        key: "card.header",
        values: {
          action: { type: "choice", choice: "swap" },
          agent: { type: "text", text: "main" },
          mode: { type: "choice", choice: "live" },
        },
      },
      {
        key: "card.warn.autoAsks",
        values: { why: { type: "line", line: { key: "autoAsks.deniedToken", values: {} } } },
      },
      { key: "card.expiry", values: { time: { type: "time", atMs: 1_800_000_060_000 } } },
    ],
  }),
};

// A client that answers each call from the answers above, and nothing else.
const client = {
  call: async (op: string) => engineAnswers[op]?.() ?? {},
  subscribe: () => () => undefined,
  status: () => ({ state: "ready" }),
} as unknown as ProtocolClient;

describe("the confirmations screen, in Chinese", () => {
  it("says why auto mode asks, in the words of its reason, and the card's time left", async () => {
    vi.setSystemTime(1_800_000_000_000);
    renderSignedIn(<ConfirmationsScreen />, { client, scopes: ["read", "confirm"], locale: "zh" });
    await settle();
    expect(screen.getByText("自动模式在此需要你确认：卖出的是你禁止列表中的代币")).toBeDefined();
    expect(screen.getByRole("timer").textContent).toBe("还剩 60 秒");
  });
});
