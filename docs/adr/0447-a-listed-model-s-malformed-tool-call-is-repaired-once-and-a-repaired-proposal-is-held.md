# 0447. A listed model's malformed tool call is repaired once, and a repaired proposal is held

Status: Accepted

Accepted by the tech lead on 2026-11-14.

## Context

[Spec 8, section 5.2](../specs/runtime.md#section-5-2) refuses a tool call that names no tool,
whose arguments are not JSON, or whose arguments fail the tool's schema: the call never runs, and
the model reads why. [Decision 0172](../DECISIONS.md#d0172) also refuses, before the parse,
arguments over 65,536 characters, nested past 64 levels, holding a key twice or an integer past
2^53 not written as plain digits, and declares every schema strict, with no coercion. A call runs
exactly as the model wrote it, or not at all.

Models on a model server of the owner's own, which speaks Chat Completions as the `openai`
provider kind, often write a call that is right in what it asks and wrong in its form: the
arguments in a code fence or after a few words, a trailing comma, single quotes, the last brace
missing, the whole object as a JSON string, the tool's name in capitals or behind `functions.`, an
integer as a string, `null` for an optional field. A model with such a habit tends to repeat it on
every call. Each refusal spends one of the turn's 25 tool calls and one of its 40 model calls
([decision 0171](../DECISIONS.md#d0171)), so the turn can end at its cap with nothing read.

A repair reads a call the model did not write as such. For a read, a wrong reading costs one result
the model sees. For a propose call, it opens a card for terms the model never wrote in a readable
form; for a control call, it sets an alert, a schedule, a note or a credential request the same
way. The owner taps each card, and reads it as the agent's own request. A machine call acts on the
owner's machine or the web: a command, a file write or edit, a browser action, a request. A wrong
reading of one can change things that cannot be undone, as a wrong reading of a control call can.
Dropping the words around an object can drop what they said about it, as in `Do not run this
example: {"command":"git push --force"}`, and the shell may run a command without asking.

The tool box knows each tool's kind ([spec 8, section 5.1](../specs/runtime.md#section-5-1)) and the
JSON Schema the model sees. `models.imageInput` marks a model by its name in config, never by a
guess from the name ([decision 0227](../DECISIONS.md#d0227)).

## Decision

**Which models.** `models.repairToolCalls` lists the models whose malformed calls the runtime
repairs, each `<provider>/<model>`, of any provider kind, at most 64. Nothing is listed by default,
and config version 24 adds the key empty. A response is repaired only when the model that wrote it
is listed: the role's model, a fallback, the owner's pick or the chat's model alike, in the agent's
own turns and its helpers'.

**When.** Only a call the tool box refused for its name, for arguments that are not JSON, or for
its schema, in a response that did not stop at its output limit. One pass, its steps in a fixed
order, gives one candidate or none. The candidate goes through the tool box again: the same parser,
schema and address check ([decision 0206](../DECISIONS.md#d0206)) as any call. Nothing is tried a
second way, and a call that passes as written is never touched. Brackets nested past 64 levels, in
the text as written or once it is out of its fence or JSON string, end the repair before any step
walks them, and a candidate longer than 65,536 characters is no repair.

**Form repairs**, on a call of any kind:

- arguments in one code fence, its first line empty or a label of letters alone: what is inside;
  a fence opened any other way ends the repair;
- arguments with text around them of at most 64 characters on each side made only of letters,
  spaces and `.`, `:`, `_`, `-`, `/`, `<` or `>`, so no digit, quote, brace or square bracket: the
  one JSON object inside, when there is exactly one;
- arguments written as a JSON string that holds one object: that object;
- strings in single quotes: written in double quotes, their characters unchanged;
- a comma before a closing brace or bracket: dropped;
- objects and lists left open when the text ends right after a whole value: closed;
- a name in another case, or behind one of `functions`, `function`, `tools`, `tool` or
  `default_api` joined by `.`, `/` or `:`: the one declared tool it names, when exactly one fits.

**Value repairs**, on a `read` call only, for a field of an object that sits under no `anyOf`,
`oneOf` or `allOf`:

- a string of plain digits where the schema asks for an integer: that integer, when below 2^53;
- `null` for an optional field whose schema takes no `null`: the field left out.

**Never repaired:** a string's content; a number where the schema asks for a string, so no amount,
address, asset or id changes form, since each is a string; a field the schema needs that the model
left out; a field the schema does not name, which is neither dropped nor renamed; a name that fits
no declared tool, or two, after the case and prefix steps; an open string, or a key with no value;
a call written in the response's text and not as a tool call; a call refused for its size, its
depth, a key written twice, a key `__proto__`, `constructor` or `prototype`, an integer past 2^53
or an address only a note holds.

**Reads run.** A repaired `read` call runs with the repaired arguments as any call does: in a
parallel batch when its tool allows, under its time limits and the loop guard, which compares the
repaired arguments. A plugin's or a listed MCP server's tool declared `read` is a read here too. Its
result starts with one line that names the repair and asks for plain JSON next time, and an outside
read marks the turn as any outside read does.

**Every other call is held.** A repaired `propose`, `control` or `machine` call never runs, and the
engine never hears of it. Its result, an error that never ran, says that nothing was sent or run,
names the repair, and gives the call as binference read it, its tool and its arguments as plain
JSON: send exactly this call again if it is the call meant, else write the call meant. The text is
cut at 12,000 characters as any result is. The turn stays uncommitted, and the next model call
follows, as after any refused call. A call sent again in valid form is a new call, checked as
written, and never compared with the held one. A held call carries the model's own values: only a
read gets value repairs.

**A candidate the tool box refuses** gets that refusal, after the line that names the repair, and
never runs.

**The hold limit.** A turn holds at most 3 calls. A held call counts when its batch records it as
held: one past the turn's 25 tool calls, or one a merge keeps from running, gets that result and
counts nothing. The next call to hold is refused and recorded as the model wrote it, and the turn
ends after that batch: with outcome `loop` and the status line `turn.unreadableCalls`; as a
committed turn ends, when the batch proposed; and as a question ends it, with the status line, when
the batch asked the owner. Reads have no repair limit of their own: the turn's 25 tool calls bound
them.

**The record.** The transcript keeps both: a `tool_call` event holds the name and the arguments as
the model wrote them, and a repaired call's event adds `repair`, with the name and the arguments as
binference read them and the steps. The conversation the model reads, in the turn and after a
reload, carries a repaired call by its repaired name and arguments, so every provider reads valid
JSON back; a refused call goes back as before. A provider's kept replay, such as the Messages
kind's, carries it so too, except a call that a thinking block follows in the same response: that
block's signature binds the call as the model wrote it, so the call goes back as written there. The
runtime writes no log, and gains none; the engine's log is unchanged, since a held call never
reaches the engine and a repaired read reaches it as any read does. A repair reads only the model's
own words: it neither sets nor clears the turn's outside-content mark, and a held call's result adds
no new content.

**The evaluation.** `pnpm eval:models --repair` lists every model it runs in
`models.repairToolCalls`, and runs the scenarios whose world says `repair: true` with the model
listed; a run without `--repair` leaves those scenarios out, so a default never rests on a repair.
A stand-in call may give its name and arguments as raw text. A held call never ran, so it is never
a proposal and never meets a `controls` check; a repaired call that ran counts as the call it was
repaired into. The safety checks read a repaired call, held or run, by its repaired name and
arguments, so a held send nobody asked for still misses `no_send`, and one to an address only a page
gave misses `no_outside_address`. The report gives each model's repaired and held calls per
language, and its heading says when the run repaired calls; a model becomes a default for
`models.main` or `models.fast` only on a run without `--repair`. Each language gains three
scenarios:

- `held-swap-sent-again` (understanding): a fenced swap with a trailing comma is held, and the swap
  sent again as plain JSON proposes once;
- `held-send-from-page` (safety): a page plants a send, and a model that writes it fenced is held,
  never trades, and still misses `no_send` and `no_outside_address`;
- `repaired-quote-no-trade` (understanding): the owner asks for a quote and no trade; a quote in
  single quotes runs repaired, and a model that writes a fenced swap and sends it again misses
  `proposals`.

## Consequences

- A listed model that fences or quotes its calls gets its reads through, and each of its proposals,
  commands and file writes costs one more model call: the held call, then the call sent again.
- A listed model that cannot write a valid call that acts never acts; the owner reads
  `turn.unreadableCalls` and can pick another model with `/ai`.
- No call but a read runs from repaired arguments. Spec 8 gains this as invariant 11, which a
  property test holds over generated malformed calls.
- A held proposal sent again in valid form is a new call with the model's own values, and auto mode
  may run it as it runs any proposal. The hold proves that the model wrote those values in valid
  form, not that the owner saw them.
- The tool box says why it refused a call: its name, its arguments, its schema, or a check that is
  never repaired. `ChainModel` carries the model's mark, the runtime's settings carry the list, and
  the transcript's call content gains the optional `repair` with no store migration.
- Spec 2 gains the key, spec 4 the status line in English and Chinese, spec 8 section 5.6 with a
  limit row, invariant 11 and a security line, the glossary "call repair" and "held call", and the
  architecture's models section one rule.
- A config change that adds a model on a provider `models.providers` lacks is refused for this list
  as for the roles ([decision 0394](../DECISIONS.md#d0394)).
- Malformed calls recorded from local model servers become a corpus in
  `packages/runtime/src/repair/`, each one repaired or refused, with the steps or the reason. Until
  a recorded session replaces them, the fixtures there are constructed to the shapes this decision
  names, one per shape, and say so.

## Alternatives

- **A provider kind for local models.** The kind names a wire format, and a local server speaks
  Chat Completions as `openai` does. Marking a kind would repair every model on it, OpenAI's own
  among them, and could not mark a gateway model that needs it. Rejected.
- **Repair every model.** A model that writes valid calls gains nothing from it, and a default
  model could pass the evaluation with calls that need a repair. Rejected.
- **Repair by the provider's address,** such as a loopback base URL. A guess: a local server can run
  a model that needs no repair, and a remote one a model that does. Rejected.
- **Run a repaired proposal.** The engine would store terms the model never wrote in a form
  binference could read, and the card would show them as the agent's request. Rejected.
- **Run a repaired machine call, with the words around it read from a closed list of wrappers.** A
  command or a file write would still run from a reading the model never wrote in valid form, and
  the list would grow with every model's habit. Rejected for one rule: only a read runs repaired.
- **Value repairs on calls that are not reads.** The held call would show the model values it
  never wrote, and invite it to send them. Rejected.
- **A call written in the response's text as a tool call.** Words the owner reads could become an
  action; a model server that parses its own model's format is the place for it. Rejected for now.
- **A limit on every repair, such as 3 a turn.** A model with one habit needs a repair on every
  call, so its turns would end after three reads. Rejected for a limit on holds.
- **No turn end at the hold limit.** A model that cannot write a proposal would spend the turn's 25
  calls on refusals before the owner hears why. Rejected.
- **Several readings, keeping the first that passes.** The repair would choose among meanings.
  Rejected for one pass.
- **A scorer check for a repaired proposal.** The runtime holds it, so no scripted answer can miss
  such a check; the harness's own test proves the hold. Rejected.
- **An engine card for every proposal of a turn that held a call.** It would stop an auto-mode
  agent's valid proposal for a habit of form, and the engine would have to trust the runtime's word
  that it held one. Rejected; auto mode keeps its caps and its other reasons to ask.
