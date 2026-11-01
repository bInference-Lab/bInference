import { parseEvmAddress } from "@binference/plugin-sdk/evm";
import type { Address, Hex } from "viem";
import { z } from "zod";

/** Hex in lowercase, as the bridge compares and records ids and calldata. */
export function lowerHex(text: string): Hex {
  return `0x${text.slice(2).toLowerCase()}`;
}

/**
 * An EVM address as Relay writes it, lowercase or checksummed, read in its checksum form; a
 * mixed-case address whose checksum fails is refused.
 */
export const evmAddressTextSchema: z.ZodType<Address, string> = z
  .string()
  .transform((text, context) => {
    const parsed = parseEvmAddress(text);
    if (!parsed.ok) {
      context.addIssue({ code: "custom", message: "Expected an EVM address." });
      return z.NEVER;
    }
    return parsed.value;
  });

/** Bytes written as hex, an even count of digits after `0x`, read in lowercase. */
export const bytesTextSchema: z.ZodType<Hex, string> = z
  .string()
  .regex(/^0x(?:[0-9a-fA-F]{2})*$/)
  .transform((text) => lowerHex(text));

/** 32 bytes written as hex, such as an order id, a request id or an EVM transaction hash. */
export const word32TextSchema: z.ZodType<Hex, string> = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((text) => lowerHex(text));
