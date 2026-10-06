import { checkEndpointPart } from "../ipc/endpoint-part.js";
import { connectTo, listenOn } from "../ipc/ipc-sockets.js";
import type { IpcEndpoint } from "../ports.js";

/** What names a Windows pipe. */
export interface Win32IpcEndpointOptions {
  /** The install's id: pipes share one namespace across the machine, unlike socket files. */
  readonly installId: string;
  /** The endpoint's name, such as `engine` or `signer`. */
  readonly name: string;
}

/**
 * A named pipe `\\.\pipe\binference-<install id>-<name>` for Windows. Windows frees the name when
 * its listener ends, so no stale file or lock is left. Node cannot set the pipe's access list:
 * authenticate every connection with `openIpcChannel`.
 */
export function createWin32IpcEndpoint(options: Win32IpcEndpointOptions): IpcEndpoint {
  const installId = checkEndpointPart(options.installId, "install id");
  const name = checkEndpointPart(options.name, "name");
  const address = `\\\\.\\pipe\\binference-${installId}-${name}`;
  return {
    address,
    bind: async (bindOptions) => listenOn(address, bindOptions),
    connect: async (signal) => connectTo(address, signal),
  };
}
