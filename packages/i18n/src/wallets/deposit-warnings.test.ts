import { type WalletView, walletViewSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createFormatter } from "../format/create-formatter.js";
import { depositWarnings, walletRoleOf } from "./deposit-warnings.js";

const formatter = createFormatter({ locale: "en", timeZone: "UTC" });
const main: WalletView = walletViewSchema.parse({
  wallet: "wal_0190f1c2-3a4b-7c5d-8e6f-000000000010",
  agent: "agt_0190f1c2-3a4b-7c5d-8e6f-0123456789ab",
  address: "fake:1:0x0000000c",
  label: "Main",
  createdAt: 1,
});
const network = "Send only Fake One assets here. Assets sent on any other network can be lost.";

describe("a wallet to fund", () => {
  it("names each role, an extra launch or bridge wallet apart", () => {
    const roles = [
      main,
      { ...main, role: "launch" },
      { ...main, bridge: true },
      { ...main, role: "launch", extra: true },
      { ...main, bridge: true, extra: true },
    ] as const;
    expect(roles.map(walletRoleOf)).toStrictEqual([
      "agent",
      "launch",
      "bridge",
      "extraLaunch",
      "extraBridge",
    ]);
  });

  it("warns of the network, then a paper agent's real funds, then a freeze", () => {
    const live = depositWarnings(
      formatter,
      { view: main, mode: "live", isFrozen: false },
      "Fake One",
    );
    expect(live).toStrictEqual([network]);
    const paper = depositWarnings(
      formatter,
      { view: main, mode: "paper", isFrozen: true },
      "Fake One",
    );
    expect(paper).toStrictEqual([
      network,
      `${String.fromCodePoint(0x1f9ea)} Paper mode: deposits are real money and stay in this wallet until you switch the agent to live.`,
      "Frozen: deposits arrive, but the agent trades nothing until you unfreeze it.",
    ]);
  });

  it("tells the owner to send nothing to a wallet nothing runs from", () => {
    const extra = { ...main, role: "launch", extra: true } as const;
    const wallet = { view: extra, mode: "paper", isFrozen: true } as const;
    expect(depositWarnings(formatter, wallet, "Fake One")).toStrictEqual([
      "Nothing runs from this wallet. Send it no funds.",
    ]);
  });
});
