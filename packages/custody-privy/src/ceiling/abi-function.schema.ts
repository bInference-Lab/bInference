import { z } from "zod";
import type { AbiFunction, AbiParameter } from "./policy-rule.js";

const parameterSchema: z.ZodType<AbiParameter> = z.lazy(() =>
  z.object({
    name: z.string().default(""),
    type: z.string().min(1),
    components: z.array(parameterSchema).exactOptional(),
  }),
);

/**
 * Parses one function of a contract's JSON ABI, as a venue declares it or Privy echoes it: its
 * name, its named, typed inputs and outputs with their tuple parts, and its state mutability.
 * Other fields, such as `internalType`, are left out.
 */
export const abiFunctionSchema: z.ZodType<AbiFunction> = z.object({
  type: z.literal("function"),
  name: z.string().regex(/^[A-Za-z_$][\w$]*$/),
  inputs: z.array(parameterSchema).default([]),
  outputs: z.array(parameterSchema).default([]),
  stateMutability: z.enum(["pure", "view", "nonpayable", "payable"]).default("nonpayable"),
});
