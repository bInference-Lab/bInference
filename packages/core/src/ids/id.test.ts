import { describe, expect, it } from "vitest";
import { idSchema, isId, isIdPrefix } from "./id.js";

const valid = "int_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";

describe("isId", () => {
  it("accepts a prefix and a lowercase UUIDv7", () => {
    expect(isId("int", valid)).toBe(true);
  });

  it.each([
    ["another prefix", "ord_0190f1c2-3a4b-7c5d-8e6f-0123456789ab"],
    ["a version 4 UUID", "int_0190f1c2-3a4b-4c5d-8e6f-0123456789ab"],
    ["a wrong variant", "int_0190f1c2-3a4b-7c5d-0e6f-0123456789ab"],
    ["uppercase hex", "int_0190F1C2-3a4b-7c5d-8e6f-0123456789ab"],
    ["no separator", "int0190f1c2-3a4b-7c5d-8e6f-0123456789ab"],
  ])("refuses %s", (_kind, text) => {
    expect(isId("int", text)).toBe(false);
  });
});

describe("idSchema", () => {
  it("parses an id of its prefix and refuses others with a message", () => {
    const schema = idSchema("int");
    expect(schema.parse(valid)).toBe(valid);
    const result = schema.safeParse("ord_0190f1c2-3a4b-7c5d-8e6f-0123456789ab");
    expect(result.error?.issues[0]?.message).toBe("Expected a int_ id.");
  });
});

describe("isIdPrefix", () => {
  it.each(["tx", "int", "agt", "plgx"])("accepts %s", (prefix) => {
    expect(isIdPrefix(prefix)).toBe(true);
  });

  it.each(["", "x", "toolong", "In", "a_b"])("refuses %j", (prefix) => {
    expect(isIdPrefix(prefix)).toBe(false);
  });
});
