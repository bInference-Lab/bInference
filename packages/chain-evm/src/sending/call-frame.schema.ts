import type { Address } from "viem";
import { z } from "zod";
import { addressSchema, quantitySchema } from "../rpc/evm-wire.schema.js";

/**
 * One call of a transaction as `debug_traceTransaction` with the `callTracer` answers it: where
 * it went, the native coin it carried, the error that undid it, and the calls it made.
 */
export interface CallFrame {
  readonly to?: Address;
  readonly value?: bigint;
  readonly error?: string;
  readonly calls?: readonly CallFrame[];
}

/** Checks a `callTracer` frame and the frames under it. */
export const callFrameSchema: z.ZodType<CallFrame> = z.lazy(() =>
  z.looseObject({
    to: addressSchema.exactOptional(),
    value: quantitySchema.exactOptional(),
    error: z.string().exactOptional(),
    calls: z.array(callFrameSchema).exactOptional(),
  }),
);
