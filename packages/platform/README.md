# @binference/platform

## Purpose

The OS layer. It hides what differs between macOS, Linux and Windows behind a few functions and
ports:

- the state folder, `~/.binference` on every OS, moved by `BINFERENCE_HOME`;
- owner-only files and folders: modes `0600` and `0700` on macOS and Linux, an access list that
  names the owner alone on Windows;
- the engine lock, an OS file lock that lets one engine run per state folder and frees itself when
  the engine's process ends;
- IPC over a Unix socket in the state folder, or a named pipe on Windows, with length-prefixed
  frames and a handshake in which both sides prove they hold a shared key;
- one shutdown sequence for `SIGINT` and `SIGTERM`, Windows `SIGINT` and `SIGBREAK`, and stop
  requests.

## API

| Export                              | What it does                                                         |
| ----------------------------------- | -------------------------------------------------------------------- |
| `createPlatform`, `Platform`        | This OS's adapters, its stop signals and the state folder            |
| `resolveStateFolder`, `StateFolder` | Every path in the state folder; creates nothing                      |
| `FilePermissions`                   | The port that makes a file or folder owner-only                      |
| `ensurePrivateFolder`               | Creates a folder and restricts it to its owner                       |
| `writePrivateFile`                  | Writes a file only its owner can read, replacing the old one at once |
| `acquireFileLock`, `FileLock`       | An exclusive OS file lock, or `held` while another holder has it     |
| `IpcEndpoint`, `IpcBinding`         | The port that listens on and connects to one local IPC address       |
| `openIpcChannel`, `IpcChannel`      | An authenticated channel of schema-checked JSON messages             |
| `createShutdown`, `Shutdown`        | Runs the shutdown steps in order on a stop signal, within a budget   |
| `@binference/platform/testing`      | The contract suites for `FilePermissions` and `IpcEndpoint`          |

Error codes start with `platform.`, such as `platform.ipc_path_too_long` when a socket path is
longer than macOS allows.

## Example

The composition root takes the engine lock, listens for the signer and stops in order:

```ts
import { acquireFileLock, createPlatform, createShutdown } from "@binference/platform";

const platform = createPlatform({ binferenceHome: process.env["BINFERENCE_HOME"] });
const lock = acquireFileLock(platform.stateFolder.engineLock);
if (!lock.ok) {
  throw new Error("Another engine already runs on this state folder.");
}

const endpoint = platform.ipcEndpoint({ name: "signer", installId });
const bound = await endpoint.bind({ signal, onSocket: (socket) => serveSigner(socket, key) });

const shutdown = createShutdown({
  clock,
  budgetMs: 30_000,
  events: process,
  signals: platform.stopSignals,
});
if (bound.ok) {
  shutdown.add("close the signer endpoint", async () => bound.value.close());
}
shutdown.add("free the engine lock", async () => lock.value.release());
const report = await shutdown.finished;
```

`serveSigner` opens `openIpcChannel({ socket, key, role: "server", inbound, outbound, signal })`,
where `key` is 32 random bytes the engine hands the signer on its standard input.
