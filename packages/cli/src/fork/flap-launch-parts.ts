import { randomBytes } from "node:crypto";
import type { Venue } from "@binference/chain";
import { createEvmTxSimulator, erc20AssetRef, evmAccountRef } from "@binference/chain-evm";
import { bscContract, bscToken, type Fork } from "@binference/chain-evm/fork";
import { createFlapVenue } from "@binference/flap";
import type { FlapApiFake } from "@binference/flap/testing";
import { createSystemRandom } from "../runtime/system-random.js";

/** The smallest PNG: its signature and a 1x1 image, as the owner's picture of a fork launch. */
export const onePixelPng: Uint8Array = Uint8Array.from(
  Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
      "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
    "hex",
  ),
);

/** A raw CIDv1 no launch used: every Flap token's metadata is its own. */
export function freshCid(): string {
  const letters = "abcdefghijklmnopqrstuvwxyz234567";
  return `bafkrei${[...randomBytes(52)].map((byte) => letters[byte % 32]).join("")}`;
}

/**
 * Flap on the fork, against BNB and the registry's USDT and USD1, launching through a fake of
 * Flap's API that answers as the recorded one did; the API itself is never reached.
 */
export function flapOn(fork: Fork, api: FlapApiFake): Venue {
  const { ref: chain, nativeAsset } = fork.chain;
  const quoteTokens = [bscToken("USDT"), bscToken("USD1")].map((token) =>
    erc20AssetRef(fork.chain, token),
  );
  const implementation = bscContract("flap", "tax-token-v3-implementation");
  return createFlapVenue({
    chains: [{ chain, nativeAsset, quoteTokens, rpc: fork.rpc }],
    launches: {
      http: api,
      random: createSystemRandom(),
      chains: [
        {
          chain,
          simulator: createEvmTxSimulator({ rpc: fork.rpc, chain: fork.chain }),
          taxTokenImplementation: evmAccountRef(fork.chain, implementation),
        },
      ],
    },
  });
}
