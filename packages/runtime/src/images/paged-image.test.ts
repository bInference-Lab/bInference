import { ok } from "@binference/core";
import { type ImagePart, imagePartBytes } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { readPagedImage } from "./paged-image.js";

const parts = (answers: readonly ImagePart[]) => {
  const asked: number[] = [];
  return {
    asked,
    read: {
      part: async (offset: number) => {
        asked.push(offset);
        const answer = answers[asked.length - 1];
        return Promise.resolve(answer === undefined ? ok(answers[0] as ImagePart) : ok(answer));
      },
      unreadable: "unreadable" as const,
      tooLarge: "too_large" as const,
    },
  };
};

const b64 = (text: string) => Buffer.from(text).toString("base64");

describe("readPagedImage", () => {
  it("joins the parts, each read from where the one before said the next starts", async () => {
    const { asked, read } = parts([
      { contentType: "image/png", bytes: 6, offset: 0, data: b64("abc"), next: 3 },
      { contentType: "image/png", bytes: 6, offset: 3, data: b64("def") },
    ]);
    expect(await readPagedImage(read)).toStrictEqual(
      ok({ contentType: "image/png", data: b64("abcdef"), bytes: 6 }),
    );
    expect(asked).toStrictEqual([0, 3]);
  });

  it("refuses a part that starts elsewhere than asked", async () => {
    const { read } = parts([
      { contentType: "image/png", bytes: 6, offset: 0, data: b64("abc"), next: 3 },
      { contentType: "image/png", bytes: 6, offset: 1, data: b64("def") },
    ]);
    expect(await readPagedImage(read)).toMatchObject({ ok: false, error: "unreadable" });
  });

  it("refuses an image over 5 MiB", async () => {
    const { read } = parts([
      { contentType: "image/png", bytes: 6 * 1024 * 1024, offset: 0, data: b64("abc") },
    ]);
    expect(await readPagedImage(read)).toMatchObject({ ok: false, error: "too_large" });
  });

  it("stops an engine that never names a last part", async () => {
    const endless = Array.from({ length: 20 }, (_, index) => ({
      contentType: "image/png" as const,
      bytes: 1,
      offset: index * imagePartBytes,
      data: b64("a"),
      next: (index + 1) * imagePartBytes,
    }));
    const { read } = parts(endless);
    expect(await readPagedImage(read)).toMatchObject({ ok: false, error: "unreadable" });
  });
});
