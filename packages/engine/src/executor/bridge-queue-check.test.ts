import {
  accountRefSchema,
  assetRefSchema,
  type CallInputCheck,
  chainRefSchema,
  createChainRegistry,
  type RegisteredChain,
  type VenueDeclaration,
} from "@binference/chain";
import {
  createFakeChainDefinition,
  createFakeFamily,
  createFakeSigningScheme,
} from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import type { BridgeIntentQuote } from "../intents/bridge-quote.js";
import { bridgeTargetsOf } from "./bridge-queue-check.js";

const definition = createFakeChainDefinition();
const [router] = definition.contracts;
const spokeEntry = { venue: "fake-cross", name: "spoke", address: "0x000000e1" };
const registry = createChainRegistry({
  chains: [
    {
      ...definition,
      contracts: [
        ...definition.contracts,
        ...(router === undefined ? [] : [{ ...router, ...spokeEntry }]),
      ],
    },
  ],
  families: [createFakeFamily()],
  signingSchemes: [createFakeSigningScheme()],
});
const spoke = accountRefSchema.parse("fake:1:0x000000e1");
const depositAbi = { type: "function", name: "depositV3", inputs: [] };
const depositInputs = {
  recipient: "recipient",
  destinationChain: "destinationChainId",
  tokenIn: "inputToken",
  tokenOut: "outputToken",
  minOut: "outputAmount",
  emptyInputs: ["message"],
} as const;

// The fake bridge's declaration: its spoke by the name given, its deposit with the inputs given.
function declared(
  name = "spoke",
  inputs: typeof depositInputs & { readonly amountIn?: string } = {
    ...depositInputs,
    amountIn: "inputAmount",
  },
): VenueDeclaration {
  return {
    id: "fake-cross",
    contracts: [
      {
        chain: chainRefSchema.parse(definition.id),
        names: [name],
        calls: [{ contract: name, abi: depositAbi, walletInputs: ["depositor"], bridge: inputs }],
        spenders: [name],
      },
    ],
  };
}

const bridge = declared();
const recipient20 = `0x${"ab".repeat(20)}`;
const tokenIn = `0x${"0a".repeat(20)}`;
const tokenOut = `0x${"0b".repeat(20)}`;
const quote: BridgeIntentQuote = {
  venue: "fake-cross",
  chainName: "Base",
  amount: { asset: assetRefSchema.parse(`fake:1/token:${tokenIn}`), base: 100n },
  recipient: accountRefSchema.parse(`eip155:8453:${recipient20}`),
  recipientBytes: recipient20,
  expectedOut: { asset: assetRefSchema.parse(`eip155:8453/erc20:${tokenOut}`), base: 99n },
  minOut: { asset: assetRefSchema.parse(`eip155:8453/erc20:${tokenOut}`), base: 2n ** 70n },
  fees: [],
  etaSeconds: 4,
  quotedAtMs: 1,
  expiresAtMs: 2,
  deposit: { kind: "bound", contract: spoke, destinationId: "8453" },
};

function chainOf(): RegisteredChain {
  const [chain] = registry.list();
  if (chain === undefined) {
    throw new Error("Expected the fake chain.");
  }
  return chain;
}

describe("what the signer lets a confirmed bridge reach", () => {
  it("fills the deposit's recipient, chain, tokens, amount and least output from the card's plan", () => {
    const targets = bridgeTargetsOf(quote, { chain: chainOf(), venues: [], bridges: [bridge] });
    const expected: CallInputCheck = {
      abi: depositAbi,
      wallet: ["depositor"],
      equal: {
        recipient: recipient20,
        destinationChainId: "8453",
        inputToken: tokenIn,
        outputToken: tokenOut,
        inputAmount: "100",
      },
      empty: ["message"],
      atLeast: { outputAmount: (2n ** 70n).toString() },
      bridge: {
        recipient: "recipient",
        destinationChain: "destinationChainId",
        tokenIn: "inputToken",
        tokenOut: "outputToken",
        amountIn: "inputAmount",
        minOut: "outputAmount",
      },
    };
    expect(targets).toMatchObject({
      contracts: [spoke],
      spenders: [spoke],
      recipients: [],
      callInputs: [expected],
    });
  });

  it("leaves a 32-byte recipient unfilled, so the signer refuses the deposit", () => {
    const wide = { ...quote, recipientBytes: `0x${"cd".repeat(32)}` };
    const targets = bridgeTargetsOf(wide, { chain: chainOf(), venues: [], bridges: [bridge] });
    expect(targets.callInputs?.[0]?.equal).toStrictEqual({});
    expect(targets.callInputs?.[0]?.atLeast).toStrictEqual({});
  });

  it("leaves a deposit of a coin with no token contract unfilled, so the signer refuses it", () => {
    const coin = {
      ...quote,
      amount: { ...quote.amount, asset: assetRefSchema.parse("fake:1/slip44:60") },
    };
    const targets = bridgeTargetsOf(coin, { chain: chainOf(), venues: [], bridges: [bridge] });
    expect(targets.callInputs?.[0]?.equal).toStrictEqual({});
  });

  it("pins no amount of a deposit whose venue declares no amount input", () => {
    const noAmount = declared("spoke", depositInputs);
    const targets = bridgeTargetsOf(quote, { chain: chainOf(), venues: [], bridges: [noAmount] });
    expect(targets.callInputs?.[0]?.equal).toStrictEqual({
      recipient: recipient20,
      destinationChainId: "8453",
      inputToken: tokenIn,
      outputToken: tokenOut,
    });
  });

  it("names no contract a bridge declares by a name the registry does not list", () => {
    const unlisted = declared("gone");
    expect(
      bridgeTargetsOf(quote, { chain: chainOf(), venues: [], bridges: [unlisted] }).contracts,
    ).toStrictEqual([]);
  });

  it("names no contract of a venue other than the bridge's", () => {
    const other = { ...quote, venue: "elsewhere" };
    expect(
      bridgeTargetsOf(other, { chain: chainOf(), venues: [], bridges: [bridge] }).contracts,
    ).toStrictEqual([]);
  });
});
