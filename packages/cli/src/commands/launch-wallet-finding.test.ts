import { accountRefSchema } from "@binference/chain";
import type { WalletView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { extraLaunchOf, launchCallsOf } from "./launch-wallet-finding.js";

// A launch wallet as `wallet/list` shows it, an extra one when `extra`.
function launchWallet(n: number, changes: Partial<WalletView> = {}): WalletView {
  return {
    wallet: `wal_0190f1c2-3a4b-7c5d-8e6f-00000000000${String(n)}`,
    agent: "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001",
    address: accountRefSchema.parse(`eip155:56:0x${String(n).repeat(40)}`),
    label: `launch ${String(n)}`,
    createdAt: n,
    role: "launch",
    ...changes,
  } as WalletView;
}

describe("the check of extra launch wallets", () => {
  it("warns with each live extra launch wallet's address", () => {
    const finding = extraLaunchOf([
      launchWallet(1),
      launchWallet(2, { extra: true }),
      launchWallet(3, { extra: true, archivedAt: 9 }),
    ]);

    expect(finding).toMatchObject({
      check: "wallets.extra_launch",
      level: "warn",
      message: { key: "check.extraLaunch", values: { count: 1 } },
      details: { addresses: [`eip155:56:0x${"2".repeat(40)}`] },
    });
  });

  it("is fine without extra launch wallets, and skipped without an engine to ask", () => {
    expect(extraLaunchOf([launchWallet(1)]).level).toBe("ok");
    expect(extraLaunchOf(undefined).level).toBe("skip");
  });
});

describe("the check of launch wallet ceilings", () => {
  it("warns with each launch wallet whose ceiling lacks calls, and the calls it lacks", () => {
    const older = launchWallet(1, { missingCalls: ["newTokenV6"] });
    const finding = launchCallsOf([older, launchWallet(2)]);

    expect(finding).toMatchObject({
      check: "wallets.launch_calls",
      level: "warn",
      message: {
        key: "check.launchCalls",
        values: { count: 1, wallets: `${older.wallet} (${older.address}): newTokenV6` },
      },
      details: { wallets: [older.wallet], calls: [["newTokenV6"]] },
    });
  });

  it("is fine when every ceiling holds its calls, and skipped without an engine to ask", () => {
    expect(launchCallsOf([launchWallet(1)]).level).toBe("ok");
    expect(launchCallsOf(undefined).level).toBe("skip");
  });
});
