import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { BinferenceError } from "../errors/binference-error.js";
import type { HttpRequest } from "../http-exchange.js";
import { throwProxiedFailure } from "./proxied-failure.js";

const request = (signal = new AbortController().signal): HttpRequest => ({
  method: "POST",
  url: "https://api.telegram.org/botSECRET/sendMessage",
  signal,
});

// An error as undici or Node raises it, naming the proxy as they do.
function raised(message: string, code?: string): Error {
  const error = new Error(message);
  return code === undefined ? error : Object.assign(error, { code });
}

function caught(cause: ErrorOptions["cause"], made = request()): BinferenceError {
  try {
    throwProxiedFailure(made, cause);
  } catch (error) {
    if (error instanceof BinferenceError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a throw");
}

describe("throwProxiedFailure", () => {
  it("throws the signal's reason once aborted", () => {
    const controller = new AbortController();
    controller.abort(new Error("stopped"));
    expect(() => throwProxiedFailure(request(controller.signal), raised("any"))).toThrow("stopped");
  });

  it("throws a BinferenceError as it is", () => {
    const own = new BinferenceError({ code: "http.answer_too_large", message: "big" });
    expect(caught(own)).toBe(own);
  });

  it.each([
    "Proxy response (407) !== 200 when HTTP Tunneling",
    "Proxy Authentication Required (407)",
  ])("reads a 407 as the proxy asking for credentials: %s", (message) => {
    expect(caught(raised(message, "UND_ERR_ABORTED"))).toMatchObject({
      code: "http.proxy_auth",
      retryable: false,
    });
  });

  it.each([
    [403, false],
    [502, true],
    [503, true],
  ])("reads a %d answer to the tunnel as the proxy refusing, retryable %s", (status, again) => {
    const cause = raised(`Proxy response (${String(status)}) !== 200 when HTTP Tunneling`);
    expect(caught(cause)).toMatchObject({
      code: "http.proxy_refused",
      retryable: again,
      details: { status },
    });
  });

  it.each(["ECONNREFUSED", "ENOTFOUND", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_PRX_CONN"])(
    "reads %s as no connection to the proxy",
    (code) => {
      const cause = raised(`connect ${code} 203.0.113.9:3128`, code);
      const error = caught(cause);
      expect(error).toMatchObject({ code: "http.proxy_unreachable", retryable: true });
      expect(inspect(error, { depth: null, showHidden: true })).not.toContain("203.0.113.9");
    },
  );

  it("reads any other failure as no answer, keeping no cause", () => {
    const error = caught(raised("other side closed at 203.0.113.9:3128", "UND_ERR_SOCKET"));
    expect(error).toMatchObject({
      code: "http.unreachable",
      retryable: true,
      details: { method: "POST", origin: "https://api.telegram.org" },
    });
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error.details)).not.toContain("SECRET");
  });

  it("reads a reset after the tunnel opened as no answer from the host, not as the proxy down", () => {
    const reset = caught(raised("read ECONNRESET", "ECONNRESET"));
    expect(reset).toMatchObject({ code: "http.unreachable", retryable: true });
  });

  it("reads a cause that is no error as no answer", () => {
    expect(caught("refused")).toMatchObject({ code: "http.unreachable" });
  });
});
