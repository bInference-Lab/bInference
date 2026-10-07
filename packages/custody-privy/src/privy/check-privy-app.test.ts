import { inspect } from "node:util";
import {
  BinferenceError,
  createSecret,
  type Http,
  type HttpRequest,
  type HttpResponse,
  type Secret,
} from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createFakePrivy } from "../testing/fake-privy.js";
import { checkPrivyApp } from "./check-privy-app.js";

const secretText = "privy-app-secret-for-the-check";
const clock = createManualClock(1_790_000_000_000);
const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

interface Recorded extends Http {
  readonly sent: HttpRequest[];
}

// Records every request, then hands it to `answer`, which may answer, throw or never answer.
function recorded(answer: (request: HttpRequest) => Promise<HttpResponse>): Recorded {
  const sent: HttpRequest[] = [];
  return {
    sent,
    async request(request) {
      request.signal.throwIfAborted();
      sent.push(request);
      return answer(request);
    },
  };
}

function json(status: number, body: object): HttpResponse {
  return { status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function answering(response: HttpResponse): Recorded {
  return recorded(async () => Promise.resolve(response));
}

function check(http: Http, appSecret: Secret = createSecret(secretText), appId = "app-id") {
  return checkPrivyApp({ http, clock, appId, appSecret, timeoutMs: 1_000 }, live());
}

describe("checking a Privy app's id and secret", () => {
  it("reads one page of one Ethereum wallet with Basic auth, and nothing else", async () => {
    const privy = createFakePrivy({ clock, random: createSeededRandom(5) });
    const http = recorded(async (request) => privy.http.request(request));
    await expect(check(http, privy.appSecret, privy.appId)).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    });
    expect(http.sent).toHaveLength(1);
    const [request] = http.sent;
    expect(request?.method).toBe("GET");
    expect(request?.body).toBeUndefined();
    const url = new URL(String(request?.url));
    expect(`${url.origin}${url.pathname}`).toBe("https://api.privy.io/v1/wallets");
    expect(Object.fromEntries(url.searchParams)).toStrictEqual({
      limit: "1",
      chain_type: "ethereum",
    });
    expect(request?.headers?.["privy-app-id"]).toBe(privy.appId);
  });

  it("answers rejected when the fake app refuses the secret or the app id", async () => {
    const privy = createFakePrivy({ clock, random: createSeededRandom(6) });
    await expect(
      check(privy.http, createSecret("another secret"), privy.appId),
    ).resolves.toStrictEqual({ ok: false, error: "rejected" });
    await expect(check(privy.http, privy.appSecret, "another-app")).resolves.toStrictEqual({
      ok: false,
      error: "rejected",
    });
  });

  it.each([401, 403, 404])("answers rejected for a %i answer", async (status) => {
    await expect(
      check(answering(json(status, { error: "Invalid app ID or app secret" }))),
    ).resolves.toStrictEqual({ ok: false, error: "rejected" });
  });

  it.each([
    [429, "custody.privy_busy", true],
    [400, "custody.privy_refused", true],
    [500, "custody.privy_failed", true],
    [503, "custody.privy_failed", true],
  ] as const)("throws a %i answer as %s, retryable as a read", async (status, code, retryable) => {
    const failed = await check(answering(json(status, { error: secretText }))).catch(
      (error: unknown) => error,
    );
    expect(failed).toBeInstanceOf(BinferenceError);
    expect(failed).toMatchObject({ code, retryable, details: { path: "/v1/wallets", status } });
    expect(JSON.stringify(failed) + inspect(failed)).not.toContain(secretText);
  });

  it("refuses an answer that is no page of wallets", async () => {
    await expect(check(answering(json(200, { data: [{ name: "x" }] })))).rejects.toMatchObject({
      code: "custody.privy_malformed",
      retryable: false,
    });
  });

  it("throws privy_unreachable when no answer comes before the timeout", async () => {
    const never = recorded(
      async (request) =>
        new Promise((_, reject) => {
          request.signal.addEventListener("abort", () => {
            reject(new BinferenceError({ code: "http.unreachable", message: "stopped" }));
          });
        }),
    );
    const checking = check(never).catch((error: unknown) => error);
    await clock.advance(1_000);
    await expect(checking).resolves.toMatchObject({
      code: "custody.privy_unreachable",
      retryable: true,
    });
    expect(never.sent).toHaveLength(1);
  });

  it("sends nothing on an aborted signal", async () => {
    const http = answering(json(200, { data: [] }));
    const reason = new Error("stopped");
    const checking = checkPrivyApp(
      { http, clock, appId: "app-id", appSecret: createSecret(secretText) },
      { signal: AbortSignal.abort(reason) },
    );
    await expect(checking).rejects.toBe(reason);
    expect(http.sent).toHaveLength(0);
  });
});
