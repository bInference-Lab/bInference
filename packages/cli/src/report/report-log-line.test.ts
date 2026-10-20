import { describe, expect, it } from "vitest";
import { omittedMark, reportLogLine } from "./report-log-line.js";

const address = "0x30435f9D276c6BC54F56161Fb3dFB7bDC2a8DBcB";
const time = "2026-10-20T08:00:00.000Z";

function line(value: object): string {
  return JSON.stringify({ time, level: "info", subsystem: "engine.orders", ...value });
}

describe("reportLogLine", () => {
  it("keeps a line's ids, chain, numbers and codes as they are", () => {
    const fields = {
      agentId: "agt_0192f3a4-1b2c-7d3e-8f40-123456789abc",
      chain: "eip155:56",
      sourceId: "dexscreener",
      errorCode: "venue.no_route",
      durationMs: 12,
      gapBps: 40,
    };
    expect(reportLogLine(line({ event: "order.skipped", fields }))).toStrictEqual({
      time,
      level: "info",
      subsystem: "engine.orders",
      event: "order.skipped",
      fields,
    });
  });

  it("cuts an account's and a token's address to the short form", () => {
    const fields = {
      accountId: `eip155:56:${address}`,
      assetId: `eip155:56/erc20:${address}`,
    };
    expect(reportLogLine(line({ event: "watch.cut", fields }))?.["fields"]).toStrictEqual({
      accountId: "eip155:56:0x3043…DBcB",
      assetId: "eip155:56/erc20:0x3043…DBcB",
    });
    const native = { assetId: "eip155:56/slip44:714" };
    expect(reportLogLine(line({ event: "price.read", fields: native }))?.["fields"]).toStrictEqual(
      native,
    );
  });

  it("keeps a field whose value breaks its rule only as omitted", () => {
    const chat = "buy 100 PEPE for my mom";
    const kept = reportLogLine(
      line({ event: chat, fields: { agentId: chat, errorCode: "Bearer abc", accountId: chat } }),
    );
    expect(kept).toStrictEqual({
      time,
      level: "info",
      subsystem: "engine.orders",
      event: omittedMark,
      fields: { agentId: omittedMark, errorCode: omittedMark, accountId: omittedMark },
    });
    expect(JSON.stringify(kept)).not.toContain("PEPE");
  });

  it("leaves out a line that is not the log's JSON shape", () => {
    expect(reportLogLine("Error: secret 123 at /home/ana")).toBeUndefined();
    expect(reportLogLine(line({ event: "chat.sent", text: "hello there" }))).toBeUndefined();
    expect(reportLogLine(JSON.stringify(["a"]))).toBeUndefined();
  });
});
