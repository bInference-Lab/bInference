// @vitest-environment jsdom
import type { ProtocolClient } from "@binference/client";
import { readyFrameSchema } from "@binference/protocol";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EngineProvider } from "../connection/engine-context";
import { formatterFor, TextProvider } from "../i18n/console-text";
import { ConfirmationsScreen } from "./confirmations-screen";

afterEach(cleanup);

const intent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000003";
const card = "crd_0190f1c2-3a4b-7c5d-8e6f-000000000003";

// One waiting card whose only lines are the header, why auto mode asks and the expiry.
const engineAnswers: Readonly<Record<string, () => object>> = {
  "intent/list": () => ({
    items: [{ intent, agent: "agt_1", kind: "swap", paper: false, card: { card, version: 1 } }],
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
  it("says why auto mode asks, in the words of its reason", async () => {
    const ready = readyFrameSchema.parse({
      t: "ready",
      v: 1,
      connection: "con_0190f1c2-3a4b-7c5d-8e6f-000000000003",
      scopes: ["read", "confirm"],
      engine: { version: "2026.10.0", protocol: 1, state: "ready" },
      owner: { locale: "zh", timezone: "Asia/Shanghai" },
    });
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <TextProvider formatter={formatterFor("zh", "Asia/Shanghai")}>
        <QueryClientProvider client={queries}>
          <EngineProvider link={{ client, ready }}>
            <ConfirmationsScreen />
          </EngineProvider>
        </QueryClientProvider>
      </TextProvider>,
    );
    await act(async () => vi.advanceTimersByTimeAsync(20));
    expect(screen.getByText("自动模式在此需要你确认：卖出的是你禁止列表中的代币")).toBeDefined();
  });
});
