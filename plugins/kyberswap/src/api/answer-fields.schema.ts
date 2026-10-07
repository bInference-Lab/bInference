import { type Address, getAddress } from "viem";
import { z } from "zod";

/** Base units as KyberSwap's API writes them: a decimal string of an unsigned integer. */
export const baseUnitsSchema: z.ZodType<bigint, string> = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,77})$/)
  .transform((text) => BigInt(text));

/** An EVM address in any letter case, read into its checksum form. */
export const addressSchema: z.ZodType<Address, string> = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((text) => getAddress(text.toLowerCase()));
