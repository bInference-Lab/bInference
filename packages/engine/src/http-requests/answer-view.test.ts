import type { HttpResponse } from "@binference/core";
import { httpRequestLimits } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { answerViewOf } from "./answer-view.js";

const context = { head: false, values: new Map<string, string>(), durationMs: 12 };

const answer = (body: string, headers: Readonly<Record<string, string>>): HttpResponse => ({
  status: 200,
  headers,
  body,
});

describe("an API call's answer as the agent reads it", () => {
  it("answers a text body with its type, size and time", () => {
    const view = answerViewOf(
      answer("héllo", { "content-type": "text/plain; charset=utf-8" }),
      context,
    );
    expect(view).toStrictEqual({
      kind: "answer",
      status: 200,
      headers: [{ name: "content-type", value: "text/plain; charset=utf-8" }],
      contentType: "text/plain; charset=utf-8",
      bytes: 6,
      body: "héllo",
      binary: false,
      cut: false,
      durationMs: 12,
    });
  });

  it.each([
    ["application/problem+json", '{"title":"no"}'],
    ["application/atom+xml", "<feed/>"],
    ["application/x-ndjson", "{}\n{}"],
  ])("reads %s as text", (type, body) => {
    expect(answerViewOf(answer(body, { "content-type": type }), context).body).toBe(body);
  });

  it("answers a body that is not text by its type and size alone", () => {
    const headers = { "content-type": "image/png", "content-length": "52344" };
    const view = answerViewOf(answer("\u0089PNG\r\n", headers), context);
    expect(view).toMatchObject({ contentType: "image/png", bytes: 52_344, binary: true });
    expect(view).not.toHaveProperty("body");
  });

  it("judges a body with no type by its characters", () => {
    expect(answerViewOf(answer("plain words", {}), context)).toMatchObject({
      body: "plain words",
      binary: false,
    });
    expect(answerViewOf(answer("a\u0000b", {}), context)).toMatchObject({ binary: true });
    expect(answerViewOf(answer("a�b", {}), context)).toMatchObject({ binary: true });
  });

  it("reads no body for a HEAD and none for an empty answer", () => {
    const headers = { "content-type": "application/json", "content-length": "900" };
    const head = answerViewOf(answer("", headers), { ...context, head: true });
    expect(head).toMatchObject({ bytes: 900, binary: false, cut: false });
    expect(head).not.toHaveProperty("body");
    const empty = answerViewOf({ status: 204, headers: {}, body: "" }, context);
    expect(empty).toMatchObject({ status: 204, bytes: 0, binary: false });
    expect(empty).not.toHaveProperty("body");
    expect(empty).not.toHaveProperty("contentType");
  });

  it("cuts a long body to fit a tool result, never inside a character", () => {
    const max = httpRequestLimits.answerBodyChars;
    const long = `${"a".repeat(max - 1)}𝐀 and more`;
    const view = answerViewOf(answer(long, { "content-type": "text/plain" }), context);
    expect(view.body).toBe("a".repeat(max - 1));
    expect(view.cut).toBe(true);
  });

  it("keeps only the headers the agent may need, at most 16, each cut", () => {
    const rateLimits = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [`x-ratelimit-${String(index)}`, "1"]),
    );
    const headers = {
      "content-type": "application/json",
      "set-cookie": "session=1",
      server: "nginx",
      "retry-after": "30",
      ratelimit: "limit=60, remaining=59".padEnd(800, " "),
      ...rateLimits,
    };
    const view = answerViewOf(answer("{}", headers), context);
    expect(view.headers).toHaveLength(httpRequestLimits.answerHeaders);
    expect(view.headers.map(({ name }) => name).slice(0, 4)).toStrictEqual([
      "content-type",
      "retry-after",
      "ratelimit",
      "x-ratelimit-0",
    ]);
    expect(view.headers[2]?.value).toHaveLength(httpRequestLimits.answerHeaderChars);
  });

  it("counts the body's bytes when content-length is not a count", () => {
    const view = answerViewOf(answer("ab", { "content-length": "lots" }), context);
    expect(view.bytes).toBe(2);
  });
});
