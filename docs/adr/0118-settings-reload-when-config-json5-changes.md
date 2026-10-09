# 0118. Settings reload when config.json5 changes

Status: Accepted

## Context

[ARCHITECTURE.md section 24](../ARCHITECTURE.md#section-24) says live settings reload without a
restart, and every change to settings or limits is journaled and announced. Spec 2 marks each key
`live` or `restart` and says the engine reads `config.json5` at start and on `config/change`,
keeping the owner's comments ([spec 2, section 2](../specs/config.md#section-2)). `config/change`
has no handler yet, and no dependency the repository uses can edit JSON5 while it keeps comments.
Owners edit the file by hand, and the parts of the running engine copied their config values when
they were built.

## Decision

- The engine watches `config.json5` through a platform watcher on its folder, so an editor that
  saves by renaming a new file over the old one is seen too. It reloads 500 ms after the last
  change, so one save that fires several events reloads once.
- A reload reads every layer again: the defaults, the file, the `BINFERENCE_*` variables and the
  `--set` flags of this run. A file with problems keeps the running config: the engine logs the
  problem and sends `notice.configInvalid`, naming the first problem by its line or its key.
- Otherwise each changed key is journaled through `journalConfigChange`, by `engine` on the surface
  `config.json5`, with a secret source shown as its kind only. One `notice.configChanged` lists the
  changed keys and those that apply only after a restart.
- A key applies now when the part that uses it reads it from a config cell on each use; every other
  key applies after a restart. The notice says which is which, so it never claims a change it did
  not make.
- `config/change`, once built, writes the file through the same path: the watcher reloads it.

Accepted by the owner on 2026-10-09.

## Consequences

- `@binference/platform` gains a file watcher, tested on Linux, macOS and Windows.
- Spec 2 says the engine also reloads on a file change, and spec 4 gains `notice.configInvalid` and
  `notice.configChanged`.
- A key moves from restart to now one part at a time, as its part reads the cell.
- A save in the middle of an edit can reload a file with problems: the engine keeps its settings and
  says so, and the next save reloads.

## Alternatives

- **Reload only through `config/change`.** It waits for a writer that keeps comments, and a hand
  edit would wait for a restart. Rejected.
- **Reload on SIGHUP.** Windows has no SIGHUP. Rejected.
- **Restart the engine on every change.** A restart drops connections and waits for the keys again,
  for a change of the log level. Rejected.
