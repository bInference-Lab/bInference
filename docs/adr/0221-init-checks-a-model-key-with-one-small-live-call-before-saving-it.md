# 0221. Init checks a model key with one small live call before saving it

Status: Amended by 0228

Accepted by the owner on 2026-10-16.

## Context

ARCHITECTURE section 27 puts the model in onboarding, after telemetry, and section 16 allows any
OpenAI- or Anthropic-compatible provider. The owner decided on 2026-10-14 to build the
paste-a-key path now: the owner picks a compatible provider, pastes a key, and init checks it live
before saving it; the bInference Router's device-code link comes later. Spec 8 section 8.1 builds
model clients only in `runtime/src/providers/`, with every option set, and section 8.2 classes
their failures. The specs do not say which call proves a key, what a failed check does, which
providers init offers, where the key is kept, or what `binference check` calls.

## Decision

- **The call.** One non-streamed request through the official client of the provider's kind, as
  the runtime builds it: on Chat Completions a user message "Hi" with
  `max_completion_tokens: 16`, since some compatible servers refuse fewer; on Messages the same
  message with `max_tokens: 1`. It costs a fraction of a cent and proves the key, the credit, the
  model and the address together. A listing of models is free but proves neither the credit nor
  that the model answers.
- **The outcomes.** The failure class of spec 8 and the answer's status and documented code pick
  one problem: `bad_key` (an `auth` failure), `no_credit` (`billing`), `rate_limited` (a 429 that
  waiting ends), `unknown_model` (a documented code such as `model_not_found`, a 404 whose words
  name the model, or a 400 or 422 whose words say the model is not valid), `unreachable` (no
  answer in time, a server error, a stop) and `rejected` (any other refusal, or a 200 that is not
  the API's documented shape, such as a sign-in page at a wrong base URL). The words only pick the
  problem and are never shown.
- **A failed check blocks.** A person at the terminal reads what went wrong and the next step, and
  answers the model questions again, three tries in all; then init stops before anything is
  stored or made on Privy, as every other check does. A check from flags stops at once.
- **The providers.** The bInference Router (`binference` kind), OpenAI and Anthropic at their own
  APIs, OpenRouter (`openai` kind, `https://openrouter.ai/api/v1`), and any other
  OpenAI-compatible or Anthropic-compatible provider at the base URL the owner types, `http` only
  on the owner's own machine. Init names the provider in `models.providers` after its choice
  (`binference`, `openai`, `anthropic`, `openrouter`, `compatible`) and sets `models.main` and
  `models.fast` to the one model the owner names; the owner may set a cheaper `fast` model later.
- **The key** is typed hidden and kept where init keeps the Privy app secret and the bot token:
  the OS keychain entry, or the owner-only file in `keys/`, named `<provider>-key`, which
  `models.providers.<name>.apiKey` names as a secret source. It never goes into `config.json5`, a
  log, an error, an answer or the screen; from flags it comes only as a secret source. A start
  over offers the stored key again without showing it.
- **`binference check`** runs the same call on `models.main` as `models.reachable`, within 10
  seconds, and names the problem and the provider, never the key. A config with no model skips
  the check.
- **The Router's device-code link** is a second way to get a key for the `binference` provider,
  chosen in the same step; it waits for a Router release that serves a self-hosted agent and sets
  a spending limit.

## Consequences

- An install never finishes init with a model it cannot call.
- Each check spends a few tokens of the owner's credit.
- A provider that answers only streams cannot pass the check; none of the providers offered does.
- `fast` uses the main model until the owner names another.

## Alternatives

- **List the models.** Free, but a key without credit passes, and some compatible servers serve
  no list.
- **Count tokens.** Free on Anthropic, but no such call exists on Chat Completions, and it does
  not prove the credit.
- **Warn and go on.** The agent would fail at its first turn, far from the step that could fix it.
- **Keep the key in `config.json5`.** Config spec section 5 refuses a secret there.
