import { createHash } from "node:crypto";
import { join } from "node:path";
import { createPlatform, type IpcEndpoint, type Platform } from "@binference/platform";
import type { CliHost } from "../program/cli-host.js";

/** This OS's platform for the state folder the host names through `BINFERENCE_HOME`. */
export function platformOf(host: Pick<CliHost, "env" | "homeDir">): Platform {
  return createPlatform({
    binferenceHome: host.env["BINFERENCE_HOME"],
    xdgConfigHome: host.env["XDG_CONFIG_HOME"],
    display: host.env["DISPLAY"],
    waylandDisplay: host.env["WAYLAND_DISPLAY"],
    ...(host.homeDir === undefined ? {} : { homeDir: host.homeDir }),
  });
}

/**
 * The id that names this state folder's pipes on Windows: the first 32 hex digits of the SHA-256
 * of the folder's path in lower case, so the engine and every CLI on one folder find the same
 * pipe, and engines on two folders never share one.
 */
export function folderPipeId(root: string): string {
  return createHash("sha256").update(root.toLowerCase(), "utf8").digest("hex").slice(0, 32);
}

/** The engine's IPC endpoint in the platform's state folder. */
export function engineEndpoint(platform: Platform): IpcEndpoint {
  return platform.ipcEndpoint({
    name: "engine",
    installId: folderPipeId(platform.stateFolder.root),
  });
}

/** The engine's log file in the platform's state folder: `logs/engine.log`. */
export function engineLogFile(platform: Platform): string {
  return join(platform.stateFolder.logs, "engine.log");
}
