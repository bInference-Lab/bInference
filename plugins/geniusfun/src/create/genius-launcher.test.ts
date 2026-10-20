import {
  accountRefSchema,
  assetRefSchema,
  type LaunchBuildRequest,
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
import { createCallData, createCallOf } from "../contracts/launch-call.js";
import {
  launchEnabledRead,
  launcherOver,
  launchReads,
  launchSimulator,
  madeToken,
  testLaunch as launch,
} from "../testing/launch-fixtures.js";
import { bnb, bscChain, recordedWallet, usdt } from "../testing/venue-fixtures.js";

const live = { signal: new AbortController().signal };
const at = (address: string) => accountRefSchema.parse(`${bscChain}:${address}`);
const router = at("0xd8b71b46498A36A4607EAb5C735BeE1DAb7F263d");
const factory = at("0x37eE8AeE29C5efd3C1A7edA6dF3F510779928a37");
const launchFee = 2_000_000_000_000_000n;
const minimum = 1_000n;

const otherOptions = {
  creatorFeeRecipient: recordedWallet,
  pictureLink: "https://pictures.example/cat.png",
};

// WBNB: a token Genius.fun's curves do not trade against.
const wbnb = assetRefSchema.parse(`${bscChain}/erc20:0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c`);

// A buy on a curve: a call of the venue that is no create call.
const buy = encodeEvmDraft({ from: recordedWallet, to: router, value: 1n, data: "0x59a87bc1" });

function subjectOf(launcher: Launcher, launched: LaunchPinRequest = launch) {
  return {
    launcher,
    launch: launched,
    otherOptions,
    otherPair: { ...launched, pair: wbnb },
    other: buy,
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

// A launcher whose create call writes a value the card does not show, by `rewrite` of its call.
function lyingLauncher(rewrite: (data: `0x${string}`) => `0x${string}`): Launcher {
  const honest = launcherOver();
  return {
    ...honest,
    async buildLaunch(request, options) {
      const built = await honest.buildLaunch(request, options);
      const create = draftAt(built.steps, built.steps.length - 1);
      const call = successOf(decodeEvmDraft(create));
      const lie = encodeEvmDraft({
        from: create.from,
        to: at(call.to),
        value: call.value,
        data: rewrite(call.data),
      });
      return { ...built, steps: [...built.steps.slice(0, -1), lie] };
    },
  };
}

// A create call's calldata with another picture link; one that is no create call, as it is.
function otherLink(data: `0x${string}`): `0x${string}` {
  const call = createCallOf(data);
  return call === undefined
    ? data
    : createCallData({ ...call, params: { ...call.params, logo: "https://other.example/x.png" } });
}

// The request of the launch's build: its quote, its words and the host's minimum.
const buildOf = (launched: LaunchPinRequest = launch): LaunchBuildRequest => {
  const { image: _image, ...terms } = launched;
  const fee = { asset: bnb, base: launchFee };
  const minOut = launched.firstBuy === undefined ? {} : { firstBuyMinOut: minimum };
  return { ...terms, fee, ...minOut };
};

// The create call's arguments, read back from the last step of a build.
async function builtCall(launched: LaunchPinRequest = launch) {
  const launcher = launcherOver();
  const built = await launcher.buildLaunch(buildOf(launched), live);
  const create = successOf(decodeEvmDraft(draftAt(built.steps, built.steps.length - 1)));
  return { built, create, call: createCallOf(create.data) };
}

const usdtLaunch: LaunchPinRequest = {
  ...launch,
  pair: usdt,
  firstBuy: { asset: usdt, base: parseEther("10") },
};

describe("the geniusfun launcher", () => {
  it.each(launcherContract({ create: () => subjectOf(launcherOver()) }))(
    "follows the launcher contract against BNB: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it.each(launcherContract({ create: () => subjectOf(launcherOver(), usdtLaunch) }))(
    "follows the launcher contract against USDT: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it("fails the contract when its create call writes another picture link than the card's", async () => {
    const lying = lyingLauncher(otherLink);
    expect(await failedChecks(launcherContract({ create: () => subjectOf(lying) }))).toEqual([
      "builds steps from the wallet whose create call decodes to the launch",
      "writes other settings into its create call, and reads them back from its bytes",
    ]);
  });

  it("uploads nothing, and takes the bytes the launch deployer takes", () => {
    const launcher = launcherOver();
    expect(launcher.pin).toBeUndefined();
    expect(launcher.pinStatus).toBeUndefined();
    expect(launcher.noFirstBuyMin).toBeUndefined();
    // Genius.fun pays creator fees only on the recipient's own claim, so it is outside binference.
    expect(launcher.launchOptions).toStrictEqual([
      { name: "creatorFeeRecipient", type: "account", isOutsideOnly: true },
      { name: "pictureLink", type: "link" },
    ]);
    expect(launcher.wordLimits).toStrictEqual({
      nameBytes: 64,
      symbolBytes: 16,
      descriptionBytes: 2_048,
      linkBytes: 256,
    });
  });

  it("quotes the factory's launch fee and what the dry run's first buy got", async () => {
    await expect(launcherOver().quoteLaunch(launch, live)).resolves.toStrictEqual({
      ok: true,
      value: {
        fee: { asset: bnb, base: launchFee },
        tokenDecimals: 18,
        firstBuyOut: parseEther("98"),
      },
    });
  });

  it("runs the dry run on a wallet that holds only the fee and the first buy", async () => {
    const simulator = launchSimulator();
    await launcherOver(simulator).quoteLaunch(usdtLaunch, live);
    expect(simulator.held()).toStrictEqual([
      [
        { asset: bnb, base: launchFee },
        { asset: usdt, base: parseEther("10") },
      ],
    ]);
  });

  it("answers a stack closed to launches as no route", async () => {
    const closed = new Map(launchReads);
    closed.set(launchEnabledRead, { result: `0x${"0".repeat(64)}` });
    await expect(
      launcherOver(launchSimulator(), closed).quoteLaunch(launch, live),
    ).resolves.toStrictEqual({
      ok: false,
      error: "no_route",
    });
  });

  it.each([
    ["reverts", "refused the launch"],
    ["refunds", "would complete the curve"],
  ] as const)("throws when the dry run %s", async (run, message) => {
    await expect(launcherOver(launchSimulator(run)).quoteLaunch(launch, live)).rejects.toThrow(
      message,
    );
  });

  it("builds one launchAndBuy call to the router for a coin first buy, paying the fee and the buy", async () => {
    const { built, create, call } = await builtCall();
    expect(built.steps).toHaveLength(1);
    expect(create.to).toBe("0xd8b71b46498A36A4607EAb5C735BeE1DAb7F263d");
    expect(create.value).toBe(launchFee + parseEther("0.1"));
    expect(built.token).toBe(`${bscChain}/erc20:${madeToken}`);
    expect(call).toMatchObject({
      kind: "launchAndBuy",
      configId: 0n,
      pairToken: "0x0000000000000000000000000000000000000000",
      quoteIn: parseEther("0.1"),
      minimum,
      recipient: "0x000000000000000000000000000000000000bEEF",
      toFoundation: false,
      params: {
        name: "Moon Cat",
        symbol: "MCAT",
        logo: launch.options["pictureLink"],
        description: "A cat on the moon",
        socials: {
          twitter: "https://x.com/mooncat",
          telegram: "",
          discord: "",
          website: "https://moon.example",
          farcaster: "",
        },
        creatorFeeRecipient: "0x00000000000000000000000000000000000000AA",
        creatorTaxBps: 0,
        buybackEnabled: true,
      },
    });
  });

  it("approves the router for exactly a token first buy before its create call", async () => {
    const { built, create } = await builtCall(usdtLaunch);
    expect(built.steps).toHaveLength(2);
    const approval = successOf(decodeEvmDraft(draftAt(built.steps, 0)));
    expect(approval.to).toBe("0x55d398326f99059fF775485246999027B3197955");
    expect(approval.data).toContain("d8b71b46498a36a4607eab5c735bee1dab7f263d");
    expect(create.value).toBe(launchFee);
  });

  it("launches with no first buy through the factory alone, paying only the fee", async () => {
    const { firstBuy: _firstBuy, ...alone } = launch;
    const { built, create, call } = await builtCall(alone);
    expect(built.steps).toHaveLength(1);
    expect(create.to).toBe("0x37eE8AeE29C5efd3C1A7edA6dF3F510779928a37");
    expect(create.value).toBe(launchFee);
    expect(call).toMatchObject({ kind: "launch", toFoundation: false });
    expect(factory).toBe(at(create.to));
  });

  it("refuses to build a first buy with no minimum", async () => {
    const { firstBuyMinOut: _minimum, ...request } = buildOf();
    await expect(launcherOver().buildLaunch(request, live)).rejects.toMatchObject({
      code: "geniusfun.no_route",
    });
  });

  it("refuses to build when the launch fee is no longer the quoted one", async () => {
    const request = { ...buildOf(), fee: { asset: bnb, base: 1n } };
    await expect(launcherOver().buildLaunch(request, live)).rejects.toMatchObject({
      code: "geniusfun.no_route",
    });
  });

  it("refuses to decode a create call it never built", async () => {
    const { create } = await builtCall();
    const fresh = launcherOver();
    const draft = encodeEvmDraft({
      from: recordedWallet,
      to: router,
      value: create.value,
      data: create.data,
    });
    expect(fresh.decodeLaunch(draft)).toStrictEqual({ ok: false, error: "unknown_call" });
  });
});
