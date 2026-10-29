import type { HttpRequest, HttpResponse } from "@binference/core";
import { createManualClock, createScriptedHttp, httpContract } from "@binference/core/testing";
import { endpointModelChain } from "@binference/runtime";
import { startStandInModelServer } from "@binference/runtime/testing";
import { describe, expect, it } from "vitest";
import { createSystemHttp } from "../runtime/system-http.js";
import { createEvaluationHttp } from "./evaluation-http.js";
import { loadScenarios, scenarioFolder } from "./load-scenarios.js";
import { runEvaluation } from "./run-evaluation.js";

const book = await loadScenarios(scenarioFolder, AbortSignal.timeout(10_000));
const clock = createManualClock(1_767_261_600_000);
const balance = book.scenarios
  .filter((scenario) => scenario.locale === "en")
  .filter((scenario) => scenario.id === "usdt-balance");
const loopbackUrl = "http://127.0.0.1:11434/v1/chat/completions";
const okUrl = "https://models.example.com/ok";
const missingUrl = "https://models.example.com/missing";

// A Chat Completions stream, as a model server on the loopback answers it.
const chunk = (fields: string): string =>
  `data: {"id":"c1","object":"chat.completion.chunk","created":1767261600,"model":"local","choices":[${fields}]}\n\n`;
const answer = {
  status: 200,
  headers: { "content-type": "text/event-stream" },
  chunks: [
    chunk(
      '{"index":0,"delta":{"role":"assistant","content":"You hold 200 USDT."},"finish_reason":null}',
    ),
    chunk('{"index":0,"delta":{},"finish_reason":"stop"}'),
    "data: [DONE]\n\n",
  ],
};

// What reached the Http underneath: each request's URL and whether it went out public-only.
function recording(): {
  readonly http: { request(request: HttpRequest): Promise<HttpResponse> };
  readonly sent: { url: string; publicOnly: boolean }[];
} {
  const sent: { url: string; publicOnly: boolean }[] = [];
  return {
    sent,
    http: {
      async request(request) {
        sent.push({ url: request.url, publicOnly: request.publicOnly === true });
        return Promise.resolve({ status: 200, headers: {}, body: "" });
      },
    },
  };
}

describe("createEvaluationHttp", () => {
  it.each(
    httpContract({
      create: () => ({
        http: createEvaluationHttp(
          createScriptedHttp([
            { method: "GET", url: okUrl, response: { status: 200, headers: {}, body: "ok" } },
            { method: "GET", url: missingUrl, response: { status: 404, headers: {}, body: "" } },
          ]),
        ),
        okUrl,
        missingUrl,
        unreachableUrl: "https://models.example.com/nothing",
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("sends a request to the loopback as it came, and every other one public-only", async ({
    signal,
  }) => {
    const { http, sent } = recording();
    const evaluation = createEvaluationHttp(http);
    const urls = [
      loopbackUrl,
      "http://[::1]:11434/v1/chat/completions",
      "http://localhost:11434/v1/chat/completions",
      "http://10.0.0.7:11434/v1/chat/completions",
      "https://models.example.com/v1/chat/completions",
    ];
    for (const url of urls) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- the order the test reads them in
      await evaluation.request({ method: "POST", url, signal });
    }
    await evaluation.request({ method: "GET", url: loopbackUrl, signal, publicOnly: true });
    expect(sent.map((request) => request.publicOnly)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
  });

  it("reaches a model server on the loopback for a scenario's run", async ({ signal }) => {
    const server = await startStandInModelServer([answer]);
    const http = createSystemHttp({ version: "test" });
    try {
      const endpoint = { baseUrl: `${server.origin}/v1`, model: "local" };
      const chain = () =>
        endpointModelChain(endpoint, {
          http: createEvaluationHttp(http),
          clock,
          timeoutMs: 30_000,
        });
      const [report] = await runEvaluation({
        models: [{ name: "local", chain }],
        scenarios: balance,
        world: book.world,
        clock,
        signal,
        deadline: () => new AbortController().signal,
        runs: 1,
      });
      expect(report?.scenarios[0]?.runs[0]?.status).toBe("passed");
      expect(server.requests.map((request) => request.path)).toEqual(["/v1/chat/completions"]);
    } finally {
      await http.close();
      await server.close();
    }
  });

  it("keeps refusing a public-only request to the loopback, and a private address that is not it", async ({
    signal,
  }) => {
    const server = await startStandInModelServer([answer]);
    const system = createSystemHttp({ version: "test" });
    const evaluation = createEvaluationHttp(system);
    try {
      await expect(
        evaluation.request({ method: "GET", url: server.origin, signal, publicOnly: true }),
      ).rejects.toMatchObject({ code: "http.private_address" });
      await expect(
        evaluation.request({ method: "GET", url: "http://10.0.0.7:11434/v1/models", signal }),
      ).rejects.toMatchObject({ code: "http.private_address" });
      expect(server.requests).toEqual([]);
    } finally {
      await system.close();
      await server.close();
    }
  });
});
