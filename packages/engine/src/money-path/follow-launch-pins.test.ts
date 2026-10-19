import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import type { IntentQuery } from "../intents/intent-change.js";
import type { IntentKind } from "../intents/intent-kind.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { testAgent, testNowMs, testWallet } from "../intents/test-intents.js";
import { followLaunchPins } from "./follow-launch-pins.js";
import type { LaunchPathOptions } from "./resolve-launch.js";

const live = { signal: new AbortController().signal };

function recordOf(n: number, kind: IntentKind): IntentRecord {
  return {
    id: fixtureId("int", n),
    agentId: testAgent,
    walletId: testWallet,
    kind,
    state: "quoted",
    request: {},
    hasOutsideContent: false,
    isPaper: false,
    proposer: "telegram",
    createdAtMs: testNowMs,
    changedAtMs: testNowMs + n,
    version: 1,
  };
}

const isAfter = (record: IntentRecord, after: IntentQuery["after"]): boolean =>
  after === undefined ||
  record.changedAtMs > after.changedAtMs ||
  (record.changedAtMs === after.changedAtMs && record.id > after.id);

/** A store of intents that answers pages as the intent store does, and counts what is read. */
function storeOf(records: readonly IntentRecord[], throwsFor: ReadonlySet<Id<"int">>) {
  const read: Id<"int">[] = [];
  const stored = {
    list: async (query: IntentQuery) =>
      Promise.resolve(
        records.filter((record) => isAfter(record, query.after)).slice(0, query.limit),
      ),
    snapshot: async (id: Id<"int">) => {
      read.push(id);
      return throwsFor.has(id) ? Promise.reject(new Error("The node went away.")) : undefined;
    },
  };
  const options = { stored } as unknown as LaunchPathOptions;
  return { options, read };
}

describe("the pin follow of every token launch", () => {
  it("reads every page, so launches behind 50 other intents are followed", async () => {
    const trades = Array.from({ length: 120 }, (_unused, index) => recordOf(index + 1, "swap"));
    const launch = recordOf(121, "launchToken");
    const { options, read } = storeOf([...trades, launch], new Set());
    await expect(followLaunchPins(options, live)).resolves.toBe(0);
    expect(read).toStrictEqual([launch.id]);
  });

  it("follows every launch when one throws, then names the one that threw", async () => {
    const launches = [1, 2, 3].map((n) => recordOf(n, "launchToken"));
    const { options, read } = storeOf(launches, new Set([fixtureId("int", 1)]));
    await expect(followLaunchPins(options, live)).rejects.toMatchObject({
      code: "engine.pin_check_failed",
      details: { intents: fixtureId("int", 1), count: 1 },
    });
    expect(read).toStrictEqual([1, 2, 3].map((n) => fixtureId("int", n)));
  });
});
