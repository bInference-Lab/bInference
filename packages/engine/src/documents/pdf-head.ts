const head = Buffer.from("%PDF-", "latin1");

/** Whether the bytes are a PDF's: its header within its first 1,024 bytes, as PDF readers allow. */
export function opensAsPdf(bytes: Readonly<Uint8Array>): boolean {
  return Buffer.from(bytes.subarray(0, 1_024)).includes(head);
}

/** Whether a file opens with a PDF's header at its first byte, which a text file never does. */
export function startsAsPdf(bytes: Readonly<Uint8Array>): boolean {
  return Buffer.from(bytes.subarray(0, head.byteLength)).equals(head);
}
