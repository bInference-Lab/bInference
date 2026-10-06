import { z } from "zod";

/** How an on-chain address was checked before it entered the registry. */
export interface AddressVerification {
  /** The project's own docs, repo or API that names the address. */
  readonly source: string;
  /** The day the address was read on chain, YYYY-MM-DD. */
  readonly checkedOn: string;
  /** Whether its proxy slots and its owner were read as well. */
  readonly control: "read" | "not_read";
}

/** A token the registry knows on one chain. */
export interface TokenDefinition {
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  /** The token contract, in the family's canonical form. */
  readonly address: string;
  readonly verification: AddressVerification;
}

/** A venue's contract on one chain. Venues read contract addresses only from here. */
export interface ContractDefinition {
  /** The venue that uses it, such as a plugin's name. */
  readonly venue: string;
  /** The contract's name within the venue, in kebab-case. */
  readonly name: string;
  /** The address in the family's canonical form. */
  readonly address: string;
  readonly verification: AddressVerification;
}

/** An RPC, a private relay or a block explorer, with the page that documents it. */
export interface EndpointDefinition {
  readonly name: string;
  readonly url: string;
  readonly source: string;
}

/** The chain's own coin, as a CAIP-19 asset namespace and reference. */
export interface NativeAssetDefinition {
  readonly assetNamespace: string;
  readonly assetReference: string;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
}

/** A block is final once the chain's `finalized` tag reaches it. */
export interface FinalizedTagRule {
  readonly kind: "finalized_tag";
}

/** A block is final once this many blocks sit on top of it. */
export interface ConfirmationsRule {
  readonly kind: "confirmations";
  readonly blocks: number;
}

/** How the family decides that a block is final. */
export type FinalityRule = FinalizedTagRule | ConfirmationsRule;

/** One chain, as data: a file in the chains package writes it with `satisfies`. */
export interface ChainDefinition {
  /** The CAIP-2 chain id. */
  readonly id: string;
  /** The short registry key, in kebab-case. */
  readonly key: string;
  readonly name: string;
  /** The id of the chain family that serves it. */
  readonly family: string;
  readonly nativeAsset: NativeAssetDefinition;
  readonly blockTimeMs: number;
  readonly finality: FinalityRule;
  readonly rpcs: readonly EndpointDefinition[];
  readonly relays: readonly EndpointDefinition[];
  readonly explorers: readonly EndpointDefinition[];
  readonly tokens: readonly TokenDefinition[];
  readonly contracts: readonly ContractDefinition[];
}

const kebab = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
const httpsUrl = z.string().regex(/^https:\/\/[^\s/]+\S*$/);
const decimals = z.int().min(0).max(255);

const verificationSchema = z.strictObject({
  source: httpsUrl,
  checkedOn: z.iso.date(),
  control: z.enum(["read", "not_read"]),
});

const endpointSchema = z.strictObject({ name: kebab, url: httpsUrl, source: httpsUrl });

const tokenSchema = z.strictObject({
  symbol: z.string().min(1),
  name: z.string().min(1),
  decimals,
  address: z.string().min(1),
  verification: verificationSchema,
});

const contractSchema = z.strictObject({
  venue: kebab,
  name: kebab,
  address: z.string().min(1),
  verification: verificationSchema,
});

function isUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

/**
 * Checks a chain definition's shape: CAIP parts, https endpoints, a verification record on every
 * address, and no address or contract name twice. Addresses are checked by the chain's family.
 */
export const chainDefinitionSchema: z.ZodType<ChainDefinition, ChainDefinition> = z
  .strictObject({
    id: z.string().regex(/^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/),
    key: kebab,
    name: z.string().min(1),
    family: kebab,
    nativeAsset: z.strictObject({
      assetNamespace: z.string().regex(/^[-a-z0-9]{3,8}$/),
      assetReference: z.string().regex(/^[-.%a-zA-Z0-9]{1,128}$/),
      symbol: z.string().min(1),
      name: z.string().min(1),
      decimals,
    }),
    blockTimeMs: z.int().positive(),
    finality: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("finalized_tag") }),
      z.strictObject({ kind: z.literal("confirmations"), blocks: z.int().positive() }),
    ]),
    rpcs: z.array(endpointSchema).min(1),
    relays: z.array(endpointSchema),
    explorers: z.array(endpointSchema).min(1),
    tokens: z.array(tokenSchema),
    contracts: z.array(contractSchema),
  })
  .refine(
    (definition: ChainDefinition) => isUnique(definition.tokens.map((token) => token.address)),
    {
      message: "A token address appears twice.",
    },
  )
  .refine(
    (definition: ChainDefinition) =>
      isUnique(definition.contracts.map((item) => `${item.venue}/${item.name}`)),
    { message: "A venue names two contracts alike." },
  );
