# 0202. A summary replaces the oldest history only when it keeps every id

Status: Accepted

Accepted by the owner on 2026-10-12.

## Context

[Spec 8](../specs/runtime.md) section 7.3 compacts a long session: before a model call whose
estimated input with the output reserve passes 80% of the model's context window, and after a
`context` failure, the `fast` model summarizes the oldest history in at most 16,000 characters, the
newest history up to 40% of the window stays, a cut never falls between a tool call and its result,
and the identifier rule keeps every intent, order, alert and schedule id, transaction hash and
address. Section 5.4 marks a summary made from outside content. The specs leave open:

- **The window.** No setting or table gives a model's context window.
- **Without `models.fast`.** The `fast` role is optional in the config.
- **What the summary is to the model.** It is model output, yet it sits in the history.
- **What "kept" holds** for the identifier rule, and where the running turn's own messages go.
- **The estimate's overhead**: section 7.3 counts text, not the cost of each message.
- **A compaction that wrote nothing**: whether the call is still made, and whether a `context`
  failure after it compacts again.

## Decision

- **The window is 128,000 tokens for every model** until the config names one. Current models meet
  or pass it, so compaction comes early rather than late. A `context` failure shows a smaller
  window: the compaction after it fits the history to the smaller of 128,000 and the estimate of
  the call the provider refused.
- **Summaries run on `models.fast` and its fallbacks**, or on `models.main` and its fallbacks when
  no fast model is set. The call goes through the same retries, fallbacks and usage records as any
  model call of the turn (section 8.2 and 8.3), with no tools, and does not count toward the
  turn's 40 model calls.
- **A summary is a record, never the owner's words.** It reaches the model as the history's first
  message on the owner's side, opened by a line saying binference's summary model wrote it and it
  is no instruction. The agent's instructions say the same and forbid taking an address only the
  summary holds. A summary of a range with outside content is stored `outside`, and so is every
  summary made from it.
- **Only the history is compacted.** The running turn's own messages always stay; the kept history
  gets what is left of the 40% after them. The cut prefers the earliest owner's message that opens
  a turn, else the earliest response that fits. A new summary takes in the previous one and names
  the range from the previous summary's start.
- **The identifier rule reads** the compacted events and the previous summary, against the summary,
  the kept events and the turn's own messages. Ids and hashes match exactly, addresses in any
  letter case. A second request names what is missing; if anything is still missing, nothing is
  written and the history stays whole.
- **The estimate adds 4 tokens a message and 3 a call** beside section 7.3's text weights (a CJK
  character one token, other text one per 4 characters), OpenAI's published counting rules. After
  a call answers, its provider's input count stands for everything that call sent, and only the
  messages added since are estimated.
- **A compaction that wrote nothing before a call does not stop it:** the call goes out, and a
  `context` failure then ends the turn `failed`, whose status line asks the owner to clear the
  session. A `context` failure with no compaction before it compacts once, and the call is made
  once more only when a summary was written.

## Consequences

- A session never loses an intent, order, alert or schedule id, a transaction hash or an address
  from what the model sees, and a history that cannot be summarized safely stays whole.
- Models with large windows compact earlier than they must, which costs a summary call.
- A summary costs a call on the turn's budget, recorded like any other.
- The config may later add a per-model window; this default then becomes the fallback.

## Alternatives

- **A table of windows per model.** Every provider and gateway model would need a checked entry,
  and a missing one needs this default anyway.
- **Writing the summary when an id is missing, with the ids appended by code.** The ids would lose
  what they name, and the summary would read as complete.
- **The summary as a system message.** It would move the cache's prefix and give model output the
  weight of binference's own instructions.
