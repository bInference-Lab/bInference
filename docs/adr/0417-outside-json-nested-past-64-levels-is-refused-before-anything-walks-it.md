# 0417. Outside JSON nested past 64 levels is refused before anything walks it

Status: Accepted

Accepted by the tech lead on 2026-11-12.

## Context

`JSON.parse` reads any nesting: V8's parser does not recurse. What reads the value next often
does. zod's `z.json()` (`jsonValueSchema`), a structured clone, `replaceNulDeep` and `holdsNul`
recurse once per level, and run out of stack between 1,000 and 5,000 levels. Measured on Node
26: a `plugin/call` frame whose input nests 1,000 deep is answered; one nesting 2,000 deep, about
4 KiB, makes `parseCall` throw `RangeError` inside the WebSocket `message` listener, which nothing
catches, and the engine process exits with code 1. Every other connection, the money path and the
agent go down with it.

binference's own shapes nest shallowly. The deepest example of the protocol nests 10 levels (an
`intent/list` result), and a frame adds 2. A Telegram update nests about 8. A community plugin's
schemas may nest 8. The agent's tool arguments are already refused past 64 levels.

## Decision

- **One bound.** `maxJsonDepth` of `@binference/core` is 64 levels of objects and arrays. It is
  the bound the agent's tool arguments already had, more than five times the deepest shape
  binference makes or reads, and more than fifteen times below the depth where the first walk
  runs out of stack.
- **Read the depth first, without recursion.** Each boundary that takes JSON from outside reads
  its depth before any schema or walk reads it: `nestsDeeperThan` scans the text once, its strings
  skipped, and `valueNestsDeeperThan` walks a parsed value with a list. Past the bound, the input
  is refused:
  - the protocol server, on each frame's text after its size limit: a call fails with
    `protocol.too_large` and the connection goes on; any other frame ends the connection with
    `bye`;
  - the webhook listener, on a body that is JSON: it answers 400, and nothing is recorded;
  - the Telegram ingress, on each update: it is dropped with the log line
    `telegram.update_too_deep` and acknowledged, so the next updates go on; the poll worker hands
    such an update on as its id alone, which the ingress stores and reads as an update of no kind
    it knows;
  - the agent runtime: a tool call's arguments are refused as `too_deep`, the way malformed
    arguments are, and a model stream event past the bound is malformed;
  - the plugin host, on each line of a plugin's channel: the channel is broken, as for any line
    it cannot read.
- **No throw in a listener ends the process.** The protocol server's `message` listener catches
  what a frame's reading throws, logs `server.frame_failed`, and ends that connection with
  `protocol.bad_frame`; the engine goes on.
- **Some JSON is left unbounded.** The owner's `config.json5` and backups are the owner's own
  files. The answers of outside services (RPC nodes, venues, Privy, npm, the release feed) are
  read in a request's own async path, where an overflow rejects that request alone. The MCP
  server is a process each MCP client starts for itself; what it sends the engine meets the
  protocol server's bound.

## Consequences

- A frame, body, update, argument or plugin line past 64 levels is refused, with the code of its
  boundary. Nothing binference sends or reads today comes near it.
- A fault in reading a frame costs one connection, not the engine.
- A new boundary that reads outside JSON reads its depth first, with the same bound.

## Alternatives

- **Catch the `RangeError` where each walk runs.** A walk that runs out of stack may stop halfway
  through a change; refusing first never starts it. Rejected.
- **Make every walk iterative.** zod's walk belongs to the library, and each new walk would need
  the same care. Rejected.
- **Bound the size only.** 4 KiB nests 2,000 deep, far under any size limit. Rejected.
