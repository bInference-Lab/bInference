import { isIdPrefix } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { type IdKind, idPrefixes, protocolIdSchema } from "./id-prefixes.js";

const kinds = Object.keys(idPrefixes) as IdKind[];

describe("idPrefixes", () => {
  it("holds the 22 prefixes of the spec, distinct and well formed", () => {
    const prefixes = Object.values(idPrefixes);
    expect(prefixes).toHaveLength(22);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(prefixes.filter((prefix) => !isIdPrefix(prefix))).toStrictEqual([]);
  });
});

describe("protocolIdSchema", () => {
  it("parses every UUIDv7 id of its kind and refuses the ids of every other kind", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...kinds),
        fc.constantFrom(...kinds),
        fc.uuid({ version: 7 }),
        (kind, idKind, uuid) => {
          const text = `${idPrefixes[idKind]}_${uuid}`;
          expect(protocolIdSchema(kind).safeParse(text).success).toBe(kind === idKind);
        },
      ),
    );
  });

  it("refuses an id whose UUID is not version 7", () => {
    const schema = protocolIdSchema("intent");
    expect(schema.safeParse("int_0190f1c2-3a4b-4c5d-8e6f-0123456789ab").success).toBe(false);
  });

  it("shows its prefix in its JSON Schema", () => {
    expect(z.toJSONSchema(protocolIdSchema("chatTurn"), { io: "input" })).toMatchObject({
      type: "string",
      pattern: "^trn_",
    });
  });
});
