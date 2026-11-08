import { err, ok, type Result } from "@binference/core";

/** The pages a range names, in order, each once, and whether some past the most were left out. */
export interface PageSelection {
  readonly pages: readonly number[];
  readonly cut: boolean;
}

// The largest page number a range may name.
const lastPage = 100_000;
const single = /^\d+$/u;
const span = /^(\d+)\s*-\s*(\d+)$/u;

function spanOf(part: string): readonly [number, number] | undefined {
  const pair = span.exec(part);
  if (pair !== null) {
    return [Number(pair[1]), Number(pair[2])];
  }
  return single.test(part) ? [Number(part), Number(part)] : undefined;
}

function spansOf(range: string): Result<readonly (readonly [number, number])[], string> {
  const spans: (readonly [number, number])[] = [];
  for (const part of range.split(",").map((each) => each.trim())) {
    if (part === "") {
      continue;
    }
    const found = spanOf(part);
    if (found === undefined || found[0] < 1 || found[1] < found[0] || found[1] > lastPage) {
      return err(`"${part}" is no page or range of pages, such as 3 or 1-5.`);
    }
    spans.push(found);
  }
  return spans.length === 0 ? err("Name at least one page, such as 1-5.") : ok(spans);
}

/**
 * The pages a range such as "1-5" or "1,3,5-7" names, sorted, each once, at most `most` of them,
 * the lowest first; or why the range cannot be read.
 */
export function pagesOf(range: string, most: number): Result<PageSelection, string> {
  const spans = spansOf(range);
  if (!spans.ok) {
    return spans;
  }
  const pages = new Set<number>();
  const sorted = spans.value.toSorted((left, right) => left[0] - right[0]);
  for (const [first, last] of sorted) {
    for (let page = first; page <= last && pages.size <= most; page += 1) {
      pages.add(page);
    }
  }
  const all = [...pages].toSorted((left, right) => left - right);
  return ok({ pages: all.slice(0, most), cut: all.length > most });
}
