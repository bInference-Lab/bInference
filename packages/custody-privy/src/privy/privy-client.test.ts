import { createSecret, type HttpRequest, type HttpResponse } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { fetchOver, privySettings } from "./privy-client.js";

function recording(response: HttpResponse): {
  readonly sent: HttpRequest[];
  readonly http: { request: (request: HttpRequest) => Promise<HttpResponse> };
} {
  const sent: HttpRequest[] = [];
  return {
    sent,
    http: {
      request: async (request) => {
        sent.push(request);
        return Promise.resolve(response);
      },
    },
  };
}

const ok = { status: 200, headers: { "content-type": "application/json" }, body: "{}" };

describe("the SDK's fetch over the Http port", () => {
  it("forwards the method, the URL, the headers in lowercase and a text body", async () => {
    const { sent, http } = recording(ok);
    const send = fetchOver(http, new AbortController().signal);
    const answer = await send(new URL("https://api.privy.io/v1/wallets"), {
      method: "post",
      headers: { "Privy-App-Id": "app" },
      body: "{}",
    });
    await send(new Request("https://api.privy.io/v1/policies/p"));
    await send("https://api.privy.io/v1/key_quorums/q");
    expect(answer.status).toBe(200);
    expect(sent.map((request) => [request.method, request.url])).toStrictEqual([
      ["POST", "https://api.privy.io/v1/wallets"],
      ["GET", "https://api.privy.io/v1/policies/p"],
      ["GET", "https://api.privy.io/v1/key_quorums/q"],
    ]);
    expect(sent[0]?.headers).toStrictEqual({ "privy-app-id": "app" });
    expect(sent[0]?.body).toBe("{}");
  });

  it("stops a request when the call's signal or the SDK's own signal aborts", async () => {
    const { sent, http } = recording(ok);
    const call = new AbortController();
    const sdk = new AbortController();
    await fetchOver(http, call.signal)("https://api.privy.io/v1/wallets/w", { signal: sdk.signal });
    call.abort();
    expect(sent[0]?.signal.aborted).toBe(true);
    const { sent: more, http: other } = recording(ok);
    await fetchOver(other, new AbortController().signal)("https://api.privy.io/v1/wallets/w", {
      signal: sdk.signal,
    });
    sdk.abort();
    expect(more[0]?.signal.aborted).toBe(true);
  });

  it("refuses a method or a body it does not send, before anything leaves", async () => {
    const { sent, http } = recording(ok);
    const send = fetchOver(http, new AbortController().signal);
    await expect(
      send("https://api.privy.io/v1/wallets/w", { method: "PATCH" }),
    ).rejects.toMatchObject({
      code: "custody.privy_request_unsupported",
    });
    await expect(
      send("https://api.privy.io/v1/wallets", { method: "POST", body: new Uint8Array([1]) }),
    ).rejects.toMatchObject({ code: "custody.privy_request_unsupported" });
    expect(sent).toHaveLength(0);
  });

  it("answers a 204 with no body", async () => {
    const { http } = recording({ status: 204, headers: {}, body: "" });
    const answer = await fetchOver(http, new AbortController().signal)("https://api.privy.io/v1/x");
    expect([answer.status, await answer.text()]).toStrictEqual([204, ""]);
  });
});

describe("privySettings", () => {
  it("takes Privy's origin and a 15 s timeout unless set", () => {
    const settings = privySettings({
      http: recording(ok).http,
      clock: createManualClock(0),
      appId: "app",
      appSecret: createSecret("secret"),
    });
    expect([settings.origin, settings.timeoutMs]).toStrictEqual(["https://api.privy.io", 15_000]);
  });
});
