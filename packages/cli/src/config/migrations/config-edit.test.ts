import { describe, expect, it } from "vitest";
import type { JsonObject } from "../json-value.schema.js";
import { applyEdits, valueAt } from "./config-edit.js";

const file: JsonObject = { engine: { port: 7456, unlock: { mode: "file" } }, version: 1 };

describe("config edits", () => {
  it("sets, removes and moves keys by path, keeping the order of the others", () => {
    expect(
      applyEdits(file, [
        { kind: "set", path: ["engine", "port"], value: 7460 },
        { kind: "set", path: ["telegram", "mode"], value: "polling" },
        { kind: "move", from: ["engine", "unlock"], to: ["unlock"] },
        { kind: "remove", path: ["version"] },
      ]),
    ).toStrictEqual({
      engine: { port: 7460 },
      telegram: { mode: "polling" },
      unlock: { mode: "file" },
    });
  });

  it("changes nothing for a key that is not there", () => {
    expect(
      applyEdits(file, [
        { kind: "remove", path: ["engine", "missing", "deeper"] },
        { kind: "move", from: ["gone"], to: ["engine", "port"] },
      ]),
    ).toStrictEqual(file);
  });

  it("never changes the file it is given", () => {
    applyEdits(file, [{ kind: "set", path: ["engine", "port"], value: 1 }]);
    expect(valueAt(file, ["engine", "port"])).toBe(7456);
  });
});
