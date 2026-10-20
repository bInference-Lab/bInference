import {
  accountRefSchema,
  assetRefSchema,
  chainRefSchema,
  type Launcher,
  type LaunchOption,
} from "@binference/chain";
import {
  createFakeLauncher,
  createFakeLinkLauncher,
  createFakePictureLauncher,
  createFakeLaunchpad,
  type FakeLauncherOptions,
  fakeDraft,
  fakeLaunchData,
} from "@binference/chain/testing";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { testNowMs } from "../intents/test-intents.js";
import { testChains } from "../operations/test-engine.js";
import type { HostedLaunch } from "./launch-calls.js";
import { createLaunchHost, type LaunchHost } from "./launch-host.js";

const pad = "fake-curve";
const chain = chainRefSchema.parse("fake:1");
const wallet = accountRefSchema.parse("fake:1:0x0000000c");
const coin = assetRefSchema.parse("fake:1/slip44:1");
const usd = assetRefSchema.parse("fake:1/token:0x0000000a");
const token = assetRefSchema.parse("fake:1/token:0x000000e1");
const live = { signal: new AbortController().signal };

const settings: readonly LaunchOption[] = [
  { name: "taxBps", type: "bps", max: 1000, default: 0 },
  { name: "taxRecipient", type: "account" },
  { name: "buyback", type: "flag", default: false },
];

function hostOf(
  launcher: Launcher,
  clock = createManualClock(testNowMs),
  unboundFirstBuys: readonly string[] = [pad],
): LaunchHost {
  return createLaunchHost({
    venues: [createFakeLaunchpad({ onCurve: [], launcher })],
    chains: testChains([pad]),
    clock,
    callTimeoutMs: 1_000,
    unboundFirstBuys: new Map([[chain, unboundFirstBuys]]),
  });
}

const fake = (options: FakeLauncherOptions = {}) => hostOf(createFakeLauncher(options));

const launch: HostedLaunch = {
  venue: pad,
  wallet,
  name: "Moon Cat",
  symbol: "MCAT",
  pair: coin,
  firstBuy: { asset: coin, base: 50n },
  settings: [],
};

const picture = { contentType: "image/png", bytes: new Uint8Array([137, 80]) };
const fee = { asset: coin, base: 2_000n };
const upload = {
  quote: { fee, firstBuyOut: 50_000n, tokenDecimals: 18 },
  metadataUri: "ipfs://fake-1",
  minOutBase: 49_500n,
};

describe("a launchpad's settings in the launch host", () => {
  it("fills the declared settings of a launchpad it hosts", () => {
    const host = fake({ launchOptions: settings });
    const given = { taxRecipient: "0x0000000c" };
    expect(host.settingsOf(pad, chain, given)).toMatchObject({ ok: true, value: { length: 3 } });
  });

  it("answers a venue that launches nothing, or another chain, as no launchpad", () => {
    const host = fake();
    const other = chainRefSchema.parse("fake:2");
    expect(host.settingsOf("fake-swap", chain, {})).toMatchObject({ error: "no_launchpad" });
    expect(host.settingsOf(pad, other, {})).toMatchObject({ error: "no_launchpad" });
  });

  it("refuses to host a launchpad with a setting that has no card line", () => {
    expect(() => fake({ launchOptions: [{ name: "mystery", type: "flag" }] })).toThrow(
      expect.objectContaining({ code: "venue.bad_declaration" }),
    );
  });

  it("refuses to host a launchpad whose settings break the declaration's rules", () => {
    const twice: readonly LaunchOption[] = [
      { name: "taxBps", type: "bps" },
      { name: "taxBps", type: "flag" },
    ];
    const wide: readonly LaunchOption[] = [{ name: "taxBps", type: "bps", max: 20_000 }];
    expect(() => fake({ launchOptions: twice })).toThrow(
      expect.objectContaining({ code: "venue.bad_declaration" }),
    );
    expect(() => fake({ launchOptions: wide })).toThrow(
      expect.objectContaining({ code: "venue.bad_declaration" }),
    );
  });
});

describe("a launchpad that uploads nothing", () => {
  const link: LaunchOption = { name: "pictureLink", type: "link" };

  it("is hosted when every launch must give its picture link", () => {
    const host = hostOf(createFakeLinkLauncher({ launchOptions: [link] }));
    expect(host.picturePlace(pad)).toBe("link");
    expect(host.picturePlace("other-pad")).toBeUndefined();
  });

  it.each<[string, readonly LaunchOption[]]>([
    ["no picture link", []],
    ["a picture link with a default", [{ ...link, default: "https://pictures.example/cat.png" }]],
  ])("is refused with %s", (_case, launchOptions) => {
    expect(() => hostOf(createFakeLinkLauncher({ launchOptions }))).toThrow(
      expect.objectContaining({ code: "venue.bad_declaration" }),
    );
  });
});

describe("a launchpad that writes the picture into its create call", () => {
  const words = { description: "A cat" };

  it("is hosted with no link, and says how many bytes of a picture fit beside the words", () => {
    const host = hostOf(createFakePictureLauncher({ mostBytes: 900 }));
    expect(host.picturePlace(pad)).toBe("create_call");
    expect(host.pictureBytesFor(pad, words)).toBe(900);
    expect(host.pictureBytesFor("other-pad", words)).toBeUndefined();
    expect(hostOf(createFakeLauncher()).pictureBytesFor(pad, words)).toBeUndefined();
  });

  it.each<[string, () => number]>([
    [
      "throws",
      () => {
        throw new Error("broken");
      },
    ],
    ["answers no whole number", () => 1.5],
    ["answers nothing", () => 0],
  ])("takes no picture from one whose answer %s", (_case, pictureBytesFor) => {
    const launcher = { ...createFakePictureLauncher({ mostBytes: 900 }), pictureBytesFor };
    expect(hostOf(launcher).pictureBytesFor(pad, words)).toBe(0);
  });

  it("is refused when it also uploads its picture", () => {
    const both = { ...createFakeLauncher(), pictureBytesFor: () => 900 };
    expect(() => hostOf(both)).toThrow(expect.objectContaining({ code: "venue.bad_declaration" }));
  });

  it("builds with the picture, and refuses a call that writes another", async () => {
    const written = { quote: upload.quote, minOutBase: upload.minOutBase, picture };
    const honest = hostOf(createFakePictureLauncher({ mostBytes: 900 }));
    await expect(honest.build(launch, written, live)).resolves.toMatchObject({ ok: true });
    const lying = hostOf(
      createFakePictureLauncher({ mostBytes: 900, writesPictureSha256: "0".repeat(64) }),
    );
    await expect(lying.build(launch, written, live)).resolves.toMatchObject({
      ok: false,
      mismatch: "other_launch",
    });
  });
});

describe("the launch host's quote, pin and pin status", () => {
  it("quotes the fee in the coin and the first buy's output", async () => {
    await expect(fake().quote(launch, live)).resolves.toStrictEqual({
      ok: true,
      value: { fee, firstBuyOut: 50_000n, tokenDecimals: 18 },
    });
  });

  it("answers a pair the launchpad does not launch against as no route", async () => {
    await expect(fake().quote({ ...launch, pair: usd }, live)).resolves.toMatchObject({
      error: "no_route",
    });
  });

  it("refuses a fee in another asset than the coin", async () => {
    const base = createFakeLauncher();
    const host = hostOf({
      ...base,
      quoteLaunch: async () => ({
        ok: true,
        value: { fee: { asset: usd, base: 1n }, firstBuyOut: 1n, tokenDecimals: 18 },
      }),
    });
    await expect(host.quote(launch, live)).resolves.toMatchObject({ error: "decode_mismatch" });
  });

  it("counts a launchpad that throws as down, and its pin read as no report yet", async () => {
    const base = createFakeLauncher();
    const host = hostOf({
      ...base,
      pin: async () => Promise.reject(new Error("upload failed")),
      pinStatus: async () => Promise.reject(new Error("gateway timeout")),
    });
    await expect(host.pin(launch, picture, live)).resolves.toMatchObject({ error: "venue_down" });
    await expect(host.pinStatus(pad, null, live)).resolves.toBe("pending");
  });

  it("counts a pin answer it cannot keep as a launchpad that is down", async () => {
    const base = createFakeLauncher();
    const big = hostOf({
      ...base,
      pin: async () => ({ metadataUri: "ipfs://fake-1", pin: { handle: "a".repeat(1_100) } }),
    });
    const long = hostOf({
      ...base,
      pin: async () => ({ metadataUri: `ipfs://${"a".repeat(194)}`, pin: null }),
    });
    await expect(big.pin(launch, picture, live)).resolves.toMatchObject({ error: "venue_down" });
    await expect(long.pin(launch, picture, live)).resolves.toMatchObject({ error: "venue_down" });
  });

  it("hands the launchpad its own copy of the picture's bytes", async () => {
    const base = createFakeLauncher();
    const host = hostOf({
      ...base,
      pin: async (request, call) => {
        (request.image.bytes as Uint8Array).fill(0);
        return base.pin(request, call);
      },
    });
    const own = { contentType: "image/png", bytes: new Uint8Array([137, 80]) };
    await expect(host.pin(launch, own, live)).resolves.toMatchObject({ ok: true });
    expect(own.bytes).toStrictEqual(new Uint8Array([137, 80]));
  });

  it("gives an upload 12 seconds, longer than a read", async () => {
    const clock = createManualClock(testNowMs);
    const base = createFakeLauncher();
    const slow = (ms: number): Launcher => ({
      ...base,
      pin: async (request, call) => {
        await clock.sleep(ms, call.signal);
        return base.pin(request, call);
      },
    });
    const taken = hostOf(slow(11_000), clock).pin(launch, picture, live);
    await clock.advance(11_000);
    await expect(taken).resolves.toMatchObject({ ok: true });
    const lost = hostOf(slow(13_000), clock).pin(launch, picture, live);
    await clock.advance(13_000);
    await expect(lost).resolves.toMatchObject({ error: "venue_down" });
  });

  it("reports a pin as the launchpad does", async () => {
    const host = fake({ pin: { failsAfterReads: 1 } });
    await expect(host.pin(launch, picture, live)).resolves.toMatchObject({
      ok: true,
      value: { metadataUri: "ipfs://fake-1" },
    });
    await expect(host.pinStatus(pad, null, live)).resolves.toBe("failed");
  });
});

describe("the launch host's build", () => {
  it("checks and keeps the create call of a coin first buy", async () => {
    const built = await fake().build(launch, upload, live);
    expect(built).toMatchObject({
      ok: true,
      value: { launch: { token, metadataUri: upload.metadataUri, feeBase: fee.base } },
    });
  });

  it("hands a launchpad that writes the words on chain the card's description and links", async () => {
    const wordLimits = { nameBytes: 64, symbolBytes: 16, descriptionBytes: 2_048, linkBytes: 256 };
    const host = fake({ wordLimits });
    const worded = { ...launch, description: "A cat", links: { x: "https://x.com/cat" } };
    await expect(host.build(worded, upload, live)).resolves.toMatchObject({
      ok: true,
      value: {
        launch: {
          words: {
            description: "A cat",
            links: { website: "", x: "https://x.com/cat", telegram: "" },
          },
        },
      },
    });
  });

  it("tells whether a launch's words fit the bytes a launchpad writes on chain", () => {
    const wordLimits = { nameBytes: 8, symbolBytes: 4, descriptionBytes: 6, linkBytes: 20 };
    const host = fake({ wordLimits });
    expect(host.fitsWords(pad, { name: "Moon Cat", symbol: "MCAT", description: "€€" })).toBe(true);
    expect(host.fitsWords(pad, { name: "Moon Cat", symbol: "MCAT", description: "€€€" })).toBe(
      false,
    );
    expect(
      fake().fitsWords(pad, { name: "Moon Cat", symbol: "MCAT", description: "€".repeat(900) }),
    ).toBe(true);
    expect(host.fitsWords("other-pad", { name: "Moon Cat", symbol: "MCAT" })).toBe(false);
  });

  it("checks an exact approval before a token first buy", async () => {
    const host = fake({ pair: usd });
    const bought = { ...launch, pair: usd, firstBuy: { asset: usd, base: 7n } };
    const built = await host.build(bought, { ...upload, minOutBase: 7_000n }, live);
    expect(built).toMatchObject({ ok: true, value: { steps: [{ kind: "approval" }, {}] } });
  });

  it("names the failed check of a step it refuses", async () => {
    const base = createFakeLauncher();
    const data = fakeLaunchData({
      token,
      name: launch.name,
      symbol: launch.symbol,
      metadataUri: upload.metadataUri,
      pair: coin,
      feeBase: fee.base,
      firstBuy: { spend: { asset: coin, base: 50n }, minOut: 1n, recipient: wallet },
      options: {},
    });
    const steps = [fakeDraft(wallet, { to: "0x0000000d", value: 2_050n, data })];
    const host = hostOf({ ...base, buildLaunch: async () => ({ token, steps }) });
    await expect(host.build(launch, upload, live)).resolves.toStrictEqual({
      ok: false,
      error: "decode_mismatch",
      mismatch: "low_min_out",
    });
  });

  it("takes a first buy with no minimum only from a launcher that declares it", async () => {
    const declared = fake({ noFirstBuyMin: true });
    const silent = fake({ writesMinOut: 0n });
    const minOut = { ...upload, minOutBase: 49_500n };
    await expect(declared.build(launch, minOut, live)).resolves.toMatchObject({ ok: true });
    await expect(silent.build(launch, minOut, live)).resolves.toStrictEqual({
      ok: false,
      error: "decode_mismatch",
      mismatch: "low_min_out",
    });
  });

  it("holds a declared launcher to its minimum when the registry does not list it", async () => {
    const unlisted = hostOf(createFakeLauncher({ noFirstBuyMin: true }), undefined, []);
    await expect(
      unlisted.build(launch, { ...upload, minOutBase: 49_500n }, live),
    ).resolves.toStrictEqual({
      ok: false,
      error: "decode_mismatch",
      mismatch: "low_min_out",
    });
  });

  it("refuses a create call that writes another tax than the card shows", async () => {
    const written = { taxBps: 1_000, taxRecipient: wallet, buyback: false };
    const host = fake({ launchOptions: settings, writesOptions: written });
    const taxed: HostedLaunch = {
      ...launch,
      settings: [
        { name: "taxBps", type: "bps", value: 300 },
        { name: "taxRecipient", type: "account", value: wallet },
        { name: "buyback", type: "flag", value: false },
      ],
    };
    await expect(host.build(taxed, upload, live)).resolves.toStrictEqual({
      ok: false,
      error: "decode_mismatch",
      mismatch: "other_settings",
    });
  });

  it("counts a build that throws as a launchpad that is down", async () => {
    const base = createFakeLauncher();
    const host = hostOf({ ...base, buildLaunch: async () => Promise.reject(new Error("down")) });
    await expect(host.build(launch, upload, live)).resolves.toMatchObject({ error: "venue_down" });
  });
});
