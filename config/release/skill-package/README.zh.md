# {{package}}

[English](README.md) · **简体中文**

binference 的 `{{skill}}` 技能，采用 Agent Skills 格式。binference 是一个开源的 AI Agent，在 BNB Smart Chain 上替所有者交易，每笔交易前都会先问你。

## 包含内容

- `agent/SKILL.md`：binference 的 Agent 读取的技能。binference 已经自带它。

<!-- with-mcp -->

- `mcp/SKILL.md`：同一技能给 `binference mcp` 的 MCP 客户端使用的版本，写的是它的 `binference_*` 工具。请与 `binference mcp setup` 安装的 `binference-tools` 技能一起使用。

## 安装

```sh
npm install {{package}}
```

把包里的 `mcp` 文件夹复制到你的 MCP 客户端的技能文件夹中，命名为 `{{skill}}`。
<!-- end -->
<!-- without-mcp -->

它不含给 MCP 客户端的版本：这个技能需要只有 binference 的 Agent 才有的工具。
<!-- end -->

## 链接

- 网站：<https://binference.io>
- 源码和文档：<https://github.com/bInference-Lab/bInference>

MIT 许可证。第三方声明见 `NOTICES.md`。
