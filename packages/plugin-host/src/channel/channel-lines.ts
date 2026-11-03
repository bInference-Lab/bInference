import { BinferenceError } from "@binference/core";

const lineBreak = 0x0a;

function tooLong(maxBytes: number): BinferenceError {
  return new BinferenceError({
    code: "plugin.message_too_large",
    message: `A message on a plugin's channel is over ${String(maxBytes)} bytes.`,
  });
}

/**
 * Cuts the channel's byte stream into its messages, one UTF-8 line each, without the line break.
 * It holds at most `maxBytes` of a line: one longer throws `plugin.message_too_large` before it
 * fills memory. Text after the last line break, when the stream ends, is dropped: a message the
 * writer did not finish.
 */
export async function* channelLines(
  input: AsyncIterable<Uint8Array>,
  maxBytes: number,
): AsyncGenerator<string> {
  let parts: Uint8Array[] = [];
  let held = 0;
  for await (const chunk of input) {
    let start = 0;
    for (let end = chunk.indexOf(lineBreak); end !== -1; end = chunk.indexOf(lineBreak, start)) {
      if (held + end - start > maxBytes) {
        throw tooLong(maxBytes);
      }
      parts.push(chunk.subarray(start, end));
      yield Buffer.concat(parts).toString("utf8");
      parts = [];
      held = 0;
      start = end + 1;
    }
    held += chunk.byteLength - start;
    if (held > maxBytes) {
      throw tooLong(maxBytes);
    }
    parts.push(chunk.subarray(start));
  }
}
