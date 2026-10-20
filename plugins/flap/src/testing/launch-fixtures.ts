import {
  type AccountRef,
  accountRefSchema,
  type LaunchPinRequest,
  type TxSimulator,
} from "@binference/plugin-sdk";
import { curveChainSetupsOf } from "@binference/plugin-sdk/evm";
import { createSeededRandom } from "@binference/plugin-sdk/testing";
import { getAddress, parseEther } from "viem";
import { type LaunchParts, launchPartsOf } from "../launch/launch-parts.js";
import { type FlapApiFake, flapApiFake } from "./flap-api-fake.js";
import {
  bnb,
  bscChain,
  portalContracts,
  recordedWallet,
  scriptedPortal,
  usd1,
  usdt,
} from "./portal-fixtures.js";

const implementation = getAddress("0x024f18294970B5c76c0691b87f138A0317156422");

// Flap's Tax Token V3 implementation on BSC, as the registry lists it.
const taxImplementation: AccountRef = accountRefSchema.parse(`${bscChain}:${implementation}`);

// A simulator for tests that run nothing on it.
const noRuns: Pick<TxSimulator, "simulate"> = {
  simulate: async () => Promise.reject(new Error("This test runs nothing.")),
};

/** The launcher's parts on BSC over a fake of Flap's API and a simulator. */
export function launchPartsOver(
  http: FlapApiFake = flapApiFake(),
  simulator: Pick<TxSimulator, "simulate"> = noRuns,
): LaunchParts {
  const setups = curveChainSetupsOf(
    [{ chain: bscChain, nativeAsset: bnb, quoteTokens: [usdt, usd1], rpc: scriptedPortal() }],
    { id: "flap", name: "Flap" },
  );
  const random = createSeededRandom(271);
  const chains = [{ chain: bscChain, simulator, taxTokenImplementation: taxImplementation }];
  return launchPartsOf({ http, random, chains }, setups);
}

/** The tax recipient of {@link testLaunch}. */
export const testOwner: AccountRef = accountRefSchema.parse(
  `${bscChain}:0x00000000000000000000000000000000000000AA`,
);

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** A launch of a tax token against BNB with a 0.1 BNB first buy, for the recorded wallet. */
export const testLaunch: LaunchPinRequest = {
  wallet: recordedWallet,
  name: "Moon Cat",
  symbol: "MCAT",
  pair: bnb,
  firstBuy: { asset: bnb, base: parseEther("0.1") },
  options: {
    buyTaxBps: 300,
    sellTaxBps: 500,
    taxRecipient: testOwner,
    burnShareBps: 0,
    taxDays: 365,
  },
  contracts: portalContracts,
  description: "A cat on the moon",
  links: { website: "https://moon.example", x: "https://x.com/mooncat" },
  image: { contentType: "image/png", bytes: png },
};
