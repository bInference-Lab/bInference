import type { JsonValue } from "@binference/core";
import { createManualClock, type ManualClock } from "@binference/core/testing";
import { describe, expect, it, vi } from "vitest";
import {
  fixtureListedTool,
  fixtureServerTool,
  listedServerFixture,
  listingFixture,
} from "../testing/listing-fixture.js";
import { nthTestId } from "../testing/memory-agent-stores.js";
import {
  createScriptedMcpServer,
  type McpServerScript,
  type ScriptedHttpAnswer,
  type ScriptedMcpServer,
} from "../testing/scripted-mcp-server.js";
import { createListedMcpClients, type ListedMcpClients } from "./listed-mcp-clients.js";
import { idleCloseMs, type ListedCallOutcome } from "./listed-mcp-entry.js";
import type { ListedMcpServer, ListedMcpTool } from "./listing.schema.js";
import { serverDigestOf } from "./server-digest.js";

const agent = nthTestId("agt", 1);
const other = nthTestId("agt", 2);
const listing = listingFixture().listing;
const live = (): AbortSignal => new AbortController().signal;

const volumeServer = {
  name: "get_volume",
  inputSchema: { type: "object", properties: { symbol: { type: "string" } } },
};
const volumeTool: ListedMcpTool = {
  server: "get_volume",
  as: "volume",
  kind: "read",
  description: "A token's volume today.",
  input: {
    type: "object",
    properties: { symbol: { type: "string", maxLength: 12 } },
    additionalProperties: false,
  },
  serverDigest: serverDigestOf(volumeServer),
};

const liveTools: readonly JsonValue[] = [
  {
    name: fixtureServerTool.name,
    description: "The rate.",
    inputSchema: fixtureServerTool.inputSchema,
    outputSchema: fixtureServerTool.outputSchema ?? null,
  },
  { ...volumeServer, description: "The volume." },
];

const changedTools: readonly JsonValue[] = [
  {
    name: fixtureServerTool.name,
    description: "The rate.",
    inputSchema: { type: "object" },
    outputSchema: fixtureServerTool.outputSchema ?? null,
  },
  { ...volumeServer, description: "The volume." },
];

const answers = (name: string): JsonValue =>
  name === "get_rate"
    ? { content: [], structuredContent: { rate: 2 } }
    : { content: [{ type: "text", text: "volume 9" }] };

interface Rig {
  readonly clients: ListedMcpClients;
  readonly server: ScriptedMcpServer;
  readonly clock: ManualClock;
}

function rigOf(
  script: McpServerScript = {},
  servers: readonly ListedMcpServer[] = [
    listedServerFixture([agent, other], { tools: [fixtureListedTool, volumeTool] }),
  ],
): Rig {
  const server = createScriptedMcpServer({ tools: liveTools, call: answers, ...script });
  const clock = createManualClock();
  const clients = createListedMcpClients({ http: server, clock, version: "1" });
  clients.use(servers);
  return { clients, server, clock };
}

const rateCall = { agent, listing, version: 1, tool: "rate", args: { symbol: "BNB" } } as const;
const down = { status: 503 };

// A 503 for the call that names SLOW; the server's own answer for any other.
function failSlow(args: JsonValue): ScriptedHttpAnswer | undefined {
  return JSON.stringify(args).includes("SLOW") ? down : undefined;
}

describe("createListedMcpClients", () => {
  it("opens one connection per agent and listing, and reuses it", async () => {
    const { clients, server } = rigOf();

    expect(await clients.call(rateCall, live())).toEqual({
      kind: "answer",
      text: '{"rate":2}',
      isError: false,
    });
    expect(await clients.call({ ...rateCall, tool: "volume" }, live())).toEqual({
      kind: "answer",
      text: "volume 9",
      isError: false,
    });

    expect(server.methods().filter((method) => method === "initialize")).toHaveLength(1);
  });

  it("turns off a changed tool without a request, keeps its sibling, and turns it on at a new version", async () => {
    const { clients, server } = rigOf({ tools: changedTools });

    expect(await clients.call(rateCall, live())).toEqual({
      kind: "failed",
      reason: "tool_off",
      off: "changed",
    });
    const calls = server.methods().length;
    expect(await clients.call(rateCall, live())).toEqual({
      kind: "failed",
      reason: "tool_off",
      off: "changed",
    });
    expect(server.methods()).toHaveLength(calls);
    expect(await clients.call({ ...rateCall, tool: "volume" }, live())).toMatchObject({
      kind: "answer",
    });

    clients.use([
      listedServerFixture([agent], { version: 2, tools: [fixtureListedTool, volumeTool] }),
    ]);
    expect(await clients.call({ ...rateCall, version: 2 }, live())).toEqual({
      kind: "failed",
      reason: "tool_off",
      off: "changed",
    });
    expect(server.methods().filter((method) => method === "initialize")).toHaveLength(2);
  });

  it("keeps a tool off for another agent of the same listing only once its own list said so", async () => {
    const { clients } = rigOf({ tools: changedTools });
    await clients.call(rateCall, live());
    expect(clients.states()).toEqual([
      { agent, listing, state: "off", reason: "changed", tool: "rate" },
    ]);
  });

  it.each([
    [
      "a recovery phrase",
      "abandon ability able about above absent absorb abstract absurd abuse access accident",
    ],
    ["a private key block", "-----BEGIN EC PRIVATE KEY-----"],
    ["a client token", "bnt_0123456789abcdefghij"],
    ["a bot token", "123456789:AAEhBP0av28Zk6sD3J1JpBXeYI0Ai5ZkSd0"],
  ])("refuses arguments with %s and sends nothing", async (_name, symbol) => {
    const { clients, server } = rigOf();
    expect(await clients.call({ ...rateCall, args: { symbol } }, live())).toEqual({
      kind: "failed",
      reason: "refused",
    });
    expect(server.requests).toHaveLength(0);
  });

  it("sends a transaction hash, which looks like a key but is not one", async () => {
    const { clients, server } = rigOf();
    const hash = `0x${"ab".repeat(32)}`;
    await clients.call({ ...rateCall, args: { symbol: hash } }, live());
    expect(server.requests.some((request) => request.body?.includes(hash) === true)).toBe(true);
  });

  it("refuses arguments over 8 KiB and sends nothing", async () => {
    const { clients, server } = rigOf();
    expect(
      await clients.call({ ...rateCall, args: { symbol: "x".repeat(8_200) } }, live()),
    ).toEqual({
      kind: "failed",
      reason: "refused",
    });
    expect(server.requests).toHaveLength(0);
  });

  it("rests a listing after three failures in a row, doubling, and a good answer ends it", async () => {
    const raw: Record<string, ScriptedHttpAnswer> = { initialize: down };
    const { clients, clock, server } = rigOf({ raw });
    const unreachable = { kind: "failed", reason: "unreachable" };
    expect(await clients.call(rateCall, live())).toEqual(unreachable);
    expect(await clients.call(rateCall, live())).toEqual(unreachable);
    expect(await clients.call(rateCall, live())).toEqual(unreachable);
    const sent = server.requests.length;
    expect(await clients.call(rateCall, live())).toEqual({
      kind: "failed",
      reason: "resting",
      seconds: 30,
    });
    expect(server.requests).toHaveLength(sent);
    expect(clients.states()).toEqual([{ agent, listing, state: "resting", reason: "unreachable" }]);

    await clock.advance(30_000);
    expect(await clients.call(rateCall, live())).toEqual(unreachable);
    expect(await clients.call(rateCall, live())).toEqual({
      kind: "failed",
      reason: "resting",
      seconds: 60,
    });

    await clock.advance(60_000);
    delete raw["initialize"];
    expect(await clients.call(rateCall, live())).toMatchObject({ kind: "answer" });
    expect(clients.states()).toEqual([]);
  });

  it.each<readonly [string, Readonly<Record<string, string>>, number]>([
    ["its Retry-After", { "retry-after": "5" }, 5],
    ["at most 10 minutes", { "retry-after": "9999" }, 600],
    ["30 seconds without one", {}, 30],
  ])("rests a listing a 429 answered for %s", async (_name, headers, seconds) => {
    const { clients } = rigOf({ raw: { initialize: { status: 429, headers } } });
    expect(await clients.call(rateCall, live())).toEqual({
      kind: "failed",
      reason: "rate_limited",
    });
    expect(await clients.call(rateCall, live())).toEqual({
      kind: "failed",
      reason: "resting",
      seconds,
    });
  });

  it("never counts arguments it refused toward a rest", async () => {
    const { clients } = rigOf();
    const secret = { ...rateCall, args: { symbol: "bnt_0123456789abcdefghij" } };
    await Promise.all([1, 2, 3, 4].map(async () => clients.call(secret, live())));
    expect(await clients.call(rateCall, live())).toMatchObject({ kind: "answer" });
  });

  it("runs four calls of an agent to a listing at once, answers a fifth busy, and counts agents apart", async () => {
    const { clients } = rigOf();
    const running = [1, 2, 3, 4].map(async () => clients.call(rateCall, live()));

    const fifth = clients.call(rateCall, live());
    const theirs = clients.call({ ...rateCall, agent: other }, live());

    expect(await fifth).toEqual({ kind: "failed", reason: "busy" });
    expect(await theirs).toMatchObject({ kind: "answer" });
    expect(await Promise.all(running)).toEqual(
      [1, 2, 3, 4].map(() => ({ kind: "answer", text: '{"rate":2}', isError: false })),
    );
  });

  it("answers revoked from the next call once the settings leave a listing out, and ends its session", async () => {
    const { clients, server } = rigOf({ sessionId: "s-1" });
    await clients.call(rateCall, live());

    clients.use([]);
    await vi.runOnlyPendingTimersAsync();

    expect(await clients.call(rateCall, live())).toEqual({ kind: "failed", reason: "revoked" });
    expect(server.requests.at(-1)?.method).toBe("DELETE");
  });

  it("answers revoked for an agent whose owner turned the listing off, while another keeps it", async () => {
    const { clients } = rigOf();
    clients.use([listedServerFixture([other], { tools: [fixtureListedTool, volumeTool] })]);

    expect(await clients.call(rateCall, live())).toEqual({ kind: "failed", reason: "revoked" });
    expect(await clients.call({ ...rateCall, agent: other }, live())).toMatchObject({
      kind: "answer",
    });
  });

  it("ends a session after 5 minutes without a call, and opens a new one at the next", async () => {
    const { clients, clock, server } = rigOf({ sessionId: "s-1" });
    await clients.call(rateCall, live());

    await clock.advance(idleCloseMs);
    await vi.runOnlyPendingTimersAsync();
    expect(server.requests.at(-1)?.method).toBe("DELETE");

    await clients.call(rateCall, live());
    expect(server.methods().filter((method) => method === "initialize")).toHaveLength(2);
  });

  it("answers listing_changed for a call from a turn on an older version, and sends nothing", async () => {
    const { clients, server } = rigOf();
    clients.use([
      listedServerFixture([agent], { version: 2, tools: [fixtureListedTool, volumeTool] }),
    ]);
    expect(await clients.call(rateCall, live())).toEqual({
      kind: "failed",
      reason: "listing_changed",
    });
    expect(server.requests).toHaveLength(0);
    expect(await clients.call({ ...rateCall, version: 2 }, live())).toMatchObject({
      kind: "answer",
    });
  });

  it("counts one failure for the calls that shared one failed connection", async () => {
    const { clients } = rigOf({ raw: { initialize: down } });
    const shared = await Promise.all([1, 2, 3, 4].map(async () => clients.call(rateCall, live())));
    expect(shared).toEqual([1, 2, 3, 4].map(() => ({ kind: "failed", reason: "unreachable" })));
    expect(clients.states()).toEqual([]);
    await clients.call(rateCall, live());
    await clients.call(rateCall, live());
    expect(clients.states()).toEqual([{ agent, listing, state: "resting", reason: "unreachable" }]);
  });

  it("counts nothing for a call its own signal ended", async () => {
    const stall = { status: 200, headers: { "content-type": "application/json" }, hang: true };
    const { clients } = rigOf({ raw: { "tools/call": stall } });
    const stopped = async (): Promise<ListedCallOutcome> => {
      const stop = new AbortController();
      const call = clients.call(rateCall, stop.signal);
      await vi.advanceTimersByTimeAsync(1);
      stop.abort();
      return call;
    };
    const outcomes = [await stopped(), await stopped(), await stopped()];
    expect(outcomes).toEqual([1, 2, 3].map(() => ({ kind: "failed", reason: "timed_out" })));
    expect(clients.states()).toEqual([]);
  });

  it("lets a failed call's connection go without ending a call in flight on it", async () => {
    const { clients, server } = rigOf({ rawCall: failSlow });
    const both = Promise.all([
      clients.call({ ...rateCall, args: { symbol: "SLOW" } }, live()),
      clients.call(rateCall, live()),
    ]);
    expect(await both).toEqual([
      { kind: "failed", reason: "unreachable" },
      { kind: "answer", text: '{"rate":2}', isError: false },
    ]);
    expect(server.methods().filter((method) => method === "initialize")).toHaveLength(1);
  });

  it("closes every connection as the runtime stops", async () => {
    const { clients, server } = rigOf({ sessionId: "s-1" });
    await clients.call(rateCall, live());
    await clients.close();
    expect(server.requests.at(-1)?.method).toBe("DELETE");
  });
});
