import type { JsonValue } from "@binference/core";
import { z } from "zod";
import { type ChainRef, chainRefSchema } from "../caip/chain-ref.js";
import { kebabCaseSchema } from "../registry/chain-definition.js";
import type {
  CurveReader,
  InsiderReader,
  Launcher,
  LaunchReader,
  PriceReader,
  Quoter,
  TxBuilder,
  TxDecoder,
} from "./ports.js";

/** A function a venue's transactions call on one of its contracts. */
export interface VenueCall {
  /** The contract's name, one of the chain's `names` or `launchContracts`. */
  readonly contract: string;
  /** The function as its chain family describes it: for an EVM venue, its JSON ABI entry. */
  readonly abi: JsonValue;
  /** The function's inputs that must name the wallet that signs, such as a swap's receiver. */
  readonly walletInputs: readonly string[];
  /**
   * Only a launch wallet makes this call, such as a launchpad's create call on a registry
   * contract: only a launch wallet's ceiling allows it, and the signer refuses it from any other
   * wallet (decision 0271). A call on a launch's own contracts is a launch wallet's already.
   */
  readonly isLaunchWalletOnly?: boolean;
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
  /**
   * The names among `names` and `launchContracts` a token approval may name as its spender; left
   * out, none.
   */
  readonly spenders?: readonly string[];
  /**
   * The names among `names` a launch wallet's token approval alone may name as its spender, such
   * as a launchpad's router that pulls a token first buy: only a launch wallet's ceiling allows
   * them, as it alone allows a call marked `isLaunchWalletOnly`. Each differs from `spenders`; left
   * out, none.
   */
  readonly launchWalletSpenders?: readonly string[];
  /**
   * The contracts each launch of the venue has of its own on this chain, by name, such as a
   * launchpad's curve for each token, which no registry can list. The launchpad's curve read
   * names their addresses for a token it holds (`CurveHolding.launch`), found through its own
   * registry contracts; the host lets that token's trades and price reads call them, and nothing
   * else. Each name differs from every one of `names`. Left out, none.
   */
  readonly launchContracts?: readonly string[];
  /**
   * The venue's trade calls on this chain carry no deadline, as a launchpad's curve call may not.
   * The host then accepts a decoded effect without one; its minimum out still binds it. Left out,
   * every trade call must carry a deadline.
   */
  readonly noDeadline?: boolean;
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
  readonly isLaunchWalletOnly?: boolean;
}

/** A {@link VenueDeclaration} as a plugin's manifest writes it. */
export interface VenueDeclarationWire {
  readonly id: string;
  readonly contracts: readonly {
    readonly chain: string;
    readonly names: readonly string[];
    readonly calls?: readonly VenueCallWire[];
    readonly spenders?: readonly string[];
    readonly launchWalletSpenders?: readonly string[];
    readonly launchContracts?: readonly string[];
    readonly noDeadline?: boolean;
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
  isLaunchWalletOnly: z.literal(true).exactOptional(),
});

// Every call and every spender names one of the chain's declared contracts, registry or launch,
// a launch wallet's spender a registry one, and a spender once; a launch's contract shares no name
// with a registry one.
function namesDeclared(item: Omit<VenueContracts, "chain">): boolean {
  const launch = item.launchContracts ?? [];
  const named = (name: string) => item.names.includes(name) || launch.includes(name);
  const spenders = item.spenders ?? [];
  const launchSpenders = item.launchWalletSpenders ?? [];
  const calls = item.calls ?? [];
  const isApart = launch.every((name) => !item.names.includes(name));
  return (
    isApart &&
    isUnique([...spenders, ...launchSpenders]) &&
    spenders.every(named) &&
    launchSpenders.every((name) => item.names.includes(name)) &&
    calls.every((call) => named(call.contract))
  );
}

/**
 * Checks a venue's declaration: a kebab-case id of at most 32 characters, at least one chain, each
 * chain once, and at least one contract name on each, each name once. A launch's contracts have
 * names of their own, each once. A call or a spender names one of the chain's contracts, registry
 * or launch, each spender once.
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
          launchWalletSpenders: z.array(kebabCaseSchema).exactOptional(),
          launchContracts: z
            .array(kebabCaseSchema)
            .min(1)
            .refine(isUnique, { message: "A launch's contract name repeats." })
            .exactOptional(),
          noDeadline: z.boolean().exactOptional(),
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
 * its curve, so the engine sends a token still on it there and nowhere else. A venue that holds
 * the state a token's price comes from, such as a launchpad's curve, declares the reads that price
 * it, which the price watcher asks every block. A launchpad whose contracts favor some wallets on
 * a token it launched names them, for the risk step. A launchpad that launches tokens for the
 * agent holds its `launcher`, and one whose launches the launch feed records declares its
 * `launchEvents` and reads them.
 */
export interface Venue
  extends
    VenueDeclaration,
    Quoter,
    TxBuilder,
    TxDecoder,
    Partial<CurveReader>,
    Partial<PriceReader>,
    Partial<InsiderReader>,
    Partial<LaunchReader> {
  readonly launcher?: Launcher;
}

/** A launchpad: a venue that trades the tokens on its bonding curve, and says which those are. */
export interface LaunchpadVenue extends Omit<Venue, "curve">, CurveReader {}
