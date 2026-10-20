import { describe, expect, it } from "vitest";
import { type LaunchOption, launchOptionSchema, launchOptionsSchema } from "./launch-option.js";

const tax: LaunchOption = { name: "taxBps", type: "bps", max: 1000, default: 0 };

describe("a launchpad's settings", () => {
  it.each<[string, LaunchOption]>([
    ["a share with bounds", tax],
    ["a choice with its words", { name: "feeTier", type: "choice", choices: ["low", "high"] }],
    ["an account with no default", { name: "taxRecipient", type: "account" }],
    [
      "an account outside the install",
      { name: "creatorFeeRecipient", type: "account", isOutsideOnly: true },
    ],
    ["a picture link", { name: "pictureLink", type: "link" }],
    ["a flag", { name: "buyback", type: "flag", default: false }],
  ])("takes %s", (_case, option) => {
    expect(launchOptionSchema.safeParse(option).success).toBe(true);
  });

  it.each<[string, unknown]>([
    ["a name that is not camelCase", { ...tax, name: "tax-bps" }],
    ["a share above the whole", { ...tax, max: 10_001 }],
    ["bounds the wrong way round", { ...tax, min: 500, max: 100 }],
    ["bounds on a flag", { name: "buyback", type: "flag", max: 1 }],
    ["a choice without words", { name: "feeTier", type: "choice" }],
    ["words on a share", { ...tax, choices: ["low"] }],
    ["a word twice", { name: "feeTier", type: "choice", choices: ["low", "low"] }],
    ["the outside rule on a share", { ...tax, isOutsideOnly: true }],
  ])("refuses %s", (_case, option) => {
    expect(launchOptionSchema.safeParse(option).success).toBe(false);
  });

  it("refuses two settings of one name", () => {
    expect(launchOptionsSchema.safeParse([tax, { ...tax, max: 500 }]).success).toBe(false);
  });
});
