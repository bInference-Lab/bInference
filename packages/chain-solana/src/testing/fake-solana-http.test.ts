import { httpContract } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createFakeSolanaHttp } from "./fake-solana-http.js";

const okUrl = "https://ok.invalid/";
const missingUrl = "https://missing.invalid/";

describe("the fake Solana http", () => {
  it.each(
    httpContract({
      create: () => ({
        http: createFakeSolanaHttp({
          [okUrl]: () => ({ status: 200, headers: {}, body: "ok" }),
          [missingUrl]: () => ({ status: 404, headers: {}, body: "" }),
        }),
        okUrl,
        missingUrl,
        unreachableUrl: "https://nothing.invalid/",
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
