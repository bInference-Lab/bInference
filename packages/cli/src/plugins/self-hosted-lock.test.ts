// oxlint-disable-next-line eslint/no-restricted-imports -- the test reads its recorded lock text
import { readFile } from "node:fs/promises";
import { createManualClock } from "@binference/core/testing";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import type { CommunityManifest } from "@binference/plugin-sdk/community";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemHttp, type SystemHttp } from "../runtime/system-http.js";
import { type FakeNpmRegistry, startFakeNpmRegistry } from "./fake-npm-registry.js";
import { readPluginSource } from "./fetch-plugin.js";
import { createInstallHarness, type InstallHarness } from "./install-harness.js";
import { installPlugin } from "./install-plugin.js";

let http: SystemHttp;
let registry: FakeNpmRegistry;
let folder: TempFolder;

beforeAll(async () => {
  http = createSystemHttp({ version: "test", route: { kind: "direct" } });
  registry = await startFakeNpmRegistry();
  folder = await createTempFolder("self-hosted-lock-");
});

afterAll(async () => {
  await registry.close();
  await http.close();
  await folder.remove();
});

const manifest: CommunityManifest = {
  api: 1,
  id: "echo-feed",
  kinds: ["data"],
  entry: "index.mjs",
  hosts: ["api.example.com"],
  tools: [
    {
      name: "echo",
      description: "Answers its text.",
      input: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      output: { type: "object" },
    },
  ],
};
const index = {
  path: "index.mjs",
  text: "export const tools = { echo: async (input) => input };\n",
};
const signal = new AbortController().signal;

// Adds a plugin as the owner does: the review first, then the add with its digest and its id.
async function addReviewed(harness: InstallHarness, source: string, hash: string): Promise<void> {
  const from = readPluginSource(source, hash);
  if (!from.ok) {
    throw new Error("Expected an npm source.");
  }
  const answers = { source, from: from.value };
  const review = await installPlugin(harness.parts, answers, signal);
  if (review.ok || review.failure.code !== "plugin.review_needed") {
    throw new Error("Expected the review first.");
  }
  const accepted = review.failure.review.digest;
  const done = await installPlugin(
    harness.parts,
    { ...answers, accepted, typedName: "echo-feed" },
    signal,
  );
  if (!done.ok) {
    throw new Error(`Expected the add, got ${done.failure.code}.`);
  }
}

describe("a self-hosted plugin install", () => {
  it("writes the plugin lock byte for byte as it did before plugin listings", async () => {
    const hash = registry.publish({
      name: "echo-feed",
      version: "1.0.0",
      files: [index],
      manifest,
    });
    const clock = createManualClock(1_767_261_610_000);
    const harness = createInstallHarness({
      registryBase: registry.base,
      http,
      folder: folder.path,
      clock,
    });
    // Recorded from the install of this package on the commit before plugin listings existed.
    const recorded = await readFile(
      new URL("recorded/self-hosted-lock.txt", import.meta.url),
      "utf8",
    );

    await addReviewed(harness, "npm:echo-feed@1.0.0", hash);

    await expect(harness.lockText(signal)).resolves.toBe(recorded.replace("{integrity}", hash));
  });
});
