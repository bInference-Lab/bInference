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
  frames and a handshake in which both sides prove they hold a shared key.

## API

| Export                              | What it does                                                         |
| ----------------------------------- | -------------------------------------------------------------------- |
| `resolveStateFolder`, `StateFolder` | Every path in the state folder; creates nothing                      |
| `FilePermissions`                   | The port that makes a file or folder owner-only                      |
| `ensurePrivateFolder`               | Creates a folder and restricts it to its owner                       |
| `writePrivateFile`                  | Writes a file only its owner can read, replacing the old one at once |
| `acquireFileLock`, `FileLock`       | An exclusive OS file lock, or `held` while another holder has it     |
| `IpcEndpoint`, `IpcBinding`         | The port that listens on and connects to one local IPC address       |
| `openIpcChannel`, `IpcChannel`      | An authenticated channel of schema-checked JSON messages             |
| `@binference/platform/testing`      | The contract suites for `FilePermissions` and `IpcEndpoint`          |

Error codes start with `platform.`, such as `platform.ipc_path_too_long` when a socket path is
longer than macOS allows.

## Example

The composition root takes the engine lock, then asks the signer over an authenticated channel:

```ts
import { acquireFileLock, openIpcChannel, resolveStateFolder } from "@binference/platform";

const stateFolder = resolveStateFolder({ binferenceHome: process.env["BINFERENCE_HOME"] });
const lock = acquireFileLock(stateFolder.engineLock);
if (!lock.ok) {
  throw new Error("Another engine already runs on this state folder.");
}

const connected = await endpoint.connect(signal);
if (!connected.ok) {
  throw new Error("The signer is not listening.");
}
const signer = await openIpcChannel({
  socket: connected.value,
  key,
  role: "client",
  inbound: replySchema,
  outbound: requestSchema,
  signal,
});
await signer.send(request, signal);
const reply = await signer.receive(signal);
```

`endpoint` is this OS's `IpcEndpoint` for the signer, and `key` is 32 random bytes the engine hands
the signer on its standard input.
