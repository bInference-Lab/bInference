import { chainRefSchema, type VenueDeclaration } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { expectOk } from "../intents/test-intents.js";
import { testChains } from "../operations/test-engine.js";
import { callInputChecksOf } from "./call-input-checks.js";
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
      { abi: deposit, wallet: ["depositor"], equal: {}, empty: ["message"], atLeast: {} },
    ]);
  });

  it("checks nothing for a venue whose calls pin and empty nothing", () => {
    expect(callInputChecksOf(fakeChain, [])).toStrictEqual([]);
  });
});
