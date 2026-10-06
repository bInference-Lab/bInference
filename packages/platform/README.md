# @binference/platform

## Purpose

The OS layer. It hides what differs between macOS, Linux and Windows behind a few functions and
ports:

- the state folder, `~/.binference` on every OS, moved by `BINFERENCE_HOME`;
- owner-only files and folders: modes `0600` and `0700` on macOS and Linux, an access list that
  names the owner alone on Windows.

## API

| Export                              | What it does                                                         |
| ----------------------------------- | -------------------------------------------------------------------- |
| `resolveStateFolder`, `StateFolder` | Every path in the state folder; creates nothing                      |
| `FilePermissions`                   | The port that makes a file or folder owner-only                      |
| `ensurePrivateFolder`               | Creates a folder and restricts it to its owner                       |
| `writePrivateFile`                  | Writes a file only its owner can read, replacing the old one at once |
| `@binference/platform/testing`      | The contract suite for `FilePermissions`                             |

Error codes start with `platform.`, such as `platform.home_not_absolute` when `BINFERENCE_HOME` is
a relative path.

## Example

The composition root resolves the state folder and writes the agent key where only its owner can
read it:

```ts
import { join } from "node:path";
import { ensurePrivateFolder, resolveStateFolder, writePrivateFile } from "@binference/platform";

const stateFolder = resolveStateFolder({ binferenceHome: process.env["BINFERENCE_HOME"] });
await ensurePrivateFolder(stateFolder.keys, { permissions, signal });
await writePrivateFile(join(stateFolder.keys, "agent-key"), key, { permissions, signal });
```

`permissions` is this OS's `FilePermissions` adapter.
