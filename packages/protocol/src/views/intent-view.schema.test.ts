import { describe, expect, it } from "vitest";
import { intentView } from "../examples/wire-values.js";
import { intentViewSchema } from "./intent-view.schema.js";

describe("intentViewSchema", () => {
  it("reads a rescue intent, which carries no proposal", () => {
    const rescue = { ...intentView, kind: "rescue", request: { kind: "rescue" } };
    expect(intentViewSchema.parse(rescue)).toMatchObject({ request: { kind: "rescue" } });
  });

  it("reads a send by name with the name and the address it resolved to", () => {
    const resolvedName = {
      name: "alice.bnb",
      address: "eip155:56:0x00000000000000000000000000000000000000aa",
      resolvedAt: 1_700_000_000_000,
    };
    expect(intentViewSchema.parse({ ...intentView, resolvedName })).toMatchObject({
      resolvedName,
    });
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
    [
      "a resolved name without its address",
      { ...intentView, resolvedName: { name: "alice.bnb", resolvedAt: 1 } },
    ],
  ] as const)("refuses %s", (_name, view) => {
    expect(intentViewSchema.safeParse(view).success).toBe(false);
  });
});
