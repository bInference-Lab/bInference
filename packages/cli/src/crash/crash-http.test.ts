import { BinferenceError, type HttpDownload } from "@binference/core";
import { createScriptedHttp, httpContract, httpDownloadContract } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { crashDownload, crashHttp } from "./crash-http.js";

const endpoints = { relays: "http://127.0.0.1:9101", services: "http://127.0.0.1:9102" };

function answer(status: number, body: string) {
  return { status, headers: {}, body };
}

// The test's relay `a` answers, and Privy's routes answer 404 for what the test lacks.
function subject() {
  const inner = createScriptedHttp([
    { method: "GET", url: `${endpoints.relays}/a`, response: answer(200, "ok") },
    { method: "GET", url: `${endpoints.services}/privy/v1/missing`, response: answer(404, "") },
  ]);
  return {
    http: crashHttp(inner, endpoints),
    okUrl: "https://a.relay.test",
    missingUrl: "https://api.privy.io/v1/missing",
    unreachableUrl: "https://example.org/anything",
  };
}

describe("the crash engine's outbound Http", () => {
  it.each(httpContract({ create: subject }))(
    "follows the Http contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );
});

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
const photoPath = `${endpoints.services}/telegram/file/bot1:token/photos/cat.png`;

// The loopback downloads behind the crash engine's: the test's Bot API holds one photo, and
// answers 404 for any other path.
const loopback: HttpDownload = {
  async download(request) {
    request.signal.throwIfAborted();
    if (request.url !== photoPath) {
      return Promise.resolve({ status: 404, headers: {}, bytes: new Uint8Array() });
    }
    if (png.byteLength > request.maxBytes) {
      throw new BinferenceError({ code: "http.answer_too_large", message: "Too large." });
    }
    return Promise.resolve({ status: 200, headers: {}, bytes: png });
  },
};

describe("the crash engine's downloads", () => {
  it.each(
    httpDownloadContract({
      create: () => ({
        download: crashDownload(loopback, endpoints),
        bytesUrl: "https://api.telegram.org/file/bot1:token/photos/cat.png",
        missingUrl: "https://api.telegram.org/file/bot1:token/photos/none.png",
        unreachableUrl: "https://example.org/photo.png",
      }),
    }),
  )("follows the HttpDownload contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
