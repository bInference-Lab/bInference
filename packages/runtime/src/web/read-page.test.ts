import { BinferenceError, type HttpRequest } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import type { StreamingHttp } from "../providers/ports.js";
import { createRecordedHttp, type RecordedAnswer } from "../testing/recorded-http.js";
import { htmlAnswer, redirectTo, testLookup } from "../testing/recorded-web.js";
import { maxPageBytes, pageTimeoutMs, readPublicPage } from "./read-page.js";

const live = (): AbortSignal => new AbortController().signal;

function readerOn(answers: readonly RecordedAnswer[]) {
  const http = createRecordedHttp(answers);
  const clock = createManualClock();
  return { http, clock, parts: { http, clock, lookup: testLookup } };
}

const page = htmlAnswer(
  "<html><head><title>Fees &amp; limits</title><script>steal()</script></head>" +
    "<body><h1>Fees</h1><p>A swap pays 0.25%.</p></body></html>",
);

describe("readPublicPage", () => {
  it("reads a public page as its title and text, asking for it with no cookie or compression", async () => {
    const { http, parts } = readerOn([page]);
    await expect(
      readPublicPage("https://docs.example.com/fees#top", parts, live()),
    ).resolves.toStrictEqual({
      kind: "page",
      url: "https://docs.example.com/fees",
      title: "Fees & limits",
      text: "Fees\n\nA swap pays 0.25%.",
      cut: false,
    });
    expect(http.requests).toMatchObject([
      {
        method: "GET",
        url: "https://docs.example.com/fees",
        publicOnly: true,
        headers: { "accept-encoding": "identity" },
      },
    ]);
    expect(http.requests[0]?.headers).toStrictEqual({
      accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
      "accept-encoding": "identity",
    });
  });

  it.each([
    ["http://127.0.0.1:8080/admin", "private_host"],
    ["http://localhost/", "private_host"],
    ["http://[::1]/", "private_host"],
    ["http://169.254.169.254/latest/meta-data/", "private_host"],
    ["http://10.0.0.8/", "private_host"],
    ["http://2130706433/", "private_host"],
    ["file:///etc/passwd", "scheme"],
    ["https://user:pass@docs.example.com/", "credentials"],
    ["http://nas.private.example.net/", "private_address"],
    ["http://unknown.example.net/", "private_address"],
  ])("refuses %s before any request", async (url, reason) => {
    const { http, parts } = readerOn([page]);
    await expect(readPublicPage(url, parts, live())).resolves.toStrictEqual({
      kind: "refused",
      reason,
    });
    expect(http.requests).toHaveLength(0);
  });

  it("follows a relative redirect and checks where it leads", async () => {
    const { http, parts } = readerOn([redirectTo("/moved"), page]);
    await expect(
      readPublicPage("https://docs.example.com/old", parts, live()),
    ).resolves.toMatchObject({
      kind: "page",
      url: "https://docs.example.com/moved",
    });
    expect(http.requests.map((request) => request.url)).toStrictEqual([
      "https://docs.example.com/old",
      "https://docs.example.com/moved",
    ]);
  });

  it.each([
    ["loopback", "http://127.0.0.1/admin", "private_host"],
    ["the metadata service", "http://169.254.169.254/latest/meta-data/", "private_host"],
    ["IPv6 loopback", "http://[::1]:9000/", "private_host"],
    [
      "a name that resolves to a private address",
      "http://nas.private.example.net/",
      "private_address",
    ],
    ["a file", "file:///etc/passwd", "scheme"],
  ])("refuses a redirect to %s without following it", async (_name, location, reason) => {
    const { http, parts } = readerOn([redirectTo(location), page]);
    await expect(
      readPublicPage("https://docs.example.com/go", parts, live()),
    ).resolves.toStrictEqual({
      kind: "refused",
      reason,
    });
    expect(http.requests).toHaveLength(1);
  });

  it("refuses a fourth redirect and a redirect that names no place", async () => {
    const hops = ["/1", "/2", "/3", "/4"].map((path) => redirectTo(path));
    const { http, parts } = readerOn([...hops, page]);
    await expect(
      readPublicPage("https://docs.example.com/0", parts, live()),
    ).resolves.toStrictEqual({
      kind: "refused",
      reason: "too_many_redirects",
    });
    expect(http.requests).toHaveLength(4);
    const nowhere = readerOn([{ status: 301, headers: {}, chunks: [] }]);
    await expect(
      readPublicPage("https://docs.example.com/", nowhere.parts, live()),
    ).resolves.toStrictEqual({
      kind: "refused",
      reason: "redirect_without_location",
    });
  });

  it("refuses a name that rebinds to a private address when it connects", async () => {
    const rebinds: StreamingHttp = {
      open: async (request: HttpRequest) => {
        throw new BinferenceError({
          code: "http.private_address",
          message: "The host resolves to an address that is not on the internet.",
          details: { host: new URL(request.url).hostname },
        });
      },
    };
    const parts = { http: rebinds, clock: createManualClock(), lookup: testLookup };
    await expect(
      readPublicPage("https://rebind.example.com/", parts, live()),
    ).resolves.toStrictEqual({
      kind: "refused",
      reason: "private_address",
    });
  });

  it("reads a 5 MB page only to 2 MiB and says it was cut", async () => {
    const mebibyte = "a".repeat(1024 * 1024);
    const large: RecordedAnswer = {
      status: 200,
      headers: { "content-type": "text/plain" },
      chunks: Array.from({ length: 5 }, () => mebibyte),
    };
    const { parts } = readerOn([large]);
    await expect(readPublicPage("https://big.example.com/", parts, live())).resolves.toStrictEqual({
      kind: "page",
      url: "https://big.example.com/",
      text: "a".repeat(maxPageBytes),
      cut: true,
    });
  });

  it.each([
    [
      { status: 404, headers: {}, chunks: [] },
      { reason: "status", status: 404 },
    ],
    [
      { status: 200, headers: { "content-type": "image/png" }, chunks: ["png"] },
      { reason: "content_type", contentType: "image/png" },
    ],
    [
      { status: 200, headers: {}, chunks: ["?"] },
      { reason: "content_type", contentType: "none" },
    ],
    [
      {
        status: 200,
        headers: { "content-type": "text/html", "content-encoding": "gzip" },
        chunks: ["?"],
      },
      { reason: "encoding" },
    ],
  ])("refuses an answer it does not read: %j", async (answer, refusal) => {
    const { parts } = readerOn([answer]);
    await expect(readPublicPage("https://docs.example.com/", parts, live())).resolves.toStrictEqual(
      {
        kind: "refused",
        ...refusal,
      },
    );
  });

  it("gives up after 20 seconds and when no server answers", async () => {
    const hanging = {
      status: 200,
      headers: { "content-type": "text/plain" },
      chunks: ["a"],
      hang: true,
    };
    const { clock, parts } = readerOn([hanging]);
    const reading = readPublicPage("https://slow.example.com/", parts, live());
    await clock.advance(pageTimeoutMs);
    await expect(reading).resolves.toStrictEqual({ kind: "refused", reason: "timeout" });
    const silent = readerOn([]);
    await expect(
      readPublicPage("https://docs.example.com/", silent.parts, live()),
    ).resolves.toStrictEqual({
      kind: "refused",
      reason: "unreachable",
    });
  });

  it("rejects with the reason of the turn's own stop", async () => {
    const { parts } = readerOn([page]);
    const stop = new AbortController();
    stop.abort(new Error("stopped"));
    await expect(readPublicPage("https://docs.example.com/", parts, stop.signal)).rejects.toThrow(
      "stopped",
    );
  });
});
