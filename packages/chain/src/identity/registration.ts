import { z } from "zod";
import { type AccountRef, accountRefSchema } from "../caip/account-ref.js";

/**
 * What an agent's registration file says of it, the fields its card shows (decision 0334): the
 * agent's name, the owner's description, empty when the owner gave none, the one wallet it lists,
 * the wallet that registers it, and binference's release version.
 */
export interface RegistrationCard {
  readonly name: string;
  readonly description: string;
  readonly wallet: AccountRef;
  readonly version: string;
}

/** What an identity registry answers about a wallet at the latest block. */
export interface IdentityStanding {
  /** The version the registry's contract reports of itself, such as `2.0.0`. */
  readonly version: string;
  /** How many identity tokens of the registry the wallet holds. */
  readonly held: bigint;
  /**
   * The contract an upgradeable registry's proxy runs now, from its own storage; absent for a
   * registry that cannot be upgraded.
   */
  readonly implementation?: AccountRef;
}

/** A registration call read back from its bytes: the registration file it registers. */
export interface DecodedRegistration {
  readonly file: string;
}

/** What a landed registration made, read back from its transaction and the registry now. */
export interface LandedRegistration {
  /** The id the registry gave the identity, in decimal. */
  readonly onchainId: string;
  /** Who holds the identity token now. */
  readonly owner: AccountRef;
  /** The registration file the registry holds for the identity now. */
  readonly file: string;
}

/** A {@link LandedRegistration} as JSON carries it. */
export interface LandedRegistrationWire {
  readonly onchainId: string;
  readonly owner: string;
  readonly file: string;
}

/** The most characters a registration file may hold, as binference writes one or reads it back. */
export const registrationFileMaxLength = 16_384;

/** A registration file: a data URI of at most {@link registrationFileMaxLength} characters. */
export const registrationFileSchema: z.ZodType<string, string> = z
  .string()
  .max(registrationFileMaxLength)
  .startsWith("data:");

/** A registry's version: 1 to 32 printable characters. */
const versionSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[\x21-\x7e]+$/);

/**
 * Decodes what a registry answered about a wallet: a version of 1 to 32 printable characters, a
 * count of identity tokens never negative, and the contract its proxy runs, when it has one.
 */
export const identityStandingSchema: z.ZodType<IdentityStanding> = z.strictObject({
  version: versionSchema,
  held: z.bigint().nonnegative(),
  implementation: accountRefSchema.exactOptional(),
});

/**
 * Decodes what a registry read back of a landed registration, and encodes it back with
 * `z.encode`: the id in decimal, the holder as a CAIP account and the file as a data URI. Whether
 * it fits the registration the card showed is the engine's check, not this shape's.
 */
export const landedRegistrationSchema: z.ZodType<LandedRegistration, LandedRegistrationWire> =
  z.strictObject({
    onchainId: z.string().regex(/^(?:0|[1-9]\d{0,77})$/),
    owner: accountRefSchema,
    file: registrationFileSchema,
  });
