import { describe, expect, it } from "vitest";
import { ids, swapRequest } from "../examples/wire-values.js";
import type { CallFrame } from "../frames/call-frame.schema.js";
import { operationNames, operations } from "./operations.js";
import { parseCall } from "./parse-call.js";

function callOf(op: string, args: unknown): CallFrame {
  return { t: "call", id: "7", op, args };
}

function keyedCallOf(op: string, args: unknown, key: string): CallFrame {
  return { ...callOf(op, args), key };
}

const writes = operationNames.filter((name) => operations[name].kind === "write");
const others = operationNames.filter((name) => operations[name].kind !== "write");

describe("parseCall", () => {
  it.each(writes)("refuses %s without an idempotency key", (name) => {
    expect(parseCall(callOf(name, {}))).toStrictEqual({
      ok: false,
      error: "protocol.key_required",
    });
  });

  it("refuses a valid proposal without a key, and takes it with one", () => {
    expect(parseCall(callOf("intent/propose", swapRequest))).toStrictEqual({
      ok: false,
      error: "protocol.key_required",
    });
    expect(parseCall(keyedCallOf("intent/propose", swapRequest, "k-1"))).toMatchObject({
      ok: true,
      value: {
        op: "intent/propose",
        key: "k-1",
        args: { kind: "swap", amount: { base: 1_500_000_000_000_000_000n } },
      },
    });
  });

  it.each(others)("needs no key for %s, which writes nothing", (name) => {
    expect(parseCall(callOf(name, {}))).not.toStrictEqual({
      ok: false,
      error: "protocol.key_required",
    });
  });

  it("decodes the args of a read without a key", () => {
    expect(parseCall(callOf("agent/get", { agent: ids.agent }))).toStrictEqual({
      ok: true,
      value: { op: "agent/get", args: { agent: ids.agent } },
    });
  });

  it("refuses an operation the protocol does not have", () => {
    expect(parseCall(keyedCallOf("intent/sign", {}, "k-1"))).toStrictEqual({
      ok: false,
      error: "protocol.unknown_op",
    });
  });

  it.each([
    ["a field the operation does not know", { agent: ids.agent, extra: true }],
    ["an id of another kind", { agent: ids.wallet }],
    ["no args object", "agent"],
  ] as const)("refuses args with %s", (_name, args) => {
    expect(parseCall(callOf("agent/get", args))).toStrictEqual({
      ok: false,
      error: "protocol.bad_args",
    });
  });

  it("takes a ledger export of live or paper fills, live when no mode is named", () => {
    const modes = [{}, { mode: "live" }, { mode: "paper" }, { mode: "both" }] as const;
    const taken = modes.map((args) => parseCall(keyedCallOf("ledger/export", args, "k-3")).ok);
    expect(taken).toStrictEqual([true, true, true, false]);
  });

  it("refuses an amount written as a number", () => {
    const args = { ...swapRequest, amount: { base: 1.5 } };
    expect(parseCall(keyedCallOf("intent/propose", args, "k-2"))).toStrictEqual({
      ok: false,
      error: "protocol.bad_args",
    });
  });
});
