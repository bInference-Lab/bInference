# @binference/plugin-sdk

[English](README.md) · **简体中文**

binference 插件所导入的包。binference 是一个开源的 AI Agent，在 BNB Smart Chain 上替所有者交易，每笔交易前都会先问你。社区插件为 Agent 增加可调用的只读工具；它在自己的沙箱进程中运行，只能通过清单中声明的主机访问网络。

## 安装

```sh
npm install @binference/plugin-sdk
```

需要 Node 26.1 或更高版本。

## 用法

```ts
import { defineTools } from "@binference/plugin-sdk/community";

export const tools = defineTools({
  async token_notes(input, { fetch, signal }) {
    signal.throwIfAborted();
    const answer = await fetch({ url: "https://api.example.org/notes" });
    return { status: answer.status, notes: answer.body };
  },
});
```

插件的 `package.json` 在 `binference` 字段中声明它的 ID、带 JSON Schema 的工具和它访问的主机，由 `communityManifestSchema` 检查。插件运行前，所有者会审核它的每项权限。

| 导入路径                           | 内容                             |
| ---------------------------------- | -------------------------------- |
| `@binference/plugin-sdk/community` | `defineTools` 和清单的 Schema    |
| `@binference/plugin-sdk/data`      | 精确读取数字，按节奏读取公开 API |
| `@binference/plugin-sdk`           | `defineVenue` 和平台类型         |
| `@binference/plugin-sdk/evm`       | EVM 链的 calldata 工具           |
| `@binference/plugin-sdk/testing`   | 平台需要通过的契约测试           |

## 链接

- 源码和文档：<https://github.com/bInference-Lab/bInference>
- 网站：<https://binference.io>

MIT 许可证。第三方声明见 `NOTICES.md`。
