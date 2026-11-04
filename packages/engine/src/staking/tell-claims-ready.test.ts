import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { testCoin, testNowMs, testWallet } from "../intents/test-intents.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { type ClaimReadyParts, tellClaimsReady } from "./tell-claims-ready.js";
import type { UnbondingRecord } from "./unbonding-record.js";

const live = { signal: new AbortController().signal };

// A paper unbonding of a wallet no agent holds, of a venue that names no validator.
const row: UnbondingRecord = {
  id: 1,
  intentId: fixtureId("int", 1),
  walletId: testWallet,
  venue: "fake-staking",
  requestRef: "paper-1",
  amount: { asset: testCoin, base: 10n ** 17n },
  readyAtMs: testNowMs - 1,
  isPaper: true,
};

// The teller over the rows given, with what it published and the rows it marked told.
function partsOver(rows: readonly UnbondingRecord[]) {
  const pushes: EnginePush[] = [];
  const told: number[] = [];
  const parts: ClaimReadyParts = {
    unbondings: {
      untoldReady: async () => Promise.resolve(rows),
      markTold: async (marked) => {
        told.push(...marked.ids);
        return Promise.resolve();
      },
    },
    install: { read: async () => Promise.resolve({ wallets: [] } as never) },
    publish: (push) => {
      pushes.push(push);
    },
    clock: createManualClock(testNowMs),
  };
  return { parts, pushes, told };
}

describe("telling of an unstake's coin ready to claim (decision 0327)", () => {
  it("names a venue with no validator by the venue, and a wallet no agent holds by no agent", async () => {
    const { parts, pushes, told } = partsOver([row]);

    expect(await tellClaimsReady(parts, live)).toBe(1);
    expect(told).toStrictEqual([1]);
    expect(pushes).toMatchObject([
      { data: { key: "notice.claimReady", values: { validator: "fake-staking" } } },
    ]);
    expect(JSON.stringify(pushes)).not.toContain('"agent"');
  });

  it("tells nothing, and marks nothing, when no coin is ready", async () => {
    const { parts, pushes, told } = partsOver([]);

    expect(await tellClaimsReady(parts, live)).toBe(0);
    expect([pushes, told]).toStrictEqual([[], []]);
  });
});
