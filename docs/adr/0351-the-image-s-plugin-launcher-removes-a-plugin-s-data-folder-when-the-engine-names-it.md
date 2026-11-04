# 0351. The image's plugin launcher removes a plugin's data folder when the engine names it

Status: Accepted

Accepted by the tech lead on 2026-11-04.

## Context

[Decision 0344](0344-the-image-runs-community-plugins-under-an-os-user-of-their-own-through-a-plugin-launcher.md)
has the plugin launcher make each plugin's data folder, `data/<id>`, owner-only for the plugin
user, so the engine's user can neither read nor remove it. `plugin/remove` removes a plugin's lock
entry, its package and its data folder
([decision 0348](0348-a-community-plugin-installs-from-npm-by-its-integrity-and-provenance-pinned-by-its-files.md)).
In the image, the data folder stayed behind: the engine could not remove it, and the launcher
took only one request, to start a plugin. A plugin added again under the same id would find the
old plugin's data.

## Decision

It amends decision 0344.

- **A second request.** A connection's first line may be `{ "plugin": "<id>", "removeData": true }`.
  The launcher removes the data folder it picks from the id, as it does for a start, with nothing
  the engine sends but the id, answers `removed` on a line of its own, and closes. The id passes
  the same pattern as a start's; anything else closes the connection.
- **The engine asks at a remove.** In the image, `plugin/remove` asks the launcher once the plugin
  has stopped, before its lock entry and package go, with 30 seconds. An answer longer than the
  line ends the connection. No launcher, or a close without `removed`, fails the call with
  `plugin.launcher_unreachable` or `plugin.data_not_removed`, both protocol codes with words that
  name the next step; the plugin stays installed and runs again, so the owner asks again once
  the launcher answers, and an add of that id never finds an old plugin's data.
- Outside the image the engine removes the folder itself, as before.

## Consequences

- A plugin removed in the image leaves no data, as one removed outside it.
- The launcher now removes as well as starts, still by id alone: a request cannot name a path, so
  the engine's user can only empty the data folder of an id, never another folder of the plugin
  user. One plugin can already reach every other plugin's data, since plugins share the plugin
  user (decision 0344).

## Alternatives

- **Give the engine's group access to the data folders.** Removing a folder needs write access to
  everything in it, so the engine's group would need it on each plugin's data, and could then
  read and change every plugin's files.
- **Leave the data and clear it at the next install of that id.** A removed plugin's data would
  stay on disk with no owner command to remove it.
