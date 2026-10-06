import { type Brand, err, ok, type Result } from "@binference/core";
import { z } from "zod";

/** A CAIP-2 chain id: a namespace and a reference, such as the id of a chain definition. */
export type ChainRef = Brand<string, "ChainRef">;

/** The two parts of a {@link ChainRef}. */
export interface ChainRefParts {
  /** The family's namespace: 3 to 8 of `[-a-z0-9]`. */
  readonly namespace: string;
  /** The chain within the namespace: 1 to 32 of `[-_a-zA-Z0-9]`. */
  readonly reference: string;
}

/** The CAIP-2 grammar, for the CAIP-10 and CAIP-19 patterns that start with a chain id. */
export const chainRefGrammar = "[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}";

const chainRefPattern = new RegExp(`^${chainRefGrammar}$`);

/** Whether a text is a well-formed CAIP-2 chain id. */
export function isChainRef(text: string): text is ChainRef {
  return chainRefPattern.test(text);
}

/** Parses a CAIP-2 chain id. A malformed text is an expected failure, never a throw. */
export function parseChainRef(text: string): Result<ChainRef, "malformed_chain_ref"> {
  return isChainRef(text) ? ok(text) : err("malformed_chain_ref");
}

/** Prints a chain id from its parts; parts that break the grammar are an expected failure. */
export function printChainRef(parts: ChainRefParts): Result<ChainRef, "malformed_chain_ref"> {
  return parseChainRef(`${parts.namespace}:${parts.reference}`);
}

/** Splits a chain id into its namespace and reference. */
export function chainRefParts(ref: ChainRef): ChainRefParts {
  const separator = ref.indexOf(":");
  return { namespace: ref.slice(0, separator), reference: ref.slice(separator + 1) };
}

/** Parses a CAIP-2 chain id at a boundary. */
export const chainRefSchema: z.ZodType<ChainRef, string> = z
  .string()
  .refine(isChainRef, { message: "Expected a CAIP-2 chain id." });
