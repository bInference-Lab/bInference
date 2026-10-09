import { describe, expect, it } from "vitest";
import { scopes } from "../auth/scopes.js";
import { isOperationName, type OperationName, operationNames, operations } from "./operations.js";

// Protocol spec section 7, row by row: the operation, its one scope, and the columns it marks.
// `write` needs a key, `local` is IPC only, `routed` is answered by the agent runtime, and
// `subscribe` starts or stops pushes.
const specTable = [
  ["engine/status", "read", ""],
  ["engine/describe", "read", ""],
  ["engine/stop", "admin", "write local"],
  ["engine/unlock", "admin", "write local"],
  ["safety/status", "read", ""],
  ["safety/freeze", "confirm", "write"],
  ["safety/unfreeze", "loosen", "write"],
  ["safety/rescue", "confirm", "write"],
  ["safety/setRescueAddress", "admin", "write"],
  ["safety/cancelRescueChange", "confirm", "write"],
  ["agent/list", "read", ""],
  ["agent/get", "read", ""],
  ["agent/create", "admin", "write"],
  ["agent/rename", "admin", "write"],
  ["agent/archive", "admin", "write"],
  ["agent/goLive", "admin", "write local"],
  ["agent/goPaper", "confirm", "write"],
  ["agent/readFile", "read", ""],
  ["agent/writeFile", "admin", "write"],
  ["identity/get", "read", ""],
  ["identity/register", "propose", "write"],
  ["wallet/list", "read", ""],
  ["wallet/create", "admin", "write local"],
  ["wallet/rename", "admin", "write"],
  ["wallet/exportKey", "admin", "write local"],
  ["ceiling/get", "read", ""],
  ["ceiling/set", "admin", "write local"],
  ["signer/revoke", "admin", "write local"],
  ["approval/get", "read", ""],
  ["approval/set", "confirm", "write"],
  ["portfolio/get", "read", ""],
  ["portfolio/pnl", "read", ""],
  ["portfolio/resetPaper", "confirm", "write"],
  ["asset/get", "read", ""],
  ["asset/search", "read", ""],
  ["name/resolve", "read", ""],
  ["quote/get", "read", ""],
  ["risk/check", "read", ""],
  ["intent/propose", "propose", "write"],
  ["intent/get", "read", ""],
  ["intent/list", "read", ""],
  ["intent/confirm", "confirm", "write"],
  ["intent/deny", "confirm", "write"],
  ["intent/cancel", "confirm", "write"],
  ["order/create", "propose", "write"],
  ["order/get", "read", ""],
  ["order/list", "read", ""],
  ["order/cancel", "propose", "write"],
  ["alert/create", "propose", "write"],
  ["alert/list", "read", ""],
  ["alert/delete", "propose", "write"],
  ["webhookRule/create", "admin", "write"],
  ["webhookRule/list", "read", ""],
  ["webhookRule/delete", "confirm", "write"],
  ["webhookRule/rotateUrl", "admin", "write"],
  ["schedule/create", "propose", "write"],
  ["schedule/list", "read", ""],
  ["schedule/cancel", "propose", "write"],
  ["limit/get", "read", ""],
  ["limit/set", "confirm", "write"],
  ["sendLevel/get", "read", ""],
  ["sendLevel/set", "confirm", "write"],
  ["sendLevel/cancelPending", "confirm", "write"],
  ["address/list", "read", ""],
  ["address/add", "admin", "write local"],
  ["address/remove", "confirm", "write"],
  ["chat/post", "chat", "write"],
  ["chat/messages", "read", "routed"],
  ["chat/stop", "chat", "write"],
  ["chat/clear", "chat", "write"],
  ["turn/say", "agent", "write"],
  ["turn/status", "agent", ""],
  ["turn/end", "agent", "write"],
  ["usage/record", "agent", "write"],
  ["usage/get", "read", ""],
  ["notes/search", "read", "routed"],
  ["notes/list", "read", "routed"],
  ["notes/write", "agent", "write routed"],
  ["notes/delete", "admin", "write routed"],
  ["model/list", "read", ""],
  ["model/set", "confirm", "write"],
  ["plugin/list", "read", ""],
  ["plugin/add", "admin", "write local"],
  ["plugin/enable", "admin", "write"],
  ["plugin/disable", "confirm", "write"],
  ["plugin/remove", "admin", "write"],
  ["skill/list", "read", ""],
  ["skill/add", "admin", "write local"],
  ["skill/remove", "admin", "write"],
  ["config/read", "admin", ""],
  ["config/change", "admin", "write"],
  ["config/history", "read", ""],
  ["ledger/list", "read", ""],
  ["ledger/export", "read", "write"],
  ["backup/list", "read", ""],
  ["backup/create", "admin", "write"],
  ["backup/restore", "admin", "write local"],
  ["update/check", "read", ""],
  ["update/apply", "admin", "write local"],
  ["check/run", "read", "write"],
  ["report/create", "admin", "write"],
  ["device/list", "admin", ""],
  ["device/revoke", "confirm", "write"],
  ["token/list", "admin", ""],
  ["token/create", "admin", "write local"],
  ["token/revoke", "confirm", "write"],
  ["remote/status", "read", ""],
  ["remote/enable", "admin", "write local"],
  ["remote/disable", "confirm", "write"],
  ["cex/status", "read", ""],
  ["cex/connect", "admin", "write local"],
  ["cex/disconnect", "confirm", "write"],
  ["upload/start", "chat", ""],
  ["push/subscribe", "read", "subscribe"],
  ["push/unsubscribe", "read", "subscribe"],
  ["log/follow", "admin", "subscribe"],
  ["log/unfollow", "admin", "subscribe"],
  ["binanceAgent/list", "read", ""],
  ["binanceAgent/connect", "admin", "write local"],
  ["binanceAgent/timeline", "read", ""],
  ["binanceAgent/setLimits", "confirm", "write"],
  ["binanceAgent/pause", "confirm", "write"],
  ["binanceAgent/resume", "admin", "write"],
  ["binanceAgent/stop", "confirm", "write"],
  ["binanceAgent/record", "read", "write"],
  ["binanceAgent/report", "agent", "write"],
] as const;

function rowOf(name: OperationName): readonly [string, string, string] {
  const operation = operations[name];
  const columns = [
    operation.kind === "read" ? "" : operation.kind,
    operation.transport === "ipc" ? "local" : "",
    operation.answeredBy === "runtime" ? "routed" : "",
  ].filter((column) => column !== "");
  return [name, operation.scope, columns.join(" ")];
}

function byName(
  left: readonly [string, string, string],
  right: readonly [string, string, string],
): number {
  return left[0].localeCompare(right[0]);
}

const kinds = operationNames.map((name) => [name, operations[name].kind] as const);

const scopeCases = operationNames.flatMap((name) => {
  const { scope, scopeCase } = operations[name];
  return scopeCase === undefined ? [] : [[name, scope, scopeCase]];
});

function isFiledUnderItsName(name: OperationName): boolean {
  return operations[name].name === name && /^[a-z][a-zA-Z]*\/[a-z][a-zA-Z]*$/.test(name);
}

describe("operations", () => {
  it("lists every operation of the spec, each with exactly one scope and its columns", () => {
    const table = operationNames.map(rowOf);
    expect(table).toHaveLength(126);
    expect(table.toSorted(byName)).toStrictEqual(specTable.toSorted(byName));
  });

  it("gives each operation one scope of the protocol", () => {
    const outside = operationNames.filter((name) => !scopes.includes(operations[name].scope));
    expect(outside).toStrictEqual([]);
  });

  it("names the other scope of the calls that need one, and when", () => {
    expect(scopeCases).toStrictEqual([
      ["intent/cancel", "confirm", { scope: "propose", when: "ownIntent" }],
      ["limit/set", "confirm", { scope: "loosen", when: "looser" }],
      ["sendLevel/set", "confirm", { scope: "loosen", when: "looser" }],
      ["approval/set", "confirm", { scope: "loosen", when: "autoMode" }],
      ["notes/write", "agent", { scope: "admin", when: "ownerNote" }],
      ["check/run", "read", { scope: "admin", when: "fix" }],
      ["binanceAgent/setLimits", "confirm", { scope: "admin", when: "looser" }],
    ]);
  });

  it("files each operation under its own name, domain/action", () => {
    expect(operationNames.filter((name) => !isFiledUnderItsName(name))).toStrictEqual([]);
  });

  it("asks an idempotency key of every write and of nothing else", () => {
    const keyed = operationNames.filter((name) => operations[name].idempotency === "key");
    const writes = kinds.filter(([, kind]) => kind === "write").map(([name]) => name);
    expect(keyed).toStrictEqual(writes);
    expect(writes).toHaveLength(75);
  });

  it("dates every operation to the first protocol version", () => {
    expect(new Set(operationNames.map((name) => operations[name].since))).toStrictEqual(
      new Set(["2026.10.0"]),
    );
  });

  it("tells operation names from other text", () => {
    expect(isOperationName("intent/propose")).toBe(true);
    expect(isOperationName("intent/sign")).toBe(false);
    expect(isOperationName("toString")).toBe(false);
  });
});
