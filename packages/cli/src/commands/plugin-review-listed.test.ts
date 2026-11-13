import { createFormatter } from "@binference/i18n";
import { type PluginReview, pluginReviewSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { pluginReviewLines } from "./plugin-review-lines.js";

const en = createFormatter({ locale: "en", timeZone: "UTC" });

const review: PluginReview = pluginReviewSchema.parse({
  plugin: "echo-feed",
  version: "1.0.0",
  source: "npm:echo-feed@1.0.0",
  hash: "a".repeat(64),
  publisher: "fake-publisher",
  provenance: "none",
  kinds: ["data"],
  hosts: ["api.example.com"],
  tools: ["echo"],
  configKeys: [],
  digest: "b".repeat(64),
});
const listed = { listing: "pls_0190f1c2-3a4b-7c5d-8e6f-000000000001", version: 2 };

describe("the permission review of a listed plugin", () => {
  it("says under its title that bInference reviewed and listed it", () => {
    const lines = pluginReviewLines(en, pluginReviewSchema.parse({ ...review, listing: listed }));

    expect(lines.slice(0, 2)).toStrictEqual([
      "Add echo-feed 1.0.0 from npm:echo-feed@1.0.0?",
      "Reviewed and listed by bInference",
    ]);
  });

  it("says nothing of a listing for a plugin that has none", () => {
    expect(pluginReviewLines(en, review)).not.toContain("Reviewed and listed by bInference");
  });
});
