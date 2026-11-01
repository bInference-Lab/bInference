import { httpContract } from "@binference/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { recordedApi } from "./bridge-fixtures.js";

const okUrl = "https://example.test/ok";
const missingUrl = "https://example.test/missing";

describe("the recorded Relay API", () => {
  it.each(
    httpContract({
      create: () => ({
        http: recordedApi([
          { method: "GET", url: okUrl, response: { status: 200, headers: {}, body: "ok" } },
          { method: "GET", url: missingUrl, response: { status: 404, headers: {}, body: "" } },
        ]),
        okUrl,
        missingUrl,
        unreachableUrl: "https://example.test/unreachable",
      }),
    }),
  )("follows the Http contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
