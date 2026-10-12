import { liveFactsViewSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { nthTestId } from "../testing/memory-agent-stores.js";
import { testLiveFacts } from "../testing/memory-context-source.js";
import { agentInstructions } from "./agent-instructions.js";
import { liveFactsText } from "./live-facts-text.js";

const agent = nthTestId("agt", 1);
const at = Date.UTC(2026, 9, 12, 13, 30, 0);
const xvs = "eip155:56/erc20:0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63";

// The facts as JSON carries them, amounts as decimal text.
function wireOf(facts: object): Record<string, unknown> {
  const text = JSON.stringify(facts, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  return JSON.parse(text) as Record<string, unknown>;
}

describe("the live facts as the model reads them", () => {
  it("say the time in the owner's timezone, the mode, balances, orders, spend and budget", () => {
    const facts = { ...testLiveFacts(agent, at), timeZone: "Asia/Shanghai" };
    expect(liveFactsText({ facts, budgetLeftMicros: 2_400_000n })).toBe(
      [
        "Live facts from binference, read for this call. They are not the owner's words.",
        "- Time: Oct 12, 2026, 21:30:00 (Asia/Shanghai).",
        "- Mode: paper. Frozen: no. Approval mode: manual. Send level: 0.",
        "- Balances: 1 BNB ($600.00). Total $600.00.",
        "- Open orders: none.",
        "- Spent in the last 24 hours: $25.00 of the $500.00 cap. Per-trade cap: $100.00.",
        "- Model budget left today: $2.40.",
      ].join("\n"),
    );
  });

  it("name an unlisted token by its short address, never its deployer's symbol, and missing balances as missing", () => {
    const base = wireOf(testLiveFacts(agent, at));
    const order = {
      order: "ord_0190f1c2-3a4b-7c5d-8e6f-000000000001",
      agent,
      wallet: "wal_0190f1c2-3a4b-7c5d-8e6f-000000000001",
      kind: "stopLoss",
      state: "active",
      request: {
        kind: "stopLoss",
        agent,
        token: xvs,
        side: "sell",
        size: { percentBps: 10_000 },
        trigger: { price: "800000" },
      },
      fills: 0,
      expiresAt: at,
      createdAt: at,
      changedAt: at,
    };
    const { balances: _balances, totalUsdMicros: _total, ...rest } = base;
    const facts = liveFactsViewSchema.parse({
      ...rest,
      orders: [order],
      assets: { [xvs]: { symbol: "XVS", name: "Venus", decimals: 18, verified: false } },
    });
    const text = liveFactsText({ facts });
    expect(text).toContain("- Balances: could not be read now.");
    expect(text).toContain(
      "- Open orders: stopLoss sell unlisted token (0xcF6B…6C63), active (ord_0190f1c2-3a4b-7c5d-8e6f-000000000001).",
    );
    expect(text).not.toContain("Model budget");
    expect(text).not.toContain("XVS");
  });

  it("say they could not be read when the engine did not answer", () => {
    expect(liveFactsText({ budgetLeftMicros: 0n })).toBe(
      [
        "Live facts from binference, read for this call. They are not the owner's words.",
        "- The live facts could not be read now.",
        "- Model budget left today: $0.00.",
      ].join("\n"),
    );
  });
});

describe("the agent's instructions", () => {
  it("name the owner's language and nothing else changes", () => {
    const english = agentInstructions("en");
    const chinese = agentInstructions("zh");
    expect(english).toMatch(/Write to the owner in English\.$/u);
    expect(chinese).toMatch(/Write to the owner in Simplified Chinese\.$/u);
    expect(english.replace(/[^\n]*$/u, "")).toBe(chinese.replace(/[^\n]*$/u, ""));
  });
});
