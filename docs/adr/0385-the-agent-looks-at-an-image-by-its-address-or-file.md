# 0385. The agent looks at an image by its address or file

Status: Accepted

Accepted by the owner on 2026-11-07.

## Context

The agent saw only the images the owner sent in chat. A chart a page linked, a screenshot the owner
named by its file, or a token's logo at an address stayed out of reach, though the shell tool
already reads the owner's machine and the web tools read pages.

## Decision

- An operation, an addition to protocol version 1: `image/view` (`agent` scope, a read) answers
  one image of at most 5 MiB at a public `http` or `https` address or in a file on the engine's
  machine, exactly one of the two, in parts of 512 KiB as `inbox/readImage` does, with the same
  checks of size and format. It answers only the engine's current runtime.
- An address is fetched through the outbound HTTP with public addresses only: a local, private or
  metadata address is `image.not_public`. A file is read at its real path, absolute or under the
  owner's home folder; one inside binference's state folder, its workspace aside, is
  `image.walled`, so a link never leads to a key, a database or the owner's token.
- The agent gets `look_at_image`, a read tool whose every answer is outside content. It reads the
  image and asks a model of the turn that takes images, the turn's own or else the vision model,
  to describe it with the agent's question. The description, at most 4,000 characters, is what the
  agent reads; its usage counts on the turn. With no model that takes images, the tool says which
  setting to set.

## Consequences

- The agent reads charts, screenshots and logos the owner points to, and answers about them.
- An image can carry words meant to steer the agent. The answer marks the turn, so a proposal after
  it shows the outside-content warning and never fills in auto mode, and no address is taken from it.
- A look costs one model call with an image.

## Alternatives

- **Put the image itself into the tool result.** The turn's model would see it directly, but not
  every provider takes images in a tool result, and a turn's model that takes none would need the
  vision model anyway.
- **Fetch addresses in the runtime.** The runtime reads pages already, but the engine holds the
  image checks and the walled paths; one place reads both kinds.
