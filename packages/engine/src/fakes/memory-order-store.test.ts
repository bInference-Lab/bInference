import { describe, expect, it } from "vitest";
import { orderStoreContract } from "../contracts/order-store-contract.js";
import { subjectOf } from "./test-order-subject.js";

describe("memory order store", () => {
  it.each(orderStoreContract({ create: subjectOf }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );
});
