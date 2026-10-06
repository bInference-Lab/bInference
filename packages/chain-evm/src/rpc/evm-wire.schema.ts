import { type Address, getAddress, type Hex } from "viem";
import { z } from "zod";

function isHex(text: string): text is Hex {
  return /^0x(?:[0-9a-fA-F]{2})*$/.test(text);
}

/** A JSON-RPC quantity, such as `0x38`, read as a bigint. */
export const quantitySchema: z.ZodType<bigint, string> = z
  .string()
  .regex(/^0x[0-9a-fA-F]{1,64}$/)
  .transform((text) => BigInt(text));

/** JSON-RPC data: `0x` and whole bytes. */
export const hexSchema: z.ZodType<Hex, string> = z.string().refine(isHex);

/** A 20-byte address, read into its EIP-55 checksum form. */
export const addressSchema: z.ZodType<Address, string> = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((text) => getAddress(text));
