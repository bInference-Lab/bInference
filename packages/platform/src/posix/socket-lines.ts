import type { Socket } from "node:net";

const lineBreak = 0x0a;

/**
 * Hands each line the socket reads to `onLine` as text, without its line break, in order. A line,
 * or what waits for its line break, longer than `maxBytes` ends the socket, and so may `onLine`:
 * nothing after that is handed on.
 */
export function readSocketLines(
  socket: Socket,
  maxBytes: number,
  onLine: (line: string) => void,
): void {
  let held = Buffer.alloc(0);
  socket.on("data", (chunk: Buffer) => {
    held = Buffer.concat([held, chunk]);
    for (let end = held.indexOf(lineBreak); end !== -1; end = held.indexOf(lineBreak)) {
      const line = held.subarray(0, end);
      held = held.subarray(end + 1);
      if (line.byteLength > maxBytes) {
        socket.destroy();
      }
      if (socket.destroyed) {
        return;
      }
      onLine(line.toString("utf8"));
    }
    if (held.byteLength > maxBytes) {
      socket.destroy();
    }
  });
}
