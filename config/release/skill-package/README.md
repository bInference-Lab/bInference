# {{package}}

**English** · [简体中文](README.zh.md)

The `{{skill}}` skill of binference, in the Agent Skills format. binference is an open-source AI
agent that trades on BNB Smart Chain for its owner and asks before every transaction.

{{description}}

## What it holds

- `agent/SKILL.md`: the skill as binference's agent reads it. binference ships it already.

<!-- with-mcp -->

- `mcp/SKILL.md`: the same skill for MCP clients of `binference mcp`, naming its `binference_*`
  tools. Use it beside the `binference-tools` skill, which `binference mcp setup` installs.

## Install

```sh
npm install {{package}}
```

Copy the package's `mcp` folder into your MCP client's skills folder, named `{{skill}}`.
<!-- end -->
<!-- without-mcp -->

It holds no copy for MCP clients: the skill needs tools that only binference's agent has.
<!-- end -->

## Links

- Website: <https://binference.io>
- Source and docs: <https://github.com/bInference-Lab/bInference>

MIT license. Third-party notices are in `NOTICES.md`.
