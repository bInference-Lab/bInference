import {
  type AssetRef,
  assetRefSchema,
  type ChainRef,
  chainRefSchema,
  type SignerLock,
} from "@binference/chain";
import { decimalStringSchema, type Id, idSchema } from "@binference/core";
import { z } from "zod";

/** The most bytes a request to the signer service may hold (spec 5, section 8.3). */
export const signerServiceRequestBytes = 4_096;

/**
 * What approved the intent, by name only: the service reads the authorization itself from the
 * install's rows (decision 0421).
 */
export type ServiceAuthorization =
  | { readonly kind: "confirmation"; readonly id: Id<"cnf"> }
  | { readonly kind: "fill"; readonly source: Id<"ord"> | Id<"whr"> }
  | { readonly kind: "approvalMode" };

/** The fees of the transaction, in wei. */
type ServiceFees =
  | { readonly gasPrice: bigint }
  | { readonly maxFeePerGas: bigint; readonly maxPriorityFeePerGas: bigint };

/**
 * A worker's `POST /v1/sign` (spec 5, section 8.3): it names the step and what the worker chose
 * for its transaction, and never describes the transaction, its terms or its grant.
 */
export interface SignerServiceRequest {
  readonly version: 1;
  /** A UUIDv7 the worker picks, one per request; a repeat carries the same one. */
  readonly requestId: string;
  readonly install: Id<"ins">;
  /** The lease fence the worker holds for the install. */
  readonly fence: number;
  readonly intent: Id<"int">;
  /** The step of the intent's plan, from 0. */
  readonly step: number;
  readonly authorization: ServiceAuthorization;
  readonly nonce: number;
  readonly gasLimit: bigint;
  readonly fees: ServiceFees;
  /** Set when the transaction takes the nonce of the step's transaction signed before. */
  readonly replaces?: "speedUp" | "cancel";
}

type DecimalFees =
  | { readonly gasPrice: string }
  | { readonly maxFeePerGas: string; readonly maxPriorityFeePerGas: string };

/** A {@link SignerServiceRequest} as JSON carries it: ids as text, wei as decimal strings. */
export interface SignerServiceRequestWire extends Omit<
  SignerServiceRequest,
  "install" | "intent" | "authorization" | "gasLimit" | "fees"
> {
  readonly install: string;
  readonly intent: string;
  readonly authorization:
    | { readonly kind: "confirmation"; readonly id: string }
    | { readonly kind: "fill"; readonly source: string }
    | { readonly kind: "approvalMode" };
  readonly gasLimit: string;
  readonly fees: DecimalFees;
}

const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const countSchema = z.int().nonnegative();
const feeSchema: z.ZodType<ServiceFees, DecimalFees> = z.union([
  z.strictObject({ gasPrice: decimalStringSchema }),
  z.strictObject({
    maxFeePerGas: decimalStringSchema,
    maxPriorityFeePerGas: decimalStringSchema,
  }),
]);
const authorizationSchema: z.ZodType<
  ServiceAuthorization,
  SignerServiceRequestWire["authorization"]
> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("confirmation"), id: idSchema("cnf") }),
  z.strictObject({ kind: z.literal("fill"), source: z.union([idSchema("ord"), idSchema("whr")]) }),
  z.strictObject({ kind: z.literal("approvalMode") }),
]);

/** Decodes a {@link SignerServiceRequest} from JSON, and encodes it back with `z.encode`. */
export const signerServiceRequestSchema: z.ZodType<SignerServiceRequest, SignerServiceRequestWire> =
  z.strictObject({
    version: z.literal(1),
    requestId: z.string().regex(uuidV7Pattern),
    install: idSchema("ins"),
    fence: countSchema,
    intent: idSchema("int"),
    step: countSchema,
    authorization: authorizationSchema,
    nonce: countSchema,
    gasLimit: decimalStringSchema,
    fees: feeSchema,
    replaces: z.enum(["speedUp", "cancel"]).exactOptional(),
  });

/** Why the signer service refused to sign (spec 5, section 8.3). */
export type ServiceRefusalReason =
  | "rule_1"
  | "rule_2"
  | "rule_3"
  | "rule_4"
  | "rule_5"
  | "rule_6"
  | "malformed"
  | "unknown_wallet"
  | "intent_state"
  | "no_authorization"
  | "authorization_ended"
  | "terms_changed"
  | "nonce_held"
  | "privy_refused";

/** What the service is short of while it answers `down`. */
export type ServiceDownReason = "store" | "kms" | "privy";

/** The sum a step would pass, as the service counts it (spec 5, section 8.4). */
export interface ServiceSums {
  readonly chain: ChainRef;
  readonly asset: AssetRef;
  readonly capBase: bigint;
  readonly usedBase: bigint;
  readonly askedBase: bigint;
  readonly roomAtMs: number;
}

/** What one answer says, besides the version and the request id. */
export type ServiceOutcome =
  | {
      readonly outcome: "signed";
      readonly tx: { readonly chain: ChainRef; readonly raw: string; readonly hash: string };
    }
  | { readonly outcome: "refused"; readonly reason: ServiceRefusalReason }
  | ({ readonly outcome: "over_sums" } & ServiceSums)
  | { readonly outcome: "locked"; readonly reason: SignerLock }
  | { readonly outcome: "lease_lost" }
  | { readonly outcome: "down"; readonly reason: ServiceDownReason };

/** One answer of the signer service: every one names the version and the request it answers. */
export type SignerServiceAnswer = {
  readonly version: 1;
  readonly requestId: string;
} & ServiceOutcome;

type SumsWire = Omit<ServiceSums, "chain" | "asset" | "capBase" | "usedBase" | "askedBase"> & {
  readonly chain: string;
  readonly asset: string;
  readonly capBase: string;
  readonly usedBase: string;
  readonly askedBase: string;
};

/** A {@link SignerServiceAnswer} as JSON carries it. */
export type SignerServiceAnswerWire = { readonly version: 1; readonly requestId: string } & (
  | {
      readonly outcome: "signed";
      readonly tx: { readonly chain: string; readonly raw: string; readonly hash: string };
    }
  | { readonly outcome: "refused"; readonly reason: ServiceRefusalReason }
  | ({ readonly outcome: "over_sums" } & SumsWire)
  | { readonly outcome: "locked"; readonly reason: SignerLock }
  | { readonly outcome: "lease_lost" }
  | { readonly outcome: "down"; readonly reason: ServiceDownReason }
);

const hexPattern = /^0x(?:[0-9a-f]{2})+$/;
const header = { version: z.literal(1), requestId: z.string().regex(uuidV7Pattern) };

/**
 * Decodes a {@link SignerServiceAnswer} from JSON, and encodes it back with `z.encode`. Every
 * object is strict: a field the version does not name is no answer of it.
 */
export const signerServiceAnswerSchema: z.ZodType<SignerServiceAnswer, SignerServiceAnswerWire> =
  z.discriminatedUnion("outcome", [
    z.strictObject({
      ...header,
      outcome: z.literal("signed"),
      tx: z.strictObject({
        chain: chainRefSchema,
        raw: z.string().regex(hexPattern),
        hash: z.string().regex(/^0x[0-9a-f]{64}$/),
      }),
    }),
    z.strictObject({
      ...header,
      outcome: z.literal("refused"),
      reason: z.enum([
        "rule_1",
        "rule_2",
        "rule_3",
        "rule_4",
        "rule_5",
        "rule_6",
        "malformed",
        "unknown_wallet",
        "intent_state",
        "no_authorization",
        "authorization_ended",
        "terms_changed",
        "nonce_held",
        "privy_refused",
      ]),
    }),
    z.strictObject({
      ...header,
      outcome: z.literal("over_sums"),
      chain: chainRefSchema,
      asset: assetRefSchema,
      capBase: decimalStringSchema,
      usedBase: decimalStringSchema,
      askedBase: decimalStringSchema,
      roomAtMs: countSchema,
    }),
    z.strictObject({
      ...header,
      outcome: z.literal("locked"),
      reason: z.enum(["breaker", "key_check", "privy_app"]),
    }),
    z.strictObject({ ...header, outcome: z.literal("lease_lost") }),
    z.strictObject({
      ...header,
      outcome: z.literal("down"),
      reason: z.enum(["store", "kms", "privy"]),
    }),
  ]);

/** Decodes an answer from its JSON text; undefined for text that is no answer of any version. */
export function decodeServiceAnswer(text: string): SignerServiceAnswer | undefined {
  try {
    const value: unknown = JSON.parse(text);
    const answer = signerServiceAnswerSchema.safeParse(value);
    return answer.success ? answer.data : undefined;
  } catch {
    return undefined;
  }
}

/** Decodes a request from its JSON text; undefined for text that is no request of this version. */
export function decodeServiceRequest(text: string): SignerServiceRequest | undefined {
  try {
    const value: unknown = JSON.parse(text);
    const request = signerServiceRequestSchema.safeParse(value);
    return request.success ? request.data : undefined;
  } catch {
    return undefined;
  }
}
