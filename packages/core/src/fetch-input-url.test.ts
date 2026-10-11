import { describe, expect, it } from "vitest";
import { fetchInputUrl } from "./fetch-input-url.js";

describe("fetchInputUrl", () => {
  it("reads the URL of text, a URL and a request alike", () => {
    const url = "https://api.example.org/v1/items?page=2";
    expect([url, new URL(url), new Request(url)].map(fetchInputUrl)).toStrictEqual([url, url, url]);
  });
});
