import { describe, expect, it } from "vitest";
import { countsOf } from "./update-counts.js";

const base = { version: "2026.11.0", os: "darwin", binanceOn: false, communityPluginsOn: 0 };

describe("the opt-in counts", () => {
  it("say paper, live or both across the agents, and paper with none", () => {
    const modes = [
      [],
      [{ mode: "live" as const, venues: [] }],
      [
        { mode: "live" as const, venues: [] },
        { mode: "paper" as const, venues: [] },
      ],
    ].map((agents) => countsOf({ ...base, agents }).mode);

    expect(modes).toStrictEqual(["paper", "live", "both"]);
  });

  it("name each venue once in order, and the Binance plugin only while it is on", () => {
    const agents = [
      { mode: "paper" as const, venues: ["okx", "kyberswap"] },
      { mode: "paper" as const, venues: ["kyberswap"] },
    ];

    expect(countsOf({ ...base, agents, binanceOn: true })).toStrictEqual({
      version: "2026.11.0",
      os: "darwin",
      venues: ["kyberswap", "okx"],
      plugins: ["binance"],
      communityPlugins: 0,
      mode: "paper",
      agents: 2,
    });
  });
});
