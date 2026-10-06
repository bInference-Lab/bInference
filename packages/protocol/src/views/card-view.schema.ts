import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";

/**
 * One version of an intent's card: when it opens and expires, and the marks it shows. Its text is
 * drawn from the stored intent on each surface.
 */
export interface CardView {
  readonly card: ProtocolId<"card">;
  /** Starts at 1; a worse re-quote opens the next version, and confirming an old one fails. */
  readonly version: number;
  readonly opensAt: number;
  readonly expiresAt: number;
  readonly paper: boolean;
  /** The proposing turn read outside content, so the card carries a warning. */
  readonly outsideContent: boolean;
}

/** Parses a card view. */
export const cardViewSchema: z.ZodType<CardView> = z.object({
  card: protocolIdSchema("card"),
  version: z.int().min(1),
  opensAt: epochMsSchema,
  expiresAt: epochMsSchema,
  paper: z.boolean(),
  outsideContent: z.boolean(),
});
