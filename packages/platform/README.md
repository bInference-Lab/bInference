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
  requests;
- named secrets behind the `SecretStore` port: the OS keychain through `@napi-rs/keyring` (the
  Secret Service required on Linux, never the kernel keyring, which forgets at a reboot), or the
  passphrase store where no keychain answers;
- text files read whole, and programs run with an argument array, no shell and a time limit.

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
| `SecretStore`                       | The port that reads, writes and deletes a named secret               |
| `Platform.keychain`                 | The OS keychain, entries `binference/<name>`                         |
| `createPassphraseSecretStore`       | Secrets sealed with the owner's passphrase, one file each in `keys/` |
| `readTextFile`                      | Reads a text file of at most 1 MiB, or `not_found`                   |
| `runCommand`, `RunProgram`          | Runs a program with an argument array, no shell and a time limit     |
| `@binference/platform/testing`      | The contract suites of every port, and an in-memory `SecretStore`    |

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

## Keychain or passphrase

`Platform.keychain` throws `platform.keychain_failed` when the OS keychain is out of reach: no
desktop session on macOS, a network logon on Windows, no Secret Service on Linux. It never falls
back on its own. The owner picks another unlock mode instead; `createPassphraseSecretStore` keeps
the same entries in `keys/<name>.json`, sealed with a passphrase the owner types (scrypt, then
AES-256-GCM bound to the entry and the install id).

## Tests on the real OS

Unit tests never touch the machine's keychain: they replace `@napi-rs/keyring`. With
`BINFERENCE_KEYCHAIN_TESTS=1`, the keychain contract runs on the real keychain under a service name
of its own and deletes every entry it wrote. CI sets it on macOS, Windows, and Linux with GNOME
Keyring.
