import { type Address, getAddress } from "viem";
import { z } from "zod";

/** An unsigned integer written in decimal, up to a uint256's 78 digits, read as a bigint. */
export const unsignedTextSchema: z.ZodType<bigint, string> = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,77})$/)
  .transform((text) => BigInt(text));

/** A 20-byte address written in hex, in any case, read in its checksum form. */
export const addressTextSchema: z.ZodType<Address, string> = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((text) => getAddress(text));
