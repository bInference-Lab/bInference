import { decimalStringSchema } from "@binference/plugin-sdk";
import { type Address, type Hex, isHex } from "viem";
import { z } from "zod";
import { okxAddressSchema, type OkxRoute, routeAnswerSchema } from "./route-answer.schema.js";

/** A swap OKX's API encoded for a wallet: the route and the router call. */
export interface OkxSwap {
  readonly route: OkxRoute;
  /** The account OKX encoded the call for; absent when the answer leaves it out. */
  readonly from?: Address;
  /** The contract the call goes to: OKX's DEX router. */
  readonly to: Address;
  /** The native coin the call sends, in wei. */
  readonly value: bigint;
  readonly data: Hex;
}

// Calldata in lowercase: whole bytes, at least the four of a function selector.
const calldataSchema: z.ZodType<Hex, string> = z.string().transform((text, context) => {
  const lower = text.toLowerCase();
  if (/^0x(?:[0-9a-f]{2}){4,}$/.test(lower) && isHex(lower)) {
    return lower;
  }
  context.addIssue({ code: "custom", message: "Expected calldata." });
  return z.NEVER;
});

const swapSchema: z.ZodType<OkxSwap> = z
  .looseObject({
    routerResult: routeAnswerSchema,
    tx: z.looseObject({
      from: okxAddressSchema.optional(),
      to: okxAddressSchema,
      value: decimalStringSchema,
      data: calldataSchema,
    }),
  })
  .transform(({ routerResult, tx }) => ({
    route: routerResult,
    ...(tx.from === undefined ? {} : { from: tx.from }),
    to: tx.to,
    value: tx.value,
    data: tx.data,
  }));

/** Reads the first swap of a successful `/swap` answer's data; anything else is undefined. */
export function readSwapData(data: unknown): OkxSwap | undefined {
  const swaps = z.array(swapSchema).min(1).safeParse(data);
  return swaps.success ? swaps.data[0] : undefined;
}
