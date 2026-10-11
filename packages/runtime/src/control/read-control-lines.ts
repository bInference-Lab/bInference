import { BinferenceError } from "@binference/core";

/** The longest line either side of the control pipe reads: a start line with every setting fits. */
export const maxControlLineBytes: number = 1024 * 1024;

function lineTooLong(): BinferenceError {
  return new BinferenceError({
    code: "runtime.line_too_long",
    message: `A line on the runtime's control pipe is over ${String(maxControlLineBytes)} bytes.`,
  });
}

/**
 * Cuts a byte stream into UTF-8 text lines, LF or CR LF, without the line break, and skips empty
 * lines. Throws `runtime.line_too_long` as soon as a line passes {@link maxControlLineBytes},
 * before it buffers more; text after the last line break is dropped when the stream ends.
 */
export async function* readControlLines(input: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const state = { pending: "", pendingBytes: 0 };
  for await (const chunk of input) {
    state.pendingBytes += chunk.byteLength;
    const parts = (state.pending + decoder.decode(chunk, { stream: true })).split("\n");
    state.pending = parts.pop() ?? "";
    if (parts.length > 0) {
      state.pendingBytes = Buffer.byteLength(state.pending);
    }
    if (state.pendingBytes > maxControlLineBytes) {
      throw lineTooLong();
    }
    for (const part of parts) {
      const line = part.endsWith("\r") ? part.slice(0, -1) : part;
      if (Buffer.byteLength(line) > maxControlLineBytes) {
        throw lineTooLong();
      }
      if (line.length > 0) {
        yield line;
      }
    }
  }
}
