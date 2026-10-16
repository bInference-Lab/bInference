import type { OwnedWallet } from "@binference/custody-privy";
import { describe, expect, it } from "vitest";
import { rebuildOrder } from "./rebuild-wallets.js";

// A wallet the owner key owns, made at `madeAtMs`, with the role its ceiling reads as.
function owned(id: string, madeAtMs: number, role: "agent" | "launch"): OwnedWallet {
  return {
    wallet: { id, address: `0x${id}`, createdAtMs: madeAtMs },
    ceiling: { isLaunch: role === "launch" },
  } as unknown as OwnedWallet;
}

const ids = (wallets: readonly OwnedWallet[] | undefined) => wallets?.map((item) => item.wallet.id);

describe("the wallets a rebuild adopts", () => {
  it("keeps every agent wallet first as Privy listed them, then every launch wallet, newest first", () => {
    const listed = [
      owned("launch-old", 1, "launch"),
      owned("main", 2, "agent"),
      owned("launch-new", 4, "launch"),
      owned("spare", 3, "agent"),
    ];

    expect(ids(rebuildOrder(listed))).toStrictEqual(["main", "spare", "launch-new", "launch-old"]);
  });

  it("adopts nothing when the owner key owns only launch wallets", () => {
    expect(rebuildOrder([owned("launch", 1, "launch")])).toBeUndefined();
  });
});
