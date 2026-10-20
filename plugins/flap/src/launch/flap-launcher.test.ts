import {
  accountRefSchema,
  assetRefSchema,
  type Launcher,
  type LaunchPinRequest,
} from "@binference/plugin-sdk";
import { decodeEvmDraft, encodeEvmDraft } from "@binference/plugin-sdk/evm";
import {
  type ContractCheck,
  draftAt,
  launcherContract,
  successOf,
} from "@binference/plugin-sdk/testing";
import { parseEther } from "viem";
import { describe, expect, it } from "vitest";
import { newTokenArgsOf, newTokenCallData } from "../portal/launch-call.js";
import { flapApiFake, pinAnswer, recordedCid } from "../testing/flap-api-fake.js";
import { launcherOver, testLaunch as launch } from "../testing/launch-fixtures.js";
import { bnb, bscChain, recordedWallet, usdt } from "../testing/portal-fixtures.js";

const live = { signal: new AbortController().signal };
const portal = accountRefSchema.parse(`${bscChain}:0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0`);

const otherOptions = {
  buyTaxBps: 0,
  sellTaxBps: 1_000,
  taxRecipient: recordedWallet,
  burnShareBps: 2_500,
  taxDays: 30,
};

// WBNB: a token Flap's curves do not trade against.
const wbnb = assetRefSchema.parse(`${bscChain}/erc20:0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c`);

// A swap through the Portal: a call of the venue that is no create call.
const swap = encodeEvmDraft({ from: recordedWallet, to: portal, value: 1n, data: "0x12345678" });

function subjectOf(launcher: Launcher, pinned: LaunchPinRequest = launch) {
  return {
    launcher,
    launch: pinned,
    otherOptions,
    otherPair: { ...pinned, pair: wbnb },
    other: swap,
  };
}

// A launcher whose create call writes another sell tax than it was asked for.
function lyingLauncher(): Launcher {
  const honest = launcherOver(flapApiFake());
  return {
    ...honest,
    async buildLaunch(request, options) {
      const built = await honest.buildLaunch(request, options);
      const create = draftAt(built.steps, built.steps.length - 1);
      const call = successOf(decodeEvmDraft(create));
      const args = newTokenArgsOf(call.data);
      if (args === undefined) {
        throw new Error("The build made no create call.");
      }
      const data = newTokenCallData({ ...args, sellTaxRate: 900 });
      const lie = encodeEvmDraft({ from: create.from, to: portal, value: call.value, data });
      return { ...built, steps: [...built.steps.slice(0, -1), lie] };
    },
  };
}

// The names of the contract checks that fail.
async function failedChecks(checks: readonly ContractCheck[]): Promise<readonly string[]> {
  const failed = await Promise.all(
    checks.map(async (check) =>
      check.run().then(
        () => [],
        () => [check.name],
      ),
    ),
  );
  return failed.flat();
}

describe("the Flap launcher", () => {
  it.each(launcherContract({ create: () => subjectOf(launcherOver(flapApiFake())) }))(
    "follows the launcher contract against BNB: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it.each(
    launcherContract({
      create: () =>
        subjectOf(launcherOver(flapApiFake()), {
          ...launch,
          pair: usdt,
          firstBuy: { asset: usdt, base: parseEther("10") },
        }),
    }),
  )("follows the launcher contract against USDT: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("fails the contract when its create call writes another tax than the card's", async () => {
    expect(
      await failedChecks(launcherContract({ create: () => subjectOf(lyingLauncher()) })),
    ).toEqual([
      "builds steps from the wallet whose create call decodes to the launch",
      "writes other settings into its create call, and reads them back from its bytes",
    ]);
  });

  it("builds an approval and the create call for a USDT first buy, and the coin as value", async () => {
    const launcher = launcherOver(flapApiFake());
    const fee = { asset: bnb, base: 0n };
    const request = { ...launch, metadataUri: recordedCid, fee, firstBuyMinOut: 1n };
    const coin = await launcher.buildLaunch(request, live);
    const token = await launcher.buildLaunch(
      { ...request, pair: usdt, firstBuy: { asset: usdt, base: 7n } },
      live,
    );
    expect(coin.steps.map((step) => successOf(decodeEvmDraft(step)).value)).toStrictEqual([
      parseEther("0.1"),
    ]);
    expect(token.steps).toHaveLength(2);
    expect(coin.token).toMatch(/7777$/);
    const decoded = successOf(launcher.decodeLaunch(draftAt(token.steps, 1)));
    expect(decoded.firstBuy).toStrictEqual({
      spend: { asset: usdt, base: 7n },
      minOut: 0n,
      recipient: recordedWallet,
    });
  });

  it("refuses to build with a launch fee, which the Portal does not take", async () => {
    const launcher = launcherOver(flapApiFake());
    const request = { ...launch, metadataUri: recordedCid, fee: { asset: bnb, base: 1n } };
    await expect(launcher.buildLaunch(request, live)).rejects.toMatchObject({
      code: "flap.no_route",
    });
  });

  it("never reads a gateway: it uploads, reads the pin's status until pinned, then builds", async () => {
    const http = flapApiFake([pinAnswer("queued"), pinAnswer("processing"), pinAnswer("pinned")]);
    const launcher = launcherOver(http);
    const pin = await launcher.pin(launch, live);
    expect(pin).toStrictEqual({ metadataUri: recordedCid, pin: { cid: recordedCid } });
    await expect(launcher.pinStatus(pin.pin, live)).resolves.toBe("pending");
    await expect(launcher.pinStatus(pin.pin, live)).resolves.toBe("pending");
    await expect(launcher.pinStatus(pin.pin, live)).resolves.toBe("pinned");
    const fee = { asset: bnb, base: 0n };
    await launcher.buildLaunch({ ...launch, metadataUri: pin.metadataUri, fee }, live);
    const pinsUrl = `https://funcs.flap.sh/api/v1/ipfs/pins?cid=${recordedCid}`;
    expect(http.urls()).toStrictEqual([
      "https://funcs.flap.sh/api/upload",
      pinsUrl,
      pinsUrl,
      pinsUrl,
    ]);
  });

  it("reads a failed pin as failed, and a pin of another CID as a fault", async () => {
    const failed = launcherOver(flapApiFake([pinAnswer("failed")]));
    await expect(failed.pinStatus({ cid: recordedCid }, live)).resolves.toBe("failed");
    const other = launcherOver(
      flapApiFake([pinAnswer("pinned", "bafkreiother0000000000000000000000")]),
    );
    await expect(other.pinStatus({ cid: recordedCid }, live)).rejects.toMatchObject({
      code: "flap.api_bad_answer",
    });
    await expect(failed.pinStatus({ upload: 1 }, live)).rejects.toMatchObject({
      code: "flap.bad_pin",
    });
  });
});
