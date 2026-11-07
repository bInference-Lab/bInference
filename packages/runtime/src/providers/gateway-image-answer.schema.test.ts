import { describe, expect, it } from "vitest";
import { gatewayImagesOf } from "./gateway-image-answer.schema.js";

const bytes = Uint8Array.from([1, 2, 3]);
const base64 = Buffer.from(bytes).toString("base64");

describe("the images of a gateway image answer", () => {
  it("reads each entry's base64, with line breaks or the URL-safe alphabet, and its tokens", () => {
    const answer = {
      created: 1,
      data: [
        { b64_json: base64, media_type: "image/png" },
        { b64_json: `${base64.slice(0, 2)}\n${base64.slice(2)}` },
      ],
      usage: { input_tokens: 20, output_tokens: 1_300, cost: 0.0084 },
    };
    expect(gatewayImagesOf(answer)).toStrictEqual({
      images: [bytes, bytes],
      shape: "fields created,data,usage; data 2",
      usage: { inputTokens: 20, outputTokens: 1_300 },
    });
  });

  it("never fetches a link, and names what each entry lacked", () => {
    const answer = { data: [{ url: "https://example.test/frog.png" }, { b64_json: "!!" }, {}] };
    expect(gatewayImagesOf(answer)).toStrictEqual({
      images: [],
      shape: "fields data; data 3 (a link, never fetched; bad base64; fields none)",
    });
  });

  it("gives the error sent with a success, with the provider and words in its metadata", () => {
    const error = {
      code: 502,
      message: "Provider  returned\nerror",
      metadata: { provider_name: "OpenAI", raw: "Image generation is not enabled for this key." },
    };
    expect(gatewayImagesOf({ id: "gen-1", error })).toStrictEqual({
      images: [],
      shape: "fields id,error; data 0",
      error:
        "Provider returned error (code 502); from OpenAI: Image generation is not enabled for this key.",
    });
  });

  it("names an answer that is not an object", () => {
    expect(gatewayImagesOf("oops")).toStrictEqual({
      images: [],
      shape: "an answer that is not an object (string)",
    });
  });
});
