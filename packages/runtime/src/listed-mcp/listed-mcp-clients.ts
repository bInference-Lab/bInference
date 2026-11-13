import type { Id, JsonValue } from "@binference/core";
import type { ProtocolId } from "@binference/protocol";
import {
  createListedEntry,
  type ListedCallOutcome,
  type ListedEntry,
  type ListedEntryParts,
} from "./listed-mcp-entry.js";
import type { ListedMcpState } from "./listed-mcp-state.schema.js";
import type { ListedMcpServer } from "./listing.schema.js";

/** One call of a listed tool: the agent, the listing and the tool's name in it. */
interface ListedCall {
  readonly agent: Id<"agt">;
  readonly listing: ProtocolId<"mcpListing">;
  /** The listing's version the turn took the tool from, whose schema checked the arguments. */
  readonly version: number;
  /** The tool's `as` in its listing. */
  readonly tool: string;
  readonly args: JsonValue;
}

/** Every agent's connections to the listed servers in force (decisions 0428 and 0430). */
export interface ListedMcpClients {
  /** Puts the listings in force; a connection whose listing left, changed or went off closes. */
  use(servers: readonly ListedMcpServer[]): void;
  /** Calls a listed tool; never rejects for anything the server does. */
  call(call: ListedCall, signal: AbortSignal): Promise<ListedCallOutcome>;
  /** Each agent's listing that rests or has a tool off, for the `health` line. */
  states(): readonly ListedMcpState[];
  /** Closes every connection, as the runtime stops. */
  close(): Promise<void>;
}

// An agent's entry, kept with the agent it serves.
interface Held {
  readonly agent: Id<"agt">;
  readonly entry: ListedEntry;
}

function stays(held: Held, inForce: ReadonlyMap<string, ListedMcpServer>): boolean {
  const server = inForce.get(held.entry.listing.listing);
  return (
    server !== undefined &&
    server.listing.version === held.entry.listing.version &&
    server.agents.includes(held.agent)
  );
}

/**
 * Creates every agent's connections to the listed servers in force (decisions 0428 and 0430): one
 * entry per agent and listing, made at its first call and made again at a new version. A call to
 * a listing the settings in force no longer name for the agent, or to a tool the listing no longer
 * holds, answers `revoked` at once and sends nothing, in a running turn too; one from a turn that
 * started on another version of the listing answers `listing_changed` the same way.
 */
export function createListedMcpClients(parts: ListedEntryParts): ListedMcpClients {
  let inForce = new Map<string, ListedMcpServer>();
  const held = new Map<string, Held>();
  return {
    use(servers) {
      inForce = new Map(servers.map((server) => [server.listing.listing, server]));
      for (const [key, one] of held) {
        if (!stays(one, inForce)) {
          held.delete(key);
          void one.entry.close();
        }
      }
    },
    async call(call, signal) {
      const server = inForce.get(call.listing);
      const tool = server?.listing.tools.find(({ as }) => as === call.tool);
      if (server === undefined || tool === undefined || !server.agents.includes(call.agent)) {
        return { kind: "failed", reason: "revoked" };
      }
      // The arguments passed the schema of the version the turn started on, not this one's.
      if (server.listing.version !== call.version) {
        return { kind: "failed", reason: "listing_changed" };
      }
      const key = `${call.agent} ${call.listing}`;
      let one = held.get(key);
      if (one === undefined || one.entry.listing.version !== server.listing.version) {
        void one?.entry.close();
        one = { agent: call.agent, entry: createListedEntry(parts, call.agent, server.listing) };
        held.set(key, one);
      }
      return one.entry.call(tool, call.args, signal);
    },
    states: () => [...held.values()].flatMap(({ entry }) => entry.states()),
    async close() {
      const closing = [...held.values()].map(async ({ entry }) => entry.close());
      held.clear();
      await Promise.all(closing);
    },
  };
}
