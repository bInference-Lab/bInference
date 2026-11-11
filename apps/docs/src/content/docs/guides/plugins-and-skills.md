---
title: Plugins, skills and MCP
description: Add community plugins that give the agent new read tools in a sandbox, see the skills the agent follows, and connect MCP clients.
---

## Community plugins

A community plugin gives the agent new tools that read data, such as a market index. It only reads:
it never signs, holds a key, proposes a trade or reaches a host it does not declare. Each plugin
runs in a Node process of its own, in a sandbox, and binference hands it only the web requests its
manifest allows.

### Add a plugin

Run this in a terminal on the engine's machine, with the npm package at an exact version:

```sh
binference plugin add npm:fear-index@1.2.0
```

binference reads the package from npm, checks it against its npm integrity (`--hash` gives it
yourself), and shows the permission review:

- the hosts the plugin may reach
- the tools it adds, each with its description
- the config keys it reads, from `plugins.<id>` in `config.json5`
- its npm provenance: the repository and build that published it, checked offline

Accept the review to add it. A plugin without npm provenance asks you to type its name, or to pass
it with `--name` in a script. Adding a plugin works only in a terminal; no other surface shows the
review.

### Updates

binference never updates a plugin by itself. Run `binference plugin add` with the newer version. An
update that declares nothing more and keeps its publisher installs at once. An update that adds a
host, a tool or a config key, changes its publisher, or goes back to an older version shows the
review again, with what changed. If an update fails, the version you had stays.

### Manage plugins

| Command                            | What it does                  |
| ---------------------------------- | ----------------------------- |
| `binference plugin list`           | Lists the installed plugins   |
| `binference plugin enable <name>`  | Enables a plugin              |
| `binference plugin disable <name>` | Disables a plugin at once     |
| `binference plugin remove <name>`  | Removes a plugin and its data |

### What a plugin changes for the agent

The agent sees a plugin's tools as `<plugin>__<tool>`, such as `fear_index__score`. What a plugin
answers is outside content. While any enabled plugin offers tools, every chat counts as having read
outside content from its start, so [auto mode](/guides/safety/#auto-mode) asks you on every card.
Disable the plugin to bring auto mode back.

### The sandbox

- A plugin has no network of its own, starts no program and opens no file outside its own package
  and data folder.
- Its web requests go through binference: `https` only, to a host it declares, at a public address,
  15 seconds each.
- It may use 256 MiB of heap and 512 MiB of memory in all. A call has 30 seconds.
- After a crash it starts again, waiting longer each time. After 5 crashes in 10 minutes it is
  turned off, with the [`pluginStopped`](/reference/notices/#pluginstopped) notice.
- Before any plugin starts, binference checks that the sandbox holds on this machine.
  `binference check` shows it as `plugins.sandbox`. Where it does not hold, no plugin runs, and you
  get the [`pluginSandboxOff`](/reference/notices/#pluginsandboxoff) notice.
- Before each start, binference checks that the plugin's files are still the ones you added.

In Docker, plugins run under a user of their own; the [Docker guide](/guides/docker-vps/) shows how
to start the container for it.

## Skills

A skill is a playbook in the Agent Skills format (`SKILL.md`) that the agent opens when a task
matches it. A skill adds no tool and changes no limit: whatever it leads to still goes through the
agent's tools, cards and caps. binference ships these skills:

| Skill                 | What the agent does with it                                                             |
| --------------------- | --------------------------------------------------------------------------------------- |
| `safe-swap`           | Finds the token, checks its risk, your limits and the balance, and proposes one trade   |
| `token-due-diligence` | Checks a token's risk, taxes, liquidity, insiders and chart, and names each source      |
| `meme-hunting`        | Scans new launches or trending tokens, screens them, and proposes at most one small buy |
| `dca-plan`            | Turns a wish to buy regularly into one DCA order inside your limits                     |
| `copy-trading`        | Turns a wish to follow a wallet into one copy order with its caps                       |

The skills never pick an amount for you, and never draft a launch.

### Skills the agent proposes

The agent can write a new skill, or a change to one of its workspace skills, as a skill proposal.
Nothing it proposes loads until you apply it, and it cannot apply, reject or remove a proposal. A
turn that read a web page, token data or a plugin's answer proposes nothing. Each proposal is
scanned for requests for secrets, downloads run in a shell, secrets written out, hidden characters
and sweeping deletes; a proposal with any finding cannot be applied until the agent revises it.

- In Telegram, `/skills` shows each pending proposal with its changes and findings, with Apply and
  Reject.
- In the terminal: `binference skill proposals`, `binference skill show <proposal>`,
  `binference skill apply <proposal>` and `binference skill reject <proposal> --reason <text>`.
- In the console, the Skills screen shows each proposal with its diff; Apply asks once more.

An applied proposal is written into the agent's workspace skills folder and loads from its next
turn. A change to a skill that moved since the agent proposed it is refused as stale.

A workspace skill loads only while its files are the ones you accepted. Skills already in the
workspace when you updated are accepted. One that is added or changed later, by hand or by the
agent's shell, waits: the agent does not open it, and binference tells you once. Check its files,
then accept it with `/skills`, in the console, or with `binference skill accept <name>`. The agent's
file tools never write into a skills folder.

## MCP clients

`binference mcp` serves binference's tools to an MCP client such as Claude Code or Codex. An MCP
client may read and propose, never confirm: every proposal opens a card that waits for you, and auto
mode never runs a proposal from an MCP client.

- `binference mcp setup --client claude-code` gives the client a client token of its own, its MCP
  server entry and the `binference-tools` skill. `--remove` takes them back, `--dry-run` shows the
  changes, and `--ttl 7d` makes the token expire.
- `binference mcp session --client codex` starts the client once with a client token that ends with
  the session, after one hour by default.

## See also

- [Commands](/reference/commands/) for `plugin` and `mcp`.
- [Agent and MCP tools](/reference/agent-and-mcp-tools/) for every tool.
- [Notices](/reference/notices/) for every plugin notice.
