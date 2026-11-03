import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createHostRefusals, type HostNotice } from "./host-notice.js";

describe("createHostRefusals", () => {
  it("tells the owner once per plugin and host a day", async () => {
    const clock = createManualClock();
    const told: HostNotice[] = [];
    const refused = createHostRefusals({ clock, tell: (notice) => told.push(notice) });

    refused("fear-index", "other.example.net");
    refused("fear-index", "other.example.net");
    refused("fear-index", "third.example.net");
    refused("whale-feed", "other.example.net");
    await clock.advance(86_399_999);
    refused("fear-index", "other.example.net");
    await clock.advance(1);
    refused("fear-index", "other.example.net");

    expect(told).toStrictEqual([
      { kind: "hostRefused", plugin: "fear-index", host: "other.example.net" },
      { kind: "hostRefused", plugin: "fear-index", host: "third.example.net" },
      { kind: "hostRefused", plugin: "whale-feed", host: "other.example.net" },
      { kind: "hostRefused", plugin: "fear-index", host: "other.example.net" },
    ]);
  });

  it("remembers at most 1,000 pairs, forgetting the oldest", () => {
    const told: HostNotice[] = [];
    const refused = createHostRefusals({
      clock: createManualClock(),
      tell: (notice) => told.push(notice),
    });

    Array.from({ length: 1_001 }, (_, at) => refused("noisy", `h${String(at)}.example.net`));
    refused("noisy", "h0.example.net");
    refused("noisy", "h1000.example.net");

    expect(told).toHaveLength(1_002);
  });
});
