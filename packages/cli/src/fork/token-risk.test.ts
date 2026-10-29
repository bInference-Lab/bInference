import { bscToken, withFork } from "@binference/chain-evm/fork";
import { bpsSchema, type Http } from "@binference/core";
import { createScriptedHttp } from "@binference/core/testing";
import { createGoplusSource } from "@binference/goplus";
import { createHoneypotSource } from "@binference/honeypot-is";
import { describe, expect, it } from "vitest";
import { placeRefusingToken } from "./refusing-token.js";
import { benchOf, clean, cleanSources, honeypot, subjectOf, taxed } from "./risk-bench.js";

// The live fixtures of ./risk-bench.ts, each a BSC token checked on chain and with GoPlus and
// honeypot.is on 2026-10-09.
const cake = bscToken("Cake");

// GoPlus's own API, which no source of this test reaches: every request fails as unreachable.
const unreachable: Http = createScriptedHttp([]);

describe("token risk on a BSC fork", () => {
  it("blocks a token whose test sale reverts, though its sources find it clean", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const token = await placeRefusingToken(fork, "sale");
      const bench = benchOf(fork, cleanSources(fork, [token]));
      const assessment = await bench.check.assess(await subjectOf(bench, token), { signal });
      expect(assessment.refusal).toBe("cannot_sell");
      expect(assessment.view.flags).toContainEqual({ code: "cannot_sell", source: "simulation" });
    }));

  it("blocks a token its buyer cannot pass on, though its sources find it clean", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const token = await placeRefusingToken(fork, "transfer");
      const bench = benchOf(fork, cleanSources(fork, [token]));
      const assessment = await bench.check.assess(await subjectOf(bench, token), { signal });
      expect(assessment.refusal).toBe("blacklisted");
      expect(assessment.view.flags).toContainEqual({
        code: "transfer_blocked",
        source: "simulation",
      });
    }));

  it("blocks SPA, a live honeypot, by its round trip, though its sources find it clean", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const bench = benchOf(fork, cleanSources(fork, [honeypot]));
      const assessment = await bench.check.assess(await subjectOf(bench, honeypot), { signal });
      const simulated = assessment.view.flags.filter((flag) => flag.source === "simulation");
      expect(assessment.view.verdict).toBe("block");
      expect([assessment.refusal, simulated.map((flag) => flag.code)]).toBeOneOf([
        ["cannot_sell", ["cannot_sell"]],
        ["blacklisted", ["transfer_blocked"]],
      ]);
    }));

  it("measures a 40% sell tax its sources miss, and blocks it above a 10% or a 30% maximum", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const bench = benchOf(fork, cleanSources(fork, [taxed]));
      const assessment = await bench.check.assess(await subjectOf(bench, taxed), { signal });
      expect(assessment.refusal).toBe("high_tax");
      expect(assessment.view).toMatchObject({ verdict: "block", buyTaxBps: 0 });
      expect(assessment.view.sellTaxBps).toBeGreaterThanOrEqual(3_990);
      expect(assessment.view.sellTaxBps).toBeLessThanOrEqual(4_010);
      const atThirty = await subjectOf(bench, taxed, bpsSchema.parse(3_000));
      await expect(bench.check.assess(atThirty, { signal })).resolves.toMatchObject({
        refusal: "high_tax",
      });
      const atFortyFive = await subjectOf(bench, taxed, bpsSchema.parse(4_500));
      await expect(bench.check.assess(atFortyFive, { signal })).resolves.toMatchObject({
        view: { verdict: "warn" },
      });
    }));

  it("passes a clean token the registry does not list, with no tax measured", async ({ signal }) =>
    withFork(signal, async (fork) => {
      const bench = benchOf(fork, cleanSources(fork, [clean]));
      const assessment = await bench.check.assess(await subjectOf(bench, clean), { signal });
      expect(assessment.refusal).toBeUndefined();
      expect(assessment.view).toMatchObject({ verdict: "pass", buyTaxBps: 0, sellTaxBps: 0 });
    }));

  it("blocks an unknown token while GoPlus is down, and passes a registry token", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const sources = [
        createGoplusSource({ http: unreachable }),
        createHoneypotSource({ http: unreachable }),
      ];
      const bench = benchOf(fork, sources);
      await expect(
        bench.check.assess(await subjectOf(bench, clean), { signal }),
      ).resolves.toMatchObject({
        refusal: "sources_down",
        view: {
          flags: [
            { code: "unavailable", source: "goplus" },
            { code: "unavailable", source: "honeypot" },
          ],
        },
      });
      const listed = await bench.check.assess(await subjectOf(bench, cake), { signal });
      expect([listed.refusal, listed.view.verdict, listed.view.flags]).toStrictEqual([
        undefined,
        "pass",
        [],
      ]);
    }));
});
