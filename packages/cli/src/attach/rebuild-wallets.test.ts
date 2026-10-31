import { bsc, bscVenueCalls } from "@binference/chains";
import type { OwnedWallet } from "@binference/custody-privy";
import { describe, expect, it } from "vitest";
import {
  bridgeOnlyAddresses,
  rebuildOrder,
  type RebuildWallet,
  withRoles,
} from "./rebuild-wallets.js";

// Relay's depository on BNB Smart Chain, which only a bridge wallet calls and approves.
const depository = "0x4cD00E387622C35bDDB9b4c962C136462338BC31";
const router = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const bridgeOnly = bridgeOnlyAddresses(bsc, bscVenueCalls);

// A wallet the owner key owns, made at `madeAtMs`, whose ceiling names the contracts given and
// reads as a launch wallet's when `isLaunch`.
function owned(
  id: string,
  madeAtMs: number,
  ceiling: { readonly isLaunch?: boolean; readonly contracts?: readonly string[] } = {},
): OwnedWallet {
  return {
    wallet: { id, address: `0x${id}`, createdAtMs: madeAtMs },
    ceiling: { isLaunch: ceiling.isLaunch === true, contracts: ceiling.contracts ?? [router] },
  } as unknown as OwnedWallet;
}

const ids = (wallets: readonly RebuildWallet[] | undefined) =>
  wallets?.map((item) => item.wallet.id);

describe("the roles a rebuild reads", () => {
  it("names Relay's depository on BNB Smart Chain as a contract only a bridge wallet uses", () => {
    expect([...bridgeOnly]).toStrictEqual([depository.toLowerCase()]);
  });

  it("reads a launch wallet from its launch rules and a bridge wallet from its contracts", () => {
    const read = withRoles(
      [
        owned("main", 1),
        owned("launch", 2, { isLaunch: true }),
        owned("bridge", 3, { contracts: [depository] }),
      ],
      bridgeOnly,
    );

    expect(read.map((item) => [item.wallet.id, item.role])).toStrictEqual([
      ["main", undefined],
      ["launch", "launch"],
      ["bridge", "bridge"],
    ]);
  });
});

describe("the wallets a rebuild adopts", () => {
  it("keeps every main wallet first as Privy listed them, then each role's wallets, newest first", () => {
    const listed = withRoles(
      [
        owned("launch-old", 1, { isLaunch: true }),
        owned("bridge-old", 2, { contracts: [depository.toLowerCase()] }),
        owned("main", 3),
        owned("launch-new", 5, { isLaunch: true }),
        owned("bridge-new", 6, { contracts: [depository] }),
        owned("spare", 4),
      ],
      bridgeOnly,
    );

    expect(ids(rebuildOrder(listed))).toStrictEqual([
      "main",
      "spare",
      "launch-new",
      "launch-old",
      "bridge-new",
      "bridge-old",
    ]);
  });

  it("adopts nothing when the owner key owns only launch or bridge wallets", () => {
    const listed = withRoles(
      [owned("launch", 1, { isLaunch: true }), owned("bridge", 2, { contracts: [depository] })],
      bridgeOnly,
    );

    expect(rebuildOrder(listed)).toBeUndefined();
  });
});
