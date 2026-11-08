import { z } from "zod";

const listSchema = z.looseObject({ data: z.array(z.unknown()) });

/**
 * One model's entry of a gateway model list, such as `GET /images/models` or `GET /videos/models`,
 * read by `entry`, which must read its `id`; `undefined` when the list does not hold it or does not
 * read.
 */
export function gatewayModelEntry<Entry extends { readonly id: string }>(
  list: unknown,
  model: string,
  entry: z.ZodType<Entry>,
): Entry | undefined {
  const read = listSchema.safeParse(list);
  const entries = read.success ? read.data.data : [];
  for (const item of entries) {
    const parsed = entry.safeParse(item);
    if (parsed.success && parsed.data.id === model) {
      return parsed.data;
    }
  }
  return undefined;
}
