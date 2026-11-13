import { join } from "node:path";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { noPermissions } from "../e2e/test-host.js";
import { listedEntryFixture, listingIdFixture } from "./listing-fixtures.js";
import { type PluginLock, readPluginLock, writePluginLock } from "./plugin-lock.js";

let folder: TempFolder;

beforeAll(async () => {
  folder = await createTempFolder("plugin-lock-forms-");
});

afterAll(async () => {
  await folder.remove();
});

const signal = new AbortController().signal;
const { listing: _none, ...own } = listedEntryFixture();
const listed: PluginLock = {
  plugins: [
    listedEntryFixture({
      enabled: false,
      listing: { listing: listingIdFixture(3), version: 2, revoked: true },
    }),
  ],
  revocations: { sequence: 4, key: "a".repeat(32), digest: "b".repeat(64) },
};

// Writes `lock` to a file of its own and reads it back in each form.
async function readBack(name: string, lock: PluginLock) {
  const file = join(folder.path, `${name}.json`);
  await writePluginLock(file, lock, { permissions: noPermissions, signal });
  return {
    selfHosted: await readPluginLock(file, signal),
    listed: await readPluginLock(file, signal, "required"),
  };
}

describe("the plugin lock's form", () => {
  it("reads a lock with listings and a revocation floor only where listings are required", async () => {
    const read = await readBack("listed", listed);

    expect(read.selfHosted).toStrictEqual({ ok: false, error: "unreadable" });
    expect(read.listed).toStrictEqual({ ok: true, value: listed });
  });

  it("reads a self-hosted lock in both forms", async () => {
    const lock: PluginLock = { plugins: [own] };
    const read = await readBack("own", lock);

    expect(read.selfHosted).toStrictEqual({ ok: true, value: lock });
    expect(read.listed).toStrictEqual({ ok: true, value: lock });
  });
});
