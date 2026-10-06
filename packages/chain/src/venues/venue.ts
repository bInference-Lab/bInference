import { z } from "zod";
import { type ChainRef, chainRefSchema } from "../caip/chain-ref.js";
import { kebabCaseSchema } from "../registry/chain-definition.js";
import type { Quoter, TxBuilder, TxDecoder } from "./ports.js";

/** The contracts a venue touches on one chain, by their names in that chain's registry entry. */
export interface VenueContracts {
  readonly chain: ChainRef;
  /** Contract names the chain registry lists for this venue, such as `router`. */
  readonly names: readonly string[];
}

/** What a venue declares about itself: its id and the contracts it touches on each chain. */
export interface VenueDeclaration {
  /** The venue's id, which the chain registry names its contracts after. */
  readonly id: string;
  readonly contracts: readonly VenueContracts[];
}

/** A {@link VenueDeclaration} as a plugin's manifest writes it. */
export interface VenueDeclarationWire {
  readonly id: string;
  readonly contracts: readonly { readonly chain: string; readonly names: readonly string[] }[];
}

function isUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

/**
 * Checks a venue's declaration: a kebab-case id of at most 32 characters, at least one chain, each
 * chain once, and at least one contract name on each, each name once.
 */
export const venueDeclarationSchema: z.ZodType<VenueDeclaration, VenueDeclarationWire> = z.object({
  id: kebabCaseSchema.max(32),
  contracts: z
    .array(
      z.strictObject({
        chain: chainRefSchema,
        names: z.array(kebabCaseSchema).min(1).refine(isUnique, { message: "A name repeats." }),
      }),
    )
    .min(1)
    .refine((items: readonly VenueContracts[]) => isUnique(items.map((item) => item.chain)), {
      message: "A chain repeats.",
    }),
});

/**
 * A venue: a protocol the agent trades on, such as a DEX router. It declares the contracts it
 * touches, quotes, builds the transactions of a trade, and decodes them. Only reviewed venues run
 * in the engine, and the venue host checks every transaction they build.
 */
export interface Venue extends VenueDeclaration, Quoter, TxBuilder, TxDecoder {}
