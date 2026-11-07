# 0394. A turn that ends with no answer names the tool that failed

Status: Accepted

Accepted by the tech lead on 2026-11-07. Amends [decision 0373](../DECISIONS.md#d0373).

## Context

[Decision 0373](0373-an-answer-that-never-left-goes-again-and-a-turn-with-nothing-to-say-says-so.md)
gives a turn that ends with nothing for the owner the line `telegram.chat.noAnswer`: "No response
generated. Please try again." When the owner asked for an image, the image tool refused because
the image model named a provider the config does not hold, and the model then wrote nothing. The
owner saw only that line and no hint of what failed, though the turn knew.

## Decision

- The runtime keeps, per turn, the tool whose last call ran and failed, until a later call of that
  tool succeeds. A call that never ran, a held-back proposal or a call a stop cut off, does not
  count.
- `turn/end` takes an optional `failedTool` with that tool's name, and `chat/turnEnded` carries it
  (additions to protocol version 1).
- A turn that ends with nothing for the owner and names a failed tool gets
  `telegram.chat.toolFailed` in place of `telegram.chat.noAnswer`: the tool's name, that the agent
  wrote no answer, and what to do next. The tool's own error text stays out of the chat, since it
  is written for the model and may quote outside content.
- A config change that adds a model on a provider `models.providers` does not hold, or an image
  model on a provider that cannot make images, is `config.invalid` before anything is written, from
  `config/change` and `config/propose` alike. A model the file named before the change is left
  alone, so an older file still loads.

## Consequences

- The owner sees which step failed and can ask the agent about it, instead of a reply with no
  cause.
- A dangling model name no longer reaches the file through a chat or the CLI.

## Alternatives

- **Show the tool's error text.** It is written for the model and may carry outside words.
- **Refuse a dangling model at load.** An older file with one would stop the engine from starting.
