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
- named secrets behind core's `SecretStore` port: the OS keychain through `@napi-rs/keyring` (the
  Secret Service required on Linux, never the kernel keyring, which forgets at a reboot), the
  passphrase store where no keychain answers, or owner-only files for the `file` unlock mode;
- the background service behind the `ServiceManager` port: a LaunchAgent through `launchctl` on
  macOS, a `systemctl --user` unit on Linux, a scheduled task through `schtasks` on Windows, each
  started at the owner's login, in their session;
- text files read whole, and programs run with an argument array, no shell and a time limit;
- log files: lines appended in order without blocking the writer, a file set aside once it is full,
  set-aside files removed after the days kept, and the last whole lines read back.

## API

| Export                              | What it does                                                         |
| ----------------------------------- | -------------------------------------------------------------------- |
| `createPlatform`, `Platform`        | This OS's adapters, its stop signals and the state folder            |
| `resolveStateFolder`, `StateFolder` | Every path in the state folder; creates nothing                      |
| `FilePermissions`                   | The port that makes a file or folder owner-only                      |
| `FileAccess`, `FileAccessState`     | The port that reads whether a file or folder is owner-only           |
| `ensurePrivateFolder`               | Creates a folder and restricts it to its owner                       |
| `writePrivateFile`                  | Writes a file only its owner can read, replacing the old one at once |
| `acquireFileLock`, `FileLock`       | An exclusive OS file lock, or `held` while another holder has it     |
| `IpcEndpoint`, `IpcBinding`         | The port that listens on and connects to one local IPC address       |
| `openIpcChannel`, `IpcChannel`      | An authenticated channel of schema-checked JSON messages             |
| `createShutdown`, `Shutdown`        | Runs the shutdown steps in order on a stop signal, within a budget   |
| `Platform.keychain`                 | The OS keychain, entries `binference/<name>`                         |
| `createPassphraseSecretStore`       | Secrets sealed with the owner's passphrase, one file each in `keys/` |
| `createFileSecretStore`             | The `file` unlock mode: each secret in its own owner-only file       |
| `Platform.hasDesktopSession`        | Whether a desktop session runs, so the OS keychain is there          |
| `ServiceManager`                    | The port that installs, removes and reports a background service     |
| `Platform.serviceManager`           | This OS's service manager, given a clock for its waits               |
| `readTextFile`                      | Reads a text file of at most 1 MiB, or `not_found`                   |
| `openLogFile`, `LogFile`            | Appends log lines without blocking; sets a full file aside by size   |
| `readLogLines`, `LogLines`          | Reads a log file's last whole lines, or the lines after a byte       |
| `runCommand`, `RunProgram`          | Runs a program with an argument array, no shell and a time limit     |
| `@binference/platform/testing`      | Contract suites, service and secret vault fakes, `createTempFolder`  |

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

## Background service

`platform.serviceManager(clock).install(definition, signal)` writes the service, sets it to start
at login and starts it; it resolves once the OS reports it running. The names are
`io.binference.<name>` (a plist in `~/Library/LaunchAgents`), `binference-<name>.service` (in
`$XDG_CONFIG_HOME/systemd/user`) and the task `binference-<name>`. Each restarts the program after
an exit with an error, not after a clean exit. macOS and Linux append its output to
`definition.logFile`; Task Scheduler keeps none, so the program writes its own log. On a Linux
server with no login session, the user manager runs only with `loginctl enable-linger`.

## Tests on the real OS

Unit tests never touch the machine's keychain or login items: they replace `@napi-rs/keyring`,
and the service adapters run against recorded `launchctl`, `systemctl` and `schtasks` answers.
Two switches run the contracts on the real OS, and only CI sets them:

- `BINFERENCE_KEYCHAIN_TESTS=1`: the keychain contract on the real keychain, under a service name
  of its own, deleting every entry it wrote (macOS, Windows, and Linux with GNOME Keyring).
- `BINFERENCE_SERVICE_TESTS=1`: the service contract with a sample program that installs, runs,
  starts at login and uninstalls, and a check that its arguments arrive intact.
