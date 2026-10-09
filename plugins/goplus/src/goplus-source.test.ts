import { assetRefSchema, type HttpResponse } from "@binference/plugin-sdk";
import { createScriptedHttp, tokenRiskSourceContract } from "@binference/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { createGoplusSource } from "./goplus-source.js";
import {
  emptyAnswer,
  sellAllBlockedAnswer,
  systemErrorAnswer,
  taxedTokenAnswer,
  unsupportedChainAnswer,
} from "./testing/recorded-answers.js";

const taxed = "0xe0a281deff5c9d8d67af09d39340e134ac81b82e";
const sellAllBlocked = "0x6dc3bcecee446633cf9c95736c07d18d9cc046c4";
const dead = "0x000000000000000000000000000000000000dead";
const urlOf = (address: string): string =>
  `https://api.gopluslabs.io/api/v1/token_security/56?contract_addresses=${address}`;
const assetOf = (address: string) => assetRefSchema.parse(`eip155:56/erc20:${address}`);
const live = { signal: new AbortController().signal };

function answer(body: string, status = 200): HttpResponse {
  return { status, headers: { "content-type": "application/json" }, body };
}

function sourceAnswering(address: string, response: HttpResponse) {
  const http = createScriptedHttp([{ method: "GET", url: urlOf(address), response }]);
  return { http, source: createGoplusSource({ http }) };
}

// One token's answer with the fields given and nothing else.
function tokenAnswer(fields: Readonly<Record<string, unknown>>): HttpResponse {
  return answer(JSON.stringify({ code: 1, message: "OK", result: { [taxed]: fields } }));
}

function errorAnswer(code: number): HttpResponse {
  return answer(JSON.stringify({ code, message: "refused", result: null }));
}

describe("goplus risk source", () => {
  it.each(
    tokenRiskSourceContract({
      create: () => {
        const http = createScriptedHttp([
          { method: "GET", url: urlOf(taxed), response: answer(taxedTokenAnswer) },
          { method: "GET", url: urlOf(dead), response: answer(emptyAnswer) },
        ]);
        return {
          source: createGoplusSource({ http }),
          known: assetOf(taxed),
          unknown: assetOf(dead),
          down: createGoplusSource({ http: createScriptedHttp([]) }),
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("asks for the token in lowercase on its chain's id, with no key, and reads every flag", async () => {
    const checksummed = "0xe0A281deFf5c9d8d67aF09D39340E134Ac81b82E";
    const { http, source } = sourceAnswering(taxed, answer(taxedTokenAnswer));
    await expect(source.check(assetOf(checksummed), live)).resolves.toStrictEqual({
      ok: true,
      value: {
        flags: ["hidden_owner", "tax_changeable", "mintable"],
        liquidityUsdMicros: 3_576_285_789_631n,
      },
    });
    expect(http.requests().map(({ url, headers }) => ({ url, headers }))).toStrictEqual([
      { url: urlOf(taxed), headers: undefined },
    ]);
  });

  it("reads a token whose holders cannot sell all and whose transfers can pause", async () => {
    const { source } = sourceAnswering(sellAllBlocked, answer(sellAllBlockedAnswer));
    await expect(source.check(assetOf(sellAllBlocked), live)).resolves.toStrictEqual({
      ok: true,
      value: {
        flags: ["cannot_sell_all", "transfer_pausable", "tax_changeable"],
        liquidityUsdMicros: 1_696_390_014_479n,
      },
    });
  });

  it.each<[string, Readonly<Record<string, unknown>>, readonly string[]]>([
    ["a honeypot", { is_honeypot: "1" }, ["honeypot"]],
    ["a whole sell tax as a token that cannot be sold", { sell_tax: "1" }, ["cannot_sell"]],
    ["a whole buy tax as a token that cannot be bought", { buy_tax: "1.000" }, ["cannot_buy"]],
    ["a tax below whole as no finding", { sell_tax: "0.4001", buy_tax: "0.1" }, []],
    ["closed source only from a 0", { is_open_source: "0" }, ["closed_source"]],
    ["an unknown source as no finding", { is_open_source: "" }, []],
    ["a token GoPlus calls untrue as fake", { is_true_token: "0" }, ["fake_token"]],
    [
      "a fake token record as fake",
      { fake_token: { true_token_address: dead, value: 1 } },
      ["fake_token"],
    ],
    [
      "an owner's powers",
      { owner_change_balance: "1", can_take_back_ownership: "1", selfdestruct: "1" },
      ["owner_changes_balances", "owner_reclaims", "self_destruct"],
    ],
    [
      "trading limits",
      { is_blacklisted: "1", is_whitelisted: "1", trading_cooldown: "1", is_anti_whale: "1" },
      ["blacklist", "whitelist", "trading_cooldown", "holding_cap"],
    ],
    [
      "taxes the owner sets and an airdrop scam",
      { personal_slippage_modifiable: "1", is_proxy: "1", is_airdrop_scam: "1" },
      ["tax_per_holder", "proxy", "airdrop_scam"],
    ],
  ])("reads %s", async (_case, fields, flags) => {
    const { source } = sourceAnswering(taxed, tokenAnswer(fields));
    await expect(source.check(assetOf(taxed), live)).resolves.toStrictEqual({
      ok: true,
      value: { flags },
    });
  });

  it("adds up only the pools whose liquidity is decimal text", async () => {
    const dex = [
      { liquidity: "10.5" },
      { liquidity: "n/a" },
      { name: "PancakeV2" },
      { liquidity: "2" },
    ];
    const { source } = sourceAnswering(taxed, tokenAnswer({ dex }));
    await expect(source.check(assetOf(taxed), live)).resolves.toStrictEqual({
      ok: true,
      value: { flags: [], liquidityUsdMicros: 12_500_000n },
    });
  });

  it.each([2, 2007, 2018, 2020, 2021, 2022])(
    "reads answer code %i as a token it does not cover",
    async (code) => {
      const { source } = sourceAnswering(taxed, errorAnswer(code));
      await expect(source.check(assetOf(taxed), live)).resolves.toStrictEqual({
        ok: false,
        error: "not_covered",
      });
    },
  );

  it("reads a recorded unsupported chain as not covered", async () => {
    const { source } = sourceAnswering(taxed, answer(unsupportedChainAnswer));
    await expect(source.check(assetOf(taxed), live)).resolves.toMatchObject({ ok: false });
  });

  it("answers not covered without asking for an asset that is no token of an EVM chain", async () => {
    const { http, source } = sourceAnswering(taxed, answer(taxedTokenAnswer));
    const coin = assetRefSchema.parse("eip155:56/slip44:714");
    const other = assetRefSchema.parse(
      "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:So11111111111111111111111111111111111111112",
    );
    await expect(source.check(coin, live)).resolves.toMatchObject({ error: "not_covered" });
    await expect(source.check(other, live)).resolves.toMatchObject({ error: "not_covered" });
    expect(http.requests()).toStrictEqual([]);
  });

  it.each<[string, HttpResponse, { readonly code: string; readonly retryable: boolean }]>([
    ["the rate limit code", errorAnswer(4029), { code: "goplus.rate_limited", retryable: true }],
    ["HTTP 429", answer("{}", 429), { code: "goplus.rate_limited", retryable: true }],
    ["a server error", answer(systemErrorAnswer), { code: "goplus.unavailable", retryable: true }],
    [
      "a bad gateway with no JSON",
      answer("<html>busy</html>", 502),
      { code: "goplus.unavailable", retryable: true },
    ],
    [
      "an access token it refuses",
      errorAnswer(4022),
      { code: "goplus.unavailable", retryable: false },
    ],
    ["a parameter error", errorAnswer(5006), { code: "goplus.unavailable", retryable: false }],
    [
      "an address format error",
      errorAnswer(2004),
      { code: "goplus.unavailable", retryable: false },
    ],
    ["HTTP 403", answer("", 403), { code: "goplus.unavailable", retryable: false }],
    ["text that is no JSON", answer("busy"), { code: "goplus.unavailable", retryable: false }],
    [
      "an answer outside its shape",
      answer('{"code":"1"}'),
      { code: "goplus.unavailable", retryable: false },
    ],
  ])("throws on %s", async (_case, response, fault) => {
    const { source } = sourceAnswering(taxed, response);
    await expect(source.check(assetOf(taxed), live)).rejects.toMatchObject(fault);
  });

  it("names GoPlus's code in the fault, never its message", async () => {
    const { source } = sourceAnswering(taxed, errorAnswer(4010));
    await expect(source.check(assetOf(taxed), live)).rejects.toMatchObject({
      details: { status: 200, answer: 4010 },
    });
  });
});
