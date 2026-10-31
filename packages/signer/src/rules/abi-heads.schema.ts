import type { JsonValue } from "@binference/core";
import { z } from "zod";

const wordChars = 64;
const selectorChars = 8;
const elementary = /^(?:address|bool|bytes(?:[1-9]|[12]\d|3[0-2])|u?int\d{0,3})$/;
const fixedArray = /^(.+)\[(\d{1,3})\]$/;

/** One input of a JSON ABI function, its parts when it is a tuple. */
interface AbiInput {
  readonly name: string;
  readonly type: string;
  readonly components?: readonly AbiInput[];
}

const abiInputSchema: z.ZodType<AbiInput> = z.lazy(() =>
  z.object({
    name: z.string(),
    type: z.string(),
    components: z.array(abiInputSchema).exactOptional(),
  }),
);
const namedInputsSchema = z.object({ inputs: z.array(abiInputSchema) });

/** A call's top-level inputs read from its calldata: each one's head word and type, by name. */
export interface CallHeads {
  readonly words: ReadonlyMap<string, string>;
  readonly types: ReadonlyMap<string, string>;
  /** The calldata after the selector, lowercase hex without `0x`. */
  readonly body: string;
}

function isDynamic(input: AbiInput): boolean {
  const { type, components } = input;
  if (type === "bytes" || type === "string" || type.endsWith("[]")) {
    return true;
  }
  const fixed = fixedArray.exec(type);
  if (fixed !== null) {
    return isDynamic({ ...input, type: fixed[1] ?? "" });
  }
  return type === "tuple" && (components ?? []).some(isDynamic);
}

// The words a static input takes inline: one for an elementary type, its parts' for a tuple, its
// length times its element's for a fixed array. Undefined for a type this cannot size.
function staticWords(input: AbiInput): bigint | undefined {
  const { type, components } = input;
  if (elementary.test(type)) {
    return 1n;
  }
  const fixed = fixedArray.exec(type);
  if (fixed !== null) {
    const element = staticWords({ ...input, type: fixed[1] ?? "" });
    return element === undefined ? undefined : element * BigInt(fixed[2] ?? "0");
  }
  if (type !== "tuple" || components === undefined) {
    return undefined;
  }
  const parts = components.map(staticWords);
  return parts.every((part) => part !== undefined)
    ? parts.reduce<bigint>((sum, part) => sum + part, 0n)
    : undefined;
}

// How many head words an input takes: a dynamic one takes one, its offset.
function headWords(input: AbiInput): bigint | undefined {
  return isDynamic(input) ? 1n : staticWords(input);
}

/** The word at a byte offset of a call's body, walked one word at a time; none past its end. */
export function wordAt(body: string, offset: bigint): string | undefined {
  let position = 0n;
  for (let at = 0; at + wordChars <= body.length; at += wordChars) {
    if (position === offset) {
      return body.slice(at, at + wordChars);
    }
    position += 32n;
  }
  return undefined;
}

/**
 * Reads the head word of each top-level input of a call to the JSON ABI function given, each
 * placed after the heads before it, as the ABI encodes them. An ABI that is no function's, a type
 * this cannot size, or calldata too short for the heads gives undefined.
 */
export function readHeads(abi: JsonValue, data: string): CallHeads | undefined {
  const parsed = namedInputsSchema.safeParse(abi);
  if (!parsed.success) {
    return undefined;
  }
  const body = data.slice(2 + selectorChars);
  const words = new Map<string, string>();
  const types = new Map<string, string>();
  let position = 0n;
  for (const input of parsed.data.inputs) {
    const size = headWords(input);
    const word = size === undefined ? undefined : wordAt(body, position * 32n);
    if (size === undefined || word === undefined) {
      return undefined;
    }
    words.set(input.name, word);
    types.set(input.name, input.type);
    position += size;
  }
  return { words, types, body };
}
