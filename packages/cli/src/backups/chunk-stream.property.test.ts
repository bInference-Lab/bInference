import { createHash, randomBytes } from "node:crypto";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { joined, listed, piecesOf } from "./backup-fixtures.js";
import { chunkBytes } from "./chunk-cipher.js";
import { openBody, sealBody } from "./chunk-stream.js";

const dataKey = randomBytes(32);
const frame = {
  noncePrefix: randomBytes(8),
  headerDigest: createHash("sha256").update("a header").digest(),
};
const runs = { numRuns: 25 };

// A body of up to four chunks, sizes that end on a chunk's edge included.
const sizeArbitrary = fc.oneof(
  fc.integer({ min: 0, max: 4 * chunkBytes }),
  fc.integer({ min: 0, max: 4 }).map((chunks) => chunks * chunkBytes),
);

function plaintextOf(size: number, seed: number): Buffer {
  return Buffer.from(Array.from({ length: size }, (_, index) => (index * 31 + seed) % 251));
}

const collect = joined;

async function sealedFrames(plaintext: Buffer, key = dataKey): Promise<Uint8Array[]> {
  return listed(sealBody(piecesOf([plaintext]), key, frame));
}

function at(frames: readonly Uint8Array[], index: number): Uint8Array {
  const found = frames[index % frames.length];
  if (found === undefined) {
    throw new Error("Expected a frame.");
  }
  return found;
}

function swapped(frames: readonly Uint8Array[], first: number, second: number): Uint8Array[] {
  return frames.with(first, at(frames, second)).with(second, at(frames, first));
}

async function opened(frames: readonly Uint8Array[], options = { frame }): Promise<Buffer> {
  return collect(openBody(piecesOf(frames), dataKey, options.frame));
}

const damaged = { code: "backup.damaged" };

describe("a backup's chunked body", () => {
  it("opens to the same bytes, whatever pieces the file is read in", async () => {
    await fc.assert(
      fc.asyncProperty(sizeArbitrary, fc.integer({ min: 1, max: 100_000 }), async (size, step) => {
        const plaintext = plaintextOf(size, step);
        const whole = Buffer.concat(await sealedFrames(plaintext));
        const pieces = Array.from({ length: Math.ceil(whole.length / step) }, (_, index) =>
          whole.subarray(index * step, (index + 1) * step),
        );
        expect(await collect(openBody(piecesOf(pieces), dataKey, frame))).toStrictEqual(plaintext);
      }),
      runs,
    );
  });

  it("holds one final chunk for no bytes, and a full final chunk on a chunk's edge", async () => {
    expect(await sealedFrames(Buffer.alloc(0))).toHaveLength(1);
    expect(await opened(await sealedFrames(Buffer.alloc(0)))).toStrictEqual(Buffer.alloc(0));
    expect(await sealedFrames(plaintextOf(2 * chunkBytes, 1))).toHaveLength(2);
  });

  it("fails when two chunks change places", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: chunkBytes + 1, max: 4 * chunkBytes }),
        fc.nat(),
        fc.nat(),
        async (size, first, second) => {
          const frames = await sealedFrames(plaintextOf(size, 3));
          const [a, b] = [first % frames.length, second % frames.length];
          fc.pre(a !== b);
          await expect(opened(swapped(frames, a, b))).rejects.toMatchObject(damaged);
        },
      ),
      runs,
    );
  });

  it("fails when a chunk is dropped", async () => {
    await fc.assert(
      fc.asyncProperty(sizeArbitrary, fc.nat(), async (size, drop) => {
        const frames = await sealedFrames(plaintextOf(size, 5));
        const dropped = frames.filter((_, index) => index !== drop % frames.length);
        await expect(opened(dropped)).rejects.toMatchObject(damaged);
      }),
      runs,
    );
  });

  it("fails when the file is cut at any byte", async () => {
    await fc.assert(
      fc.asyncProperty(sizeArbitrary, fc.nat(), async (size, cut) => {
        const whole = Buffer.concat(await sealedFrames(plaintextOf(size, 7)));
        await expect(opened([whole.subarray(0, cut % whole.length)])).rejects.toMatchObject(
          damaged,
        );
      }),
      runs,
    );
  });

  it("fails when a chunk is added after the last one", async () => {
    await fc.assert(
      fc.asyncProperty(sizeArbitrary, fc.nat(), async (size, copied) => {
        const frames = await sealedFrames(plaintextOf(size, 9));
        await expect(opened([...frames, at(frames, copied)])).rejects.toMatchObject(damaged);
      }),
      runs,
    );
  });

  it("fails when any byte changes", async () => {
    await fc.assert(
      fc.asyncProperty(
        sizeArbitrary,
        fc.nat(),
        fc.integer({ min: 1, max: 255 }),
        async (size, where, bits) => {
          const whole = Buffer.concat(await sealedFrames(plaintextOf(size, 11)));
          const place = where % whole.length;
          whole.writeUInt8(whole.readUInt8(place) ^ bits, place);
          await expect(opened([whole])).rejects.toMatchObject(damaged);
        },
      ),
      runs,
    );
  });

  it("fails under another backup's header or data key", async () => {
    await fc.assert(
      fc.asyncProperty(sizeArbitrary, fc.string({ minLength: 1 }), async (size, other) => {
        const plaintext = plaintextOf(size, 13);
        const otherDigest = createHash("sha256").update(`other ${other}`).digest();
        const otherFrame = { ...frame, headerDigest: otherDigest };
        await expect(
          opened(await sealedFrames(plaintext), { frame: otherFrame }),
        ).rejects.toMatchObject(damaged);
        await expect(opened(await sealedFrames(plaintext, randomBytes(32)))).rejects.toMatchObject(
          damaged,
        );
      }),
      runs,
    );
  });

  it("fails for an empty body", async () => {
    await expect(opened([])).rejects.toMatchObject(damaged);
  });
});
