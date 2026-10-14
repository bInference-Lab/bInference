import { type AssetRef, assetRefSchema, type QuoteRequest } from "@binference/plugin-sdk";
import { type Address, parseEther, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import type { RecordedCall } from "../testing/recorded-answers.js";
import { scriptedChain } from "../testing/recorded-chain.js";
import {
  bnb,
  contractsWith,
  graduatedToken,
  launchAnswer,
  launchFactoryAnswer,
  noLaunchFactoryAnswer,
  olderCurve,
  olderToken,
  otherPairCurve,
  otherPairToken,
  partsOver,
  registryContracts,
  requestOf,
  sellableAnswer,
  snipeTaxAnswer,
  stackCurve,
  stackToken,
  usdt,
  venueOver,
} from "../testing/venue-fixtures.js";
import { curveQuote } from "./quote-trade.js";

const live = (): AbortSignal => new AbortController().signal;
const tenthBnb = { asset: bnb, base: parseEther("0.1") };
const factoryM41: Address = "0x78EAE9537C0ef90DFe9B7ae964682Fe8138afe31";
const factories: readonly Address[] = ["0x37eE8AeE29C5efd3C1A7edA6dF3F510779928a37", factoryM41];
const stackAddress: Address = "0x7D227534c39C41033Af86DBC8aDE1BF8D68b0157";
// A token no recording holds, which the tests give the answers they need.
const unlisted: Address = "0x00000000000000000000000000000000000Ba5E5";
const unlistedToken: AssetRef = assetRefSchema.parse(`eip155:56/erc20:${unlisted}`);
// Neither listed stack made the unlisted token.
const unmade = factories.map((factory) =>
  launchAnswer(factory, {
    token: unlisted,
    curve: zeroAddress,
    pairToken: zeroAddress,
    exists: false,
  }),
);

async function quoteWith(
  changes: readonly (readonly [string, RecordedCall])[],
  request: QuoteRequest = requestOf(tenthBnb, stackToken),
) {
  return curveQuote(request, partsOver(scriptedChain({ calls: new Map(changes) })), live());
}

describe("geniusfun quotes", () => {
  // The curves' own `buy`, called by eth_call from the recorded wallet at the recorded block,
  // answered these outputs for 0.1 BNB.
  it.each([
    {
      stack: "m4.2",
      token: stackToken,
      curve: stackCurve,
      out: 16_064_260_551_057_052_034_006_065n,
    },
    {
      stack: "m4.1",
      token: olderToken,
      curve: olderCurve,
      out: 15_132_829_533_012_919_327_536_197n,
    },
  ])(
    "quotes a buy on an $stack curve to the wei the curve's own buy gives",
    async ({ token, curve, out }) => {
      const quote = await venueOver(scriptedChain()).quote(requestOf(tenthBnb, token, curve), {
        signal: live(),
      });
      expect(quote).toMatchObject({
        ok: true,
        value: { expectedOut: { asset: token, base: out } },
      });
      expect(quote).not.toHaveProperty("value.taxBps");
    },
  );

  it("quotes a sale with the curve's fee off its proceeds and the move it makes", async () => {
    const request = requestOf({ asset: stackToken, base: parseEther("1000000") }, bnb);
    await expect(
      venueOver(scriptedChain()).quote(request, { signal: live() }),
    ).resolves.toStrictEqual({
      ok: true,
      value: { expectedOut: { asset: bnb, base: 5_876_551_090_613_455n }, priceImpactBps: 210 },
    });
  });

  it("names the snipe tax a buy in the launch window pays, bounded so the buyer keeps 1%", async () => {
    const window = await quoteWith([snipeTaxAnswer(stackCurve, 9_900n)]);
    const late = await quoteWith([snipeTaxAnswer(stackCurve, 300n)]);
    expect(window).toMatchObject({ ok: true, value: { taxBps: 9_700, snipeTaxBps: 9_700 } });
    expect(late).toMatchObject({ ok: true, value: { taxBps: 300, snipeTaxBps: 300 } });
  });

  it.each<[string, QuoteRequest, string]>([
    ["a pair of two quote assets", requestOf(tenthBnb, usdt), "no_curve_trade"],
    [
      "a graduated token, for which the host gave no curve",
      { ...requestOf(tenthBnb, graduatedToken), contracts: registryContracts },
      "not_on_curve",
    ],
    [
      "a token whose curve trades against another launch's token",
      requestOf(tenthBnb, otherPairToken, otherPairCurve),
      "other_pair",
    ],
    [
      "a buy that would take the curve's last tokens",
      requestOf({ asset: bnb, base: parseEther("1000") }, stackToken),
      "fills_curve",
    ],
  ])("gives no route for %s", async (_case, request, reason) => {
    await expect(quoteWith([], request)).resolves.toStrictEqual({ ok: false, error: reason });
  });

  it("gives no route for a curve that is ready to graduate", async () => {
    await expect(quoteWith([sellableAnswer(stackCurve, 0n)])).resolves.toStrictEqual({
      ok: false,
      error: "not_on_curve",
    });
  });

  it("gives no route, as not launched, for a token no stack made and no factory claims", async () => {
    const changes = [...unmade, noLaunchFactoryAnswer(unlisted)];
    await expect(quoteWith(changes, requestOf(tenthBnb, unlistedToken))).resolves.toStrictEqual({
      ok: false,
      error: "not_launched",
    });
  });

  it("gives no route for a token a stack the registry does not list says it launched", async () => {
    const unknown: Address = "0x000000000000000000000000000000000000dEaD";
    const changes = [
      ...unmade,
      launchFactoryAnswer(unlisted, unknown),
      launchAnswer(unknown, { token: unlisted, curve: stackCurve, pairToken: zeroAddress }),
    ];
    await expect(quoteWith(changes, requestOf(tenthBnb, unlistedToken))).resolves.toStrictEqual({
      ok: false,
      error: "unknown_stack",
    });
  });

  it("answers every reason through the port as no route", async () => {
    const request = requestOf(tenthBnb, otherPairToken, otherPairCurve);
    await expect(
      venueOver(scriptedChain()).quote(request, { signal: live() }),
    ).resolves.toStrictEqual({ ok: false, error: "no_route" });
  });

  it("throws when the host's curve is not the token's own", async () => {
    const request = { ...requestOf(tenthBnb, stackToken), contracts: contractsWith(olderCurve) };
    await expect(quoteWith([], request)).rejects.toMatchObject({ code: "geniusfun.read_failed" });
  });

  it("throws when two stacks both say they launched the token", async () => {
    const twice = launchAnswer(factoryM41, {
      token: stackAddress,
      curve: stackCurve,
      pairToken: zeroAddress,
    });
    await expect(quoteWith([twice])).rejects.toMatchObject({ code: "geniusfun.read_failed" });
  });
});
