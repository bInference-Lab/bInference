import { accountRefSchema, assetRefSchema } from "@binference/plugin-sdk";
import { type Address, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import { launchPhase } from "../contracts/genius-calls.js";
import type { RecordedCall } from "../testing/recorded-answers.js";
import { scriptedChain } from "../testing/recorded-chain.js";
import {
  bnb,
  graduatedToken,
  launchAnswer,
  launchFactoryAnswer,
  olderCurve,
  olderToken,
  otherPairToken,
  otherQuote,
  partsOver,
  registryContracts,
  sellableAnswer,
  stackCurve,
  stackToken,
  usdt,
} from "../testing/venue-fixtures.js";
import { readCurve } from "./read-curve.js";

const live = (): AbortSignal => new AbortController().signal;
const curveOf = (address: Address) => accountRefSchema.parse(`eip155:56:${address}`);
const stackFactory: Address = "0x37eE8AeE29C5efd3C1A7edA6dF3F510779928a37";
const stackAddress: Address = "0x7D227534c39C41033Af86DBC8aDE1BF8D68b0157";

// The m4.2 factory's record of the recorded token, in another phase.
function phaseAnswer(phase: number): readonly [string, RecordedCall] {
  return launchAnswer(stackFactory, {
    token: stackAddress,
    curve: stackCurve,
    pairToken: zeroAddress,
    phase,
  });
}

async function curveWith(
  token: typeof bnb,
  changes: readonly (readonly [string, RecordedCall])[] = [],
) {
  const rpc = scriptedChain({ calls: new Map(changes) });
  return readCurve({ token, contracts: registryContracts }, partsOver(rpc), live());
}

describe("geniusfun curve read", () => {
  it.each([
    ["an m4.2 launch", stackToken, stackCurve],
    ["an m4.1 launch", olderToken, olderCurve],
  ] as const)(
    "holds a token of %s on its curve, and names the curve",
    async (_case, token, curve) => {
      await expect(curveWith(token)).resolves.toStrictEqual({
        onCurve: true,
        quoteAsset: bnb,
        launch: { curve: curveOf(curve) },
      });
    },
  );

  it("holds a token whose curve trades against another launch's token, against that token", async () => {
    await expect(curveWith(otherPairToken)).resolves.toMatchObject({
      onCurve: true,
      quoteAsset: otherQuote,
    });
  });

  it.each([
    ["a graduated token", graduatedToken],
    ["a token no stack made", usdt],
    ["the chain's coin", bnb],
    ["an asset of another chain", assetRefSchema.parse(`eip155:1/erc20:${stackCurve}`)],
  ])("holds no %s", async (_case, token) => {
    await expect(curveWith(token)).resolves.toStrictEqual({ onCurve: false });
  });

  it.each([
    ["whose curve is ready to graduate", [sellableAnswer(stackCurve, 0n)]],
    ["whose launch was swept before its pool", [phaseAnswer(launchPhase.swept)]],
  ])("holds a token %s with no curve, so it goes nowhere", async (_case, changes) => {
    await expect(curveWith(stackToken, changes)).resolves.toStrictEqual({
      onCurve: true,
      quoteAsset: bnb,
    });
  });

  it.each([
    ["with its pool", launchPhase.poolCreated],
    ["whose reserves the stack's owner rescued", launchPhase.rescued],
  ])("lets go of a token %s, so the pools take over", async (_case, phase) => {
    await expect(curveWith(stackToken, [phaseAnswer(phase)])).resolves.toStrictEqual({
      onCurve: false,
    });
  });

  it("holds a token a stack the registry does not list made, against its pair and with no curve", async () => {
    const token: Address = "0x00000000000000000000000000000000000Ba5E5";
    const unknown: Address = "0x000000000000000000000000000000000000dEaD";
    const unmade = [
      "0x37eE8AeE29C5efd3C1A7edA6dF3F510779928a37",
      "0x78EAE9537C0ef90DFe9B7ae964682Fe8138afe31",
    ].map((factory) =>
      launchAnswer(factory as Address, {
        token,
        curve: zeroAddress,
        pairToken: zeroAddress,
        exists: false,
      }),
    );
    const changes = [
      ...unmade,
      launchFactoryAnswer(token, unknown),
      launchAnswer(unknown, { token, curve: stackCurve, pairToken: zeroAddress }),
    ];
    const asset = assetRefSchema.parse(`eip155:56/erc20:${token}`);
    await expect(curveWith(asset, changes)).resolves.toStrictEqual({
      onCurve: true,
      quoteAsset: bnb,
    });
  });

  it("throws when a stack's record cannot be read", async () => {
    const broken = [
      "0x37ee8aee29c5efd3c1a7eda6df3f510779928a37|0x3cf28b5a000000000000000000000000" +
        "7d227534c39c41033af86dbc8ade1bf8d68b0157",
      { revert: "0x" },
    ] as const;
    await expect(curveWith(stackToken, [broken])).rejects.toMatchObject({
      code: "geniusfun.read_failed",
    });
  });
});
