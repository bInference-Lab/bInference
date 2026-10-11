import { BinferenceError } from "@binference/core";

/** Reads exact runs of bytes from pieces of any size, in order. */
export interface ByteReader {
  /** The next `length` bytes; throws `backup.archive_damaged` when fewer are left. */
  take(length: number): Promise<Uint8Array>;
  /** Whether every byte was taken. */
  isDone(): Promise<boolean>;
  /** Stops the pieces' source, such as an open file, when the reading ends early. */
  close(): Promise<void>;
}

/** A {@link ByteReader} over pieces of bytes, which it pulls only as a call needs them. */
export function createByteReader(pieces: AsyncIterable<Uint8Array>): ByteReader {
  const source = pieces[Symbol.asyncIterator]();
  let buffered = Buffer.alloc(0);
  let isSourceDone = false;
  const fill = async (length: number): Promise<void> => {
    while (buffered.length < length && !isSourceDone) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- each piece follows the one before
      const next = await source.next();
      if (next.done === true) {
        isSourceDone = true;
      } else {
        buffered = Buffer.concat([buffered, next.value]);
      }
    }
  };
  return {
    take: async (length) => {
      await fill(length);
      if (buffered.length < length) {
        throw new BinferenceError({
          code: "backup.archive_damaged",
          message: `The backup's archive ends ${String(length - buffered.length)} bytes early.`,
        });
      }
      const taken = buffered.subarray(0, length);
      buffered = buffered.subarray(length);
      return taken;
    },
    isDone: async () => {
      await fill(1);
      return buffered.length === 0;
    },
    close: async () => {
      await source.return?.();
    },
  };
}
