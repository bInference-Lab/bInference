import { assetRefSchema, type HttpResponse } from "@binference/plugin-sdk";
import { createScriptedHttp, tokenRiskSourceContract } from "@binference/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { createHoneypotSource } from "./honeypot-source.js";
import {
  honeypotAnswer,
  taxedTokenAnswer,
  tokenNotFoundAnswer,
} from "./testing/recorded-answers.js";

const taxed = "0xe0A281deFf5c9d8d67aF09D39340E134Ac81b82E";
const honeypot = "0xE77E41c26B6460Afccb9971CA11Fa968647c43B7";
const dead = "0x000000000000000000000000000000000000dEaD";
const urlOf = (address: string, chainId = "56"): string =>
  `https://api.honeypot.is/v2/IsHoneypot?address=${address}&chainID=${chainId}`;
const assetOf = (address: string, chain = "eip155:56") =>
  assetRefSchema.parse(`${chain}/erc20:${address}`);
const live = { signal: new AbortController().signal };
const low = { risk: "low", riskLevel: 1 };

function answer(
  body: string,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): HttpResponse {
  return { status, headers: { "content-type": "application/json", ...headers }, body };
}

function sourceAnswering(response: HttpResponse, address = taxed) {
  const http = createScriptedHttp([{ method: "GET", url: urlOf(address), response }]);
  return { http, source: createHoneypotSource({ http }) };
}

// An answer with a summary and the fields given.
function answerWith(
  fields: Readonly<Record<string, unknown>>,
  summary: Readonly<Record<string, unknown>> = { risk: "low", riskLevel: 1 },
): HttpResponse {
  return answer(JSON.stringify({ summary: { flags: [], ...summary }, ...fields }));
}

describe("honeypot risk source", () => {
  it.each(
    tokenRiskSourceContract({
      create: () => {
        const http = createScriptedHttp([
          { method: "GET", url: urlOf(taxed), response: answer(taxedTokenAnswer) },
          { method: "GET", url: urlOf(dead), response: answer(tokenNotFoundAnswer, 404) },
        ]);
        return {
          source: createHoneypotSource({ http }),
          known: assetOf(taxed),
          unknown: assetOf(dead),
          down: createHoneypotSource({ http: createScriptedHttp([]) }),
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("asks for the token on its chain, with no key, and reads code it cannot see", async () => {
    const { http, source } = sourceAnswering(answer(taxedTokenAnswer));
    await expect(source.check(assetOf(taxed), live)).resolves.toStrictEqual({
      ok: true,
      value: { flags: ["closed_source"], liquidityUsdMicros: 39_045_047_551_059n },
    });
    expect(http.requests().map(({ url, headers }) => ({ url, headers }))).toStrictEqual([
      { url: urlOf(taxed), headers: undefined },
    ]);
  });

  it("reads a honeypot whose test sale failed, with its sale limit and its holders' failures", async () => {
    const { source } = sourceAnswering(answer(honeypotAnswer), honeypot);
    await expect(source.check(assetOf(honeypot), live)).resolves.toStrictEqual({
      ok: true,
      value: {
        flags: ["honeypot", "cannot_sell", "sell_limit", "sell_failures", "siphoned", "high_risk"],
        liquidityUsdMicros: 69_962_426_802n,
      },
    });
  });

  it.each<[string, HttpResponse, readonly string[]]>([
    [
      "a honeypot verdict alone",
      answerWith({ honeypotResult: { isHoneypot: true } }),
      ["honeypot"],
    ],
    ["a honeypot risk name alone", answerWith({}, { risk: "honeypot" }), ["honeypot"]],
    [
      "a risk level from 90 as a honeypot",
      answerWith({}, { risk: "unknown", riskLevel: 90 }),
      ["honeypot", "high_risk"],
    ],
    [
      "a risk level from 60 as a high risk",
      answerWith({}, { risk: "high", riskLevel: 60 }),
      ["high_risk"],
    ],
    ["a risk level below 60 as no finding", answerWith({}, { risk: "high", riskLevel: 59 }), []],
    ["an unknown risk with no level as no finding", answerWith({}, { risk: "unknown" }), []],
    [
      "a test buy that could not happen",
      answerWith({ simulationResult: { buyTax: 100, sellTax: 0, transferTax: 0 } }, low),
      ["cannot_buy"],
    ],
    [
      "a tax below whole as no finding",
      answerWith({ simulationResult: { buyTax: 3, sellTax: 40, transferTax: 0 } }, low),
      [],
    ],
    [
      "a proxy with open code",
      answerWith({
        contractCode: {
          openSource: true,
          rootOpenSource: true,
          isProxy: true,
          hasProxyCalls: true,
        },
      }),
      ["proxy"],
    ],
  ])("reads %s", async (_case, response, flags) => {
    const { source } = sourceAnswering(response);
    await expect(source.check(assetOf(taxed), live)).resolves.toStrictEqual({
      ok: true,
      value: { flags },
    });
  });

  it("reads the summary flags in any case, and leaves out those it does not list", async () => {
    const summary = {
      risk: "medium",
      flags: [
        { flag: "TRANSFER_BLOCKED", severity: "medium" },
        { flag: "one_sell_per_block_limit", severity: "medium" },
        { flag: "medium_gas", severity: "info" },
        { flag: "all_snipers_honeypot", severity: "info" },
      ],
    };
    const { source } = sourceAnswering(answer(JSON.stringify({ summary })));
    await expect(source.check(assetOf(taxed), live)).resolves.toStrictEqual({
      ok: true,
      value: { flags: ["transfer_blocked", "sell_limit"] },
    });
  });

  it.each([
    ["a token it does not know", tokenNotFoundAnswer],
    ["a token with no pair it can test", '{"code":404,"error":"pair not found"}'],
  ])("reads HTTP 404 for %s as not covered", async (_case, body) => {
    const { source } = sourceAnswering(answer(body, 404));
    await expect(source.check(assetOf(taxed), live)).resolves.toStrictEqual({
      ok: false,
      error: "not_covered",
    });
  });

  it("answers not covered without asking for a chain its docs do not list, or the coin", async () => {
    const { http, source } = sourceAnswering(answer(taxedTokenAnswer));
    await expect(source.check(assetOf(taxed, "eip155:137"), live)).resolves.toMatchObject({
      error: "not_covered",
    });
    const coin = assetRefSchema.parse("eip155:56/slip44:714");
    await expect(source.check(coin, live)).resolves.toMatchObject({ error: "not_covered" });
    expect(http.requests()).toStrictEqual([]);
  });

  it.each<[string, HttpResponse, { readonly code: string; readonly retryable: boolean }]>([
    [
      "HTTP 429",
      answer("{}", 429, { "x-ratelimit-reset": "1791567160" }),
      { code: "honeypot.rate_limited", retryable: true },
    ],
    [
      "a server error",
      answer('{"code":500,"error":"busy"}', 500),
      { code: "honeypot.unavailable", retryable: true },
    ],
    [
      "an invalid chain",
      answer('{"code":400,"error":"Invalid chain"}', 400),
      { code: "honeypot.unavailable", retryable: false },
    ],
    ["text that is no JSON", answer("busy"), { code: "honeypot.unavailable", retryable: false }],
    [
      "an answer with no summary",
      answer('{"simulationSuccess":true}'),
      { code: "honeypot.unavailable", retryable: false },
    ],
  ])("throws on %s", async (_case, response, fault) => {
    const { source } = sourceAnswering(response);
    await expect(source.check(assetOf(taxed), live)).rejects.toMatchObject(fault);
  });

  it("names when a rate limit resets, never the service's own text", async () => {
    const reset = { "x-ratelimit-reset": "1791567160" };
    const { source } = sourceAnswering(answer('{"code":429,"error":"slow down"}', 429, reset));
    await expect(source.check(assetOf(taxed), live)).rejects.toMatchObject({
      details: { status: 429, resetAt: "1791567160" },
    });
  });
});
