import type { JsonSchemaNode } from "@binference/core";
import { describe, expect, it } from "vitest";
import {
  fixtureListedTool,
  largeListedServer,
  listedServerFixture,
  listingFixture,
} from "../testing/listing-fixture.js";
import { nthTestId } from "../testing/memory-agent-stores.js";
import {
  jsonBytesOf,
  type ListedMcpServer,
  type ListedMcpTool,
  listedMcpServersSchema,
  listedToolName,
  listingLimits,
  listingRefusal,
  type McpListing,
} from "./listing.schema.js";

const agent = nthTestId("agt", 1);

function refusalOf(changes: Partial<McpListing>): string | undefined {
  return listingRefusal(listedServerFixture([agent], changes));
}

function withTool(changes: Partial<ListedMcpTool>): Partial<McpListing> {
  return { tools: [{ ...fixtureListedTool, ...changes }] };
}

function withInput(input: JsonSchemaNode): Partial<McpListing> {
  return withTool({ input });
}

const boundedString = { type: "string", maxLength: 10 };

describe("listingRefusal", () => {
  it("takes the fixture listing", () => {
    expect(refusalOf({})).toBeUndefined();
  });

  it.each(["quote", "Token.Info", "swap", "send", "token-info", "tx/status", "Order_Create"])(
    "refuses a whole listing whose server tool %s folds to a built-in tool's name",
    (server) => {
      expect(refusalOf(withTool({ server }))).toBe("name_taken");
    },
  );

  it.each(["portfolio", "bridge", "settings_change"])(
    "refuses a whole listing that names a tool %s as a built-in tool",
    (as) => {
      expect(refusalOf(withTool({ as }))).toBe("name_taken");
    },
  );

  it("refuses a tool of any kind but read", () => {
    expect(
      listingRefusal({
        ...listedServerFixture([agent]),
        listing: { ...listingFixture(), tools: [{ ...fixtureListedTool, kind: "propose" }] },
      }),
    ).toBe("shape");
  });

  it.each([
    "http://rates.example.com/mcp",
    "https://203.0.113.7/mcp",
    "https://user:secret@rates.example.com/mcp",
    "https://rates.example.com/mcp#tools",
    "https://rates.example.com:8443/mcp",
    "https://localhost/mcp",
    "https://rates.local/mcp",
    "https://RATES.example.com/mcp",
  ])("refuses the endpoint %s", (url) => {
    expect(refusalOf({ url })).toBe("url");
  });

  it.each<readonly [string, JsonSchemaNode]>([
    [
      "a string without maxLength",
      { type: "object", properties: { s: { type: "string" } }, additionalProperties: false },
    ],
    [
      "a string over 1,000",
      {
        type: "object",
        properties: { s: { type: "string", maxLength: 1_001 } },
        additionalProperties: false,
      },
    ],
    ["an open object", { type: "object", properties: { s: boundedString } }],
    [
      "an open nested object",
      { type: "object", properties: { o: { type: "object" } }, additionalProperties: false },
    ],
    [
      "an array without maxItems",
      {
        type: "object",
        properties: { a: { type: "array", items: boundedString } },
        additionalProperties: false,
      },
    ],
    [
      "an array over 100",
      {
        type: "object",
        properties: { a: { type: "array", items: boundedString, maxItems: 101 } },
        additionalProperties: false,
      },
    ],
    ["a node with no type", { type: "object", properties: { x: {} }, additionalProperties: false }],
    ["a root that is not an object", { type: "string", maxLength: 10 }],
  ])("refuses an input with %s", (_name, input) => {
    expect(refusalOf(withInput(input))).toBe("bounds");
  });

  it("takes an input bounded by enums, consts and combinators", () => {
    const input: JsonSchemaNode = {
      type: "object",
      properties: {
        side: { enum: ["buy", "sell"] },
        chain: { const: "bsc" },
        id: { anyOf: [boundedString, { type: "integer" }] },
        tags: { type: "array", items: boundedString, maxItems: 5 },
      },
      additionalProperties: false,
    };
    expect(refusalOf(withInput(input))).toBeUndefined();
  });

  it.each([
    [
      "pattern",
      {
        type: "object",
        properties: { s: { ...boundedString, pattern: "^(a+)+$" } },
        additionalProperties: false,
      },
    ],
    [
      "format",
      {
        type: "object",
        properties: { s: { ...boundedString, format: "email" } },
        additionalProperties: false,
      },
    ],
    ["$ref", { type: "object", properties: { s: { $ref: "#/x" } }, additionalProperties: false }],
  ])("refuses a schema with %s", (_keyword, input) => {
    expect(refusalOf(withInput(input))).toBe("schema");
  });

  it("takes $schema as a note", () => {
    const input = {
      ...fixtureListedTool.input,
      $schema: "http://json-schema.org/draft-07/schema#",
    };
    expect(refusalOf(withInput(input))).toBeUndefined();
  });

  it.each<readonly [string, Partial<McpListing>]>([
    [
      "9 tools",
      {
        tools: Array.from({ length: 9 }, (_, n) => ({
          ...fixtureListedTool,
          server: `t${String(n)}`,
          as: `t${String(n)}`,
        })),
      },
    ],
    ["no tool", { tools: [] }],
    ["a 17-character name", { name: "a".repeat(17) }],
    ["a name with a hyphen", { name: "rates-demo" }],
    ["a 41-character title", { title: "a".repeat(41) }],
    ["a title with an invisible character", { title: "Rates​Demo" }],
    ["a call time over 20 s", { timeoutMs: 20_001 }],
    ["a call time under 1 s", { timeoutMs: 999 }],
    ["an answer cap over 1 MiB", { maxBytes: 1_048_577 }],
    ["an answer cap under 4 KiB", { maxBytes: 4_095 }],
    ["a revision not listed", { revision: "2024-11-05" as McpListing["revision"] }],
    ["a version of 0", { version: 0 }],
    ["a 41-character tool name", withTool({ as: "a".repeat(41) })],
    ["a description over 1,000", withTool({ description: "x".repeat(1_001) })],
    ["a digest that is not hex", withTool({ serverDigest: "z".repeat(64) })],
  ])("refuses a listing with %s", (_name, changes) => {
    expect(refusalOf(changes)).toBeDefined();
  });

  it("refuses a listing naming one tool twice", () => {
    expect(
      refusalOf({ tools: [fixtureListedTool, { ...fixtureListedTool, server: "other" }] }),
    ).toBe("repeated");
  });

  it("refuses a listing that names one agent twice", () => {
    expect(listingRefusal(listedServerFixture([agent, agent]))).toBe("bounds");
  });

  it("refuses a listing past 64 KiB as JSON, as one at every tool's maximum is", () => {
    const largest = largeListedServer([agent], 1, { tools: 8, chars: 16_000 });
    expect(jsonBytesOf(largest)).toBeGreaterThan(listingLimits.listingBytes);
    expect(listingRefusal(largest)).toBe("bounds");
  });
});

function named(name: string): ListedMcpServer {
  return listedServerFixture([agent], { name, listing: nthTestId("mls", name.length) });
}

describe("listedMcpServersSchema", () => {
  it("refuses two listings of one name", () => {
    expect(listedMcpServersSchema.safeParse([named("ratesdemo"), named("ratesdemo")]).success).toBe(
      false,
    );
  });

  it("refuses a fifth listing on for one agent", () => {
    const four = ["aa", "bbb", "cccc", "ddddd"].map((name) => named(name));
    expect(listedMcpServersSchema.safeParse(four).success).toBe(true);
    expect(listedMcpServersSchema.safeParse([...four, named("eeeeee")]).success).toBe(false);
  });

  it("refuses more than 64 listings in force", () => {
    const many = Array.from({ length: 65 }, (_, n) =>
      listedServerFixture([nthTestId("agt", n + 1)], {
        name: `l${String(n)}`,
        listing: nthTestId("mls", n + 1),
      }),
    );
    expect(listedMcpServersSchema.safeParse(many).success).toBe(false);
  });

  it("refuses a listing on for no agent", () => {
    expect(listedMcpServersSchema.safeParse([listedServerFixture([])]).success).toBe(false);
  });

  it("refuses listings each within 64 KiB that pass 512 KiB as JSON together", () => {
    const large = Array.from({ length: 9 }, (_, n) =>
      largeListedServer([nthTestId("agt", n + 1)], n + 1, { tools: 8, chars: 3_000 }),
    );
    expect(large.every((server) => listingRefusal(server) === undefined)).toBe(true);
    expect(jsonBytesOf(large)).toBeGreaterThan(listingLimits.setBytes);
    expect(listedMcpServersSchema.safeParse(large).success).toBe(false);
    expect(listedMcpServersSchema.safeParse(large.slice(0, 8)).success).toBe(true);
  });
});

describe("listedToolName", () => {
  it("names a listed tool mcp-<name>-<as>, a name with a hyphen no other tool holds", () => {
    expect(listedToolName(listingFixture(), fixtureListedTool)).toBe("mcp-ratesdemo-rate");
  });

  it("fits every model provider's name rule at the longest", () => {
    const name = listedToolName({ name: "a".repeat(16) }, { as: "b".repeat(40) });
    expect(name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });
});
