import { describe, expect, it } from "vitest";
import { httpContract } from "../contracts/http-contract.js";
import { createScriptedHttp } from "./scripted-http.js";

const okUrl = "https://example.invalid/ok";
const missingUrl = "https://example.invalid/missing";

function create() {
  return createScriptedHttp([
    { method: "GET", url: okUrl, response: { status: 200, headers: {}, body: "ok" } },
    { method: "GET", url: missingUrl, response: { status: 404, headers: {}, body: "" } },
  ]);
}

describe("scripted http", () => {
  it.each(
    httpContract({
      create: () => ({
        http: create(),
        okUrl,
        missingUrl,
        unreachableUrl: "https://example.invalid/nothing",
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("records the requests it answered", async () => {
    const http = create();
    await http.request({ method: "GET", url: okUrl, signal: new AbortController().signal });
    expect(http.requests().map((request) => request.url)).toStrictEqual([okUrl]);
  });
});
