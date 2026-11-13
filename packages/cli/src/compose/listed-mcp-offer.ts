import type { Id, Logger } from "@binference/core";
import { protocolIdSchema } from "@binference/protocol";
import {
  jsonBytesOf,
  type ListedMcpServer,
  type ListedMcpSource,
  listedMcpServersSchema,
  listingLimits,
  listingRefusal,
} from "@binference/runtime";
import { z } from "zod";
import type { ProfileParts } from "./profile-parts.js";

/** What the listings in force are handed to: the runtime's settings. */
interface ListedMcpRuntime {
  /** Puts the listings in the runtime's settings, and settles once it was handed them. */
  readonly offerListedMcp: (servers: readonly ListedMcpServer[]) => Promise<void>;
}

/** The listed MCP servers of a composition root (decision 0428), and the engine's switch. */
export interface ListedMcpStep {
  /**
   * Whether an agent may hold a listed server's tools now, which the engine takes as
   * `listedMcpOn` before the runtime starts: on before the runtime is handed settings with a
   * listing for the agent, off only once it was handed settings with none. Absent for a root that
   * offers no listed server.
   */
  readonly listedMcpOn?: (agent: Id<"agt">) => boolean;
  /** Hands the runtime the listings in force now, and again at each change of the source. */
  begin(runtime: ListedMcpRuntime): Promise<void>;
  /** Stops following the source, as the composition closes. */
  stop(): void;
}

// A refused listing's id, when it holds one that reads as an id; nothing else of it is read.
const listingIdSchema = z.object({
  listing: z.object({ listing: protocolIdSchema("mcpListing") }),
});

function listingIdOf(value: ListedMcpServer): string | undefined {
  const parsed = listingIdSchema.safeParse(value);
  return parsed.success ? parsed.data.listing.listing : undefined;
}

// Whether one more listing keeps the set within its bounds: a name taken once, at most 4 on for
// any agent and 64 in all.
function fits(
  kept: readonly ListedMcpServer[],
  next: ListedMcpServer,
): "repeated" | "bounds" | undefined {
  if (kept.some(({ listing }) => listing.name === next.listing.name)) {
    return "repeated";
  }
  const full = next.agents.some(
    (agent) =>
      kept.filter((server) => server.agents.includes(agent)).length >= listingLimits.perAgent,
  );
  return full || kept.length >= listingLimits.inForce ? "bounds" : undefined;
}

function refused(logger: Logger, server: ListedMcpServer, reason: string): void {
  const listing = listingIdOf(server);
  logger.warn("runtime.listing_refused", { ...(listing === undefined ? {} : { listing }), reason });
}

// The listings that fit the set's 512 KiB, taken in listing id order; each past it is left out.
function withinBytes(
  servers: readonly ListedMcpServer[],
  logger: Logger,
): readonly ListedMcpServer[] {
  const byId = servers.toSorted((left, right) =>
    left.listing.listing < right.listing.listing ? -1 : 1,
  );
  const kept: ListedMcpServer[] = [];
  for (const server of byId) {
    if (jsonBytesOf([...kept, server]) <= listingLimits.setBytes) {
      kept.push(server);
    } else {
      refused(logger, server, "bounds");
    }
  }
  return servers.filter((server) => kept.includes(server));
}

/**
 * The listings of the source that the runtime may take, in the source's order: each checked with
 * the listing schema, the set held to its bounds and to 512 KiB as JSON, listings past it left out
 * in listing id order, and the set then read with the runtime's own schema, which hands none when
 * it refuses. Each one left out is logged with its id, when it has a readable one, and its reason,
 * never its words, so a bad listing never ends the runtime.
 */
export function listingsInForce(
  servers: readonly ListedMcpServer[],
  logger: Logger,
): readonly ListedMcpServer[] {
  const kept: ListedMcpServer[] = [];
  for (const server of servers) {
    const reason = listingRefusal(server) ?? fits(kept, server);
    if (reason === undefined) {
      kept.push(server);
    } else {
      refused(logger, server, reason);
    }
  }
  const sized = withinBytes(kept, logger);
  const read = listedMcpServersSchema.safeParse(sized);
  if (read.success) {
    return sized;
  }
  // The checks above match the runtime's schema; a set it still refuses goes out empty, never
  // as a settings line that would end the runtime.
  const reason = read.error.issues[0]?.message ?? "shape";
  for (const server of sized) {
    refused(logger, server, reason);
  }
  return [];
}

const ignore = (): void => undefined;

function agentsOn(servers: readonly ListedMcpServer[]): ReadonlySet<string> {
  return new Set(
    servers.filter(({ listing }) => listing.tools.length > 0).flatMap(({ agents }) => agents),
  );
}

// The offer of a root with a source: it hands the runtime the listings in force, one change at a
// time, and keeps the engine's switch on the safe side of what the runtime holds, so the engine
// never stops marking a turn the runtime may still start with a listed server's words.
function offerOf(source: ListedMcpSource, logger: Logger): ListedMcpStep {
  let on: ReadonlySet<string> = new Set();
  let queue = Promise.resolve();
  let unwatch = ignore;
  return {
    listedMcpOn: (agent) => on.has(agent),
    async begin(runtime) {
      const offer = async (): Promise<void> => {
        const servers = listingsInForce(source.current(), logger);
        const next = agentsOn(servers);
        on = new Set([...on, ...next]);
        await runtime.offerListedMcp(servers);
        on = next;
      };
      const follow = async (): Promise<void> => {
        queue = queue.then(offer, offer);
        return queue;
      };
      unwatch = source.watch(() => void follow().catch(ignore));
      await follow();
    },
    stop: () => unwatch(),
  };
}

/**
 * The listed MCP step of a composition root (decision 0428): on the root's `listedMcp` source, the
 * engine's switch, given to the engine before the runtime starts, and the offer, which begins once
 * the runtime's supervisor exists and stops as the composition closes. A root whose parts hold no
 * source, such as the self-hosted one, gets no switch and hands the runtime no listing.
 */
export function composeListedMcp(
  parts: Pick<ProfileParts, "listedMcp">,
  logger: Logger,
): ListedMcpStep {
  return parts.listedMcp === undefined
    ? { begin: async () => Promise.resolve(), stop: ignore }
    : offerOf(parts.listedMcp, logger);
}
