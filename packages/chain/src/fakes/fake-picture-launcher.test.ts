import { describe, expect, it } from "vitest";
import { accountRefSchema } from "../caip/account-ref.js";
import { assetRefSchema } from "../caip/asset-ref.js";
import { launcherContract } from "../contracts/launcher-contract.js";
import type { LaunchOption } from "../venues/launch-option.js";
import type { LaunchPinRequest } from "../venues/launch-terms.js";
import { fakeDraft } from "./fake-draft.js";
import type { FakeLauncherOptions } from "./fake-launcher-options.js";
import { createFakePictureLauncher } from "./fake-picture-launcher.js";

const wallet = accountRefSchema.parse("fake:1:0x0000000c");
const router = accountRefSchema.parse("fake:1:0x0000000d");
const coin = assetRefSchema.parse("fake:1/slip44:1");

const launchOptions: readonly LaunchOption[] = [{ name: "taxBps", type: "bps", max: 1_000 }];

const launch: LaunchPinRequest = {
  wallet,
  name: "Moon Cat",
  symbol: "MCAT",
  pair: coin,
  firstBuy: { asset: coin, base: 50n },
  options: { taxBps: 300 },
  contracts: { router },
  image: { contentType: "image/png", bytes: new Uint8Array([137, 80, 78, 71]) },
};

// A fake launchpad that writes the picture into its create call, under test.
function subjectOf(options: FakeLauncherOptions = {}) {
  return {
    launcher: createFakePictureLauncher({ launchOptions, mostBytes: 1_000, ...options }),
    launch,
    otherOptions: { taxBps: 100 },
    otherPair: { ...launch, pair: assetRefSchema.parse("fake:1/token:0x0000000e") },
    other: fakeDraft(wallet, { to: "0x0000000d", value: 0n, data: "swap" }),
  };
}

describe("fake picture launcher", () => {
  it.each(launcherContract({ create: () => subjectOf() }))(
    "follows the launcher contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it("fails the contract when its create call writes another picture than the card's", async () => {
    const lying = subjectOf({ writesPictureSha256: "0".repeat(64) });
    const checks = launcherContract({ create: () => lying });
    const failed = await Promise.all(
      checks.map(async (check) =>
        check.run().then(
          () => "",
          () => check.name,
        ),
      ),
    );
    expect(failed.filter((name) => name !== "")).toStrictEqual([
      "builds steps from the wallet whose create call decodes to the launch",
      "writes other settings into its create call, and reads them back from its bytes",
    ]);
  });

  it("takes the picture bytes it was made with, beside any words", () => {
    expect(subjectOf().launcher.pictureBytesFor?.({ description: "A cat" })).toBe(1_000);
  });
});
