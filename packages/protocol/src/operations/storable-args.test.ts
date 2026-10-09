import { describe, expect, it } from "vitest";
import { operations } from "./operations.js";
import { storableArgs } from "./storable-args.js";

describe("storable args", () => {
  it("leave out the passphrase of engine/unlock", () => {
    expect(
      storableArgs("engine/unlock", { passphrase: "correct horse battery staple" }),
    ).toStrictEqual({});
  });

  it("keep the args of every other operation as they came", () => {
    const args = { agent: "agt_0190f1c2-3a4b-7c5d-8e6f-0123456789ab", passphrase: "kept" };
    expect(storableArgs("safety/freeze", args)).toBe(args);
    expect(storableArgs("engine/unlock", "not an object")).toBe("not an object");
  });
});

describe("engine/unlock", () => {
  const { args } = operations["engine/unlock"];

  it("takes the passphrase, or nothing for a mode that reads its own source", () => {
    expect(args.safeParse({}).success).toBe(true);
    expect(args.safeParse({ passphrase: "correct horse battery staple" }).success).toBe(true);
  });

  it("refuses an empty passphrase and any other field", () => {
    expect(args.safeParse({ passphrase: "" }).success).toBe(false);
    expect(args.safeParse({ passphrase: "x", mode: "file" }).success).toBe(false);
  });
});
