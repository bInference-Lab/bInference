import {
  type AccountRef,
  accountRefSchema,
  assetRefSchema,
  type LaunchPinRequest,
  type SimulatedStep,
  type TxSimulator,
} from "@binference/plugin-sdk";
import { curveChainSetupsOf, decodeEvmDraft } from "@binference/plugin-sdk/evm";
import { createSeededRandom } from "@binference/plugin-sdk/testing";
import { getAddress, parseEther } from "viem";
import { type LaunchParts, launchPartsOf } from "../launch/launch-parts.js";
import { tokenAddressOf } from "../launch/vanity-salt.js";
import { newTokenArgsOf } from "../portal/launch-call.js";
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

/**
 * What a 0.1 BNB first buy of a token with a 3% buy tax got in a dry run of `newTokenV6` on BSC
 * on 2026-10-20: about 17.04 million tokens, after the 1% curve fee and the tax.
 */
export const recordedFirstBuyOut = 17_042_259_171_263_630_532_392_559n;

/**
 * A simulator that runs a Flap launch's steps as the Portal does in the recorded dry run: every
 * step succeeds, and the create call pays its caller `out` of the token its salt makes.
 */
export function dryRunSimulator(
  out: bigint = recordedFirstBuyOut,
): Pick<TxSimulator, "simulate"> & { readonly runs: () => number } {
  const counted = { runs: 0 };
  return {
    async simulate(drafts, { signal }) {
      signal.throwIfAborted();
      counted.runs += 1;
      return await Promise.resolve(
        drafts.map((draft): SimulatedStep => {
          const call = decodeEvmDraft(draft);
          const args = call.ok ? newTokenArgsOf(call.value.data) : undefined;
          if (!call.ok || args === undefined) {
            return { status: "success", gasUsed: 46_000n, transfers: [], approvals: [] };
          }
          const maker = { portal: call.value.to, implementation };
          const token = tokenAddressOf(maker, args.salt);
          const transfers =
            args.quoteAmt === 0n
              ? []
              : [
                  {
                    from: accountRefSchema.parse(`${bscChain}:${call.value.to}`),
                    to: draft.from,
                    amount: {
                      asset: assetRefSchema.parse(`${bscChain}/erc20:${token}`),
                      base: out,
                    },
                  },
                ];
          return { status: "success", gasUsed: 5_563_061n, transfers, approvals: [] };
        }),
      );
    },
    runs: () => counted.runs,
  };
}

/** The launcher's parts on BSC over a fake of Flap's API and a dry-run simulator. */
export function launchPartsOver(
  http: FlapApiFake = flapApiFake(),
  simulator: Pick<TxSimulator, "simulate"> = dryRunSimulator(),
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
