import { describe, expect, it } from "vitest";
import { live } from "../contracts/store-fixtures.js";
import { testAgent } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import { fixtureDay } from "./test-summary-day.js";
import { type SummaryRig, startSummaryRig } from "./test-summary-rig.js";

const hourMs = 3_600_000;

// Moves the rig's clock to a moment and runs the summaries there.
async function runAt(rig: SummaryRig, atMs: number): Promise<void> {
  await rig.clock.advance(atMs - rig.clock.now());
  await rig.run();
}

async function latestDate(rig: SummaryRig) {
  return (await rig.test.stores.dailySummaries.latest(testAgent, live()))?.date;
}

// A rig whose agent had a day to tell, its summary at `time` on the owner's wall clock.
async function busyRig(
  options: { readonly timeZone: string; readonly startMs: number },
  time: string,
) {
  const rig = await startSummaryRig(options);
  await fixtureDay(rig);
  await rig.test.engine.handlers["notice/setSettings"](
    testCall({ agent: testAgent, dailySummaryTime: time }),
  );
  return rig;
}

describe("the daily summary across a change of the clocks", () => {
  it("goes at the jump when the clocks skip its time", async () => {
    // 2027-03-14 in New York: 02:00 EST jumps to 03:00 EDT, 07:00 UTC.
    const jump = Date.UTC(2027, 2, 14, 7, 0);
    const rig = await busyRig({ timeZone: "America/New_York", startMs: jump - 60_000 }, "02:30");
    await rig.run();
    expect(rig.pushes).toHaveLength(0);
    await runAt(rig, jump);
    expect(rig.pushes).toHaveLength(1);
    expect(await latestDate(rig)).toBe("2027-03-14");
  });

  it("goes once, at the first, when the clocks show its time twice", async () => {
    // 2027-11-07 in New York: 01:30 EDT is 05:30 UTC, and 01:30 EST an hour later.
    const first = Date.UTC(2027, 10, 7, 5, 30);
    const rig = await busyRig({ timeZone: "America/New_York", startMs: first - 60_000 }, "01:30");
    await rig.run();
    expect(rig.pushes).toHaveLength(0);
    await runAt(rig, first);
    expect(rig.pushes).toHaveLength(1);
    await runAt(rig, first + hourMs);
    expect(rig.pushes).toHaveLength(1);
    expect(await latestDate(rig)).toBe("2027-11-07");
  });
});

describe("the daily summary when the owner's timezone moves", () => {
  it("sends no second summary of a date after a move west", async () => {
    // 09:00 on 2027-01-16 in Shanghai is 01:00 UTC; New York's 09:00 is 14:00 UTC.
    const rig = await busyRig(
      { timeZone: "Asia/Shanghai", startMs: Date.UTC(2027, 0, 16, 1) },
      "09:00",
    );
    await rig.run();
    rig.moveZone("America/New_York");
    await runAt(rig, Date.UTC(2027, 0, 16, 2));
    await runAt(rig, Date.UTC(2027, 0, 16, 14));
    expect(rig.pushes).toHaveLength(1);
    await runAt(rig, Date.UTC(2027, 0, 17, 14));
    expect(rig.pushes).toHaveLength(2);
    expect(await latestDate(rig)).toBe("2027-01-17");
  });

  it("sends the next date's summary at its time after a move east", async () => {
    const rig = await busyRig(
      { timeZone: "America/New_York", startMs: Date.UTC(2027, 0, 16, 14) },
      "09:00",
    );
    await rig.run();
    rig.moveZone("Asia/Shanghai");
    await runAt(rig, Date.UTC(2027, 0, 16, 15));
    expect(rig.pushes).toHaveLength(1);
    await runAt(rig, Date.UTC(2027, 0, 17, 1));
    expect(rig.pushes).toHaveLength(2);
    expect(await latestDate(rig)).toBe("2027-01-17");
  });
});
