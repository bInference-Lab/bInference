import type { HostLookup } from "@binference/core";
import type { RecordedAnswer } from "./recorded-http.js";

// Answers of the servers the web tools reach, and a resolver for the names the tests use. No test
// reaches the network.

/** A small HTML page, as a server answers it. */
export function htmlAnswer(
  body: string,
  headers: Readonly<Record<string, string>> = {},
): RecordedAnswer {
  const answer: RecordedAnswer = {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
    chunks: [body],
  };
  return answer;
}

/** A redirect to `location`. */
export function redirectTo(location: string, status = 302): RecordedAnswer {
  return { status, headers: { location }, chunks: [] };
}

/**
 * A resolver for the tests' names: `*.example.com` and `example.org` resolve to a public address,
 * names with `private` in them to a private one, and every other name not at all.
 */
export const testLookup: HostLookup = (hostname, _options, callback) => {
  if (hostname.includes("private")) {
    callback(null, [{ address: "192.168.1.20", family: 4 }]);
  } else if (hostname.endsWith("example.com") || hostname === "example.org") {
    callback(null, [{ address: "93.184.215.14", family: 4 }]);
  } else {
    callback(Object.assign(new Error("not found"), { code: "ENOTFOUND" }), []);
  }
};
