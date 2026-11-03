import { describe, expect, it } from "vitest";
import { communityManifestSchema } from "./community-manifest.schema.js";
import { defineTools } from "./define-tools.js";

const manifest = {
  api: 1,
  id: "fear-index",
  kinds: ["data"],
  entry: "dist/index.mjs",
  hosts: ["api.example.com"],
  tools: [
    {
      name: "fear_index",
      description: "The market's fear and greed index today.",
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: { value: { type: "integer" } },
        required: ["value"],
        additionalProperties: false,
      },
    },
  ],
};

// A schema of arrays `depth` levels deep, below a top level of its own.
function nested(depth: number): object {
  return depth === 0 ? { type: "string" } : { type: "array", items: nested(depth - 1) };
}

describe("communityManifestSchema", () => {
  it("reads a manifest of a data plugin with one tool and one host", () => {
    expect(communityManifestSchema.parse(manifest)).toStrictEqual(manifest);
  });

  it.each([
    ["a transaction cap", { ...manifest, maxValueBase: "100000000000000000000" }],
    ["contracts", { ...manifest, contracts: [{ chain: "eip155:56", names: ["router"] }] }],
    ["calls", { ...manifest, calls: [{ contract: "router", maxValueBase: "1" }] }],
    ["a cap on a tool", { ...manifest, tools: [{ ...manifest.tools[0], maxValueBase: "1" }] }],
    ["a venue kind", { ...manifest, kinds: ["venue"] }],
    ["a provider kind", { ...manifest, kinds: ["provider"] }],
    ["a surface kind", { ...manifest, kinds: ["surface"] }],
    ["another API version", { ...manifest, api: 2 }],
  ])("refuses %s, which a community plugin never declares", (_name, declared) => {
    expect(communityManifestSchema.safeParse(declared).success).toBe(false);
  });

  it.each([
    ["an address", "203.0.113.7"],
    ["a wildcard", "*.example.com"],
    ["a name with a port", "api.example.com:8443"],
    ["a name without a dot", "localhost"],
    ["an uppercase name", "API.example.com"],
    ["a URL", "https://api.example.com"],
  ])("refuses %s as a host", (_name, host) => {
    expect(communityManifestSchema.safeParse({ ...manifest, hosts: [host] }).success).toBe(false);
  });

  it.each([
    "../engine.mjs",
    "/etc/passwd.js",
    "dist/../../x.mjs",
    "./dist/index.mjs",
    "dist\\x.js",
  ])("refuses the entry %s, which leaves the package or is not plain", (entry) => {
    expect(communityManifestSchema.safeParse({ ...manifest, entry }).success).toBe(false);
  });

  const withOutput = (output: object) => ({
    ...manifest,
    tools: [{ ...manifest.tools[0], output }],
  });

  it.each([
    ["a regex the engine would run for hours", { type: "string", pattern: "^(a+)+$" }],
    ["regex-named properties", { type: "object", patternProperties: { "^(a+)+$": {} } }],
    ["a format", { type: "string", format: "email" }],
    ["unique items, quadratic to check", { type: "array", uniqueItems: true }],
    ["a reference", { $ref: "#/$defs/x", $defs: { x: { type: "string" } } }],
    ["a regex deep inside", { type: "object", properties: { a: { anyOf: [{ pattern: "a" }] } } }],
    ["a schema nine levels deep", nested(8)],
    ["a schema over 16,384 characters", { type: "string", description: "x".repeat(16_400) }],
  ])("refuses an output schema with %s at load", (_name, output) => {
    expect(communityManifestSchema.safeParse(withOutput(output)).success).toBe(false);
  });

  it("reads an output schema of allowed keywords eight levels deep", () => {
    expect(communityManifestSchema.safeParse(withOutput(nested(7))).success).toBe(true);
  });

  it("refuses a tool input whose object allows fields it does not name", () => {
    const loose = { ...manifest.tools[0], input: { type: "object", properties: {} } };

    expect(communityManifestSchema.safeParse({ ...manifest, tools: [loose] }).success).toBe(false);
  });

  it("refuses repeated tool names and more than 16 hosts", () => {
    const tool = manifest.tools[0];
    const hosts = Array.from({ length: 17 }, (_, index) => `h${String(index)}.example.com`);

    expect(communityManifestSchema.safeParse({ ...manifest, tools: [tool, tool] }).success).toBe(
      false,
    );
    expect(communityManifestSchema.safeParse({ ...manifest, hosts }).success).toBe(false);
  });
});

describe("defineTools", () => {
  it("answers the tools frozen", () => {
    const tools = defineTools({ fear_index: async () => ({ value: 40 }) });

    expect(Object.isFrozen(tools)).toBe(true);
    expect(Object.keys(tools)).toStrictEqual(["fear_index"]);
  });

  it("refuses a name the manifest could not declare", () => {
    expect(() => defineTools({ "Fear-Index": async () => null })).toThrow(
      expect.objectContaining({ code: "plugin.bad_tools" }),
    );
  });
});
