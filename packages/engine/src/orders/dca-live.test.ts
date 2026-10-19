import type { DcaOrderRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { testAgent, testCoin, testToken } from "../intents/test-intents.js";
import { fillRowsOf } from "./test-fills.js";
import { activeOrderOf, startLiveFills } from "./test-live-fills.js";

const live = { signal: new AbortController().signal };

// A live DCA buy of the test token with the coin every five minutes.
const liveDca: DcaOrderRequest = {
  kind: "dca",
  agent: testAgent,
  token: testToken,
  side: "buy",
  spend: testCoin,
  size: { base: 10n ** 15n },
  trigger: { cron: "*/5 * * * *", count: 2 },
};

describe("a live DCA order", () => {
  it("records its period as waiting when the agent's line is held by another live buy", async () => {
    const bench = await startLiveFills({ hold: true });
    const first = await activeOrderOf(bench, liveDca);
    const second = await activeOrderOf(bench, liveDca);
    await bench.test.engine.runSchedules(live);
    await bench.test.clock.advance(5 * 60_000);

    await bench.test.engine.runSchedules(live);

    const [firstRows, secondRows] = await Promise.all(
      [first, second].map(async ({ id }) => fillRowsOf(bench.test, id)),
    );
    expect(firstRows).toStrictEqual([]);
    expect(secondRows).toMatchObject([
      { outcome: "skipped", reason: "fill_waiting", notices: [{ key: "notice.skipped" }] },
    ]);
  });
});
