/** One part of something the engine answers in parts: its bytes in base64, and where the next starts. */
interface Part {
  readonly data: string;
  readonly next?: number;
}

/**
 * Reads something the engine answers in parts whole, in order, up to `maxBytes`; `undefined` when
 * a part is refused. `part` asks for the part at an offset.
 */
export async function readParts(
  part: (offset: number) => Promise<Part | undefined>,
  maxBytes: number,
): Promise<Uint8Array | undefined> {
  const pieces: Buffer[] = [];
  let offset: number | undefined = 0;
  while (offset !== undefined && offset < maxBytes) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the engine answers the parts in order
    const read = await part(offset);
    if (read === undefined) {
      return undefined;
    }
    pieces.push(Buffer.from(read.data, "base64"));
    offset = read.next;
  }
  return new Uint8Array(Buffer.concat(pieces));
}
