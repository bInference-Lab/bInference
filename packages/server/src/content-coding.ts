/** A coding a built file is kept in beside its own bytes: Brotli in `.br`, gzip in `.gz`. */
export type ContentCoding = "br" | "gzip";

/** The codings the console's build keeps, in the order the server prefers them. */
export const contentCodings: readonly ContentCoding[] = ["br", "gzip"];

/** The file a coding keeps beside the file it encodes. */
export const codingSuffix: Readonly<Record<ContentCoding, string>> = { br: ".br", gzip: ".gz" };

// Each listed coding with its weight; a coding the header leaves out takes the weight of `*`, or
// none when there is no `*` (RFC 9110, section 12.5.3).
function weightsOf(header: string): ReadonlyMap<string, number> {
  const weights = new Map<string, number>();
  for (const item of header.split(",")) {
    const [name = "", ...parameters] = item.split(";").map((part) => part.trim().toLowerCase());
    const quality = parameters.find((parameter) => parameter.startsWith("q="));
    const weight = quality === undefined ? 1 : Number(quality.slice(2));
    if (name !== "" && Number.isFinite(weight)) {
      weights.set(name, weight);
    }
  }
  return weights;
}

/**
 * The coding to answer in from an `Accept-Encoding` header and the codings a file is kept in: the
 * one the client weighs highest above zero, Brotli before gzip at equal weight, or `undefined`
 * for the file's own bytes. A missing header asks for no coding.
 */
export function pickCoding(
  acceptEncoding: string | undefined,
  available: readonly ContentCoding[],
): ContentCoding | undefined {
  if (acceptEncoding === undefined) {
    return undefined;
  }
  const weights = weightsOf(acceptEncoding);
  const weightOf = (coding: ContentCoding): number => weights.get(coding) ?? weights.get("*") ?? 0;
  const acceptable = available.filter((coding) => weightOf(coding) > 0);
  return acceptable.toSorted(
    (left, right) =>
      weightOf(right) - weightOf(left) ||
      contentCodings.indexOf(left) - contentCodings.indexOf(right),
  )[0];
}
