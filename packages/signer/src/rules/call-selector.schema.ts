import { createHash } from "node:crypto";
import type { JsonValue } from "@binference/core";
import { z } from "zod";

/** One input of a JSON ABI function: its type, and its parts when it is a tuple. */
interface AbiInput {
  readonly type: string;
  readonly components?: readonly AbiInput[];
}

const abiInputSchema: z.ZodType<AbiInput> = z.lazy(() =>
  z.object({
    type: z.string().regex(/^[a-z0-9]+(\[\d*\])*$/),
    components: z.array(abiInputSchema).exactOptional(),
  }),
);

const abiFunctionSchema = z.object({
  type: z.literal("function"),
  name: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/),
  inputs: z.array(abiInputSchema),
});

// A tuple is written as its parts' types in parentheses, its array suffix kept.
function canonicalType(input: AbiInput): string {
  if (!input.type.startsWith("tuple")) {
    return input.type;
  }
  const parts = (input.components ?? []).map(canonicalType).join(",");
  return `(${parts})${input.type.slice("tuple".length)}`;
}

/**
 * The 4-byte selector of a JSON ABI function, as lowercase hex without `0x`: the first 4 bytes of
 * the Keccak-256 of its canonical signature, a tuple written as its parts' types. An entry that is
 * no function, or a Node without Keccak-256, gives `undefined`, which the rule reads as a call it
 * must refuse.
 */
export function callSelectorOf(abi: JsonValue): string | undefined {
  const parsed = abiFunctionSchema.safeParse(abi);
  if (!parsed.success) {
    return undefined;
  }
  const { name, inputs } = parsed.data;
  const signature = `${name}(${inputs.map(canonicalType).join(",")})`;
  try {
    return createHash("keccak-256").update(signature).digest("hex").slice(0, 8);
  } catch {
    return undefined;
  }
}
