import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import { probeProblemOf } from "./proxy-probe.js";

const timedOut = new DOMException("The operation timed out.", "TimeoutError");

describe("probeProblemOf", () => {
  it.each([
    ["http.proxy_auth", { problem: "auth" }],
    ["http.proxy_unreachable", { problem: "unreachable" }],
  ])("reads %s as the proxy's own problem", (code, problem) => {
    const error = new BinferenceError({ code: code as `http.${string}`, message: "proxy" });
    expect(probeProblemOf(error, { hasTimedOut: false, isTunnelled: false })).toStrictEqual(
      problem,
    );
  });

  it("keeps the status the proxy refused the tunnel with", () => {
    const error = new BinferenceError({
      code: "http.proxy_refused",
      message: "refused",
      details: { status: 403 },
    });
    expect(probeProblemOf(error, { hasTimedOut: false, isTunnelled: false })).toStrictEqual({
      problem: "refused",
      status: 403,
    });
  });

  it("reads a probe that ran out of time before any tunnel opened as a proxy that never answered", () => {
    expect(probeProblemOf(timedOut, { hasTimedOut: true, isTunnelled: false })).toStrictEqual({
      problem: "unreachable",
    });
  });

  it("reads a probe that ran out of time in an open tunnel as no answer from the host", () => {
    expect(probeProblemOf(timedOut, { hasTimedOut: true, isTunnelled: true })).toStrictEqual({
      problem: "noAnswer",
    });
  });

  it("reads any other failure as no answer through the proxy", () => {
    const error = new BinferenceError({ code: "http.unreachable", message: "TLS failed." });
    expect(probeProblemOf(error, { hasTimedOut: false, isTunnelled: true })).toStrictEqual({
      problem: "noAnswer",
    });
  });
});
