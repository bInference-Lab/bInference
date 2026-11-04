// oxlint-disable-next-line eslint/no-restricted-imports -- the launcher starts plugins with no library that loads more code
import { spawn } from "node:child_process";
// oxlint-disable-next-line eslint/no-restricted-imports -- the launcher makes each plugin's data folder, owner-only, in the image, and removes it
import { mkdir, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import process from "node:process";
import { type ResidentWatch, watchResident } from "../host/watch-resident.js";
import { type PluginFolders, pluginNodeArguments } from "../process/plugin-node-arguments.js";
import { parseLaunchRequest } from "./launch-request.schema.js";

/** What the plugin launcher runs with (decision 0344). */
export interface LauncherOptions {
  /** The socket it listens on. */
  readonly socket: string;
  /** The plugin program, `plugin-process.mjs`, by its real path. */
  readonly program: string;
  /** A plugin's folders, from its id alone. */
  folders(id: string): PluginFolders;
  /** What the plugin's process gets of an environment: what the OS needs to run Node. */
  readonly env: Readonly<Record<string, string>>;
  /** How the launcher watches each plugin's resident memory, ending one past the limit. */
  readonly memory: ResidentWatch;
}

// A request is a plugin id: a line far shorter than this.
const maxRequestBytes = 256;
const lineBreak = 0x0a;

/** The line the launcher answers a removal with, once the plugin's data folder is gone. */
export const dataRemovedLine = "removed\n";

// Starts the plugin a request names, its input and output piped to the connection both ways, or
// removes its data folder and says so (decision 0351); a request that names none, or a start that
// fails, ends the connection.
async function startFor(head: Buffer, socket: Socket, options: LauncherOptions): Promise<void> {
  const lineEnd = head.indexOf(lineBreak);
  const parsed = parseLaunchRequest(head.subarray(0, lineEnd).toString("utf8"));
  if (parsed === undefined) {
    socket.destroy();
    return;
  }
  const folders = options.folders(parsed.plugin);
  if (parsed.removeData === true) {
    await rm(folders.dataFolder, { recursive: true, force: true });
    socket.end(dataRemovedLine);
    return;
  }
  await mkdir(folders.dataFolder, { recursive: true, mode: 0o700 });
  const child = spawn(process.execPath, pluginNodeArguments(options.program, folders), {
    cwd: folders.packageFolder,
    env: options.env,
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
  });
  const exited = new Promise<number | null>((resolve) => {
    child.once("close", resolve);
  });
  watchResident({ pid: child.pid, exited, kill: () => child.kill("SIGKILL") }, options.memory);
  child.stdin.on("error", () => socket.destroy());
  child.once("error", () => socket.destroy());
  child.once("close", () => socket.end());
  socket.once("close", () => child.kill("SIGKILL"));
  child.stdin.write(head.subarray(lineEnd + 1));
  socket.pipe(child.stdin);
  child.stdout.pipe(socket, { end: false });
}

// Holds a connection's bytes until its first line, the request, then hands it to its plugin.
function relay(socket: Socket, options: LauncherOptions): void {
  let head = Buffer.alloc(0);
  socket.on("error", () => socket.destroy());
  const read = (chunk: Buffer): void => {
    head = Buffer.concat([head, chunk]);
    if (head.includes(lineBreak)) {
      socket.off("data", read);
      socket.pause();
      startFor(head, socket, options).catch(() => socket.destroy());
    } else if (head.byteLength > maxRequestBytes) {
      socket.destroy();
    }
  };
  socket.on("data", read);
}

/**
 * Serves the image's plugin launcher (decision 0344): it listens on `socket`, which the engine's
 * group and its own user may open, and starts one plugin per connection under its own OS user,
 * with `pluginNodeArguments` and the folders its id names, never a path or a command line the
 * engine sends. It relays the plugin's channel as it is; the engine checks every message. A
 * request with `removeData` removes the data folder its id names instead, answers
 * `dataRemovedLine` and closes (decision 0351). A connection that does not name a plugin in its
 * first 256 bytes is closed, and a plugin ends with its connection. The signal closes the socket.
 */
export async function serveLauncher(
  options: LauncherOptions,
  signal: AbortSignal,
): Promise<Server> {
  const server = createServer((socket) => relay(socket, options));
  signal.addEventListener("abort", () => server.close(), { once: true });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ path: options.socket, readableAll: true, writableAll: true }, () =>
      resolve(server),
    );
  });
}
