import { parseJsonText } from "@binference/plugin-sdk/data";
import type { Address, Hex } from "viem";
import { z } from "zod";
import { addressTextSchema, unsignedTextSchema } from "../wire-values.schema.js";

/** One part of what Across keeps of the input, in a token of the source chain. */
interface AcrossFee {
  readonly amount: bigint;
  readonly token: Address;
}

/** A token as Across's answer names it: its address, its chain's id and its decimals. */
interface AcrossToken {
  readonly address: Address;
  readonly chainId: bigint;
  readonly decimals: number;
}

/**
 * Across's Swap API answer for a direct bridge, read into the bridge's own terms: the tokens, the
 * amounts, the fill time, the expiry, the call it encoded and the bridge step's fees. An answer
 * with a swap on either chain, or another trade type, never reads.
 */
export interface AcrossSwap {
  readonly inputToken: AcrossToken;
  readonly outputToken: AcrossToken;
  readonly inputAmount: bigint;
  readonly expectedOutputAmount: bigint;
  /** The least Across says the fill pays, which a direct bridge holds equal to the expected. */
  readonly minOutputAmount: bigint;
  /** Seconds Across expects the fill to take. */
  readonly expectedFillTime: number;
  /** Unix seconds after which Across's quote no longer holds. */
  readonly quoteExpiryTimestamp: number;
  readonly swapTx: { readonly chainId: bigint; readonly to: Address; readonly data: Hex };
  readonly fees: {
    readonly lp: AcrossFee;
    readonly relayerCapital: AcrossFee;
    readonly destinationGas: AcrossFee;
  };
}

const unsigned = unsignedTextSchema;
const address = addressTextSchema;
// Numbers come as the text the answer wrote (`parseJsonText`), so none passes through a float.
const chainId = z
  .string()
  .regex(/^[1-9]\d{0,30}$/)
  .transform((text) => BigInt(text));
const seconds = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,15})$/)
  .pipe(z.coerce.number<string>());
const decimals = z
  .string()
  .regex(/^(?:0|[1-9]\d?)$/)
  .pipe(z.coerce.number<string>().max(36));
const token = z.looseObject({ address, chainId, decimals });
const fee = z.looseObject({ amount: unsigned, token: z.looseObject({ address }) });

const answerSchema = z.looseObject({
  crossSwapType: z.literal("bridgeableToBridgeable"),
  amountType: z.literal("exactInput"),
  inputToken: token,
  outputToken: token,
  inputAmount: unsigned,
  expectedOutputAmount: unsigned,
  minOutputAmount: unsigned,
  expectedFillTime: seconds,
  quoteExpiryTimestamp: seconds,
  // A direct bridge has one step; an origin or destination swap makes this refuse.
  steps: z.strictObject({
    bridge: z.looseObject({
      fees: z.looseObject({
        details: z.looseObject({ lp: fee, relayerCapital: fee, destinationGas: fee }),
      }),
    }),
  }),
  swapTx: z.looseObject({
    ecosystem: z.literal("evm").optional(),
    chainId,
    to: address,
    data: z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/),
  }),
});

// Calldata as viem types it, lowercase; the schema checked it is hex.
function hexOf(text: string): Hex {
  return `0x${text.slice(2).toLowerCase()}`;
}

function tokenOf(part: z.output<typeof token>): AcrossToken {
  return { address: part.address, chainId: part.chainId, decimals: part.decimals };
}

function feeOf(part: z.output<typeof fee>): AcrossFee {
  return { amount: part.amount, token: part.token.address };
}

/**
 * Reads a Swap API answer for a direct bridge, or `undefined` when it breaks the schema: another
 * trade type, a swap on either side, a missing fee or an address that is not one.
 */
export function readSwapAnswer(body: string): AcrossSwap | undefined {
  const parsed = answerSchema.safeParse(parseJsonText(body));
  if (!parsed.success) {
    return undefined;
  }
  const answer = parsed.data;
  const { lp, relayerCapital, destinationGas } = answer.steps.bridge.fees.details;
  return {
    inputToken: tokenOf(answer.inputToken),
    outputToken: tokenOf(answer.outputToken),
    inputAmount: answer.inputAmount,
    expectedOutputAmount: answer.expectedOutputAmount,
    minOutputAmount: answer.minOutputAmount,
    expectedFillTime: answer.expectedFillTime,
    quoteExpiryTimestamp: answer.quoteExpiryTimestamp,
    swapTx: {
      chainId: answer.swapTx.chainId,
      to: answer.swapTx.to,
      data: hexOf(answer.swapTx.data),
    },
    fees: {
      lp: feeOf(lp),
      relayerCapital: feeOf(relayerCapital),
      destinationGas: feeOf(destinationGas),
    },
  };
}

const indirectSchema = z.looseObject({
  crossSwapType: z.string().refine((type) => type !== "bridgeableToBridgeable"),
});

/**
 * Whether Across answered with a swap on either side instead of a direct bridge, as it does for a
 * listed route whose direct bridge it has no liquidity for (seen for every ETH route from BSC on
 * 2026-11-01 at about 12:10 UTC).
 */
export function isIndirectSwap(body: string): boolean {
  return indirectSchema.safeParse(parseJsonText(body)).success;
}
