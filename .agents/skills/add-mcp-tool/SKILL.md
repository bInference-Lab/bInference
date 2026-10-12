---
name: add-mcp-tool
description: Exposes an existing read or propose operation to outside AI clients as a tool of binference mcp, with its texts, tests and the bundled binference-tools skill. Use when an MCP client needs to read or propose something it cannot reach yet.
---

# Add an MCP tool

`binference mcp` gives outside AI clients a token with `read` and `propose` only. A tool maps one
to one onto a protocol operation: it is a row in a table, never code of its own. No tool can
confirm, deny, loosen or change a setting, and the owner taps every trade in Telegram or the
console.

## 1. The operation exists first

- The operation's scope is `read` or `propose`. If it does not exist yet, add it with
  `add-protocol-operation` in an earlier commit.
- A test in `packages/protocol/src/mcp/mcp-tools.test.ts` fails on a tool whose operation needs any
  other scope. Never widen the MCP token's scopes to make a tool fit.

## 2. The row

- Add `{ name, operation }` to `mcpTools` in `packages/protocol/src/mcp/mcp-tools.ts`. A tool that
  opens a card (a propose operation) also sets `takesRequestId: true`, so a client's retry returns
  the first intent instead of a second card.
- **The name** is `binference_` and a snake_case noun phrase a model reads at a glance
  (`binference_token_search`). Its words come from `docs/GLOSSARY.md`.
- **The order** matters to a model: tools that find ids (`binference_agents`,
  `binference_token_search`) come first, then reads, then proposals.
- Add the pair to the expected list in `mcp-tools.test.ts`.

## 3. The texts

Add the title and description to `toolTexts` in `packages/mcp/src/tools/tool-texts.ts`. They stay
English: a model reads them.

- Say what the tool returns, when to call it, and what to do with the answer, in a few plain
  sentences.
- Name the ids it takes and where to get them, and reuse the protocol's `toolSentences` (`units`,
  `ids`, `waits`), which the agent's tools share, instead of new wording for amounts, ids and
  confirmations.
- Tell the model what never to do: write an id itself, pick for the owner when a match is
  ambiguous, treat a proposal as done.
- Never ask for a key, a seed phrase or a token, and never tell the model to move funds on its own.

The input schema comes from the operation's args through `describeOperations`; never write one by
hand.

## 4. Docs and the bundled skill

- Add the tool to the table in section 11 of `docs/specs/protocol.md` and to the tool list in
  `packages/mcp/README.md`.
- Update `skills/binference-tools/SKILL.md`, the skill MCP clients load, where the new tool
  changes how a client works. `packages/cli/src/skills/tools-skill.test.ts` runs `lintSkill` from
  `@binference/plugin-sdk` over it, which fails a sentence that asks for a secret.

## 5. Test

- The MCP server's tests in `packages/mcp/src/` list every row of `mcpTools`; the stdio test in
  `src/e2e/serve-stdio.test.ts` counts them from the table.
- Add a call of the new tool to `packages/cli/src/skill-run/skill-run-engine.test.ts`, the recorded
  run's engine, and assert its answer.
- `pnpm skill:run` records a real client proposing a paper swap with the bundled skill. Run it
  when the tool changes how that swap is found or proposed; it needs the client's own login and
  the network.

```sh
pnpm vitest run packages/protocol/src/mcp packages/mcp packages/cli/src/skill-run \
  packages/cli/src/skills --maxWorkers=2
```

## 6. Report

The tool, its operation and scope, the texts, the skill's changed lines and the tests.
