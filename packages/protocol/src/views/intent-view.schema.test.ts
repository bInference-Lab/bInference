import { describe, expect, it } from "vitest";
import { intentView } from "../examples/wire-values.js";
import { intentViewSchema } from "./intent-view.schema.js";

describe("intentViewSchema", () => {
  it("reads a rescue intent, which carries no proposal", () => {
    const rescue = { ...intentView, kind: "rescue", request: { kind: "rescue" } };
    expect(intentViewSchema.parse(rescue)).toMatchObject({ request: { kind: "rescue" } });
  });

  it("drops fields a newer engine adds, in the view and in its request", () => {
    const request = { ...(intentView["request"] as Record<string, unknown>), deadline: 60 };
    const parsed = intentViewSchema.parse({ ...intentView, request, region: "eu" });
    expect(parsed).not.toHaveProperty("region");
    expect(parsed.request).not.toHaveProperty("deadline");
  });

  it.each([
    ["an unknown state", { ...intentView, state: "signed" }],
    [
      "a card version 0",
      { ...intentView, card: { ...(intentView["card"] as object), version: 0 } },
    ],
    ["a reason code with spaces", { ...intentView, outcome: { reason: "daily cap" } }],
  ] as const)("refuses %s", (_name, view) => {
    expect(intentViewSchema.safeParse(view).success).toBe(false);
  });
});
