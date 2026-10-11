import { createManualClock } from "@binference/core/testing";
import type { AuthLockoutReport } from "@binference/engine/access";
import { describe, expect, it } from "vitest";
import { type CountedKey, createLockoutAlerts, sourceKey } from "./lockout-alerts.js";

const limits = { authAlertEveryMs: 15 * 60_000, authLockoutMs: 5 * 60_000, maxAuthKeys: 2 };
const address = sourceKey("203.0.113.7");
const device: CountedKey = {
  key: "device:dev_1",
  lockout: { kind: "device", device: "dev_1" },
};

function alerts() {
  const clock = createManualClock(1_000_000);
  const reports: AuthLockoutReport[] = [];
  const created = createLockoutAlerts({ ...limits, clock, report: (r) => reports.push(r) });
  return { clock, reports, alerts: created };
}

describe("createLockoutAlerts", () => {
  it("reports only the keys this failure locked, with the end of their lockout", () => {
    const { reports, alerts: alert } = alerts();
    alert.locked([address, device], []);
    alert.locked([address, device], [address.key]);
    expect(reports).toStrictEqual([
      { kind: "address", address: "203.0.113.7", untilMs: 1_000_000 + 5 * 60_000 },
    ]);
  });

  it("reports a key again only 15 minutes after its last report", async () => {
    const { clock, reports, alerts: alert } = alerts();
    alert.locked([device], [device.key]);
    await clock.advance(15 * 60_000 - 1);
    alert.locked([device], [device.key]);
    await clock.advance(1);
    alert.locked([device], [device.key]);
    expect(reports.map((report) => report.untilMs)).toStrictEqual([
      1_000_000 + 5 * 60_000,
      1_000_000 + 20 * 60_000,
    ]);
  });

  it("forgets the key reported longest ago past the most keys", () => {
    const { reports, alerts: alert } = alerts();
    const other = sourceKey("198.51.100.1");
    alert.locked([address], [address.key]);
    alert.locked([device], [device.key]);
    alert.locked([other], [other.key]);
    alert.locked([address], [address.key]);
    alert.locked([device], [device.key]);
    expect(reports.map((report) => report.kind)).toStrictEqual([
      "address",
      "device",
      "address",
      "address",
      "device",
    ]);
  });

  it("reports nothing without a listener", () => {
    const clock = createManualClock(0);
    expect(() =>
      createLockoutAlerts({ ...limits, clock }).locked([device], [device.key]),
    ).not.toThrow();
  });
});

describe("sourceKey", () => {
  it("names the local socket, a direct address and a forwarded one", () => {
    expect([sourceKey("ipc"), sourceKey("::1"), sourceKey("forwarded:192.0.2.4")]).toStrictEqual([
      { key: "source:ipc", lockout: { kind: "local" } },
      { key: "source:::1", lockout: { kind: "address", address: "::1" } },
      { key: "source:forwarded:192.0.2.4", lockout: { kind: "address", address: "192.0.2.4" } },
    ]);
  });
});
