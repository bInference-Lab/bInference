import { describe, expect, it } from "vitest";
import { accountRefSchema } from "../caip/account-ref.js";
import { assetRefSchema } from "../caip/asset-ref.js";
import { launcherContract } from "../contracts/launcher-contract.js";
import type { LaunchPinRequest } from "../venues/launch-terms.js";
import { fakeDraft } from "./fake-draft.js";
import { createFakeLauncher, type FakeLauncherOptions } from "./fake-launcher.js";

const wallet = accountRefSchema.parse("fake:1:0x0000000c");
const router = accountRefSchema.parse("fake:1:0x0000000d");
const coin = assetRefSchema.parse("fake:1/slip44:1");
const usd = assetRefSchema.parse("fake:1/token:0x0000000a");
const live = { signal: new AbortController().signal };

const launch: LaunchPinRequest = {
  wallet,
  name: "Moon, Cat",
  symbol: "MCAT",
  pair: coin,
  firstBuy: { asset: coin, base: 50n },
  options: {},
  contracts: { router },
  description: "A cat",
  image: { contentType: "image/png", bytes: new Uint8Array([137, 80, 78, 71]) },
};

function subjectOf(options: FakeLauncherOptions, pinned: LaunchPinRequest) {
  return {
    launcher: createFakeLauncher(options),
    launch: pinned,
    otherPair: { ...pinned, pair: assetRefSchema.parse("fake:1/token:0x0000000e") },
    other: fakeDraft(wallet, { to: "0x0000000d", value: 0n, data: "swap" }),
  };
}

describe("fake launcher", () => {
  it.each(launcherContract({ create: () => subjectOf({}, launch) }))(
    "follows the launcher contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it.each(
    launcherContract({
      create: () =>
        subjectOf({ pair: usd }, { ...launch, pair: usd, firstBuy: { asset: usd, base: 7n } }),
    }),
  )("follows the launcher contract against a token: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("approves a token first buy exactly before its create call", async () => {
    const launcher = createFakeLauncher({ pair: usd });
    const request = { ...launch, pair: usd, firstBuy: { asset: usd, base: 7n } };
    const fee = { asset: coin, base: 2000n };
    const built = await launcher.buildLaunch({ ...request, metadataUri: "ipfs://x", fee }, live);
    expect(built.steps.map((step) => step.payload)).toEqual([
      "0x0000000a|0|approve,0x0000000d,7",
      expect.stringMatching(/^0x0000000d\|2000\|launch,/),
    ]);
  });

  it("reports a pin as its script says, counting each read", async () => {
    const never = createFakeLauncher({ pin: { never: true } });
    const fails = createFakeLauncher({ pin: { failsAfterReads: 2 } });
    const read = async (launcher: typeof never) => launcher.pinStatus(null, live);
    await expect(read(never)).resolves.toBe("pending");
    await expect(read(fails)).resolves.toBe("pending");
    await expect(read(fails)).resolves.toBe("failed");
    expect(fails.statusReads()).toBe(2);
  });

  it("keeps each upload it took", async () => {
    const launcher = createFakeLauncher();
    await launcher.pin(launch, live);
    expect(launcher.uploads()).toEqual([launch]);
  });
});
