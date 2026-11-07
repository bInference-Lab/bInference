import { err, ok, type Result } from "@binference/core";
import type { FileCall } from "./file-records.js";
import type { FileRefusal, MachineFiles } from "./ports.js";

function same(left: Readonly<Uint8Array>, right: Readonly<Uint8Array>): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

/**
 * Writes a file and reads it back (decision 0386): answers the absolute path once the file holds
 * exactly the bytes written, and `unwritable` when it holds anything else, so no write reports
 * done that did not land.
 */
export async function writeChecked(
  files: Readonly<MachineFiles>,
  file: { readonly path: string; readonly bytes: Readonly<Uint8Array> },
  call: FileCall,
): Promise<Result<string, FileRefusal>> {
  const written = await files.write(file.path, file.bytes, call);
  if (!written.ok) {
    return written;
  }
  const read = await files.read(file.path, { ...call, maxBytes: file.bytes.byteLength });
  return read.ok && same(read.value.bytes, file.bytes) ? ok(written.value) : err("unwritable");
}

/** The absolute path of the file at a path when it holds exactly these bytes now, else none. */
export async function holdingAlready(
  files: Readonly<MachineFiles>,
  file: { readonly path: string; readonly bytes: Readonly<Uint8Array> },
  call: FileCall,
): Promise<string | undefined> {
  const read = await files.read(file.path, { ...call, maxBytes: file.bytes.byteLength });
  return read.ok && same(read.value.bytes, file.bytes) ? read.value.path : undefined;
}
