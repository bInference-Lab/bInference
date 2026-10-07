import type { Address, Hex } from "viem";
import { z } from "zod";
import { addressSchema, baseUnitsSchema } from "./answer-fields.schema.js";
import { parseJsonText } from "./json-text.schema.js";

/** The call KyberSwap's API encoded for a route, read from its build answer. */
export interface BuiltRoute {
  /** The router the call goes to. */
  readonly routerAddress: Address;
  /** The router call's calldata, in lower case. */
  readonly data: Hex;
  /** The native coin the call sends, in base units. */
  readonly transactionValue: bigint;
}

const buildAnswerSchema = z.looseObject({
  code: z.literal(0),
  data: z.looseObject({
    routerAddress: addressSchema,
    data: z
      .string()
      .regex(/^0x(?:[0-9a-fA-F]{2})+$/)
      .transform((text): Hex => `0x${text.slice(2).toLowerCase()}`),
    transactionValue: baseUnitsSchema,
  }),
});

/** Reads a build answer of KyberSwap's API into its router call; any other answer is undefined. */
export function readBuildAnswer(body: string): BuiltRoute | undefined {
  const answer = buildAnswerSchema.safeParse(parseJsonText(body));
  if (!answer.success) {
    return undefined;
  }
  const { routerAddress, data, transactionValue } = answer.data.data;
  return { routerAddress, data, transactionValue };
}
