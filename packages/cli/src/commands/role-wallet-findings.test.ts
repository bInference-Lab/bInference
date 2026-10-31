import { accountRefSchema } from "@binference/chain";
import type { WalletView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { extraRoleWalletsOf, roleWalletCallsOf } from "./role-wallet-findings.js";

// A wallet as `wallet/list` shows it: a launch wallet, or a bridge wallet with `bridge`.
function listed(n: number, changes: Partial<WalletView> = {}): WalletView {
  return {
    wallet: `wal_0190f1c2-3a4b-7c5d-8e6f-00000000000${String(n)}`,
    agent: "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001",
    address: accountRefSchema.parse(`eip155:56:0x${String(n).repeat(40)}`),
    label: `wallet ${String(n)}`,
    createdAt: n,
    role: "launch",
    ...changes,
  } as WalletView;
}

const bridged = (n: number, changes: Partial<WalletView> = {}): WalletView => {
  const { role: _role, ...rest } = listed(n, changes);
  return { ...rest, bridge: true };
};

describe("the check of extra launch wallets", () => {
  it("warns with each live extra launch wallet's address", () => {
    const finding = extraRoleWalletsOf(
      [
        listed(1),
        listed(2, { extra: true }),
        listed(3, { extra: true, archivedAt: 9 }),
        bridged(4, { extra: true }),
      ],
      "launch",
    );

    expect(finding).toMatchObject({
      check: "wallets.extra_launch",
      level: "warn",
      message: { key: "check.extraLaunch", values: { count: 1 } },
      details: { addresses: [`eip155:56:0x${"2".repeat(40)}`] },
    });
  });

  it("is fine without extra launch wallets, and skipped without an engine to ask", () => {
    expect(extraRoleWalletsOf([listed(1)], "launch").level).toBe("ok");
    expect(extraRoleWalletsOf(undefined, "launch").level).toBe("skip");
  });
});

describe("the check of extra bridge wallets", () => {
  it("warns with each live extra bridge wallet's address, and no launch wallet's", () => {
    const finding = extraRoleWalletsOf(
      [bridged(1), bridged(2, { extra: true }), listed(3, { extra: true })],
      "bridge",
    );

    expect(finding).toMatchObject({
      check: "wallets.extra_bridge",
      level: "warn",
      message: { key: "check.extraBridge", values: { count: 1 } },
      details: { addresses: [`eip155:56:0x${"2".repeat(40)}`] },
    });
    expect(extraRoleWalletsOf([bridged(1)], "bridge").level).toBe("ok");
  });
});

describe("the check of launch wallet ceilings", () => {
  it("warns with each launch wallet whose ceiling lacks calls, and the calls it lacks", () => {
    const older = listed(1, { missingCalls: ["newTokenV6"] });
    const finding = roleWalletCallsOf([older, listed(2)], "launch");

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
    expect(roleWalletCallsOf([listed(1)], "launch").level).toBe("ok");
    expect(roleWalletCallsOf(undefined, "launch").level).toBe("skip");
  });
});

describe("the check of bridge wallet ceilings", () => {
  it("warns with each bridge wallet whose ceiling lacks deposits, and the ones it lacks", () => {
    const older = bridged(1, { missingCalls: ["depositErc20"] });
    const finding = roleWalletCallsOf(
      [older, bridged(2), listed(3, { missingCalls: ["x"] })],
      "bridge",
    );

    expect(finding).toMatchObject({
      check: "wallets.bridge_calls",
      level: "warn",
      message: {
        key: "check.bridgeCalls",
        values: { count: 1, wallets: `${older.wallet} (${older.address}): depositErc20` },
      },
      details: { wallets: [older.wallet], calls: [["depositErc20"]] },
    });
    expect(roleWalletCallsOf([bridged(2)], "bridge").level).toBe("ok");
  });
});
