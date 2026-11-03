import { type AccountRef, accountRefSchema } from "@binference/chain";
import { registrationFileSchema } from "@binference/chain/identity";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";
import { type DocumentCodec, documentCodec } from "./intent-documents.schema.js";

/**
 * What an identity registration's card confirms (decisions 0334 and 0335): the registry and the
 * plugin that runs it, every field its registration file publishes, the agent's name, the owner's
 * description (empty for none), the registering wallet and binference's version, and the file
 * itself. A registration keeps it in the intent's `quote` column, so the card's terms hash binds
 * the exact file that goes on chain.
 */
export interface IdentityQuote {
  readonly registry: AccountRef;
  /** The identity plugin's id, such as `erc8004`. */
  readonly venue: string;
  readonly name: string;
  readonly description: string;
  readonly wallet: AccountRef;
  readonly version: string;
  readonly file: string;
  readonly quotedAtMs: number;
}

/** An {@link IdentityQuote} as JSON carries it. */
interface IdentityQuoteWire {
  readonly registry: string;
  readonly venue: string;
  readonly name: string;
  readonly description: string;
  readonly wallet: string;
  readonly version: string;
  readonly file: string;
  readonly quotedAtMs: number;
}

const identityQuoteSchema: z.ZodType<IdentityQuote, IdentityQuoteWire> = z.strictObject({
  registry: accountRefSchema,
  venue: z.string().min(1).max(32),
  name: z.string().min(1).max(64),
  description: z.string().max(280),
  wallet: accountRefSchema,
  version: z.string().min(1).max(64),
  file: registrationFileSchema,
  quotedAtMs: epochMsSchema,
});

/** An identity registration's quote, in the `quote` column of a `registerIdentity` intent. */
export const identityQuoteDocument: DocumentCodec<IdentityQuote> = documentCodec(
  "identity quote",
  identityQuoteSchema,
);
