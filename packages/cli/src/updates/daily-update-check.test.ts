import { createMemoryLogger } from "@binference/core/testing";
import type { EnginePush } from "@binference/engine";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { noPermissions } from "../e2e/test-host.js";
import { readAnnouncedUpdate } from "./announced-update.js";
import {
  type DailyUpdateCheckParts,
  runDailyUpdateCheck,
  type UpdateCheckSettings,
} from "./daily-update-check.js";
import { createFakeReleaseRegistry } from "./fake-release-registry.js";
import { createReleaseFeed } from "./release-feed.js";
import { countsOf, sendCounts } from "./update-counts.js";

const live = (): AbortSignal => new AbortController().signal;
const folders: TempFolder[] = [];
const notes = { en: ["Stop-loss orders fill faster.", "Fewer RPC calls."], zh: [] };
const userAgent = "binference/2026.11.0 node/v26.10.0 linux x64";
const counts = countsOf({
  version: "2026.11.0",
  os: "linux",
  agents: [
    { mode: "paper", venues: ["kyberswap", "flap"] },
    { mode: "live", venues: ["kyberswap"] },
  ],
  binanceOn: false,
  communityPluginsOn: 2,
});

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

async function checkOn(settings: Partial<UpdateCheckSettings> = {}) {
  const folder = await createTempFolder("update-check-");
  folders.push(folder);
  const registry = createFakeReleaseRegistry();
  const pushes: EnginePush[] = [];
  const logger = createMemoryLogger({ subsystem: "engine" });
  const ask: { current: UpdateCheckSettings } = {
    current: { isOn: true, channel: "stable", locale: "en", countsOn: false, ...settings },
  };
  const send = { http: registry.http, url: registry.countsUrl, userAgent };
  const parts: DailyUpdateCheckParts = {
    feed: createReleaseFeed({ http: registry.http, registry: registry.registry, userAgent }),
    version: "2026.11.0",
    settings: () => ask.current,
    stateRoot: folder.path,
    permissions: noPermissions,
    publish: (push) => pushes.push(push),
    counts: {
      read: async () => counts,
      send: async (taken, signal) => sendCounts(send, taken, signal),
    },
    logger,
  };
  return {
    registry,
    pushes,
    logger,
    ask,
    folder,
    run: async () => runDailyUpdateCheck(parts, live()),
  };
}

describe("the daily update check", () => {
  it("tells the owner of a newer release once, with its notes in the owner's language", async () => {
    const check = await checkOn();
    check.registry.tag("latest", "2026.12.0");
    check.registry.publish("2026.12.0", notes);
    await check.run();
    await check.run();

    expect(check.pushes).toStrictEqual([
      {
        topic: "notice",
        kind: "notice/new",
        data: {
          key: "notice.update",
          values: {
            version: "2026.12.0",
            summary: "Stop-loss orders fill faster.\nFewer RPC calls.",
          },
        },
      },
    ]);
    await expect(readAnnouncedUpdate(check.folder.path, live())).resolves.toStrictEqual({
      channel: "stable",
      version: "2026.12.0",
    });
  });

  it("tells it without notes when the release has none in the owner's language", async () => {
    const check = await checkOn({ locale: "zh" });
    check.registry.tag("latest", "2026.12.0");
    check.registry.publish("2026.12.0", notes);
    await check.run();

    expect(check.pushes).toMatchObject([
      { data: { key: "notice.updateBare", values: { version: "2026.12.0" } } },
    ]);
  });

  it("tells a release again on another channel, and a newer one on the same", async () => {
    const check = await checkOn();
    check.registry.tag("latest", "2026.12.0");
    await check.run();
    check.ask.current = { ...check.ask.current, channel: "beta" };
    await check.run();
    check.registry.tag("latest", "2026.12.1");
    await check.run();

    expect(check.pushes.map((push) => push.data)).toMatchObject([
      { values: { version: "2026.12.0" } },
      { values: { version: "2026.12.0" } },
      { values: { version: "2026.12.1" } },
    ]);
  });

  it("asks nothing while the check is switched off, and tells nothing of an older release", async () => {
    const off = await checkOn({ isOn: false });
    off.registry.tag("latest", "2026.12.0");
    await off.run();
    const older = await checkOn();
    older.registry.tag("latest", "2026.10.0");
    await older.run();

    expect([off.registry.requests(), off.pushes, older.pushes]).toStrictEqual([[], [], []]);
  });

  it("logs a registry it cannot read, and tells nothing", async () => {
    const check = await checkOn();
    check.registry.answerAll(503);
    await check.run();

    expect(check.pushes).toStrictEqual([]);
    expect(check.logger.records()).toStrictEqual([
      {
        level: "warn",
        subsystem: "engine",
        event: "update.check_failed",
        fields: { errorCode: "update.registry_unreachable" },
      },
    ]);
  });
});

describe("the opt-in counts", () => {
  it("go with the daily check only while telemetry is on, and hold only their fields", async () => {
    const off = await checkOn();
    off.registry.tag("latest", "2026.12.0");
    await off.run();
    const on = await checkOn({ countsOn: true });
    on.registry.tag("latest", "2026.12.0");
    await on.run();
    const sent = on.registry.requests().filter((request) => request.method === "POST");

    expect(off.registry.requests().map((request) => request.method)).toStrictEqual(["GET", "GET"]);
    expect(sent).toStrictEqual([
      {
        method: "POST",
        url: on.registry.countsUrl,
        headers: { "content-type": "application/json", "user-agent": userAgent },
        body: JSON.stringify({
          version: "2026.11.0",
          os: "linux",
          venues: ["flap", "kyberswap"],
          plugins: [],
          communityPlugins: 2,
          mode: "both",
          agents: 2,
        }),
      },
    ]);
  });

  it("go even when npm cannot be read, and fail soft", async () => {
    const check = await checkOn({ countsOn: true });
    check.registry.answerAll(503);
    await check.run();

    expect(check.registry.requests().map((request) => request.method)).toStrictEqual([
      "GET",
      "POST",
    ]);
    expect(check.logger.records().map((record) => record.event)).toStrictEqual([
      "update.check_failed",
      "update.counts_failed",
    ]);
  });

  it("go with no check while updates are not checked", async () => {
    const check = await checkOn({ isOn: false, countsOn: true });
    await check.run();

    expect(check.registry.requests()).toStrictEqual([]);
  });
});
