import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import { initFaultOf } from "./init-faults.js";

function privyFault(code: `custody.${string}`, status: number): BinferenceError {
  return new BinferenceError({
    code,
    message: "Privy's API failed a write call.",
    details: { path: "/v1/aggregations", status },
  });
}

describe("initFaultOf", () => {
  it("tells the owner of a full Privy app to make a new app, not to wait", () => {
    expect(initFaultOf(privyFault("custody.privy_aggregations_full", 400))).toMatchObject({
      code: "custody.privy_aggregations_full",
      key: "fault.privyAggregationsFull",
    });
  });

  it("names the refused call and its status, and keeps the retry advice for Privy's failures", () => {
    expect(initFaultOf(privyFault("custody.privy_refused", 400))).toStrictEqual({
      code: "custody.privy_refused",
      key: "fault.privyRefused",
      values: { code: "custody.privy_refused", path: "/v1/aggregations", status: "400" },
    });
    expect(initFaultOf(privyFault("custody.privy_failed", 502)).key).toBe("fault.privyFailed");
  });

  it("gives the unexpected-fault message for a code it does not know", () => {
    const fault = new BinferenceError({ code: "store.locked", message: "Locked." });
    expect(initFaultOf(fault)).toMatchObject({
      key: "fault.unexpected",
      values: { code: "store.locked", path: "?", status: "?" },
    });
  });
});
