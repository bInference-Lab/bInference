import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ownerKeyCodeSchema } from "../values/owner-key-code.schema.js";
import { operations } from "./operations.js";
import { ownerKeyOperations, takesOwnerKey } from "./owner-key-operations.js";

describe("owner-key operations", () => {
  it("are the operations whose args carry the owner key code", () => {
    expect(ownerKeyOperations).toStrictEqual([
      "wallet/create",
      "wallet/exportKey",
      "ceiling/set",
      "signer/revoke",
      "address/add",
    ]);
  });

  it("each need admin and run over IPC only", () => {
    const rows = ownerKeyOperations.map((name) => [
      name,
      operations[name].scope,
      operations[name].transport,
    ]);
    expect(rows).toStrictEqual(ownerKeyOperations.map((name) => [name, "admin", "ipc"]));
  });

  it("find the owner key by its schema, whatever the field is called", () => {
    expect(takesOwnerKey({ args: z.strictObject({ code: ownerKeyCodeSchema }) })).toBe(true);
    expect(takesOwnerKey({ args: z.strictObject({ ownerKey: z.string() }) })).toBe(false);
    expect(takesOwnerKey({ args: z.string() })).toBe(false);
  });
});
