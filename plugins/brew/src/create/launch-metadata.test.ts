import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { testPicture } from "../testing/launch-fixtures.js";
import { launchMetadataOf, pictureBytesFor, readLaunchMetadata } from "./launch-metadata.js";

const words = { description: "A cat on the moon", links: { x: "https://x.com/mooncat" } };
const sha256 = createHash("sha256").update(testPicture.bytes).digest("hex");
// TapeBrew's metadata address, as a launch from brew.family wrote it: its picture is a contract.
const onChainPicture =
  "data:application/json;base64,eyJ2IjoxLCJpbWFnZSI6Im9uY2hhaW46Ly81Ni8weGUzOTUxMTU0NWU1OWU3NWI1MmMwYTFlN2ZkZGZmMTg3ZmVmNmFhYTkifQ==";

describe("a Brew launch's metadata address", () => {
  it("carries the words and the picture in the document Brew's site reads", () => {
    const address = launchMetadataOf(words, testPicture);
    const document: unknown = JSON.parse(
      Buffer.from(address.slice("data:application/json;base64,".length), "base64").toString(),
    );
    expect(document).toStrictEqual({
      v: 1,
      description: "A cat on the moon",
      twitter: "https://x.com/mooncat",
      image: `data:image/png;base64,${Buffer.from(testPicture.bytes).toString("base64")}`,
    });
  });

  it("reads back the words and the picture's digest from what it writes", () => {
    expect(readLaunchMetadata(launchMetadataOf(words, testPicture))).toStrictEqual({
      words: {
        description: "A cat on the moon",
        links: { website: "", x: "https://x.com/mooncat", telegram: "" },
      },
      picture: { contentType: "image/png", sha256 },
    });
  });

  it.each([
    ["another document form", onChainPicture],
    [
      "a document it would write another way",
      `data:application/json;base64,${Buffer.from('{"image":"data:image/png;base64,iVBO","v":1}').toString("base64")}`,
    ],
    ["no document", "ipfs://bafkrei"],
  ])("reads nothing from %s", (_case, address) => {
    expect(readLaunchMetadata(address)).toBeUndefined();
  });

  it("takes a picture of about 1 KB beside no words, and less beside long ones", () => {
    const bare = pictureBytesFor({});
    expect(bare).toBeGreaterThan(1_000);
    expect(bare).toBeLessThan(1_200);
    expect(pictureBytesFor({ description: "a".repeat(600) })).toBeLessThan(bare - 400);
    const fits = new Uint8Array(bare);
    const address = launchMetadataOf({}, { contentType: "image/webp", bytes: fits });
    expect(new TextEncoder().encode(address).byteLength).toBeLessThanOrEqual(2_048);
    const over = new Uint8Array(bare + 3);
    const longer = launchMetadataOf({}, { contentType: "image/webp", bytes: over });
    expect(new TextEncoder().encode(longer).byteLength).toBeGreaterThan(2_048);
  });
});
