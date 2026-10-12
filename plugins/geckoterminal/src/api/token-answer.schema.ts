import { isJsonNumber, parseJsonText } from "@binference/plugin-sdk/data";
import { z } from "zod";

const tokenSchema = z.object({
  type: z.literal("token"),
  attributes: z.object({
    address: z.string().min(1),
    price_usd: z.string().refine(isJsonNumber).nullish(),
  }),
});

const tokenListSchema = z.object({ data: z.array(tokenSchema) });

/**
 * Reads the answer of `GET /networks/{network}/tokens/multi/{addresses}`: each token's USD price
 * by its address in lowercase, as the text GeckoTerminal wrote. A token it knows not, which it
 * leaves out, or sent no price for, is left out. An answer outside the documented `token` schema
 * is undefined.
 */
export function readTokenPrices(text: string): ReadonlyMap<string, string> | undefined {
  const answer = tokenListSchema.safeParse(parseJsonText(text));
  if (!answer.success) {
    return undefined;
  }
  const prices = answer.data.data.flatMap(({ attributes }) =>
    typeof attributes.price_usd === "string"
      ? [[attributes.address.toLowerCase(), attributes.price_usd] as const]
      : [],
  );
  return new Map(prices);
}
