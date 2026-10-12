import { describe, expect, it } from "vitest";
import { BinferenceError } from "./errors/binference-error.js";
import type { HttpRequest } from "./http-exchange.js";
import { answerHeaders, outboundInit, throwOutboundFailure } from "./outbound-request.js";

const live = new AbortController().signal;
const request: HttpRequest = {
  method: "POST",
  url: "https://api.example.org/v1/items?key=secret",
  headers: { "User-Agent": "someone-else", "content-type": "application/json" },
  body: "{}",
  signal: live,
};

describe("outboundInit", () => {
  it("sends the request with the adapter's user agent in place of the caller's", () => {
    expect(outboundInit(request, "binference/1.2.3")).toStrictEqual({
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "binference/1.2.3" },
      body: "{}",
      signal: live,
    });
  });

  it("sends bytes, or no body at all", () => {
    const bytes = new Uint8Array([1, 2]);
    const { body: _text, ...bare } = request;
    expect([
      outboundInit({ ...bare, bodyBytes: bytes }, "b").body,
      "body" in outboundInit(bare, "b"),
    ]).toStrictEqual([bytes, false]);
  });

  it("refuses a request with two bodies", () => {
    expect(() => outboundInit({ ...request, bodyBytes: new Uint8Array(1) }, "b")).toThrow(
      expect.objectContaining({ code: "http.two_bodies" }),
    );
  });
});

describe("answerHeaders", () => {
  it("lowercases names, joins repeated values and drops missing ones", () => {
    expect(
      answerHeaders({
        "Content-Type": "text/plain",
        "set-cookie": ["a=1", "b=2"],
        gone: undefined,
      }),
    ).toStrictEqual({ "content-type": "text/plain", "set-cookie": "a=1, b=2" });
  });
});

describe("throwOutboundFailure", () => {
  it("throws the signal's reason once the request was stopped", () => {
    const stop = new AbortController();
    const reason = new Error("stopped");
    stop.abort(reason);
    expect(() => throwOutboundFailure({ ...request, signal: stop.signal }, new Error("x"))).toThrow(
      reason,
    );
  });

  it("throws a BinferenceError as it is", () => {
    const refused = new BinferenceError({ code: "http.private_address", message: "No." });
    expect(() => throwOutboundFailure(request, refused)).toThrow(refused);
  });

  it("throws anything else as unreachable, naming only the method and the origin", () => {
    expect(() => throwOutboundFailure(request, new Error("ECONNREFUSED"))).toThrow(
      expect.objectContaining({
        code: "http.unreachable",
        retryable: true,
        details: { method: "POST", origin: "https://api.example.org" },
      }),
    );
  });
});
