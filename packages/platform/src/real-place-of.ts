import { basename, dirname, join } from "node:path";
import { realPathOf } from "./read-file-bytes.js";
import type { RealPathStep } from "./read-judged-file.js";

/**
 * The real path of a place that may not exist yet: the nearest folder on its path that does, every
 * link resolved, with the rest of the path after it, so no link on the way leads elsewhere unseen.
 * `realPath` is the platform's {@link realPathOf} unless a test passes its own.
 */
export async function realPlaceOf(
  path: string,
  signal: AbortSignal,
  realPath: RealPathStep = realPathOf,
): Promise<string> {
  const real = await realPath(path, signal);
  if (real !== undefined) {
    return real;
  }
  const parent = dirname(path);
  return parent === path ? path : join(await realPlaceOf(parent, signal, realPath), basename(path));
}
