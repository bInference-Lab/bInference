# 0378. The agent runs shell commands behind a wall around binference's own secrets

Status: Accepted

Accepted by the owner on 2026-11-07.

## Context

Owners ask the agent for work a trading tool does not cover: checking a file, running a script,
reading a log, calling a command-line tool. [Rule 15](../ARCHITECTURE.md#rule-15) kept shell tools
off and placed them in the agent runtime. Two facts make that placement wrong once the tools are
on:

- The runtime runs under Node's permission model and starts no child process
  ([spec 8, section 2.1](../specs/runtime.md#section-2-1)). The model does not follow a child
  process, so a shell inside the runtime would lift the runtime's own file limit.
- A command runs as an OS user. On a self-hosted machine that is the owner's user, which can read
  the CLI's token in `auth/`, the agent key in `keys/` or the keychain, the databases, the config
  and the engine's IPC socket. Through them a command could act as the owner or the engine, which
  [rule 2](../ARCHITECTURE.md#rule-2) keeps from the agent.

The owner wants the shell on by default, with no prompt, able to use the owner's machine as the
owner does.

## Decision

- The agent has two tools, `shell` (run a command, wait for it or leave it running) and
  `shell_job` (read, feed and stop a running command), on by default.
- By default every command runs with no prompt and no general sandbox: it reads and writes what
  the owner's user can, and reaches the network.
- One wall always holds: a command can never reach the parts of the state folder that let it act
  as the owner or the engine (`auth/`, `keys/`, the databases and their side files, `config.json5`
  and `run/`, which holds the IPC socket), nor the keychain entries binference keeps.
- Commands run in a **shell host** process the engine starts and supervises, never in the engine,
  the signer or the runtime. The shell host holds no token and never connects to the protocol.
- The wall is the narrowest confinement the machine offers: in the Docker image the shell host
  runs as its own OS user, which cannot read the engine's files; elsewhere the platform's command
  sandbox denies those paths alone and the keychain. A machine with no such mechanism refuses
  every command with `shell.no_wall`, which names why and the next step. A command never runs
  without the wall.
- An optional sandbox, off by default (`shell.sandbox`), also keeps commands from writing outside
  the agent's workspace folder and the temporary folder.
- The engine owns the policy: what may run (`shell.run`: `off`, `listed`, `any`), when to ask
  (`shell.ask`: `never`, `unlisted`, `always`) and what an unanswered request means
  (`shell.onNoAnswer`: `refuse`, `listed`, `any`). Defaults `any`, `never`, `refuse`. The owner's
  allowed commands are rows the engine keeps, journaled and announced.
- A request waits 10 minutes. Any owner surface answers it (Allow once, Always allow, Refuse), and
  the first answer wins. A request confirms no card.
- Commands typed in PowerShell are never allowed by the list: under `listed` each one asks.
- Settings are install-wide.
- Every result that carries a command's output is outside content
  ([rule 13](../ARCHITECTURE.md#rule-13)), so the turn's proposals always get a card.
- Seed phrases and PEM private key blocks in output are masked before the model reads them.
- The audit keeps each command's text, folder, exit code and duration, never its output.

## Consequences

- The owner's choice has a cost they accepted: a command can still read, change or send anything
  else the owner's user holds, and a planted instruction the agent follows can do the same. What
  still bounds money is the wall, the cards, the limits, the signer's hard rules and the Privy
  ceiling.
- Rule 15 changes; runtime spec 2.1 and 5 gain the shell host and the `machine` tool kind; the
  protocol gains the `shell/*` operations and the shell request card.
- Auto mode stops for the rest of a session once a command's output is read.
- Windows has no command sandbox in v1, so a Windows machine refuses the shell outside the Docker
  image until one is built.

## Alternatives

- Keep the tools off: the owner decided otherwise.
- Run commands in the runtime: lifts its file limit and puts them beside the runtime's token.
- A general sandbox on by default: the owner chose the full machine.
- Run without a wall where the machine offers none: a command could act as the owner.
