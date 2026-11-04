# @binference/protocol

[English](README.md) · **简体中文**

以 zod Schema 描述的 binference 引擎协议：帧、操作、凭证、ID、错误码和版本。binference 是一个开源的 AI Agent，在 BNB Smart Chain 上替所有者交易，每笔交易前都会先问你。它的引擎用这个协议与控制台、Telegram、终端和其他客户端通信。

## 安装

```sh
npm install @binference/protocol
```

需要 Node 26.1 或更高版本。

## 用法

```ts
import { decodeClientFrame, operations, parseCall } from "@binference/protocol";

const decoded = decodeClientFrame(text);
if (decoded.ok && decoded.value.t === "call") {
  const call = parseCall(decoded.value);
  if (call.ok) {
    console.log(call.value.op, operations[call.value.op].scope);
  }
}
```

每个操作都标明它的权限范围，每个错误都有一个点分错误码。同一协议版本内的变更只会新增。

## 链接

- 源码和协议规范：<https://github.com/bInference-Lab/bInference>
- 网站：<https://binference.io>

MIT 许可证。第三方声明见 `NOTICES.md`。
