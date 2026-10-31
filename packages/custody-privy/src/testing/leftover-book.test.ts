import { createPrivateKey, generateKeyPairSync, type KeyObject, sign, verify } from "node:crypto";
import { createSecret, err } from "@binference/core";
import { createMemorySecretStore } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import type { PrivyId } from "../privy/privy-records.js";
import { createLeftoverBook, type LeftoverBook } from "./leftover-book.js";

const signal = () => AbortSignal.timeout(5_000);
const newKey = () => generateKeyPairSync("ec", { namedCurve: "prime256v1" });

// The private key a record keeps.
async function keptKey(book: LeftoverBook, name: string): Promise<KeyObject> {
  const kept = await book.read(name, signal());
  const key = Buffer.from(kept?.ownerKey ?? "", "base64");
  return createPrivateKey({ key, format: "der", type: "pkcs8" });
}

describe("createLeftoverBook", () => {
  it("keeps an owner key under a name its public half gives, once, and lists it once", async () => {
    const store = createMemorySecretStore({});
    const book = createLeftoverBook(store);
    const owner = newKey();
    const name = await book.keep(owner.privateKey, signal());

    expect(name).toMatch(/^owner-[0-9a-f]{32}$/);
    await book.note(name, { kind: "quorums", id: "quorum1" as PrivyId }, signal());
    await expect(book.keep(owner.privateKey, signal())).resolves.toBe(name);
    await expect(book.read(name, signal())).resolves.toMatchObject({ quorums: ["quorum1"] });
    await expect(book.names(signal())).resolves.toStrictEqual([name]);
    const restored = await keptKey(book, name);
    const message = Buffer.from("binference");
    expect(verify("sha256", message, owner.publicKey, sign("sha256", message, restored))).toBe(
      true,
    );
  });

  it("notes what a run makes in order, even when notes overlap", async () => {
    const book = createLeftoverBook(createMemorySecretStore({}));
    const name = await book.keep(newKey().privateKey, signal());
    const ids = ["aggregation1", "aggregation2", "aggregation3"] as PrivyId[];

    await Promise.all(
      ids.map(async (id) => book.note(name, { kind: "aggregations", id }, signal())),
    );
    await book.note(name, { kind: "policies", id: "policy1" as PrivyId }, signal());
    await expect(book.read(name, signal())).resolves.toMatchObject({
      quorums: [],
      policies: ["policy1"],
      aggregations: ids,
    });
  });

  it("refuses a note for a record it does not keep", async () => {
    const book = createLeftoverBook(createMemorySecretStore({}));

    await expect(
      book.note("owner-0", { kind: "policies", id: "policy1" as PrivyId }, signal()),
    ).rejects.toMatchObject({ code: "custody.leftover_unkept" });
  });

  it("forgets a record with its key and leaves the others listed", async () => {
    const store = createMemorySecretStore({});
    const book = createLeftoverBook(store);
    const first = await book.keep(newKey().privateKey, signal());
    const second = await book.keep(newKey().privateKey, signal());

    await book.forget(first, signal());
    await expect(book.names(signal())).resolves.toStrictEqual([second]);
    await expect(store.read(first, signal())).resolves.toStrictEqual(err("not_found"));
  });

  it("reads no record and no names from text of another shape", async () => {
    const store = createMemorySecretStore({ index: "{}", "owner-1": '{"ownerKey":"x"}' });
    const book = createLeftoverBook(store);

    await expect(book.names(signal())).resolves.toStrictEqual([]);
    await expect(book.read("owner-1", signal())).resolves.toBeUndefined();
    await store.write("index", createSecret('["owner-1"]'), signal());
    await expect(book.names(signal())).resolves.toStrictEqual(["owner-1"]);
  });
});
