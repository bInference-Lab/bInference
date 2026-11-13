import { type Clock, createDeadline, type JsonValue, jsonValueSchema } from "@binference/core";
import {
  Client,
  type ClientOptions,
  type RequestOptions,
  StreamableHTTPClientTransport,
  type Tool,
} from "@modelcontextprotocol/client";
import { z } from "zod";
import type { StreamingHttp } from "../providers/ports.js";
import { answerOf, type ListedAnswer } from "./listed-mcp-answers.js";
import {
  type ListedFailure,
  type ListedFailureReason,
  listedCallHeader,
  listingFetch,
} from "./listing-fetch.js";
import type { ListedMcpTool, McpListing } from "./listing.schema.js";
import { serverDigestOf } from "./server-digest.js";

/** Why a listed tool is off for the rest of its listing's version (decision 0429). */
export type ToolOffReason = "changed" | "missing" | "writes";

/** Why a call or a connection got no good answer: the fetch's reasons, or its time ran out. */
export type ConnectionFailure =
  | { readonly reason: Exclude<ListedFailureReason, "rate_limited"> }
  | { readonly reason: "rate_limited"; readonly retryAfterSeconds?: number };

/** One open connection to a listed server, its live list checked against the listing. */
export interface ListedConnection {
  /** The listing's tools the live list turned off, by their name on the server. */
  readonly off: ReadonlyMap<string, ToolOffReason>;
  /** Calls one listed tool with arguments its listing's schema took; never rejects for the server. */
  call(
    tool: ListedMcpTool,
    args: JsonValue,
    signal: AbortSignal,
  ): Promise<ListedAnswer | ConnectionFailure>;
  /** Ends the session, at most 2 seconds, and lets the connection go. */
  close(): Promise<void>;
}

/** What a connection is opened with. */
export interface ConnectionParts {
  readonly http: StreamingHttp;
  readonly listing: McpListing;
  readonly clock: Clock;
  /** This build's release, which the client names itself with. */
  readonly version: string;
}

/** How long a connection, its handshake and its tool list may take (decision 0430). */
export const connectTimeoutMs = 10_000;
/** How long ending a session may take. */
const closeTimeoutMs = 2_000;
/** The most pages of `tools/list` a connection reads (decision 0429). */
const maxToolPages = 4;
// The SDK's own timers wait past binference's, so binference's deadline always answers first.
const sdkSlackMs = 5_000;
// The SDK compiles no schema: binference checks every listed schema itself.
const noSchemas: NonNullable<ClientOptions["jsonSchemaValidator"]> = {
  getValidator() {
    throw new Error("binference checks every listed schema itself");
  },
};

/**
 * The SDK's client options for a listing: no capability, no fulfilled input, no probe, only the
 * listing's revision, and a refusal of any request the server's capabilities do not offer, so the
 * SDK never answers in their place.
 */
export function clientOptionsOf(listing: Pick<McpListing, "revision">): ClientOptions {
  return {
    capabilities: {},
    enforceStrictCapabilities: true,
    supportedProtocolVersions: [listing.revision],
    jsonSchemaValidator: noSchemas,
    inputRequired: { autoFulfill: false },
    defaultCacheTtlMs: 0,
    versionNegotiation:
      listing.revision === "2026-07-28" ? { mode: { pin: "2026-07-28" } } : { mode: "legacy" },
  };
}

// The failures the fetch saw: the connection's own requests', and each call's by its tag, which a
// rejection of the SDK's then means.
interface FailureWatch {
  connection?: ListedFailure;
  readonly calls: Map<string, ListedFailure>;
}

function failureOf(seen: ListedFailure | undefined, deadline: AbortSignal): ConnectionFailure {
  if (seen === undefined) {
    return { reason: deadline.aborted ? "timed_out" : "bad_answer" };
  }
  if (seen.reason === "rate_limited") {
    const { retryAfterSeconds } = seen;
    return {
      reason: "rate_limited",
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    };
  }
  return { reason: seen.reason };
}

// A live tool's own word that it writes: the server's claim can turn a tool off, never on.
function saysItWrites(live: Tool): boolean {
  return live.annotations?.readOnlyHint === false || live.annotations?.destructiveHint === true;
}

// The digest of a live tool's definition, or none for one whose schemas are not plain JSON.
function liveDigest(live: Tool): string | undefined {
  const input = jsonValueSchema.safeParse(live.inputSchema);
  if (!input.success) {
    return undefined;
  }
  if (live.outputSchema === undefined) {
    return serverDigestOf({ name: live.name, inputSchema: input.data });
  }
  const output = jsonValueSchema.safeParse(live.outputSchema);
  return output.success
    ? serverDigestOf({ name: live.name, inputSchema: input.data, outputSchema: output.data })
    : undefined;
}

/**
 * Which of the listing's tools the live list turns off: one whose definition's digest differs from
 * its `serverDigest`, one the list lacks, one whose own annotations say it writes. A live tool the
 * listing does not name is never read.
 */
function toolsOff(listing: McpListing, live: readonly Tool[]): ReadonlyMap<string, ToolOffReason> {
  const byName = new Map(live.map((tool) => [tool.name, tool]));
  const off = new Map<string, ToolOffReason>();
  for (const tool of listing.tools) {
    const found = byName.get(tool.server);
    if (found === undefined) {
      off.set(tool.server, "missing");
    } else if (saysItWrites(found)) {
      off.set(tool.server, "writes");
    } else if (liveDigest(found) !== tool.serverDigest) {
      off.set(tool.server, "changed");
    }
  }
  return off;
}

// The live list, a page at a time by its cursor, at most 4 pages: a tool past them is missing.
async function liveTools(
  client: Client,
  request: RequestOptions,
  page: { readonly cursor?: string; readonly left: number },
): Promise<readonly Tool[]> {
  const params = page.cursor === undefined ? {} : { params: { cursor: page.cursor } };
  const listed = await client.request({ method: "tools/list", ...params }, request);
  const next = listed.nextCursor;
  if (next === undefined || page.left <= 1) {
    return listed.tools;
  }
  return [
    ...listed.tools,
    ...(await liveTools(client, request, { cursor: next, left: page.left - 1 })),
  ];
}

async function closeQuietly(
  client: Client,
  transport: StreamableHTTPClientTransport,
  clock: Clock,
): Promise<void> {
  const deadline = createDeadline({
    clock,
    signal: new AbortController().signal,
    timeoutMs: closeTimeoutMs,
  });
  const ending =
    transport.sessionId === undefined ? Promise.resolve() : transport.terminateSession();
  try {
    await Promise.race([
      ending,
      new Promise<void>((resolve) =>
        deadline.signal.addEventListener("abort", () => resolve(), { once: true }),
      ),
    ]);
  } catch {
    // A server that fails to end its session holds nothing binference wants.
  } finally {
    deadline.clear();
    await client.close().catch(() => undefined);
  }
}

const argumentsObject = z.record(z.string(), jsonValueSchema);

// The arguments as the SDK takes them: an object, which the listing's input schema made sure of.
function jsonArguments(args: JsonValue): Record<string, JsonValue> {
  const parsed = argumentsObject.safeParse(args);
  return parsed.success ? parsed.data : {};
}

function connectionOf(
  parts: ConnectionParts,
  open: {
    readonly client: Client;
    readonly transport: StreamableHTTPClientTransport;
    readonly watch: FailureWatch;
  },
  off: ReadonlyMap<string, ToolOffReason>,
): ListedConnection {
  const { client, transport, watch } = open;
  let calls = 0;
  return {
    off,
    async call(tool, args, signal) {
      calls += 1;
      const tag = String(calls);
      const { timeoutMs } = parts.listing;
      const deadline = createDeadline({ clock: parts.clock, signal, timeoutMs });
      try {
        const toolDefinition: Tool = {
          name: tool.server,
          inputSchema: { ...tool.input, type: "object" },
        };
        const result = await client.callTool(
          { name: tool.server, arguments: jsonArguments(args) },
          {
            signal: deadline.signal,
            timeout: timeoutMs + sdkSlackMs,
            toolDefinition,
            headers: { [listedCallHeader]: tag },
          },
        );
        return answerOf(result, tool);
      } catch {
        return failureOf(watch.calls.get(tag), deadline.signal);
      } finally {
        watch.calls.delete(tag);
        deadline.clear();
      }
    },
    close: async () => closeQuietly(client, transport, parts.clock),
  };
}

/**
 * Opens a connection to a listed server (decision 0430) over the official SDK's Streamable HTTP
 * client, its fetch the guarded one of {@link listingFetch}, with no capability advertised: the
 * handshake of the listing's revision and no other, then `tools/list` page by page, at most 4,
 * past any cache, all within 10 seconds, and each listed tool checked against the live list. A
 * server that offers no tools answers `bad_answer`. Answers why when it opens no connection.
 */
export async function openListedConnection(
  parts: ConnectionParts,
  signal: AbortSignal,
): Promise<ListedConnection | ConnectionFailure> {
  const watch: FailureWatch = { calls: new Map() };
  const fetch = listingFetch({
    http: parts.http,
    url: parts.listing.url,
    maxBytes: parts.listing.maxBytes,
    clock: parts.clock,
    deadlines: {
      connectMs: connectTimeoutMs,
      callMs: parts.listing.timeoutMs,
      closeMs: closeTimeoutMs,
    },
    onFailure: (failure, call) => {
      if (call === undefined) {
        watch.connection = failure;
      } else {
        watch.calls.set(call, failure);
      }
    },
  });
  const transport = new StreamableHTTPClientTransport(new URL(parts.listing.url), { fetch });
  const client = new Client(
    { name: "binference", version: parts.version },
    clientOptionsOf(parts.listing),
  );
  const deadline = createDeadline({ clock: parts.clock, signal, timeoutMs: connectTimeoutMs });
  const request = { signal: deadline.signal, timeout: connectTimeoutMs + sdkSlackMs };
  try {
    // The client offers the listing's revision alone, so a server that answers another fails here.
    await client.connect(transport, request);
    const live = await liveTools(client, request, { left: maxToolPages });
    return connectionOf(parts, { client, transport, watch }, toolsOff(parts.listing, live));
  } catch {
    const failure = failureOf(watch.connection, deadline.signal);
    await client.close().catch(() => undefined);
    return failure;
  } finally {
    deadline.clear();
  }
}
