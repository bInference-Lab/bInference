import { createFormatter } from "@binference/i18n";
import { type PluginReview, pluginReviewSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { pluginReviewLines } from "./plugin-review-lines.js";

const en = createFormatter({ locale: "en", timeZone: "UTC" });

// Sixteen hosts of 100 characters, the most a manifest may declare, each one its own.
const hosts = Array.from(
  { length: 16 },
  (_, n) => `h${String(n).padStart(2, "0")}${"a".repeat(57)}.${"b".repeat(36)}.io`,
);

const review: PluginReview = pluginReviewSchema.parse({
  plugin: "fear-index",
  version: "1.3.0",
  source: "npm:fear-index@1.3.0",
  hash: "a".repeat(64),
  publisher: "github.com/alice/fear-index",
  workflow: "github.com/bigorg/release/.github/workflows/npm.yml",
  provenance: "verified",
  kinds: ["data"],
  hosts,
  tools: ["index"],
  configKeys: Array.from({ length: 64 }, (_, n) => `key_${String(n)}`),
  digest: "b".repeat(64),
});

describe("the permission review's lines", () => {
  it("shows every host and setting it declares whole, one line each", () => {
    const lines = pluginReviewLines(en, review);

    expect(hosts.every((host) => host.length === 100)).toBe(true);
    for (const host of hosts) {
      expect(lines).toContain(`  ${host}`);
    }
    expect(lines).toContain("It may reach 16 hosts:");
    expect(lines).toContain("  key_63");
    expect(lines.join("\n")).not.toContain("…");
  });

  it("names the build workflow that lives in another repository", () => {
    expect(pluginReviewLines(en, review)).toContain(
      "Built by the workflow github.com/bigorg/release/.github/workflows/npm.yml",
    );
  });

  it("names each way an update differs from the installed version, and every entry it adds", () => {
    const widens = {
      from: "1.2.0",
      added: {
        kinds: [],
        hosts: ["a.example.com", "b.example.com"],
        tools: ["whales"],
        configKeys: [],
      },
      publisher: { from: "github.com/alice/fear-index", to: "github.com/mallory/fear-index" },
      lostProvenance: true as const,
      older: true as const,
    };
    const lines = pluginReviewLines(en, { ...review, widens });

    expect(lines.slice(0, 8)).toStrictEqual([
      "Update fear-index from 1.2.0 to 1.3.0? It needs your review again:",
      "The publisher changed from github.com/alice/fear-index to github.com/mallory/fear-index",
      "It has no npm provenance, which 1.2.0 had",
      "It is older than 1.2.0, the version installed",
      "3 new permissions:",
      "  a.example.com",
      "  b.example.com",
      "  whales",
    ]);
  });
});
