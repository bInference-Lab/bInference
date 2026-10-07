import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { executorContract } from "../contracts/executor-contract.js";
import { createFakeExecutor } from "./fake-executor.js";

const intent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000001" as Id<"int">;

describe("fake executor", () => {
  it.each(
    executorContract({
      create: async () => Promise.resolve({ executor: createFakeExecutor(), intent }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("keeps the intents it took in order, and none it refused", async () => {
    const executor = createFakeExecutor();
    const other = "int_0190f1c2-3a4b-7c5d-8e6f-000000000002" as Id<"int">;
    await executor.take(intent, { signal: new AbortController().signal });
    await expect(executor.take(other, { signal: AbortSignal.abort() })).rejects.toThrow("aborted");
    await executor.take(other, { signal: new AbortController().signal });
    expect(executor.taken()).toStrictEqual([intent, other]);
  });
});
