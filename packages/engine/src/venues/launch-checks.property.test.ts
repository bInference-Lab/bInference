import {
  accountRefSchema,
  assetRefSchema,
  type DecodedLaunch,
  writtenWordsOf,
} from "@binference/chain";
import {
  createFakeFamily,
  createFakeLauncher,
  fakeDraft,
  fakeLaunchData,
} from "@binference/chain/testing";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkLaunchSteps, type LaunchBounds, readLaunchSteps } from "./launch-checks.js";

const wallet = accountRefSchema.parse("fake:1:0x0000000c");
const router = accountRefSchema.parse("fake:1:0x0000000d");
const coin = assetRefSchema.parse("fake:1/slip44:1");
const token = assetRefSchema.parse("fake:1/token:0x000000e1");
const family = createFakeFamily();
const readers = { family, launcher: createFakeLauncher() };
const spend = { asset: coin, base: 50n };

const bounds: LaunchBounds = {
  wallet,
  contracts: [router],
  nativeAsset: coin,
  name: "Moon Cat",
  symbol: "MCAT",
  pair: coin,
  metadataUri: "ipfs://fake-1",
  words: writtenWordsOf({}),
  mustWriteWords: false,
  fee: { asset: coin, base: 0n },
  firstBuy: spend,
  options: {},
  token,
  family,
};

// The create call's verdict when it writes `minOut` for a first buy the host holds to `minOutBase`.
function verdictOf(
  minOut: bigint,
  launch: { readonly minOutBase: bigint; readonly noMin: boolean },
) {
  const decoded: DecodedLaunch = {
    token,
    name: bounds.name,
    symbol: bounds.symbol,
    metadataUri: "ipfs://fake-1",
    pair: coin,
    feeBase: 0n,
    firstBuy: { spend, minOut, recipient: wallet },
    options: {},
  };
  const draft = fakeDraft(wallet, { to: "0x0000000d", value: 50n, data: fakeLaunchData(decoded) });
  const steps = readLaunchSteps([draft], readers);
  const checked = { ...bounds, minOutBase: launch.minOutBase, noFirstBuyMin: launch.noMin };
  return steps.ok ? checkLaunchSteps(steps.value, checked).ok : false;
}

const amount = fc.bigInt({ min: 0n, max: 10n ** 30n });

describe("the first buy's minimum in a launch's create call", () => {
  it("binds a launcher that does not declare its first buy carries none", () => {
    fc.assert(
      fc.property(amount, amount, (minOut, minOutBase) => {
        expect(verdictOf(minOut, { minOutBase, noMin: false })).toBe(minOut >= minOutBase);
      }),
    );
  });

  it("leaves to the simulation the first buy of a launcher that declares it (decision 0270)", () => {
    fc.assert(
      fc.property(amount, amount, (minOut, minOutBase) => {
        expect(verdictOf(minOut, { minOutBase, noMin: true })).toBe(true);
      }),
    );
  });
});
