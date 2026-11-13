import { type WalletView, walletViewSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createFormatter } from "../format/create-formatter.js";
import { depositWarnings } from "./deposit-warnings.js";

const formatter = createFormatter({ locale: "zh", timeZone: "UTC" });
const main: WalletView = walletViewSchema.parse({
  wallet: "wal_0190f1c2-3a4b-7c5d-8e6f-000000000010",
  agent: "agt_0190f1c2-3a4b-7c5d-8e6f-0123456789ab",
  address: "fake:1:0x0000000c",
  label: "Main",
  createdAt: 1,
});

describe("a wallet to fund, in Chinese", () => {
  it("names the breaker's hold in the place of a freeze, and no unfreeze", () => {
    const wallet = { view: main, mode: "live", isFrozen: true, isBraked: true } as const;
    expect(depositWarnings(formatter, wallet, "Fake One").at(-1)).toBe(
      "被 bInference 的熔断开关冻结：转账的资金会到账并留在这个钱包里，但在 bInference 解除之前 Agent 不会交易。",
    );
  });
});
