import { join } from "node:path";
import { createFormatter } from "@binference/i18n";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type FakeNpmRegistry, startFakeNpmRegistry } from "../plugins/fake-npm-registry.js";
import { createSystemHttp, type SystemHttp } from "../runtime/system-http.js";
import { cloudPluginOperations, cloudRefusals, publishedVersion } from "./listed-plugin-harness.js";

let http: SystemHttp;
let registry: FakeNpmRegistry;
let folder: TempFolder;

beforeAll(async () => {
  http = createSystemHttp({ version: "test", route: { kind: "direct" } });
  registry = await startFakeNpmRegistry();
  folder = await createTempFolder("listed-operations-");
});

afterAll(async () => {
  await registry.close();
  await http.close();
  await folder.remove();
});

const english = createFormatter({ locale: "en", timeZone: "UTC" });
const wordsOf = (code: string): string => english.message(`error.${code}`);

describe("plugin installs on the Cloud composition", () => {
  it("refuses no listing, another hash, another key and a revoked listing, each with its words", async () => {
    const refused = await cloudRefusals({ registry, http, folder: join(folder.path, "refusals") });

    expect(refused.unlisted.code).toBe("plugin.not_listed");
    expect(refused.otherHash).toMatchObject({
      code: "plugin.listing_mismatch",
      retryable: false,
      details: { field: "integrity" },
    });
    expect(refused.otherKey.code).toBe("plugin.listing_unverified");
    expect(refused.revoked.code).toBe("plugin.listing_revoked");
    expect(wordsOf(refused.unlisted.code)).toBe(
      "bInference has not reviewed and listed this version of the plugin, so bInference Cloud cannot add it or turn it on. Add a version bInference lists.",
    );
    expect(wordsOf(refused.otherHash.code)).toBe(
      "This plugin is not the package bInference reviewed: it differs from its listing, so nothing changed. Remove the plugin if it is installed, then add it again; if it happens again, tell bInference.",
    );
    expect(wordsOf(refused.otherKey.code)).toBe(
      "This plugin's listing does not carry a valid signature from bInference, so nothing changed. Try again in a few minutes; if it happens again, tell bInference.",
    );
    expect(wordsOf(refused.revoked.code)).toBe(
      "bInference revoked the listing of this plugin version, so it cannot be added or turned on. Remove it, or add a version bInference lists.",
    );
  });

  it("answers a catalog it cannot read as retryable, naming why", async () => {
    const ops = cloudPluginOperations({ registry, http, folder: join(folder.path, "down") });
    ops.root.pluginListing.catalog.goDown("refuse");
    const error = await ops.add(publishedVersion(registry, "3.1.0"));

    expect(error).toMatchObject({
      code: "plugin.listings_unreachable",
      retryable: true,
      details: { reason: "unreachable" },
    });
    expect(wordsOf(error.code)).toBe(
      "binference cannot check bInference's plugin listings right now, so nothing changed. Try again in a few minutes.",
    );
  });
});
