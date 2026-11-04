import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import type { EnginePush } from "./engine-push.js";
import { createPluginNotices } from "./plugin-notice.js";

// The words of each notice, in both languages, are held by the surfaces' notice-table tests.
function notices() {
  const clock = createManualClock();
  const published: EnginePush[] = [];
  const tell = createPluginNotices({ clock, publish: (push) => published.push(push) });
  const data = () => published.map((push) => push.data);
  return { clock, tell, data };
}

const refused = (host: string) => ({ kind: "hostRefused", plugin: "fear-index", host }) as const;

describe("createPluginNotices", () => {
  it.each([
    [
      { kind: "stopped", plugin: "fear-index" },
      { key: "notice.pluginStopped", values: { plugin: "fear-index" } },
    ],
    [
      { kind: "stalled", plugin: "fear-index" },
      { key: "notice.pluginStalled", values: { plugin: "fear-index" } },
    ],
    [
      { kind: "refused", plugin: "fear-index", refusal: "files_changed" },
      { key: "notice.pluginChanged", values: { plugin: "fear-index" } },
    ],
    [
      { kind: "sandboxOff", reason: "childProcess" },
      { key: "notice.pluginSandboxOff", values: { reason: "childProcess" } },
    ],
  ] as const)("words %o as a notice to the whole install", (notice, expected) => {
    const { tell, data } = notices();
    tell(notice);

    expect(data()).toStrictEqual([expected]);
  });

  it("tells five refused hosts an hour per plugin, then the rest in one line", async () => {
    const { clock, tell, data } = notices();
    Array.from({ length: 8 }, (_, at) => tell(refused(`h${String(at)}.example.net`)));
    tell({ kind: "hostRefused", plugin: "whale-feed", host: "x.example.net" });
    await clock.advance(3_600_000);
    tell(refused("late.example.net"));

    const refusedKey = { key: "notice.pluginHostRefused" };
    expect(data()).toMatchObject([
      ...Array.from({ length: 6 }, () => refusedKey),
      { key: "notice.pluginHostsHeld" },
      refusedKey,
    ]);
    expect(data()[6]).toStrictEqual({
      key: "notice.pluginHostsHeld",
      values: { plugin: "fear-index", count: "3" },
    });
  });

  it("cuts a long host the plugin chose to 64 characters", () => {
    const { tell, data } = notices();
    tell(refused(`${"a".repeat(80)}.example.net`));

    expect(data()).toStrictEqual([
      {
        key: "notice.pluginHostRefused",
        values: { plugin: "fear-index", host: `${"a".repeat(63)}…` },
      },
    ]);
  });

  it("keeps the hours of at most 1,000 plugins, forgetting the oldest first", () => {
    const { tell, data } = notices();
    Array.from({ length: 6 }, () => tell(refused("a.example.net")));
    Array.from({ length: 1_000 }, (_, n) =>
      tell({ kind: "hostRefused", plugin: `plugin-${String(n)}`, host: "b.example.net" }),
    );
    tell(refused("c.example.net"));

    expect(data().at(-1)).toStrictEqual({
      key: "notice.pluginHostRefused",
      values: { plugin: "fear-index", host: "c.example.net" },
    });
    expect(data()).not.toContainEqual(expect.objectContaining({ key: "notice.pluginHostsHeld" }));
  });
});
