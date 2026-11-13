import { describe, expect, it } from "vitest";
import { noBreaker } from "../breaker/no-breaker.js";
import { breakerSourceContract } from "../contracts/breaker-source-contract.js";
import { live } from "../contracts/store-fixtures.js";
import { createMemoryBreaker } from "./memory-breaker.js";

describe("memory breaker source", () => {
  it.each(
    breakerSourceContract({
      create: async () => {
        const source = createMemoryBreaker();
        source.pull(1_000);
        return Promise.resolve(source);
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("raises the version with every pull and lift", async () => {
    const source = createMemoryBreaker();
    await expect(source.read(live())).resolves.toStrictEqual({ pulled: false, version: 0 });
    source.pull(1_000);
    await expect(source.read(live())).resolves.toStrictEqual({
      pulled: true,
      version: 1,
      changedAtMs: 1_000,
    });
    source.lift(2_000);
    source.pull(3_000);
    await expect(source.read(live())).resolves.toStrictEqual({
      pulled: true,
      version: 3,
      changedAtMs: 3_000,
    });
  });

  it("answers the state a test sets, such as a copy that lags", async () => {
    const source = createMemoryBreaker();
    source.answer({ pulled: true, version: 7 });
    await expect(source.read(live())).resolves.toStrictEqual({ pulled: true, version: 7 });
    expect(() => {
      source.answer({ pulled: true, version: -1 });
    }).toThrow(/>=0/u);
  });

  it("rejects every read with its fault until it answers again", async () => {
    const source = createMemoryBreaker();
    source.fail("breaker.unreadable");
    await expect(source.read(live())).rejects.toMatchObject({ code: "breaker.unreadable" });
    source.fail(undefined);
    await expect(source.read(live())).resolves.toStrictEqual({ pulled: false, version: 0 });
  });
});

describe("no breaker", () => {
  it.each(breakerSourceContract({ create: async () => Promise.resolve(noBreaker) }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it("is never pulled and stays at version 0", async () => {
    await expect(noBreaker.read(live())).resolves.toStrictEqual({ pulled: false, version: 0 });
  });
});
