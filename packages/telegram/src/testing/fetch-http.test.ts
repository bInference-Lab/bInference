import { httpContract } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import type { BotApiFetch } from "../api/bot-api-fetch.js";
import { httpOverFetch } from "./fetch-http.js";

const origin = "https://bot.example.org";

function urlOf(input: string | URL | Request): URL {
  if (typeof input === "string") {
    return new URL(input);
  }
  return input instanceof URL ? input : new URL(input.url);
}

// A fetch that answers `ok` at /ok, 404 at /missing, and opens no connection anywhere else.
const scripted: BotApiFetch = async (input) => {
  const url = urlOf(input);
  if (url.pathname === "/ok") {
    return Promise.resolve(new Response("ok", { headers: { "content-type": "text/plain" } }));
  }
  if (url.pathname === "/missing") {
    return Promise.resolve(new Response("", { status: 404 }));
  }
  return Promise.reject(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
};

describe("the Http port over a fetch", () => {
  it.each(
    httpContract({
      create: () => ({
        http: httpOverFetch(scripted),
        okUrl: `${origin}/ok`,
        missingUrl: `${origin}/missing`,
        unreachableUrl: `${origin}/closed`,
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("answers the content type, and keeps the socket's code in the cause of no answer", async () => {
    const http = httpOverFetch(scripted);
    const signal = new AbortController().signal;
    await expect(http.request({ method: "GET", url: `${origin}/ok`, signal })).resolves.toEqual({
      status: 200,
      headers: { "content-type": "text/plain" },
      body: "ok",
    });
    await expect(
      http.request({ method: "GET", url: `${origin}/closed`, signal }),
    ).rejects.toMatchObject({ code: "http.unreachable", cause: { code: "ECONNREFUSED" } });
  });
});
