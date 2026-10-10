import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { noticeRecordOf } from "./notice-record-of.js";

const stamp = { id: fixtureId("ntc", 1), atMs: 5_000, surfaces: [] } as const;

describe("the record of a notice", () => {
  it.each([
    ["notice.frozen", "frozen", "critical"],
    ["notice.lowGas", "lowGas", "warning"],
    ["notice.limitChange", "limitChange", "info"],
    ["notice.unfrozen", "unfrozen", "info"],
  ] as const)("keeps %s as kind %s at level %s", (key, kind, level) => {
    const record = noticeRecordOf({ key, values: {} }, stamp);
    expect({ kind: record.kind, level: record.level }).toStrictEqual({ kind, level });
  });

  it("queues its delivery to each surface the install runs", () => {
    const notice = { key: "notice.locked", values: {} };
    expect(noticeRecordOf(notice, { ...stamp, surfaces: ["telegram"] })).toStrictEqual({
      id: stamp.id,
      atMs: 5_000,
      notice,
      kind: "locked",
      level: "critical",
      delivered: { telegram: "queued" },
    });
  });
});
