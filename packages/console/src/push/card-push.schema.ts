import * as z from "zod/mini";

/** A card push as the engine sends it to the push worker (decision 0158): no amount, no address. */
export interface CardPush {
  readonly v: 1;
  readonly kind: "opened" | "closed";
  readonly intent: string;
  readonly card: string;
  /** The words in the owner's language. */
  readonly title: string;
  readonly body: string;
}

const intentId = z.string().check(z.regex(/^int_[0-9a-f-]{36}$/));

const cardPushSchema: z.ZodMiniType<CardPush> = z.object({
  v: z.literal(1),
  kind: z.enum(["opened", "closed"]),
  intent: intentId,
  card: z.string().check(z.regex(/^crd_[0-9a-f-]{36}$/)),
  title: z.string().check(z.maxLength(200)),
  body: z.string().check(z.maxLength(500)),
});

const cardClickSchema = z.object({ type: z.literal("card"), intent: intentId });

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Reads a push message's text as a card push, or `undefined` for anything else. */
export function readCardPush(text: string): CardPush | undefined {
  const read = cardPushSchema.safeParse(parsedJson(text));
  return read.success ? read.data : undefined;
}

/**
 * Reads what the push worker posts to a page when the owner clicks a card's notification: the
 * intent to show, or `undefined` for any other message.
 */
export function readCardClick(data: unknown): string | undefined {
  const read = cardClickSchema.safeParse(data);
  return read.success ? read.data.intent : undefined;
}

/** Reads an intent's id from an address's query (`?intent=int_…`), or `undefined`. */
export function readIntentQuery(search: string): string | undefined {
  const read = intentId.safeParse(new URLSearchParams(search).get("intent"));
  return read.success ? read.data : undefined;
}
