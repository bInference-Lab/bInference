import { describe, expect, it } from "vitest";
import { chatImagesOf } from "./chat-image-answer.schema.js";

const bytes = Uint8Array.from([1, 2, 3]);
const url = `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;

describe("the images of a chat answer", () => {
  it("reads them from a message's images, its text and its parts, and never a link elsewhere", () => {
    const answer = {
      choices: [
        { message: { images: [{ image_url: { url } }], content: `Made: ${url}` } },
        {
          message: {
            content: [
              { type: "image_url", image_url: { url } },
              { type: "image_url", image_url: { url: "https://example.test/frog.png" } },
              { b64_json: Buffer.from(bytes).toString("base64") },
            ],
          },
        },
      ],
    };
    expect(chatImagesOf(answer)?.images).toStrictEqual([bytes, bytes, bytes, bytes]);
  });

  it("answers no images for words alone, and nothing for an answer that is not a chat", () => {
    expect([
      chatImagesOf({ choices: [{ message: { content: "No." } }] }),
      chatImagesOf({ choices: "no" }),
    ]).toStrictEqual([{ images: [] }, undefined]);
  });
});
