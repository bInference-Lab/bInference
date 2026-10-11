import { describe, expect, it } from "vitest";
import { applyEdits } from "./config-edit.js";
import { usdAsText } from "./usd-as-text.js";

const before = {
  defaults: {
    limits: { perTradeUsd: 50, rollingDayUsd: "250", slippageBps: { registry: 50 } },
    copy: { perBuyUsd: 12.5 },
    modelBudgetUsdPerDay: 3,
  },
  models: { prices: { "openai/gpt": { inputPerMTokUsd: 0.25, outputPerMTokUsd: 2 } } },
};

describe("dollars as text", () => {
  it("writes each dollar number as the same amount in text, and nothing else", () => {
    expect(usdAsText.edits(before)).toStrictEqual([
      { kind: "set", path: ["defaults", "limits", "perTradeUsd"], value: "50" },
      { kind: "set", path: ["defaults", "copy", "perBuyUsd"], value: "12.5" },
      { kind: "set", path: ["defaults", "modelBudgetUsdPerDay"], value: "3" },
      { kind: "set", path: ["models", "prices", "openai/gpt", "inputPerMTokUsd"], value: "0.25" },
      { kind: "set", path: ["models", "prices", "openai/gpt", "outputPerMTokUsd"], value: "2" },
    ]);
  });

  it("changes nothing in a file with no dollar numbers, so a second run is a no-op", () => {
    const migrated = applyEdits(before, usdAsText.edits(before));

    expect(usdAsText.edits(migrated)).toStrictEqual([]);
    expect(usdAsText.edits({ engine: { port: 7460 } })).toStrictEqual([]);
  });
});
