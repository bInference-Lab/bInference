import { z } from "zod";
import { isPrivyId, type PrivyId } from "../privy/privy-records.js";
import { parseJsonText } from "./fake-privy-request.schema.js";

/**
 * What one live run made on the Privy test app with its owner key, kept until its cleanup confirms
 * every policy and aggregation gone. Privy lists no aggregations, so their ids live only here; its
 * wallets are those Privy lists for the owner key.
 */
export interface LeftoverRecord {
  /** The owner key's private half, PKCS#8 DER in base64: a key of the Privy test app only. */
  readonly ownerKey: string;
  /** The key quorums of the owner key the run made. */
  readonly quorums: readonly PrivyId[];
  readonly policies: readonly PrivyId[];
  readonly aggregations: readonly PrivyId[];
}

const idsSchema = z.array(z.string().refine(isPrivyId)).max(1_000).readonly();

const leftoverRecordSchema: z.ZodType<LeftoverRecord> = z.strictObject({
  ownerKey: z.base64().min(1),
  quorums: idsSchema,
  policies: idsSchema,
  aggregations: idsSchema,
});

const leftoverIndexSchema = z.array(z.string().min(1)).max(1_000).readonly();

/** Reads a kept record from its stored text; text of another shape is undefined. */
export function readLeftoverRecord(text: string): LeftoverRecord | undefined {
  const parsed = leftoverRecordSchema.safeParse(parseJsonText(text));
  return parsed.success ? parsed.data : undefined;
}

/** Reads the names of the kept records from their stored text; text of another shape is empty. */
export function readLeftoverIndex(text: string): readonly string[] {
  const parsed = leftoverIndexSchema.safeParse(parseJsonText(text));
  return parsed.success ? parsed.data : [];
}
