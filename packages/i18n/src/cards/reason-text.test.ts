import { describe, expect, it } from "vitest";
import { createFormatter } from "../format/create-formatter.js";
import { reasonText } from "./reason-text.js";

const english = createFormatter({ locale: "en", timeZone: "UTC" });

describe("reasonText", () => {
  it("says a reason whose words name nothing", () => {
    expect(reasonText(english, "late")).toBe(english.message("reason.late"));
  });

  it("says nothing of a reason whose words name a value, or of a code it has no words for", () => {
    expect(reasonText(english, "daily_cap")).toBeUndefined();
    expect(reasonText(english, "no_such_reason")).toBeUndefined();
  });

  it("says a reason whose words name values once it holds every one of them", () => {
    const used = { used: "$40.00", cap: "$40.00" };
    expect(reasonText(english, "copy_daily_cap", used)).toBe(
      "it would pass this leader's daily cap ($40.00 of $40.00 used)",
    );
    expect(reasonText(english, "copy_daily_cap", { used: "$40.00" })).toBeUndefined();
  });
});
