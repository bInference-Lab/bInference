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
 * zero and the spender that allowance names, each in its family's canonical form, with the
 * spender's registry name. A revoke keeps
 * it in the intent's `quote` column, so the card's terms hash binds both.
 */
export interface RevokeQuote {
  readonly token: AssetRef;
  readonly spender: AccountRef;
  /** The spender as the chain registry names it: its venue and its contract's name. */
  readonly spenderName?: string;
  readonly quotedAtMs: number;
}

/** A {@link RevokeQuote} as JSON carries it. */
interface RevokeQuoteWire {
  readonly token: string;
  readonly spender: string;
  readonly spenderName?: string;
  readonly quotedAtMs: number;
}

const revokeQuoteSchema: z.ZodType<RevokeQuote, RevokeQuoteWire> = z.strictObject({
  token: assetRefSchema,
  spender: accountRefSchema,
  spenderName: z.string().min(1).max(200).exactOptional(),
  quotedAtMs: epochMsSchema,
});

/** An approval revoke's quote, in the `quote` column of a `revokeApproval` intent. */
export const revokeQuoteDocument: DocumentCodec<RevokeQuote> = documentCodec(
  "revoke quote",
  revokeQuoteSchema,
);
