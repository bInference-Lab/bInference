import { err, ok } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { IntentStore } from "../ports.js";
import type { ConfigChanges } from "./config-change-parts.js";
import { type ConfigChangeWriteParts, writeConfigChange } from "./write-config-change.js";

const live = new AbortController().signal;
const quote = {
  changes: [{ path: "logging.level", before: '"info"', after: '"debug"' }],
  restartNeeded: false,
  quotedAtMs: 1,
};

function snapshotOf(
  state: string,
  fields: { readonly quote?: unknown; readonly statusState?: string } = { quote },
): IntentSnapshot {
  return {
    record: {
      id: "int_0190f1c2-3a4b-7c5d-8e6f-0000000000c1",
      kind: "configChange",
      state,
      request: { kind: "configChange", patch: { logging: { level: "debug" } } },
      ...("quote" in fields ? { quote: fields.quote } : {}),
    },
    stored: { status: { state: fields.statusState ?? state, kind: "configChange" }, version: 3 },
  } as unknown as IntentSnapshot;
}

// The parts the write takes, each answering as a test sets it.
function partsOf(answers: {
  readonly moved?: boolean;
  readonly onApply?: (surface: string) => void;
}): ConfigChangeWriteParts {
  const configChanges: ConfigChanges = {
    view: async () => Promise.resolve(err("protocol.bad_args")),
    preview: async () => Promise.resolve(err("config.invalid")),
    apply: async (_change, { author }) => {
      answers.onApply?.(author.surface);
      return Promise.resolve(ok(undefined));
    },
  };
  const stored = {
    move: async () =>
      Promise.resolve(answers.moved === true ? ok(snapshotOf("reconciled")) : err("stale")),
    snapshot: async () => Promise.resolve(undefined),
  } as unknown as StoredIntents;
  const intents = {
    confirmation: async () => Promise.resolve(undefined),
  } as unknown as IntentStore;
  return { stored, intents, configChanges, clock: createManualClock(1) };
}

describe("the write of a confirmed config change", () => {
  it("leaves an intent no longer confirmed as it is, applying nothing", async () => {
    const applied: string[] = [];
    const snapshot = snapshotOf("cancelled");
    const onApply = (surface: string): void => {
      applied.push(surface);
    };
    expect(await writeConfigChange(partsOf({ onApply }), snapshot, live)).toBe(snapshot);
    expect(applied).toStrictEqual([]);
  });

  it("applies as the engine when no confirmation is stored, and keeps the intent a later write moved", async () => {
    const applied: string[] = [];
    const snapshot = snapshotOf("confirmed");
    const onApply = (surface: string): void => {
      applied.push(surface);
    };
    expect(await writeConfigChange(partsOf({ onApply }), snapshot, live)).toBe(snapshot);
    expect(applied).toStrictEqual(["engine"]);
  });

  it("answers the intent after its move, and leaves one whose state the machine refuses", async () => {
    const moved = await writeConfigChange(partsOf({ moved: true }), snapshotOf("confirmed"), live);
    const refused = snapshotOf("confirmed", { quote, statusState: "proposed" });
    expect(moved.record.state).toBe("reconciled");
    expect(await writeConfigChange(partsOf({ moved: true }), refused, live)).toBe(refused);
  });

  it("fails on a confirmed change stored with no quote", async () => {
    await expect(writeConfigChange(partsOf({}), snapshotOf("confirmed", {}), live)).rejects.toThrow(
      "has no quote",
    );
  });
});
