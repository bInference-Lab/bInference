import { join } from "node:path";
import type { EngineCaller } from "@binference/engine";
import { writePrivateFile } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import type { ResultOf } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { noPermissions } from "../e2e/test-host.js";
import { createLogOperations } from "./log-operations.js";

const owner: EngineCaller = {
  credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  client: { kind: "console", version: "test" },
  scopes: ["read", "admin"],
  transport: "ws",
};
const address = "0x30435f9D276c6BC54F56161Fb3dFB7bDC2a8DBcB";
const state: { folder?: TempFolder } = {};

afterEach(async () => {
  await state.folder?.remove();
});

function lineOf(at: number, level: string, extra: object = {}): string {
  const time = new Date(Date.UTC(2026, 10, 14, 8, 0, at)).toISOString();
  return JSON.stringify({
    time,
    level,
    subsystem: "engine.orders",
    event: "order.skipped",
    ...extra,
  });
}

// What a call answered, which every case here expects the engine to answer.
function valueOf(answer: {
  readonly ok: boolean;
  readonly value?: ResultOf<"log/recent">;
}): ResultOf<"log/recent"> {
  if (answer.value === undefined) {
    throw new Error("Expected log/recent to answer.");
  }
  return answer.value;
}

// The log operations over a log file holding these lines, one each.
async function recentOver(lines: readonly string[]) {
  const folder = await createTempFolder("bnf-logop-");
  state.folder = folder;
  const file = join(folder.path, "engine.log");
  const signal = AbortSignal.timeout(10_000);
  await writePrivateFile(file, `${lines.join("\n")}\n`, { permissions: noPermissions, signal });
  const handler = createLogOperations({ file })["log/recent"];
  if (handler === undefined) {
    throw new Error("Expected log/recent.");
  }
  return async (args: object) => handler({ args, caller: owner, signal });
}

describe("the log operations", () => {
  it("answers the newest lines by the support bundle's field rules, the others counted", async () => {
    const recent = await recentOver([
      lineOf(1, "info", { fields: { orderId: "ord_0192aa00-0000-7000-8000-000000000001" } }),
      "Error: the owner's secret at /home/owner",
      lineOf(2, "warn", { fields: { host: "rpc.example.com", accountId: `eip155:56:${address}` } }),
      lineOf(3, "info", { text: "chat text never passes" }),
    ]);
    expect(await recent({})).toStrictEqual({
      ok: true,
      value: {
        items: [
          {
            time: "2026-11-14T08:00:01.000Z",
            level: "info",
            subsystem: "engine.orders",
            event: "order.skipped",
            fields: { orderId: "ord_0192aa00-0000-7000-8000-000000000001" },
          },
          {
            time: "2026-11-14T08:00:02.000Z",
            level: "warn",
            subsystem: "engine.orders",
            event: "order.skipped",
            fields: { host: "[omitted]", accountId: "eip155:56:0x3043…DBcB" },
          },
        ],
        omitted: 2,
      },
    });
  });

  it("keeps the lines at the level asked or above, the newest of the limit", async () => {
    const recent = await recentOver([
      lineOf(1, "warn"),
      lineOf(2, "debug"),
      lineOf(3, "error"),
      lineOf(4, "info"),
      lineOf(5, "warn"),
    ]);
    const answer = valueOf(await recent({ level: "warn", limit: 2 }));
    const kept = answer.items.map(({ time, level }) => [time, level]);
    expect(kept).toStrictEqual([
      ["2026-11-14T08:00:03.000Z", "error"],
      ["2026-11-14T08:00:05.000Z", "warn"],
    ]);
  });

  it("cuts the oldest lines to keep the answer within 512 KiB, and says so", async () => {
    const reason = "x".repeat(2_000);
    const lines = Array.from({ length: 400 }, (_unused, at) =>
      lineOf(at % 60, "info", { fields: { errorCode: `a.${reason}` } }),
    );
    const value = valueOf(await (await recentOver(lines))({ limit: 500 }));
    expect(value.cut).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(value.items)).byteLength).toBeLessThanOrEqual(
      512 * 1024,
    );
    expect(value.items.length).toBeLessThan(400);
  });

  it("answers no line when the engine wrote no log yet", async () => {
    const folder = await createTempFolder("bnf-logop-");
    state.folder = folder;
    const handler = createLogOperations({ file: join(folder.path, "engine.log") })["log/recent"];
    const signal = AbortSignal.timeout(10_000);
    expect(await handler?.({ args: {}, caller: owner, signal })).toStrictEqual({
      ok: true,
      value: { items: [], omitted: 0 },
    });
  });
});
