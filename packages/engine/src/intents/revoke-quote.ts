import {
  type AccountRef,
  accountRefSchema,
  type AssetRef,
  assetRefSchema,
} from "@binference/chain";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";
import { type DocumentCodec, documentCodec } from "./intent-documents.schema.js";

/**
 * What an approval revoke's card confirms (decision 0309): the token whose allowance it sets to
 * zero and the spender that allowance names, each in its family's canonical form. A revoke keeps
 * it in the intent's `quote` column, so the card's terms hash binds both.
 */
export interface RevokeQuote {
  readonly token: AssetRef;
  readonly spender: AccountRef;
  readonly quotedAtMs: number;
}

/** A {@link RevokeQuote} as JSON carries it. */
interface RevokeQuoteWire {
  readonly token: string;
  readonly spender: string;
  readonly quotedAtMs: number;
}

const revokeQuoteSchema: z.ZodType<RevokeQuote, RevokeQuoteWire> = z.strictObject({
  token: assetRefSchema,
  spender: accountRefSchema,
  quotedAtMs: epochMsSchema,
});

/** An approval revoke's quote, in the `quote` column of a `revokeApproval` intent. */
export const revokeQuoteDocument: DocumentCodec<RevokeQuote> = documentCodec(
  "revoke quote",
  revokeQuoteSchema,
);
