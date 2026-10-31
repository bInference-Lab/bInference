import { accountRefSchema, chainRefSchema, type VenueDeclaration } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { expectOk } from "../intents/test-intents.js";
import { testChains } from "../operations/test-engine.js";
import { callInputChecksOf } from "./call-input-checks.js";
import { declaredCallsOf, walletOnlySpendersOf } from "./declared-calls.js";
import { benchChain } from "./test-executor.js";

const fakeChain = expectOk(testChains().get(benchChain));

const swapTo = {
  type: "function",
  name: "swapTo",
  inputs: [{ name: "receiver", type: "address" }],
};
const swap = { type: "function", name: "swap", inputs: [] };
const deposit = { type: "function", name: "depositV3", inputs: [] };

const venue: VenueDeclaration = {
  id: "fake-swap",
  contracts: [
    {
      chain: fakeChain.ref,
      names: ["router"],
      calls: [
        { contract: "router", abi: swap, walletInputs: [] },
        { contract: "router", abi: swapTo, walletInputs: ["receiver"] },
        {
          contract: "router",
          abi: deposit,
          walletInputs: ["depositor"],
          bridge: {
            recipient: "recipient",
            destinationChain: "destinationChainId",
            tokenIn: "inputToken",
            tokenOut: "outputToken",
            emptyInputs: ["message"],
          },
        },
      ],
    },
    {
      chain: chainRefSchema.parse("fake:2"),
      names: ["router"],
      calls: [{ contract: "router", abi: swapTo, walletInputs: ["receiver"] }],
    },
  ],
};

describe("the input checks a route's venues declare", () => {
  it("checks each pinned input and each empty one, on the step's chain only", () => {
    expect(callInputChecksOf(fakeChain, [venue])).toStrictEqual([
      { abi: swapTo, wallet: ["receiver"], equal: {}, empty: [], atLeast: {} },
      {
        abi: deposit,
        wallet: ["depositor"],
        equal: {},
        empty: ["message"],
        atLeast: {},
        bridge: { recipient: "recipient", destinationChain: "destinationChainId" },
      },
    ]);
  });

  it("checks nothing for a venue whose calls pin and empty nothing", () => {
    expect(callInputChecksOf(fakeChain, [])).toStrictEqual([]);
  });

  it("declares every function of the venue on the step's chain, a bridge deposit too", () => {
    expect(declaredCallsOf(fakeChain, [venue]).map((call) => call.abi)).toStrictEqual([
      swap,
      swapTo,
      deposit,
    ]);
  });
});

describe("the functions and spenders a route's venues declare", () => {
  const router = accountRefSchema.parse("fake:1:0x0000000b");
  const curve = { type: "function", name: "buy", inputs: [] };
  const launchpad: VenueDeclaration = {
    id: "fake-swap",
    contracts: [
      {
        chain: fakeChain.ref,
        names: ["router"],
        launchContracts: ["curve"],
        calls: [
          { contract: "router", abi: swap, walletInputs: [] },
          { contract: "curve", abi: curve, walletInputs: [] },
          { contract: "elsewhere", abi: swapTo, walletInputs: [] },
        ],
        onlyWalletSpenders: { bridge: ["router"], launch: ["elsewhere"] },
      },
    ],
  };

  it("names each call's registry contract, none for a launch's own, and skips the rest", () => {
    expect(declaredCallsOf(fakeChain, [launchpad])).toStrictEqual([
      { contract: router, abi: swap },
      { abi: curve },
    ]);
  });

  it("names each spender only a wallet of one role approves, by its registry contract", () => {
    expect(walletOnlySpendersOf(fakeChain, [launchpad])).toStrictEqual([
      { role: "bridge", spender: router },
    ]);
  });
});
