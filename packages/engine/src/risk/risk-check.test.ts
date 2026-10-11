import type { TokenRiskReport, TokenRiskSource } from "@binference/chain";
import { createFakeRiskSource, createFakeVenue } from "@binference/chain/testing";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { riskCheckContract } from "../contracts/risk-check-contract.js";
import { createMemoryRiskCacheStore } from "../fakes/memory-risk-cache-store.js";
import { testChains } from "../operations/test-engine.js";
import { createVenueHost } from "../venues/venue-host.js";
import { createRiskCheck, type RiskSourceUse } from "./risk-check.js";
import {
  createTokenModelSimulator,
  listedTokenQuote,
  riskSubjectOf,
  type TokenModel,
  unknownToken,
  unknownTokenQuote,
} from "./test-round-trip.js";

const nowMs = 1_800_000_000_000;
const live = { signal: new AbortController().signal };
const deep: TokenRiskReport = { flags: [], liquidityUsdMicros: 50_000_000_000n };

interface Bench {
  readonly sources?: readonly RiskSourceUse[];
  readonly model?: TokenModel;
}

function sourceOf(id: string, report: TokenRiskReport | undefined, isDown = false) {
  const reports = new Map(report === undefined ? [] : [[unknownToken, report]]);
  return createFakeRiskSource({ id, reports, isDown });
}

function benchOf(bench: Bench = {}) {
  const chains = testChains();
  const clock = createManualClock(nowMs);
  const simulator = createTokenModelSimulator(bench.model ?? {});
  const host = createVenueHost({
    venues: [createFakeVenue()],
    chains,
    clock,
    callTimeoutMs: 5_000,
  });
  const required = sourceOf("first", deep);
  const check = createRiskCheck({
    sources: bench.sources ?? [{ source: required, isRequired: true }],
    cache: createMemoryRiskCacheStore(["first", "second"]),
    cacheTtlMs: 600_000,
    sourceTimeoutMs: 5_000,
    host,
    simulator,
    chains,
    clock,
    random: createSeededRandom(5),
  });
  return { check, clock, simulator, required };
}

// A source that answers only when its signal aborts, as one that never responds.
function silentSource(id: string): TokenRiskSource & { readonly asked: () => boolean } {
  let isAsked = false;
  return {
    id,
    check: async (_asset, { signal }) => {
      isAsked = true;
      return await new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
      });
    },
    asked: () => isAsked,
  };
}

const unknownSubject = () => riskSubjectOf(unknownTokenQuote(nowMs));

describe("risk check", () => {
  it.each(
    riskCheckContract({
      create: () => ({
        check: benchOf({ model: { blocksSales: true } }).check,
        verified: riskSubjectOf(listedTokenQuote(nowMs)),
        refused: unknownSubject(),
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("passes a token the registry lists without asking a source or simulating", async () => {
    const { check, simulator, required } = benchOf();
    await expect(check.assess(riskSubjectOf(listedTokenQuote(nowMs)), live)).resolves.toStrictEqual(
      {
        view: { verdict: "pass", flags: [], onCurve: false, checkedAt: nowMs },
      },
    );
    expect([required.checks(), simulator.runs()]).toStrictEqual([0, 0]);
  });

  it("passes an unknown token every source and the round trip find clean", async () => {
    const { check } = benchOf();
    await expect(check.assess(unknownSubject(), live)).resolves.toStrictEqual({
      view: {
        verdict: "pass",
        flags: [],
        buyTaxBps: 0,
        sellTaxBps: 0,
        liquidityUsdMicros: deep.liquidityUsdMicros,
        onCurve: false,
        checkedAt: nowMs,
      },
    });
  });

  it("blocks a sell tax above the agent's maximum that every source missed", async () => {
    const { check } = benchOf({ model: { sellTaxBps: 3_000 } });
    await expect(check.assess(unknownSubject(), live)).resolves.toMatchObject({
      refusal: "high_tax",
      view: { verdict: "block", buyTaxBps: 0, sellTaxBps: 3_000 },
    });
  });

  it("blocks a token whose test sale fails though its sources find it clean", async () => {
    const { check } = benchOf({ model: { blocksSales: true } });
    await expect(check.assess(unknownSubject(), live)).resolves.toMatchObject({
      refusal: "cannot_sell",
    });
  });

  it("blocks an unknown token when its required source is down, and passes one it lists", async () => {
    const down = sourceOf("first", deep, true);
    const { check } = benchOf({ sources: [{ source: down, isRequired: true }] });
    await expect(check.assess(unknownSubject(), live)).resolves.toMatchObject({
      refusal: "sources_down",
      view: { flags: [{ code: "unavailable", source: "first" }] },
    });
    await expect(check.assess(riskSubjectOf(listedTokenQuote(nowMs)), live)).resolves.toMatchObject(
      {
        view: { verdict: "pass" },
      },
    );
  });

  it("blocks an unknown token its required source does not cover, and flags it as not covered", async () => {
    const blind = sourceOf("first", undefined);
    const { check } = benchOf({ sources: [{ source: blind, isRequired: true }] });
    await expect(check.assess(unknownSubject(), live)).resolves.toMatchObject({
      refusal: "sources_down",
      view: { verdict: "block", flags: [{ code: "not_covered", source: "first" }] },
    });
  });

  it("lets an optional source's outage pass, and still counts its findings when it answers", async () => {
    const optionalDown = { source: sourceOf("second", undefined, true), isRequired: false };
    const required = { source: sourceOf("first", deep), isRequired: true };
    const passing = benchOf({ sources: [required, optionalDown] });
    await expect(passing.check.assess(unknownSubject(), live)).resolves.toMatchObject({
      view: { verdict: "warn" },
    });
    const flagging = { source: sourceOf("second", { flags: ["honeypot"] }), isRequired: false };
    const blocking = benchOf({ sources: [required, flagging] });
    await expect(blocking.check.assess(unknownSubject(), live)).resolves.toMatchObject({
      refusal: "honeypot",
    });
  });

  it("counts a source that does not answer in time as down", async () => {
    const silent = silentSource("first");
    const { check, clock } = benchOf({ sources: [{ source: silent, isRequired: true }] });
    const assessed = check.assess(unknownSubject(), live);
    await clock.advance(5_000);
    await expect(assessed).resolves.toMatchObject({ refusal: "sources_down" });
    expect(silent.asked()).toBe(true);
  });

  it("asks each source once per token while its report holds", async () => {
    const { check, required } = benchOf();
    await check.assess(unknownSubject(), live);
    await check.assess(unknownSubject(), live);
    expect(required.checks()).toBe(1);
  });

  it("blocks a token whose round trip cannot run because the chain does not simulate", async () => {
    const bench = benchOf();
    const failing = createRiskCheck({
      sources: [{ source: bench.required, isRequired: true }],
      cache: createMemoryRiskCacheStore(["first"]),
      cacheTtlMs: 600_000,
      sourceTimeoutMs: 5_000,
      host: createVenueHost({
        venues: [createFakeVenue()],
        chains: testChains(),
        clock: bench.clock,
        callTimeoutMs: 5_000,
      }),
      simulator: { simulate: async () => await Promise.reject(new Error("node down")) },
      chains: testChains(),
      clock: bench.clock,
      random: createSeededRandom(5),
    });
    await expect(failing.assess(unknownSubject(), live)).resolves.toMatchObject({
      refusal: "sources_down",
      view: { flags: [{ code: "unavailable", source: "simulation" }] },
    });
  });

  it("rejects with the signal's reason when the caller stops it during the check", async () => {
    const silent = silentSource("first");
    const { check } = benchOf({ sources: [{ source: silent, isRequired: true }] });
    const controller = new AbortController();
    const assessed = check.assess(unknownSubject(), { signal: controller.signal });
    const reason = new Error("stopped");
    controller.abort(reason);
    await expect(assessed).rejects.toBe(reason);
  });
});
