import { z } from "zod";

/** The paging args of a list operation. */
export interface PageArgs {
  /** The `next` of the previous page; absent for the first page. */
  readonly cursor?: string;
  /** Items per page: 50 when absent, at most 200. */
  readonly limit?: number;
}

/** One page of a list. A list that never pages answers with every item and no `next`. */
export interface Page<T> {
  readonly items: readonly T[];
  /** The cursor of the next page; absent on the last page. */
  readonly next?: string;
}

/** The paging fields, for a list operation that takes filters beside them. */
export const pageArgsShape: {
  readonly cursor: z.ZodExactOptional<z.ZodString>;
  readonly limit: z.ZodExactOptional<z.ZodInt>;
} = {
  cursor: z.string().min(1).max(512).exactOptional(),
  limit: z.int().min(1).max(200).exactOptional(),
};

/** Parses the args of a list operation that takes nothing but paging. */
export const pageArgsSchema: z.ZodType<PageArgs> = z.strictObject(pageArgsShape);

/** Builds the schema of one page of items. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- zod schemas are mutable
export function pageSchema<T>(item: z.ZodType<T>): z.ZodType<Page<T>> {
  return z.object({ items: z.array(item), next: z.string().min(1).exactOptional() });
}
