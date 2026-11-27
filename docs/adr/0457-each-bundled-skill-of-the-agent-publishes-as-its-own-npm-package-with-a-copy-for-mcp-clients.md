# 0457. Each bundled skill of the agent publishes as its own npm package, with a copy for MCP clients

Status: Accepted

Accepted by the lead on 2026-11-27, on the owner's answer to Q9 (one package per skill).

Amends [decision 0352](0352-each-npm-package-carries-the-workspace-packages-it-needs-inside-its-tarball.md).

## Context

binference bundles six skills in `skills/`. Five are written for the agent (`metadata`
`binference-audience: agent`): `copy-trading`, `dca-plan`, `meme-hunting`, `safe-swap` and
`token-due-diligence`. One, `binference-tools`, is written for MCP clients
(`binference-audience: mcp`) and names the `binference_*` tools of `binference mcp`; `binference
mcp setup` installs it from the `binference` package, at the version of the server it describes
(protocol spec section 11.1).

The owner chose one npm package per skill. `skill/add` already installs a skill from npm, pinned by
the tarball's published SHA-512 `integrity`, with an optional `#<folder>` inside the package, and
runs the install lint on every text file (decision 0207). Decision 0352 publishes four packages and
keeps every other package private.

The agent's skills name the agent's tools: `token_search`, `buy`, `order_create`, `market_scan`.
An MCP client has none of them; it has the `binference_*` tools, one per row of the protocol's
`mcpTools`, and proposes every trade, send, bridge, revoke and stake through `binference_propose`
with a `kind`. Some agent tools have no MCP tool: `market_scan`, `chart`, `wallet_activity`, the
web tools and the schedule tools among them.

## Decision

- **One package per skill of the agent.** `@binference/skill-<folder>`: today
  `@binference/skill-copy-trading`, `@binference/skill-dca-plan`, `@binference/skill-meme-hunting`,
  `@binference/skill-safe-swap` and `@binference/skill-token-due-diligence`. A skill added to
  `skills/` for the agent gets its package with no other change.
- **`binference-tools` stays inside `binference`.** It names the server's tools at the server's own
  version, and `binference mcp setup` installs it from there; a package of its own could hold
  another version's tool list.
- **What a package holds.** `agent/SKILL.md`, the skill's own file unchanged; `mcp/SKILL.md`, its
  copy for MCP clients, when the skill has one; `README.md` and `README.zh.md` filled from
  `config/release/skill-package/`; `LICENSE`, `NOTICES.md` and the manifest. The manifest takes the
  release's version, MIT, the repository with `skills/<folder>`, public access with provenance, and
  `"private": true` in a nightly pack. No code, no `main`, no `exports`, no `engines` and no
  dependencies. The dry run refuses a tarball holding any other file.
- **The MCP copy is made, never kept.** At pack time, `mcpSkillCopy` reads the agent's `SKILL.md`
  and writes the copy: the audience `mcp`; each agent tool named as the MCP tool that does the same,
  through one table keyed by every agent tool name (`buy` becomes `binference_propose` with
  `kind: "buy"`, `unstake` becomes `binference_propose` with `kind: "stake", action: "unstake"`);
  each block of the body (a paragraph, a list item, a table row) that names a tool with no MCP tool
  left out, then a heading left with nothing; and one sentence after the title saying where the
  agent id every MCP tool takes comes from. A tool is named when a code span is exactly its name, or
  a word joined by underscores is; a one-word name in plain text is English. A value that spells a
  tool's name, such as a side, is written as `side: "buy"`.
- **A skill with no copy.** When the skill's frontmatter names a tool with no MCP tool, the skill is
  the agent's alone: its package holds `agent/` only and its npm page says so. Today that is
  `meme-hunting`, whose description names `market_scan`.
- **Checked twice.** A copy that would still name an agent tool is refused at pack time. A test
  reads the agent's tools from the runtime's own tool list and fails when any copy names one, or
  names a `binference_*` tool the server does not serve.
- **Installed as `skill/add` installs.** The dry run installs each folder of each tarball it packed
  through `skill/add`'s own install, as `npm:<name>@<version>#agent` and `#mcp` pinned by the
  tarball's SHA-512, into an empty folder with no bundled skill; any lint finding stops the run.
- **Listed with the release.** `release:dry` and `--pack-only` pack the skill packages beside the
  four, at the same version. They join `release.json`, `SHA256SUMS`, the packed install and its
  SBOM, the style guard over each npm page, the registry preflight and `npm publish --dry-run`. The
  release workflow publishes every package `release.json` lists, so it takes them with no change.
  The import check of the packed install loads only packages with code.
- **First publish is the owner's input.** No skill package is on npm. Each publishes once through
  the bootstrap token of decision 0451, then the owner sets its trusted publisher
  (`release.yml`, environment `release`) and turns tokens off for it, as for the three scoped
  packages before.

## Consequences

- An MCP client gets each skill it can use as a folder to copy, with tool names its server has.
- On an install that bundles the same skill, `skill/add` of its package answers `skill.name_taken`,
  as for any bundled name (decision 0207); the package serves installs and clients without it.
- A new agent tool cannot build until its row says which MCP tool does the same, or `none`.
- A sentence that only makes sense to the agent, such as one about the live facts or
  `STRATEGY.md`, stays in the copy when it names no tool.
- Five more npm names the owner sets up once; a release publishes nine packages.

## Alternatives

- **A hand-kept MCP copy per skill.** Two texts drift; the copy would not follow the skill's edits.
- **A copy for every skill, dropping what it cannot do.** A meme hunt without a scan is not the
  skill its name promises.
- **Mark agent-only passages in the skills.** Markers in every skill the agent reads, for a rule
  the tool names already decide.
- **One package holding every skill.** The owner chose one package per skill.
- **`SKILL.md` at the package's root.** `skill/add` without a folder would then install the
  manifest, the npm pages and the MCP copy as files of the agent's skill.
