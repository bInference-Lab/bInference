import {
  accountRefSchema,
  assetRefSchema,
  type LaunchPinRequest,
  type LaunchTerms,
} from "@binference/plugin-sdk";
import { encodeEvmDraft } from "@binference/plugin-sdk/evm";
import { launcherContract, successOf } from "@binference/plugin-sdk/testing";
import { getAddress, parseEther, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import {
  btcb,
  type FactoryScript,
  launcherOver,
  launchSimulator,
  launchWallet,
  otherDistributor,
  testLaunch,
  usdt,
} from "../testing/launch-fixtures.js";
import { bnb, bscChain } from "../testing/recorded-launches.js";

const live = { signal: new AbortController().signal };
const other = encodeEvmDraft({ from: launchWallet, to: launchWallet, value: 0n, data: "0x" });
const otherStart = parseEther("9").toString();
// Another outside fee recipient, and holder rewards on in its place: each set the bytes must carry.
const otherRecipient = accountRefSchema.parse(
  `eip155:56:${getAddress("0x00000000000000000000000000000000000000bb")}`,
);
const otherOptions = { holderRewards: true, startMarketCap: otherStart };
const otherOptionSets = [
  { poolFeeRecipient: otherRecipient, startMarketCap: otherStart },
  otherOptions,
];
const elsewhere = assetRefSchema.parse(
  "eip155:56/erc20:0x00000000000000000000000000000000000000E1",
);

const usdtLaunch: LaunchPinRequest = {
  ...testLaunch,
  pair: usdt,
  firstBuy: { asset: usdt, base: parseEther("10") },
  options: { ...testLaunch.options, startMarketCap: parseEther("5000").toString() },
};

function subjectOf(launch: LaunchPinRequest = testLaunch) {
  return {
    launcher: launcherOver(),
    launch,
    otherOptionSets,
    otherPair: { ...launch, pair: elsewhere },
    other,
  };
}

const { startMarketCap: _start, ...unstarted } = testLaunch.options;
const leftOut = (launch: LaunchTerms): LaunchTerms => ({ ...launch, options: unstarted });

describe("the brew launcher", () => {
  it.each(launcherContract({ create: () => subjectOf() }))(
    "follows the launcher contract against BNB: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it.each(launcherContract({ create: () => subjectOf(usdtLaunch) }))(
    "follows the launcher contract against USDT: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it("works out the pair's fixed start when the launch sets none", async () => {
    const quote = successOf(await launcherOver().quoteLaunch(leftOut(testLaunch), live));
    expect(quote.settings).toStrictEqual({ startMarketCap: parseEther("8").toString() });
    expect(quote.fee).toStrictEqual({ asset: bnb, base: 0n });
    expect(quote.firstBuyOut).toBe(parseEther("100"));
  });

  it("starts any other pair at $5,000 at the pair's price, and refuses one with no price", async () => {
    const terms = { ...leftOut(testLaunch), pair: btcb, firstBuy: { asset: btcb, base: 1_000n } };
    // BTCB at $100,000: 10^11 micro-dollars for 10^18 base units.
    const priced = { ...terms, pairUsdPrice: { numerator: 10n ** 11n, denominator: 10n ** 18n } };
    const quote = successOf(await launcherOver().quoteLaunch(priced, live));
    expect(quote.settings).toStrictEqual({
      startMarketCap: (5n * 10n ** 16n).toString(),
      startBasis: "usdPrice",
    });
    await expect(launcherOver().quoteLaunch(terms, live)).resolves.toStrictEqual({
      ok: false,
      error: "start_unpriced",
    });
  });

  it("names paused launches, and a start no tick reaches", async () => {
    const paused = launcherOver(launchSimulator(), { isPaused: true });
    await expect(paused.quoteLaunch(testLaunch, live)).resolves.toStrictEqual({
      ok: false,
      error: "launch_paused",
    });
    const huge = {
      ...testLaunch,
      options: { ...testLaunch.options, startMarketCap: `1${"0".repeat(70)}` },
    };
    await expect(launcherOver().quoteLaunch(huge, live)).resolves.toStrictEqual({
      ok: false,
      error: "start_unreachable",
    });
  });

  it.each(["reverts", "refunds"] as const)("names a dry run that %s", async (run) => {
    await expect(
      launcherOver(launchSimulator(run)).quoteLaunch(testLaunch, live),
    ).resolves.toStrictEqual({
      ok: false,
      error: "dry_run_failed",
    });
  });

  it("names the step a fee recipient and holder rewards that do not go together need", () => {
    const { checkOptions } = launcherOver();
    const { poolFeeRecipient: _recipient, ...unnamed } = testLaunch.options;
    expect([
      checkOptions?.(testLaunch.options),
      checkOptions?.(unnamed),
      checkOptions?.({ ...testLaunch.options, holderRewards: true }),
      checkOptions?.({ ...unnamed, holderRewards: true }),
    ]).toStrictEqual([true, "recipient_needed", "recipient_unused", true]);
  });
});

describe("a Brew launch's build", () => {
  const request = { ...testLaunch, picture: testLaunch.image, fee: { asset: bnb, base: 0n } };
  const bound = { ...request, firstBuyMinOut: parseEther("99") };

  it("reads back a start worked out from the pair's USD price, for the card to say so", async () => {
    const launcher = launcherOver();
    const priced = { ...bound.options, startBasis: "usdPrice" };
    const built = await launcher.buildLaunch({ ...bound, options: priced }, live);
    const decoded = built.steps.map((step) => launcher.decodeLaunch(step));
    expect(decoded).toMatchObject([{ ok: true, value: { options: { startBasis: "usdPrice" } } }]);
  });

  it("names a token whose address ends in 6666", async () => {
    const built = await launcherOver().buildLaunch(bound, live);
    expect(built.token.toLowerCase().endsWith("6666")).toBe(true);
    expect(built.steps).toHaveLength(1);
  });

  // A build with holder rewards on, over a fake chain that answers as the script says.
  const holdersOver = async (script: FactoryScript) => {
    const { poolFeeRecipient: _recipient, ...kept } = bound.options;
    const options = { ...kept, ...otherOptions };
    return launcherOver(launchSimulator(), script).buildLaunch({ ...bound, options }, live);
  };

  it("names the holder distributor as fee recipient with holder rewards on", async () => {
    const launcher = launcherOver();
    const { poolFeeRecipient: _recipient, ...kept } = bound.options;
    const built = await launcher.buildLaunch(
      { ...bound, options: { ...kept, ...otherOptions } },
      live,
    );
    const decoded = built.steps.map((step) => launcher.decodeLaunch(step));
    const distributor = built.settings?.["holderDistributor"];
    expect(distributor).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(decoded).toMatchObject([
      {
        ok: true,
        value: {
          options: { holderRewards: true, holderDistributor: `${bscChain}:${distributor}` },
        },
      },
    ]);
  });

  it.each<[string, () => Promise<unknown>]>([
    [
      "a fee other than the quoted one",
      async () => launcherOver().buildLaunch({ ...bound, fee: { asset: bnb, base: 1n } }, live),
    ],
    ["a first buy without a minimum", async () => launcherOver().buildLaunch(request, live)],
    [
      "no picture",
      async () => {
        const { picture: _picture, ...bare } = bound;
        return launcherOver().buildLaunch(bare, live);
      },
    ],
    [
      "a factory that predicts another token",
      async () => launcherOver(launchSimulator(), { predictsOther: true }).buildLaunch(bound, live),
    ],
    [
      "a distributor factory that predicts another holder distributor",
      async () => holdersOver({ predictsDistributor: otherDistributor }),
    ],
    [
      "a distributor factory that predicts none",
      async () => holdersOver({ predictsDistributor: zeroAddress }),
    ],
  ])("refuses %s", async (_case, build) => {
    await expect(build()).rejects.toThrow(expect.objectContaining({ code: "brew.no_route" }));
  });
});
