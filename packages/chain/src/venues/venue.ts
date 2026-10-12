import type { JsonValue } from "@binference/core";
import { z } from "zod";
import { type ChainRef, chainRefSchema } from "../caip/chain-ref.js";
import { kebabCaseSchema } from "../registry/chain-definition.js";
import type { CurveReader, Quoter, TxBuilder, TxDecoder } from "./ports.js";

/** A function a venue's transactions call on one of its contracts. */
export interface VenueCall {
  /** The contract's name, one of the chain's `names`. */
  readonly contract: string;
  /** The function as its chain family describes it: for an EVM venue, its JSON ABI entry. */
  readonly abi: JsonValue;
  /** The function's inputs that must name the wallet that signs, such as a swap's receiver. */
  readonly walletInputs: readonly string[];
}

/** The contracts a venue touches on one chain, by their names in that chain's registry entry. */
export interface VenueContracts {
  readonly chain: ChainRef;
  /** Contract names the chain registry lists for this venue, such as `router`. */
  readonly names: readonly string[];
  /**
   * The functions the venue's transactions call on this chain. A wallet's ceiling lets it call
   * these and no other function of the venue; left out, none.
   */
  readonly calls?: readonly VenueCall[];
  /** The names among `names` a token approval may name as its spender; left out, none. */
  readonly spenders?: readonly string[];
}

/** What a venue declares about itself: its id and the contracts it touches on each chain. */
export interface VenueDeclaration {
  /** The venue's id, which the chain registry names its contracts after. */
  readonly id: string;
  readonly contracts: readonly VenueContracts[];
}

/** A {@link VenueCall} as a plugin's manifest writes it. */
interface VenueCallWire {
  readonly contract: string;
  readonly abi: JsonValue;
  readonly walletInputs?: readonly string[] | undefined;
}

/** A {@link VenueDeclaration} as a plugin's manifest writes it. */
export interface VenueDeclarationWire {
  readonly id: string;
  readonly contracts: readonly {
    readonly chain: string;
    readonly names: readonly string[];
    readonly calls?: readonly VenueCallWire[];
    readonly spenders?: readonly string[];
  }[];
}

function isUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

const callSchema: z.ZodType<VenueCall, VenueCallWire> = z.strictObject({
  contract: kebabCaseSchema,
  abi: z.json(),
  walletInputs: z
    .array(z.string().min(1))
    .refine(isUnique, { message: "An input repeats." })
    .default([]),
});

// Every call and every spender names one of the chain's declared contracts, and a spender once.
function namesDeclared(item: Omit<VenueContracts, "chain">): boolean {
  const named = (name: string) => item.names.includes(name);
  const spenders = item.spenders ?? [];
  const calls = item.calls ?? [];
  return isUnique(spenders) && spenders.every(named) && calls.every((call) => named(call.contract));
}

/**
 * Checks a venue's declaration: a kebab-case id of at most 32 characters, at least one chain, each
 * chain once, and at least one contract name on each, each name once. A call or a spender names
 * one of the chain's contracts, each spender once.
 */
export const venueDeclarationSchema: z.ZodType<VenueDeclaration, VenueDeclarationWire> = z.object({
  id: kebabCaseSchema.max(32),
  contracts: z
    .array(
      z
        .strictObject({
          chain: chainRefSchema,
          names: z.array(kebabCaseSchema).min(1).refine(isUnique, { message: "A name repeats." }),
          calls: z.array(callSchema).exactOptional(),
          spenders: z.array(kebabCaseSchema).exactOptional(),
        })
        .refine(namesDeclared, { message: "A call or a spender names no declared contract." }),
    )
    .min(1)
    .refine((items: readonly VenueContracts[]) => isUnique(items.map((item) => item.chain)), {
      message: "A chain repeats.",
    }),
});

/**
 * A venue: a protocol the agent trades on, such as a DEX router. It declares the contracts it
 * touches, quotes, builds the transactions of a trade, and decodes them. Only reviewed venues run
 * in the engine, and the venue host checks every transaction they build. A launchpad also reads
 * its curve, so the engine sends a token still on it there and nowhere else.
 */
export interface Venue
  extends VenueDeclaration, Quoter, TxBuilder, TxDecoder, Partial<CurveReader> {}

/** A launchpad: a venue that trades the tokens on its bonding curve, and says which those are. */
export interface LaunchpadVenue extends Omit<Venue, "curve">, CurveReader {}
