import { err, ok, type Result } from "@binference/core";
import type { FileCall } from "./file-records.js";
import type { FileRefusal, MachineFiles } from "./ports.js";

/** The most bytes of a file the agent's file tools read: 10 MiB. */
export const maxFileBytes: number = 10 * 1024 * 1024;

// A file whose first 8 KiB hold a zero byte is read as binary, never as text.
const binaryProbeBytes = 8_192;

/** A text file as read: its absolute path, its text, and the byte order mark it opened with. */
export interface FileText {
  readonly path: string;
  readonly text: string;
  readonly bom: string;
}

/** Whether a file's bytes are binary rather than text. */
export function isBinary(bytes: Readonly<Uint8Array>): boolean {
  return bytes.subarray(0, binaryProbeBytes).includes(0);
}

/** A file's bytes as UTF-8 text, its byte order mark kept apart. */
export function textOf(bytes: Readonly<Uint8Array>): {
  readonly text: string;
  readonly bom: string;
} {
  const decoded = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  const bom = decoded.startsWith("﻿") ? "﻿" : "";
  return { text: decoded.slice(bom.length), bom };
}

/** Reads a text file whole: a binary one is `binary`. */
export async function readText(
  files: MachineFiles,
  path: string,
  call: FileCall,
): Promise<Result<FileText, FileRefusal | "binary">> {
  const read = await files.read(path, { ...call, maxBytes: maxFileBytes });
  if (!read.ok) {
    return read;
  }
  if (isBinary(read.value.bytes)) {
    return err("binary");
  }
  return ok({ path: read.value.path, ...textOf(read.value.bytes) });
}
