import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createFakeReleaseRegistry } from "./fake-release-registry.js";
import { createReleaseFeed, isNewerVersion, isReleaseForm } from "./release-feed.js";

const live = (): AbortSignal => new AbortController().signal;
const userAgent = "binference/2026.11.0 node/v26.10.0 linux x64";
const notes = { en: ["Stop-loss orders fill faster."], zh: ["The Chinese line."] };

function feedParts(registry: ReturnType<typeof createFakeReleaseRegistry>) {
  return { http: registry.http, registry: registry.registry, userAgent };
}

function feedOn(registry: ReturnType<typeof createFakeReleaseRegistry>) {
  return createReleaseFeed(feedParts(registry));
}

describe("the release feed", () => {
  it("reads a channel's dist-tags at most once a minute for every caller", async () => {
    const registry = createFakeReleaseRegistry();
    const clock = createManualClock(1_000);
    const feed = createReleaseFeed({ ...feedParts(registry), clock });
    registry.tag("latest", "2026.12.0");
    await Promise.all([feed.newest("stable", live()), feed.newest("stable", live())]);
    await clock.advance(59_000);
    const reused = await feed.newest("stable", live());
    await clock.advance(1_000);
    registry.tag("latest", "2027.1.0");
    const fresh = await feed.newest("stable", live());

    expect([reused, fresh]).toStrictEqual([
      { ok: true, value: "2026.12.0" },
      { ok: true, value: "2027.1.0" },
    ]);
    expect(registry.requests().filter((made) => made.url.endsWith("/dist-tags"))).toHaveLength(2);
  });

  it("reads the newest stable release from npm's latest dist-tag", async () => {
    const registry = createFakeReleaseRegistry();
    registry.tag("latest", "2026.12.0");
    registry.tag("beta", "2027.1.0-beta.1");

    await expect(feedOn(registry).newest("stable", live())).resolves.toStrictEqual({
      ok: true,
      value: "2026.12.0",
    });
  });

  it("gives a beta owner the newer of the beta and the stable release", async () => {
    const registry = createFakeReleaseRegistry();
    const feed = feedOn(registry);
    registry.tag("latest", "2026.12.0");
    registry.tag("beta", "2027.1.0-beta.1");
    const ahead = await feed.newest("beta", live());
    registry.tag("latest", "2027.1.0");
    const behind = await feed.newest("beta", live());

    expect([ahead, behind]).toStrictEqual([
      { ok: true, value: "2027.1.0-beta.1" },
      { ok: true, value: "2027.1.0" },
    ]);
  });

  it("leaves out a dist-tag that names no stable or beta form", async () => {
    const registry = createFakeReleaseRegistry();
    registry.tag("latest", "2026.12.0-nightly.3");
    registry.tag("scratch", "2099.1.0");

    await expect(feedOn(registry).newest("stable", live())).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    });
  });

  it("is unreachable when npm answers with anything but its dist-tags", async () => {
    const registry = createFakeReleaseRegistry();
    registry.answerAll(503);

    await expect(feedOn(registry).newest("stable", live())).resolves.toStrictEqual({
      ok: false,
      error: "unreachable",
    });
  });

  it("asks npm with GET and only its accept header and the user agent", async () => {
    const registry = createFakeReleaseRegistry();
    registry.tag("latest", "2026.12.0");
    registry.publish("2026.12.0", notes);
    const feed = feedOn(registry);
    await feed.newest("stable", live());
    await feed.notes("2026.12.0", live());

    expect(registry.requests()).toStrictEqual([
      {
        method: "GET",
        url: "https://registry.test/-/package/binference/dist-tags",
        headers: { accept: "application/json", "user-agent": userAgent },
      },
      {
        method: "GET",
        url: "https://registry.test/binference/2026.12.0",
        headers: { accept: "application/json", "user-agent": userAgent },
      },
    ]);
  });

  it("reads a version's notes for owners from its manifest, and none that break the bounds", async () => {
    const registry = createFakeReleaseRegistry();
    registry.publish("2026.12.0", notes);
    registry.publish("2026.12.1", { en: ["x".repeat(201)], zh: [] });
    registry.publish("2026.12.2");
    const feed = feedOn(registry);

    expect([
      await feed.notes("2026.12.0", live()),
      await feed.notes("2026.12.1", live()),
      await feed.notes("2026.12.2", live()),
      await feed.notes("2026.12.3", live()),
    ]).toStrictEqual([notes, undefined, undefined, undefined]);
  });
});

describe("release versions", () => {
  it("knows the stable and beta forms of a release", () => {
    expect(
      ["2026.11.0", "2026.11.0-beta.1", "2026.13.0", "2026.01.0", "2026.11.0-nightly.1"].map(
        isReleaseForm,
      ),
    ).toStrictEqual([true, true, false, false, false]);
  });

  it("orders a beta before the release it leads to", () => {
    expect([
      isNewerVersion("2026.11.0", "2026.11.0-beta.2"),
      isNewerVersion("2026.11.0-beta.2", "2026.11.0"),
      isNewerVersion("2026.11.0", "2026.11.0"),
      isNewerVersion("2026.11.10", "2026.11.9"),
    ]).toStrictEqual([true, false, false, true]);
  });
});
