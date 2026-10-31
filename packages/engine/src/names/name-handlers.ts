import type { NameResolution, NameResolver } from "@binference/chain";
import { type Clock, err, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode, ResultOf } from "@binference/protocol";
import type { EngineHandler } from "../operations/engine-call.js";
import { readName } from "./read-name.js";

/** The handler of `name/resolve` (protocol spec, section 7.3). */
export interface NameHandlers {
  readonly "name/resolve": EngineHandler<"name/resolve">;
}

/** What `name/resolve` reads through: a resolver per suffix, and the clock that dates each answer. */
export interface NameHandlersOptions {
  readonly resolvers: readonly NameResolver[];
  readonly clock: Clock;
}

const refusals: Readonly<Record<Exclude<NameResolution["kind"], "found">, ProtocolErrorCode>> = {
  malformed: "protocol.bad_args",
  not_found: "name.not_found",
  contract: "name.contract",
};

function answerOf(
  answer: NameResolution,
  resolvedAt: number,
): Result<ResultOf<"name/resolve">, ProtocolErrorCode> {
  if (answer.kind !== "found") {
    return err(refusals[answer.kind]);
  }
  const { name, address, smartAccount, reverse } = answer;
  return ok({
    name,
    address,
    resolvedAt,
    ...(smartAccount === undefined ? {} : { smartAccount }),
    ...(reverse === undefined ? {} : { reverse: reverse.kind }),
  });
}

async function resolveName(
  options: NameHandlersOptions,
  name: string,
  signal: AbortSignal,
): Promise<Result<ResultOf<"name/resolve">, ProtocolErrorCode>> {
  const answer = await readName(options.resolvers, name, signal);
  return answer.ok ? answerOf(answer.value, options.clock.now()) : answer;
}

/**
 * Creates the `name/resolve` handler. It asks the resolver whose suffix the name ends with, on
 * every call, and answers its address with the time of the answer, whether it is a smart-account
 * wallet, and what the address's reverse record names. A name no resolver serves, or that does not normalize, is `protocol.bad_args`; a
 * name that points nowhere `name.not_found`; one that points to an account with code
 * `name.contract`; and a resolver that fails `name.resolver_down`, which a later call may get past.
 */
export function createNameHandlers(options: NameHandlersOptions): NameHandlers {
  return { "name/resolve": async ({ args, signal }) => resolveName(options, args.name, signal) };
}
