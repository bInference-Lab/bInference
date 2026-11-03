import type { ProtocolClient } from "@binference/client";
import { imagePartBytes, maxImageBytes, protocolIdSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { readDraftPicture } from "./draft-picture";

const agent = protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const draft = "c2hvd24tb25jZS1h";
const live = AbortSignal.timeout(5_000);

const bytes = (...values: readonly number[]) => Uint8Array.from(values);
const webp = Uint8Array.from([
  ...new TextEncoder().encode("RIFF"),
  0,
  0,
  0,
  0,
  ...new TextEncoder().encode("WEBP"),
]);
const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
// A PNG 10 bytes over one part, read in two.
const whole = Uint8Array.from({ length: imagePartBytes + 10 }, (_, at) => png[at] ?? at % 251);

// A client whose `launch/draftPicture` answers `served` in parts of 512 KiB, its size said as `said`.
function partsOf(served: Uint8Array, said = served.byteLength) {
  const asked: number[] = [];
  const client: Pick<ProtocolClient, "call"> = {
    call: async (_op, args) => {
      const { offset } = args as { readonly offset: number };
      asked.push(offset);
      const end = Math.min(served.byteLength, offset + imagePartBytes);
      const data = Buffer.from(served.subarray(offset, end)).toString("base64");
      const next = end < served.byteLength ? { next: end } : {};
      return Promise.resolve({
        contentType: "image/png",
        bytes: said,
        offset,
        data,
        ...next,
      } as never);
    },
  };
  return { client, asked };
}

describe("the draft's photo", () => {
  it("refuses a photo whose first bytes name no PNG, JPEG or WebP", async () => {
    const gif = new TextEncoder().encode("GIF89a");
    const { client } = partsOf(gif);
    expect(
      await readDraftPicture(client, { agent, draft, bytes: gif.byteLength }, live),
    ).toBeNull();
  });

  it("names a WebP by its first bytes", async () => {
    const { client } = partsOf(webp);
    const read = await readDraftPicture(client, { agent, draft, bytes: webp.byteLength }, live);
    expect(read?.contentType).toBe("image/webp");
  });

  it("reads a photo part by part into the same bytes", async () => {
    const { client, asked } = partsOf(whole);
    const read = await readDraftPicture(client, { agent, draft, bytes: whole.byteLength }, live);
    expect(asked).toStrictEqual([0, imagePartBytes]);
    expect(read?.contentType).toBe("image/png");
    expect(read?.bytes).toStrictEqual(whole);
  });

  it("refuses a photo over 5 MiB, or one whose size differs from what the draft said", async () => {
    const { client, asked } = partsOf(png);
    expect(
      await readDraftPicture(client, { agent, draft, bytes: maxImageBytes + 1 }, live),
    ).toBeNull();
    expect(asked).toStrictEqual([]);
    expect(await readDraftPicture(client, { agent, draft, bytes: 4 }, live)).toBeNull();
    const longer = partsOf(png, 4).client;
    expect(await readDraftPicture(longer, { agent, draft, bytes: 4 }, live)).toBeNull();
  });
});
