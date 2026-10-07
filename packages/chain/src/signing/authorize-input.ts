import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { type AccountRef, accountRefSchema } from "../caip/account-ref.js";
import { type PrivyRequest, privyRequestSchema } from "./privy-request.js";
import {
  type SignAuthorization,
  signAuthorizationSchema,
  type SignAuthorizationWire,
  termsHashSchema,
} from "./sign-authorization.js";
import { type SignStep, signStepSchema, type SignStepWire } from "./sign-step.js";

/** The agent wallet a signature is for. */
export interface SignerWallet {
  readonly id: Id<"wal">;
  /** The wallet's id at Privy: the `<id>` of `/v1/wallets/<id>/rpc`. */
  readonly custodyId: string;
  /** The wallet's own account on the step's chain. */
  readonly account: AccountRef;
}

/**
 * The registry's set for one step (keys spec, section 5.2, rule 2): the venue's declared
 * contracts a call may go to, the registry spenders an approval may name, and the confirmed
 * recipient of a send, a bridge or a rescue.
 */
export interface AllowedTargets {
  readonly contracts: readonly AccountRef[];
  readonly spenders: readonly AccountRef[];
  readonly recipients: readonly AccountRef[];
}

/**
 * The signer's `authorize` request (keys spec, section 5.1): the Privy request custody built for
 * one transaction, the wallet it signs for, and from the engine's `SignRequest` the intent
 * and step it belongs to, what approved the intent, the terms hash of what was approved and the
 * registry's set for the step. The signer's hard rules (section 5.2) read every field.
 */
export interface AuthorizeInput {
  readonly wallet: SignerWallet;
  readonly request: PrivyRequest;
  readonly intent: Id<"int">;
  readonly step: SignStep;
  readonly authorization: SignAuthorization;
  readonly termsHash: string;
  readonly allowed: AllowedTargets;
}

/** An {@link AuthorizeInput} as JSON carries it. */
export interface AuthorizeInputWire {
  readonly wallet: { readonly id: string; readonly custodyId: string; readonly account: string };
  readonly request: PrivyRequest;
  readonly intent: string;
  readonly step: SignStepWire;
  readonly authorization: SignAuthorizationWire;
  readonly termsHash: string;
  readonly allowed: {
    readonly contracts: readonly string[];
    readonly spenders: readonly string[];
    readonly recipients: readonly string[];
  };
}

// The registry's sets are small; a longer list is a fault on the engine's side.
const targetsSchema = z.array(accountRefSchema).max(256);

/** Decodes an {@link AuthorizeInput} from JSON, and encodes it back with `z.encode`. */
export const authorizeInputSchema: z.ZodType<AuthorizeInput, AuthorizeInputWire> = z.strictObject({
  wallet: z.strictObject({
    id: idSchema("wal"),
    custodyId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    account: accountRefSchema,
  }),
  request: privyRequestSchema,
  intent: idSchema("int"),
  step: signStepSchema,
  authorization: signAuthorizationSchema,
  termsHash: termsHashSchema,
  allowed: z.strictObject({
    contracts: targetsSchema,
    spenders: targetsSchema,
    recipients: targetsSchema,
  }),
});
