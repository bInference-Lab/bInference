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

const live = (): AbortSignal => new AbortController().signal;
const folders: TempFolder[] = [];
const notes = { en: ["Stop-loss orders fill faster.", "Fewer RPC calls."], zh: [] };

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
    current: { isOn: true, channel: "stable", locale: "en", ...settings },
  };
  const parts: DailyUpdateCheckParts = {
    feed: createReleaseFeed({ http: registry.http, registry: registry.registry, userAgent: "b" }),
    version: "2026.11.0",
    settings: () => ask.current,
    stateRoot: folder.path,
    permissions: noPermissions,
    publish: (push) => pushes.push(push),
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
