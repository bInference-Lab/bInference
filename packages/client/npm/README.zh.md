# @binference/client

[English](README.md) · **简体中文**

binference 引擎协议的类型化客户端，适用于 Node 和浏览器：调用、重连和推送。binference 是一个开源的 AI Agent，在 BNB Smart Chain 上替所有者交易，每笔交易前都会先问你。控制台和终端对话都通过这个客户端连接引擎。

## 安装

```sh
npm install @binference/client @binference/protocol
```

需要 Node 26.1 或更高版本，或支持 WebSocket 的浏览器。

## 用法

```ts
import { createProtocolClient } from "@binference/client";
import { operations } from "@binference/protocol";

const client = createProtocolClient({
  operations,
  openSocket: () => new WebSocket("ws://127.0.0.1:7456/ws"),
  client: { kind: "console", version },
  credential: { device: deviceId },
  proveDevice: signChallenge,
  clock,
  random,
  logger,
});
await client.connect(AbortSignal.timeout(10_000));
const intent = await client.call("intent/get", { intent: intentId }, { signal });
```

每次调用都按操作确定类型。调用会在重连期间等待；某个主题的推送出现缺口时，会重新获取一次。

## 链接

- 源码和协议规范：<https://github.com/bInference-Lab/bInference>
- 网站：<https://binference.io>

MIT 许可证。第三方声明见 `NOTICES.md`。
