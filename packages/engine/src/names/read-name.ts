import type { NameResolution, NameResolver } from "@binference/chain";
import { err, ok, type Result } from "@binference/core";

/**
 * Reads what a name points to now through the resolver whose suffix it ends with (protocol spec,
 * section 7.3). A name no resolver serves is `protocol.bad_args`; a resolver that fails is
 * `name.resolver_down`, which a later read may get past. A call its caller stopped rejects with
 * the signal's reason.
 */
export async function readName(
  resolvers: readonly NameResolver[],
  name: string,
  signal: AbortSignal,
): Promise<Result<NameResolution, "protocol.bad_args" | "name.resolver_down">> {
  const resolver = resolvers.find((each) => name.toLowerCase().endsWith(each.suffix));
  if (resolver === undefined) {
    return err("protocol.bad_args");
  }
  try {
    return ok(await resolver.resolve(name, { signal }));
  } catch {
    // Any fault but the caller's stop is the chain not answering, which a later read may get past.
    signal.throwIfAborted();
    return err("name.resolver_down");
  }
}
