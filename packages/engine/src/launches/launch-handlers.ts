import type { ChainRegistry } from "@binference/chain";
import { decimalStringSchema, err, ok, type Result } from "@binference/core";
import type { ArgsOf, ProtocolErrorCode, ResultOf } from "@binference/protocol";
import { z } from "zod";
import type { EngineHandler } from "../operations/engine-call.js";
import { epochMsSchema } from "../records/record-fields.js";
import { launchQueryOf, type LaunchReadOptions } from "./launch-query.js";
import type { LaunchPlace, StoredLaunch } from "./launch-record.js";
import { launchViewOf } from "./launch-view-of.js";

/** The handler of `launch/list` (protocol spec, section 7.3). */
export interface LaunchHandlers {
  readonly "launch/list": EngineHandler<"launch/list">;
}

const defaultPageSize = 50;

// A cursor is the last launch of the page before: its time, block and log index.
const cursorPattern = /^(0|[1-9]\d{0,14}):(0|[1-9]\d{0,77}):(0|[1-9]\d{0,8})$/;
const placeSchema: z.ZodType<LaunchPlace, readonly [string, string, string]> = z
  .tuple([
    z.coerce.number<string>().pipe(epochMsSchema),
    decimalStringSchema,
    z.coerce.number<string>().pipe(z.int()),
  ])
  .transform((parts: readonly [number, bigint, number]) => {
    const [launchedAtMs, block, logIndex] = parts;
    return { launchedAtMs, block, logIndex };
  });

function placeOf(cursor: string): LaunchPlace | undefined {
  const [, at, block, index] = cursorPattern.exec(cursor) ?? [];
  const parsed = placeSchema.safeParse([at ?? "", block ?? "", index ?? ""]);
  return parsed.success ? parsed.data : undefined;
}

const cursorOf = (launch: StoredLaunch): string =>
  `${String(launch.launchedAtMs)}:${launch.block.toString(10)}:${String(launch.logIndex)}`;

// Where the page starts: after the launch the cursor names, or from the newest.
function beforeOf(cursor: string | undefined): Result<LaunchPlace | undefined, ProtocolErrorCode> {
  if (cursor === undefined) {
    return ok(undefined);
  }
  const place = placeOf(cursor);
  return place === undefined ? err("protocol.bad_args") : ok(place);
}

function pageOf(
  chains: ChainRegistry,
  launches: readonly StoredLaunch[],
  limit: number,
): ResultOf<"launch/list"> {
  const last = launches.at(-1);
  return {
    items: launches.map((launch) => launchViewOf(chains, launch)),
    ...(launches.length === limit && last !== undefined ? { next: cursorOf(last) } : {}),
  };
}

async function listOf(
  options: LaunchReadOptions,
  args: ArgsOf<"launch/list">,
  signal: AbortSignal,
): Promise<Result<ResultOf<"launch/list">, ProtocolErrorCode>> {
  const limit = args.limit ?? defaultPageSize;
  const query = launchQueryOf(options, { ...args, limit });
  const before = beforeOf(args.cursor);
  if (!query.ok || !before.ok) {
    return query.ok ? err("protocol.bad_args") : query;
  }
  if (query.value === undefined) {
    return ok({ items: [] });
  }
  const page = {
    ...query.value,
    ...(args.from === undefined ? {} : { fromMs: args.from }),
    ...(before.value === undefined ? {} : { before: before.value }),
  };
  return ok(pageOf(options.chains, await options.launches.list(page, { signal }), limit));
}

/**
 * Creates the `launch/list` handler. It answers a chain's launches the launch feed recorded,
 * newest first, launched at or after `from`, through the filters, a page at a time (50 unless
 * `limit` says), each as a `LaunchView` with its tokens' info. A chain the registry does not hold,
 * a launchpad the engine does not run, a quote token the registry does not hold, or a cursor this
 * engine did not write is `protocol.bad_args`. A filter with a least liquidity passes no launch,
 * since the feed reads none.
 */
export function createLaunchHandlers(options: LaunchReadOptions): LaunchHandlers {
  return { "launch/list": async ({ args, signal }) => listOf(options, args, signal) };
}
