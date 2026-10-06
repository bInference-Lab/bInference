import { Buffer } from "node:buffer";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { BinferenceError, err, ok, type Result } from "@binference/core";
import { acquireFileLock } from "../file-lock.js";
import { checkEndpointPart } from "../ipc/endpoint-part.js";
import type { IpcBindOptions, IpcBinding } from "../ipc/ipc-binding.js";
import { connectTo, listenOn } from "../ipc/ipc-sockets.js";
import type { FilePermissions, IpcEndpoint } from "../ports.js";
import { ensurePrivateFolder } from "../private-files.js";

/** Where a POSIX endpoint lives and how its folder is kept owner-only. */
export interface PosixIpcEndpointOptions {
  /** The state folder's `run` folder. */
  readonly runFolder: string;
  /** The endpoint's name, such as `engine` or `signer`; the socket is `<name>.sock`. */
  readonly name: string;
  readonly permissions: FilePermissions;
}

// macOS keeps 104 bytes for a socket path, its terminator included; Linux keeps 108.
const maxSocketPathBytes = 103;

function checkLength(address: string): void {
  const bytes = Buffer.byteLength(address);
  if (bytes > maxSocketPathBytes) {
    throw new BinferenceError({
      code: "platform.ipc_path_too_long",
      message:
        `The socket path ${address} is ${String(bytes)} bytes, over the limit of ` +
        `${String(maxSocketPathBytes)}; set BINFERENCE_HOME to a shorter folder.`,
      details: { bytes },
    });
  }
}

async function bindLocked(
  address: string,
  options: IpcBindOptions,
  permissions: FilePermissions,
): Promise<Result<IpcBinding, "in_use">> {
  // Node deletes the socket file when a server closes, even one another process bound since, so
  // only the holder of this lock removes a stale socket, listens, and closes.
  const lock = acquireFileLock(`${address}.lock`);
  if (!lock.ok) {
    return err("in_use");
  }
  try {
    await rm(address, { force: true });
    const bound = await listenOn(address, options);
    if (!bound.ok) {
      lock.value.release();
      return bound;
    }
    await permissions.restrictFile(address, options.signal);
    return ok({
      close: async () => {
        await bound.value.close();
        lock.value.release();
      },
    });
  } catch (error) {
    lock.value.release();
    throw error;
  }
}

/**
 * A Unix socket `<name>.sock` in an owner-only `run` folder, for macOS and Linux. Throws
 * `platform.ipc_path_too_long` at once when the path is too long for the OS to bind.
 */
export function createPosixIpcEndpoint(options: PosixIpcEndpointOptions): IpcEndpoint {
  const address = join(options.runFolder, `${checkEndpointPart(options.name, "name")}.sock`);
  checkLength(address);
  return {
    address,
    bind: async (bindOptions) => {
      await ensurePrivateFolder(options.runFolder, {
        permissions: options.permissions,
        signal: bindOptions.signal,
      });
      return bindLocked(address, bindOptions, options.permissions);
    },
    connect: async (signal) => connectTo(address, signal),
  };
}
