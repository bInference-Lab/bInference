import { idSchema } from "@binference/core";
import { createMemoryLogger } from "@binference/core/testing";
import { testAgent } from "@binference/engine/testing";
import {
  engineLineSchema,
  jsonBytesOf,
  type ListedMcpServer,
  listingLimits,
} from "@binference/runtime";
import {
  createFakeListedMcpSource,
  fixtureStartLine,
  largeListedServer,
  listedServerFixture,
  startInProcessRuntime,
  textReply,
} from "@binference/runtime/testing";
import { describe, expect, it, vi } from "vitest";
import { composeListedMcp, listingsInForce } from "./listed-mcp-offer.js";

const other = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000b2");
const agentOf = (n: number) =>
  idSchema("agt").parse(`agt_0190f1c2-3a4b-7c5d-8e6f-${n.toString(16).padStart(12, "0")}`);

function listing(name: string, n: number, agents = [testAgent]): ListedMcpServer {
  const id = idSchema("mls").parse(
    `mls_0190f1c2-3a4b-7c5d-8e6f-${n.toString(16).padStart(12, "0")}`,
  );
  return listedServerFixture(agents, { name, listing: id });
}

const logger = () => createMemoryLogger({ subsystem: "runtime" });

// Hands a runtime of its own the settings with the listings, then runs a turn: a runtime that
// refused the settings line would have ended.
async function runtimeRunsWith(servers: readonly ListedMcpServer[]): Promise<string | undefined> {
  const runtime = startInProcessRuntime({ replies: [textReply("Fine.")] });
  const start = fixtureStartLine();
  await runtime.write(`${JSON.stringify(engineLineSchema.encode(start))}\n`);
  const settings = { ...start.settings, listedMcp: servers };
  await runtime.write(`${JSON.stringify(engineLineSchema.encode({ t: "settings", settings }))}\n`);
  const posted = runtime.engine.post(agentOf(1), "hi");
  const ended = await runtime.engine.waitForPush(
    (push) => push.kind === "chat/turnEnded" && push.turn === posted.turn,
  );
  runtime.kill();
  return ended.detail;
}

describe("listingsInForce", () => {
  it("leaves out a listing the schema refuses, and logs its id and reason only", () => {
    const log = logger();
    const bad = listedServerFixture([testAgent], {
      url: "http://rates.example.com/mcp",
      name: "plain",
    });
    const good = listing("ratesdemo", 2);

    expect(listingsInForce([bad, good], log)).toStrictEqual([good]);
    expect(log.records()).toStrictEqual([
      expect.objectContaining({
        event: "runtime.listing_refused",
        fields: { listing: bad.listing.listing, reason: "url" },
      }),
    ]);
  });

  it("keeps a name once, at most 4 listings for an agent, and logs the rest", () => {
    const log = logger();
    const four = ["aa", "bb", "cc", "dd"].map((name, n) => listing(name, n + 1));
    const repeated = listing("aa", 9, [other]);
    const fifth = listing("ee", 10);

    expect(listingsInForce([...four, repeated, fifth], log)).toStrictEqual(four);
    expect(log.records().map(({ fields }) => fields)).toStrictEqual([
      { listing: repeated.listing.listing, reason: "repeated" },
      { listing: fifth.listing.listing, reason: "bounds" },
    ]);
  });

  it("leaves out a listing that names one agent twice, and the runtime takes the rest", async () => {
    const log = logger();
    const a = agentOf(1);
    const set = [listing("aa", 1, [a, a]), listing("bb", 2, [a, a]), listing("cc", 3, [a])];

    const kept = listingsInForce(set, log);

    expect(kept).toStrictEqual([set[2]]);
    expect(log.records().map(({ fields }) => fields.reason)).toStrictEqual(["bounds", "bounds"]);
    await expect(runtimeRunsWith(kept)).resolves.toBe("ok");
  });

  it("holds the set to 512 KiB in listing id order, and the runtime takes it", async () => {
    const log = logger();
    const largest = largeListedServer([agentOf(1)], 20, { tools: 8, chars: 16_000 });
    const large = Array.from({ length: 9 }, (_, n) =>
      largeListedServer([agentOf(n + 1)], 9 - n, { tools: 8, chars: 3_000 }),
    );

    const kept = listingsInForce([largest, ...large], log);

    expect(kept).toStrictEqual(large.slice(1));
    expect(jsonBytesOf(kept)).toBeLessThanOrEqual(listingLimits.setBytes);
    expect(log.records().map(({ fields }) => fields)).toStrictEqual([
      { listing: largest.listing.listing, reason: "bounds" },
      { listing: large[0]?.listing.listing, reason: "bounds" },
    ]);
    await expect(runtimeRunsWith(kept)).resolves.toBe("ok");
  });
});

describe("composeListedMcp", () => {
  it("turns an agent on before the runtime is handed its listing, and off only once it took none", async () => {
    const listedMcp = createFakeListedMcpSource([listing("ratesdemo", 1)]);
    const step = composeListedMcp({ listedMcp }, logger());
    const during: (boolean | undefined)[] = [];
    const handed: (readonly ListedMcpServer[])[] = [];

    await step.begin({
      offerListedMcp: async (servers) => {
        during.push(step.listedMcpOn?.(testAgent));
        handed.push(servers);
        return Promise.resolve();
      },
    });
    expect(step.listedMcpOn?.(testAgent)).toBe(true);
    listedMcp.set([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(during).toStrictEqual([true, true]);
    expect(handed).toStrictEqual([[listing("ratesdemo", 1)], []]);
    expect(step.listedMcpOn?.(testAgent)).toBe(false);
  });

  it("keeps one agent on and another off by their own listings", async () => {
    const listedMcp = createFakeListedMcpSource([listing("ratesdemo", 1, [other])]);
    const step = composeListedMcp({ listedMcp }, logger());
    await step.begin({ offerListedMcp: async () => Promise.resolve() });
    expect([step.listedMcpOn?.(testAgent), step.listedMcpOn?.(other)]).toStrictEqual([false, true]);
  });

  it("stops following the source", async () => {
    const listedMcp = createFakeListedMcpSource([]);
    const step = composeListedMcp({ listedMcp }, logger());
    const handed: (readonly ListedMcpServer[])[] = [];
    await step.begin({
      offerListedMcp: async (servers) => {
        handed.push(servers);
        return Promise.resolve();
      },
    });
    step.stop();
    listedMcp.set([listing("ratesdemo", 1)]);
    await vi.advanceTimersByTimeAsync(1);
    expect(handed).toStrictEqual([[]]);
  });

  it("gives a root with no catalog no switch, and hands its runtime nothing", async () => {
    const step = composeListedMcp({}, logger());
    const handed: (readonly ListedMcpServer[])[] = [];
    await step.begin({
      offerListedMcp: async (servers) => {
        handed.push(servers);
        return Promise.resolve();
      },
    });
    expect(step.listedMcpOn).toBeUndefined();
    expect(handed).toStrictEqual([]);
  });
});
