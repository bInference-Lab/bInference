import { BinferenceError } from "@binference/core";

const newline = 0x0a;
const carriageReturn = 0x0d;

/** The longest line the signer reads: a Privy request is a few kilobytes. */
export const maxLineBytes: number = 1024 * 1024;

function lineTooLong(): BinferenceError {
  return new BinferenceError({
    code: "signer.line_too_long",
    message: `A line on the signer's channel is over ${String(maxLineBytes)} bytes.`,
  });
}

// A copy of one line without its line break; Windows writers end lines with CR LF.
function lineOf(bytes: Buffer, start: number, end: number): Buffer {
  const last = end > start && bytes[end - 1] === carriageReturn ? end - 1 : end;
  return Buffer.from(bytes.subarray(start, last));
}

function splitLines(bytes: Buffer): { readonly lines: Buffer[]; readonly rest: Buffer } {
  const lines: Buffer[] = [];
  let start = 0;
  for (let end = bytes.indexOf(newline); end !== -1; end = bytes.indexOf(newline, start)) {
    lines.push(lineOf(bytes, start, end));
    start = end + 1;
  }
  return { lines, rest: Buffer.from(bytes.subarray(start)) };
}

/**
 * Cuts a byte stream into lines, LF or CR LF, without the line break. The first line the signer
 * reads holds the agent key, so every buffer the reader is done with is zeroed: each chunk it took,
 * each joined buffer, and what is left when the stream ends or the caller stops. The caller zeroes
 * each line it gets once it is done with it. Throws `signer.line_too_long` as soon as a line passes
 * {@link maxLineBytes}; text after the last line break is dropped.
 */
export async function* readLines(input: AsyncIterable<Uint8Array>): AsyncGenerator<Buffer> {
  let pending: Buffer = Buffer.alloc(0);
  try {
    for await (const chunk of input) {
      const joined = Buffer.concat([pending, chunk]);
      // The stream hands its chunks over, so zeroing them keeps the key off the heap.
      chunk.fill(0);
      pending.fill(0);
      const { lines, rest } = splitLines(joined);
      joined.fill(0);
      pending = rest;
      if (
        pending.byteLength > maxLineBytes ||
        lines.some((line) => line.byteLength > maxLineBytes)
      ) {
        lines.forEach((line) => line.fill(0));
        throw lineTooLong();
      }
      yield* lines;
    }
  } finally {
    pending.fill(0);
  }
}
