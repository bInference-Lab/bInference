import type { Http } from "@binference/core";
import type { ManualClock } from "@binference/core/testing";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createFakeReleaseRegistry,
  type FakeReleaseRegistry,
} from "../updates/fake-release-registry.js";
import { type InitMachine, secretEnv } from "./init-fixtures.js";
import { connectClient } from "./test-host.js";
import { createRunningEngines } from "./unlock-fixtures.js";

const slow = { timeout: 60_000 };
const engines = createRunningEngines();
const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(20_000) });
const notes = { en: ["Stop-loss orders fill faster."], zh: ["The Chinese line."] };
const countsSchema = z.strictObject({
  version: z.string(),
  os: z.string(),
  venues: z.array(z.string()),
  plugins: z.array(z.string()),
  communityPlugins: z.int(),
  mode: z.enum(["paper", "live", "both"]),
  agents: z.int(),
});

afterEach(async () => {
  await engines.stopAll();
});

// The machine's outside world, with npm's registry and the counts' endpoint answered by the fake.
function worldWith(machine: InitMachine, registry: FakeReleaseRegistry): Http {
  const served = new Set([new URL(registry.registry).origin, new URL(registry.countsUrl).origin]);
  return {
    request: async (request) =>
      served.has(new URL(request.url).origin)
        ? registry.http.request(request)
        : machine.world.request(request),
  };
}

describe("update/check and update/apply end to end", () => {
  it("answers the newest release on the channel with its notes, read from npm", slow, async () => {
    const machine = await engines.setUp();
    const registry = createFakeReleaseRegistry();
    registry.tag("latest", "2026.12.0");
    registry.publish("2026.12.0", notes);
    const parts = { npmRegistry: registry.registry, http: worldWith(machine, registry) };
    expect(await engines.start(machine, { parts })).toMatchObject({ state: "ready" });
    const client = await connectClient(machine);
    const found = await client.call("update/check", {}, live());
    registry.answerAll(503);
    // One read of the dist-tags answers every call for a minute.
    await (machine.clock as ManualClock).advance(60_000);
    const unread = client.call("update/check", {}, live());

    expect(found).toStrictEqual({
      current: "2026.10.0-test",
      latest: "2026.12.0",
      channel: "stable",
      notes: "Stop-loss orders fill faster.",
      releaseNotes: notes,
    });
    await expect(unread).rejects.toMatchObject({ code: "update.registry_unreachable" });
    await expect(client.call("update/apply", {}, live())).rejects.toMatchObject({
      code: "update.terminal_only",
    });
    const agents = new Set(registry.requests().map((request) => request.headers["user-agent"]));
    expect(agents).toStrictEqual(new Set(["binference/2026.10.0-test node/v26.10.0 linux x64"]));
  });

  it(
    "tells the owner of the release and sends the opt-in counts within 65 minutes",
    slow,
    async () => {
      const machine = await engines.setUp();
      const registry = createFakeReleaseRegistry();
      registry.tag("latest", "2026.12.0");
      registry.publish("2026.12.0", notes);
      const parts = {
        npmRegistry: registry.registry,
        countsUrl: registry.countsUrl,
        http: worldWith(machine, registry),
      };
      const env = { ...secretEnv(machine), BINFERENCE_TELEMETRY__ENABLED: "true" };
      expect(await engines.start(machine, { parts, env })).toMatchObject({ state: "ready" });
      const posted = registry.next("POST");
      await (machine.clock as ManualClock).advance(65 * 60_000);
      const counts = await posted;
      const client = await connectClient(machine);
      const page = await client.call("notice/list", { limit: 200 }, live());

      // Exactly these fields, and no other: a strict schema refuses any field more.
      const sent = countsSchema.parse(JSON.parse(String(counts.body)));
      expect(sent).toMatchObject({ version: "2026.10.0-test", os: "linux", agents: 1 });
      expect(sent).toMatchObject({ plugins: [], communityPlugins: 0, mode: "paper" });
      expect(sent.venues.length).toBeGreaterThan(0);
      expect(page.items.filter((item) => item.key.startsWith("notice.update"))).toMatchObject([
        {
          key: "notice.update",
          values: {
            version: "2026.12.0",
            steps: "update",
            summary: "Stop-loss orders fill faster.",
          },
        },
      ]);
    },
  );
});
