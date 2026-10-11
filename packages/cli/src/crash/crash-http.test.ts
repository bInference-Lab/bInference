import { createScriptedHttp, httpContract } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { crashHttp } from "./crash-http.js";

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
