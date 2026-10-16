import { maxImageBytes } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { pickImages } from "./picked-images";

const png = (name: string, size = 10) => ({ name, size, type: "image/png" });

describe("pickImages", () => {
  it("keeps PNG, JPEG and WebP images up to 5 MiB, four a message, and says why it left one out", () => {
    const first = pickImages([], [png("a.png"), { name: "b.jpg", size: 10, type: "image/jpeg" }]);
    const added = [
      { name: "c.gif", size: 10, type: "image/gif" },
      png("d.png", maxImageBytes + 1),
      png("e.png", maxImageBytes),
      { name: "f.webp", size: 10, type: "image/webp" },
      png("g.png"),
    ];
    const next = pickImages(first.kept, added);
    expect(next.kept.map((image) => [image.name, image.contentType])).toStrictEqual([
      ["a.png", "image/png"],
      ["b.jpg", "image/jpeg"],
      ["e.png", "image/png"],
      ["f.webp", "image/webp"],
    ]);
    expect(next.refused).toStrictEqual([
      { reason: "format", name: "c.gif" },
      { reason: "tooLarge", name: "d.png" },
      { reason: "tooMany", name: "g.png" },
    ]);
  });
});
