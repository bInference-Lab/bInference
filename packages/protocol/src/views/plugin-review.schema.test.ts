import { describe, expect, it } from "vitest";
import { pluginReviewSchema } from "./plugin-review.schema.js";

const review = {
  plugin: "fear-index",
  version: "1.2.0",
  source: "npm:fear-index@1.2.0",
  hash: "a".repeat(64),
  publisher: "github.com/example/fear-index",
  provenance: "verified",
  kinds: ["data"],
  hosts: ["api.example.com"],
  tools: ["index"],
  configKeys: [],
  digest: "b".repeat(64),
};

describe("the plugin permission review", () => {
  it("reads a review and one that widens an installed version", () => {
    const widens = {
      from: "1.1.0",
      added: { kinds: [], hosts: ["x.example.com"], tools: [], configKeys: [] },
    };

    expect(pluginReviewSchema.parse(review)).toStrictEqual(review);
    expect(pluginReviewSchema.parse({ ...review, widens })).toStrictEqual({ ...review, widens });
  });

  it("reads an update from another publisher, without provenance and older", () => {
    const widens = {
      from: "1.3.0",
      added: { kinds: [], hosts: [], tools: [], configKeys: [] },
      publisher: { from: "github.com/alice/fear-index", to: "github.com/mallory/fear-index" },
      lostProvenance: true,
      older: true,
    };

    expect(pluginReviewSchema.parse({ ...review, widens })).toStrictEqual({ ...review, widens });
  });

  it.each([
    ["a host longer than a review shows", { hosts: [`${"a".repeat(98)}.io`] }],
    ["a config key longer than a review shows", { configKeys: ["k".repeat(65)] }],
    ["a hash that is not 64 hex digits", { hash: "sha256:abc" }],
    ["a provenance it does not know", { provenance: "signed" }],
    ["a digest in upper case", { digest: "B".repeat(64) }],
  ] as const)("refuses %s", (_case, change) => {
    expect(pluginReviewSchema.safeParse({ ...review, ...change }).success).toBe(false);
  });

  it("refuses more hosts than a manifest may declare", () => {
    const hosts = Array.from({ length: 17 }, (_, n) => `h${String(n)}.io`);

    expect(pluginReviewSchema.safeParse({ ...review, hosts }).success).toBe(false);
  });
});
