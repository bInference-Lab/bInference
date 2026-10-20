import { z } from "zod";

/** The web links a launched token shows, each an address its owner gave. */
export interface LaunchLinks {
  readonly website?: string;
  readonly x?: string;
  readonly telegram?: string;
}

/** A launch's words beyond its name and symbol: its description and its links. */
export interface LaunchWords {
  readonly description?: string;
  readonly links?: LaunchLinks;
}

/**
 * A launch's words as a create call writes them on chain: an empty text for one the launch does
 * not give, so the bytes and the request say one thing.
 */
export interface WrittenWords {
  readonly description: string;
  readonly links: {
    readonly website: string;
    readonly x: string;
    readonly telegram: string;
  };
}

/** Checks the words a create call writes. */
export const writtenWordsSchema: z.ZodType<WrittenWords, WrittenWords> = z.strictObject({
  description: z.string(),
  links: z.strictObject({ website: z.string(), x: z.string(), telegram: z.string() }),
});

/** A launch's words as a create call that keeps them on chain writes them: none as empty text. */
export function writtenWordsOf(words: LaunchWords): WrittenWords {
  const { description, links } = words;
  return {
    description: description ?? "",
    links: { website: links?.website ?? "", x: links?.x ?? "", telegram: links?.telegram ?? "" },
  };
}

/**
 * The most bytes, in UTF-8, a launchpad's create call takes for each of a launch's words: the
 * name, the symbol, the description and each link. A launch over one is refused before anything is
 * stored, uploaded or sent.
 */
export interface LaunchWordLimits {
  readonly nameBytes: number;
  readonly symbolBytes: number;
  readonly descriptionBytes: number;
  readonly linkBytes: number;
}

const byteCount = z.int().positive();

/** Checks a launchpad's word limits: each a whole number of bytes above 0. */
export const launchWordLimitsSchema: z.ZodType<LaunchWordLimits> = z.strictObject({
  nameBytes: byteCount,
  symbolBytes: byteCount,
  descriptionBytes: byteCount,
  linkBytes: byteCount,
});

const bytesOf = (text: string): number => new TextEncoder().encode(text).byteLength;

/** Whether a launch's name, symbol and words fit a launchpad's limits, each counted in UTF-8. */
export function fitsWordLimits(
  limits: LaunchWordLimits,
  launch: { readonly name: string; readonly symbol: string } & LaunchWords,
): boolean {
  const { description, links } = writtenWordsOf(launch);
  return (
    bytesOf(launch.name) <= limits.nameBytes &&
    bytesOf(launch.symbol) <= limits.symbolBytes &&
    bytesOf(description) <= limits.descriptionBytes &&
    Object.values(links).every((link) => bytesOf(link) <= limits.linkBytes)
  );
}
