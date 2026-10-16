import { type AssetRef, assetRefSchema } from "@binference/chain";
import { z } from "zod";
import { type CardLineView, cardLineViewSchema } from "./card-lines.schema.js";

/**
 * One position's P&L card as the engine draws it (spec 4, section 3.7): an agent's holding of one
 * asset in one mode, open while it holds units, else closed. Each surface shows its lines with
 * `cardLineText`; `paper` lets it mark the mode its own way.
 */
export interface PnlCardView {
  readonly asset: AssetRef;
  readonly paper: boolean;
  readonly closed: boolean;
  readonly lines: readonly CardLineView[];
}

/** Parses a P&L card. */
export const pnlCardViewSchema: z.ZodType<PnlCardView> = z.object({
  asset: assetRefSchema,
  paper: z.boolean(),
  closed: z.boolean(),
  lines: z.array(cardLineViewSchema),
});
