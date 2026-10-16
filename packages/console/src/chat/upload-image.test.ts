import { describe, expect, it } from "vitest";
import { fakeClient } from "../testing/fake-client";
import { uploadImage } from "./upload-image";

const live = { signal: new AbortController().signal };
const image = { body: new Blob([new Uint8Array(68)]), contentType: "image/png" } as const;

function answering(status: number, body: string) {
  const sent: string[] = [];
  const fetch = async (path: string): Promise<Response> => {
    sent.push(path);
    return new Response(body, { status });
  };
  return { sent, fetch };
}

describe("uploadImage", () => {
  it("starts the upload, sends the bytes to its path and answers the upload id", async () => {
    const engine = fakeClient({ "upload/start": () => ({ url: "/upload/t1", expiresAt: 1 }) });
    const http = answering(201, JSON.stringify({ upload: "upl_1" }));
    const upload = await uploadImage(
      { client: engine.client, fetch: http.fetch },
      image,
      live.signal,
    );
    expect([upload, http.sent, engine.calls[0]?.args]).toStrictEqual([
      "upl_1",
      ["/upload/t1"],
      { contentType: "image/png", bytes: 68 },
    ]);
  });

  it("rejects with the engine's code, or as unexpected when the answer is not the engine's", async () => {
    const engine = fakeClient({ "upload/start": () => ({ url: "/upload/t1", expiresAt: 1 }) });
    const refused = answering(
      413,
      JSON.stringify({ error: { code: "image.too_large", message: "" } }),
    );
    const proxy = answering(502, "<html>Bad gateway</html>");
    await expect(
      uploadImage({ client: engine.client, fetch: refused.fetch }, image, live.signal),
    ).rejects.toMatchObject({ code: "image.too_large" });
    await expect(
      uploadImage({ client: engine.client, fetch: proxy.fetch }, image, live.signal),
    ).rejects.toMatchObject({ code: "unexpected" });
  });
});
