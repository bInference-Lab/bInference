# 0435. A signed revocation list stops a revoked plugin, and a stale one holds every listed plugin

Status: Accepted

Accepted by the tech lead on 2026-11-13.

## Context

Under
[decision 0433](0433-on-cloud-a-plugin-installs-turns-on-and-runs-only-under-a-listing-binference-signed.md)
a Cloud plugin runs only under a listing bInference signed
([decision 0434](0434-a-plugin-listing-is-signed-with-ed25519-over-a-statement-of-its-kind-key-and-digest.md)).
A listing can turn out wrong after its review: the package does something the review missed, or
its publisher was broken into. A signature cannot be taken back, so bInference needs a signed word
that a listing no longer holds, and that word must reach every worker that runs the plugin.

Whoever stands between the catalog and a worker can drop a new list or answer an old one. A
revocation list that an older one could replace, or that a worker keeps trusting however old it
is, would let a revoked plugin run on. A listed plugin is third-party code on a shared worker; its
tools only read, every turn that offers them is marked, and auto mode asks meanwhile (decision
0350), so what it can harm is what the agent sends it and the owner's trust, never a wallet
directly.

## Decision

- **The list.** One revocation list for the whole catalog, signed as decision 0434 has it, kind
  `pluginRevocations`. Its payload: `kind`; `sequence`, a positive integer, each list's higher than
  the last the catalog signed; `issuedAt` and `expiresAt`, in epoch milliseconds, `expiresAt` after
  `issuedAt` and at most 1 hour later; and `revoked`, the ids of every plugin listing revoked so
  far, sorted, each once, at most 10,000. An id once on it stays on it: the catalog never takes a
  listing back, and a reviewed fix gets a listing of its own. The list names no install, user or
  worker.
- **The catalog** signs a new list at once at each revocation, and at least every 10 minutes
  without one.
- **The engine reads it** at start, before the host starts any plugin, and then every 60
  seconds, each read raced against 15 seconds on the engine's clock, through
  `PluginListingCatalog`. It takes a list only when all of these hold, and else keeps the one it
  holds and logs `plugin.revocations_refused` with the reason:
  - it verifies under a key in force (`unverified`), and its payload holds the fields above within
    their bounds, its life at most an hour (`malformed`);
  - its `issuedAt` is at most 5 minutes past the engine's clock (`early`) and its `expiresAt` is
    still ahead (`expired`);
  - its `sequence` is above the floor, or equal to it with the same payload's SHA-256, a read of
    the same list again (`older`, or `forked` for another list of that sequence);
  - its `revoked` holds every id of the list this engine took before, since it started
    (`shrank`). Across a restart the lock's marks keep each installed plugin's revocation.
- **The floor** is `{ sequence, key, digest }` of the newest list taken, kept in the plugin lock
  as `revocations`, so neither a restart nor a move of the install takes an older list. The engine
  reads it from the lock before it takes its first list, so no order of calls lets an older list
  in, and a list it holds below a floor it reads is dropped. A floor whose `key` is no longer in
  force is dropped, so a key that leaked cannot set a floor no later list reaches.
- **How soon a revocation lands.** A list the catalog serves reaches an engine that can read the
  catalog within 75 seconds, and the engine stops each plugin it revokes as it takes the list.
- **A revoked plugin**, once the engine takes a list that names its listing:
  - **On:** the host stops it at once; the lock's change marks its listing `revoked` and turns it
    off; the agent runtime's settings lose its tools, so the next turn has none; the owner gets
    `notice.pluginRevoked`.
  - **Off:** the lock's change marks it `revoked` too, keeping the reason it was off for, so a
    later enable is refused whatever turned it off, an update to a listed version keeps a plugin
    the owner turned off off, and the owner gets the same notice.
  - **For good:** the mark refuses an add, an enable, an update and a start of that listing before
    the catalog is read, whatever a later list says. It lives on the plugin's own lock entry, so
    the lock's entries bound it, and it goes with the plugin when the owner removes it.
  - **Mid-call:** stopping its process ends the call in flight, which answers `plugin.call_failed`
    with `details.reason: not_running`, as any stopped plugin's does; the turn was marked before
    the call (decision 0349); every later call answers `plugin.disabled`.
  - **After:** `plugin/enable` answers `plugin.listing_revoked`; `plugin/remove` removes it and
    its data as any removal does; an update to a version listed under another id installs as
    decision 0433 says. Its data folder stays until the owner removes the plugin.
  - `notice.pluginRevoked` goes once per installed plugin and listing.
- **A catalog that cannot be read.** Installs and enables fail closed: with no list taken that is
  still fresh, or with the listing itself unread, each answers `plugin.listings_unreachable`, its
  `details.reason` `stale`, `unreachable` or `bad_answer`, and changes nothing. Plugins already on
  run on while the newest list taken is fresh. Once it expires, every listed plugin is held, at
  that moment from a timer on the clock whatever a read in flight does, and again at each read that
  finds no fresh list, so a plugin on since is held too: the host stops it, its tools leave the
  agent's settings, and its lock entry stays as it is. The owner gets `notice.pluginsHeld` once per
  hold, at most once in 24 hours per install; the time it was last sent is kept in the lock beside
  the floor, so a restart does not tell again. At the first fresh list taken, each held plugin
  whose listing passes starts again, with no notice. The lock is read again after those checks,
  so only a plugin still on at the version and listing its check passed starts, and never one an
  operation stopped since.
- **Why hold, and why an hour.** A worker that has not heard from the catalog for an hour cannot
  know that no revocation landed. A held plugin costs the owner its tools for a while and never
  funds, and a hold ends by itself, which a turn-off would not. With a list signed at least every
  10 minutes, plugins hold 50 to 60 minutes after the catalog stops answering, and a revoked plugin
  can run at most an hour on a worker cut off from the catalog.
- **Logs:** `plugin.revoked` with the plugin's id and its listing, `plugin.listings_held`,
  `plugin.listings_resumed` and `plugin.revocations_refused` with its reason; never a payload.
  The Cloud's alarms read them.

## Consequences

- A revoked plugin stops on every worker that can read the catalog within 75 seconds of its list,
  and on a cut-off worker within an hour; an owner cannot keep it running.
- An outage of the catalog that outlasts its last list pauses every listed plugin on Cloud until
  it answers again.
- The list only grows: 10,000 ids of 40 characters are about 400 KB, inside its 1 MiB. A catalog
  past that needs a new decision.
- Each install reads the list once a minute; the Cloud adapter may answer every install of a
  worker from one read, since the list names none.
- The plugin runner gains the hold: a plugin the lock has on that is not started and not offered.
  Only a passed check ends it.
- A removed plugin's mark goes with it: after a restart, an add of that listing again passes only
  if the newest list taken no longer names it, which only a list bInference's key signed can do.
- Tests cover an older list, a forked one, one that shrank, one too early, one expired, a floor
  whose key left the set, a revocation of a plugin on, off and mid-call, an enable and a watch
  that overlap, a restart with a newer list that leaves the listing out, a hold and its end, and a
  property test of the rules over random runs of lists and restarts.

## Alternatives

- **The catalog's set alone, a missing listing being a revoked one.** An older answer of the
  catalog would bring a revoked listing back; a list with a floor cannot be rolled back.
- **A list that never expires.** A worker cut off from the catalog would run a revoked plugin for
  good.
- **Turn every plugin off when the list goes stale.** Each owner would turn each plugin on again
  after an outage.
- **Run on however old the list is.** No bound on how long a revoked plugin runs.
- **Read every 10 seconds.** Six times the reads, for 50 seconds of a bound that 60 seconds keeps
  under two minutes.
- **The catalog pushes revocations to the workers.** Each worker would need a way in, and a lost
  push still needs the reads.
- **A reason in the list, shown to the owner.** A revocation for a flaw not yet public would make
  it public; the notice says the listing was withdrawn.
- **A signed answer per listing at each start.** One read for each plugin at each start, and it
  would still need an expiry; one list covers them all.
