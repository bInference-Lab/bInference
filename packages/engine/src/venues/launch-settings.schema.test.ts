import { chainRefSchema, type LaunchOption } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { testChains } from "../operations/test-engine.js";
import { launchSettingsOf, launchSettingsProblem } from "./launch-settings.schema.js";

const chain = (() => {
  const found = testChains().get(chainRefSchema.parse("fake:1"));
  if (!found.ok) {
    throw new Error("The fake chain is missing.");
  }
  return found.value;
})();

const settings: readonly LaunchOption[] = [
  { name: "taxBps", type: "bps", max: 1000, default: 0 },
  { name: "taxRecipient", type: "account" },
  { name: "buyback", type: "flag", default: false },
];

describe("a launch's launchpad settings", () => {
  it("fills each default, in the declared order, and writes an account canonically", () => {
    const given = { buyback: true, taxRecipient: "0x0000000C" };
    expect(launchSettingsOf(settings, given, chain)).toStrictEqual({
      ok: true,
      value: [
        { name: "taxBps", type: "bps", value: 0 },
        { name: "taxRecipient", type: "account", value: "fake:1:0x0000000c" },
        { name: "buyback", type: "flag", value: true },
      ],
    });
  });

  it("takes a choice among its words and a count within its bounds", () => {
    const options: readonly LaunchOption[] = [
      { name: "feeTier", type: "choice", choices: ["low", "high"] },
      { name: "supply", type: "count", min: 1, max: 10 },
    ];
    expect(launchSettingsOf(options, { feeTier: "high", supply: 10 }, chain)).toMatchObject({
      ok: true,
    });
    expect(launchSettingsOf(options, { feeTier: "mid", supply: 10 }, chain)).toMatchObject({
      ok: false,
    });
    expect(launchSettingsOf(options, { feeTier: "low", supply: 0 }, chain)).toMatchObject({
      ok: false,
    });
  });

  it.each<[string, Readonly<Record<string, unknown>>]>([
    ["a setting it does not declare", { taxRecipient: "0x0000000c", colour: "red" }],
    ["a share above its most", { taxRecipient: "0x0000000c", taxBps: 1001 }],
    ["a share that is no whole number", { taxRecipient: "0x0000000c", taxBps: 1.5 }],
    ["a flag that is a word", { taxRecipient: "0x0000000c", buyback: "yes" }],
    ["an account that is no address", { taxRecipient: "nobody" }],
    ["a setting with no default left out", {}],
  ])("refuses %s", (_case, given) => {
    expect(launchSettingsOf(settings, given, chain)).toStrictEqual({
      ok: false,
      error: "bad_settings",
    });
  });

  it("takes no settings when the launchpad declares none", () => {
    expect(launchSettingsOf([], undefined, chain)).toStrictEqual({ ok: true, value: [] });
  });
});

describe("a launchpad's settings as the engine hosts them", () => {
  it("hosts settings whose card lines exist in every language", () => {
    expect(launchSettingsProblem(settings, chain)).toBeUndefined();
  });

  it.each<[string, LaunchOption]>([
    ["a setting with no card line", { name: "mystery", type: "flag" }],
    ["a default outside its bounds", { name: "taxBps", type: "bps", max: 10, default: 50 }],
  ])("refuses %s", (_case, option) => {
    expect(launchSettingsProblem([option], chain)).toEqual(expect.any(String));
  });
});
